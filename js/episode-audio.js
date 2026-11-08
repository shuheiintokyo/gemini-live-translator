// Episode Audio: decodes an episode file once and cuts it into WAV pieces for the server
export const SAMPLE_RATE = 16000;

// Decodes the whole file once, straight to 16kHz mono, which is what Whisper and Gemini use
export async function decodeEpisode(file) {
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoded = await new OfflineContext(1, 1, SAMPLE_RATE).decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
        const channel = decoded.getChannelData(c);
        for (let i = 0; i < channel.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
    }
    return mono;
}

// Ends a piece at the quietest moment within the allowed range, so sentences rarely split
export function findQuietCut(samples, start, limits) {
    const maxEnd = start + limits.max * SAMPLE_RATE;
    if (maxEnd >= samples.length) return samples.length;
    const windowSize = SAMPLE_RATE / 10;
    let best = start + limits.min * SAMPLE_RATE;
    let bestEnergy = Infinity;
    for (let s = best; s + windowSize <= maxEnd; s += windowSize) {
        let energy = 0;
        for (let i = s; i < s + windowSize; i += 4) energy += samples[i] * samples[i];
        if (energy < bestEnergy) {
            bestEnergy = energy;
            best = s;
        }
    }
    return best + windowSize / 2;
}

export function encodeWav(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeText = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7FFF, true);
    }
    return buffer;
}
