// Gemini Live Multimodal WebSocket Client
import { buildSystemInstruction } from './config.js';
import { playPcmChunk, startMicCapture, stopMicCapture } from './audio.js';

let ws = null;
let isConnecting = false;

export function isSessionConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
}

export async function connectGeminiLive({
    apiKey,
    model = 'models/gemini-2.0-flash-exp',
    sourceLang,
    targetLang,
    targetTone,
    isMuted = () => false,
    isPaused = () => false,
    onStatusChange,
    onIncomingText,
    onError,
    showToast
}) {
    if (!apiKey) {
        if (showToast) showToast("API Key is required to connect to Gemini Live.", "error", "key");
        return;
    }

    if (isSessionConnected()) {
        disconnectGeminiLive();
    }

    isConnecting = true;
    if (onStatusChange) onStatusChange('connecting');
    if (showToast) showToast(`Connecting to Gemini Live [${sourceLang.code} → ${targetLang.code}]...`, "purple", "sensors");

    const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    try {
        ws = new WebSocket(endpoint);
    } catch (err) {
        console.error("WebSocket connection failure:", err);
        isConnecting = false;
        if (onStatusChange) onStatusChange('disconnected');
        if (onError) onError(err);
        return;
    }

    ws.onopen = async () => {
        isConnecting = false;
        console.log("Gemini Live WebSocket connection established!");
        if (onStatusChange) onStatusChange('connected');

        // 1. Send Handshake Setup message with configured Language Matrix & System Instruction
        const setupMsg = {
            setup: {
                model: model,
                generationConfig: {
                    responseModalities: ["AUDIO", "TEXT"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: targetLang.voiceName || "Kore"
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{
                        text: buildSystemInstruction(sourceLang, targetLang, targetTone)
                    }]
                }
            }
        };

        ws.send(JSON.stringify(setupMsg));
        console.log("Sent setup instruction:", setupMsg.setup.systemInstruction.parts[0].text);

        // 2. Start Microphone capture and stream chunks over socket
        try {
            await startMicCapture((base64Audio) => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        realtimeInput: {
                            mediaChunks: [{
                                mimeType: "audio/pcm;rate=16000",
                                data: base64Audio
                            }]
                        }
                    }));
                }
            }, {
                isMuted: isMuted,
                isPaused: isPaused
            });

            if (showToast) {
                showToast(`Connected! Speak in ${sourceLang.name} to hear translation in ${targetLang.name}.`, "success", "record_voice_over");
            }
        } catch (micErr) {
            console.error("Microphone capture error:", micErr);
            if (showToast) showToast("Microphone access unavailable or denied.", "error", "mic_off");
        }
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.serverContent?.modelTurn?.parts) {
                data.serverContent.modelTurn.parts.forEach(part => {
                    // Play audio PCM stream if received
                    if (part.inlineData?.data) {
                        playPcmChunk(part.inlineData.data);
                    }
                    // Render translation text if received
                    if (part.text && onIncomingText) {
                        onIncomingText(part.text);
                    }
                });
            }
        } catch (e) {
            console.error("Failed to parse incoming WebSocket message:", e);
        }
    };

    ws.onerror = (err) => {
        console.error("Gemini WebSocket error:", err);
        if (onError) onError(err);
        if (showToast) showToast("WebSocket error occurred. Check API key and quota.", "error", "error");
    };

    ws.onclose = () => {
        console.log("Gemini WebSocket closed.");
        isConnecting = false;
        stopMicCapture();
        if (onStatusChange) onStatusChange('disconnected');
    };
}

export function disconnectGeminiLive() {
    stopMicCapture();
    if (ws) {
        ws.close();
        ws = null;
    }
}
