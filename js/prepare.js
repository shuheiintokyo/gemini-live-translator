// Prepared Subtitles: reads ahead of the player, sends each stretch of the episode to
// Gemini and gets back timed sentence pairs, so each line can appear as it is spoken
const MODEL = 'gemini-3.8-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const SAMPLE_RATE = 16000;
// Stretches are cut at the quietest moment in this range, so sentences rarely split
const CHUNK_SECONDS = { min: 24, max: 36 };
// How far ahead of the player to prepare; less wastes fewer requests if you skip around
const LOOKAHEAD_SECONDS = 180;
const RETRY_DELAYS_MS = [3000, 10000, 30000];
const IDLE_CHECK_MS = 1000;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Decodes the whole file once, straight to 16kHz mono, which is all Gemini needs
async function decodeEpisode(file) {
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoded = await new OfflineContext(1, 1, SAMPLE_RATE).decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
        const channel = decoded.getChannelData(c);
        for (let i = 0; i < channel.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
    }
    return mono;
}

function findQuietCut(samples, start) {
    const maxEnd = start + CHUNK_SECONDS.max * SAMPLE_RATE;
    if (maxEnd >= samples.length) return samples.length;
    const windowSize = SAMPLE_RATE / 10;
    let best = start + CHUNK_SECONDS.min * SAMPLE_RATE;
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

function encodeWavBase64(samples) {
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
    // Built in slices, because one huge String.fromCharCode call overflows the stack
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function buildPrompt(durationSeconds, targetLang) {
    return `This audio is a ${durationSeconds.toFixed(1)}-second stretch of a podcast. Transcribe all speech and translate it into ${targetLang.name}.
Return only JSON in this shape:
{"language": "<BCP-47 code of the spoken language>", "segments": [{"start": <seconds from the start of this audio, one decimal>, "end": <seconds>, "original": "<the words exactly as spoken>", "translation": "<the same words in ${targetLang.name}>"}]}
Rules:
- One segment per sentence or short phrase, short enough for two lines of subtitles. Split long sentences at natural pauses.
- start and end must match when the words are actually spoken in this audio.
- Write the original in the language and script the speaker uses. For Chinese, use Simplified characters.
- Skip music, silence and noise. If there is no speech, return an empty segments list.
- If the speech is already in ${targetLang.name}, repeat it as the translation.
- The first and last sentence may be cut off. Transcribe what is audible.`;
}

function parseSegments(text) {
    const json = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const parsed = JSON.parse(json);
    const segments = Array.isArray(parsed) ? parsed : parsed.segments || [];
    return {
        language: Array.isArray(parsed) ? null : parsed.language || null,
        segments: segments.filter(s => s && typeof s.original === 'string' && Number.isFinite(Number(s.start)))
    };
}

async function requestSegments(apiKey, wavBase64, durationSeconds, targetLang, useThinkingLevel) {
    const generationConfig = { responseMimeType: 'application/json', temperature: 0.2 };
    // Less thinking answers faster; Gemini 3.8 Flash goes no lower than "low"
    if (useThinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: 'low' };

    const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [
                    { text: buildPrompt(durationSeconds, targetLang) },
                    { inlineData: { mimeType: 'audio/wav', data: wavBase64 } }
                ]
            }],
            generationConfig
        })
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(`Gemini returned ${response.status}`);
        error.status = response.status;
        error.detail = detail;
        throw error;
    }
    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('');
    return parseSegments(text);
}

export class SubtitlePreparer {
    constructor({ apiKey, file, targetLang, getPlayhead, onCues, onLanguage, onStatus, onError }) {
        Object.assign(this, { apiKey, file, targetLang, getPlayhead, onCues, onLanguage, onStatus, onError });
        this.samples = null;
        this.ranges = [];
        this.stopped = false;
        this.useThinkingLevel = true;
    }

    // True once the part of the episode at this time has been prepared
    isCovered(seconds) {
        return this.ranges.some(([start, end]) => seconds >= start && seconds < end);
    }

    stop() {
        this.stopped = true;
    }

    // The next stretch starts where the prepared part around the playhead ends,
    // or at the playhead itself after a jump into an unprepared part
    nextStart(playhead) {
        let position = playhead;
        let moved = true;
        while (moved) {
            moved = false;
            for (const [start, end] of this.ranges) {
                if (position >= start - 0.5 && position < end) {
                    position = end;
                    moved = true;
                }
            }
        }
        return position;
    }

    async run() {
        try {
            this.onStatus('Reading the episode…');
            this.samples = await decodeEpisode(this.file);
        } catch (err) {
            console.error("Could not decode the episode:", err);
            if (!this.stopped) this.onError("This episode couldn't be read for prepared subtitles. Switch to Live mode instead.");
            return;
        }
        const duration = this.samples.length / SAMPLE_RATE;

        while (!this.stopped) {
            const playhead = this.getPlayhead();
            const start = this.nextStart(playhead);
            if (start >= duration - 0.5 || start >= playhead + LOOKAHEAD_SECONDS) {
                await wait(IDLE_CHECK_MS);
                continue;
            }

            const startSample = Math.floor(start * SAMPLE_RATE);
            const endSample = findQuietCut(this.samples, startSample);
            const end = endSample / SAMPLE_RATE;
            this.onStatus(`Preparing subtitles: ${Math.round((start / duration) * 100)}% of the episode…`);

            const result = await this.requestWithRetries(this.samples.subarray(startSample, endSample), end - start);
            if (this.stopped) return;
            if (!result) {
                this.onError("Gemini couldn't prepare subtitles right now, possibly because of free-tier limits. Try again later, or switch to Live mode.");
                return;
            }

            if (result.language) this.onLanguage(result.language);
            const cues = result.segments.map(segment => ({
                start: start + Math.max(0, Number(segment.start)),
                end: start + Math.min(end - start, Math.max(Number(segment.end) || 0, Number(segment.start) + 1)),
                original: segment.original.trim(),
                translation: String(segment.translation || '').trim()
            }));
            this.ranges.push([start, end]);
            this.onCues(cues);
            this.onStatus('Subtitles ready for this part.');
        }
    }

    async requestWithRetries(samples, durationSeconds) {
        const wav = encodeWavBase64(samples);
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
            try {
                return await requestSegments(this.apiKey, wav, durationSeconds, this.targetLang, this.useThinkingLevel);
            } catch (err) {
                console.warn("Prepared subtitles request failed:", err.message, err.detail?.slice(0, 300));
                // An older or different model may not take the thinking setting, so drop it once
                if (err.status === 400 && this.useThinkingLevel && /thinking/i.test(err.detail || '')) {
                    this.useThinkingLevel = false;
                    attempt--;
                    continue;
                }
                if (err.status === 400 || err.status === 401 || err.status === 403) return null;
                if (this.stopped || attempt === RETRY_DELAYS_MS.length) return null;
                this.onStatus('Gemini is busy. Retrying…');
                await wait(RETRY_DELAYS_MS[attempt]);
            }
        }
        return null;
    }
}
