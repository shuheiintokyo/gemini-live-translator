// Gemini Live Multimodal WebSocket Client
import { buildBothWaysInstruction, buildSystemInstruction, getLiveModel, getTranslationLanguageCode } from './config.js';
import { flushPlayback, getPlaybackState, isPlaybackBusy, playPcmChunk, startMicCapture, stopMicCapture } from './audio.js';

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

let ws = null;

export function isSessionActive() {
    return ws !== null;
}

function buildSetupMessage(model, sourceLang, targetLang, targetTone, bothWays) {
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
                            voiceName: targetLang.voiceName
                        }
                    }
                }
            },
            systemInstruction: {
                parts: [{
                    text: bothWays
                        ? buildBothWaysInstruction(sourceLang, targetLang, targetTone)
                        : buildSystemInstruction(sourceLang, targetLang, targetTone)
                }]
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

export function connectGeminiLive({
    apiKey,
    model,
    sourceLang,
    targetLang,
    targetTone,
    bothWays,
    isMuted,
    onStatusChange,
    onInputText,
    onOutputText,
    onTurnEnd,
    showToast
}) {
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
        socket.send(JSON.stringify(buildSetupMessage(model, sourceLang, targetLang, targetTone, bothWays)));
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
                await startMicCapture((base64Audio) => {
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
                // Both ways, the mic would hear the translation and translate it straight back
                }, { isMuted, isSilenced: bothWays ? isPlaybackBusy : undefined });
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
            showToast(bothWays
                ? `Listening for ${sourceLang.name} and ${targetLang.name}.`
                : `Listening for ${sourceLang.name} to translate into ${targetLang.name}.`, "success", "mic");
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
                playPcmChunk(part.inlineData.data);
            }
        });
        if (content.inputTranscription?.text) onInputText(content.inputTranscription.text);
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
        flushPlayback();
        onStatusChange('disconnected');
        if (event.reason) {
            showToast(`Session ended: ${event.reason}`, "error", "warning");
        } else if (!isSetupComplete || event.code !== 1000) {
            showToast(`Could not reach Gemini Live (code ${event.code}). Check your API key and network.`, "error", "warning");
        }
    };
}

export function disconnectGeminiLive() {
    stopMicCapture();
    flushPlayback();
    if (ws) {
        const socket = ws;
        ws = null;
        socket.close();
    }
}
