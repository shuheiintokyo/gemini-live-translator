// Audio Processing: Gapless PCM Player, Microphone Capture, and Spectrum Visualizer
let playbackContext = null;
let nextPlayTime = 0;
let micContext = null;
let micMediaStream = null;
let micProcessor = null;

// Gapless PCM Audio Chunk Player for Gemini Live (24kHz standard)
export function playPcmChunk(base64Data, sampleRate = 24000) {
    try {
        if (!playbackContext) {
            playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sampleRate });
        }
        if (playbackContext.state === 'suspended') {
            playbackContext.resume();
        }

        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        const audioBuffer = playbackContext.createBuffer(1, float32Array.length, sampleRate);
        audioBuffer.getChannelData(0).set(float32Array);

        const sourceNode = playbackContext.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(playbackContext.destination);

        const currentTime = playbackContext.currentTime;
        if (nextPlayTime < currentTime) {
            nextPlayTime = currentTime;
        }
        sourceNode.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;
    } catch (err) {
        console.error("PCM Audio Playback error:", err);
    }
}

// Microphone Capture: 16kHz Mono PCM Audio Stream
export async function startMicCapture(onPcmChunkCallback, options = {}) {
    stopMicCapture();

    micContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    micMediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: options.noiseSuppression ?? true,
            autoGainControl: true
        }
    });

    const source = micContext.createMediaStreamSource(micMediaStream);
    micProcessor = micContext.createScriptProcessor(4096, 1, 1);

    micProcessor.onaudioprocess = (e) => {
        if (options.isMuted || options.isPaused) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }

        let binary = '';
        const bytes = new Uint8Array(pcm16.buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64Audio = btoa(binary);

        if (onPcmChunkCallback) {
            onPcmChunkCallback(base64Audio);
        }
    };

    source.connect(micProcessor);
    micProcessor.connect(micContext.destination);
    console.log("Microphone streaming active (16kHz Mono PCM).");
}

export function stopMicCapture() {
    if (micProcessor) {
        micProcessor.disconnect();
        micProcessor = null;
    }
    if (micContext) {
        micContext.close();
        micContext = null;
    }
    if (micMediaStream) {
        micMediaStream.getTracks().forEach(t => t.stop());
        micMediaStream = null;
    }
}

// Fallback Speech Synthesis Player
export function speakText(text, speechLang = 'ja-JP', options = {}) {
    if (!('speechSynthesis' in window)) return;

    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        if (options.onStop) options.onStop();
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    utterance.rate = 1.0;
    utterance.pitch = options.pitch || 1.0;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find(v => v.lang.startsWith(speechLang.slice(0, 2)));
    if (matchedVoice) utterance.voice = matchedVoice;

    if (options.onStart) options.onStart();
    utterance.onend = () => { if (options.onStop) options.onStop(); };
    utterance.onerror = () => { if (options.onStop) options.onStop(); };

    window.speechSynthesis.speak(utterance);
}

// Test Calibration Tone
export function generateCalibrationTone(frequency = 440, durationSec = 1.2) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + durationSec);
    } catch (e) {
        console.error("Audio calibration tone error:", e);
    }
}

// Spectrum Visualizer and Oscilloscope Animation Runner
export function initSpectrumVisualizer(options = {}) {
    const bars = document.querySelectorAll('.spectrum-bar');
    const oscPath = document.getElementById('oscilloscope-path');

    function animate() {
        if (!options.isMuted?.() && !options.isPaused?.()) {
            bars.forEach((bar, idx) => {
                const base = 4;
                const rand = Math.sin(Date.now() / 150 + idx) * 12 + Math.random() * 16;
                const height = Math.max(4, Math.min(36, Math.floor(base + rand)));
                bar.style.height = `${height}px`;
            });

            if (oscPath && Date.now() % 4 === 0) {
                const t = Date.now() / 200;
                const y1 = Math.floor(12 + Math.sin(t) * 9);
                const y2 = Math.floor(12 + Math.cos(t * 1.5) * 8);
                const y3 = Math.floor(12 + Math.sin(t * 2) * 10);
                oscPath.setAttribute('d', `M0 12 Q 15 ${y1}, 30 12 T 60 ${y2} T 80 ${y3} T 100 12`);
            }
        } else {
            bars.forEach(bar => { bar.style.height = '4px'; });
            if (oscPath) oscPath.setAttribute('d', 'M0 12 L 100 12');
        }
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}
