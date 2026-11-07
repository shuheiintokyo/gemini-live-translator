// Prepared Subtitles: reads ahead of the player, sends each stretch of the episode to
// Gemini and gets back timed sentence pairs, so each line can appear as it is spoken
// If a key can't use the newest Flash model this way, the previous one is tried instead
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash'];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const SAMPLE_RATE = 16000;
// Stretches are cut at the quietest moment in this range, so sentences rarely split
const CHUNK_SECONDS = { min: 24, max: 36 };
// Where nothing is ready yet (the start, or after a jump), a short stretch comes back sooner
const FIRST_CHUNK_SECONDS = { min: 8, max: 14 };
// A request that takes longer than this is treated as lost and sent again
const REQUEST_TIMEOUT_MS = 90000;
// How far ahead of the player to prepare; less wastes fewer requests if you skip around
const LOOKAHEAD_SECONDS = 180;
const RETRY_DELAYS_MS = [3000, 10000, 30000];
const IDLE_CHECK_MS = 1000;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Decodes the whole file once, straight to 16kHz mono, which is all Gemini needs
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

function findQuietCut(samples, start, limits) {
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

// Google's own error text, without the API key, short enough for the status line
function describeGoogleError(detail) {
    try {
        return JSON.parse(detail).error?.message?.split('\n')[0].slice(0, 160) || '';
    } catch {
        return '';
    }
}

async function requestSegments(apiKey, model, wavBase64, durationSeconds, targetLang, useThinkingLevel) {
    const generationConfig = { responseMimeType: 'application/json', temperature: 0.2 };
    // Less thinking answers faster; Gemini 3.8 Flash goes no lower than "low"
    if (useThinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: 'low' };

    const response = await fetch(`${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
        const error = new Error(`Gemini error ${response.status}${describeGoogleError(detail) ? `: ${describeGoogleError(detail)}` : ''}`);
        error.status = response.status;
        error.detail = detail;
        throw error;
    }
    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('');
    try {
        return parseSegments(text);
    } catch {
        const reason = data.candidates?.[0]?.finishReason;
        throw new Error(`Gemini's answer couldn't be read${reason ? ` (${reason})` : ''}`);
    }
}

export class SubtitlePreparer {
    // loadSamples returns the decoded episode, shared with Live mode so it's decoded once
    constructor({ apiKey, loadSamples, targetLang, getPlayhead, onCues, onLanguage, onStatus, onError }) {
        Object.assign(this, { apiKey, loadSamples, targetLang, getPlayhead, onCues, onLanguage, onStatus, onError });
        this.samples = null;
        this.ranges = [];
        this.stopped = false;
        this.useThinkingLevel = true;
        this.modelIndex = 0;
        this.lastError = '';
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
            this.samples = await this.loadSamples();
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
            const continuesPrepared = this.ranges.some(([, rangeEnd]) => Math.abs(rangeEnd - start) < 0.01);
            const endSample = findQuietCut(this.samples, startSample, continuesPrepared ? CHUNK_SECONDS : FIRST_CHUNK_SECONDS);
            const end = endSample / SAMPLE_RATE;
            this.onStatus(`Preparing subtitles: ${Math.round((start / duration) * 100)}% of the episode…`);

            const result = await this.requestWithRetries(this.samples.subarray(startSample, endSample), end - start);
            if (this.stopped) return;
            if (!result) {
                this.onError(`Prepared subtitles stopped. ${this.lastError}. Switch to Live mode, or try again later.`);
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
        let retries = 0;
        while (!this.stopped) {
            const model = MODELS[this.modelIndex];
            // Shows that something is happening while Gemini works on a stretch
            const startedAt = Date.now();
            const ticker = setInterval(() => {
                if (!this.stopped) this.onStatus(`Waiting for Gemini (${Math.round((Date.now() - startedAt) / 1000)} s)…`);
            }, 1000);
            try {
                return await requestSegments(this.apiKey, model, wav, durationSeconds, this.targetLang, this.useThinkingLevel);
            } catch (rawErr) {
                clearInterval(ticker);
                const err = rawErr.name === 'TimeoutError'
                    ? Object.assign(new Error(`Gemini didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds`), { status: 0 })
                    : rawErr;
                this.lastError = err.message;
                console.warn("Prepared subtitles request failed:", model, err.message, err.detail?.slice(0, 500));
                // Some models don't take the thinking setting, so drop it once and resend
                if (err.status === 400 && this.useThinkingLevel && /thinking/i.test(err.detail || '')) {
                    this.useThinkingLevel = false;
                    continue;
                }
                // Model not available for this key, or with no free quota at all ("limit: 0"):
                // try the next one
                const noFreeQuota = err.status === 429 && /limit:\s*0\b/.test(err.detail || '');
                if ((err.status === 404 || noFreeQuota) && this.modelIndex < MODELS.length - 1) {
                    this.modelIndex++;
                    this.useThinkingLevel = true;
                    this.onStatus(`${model} isn't available here. Trying ${MODELS[this.modelIndex]}…`);
                    continue;
                }
                // Wrong key, bad request or not allowed: retrying won't help
                if ([400, 401, 403, 404].includes(err.status)) return null;
                if (retries === RETRY_DELAYS_MS.length) return null;
                const delay = RETRY_DELAYS_MS[retries++];
                const googleReason = describeGoogleError(err.detail || '');
                const reason = err.status === 429
                    ? `Gemini's free-tier limit was reached${googleReason ? ` (${googleReason})` : ''}`
                    : err.message;
                this.onStatus(`${reason}. Retrying in ${delay / 1000} seconds…`);
                await wait(delay);
            } finally {
                clearInterval(ticker);
            }
        }
        return null;
    }
}
