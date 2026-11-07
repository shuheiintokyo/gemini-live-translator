// Gemini Live Multimodal WebSocket Client
import { buildSystemInstruction, getLiveModel, getTranslationLanguageCode } from './config.js';
import { flushPlayback, getPlaybackState, isPlaybackBusy, playPcmChunk, startMicCapture, stopElementCapture, stopMicCapture } from './audio.js';

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const MAX_RECONNECT_ATTEMPTS = 3;
const DEFAULT_GO_AWAY_MS = 5000;

let ws = null;
let reconnectTimer = null;

// A session waiting to reconnect still counts as active, so Stop can cancel it
export function isSessionActive() {
    return ws !== null || reconnectTimer !== null;
}

// goAway.timeLeft is a protobuf Duration, which arrives in JSON as e.g. "4.5s"
function parseDurationMs(duration) {
    const seconds = parseFloat(duration);
    return Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_GO_AWAY_MS;
}

function buildSetupMessage(model, sourceLang, targetLang, voiceName) {
    // The Live Translate model takes no system instruction or voice
    if (getLiveModel(model).isTranslateModel) {
        return {
            setup: {
                model,
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    translationConfig: {
                        targetLanguageCode: getTranslationLanguageCode(targetLang)
                    }
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {}
            }
        };
    }

    return {
        setup: {
            model,
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName
                        }
                    }
                }
            },
            systemInstruction: {
                parts: [{
                    text: buildSystemInstruction(sourceLang, targetLang)
                }]
            },
            // By default any new speech cancels the translation in progress ("barge-in"),
            // and short pauses end a turn mid-sentence
            realtimeInputConfig: {
                activityHandling: "NO_INTERRUPTION",
                automaticActivityDetection: {
                    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
                    silenceDurationMs: 1000
                }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {}
        }
    };
}

function describeMicError(err) {
    if (err.name === 'NotAllowedError') return "Microphone access was denied. Allow it in your browser and try again.";
    if (err.name === 'NotFoundError') return "No microphone was found.";
    if (!navigator.mediaDevices) return "Microphone needs a secure page. Open the app on https or localhost.";
    return `Could not start the microphone: ${err.message}`;
}

