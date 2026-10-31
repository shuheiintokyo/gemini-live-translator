// Audio Processing: Gapless PCM Player and Microphone Capture
const PLAYBACK_SAMPLE_RATE = 24000;

let playbackContext = null;
let nextPlayTime = 0;
let pendingByte = null;
let activeSources = new Set();
let micContext = null;
let micMediaStream = null;
let micProcessor = null;
let micGeneration = 0;

// Must run inside a click handler: browsers keep audio suspended until a user gesture
export function unlockPlayback() {
    if (!playbackContext) {
        playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: PLAYBACK_SAMPLE_RATE });
    }
    if (playbackContext.state === 'suspended') {
        playbackContext.resume();
    }
}

// Gapless PCM Audio Chunk Player for Gemini Live (24kHz standard)
export function playPcmChunk(base64Data) {
    try {
        unlockPlayback();

        // A chunk can end halfway through a 16-bit sample, so carry the spare byte over
        const binaryStr = atob(base64Data);
        const carry = pendingByte === null ? 0 : 1;
        const bytes = new Uint8Array(binaryStr.length + carry);
        if (carry) bytes[0] = pendingByte;
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i + carry] = binaryStr.charCodeAt(i);
        }
        const sampleCount = Math.floor(bytes.length / 2);
        pendingByte = bytes.length % 2 ? bytes[bytes.length - 1] : null;
        if (sampleCount === 0) return;

        const int16Array = new Int16Array(bytes.buffer, 0, sampleCount);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        const audioBuffer = playbackContext.createBuffer(1, float32Array.length, PLAYBACK_SAMPLE_RATE);
        audioBuffer.getChannelData(0).set(float32Array);

        const sourceNode = playbackContext.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(playbackContext.destination);
        sourceNode.onended = () => activeSources.delete(sourceNode);
        activeSources.add(sourceNode);

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

// Drops any queued speech, e.g. when the model is interrupted or the session stops
export function flushPlayback() {
    activeSources.forEach(sourceNode => sourceNode.stop());
    activeSources.clear();
    nextPlayTime = 0;
    pendingByte = null;
}

export function getPlaybackState() {
    return playbackContext?.state ?? 'none';
}

// Microphone Capture: 16kHz Mono PCM Audio Stream
export async function startMicCapture(onPcmChunkCallback, options = {}) {
    stopMicCapture();
    const generation = micGeneration;

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
    });

    // The session was stopped or restarted while the permission prompt was open
    if (generation !== micGeneration) {
        stream.getTracks().forEach(t => t.stop());
        return;
    }

    micMediaStream = stream;
    micContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    if (micContext.state === 'suspended') {
        await micContext.resume();
    }

    const source = micContext.createMediaStreamSource(micMediaStream);
    micProcessor = micContext.createScriptProcessor(2048, 1, 1);

    micProcessor.onaudioprocess = (e) => {
        if (options.isMuted?.()) return;

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
        onPcmChunkCallback(btoa(binary));
    };

    source.connect(micProcessor);
    micProcessor.connect(micContext.destination);
    console.log("Microphone streaming active (16kHz Mono PCM).");
}

export function stopMicCapture() {
    micGeneration++;
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