export function connectGeminiLive(options) {
    const {
        apiKey,
        model,
        sourceLang,
        targetLang,
        voiceName,
        playAudio,
        silenceWhilePlaying,
        listeningMessage,
        onStatusChange,
        onInputText,
        onOutputText,
        onTurnEnd,
        showToast,
        // Audio source: the microphone unless a page passes another, like an episode file
        startCapture = startMicCapture,
        reconnectAttempt = 0,
        isReconnect = false
    } = options;
    disconnectGeminiLive();
    onStatusChange('connecting');

    let socket;
    try {
        socket = new WebSocket(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`);
    } catch (err) {
        console.error("WebSocket connection failure:", err);
        onStatusChange('disconnected');
        showToast("Could not open a connection to Gemini Live.", "error", "error");
        return;
    }
    ws = socket;
    let isSetupComplete = false;
    const stats = { audioChunks: 0, interrupted: 0, turnComplete: 0, messageFields: new Set() };

    // Every handler checks ws === socket, so a replaced socket's late events
    // can't tear down the session that took over from it
    socket.onopen = () => {
        if (ws !== socket) return;
        console.log("WebSocket opened. Sending setup for model:", model);
        socket.send(JSON.stringify(buildSetupMessage(model, sourceLang, targetLang, voiceName)));
    };

    socket.onmessage = async (event) => {
        let data;
        try {
            data = JSON.parse(event.data instanceof Blob ? await event.data.text() : event.data);
        } catch (e) {
            console.error("Failed to parse incoming WebSocket message:", e);
            return;
        }
        if (ws !== socket) return;

        // 1. Server confirms setup is complete: NOW we can begin microphone capture
        if (data.setupComplete) {
            isSetupComplete = true;
            try {
                await startCapture((base64Audio) => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                            realtimeInput: {
                                audio: {
                                    mimeType: "audio/pcm;rate=16000",
                                    data: base64Audio
                                }
                            }
                        }));
                    }
                // Otherwise the mic hears the spoken translation, which can cut it off or loop it back
                }, { isSilenced: silenceWhilePlaying ? isPlaybackBusy : undefined });
            } catch (micErr) {
                console.error("Microphone capture error:", micErr);
                if (ws !== socket) return;
                disconnectGeminiLive();
                onStatusChange('disconnected');
                showToast(describeMicError(micErr), "error", "mic_off");
                return;
            }
            if (ws !== socket) return;
            onStatusChange('connected');
            showToast(isReconnect ? "Reconnected." : listeningMessage, "success", isReconnect ? "sync" : "mic");
            return;
        }

        // Google ends each connection after about 10 minutes and warns first. Translation
        // needs no memory of earlier sentences, so move to a fresh session once playback ends
        if (data.goAway) {
            const deadline = Date.now() + Math.max(parseDurationMs(data.goAway.timeLeft) - 1000, 0);
            const handOver = () => {
                if (ws !== socket) return;
                if (isPlaybackBusy() && Date.now() < deadline) {
                    setTimeout(handOver, 250);
                    return;
                }
                console.info("Gemini asked to reconnect. Starting a fresh session.");
                onTurnEnd();
                connectGeminiLive({ ...options, reconnectAttempt: 0, isReconnect: true });
            };
            handOver();
            return;
        }

        Object.keys(data).forEach(key => stats.messageFields.add(key));
        const content = data.serverContent;
        if (!content) return;
        Object.keys(content).forEach(key => stats.messageFields.add(`serverContent.${key}`));
        if (content.interrupted) stats.interrupted++;
        if (content.turnComplete) stats.turnComplete++;

        // 2. Play incoming audio chunks and display transcripts
        content.modelTurn?.parts?.forEach(part => {
            if (part.inlineData?.data) {
                stats.audioChunks++;
                if (playAudio) playPcmChunk(part.inlineData.data);
            }
        });
        if (content.inputTranscription?.text) onInputText(content.inputTranscription.text, content.inputTranscription.languageCode);
        if (content.outputTranscription?.text) onOutputText(content.outputTranscription.text);

        // 3. Handle interruption and end of turn
        if (content.interrupted) flushPlayback();
        if (content.interrupted || content.turnComplete) onTurnEnd();
    };

    socket.onerror = (err) => {
        console.error("Gemini WebSocket error:", err);
    };

    socket.onclose = (event) => {
        console.warn("Gemini WebSocket closed. Code:", event.code, "Reason:", event.reason);
        console.info("Gemini session stats:", JSON.stringify({ ...stats, messageFields: [...stats.messageFields], playback: getPlaybackState() }));
        if (ws !== socket) return;
        ws = null;
        stopMicCapture();
        stopElementCapture();
        flushPlayback();

        // A working session that drops without an error reason (weak signal, the server's
        // time limit) reconnects by itself a few times before giving up
        const wasWorking = isSetupComplete || reconnectAttempt > 0;
        const nextAttempt = isSetupComplete ? 1 : reconnectAttempt + 1;
        if (wasWorking && !event.reason && nextAttempt <= MAX_RECONNECT_ATTEMPTS) {
            onTurnEnd();
            onStatusChange('connecting');
            showToast("Connection dropped. Reconnecting…", "info", "sync");
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connectGeminiLive({ ...options, reconnectAttempt: nextAttempt, isReconnect: true });
            }, 1000 * nextAttempt);
            return;
        }

        onStatusChange('disconnected');
        if (event.reason) {
            showToast(`Session ended: ${event.reason}`, "error", "warning");
        } else if (!isSetupComplete || event.code !== 1000) {
            showToast(`Could not reach Gemini Live (code ${event.code}). Check your API key and network.`, "error", "warning");
        }
    };
}

export function disconnectGeminiLive() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    stopMicCapture();
    stopElementCapture();
    flushPlayback();
    if (ws) {
        const socket = ws;
        ws = null;
        socket.close();
    }
}
