// Prepared Subtitles: reads ahead of the player, sends each stretch of the episode to
// Gemini and gets back timed sentence pairs, so each line can appear as it is spoken
// Best first. When one model isn't available or its free quota runs out, the next is used
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
// Less thinking answers faster, and transcribing needs little. Each model's lowest level:
// Gemini 3.8 Flash goes no lower than "low"
const THINKING_LEVELS = { 'gemini-3.8-flash': 'low', 'gemini-3.6-flash': 'minimal', 'gemini-3.5-flash-lite': 'minimal' };
// Two stretches are prepared at once, so preparation pulls ahead of playback faster
const CONCURRENT_REQUESTS = 2;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const SAMPLE_RATE = 16000;
// Stretches are cut at the quietest moment in this range, so sentences rarely split
const CHUNK_SECONDS = { min: 24, max: 36 };
// Where nothing is ready yet (the start, or after a jump), a short stretch comes back sooner
const FIRST_CHUNK_SECONDS = { min: 8, max: 14 };
// A request that takes longer than this is treated as lost and sent again
const REQUEST_TIMEOUT_MS = 90000;
const RETRY_DELAYS_MS = [3000, 10000, 30000];
// A model that's overloaded ("high demand") is skipped for this long, then tried again
const OVERLOAD_COOLDOWN_MS = 2 * 60 * 1000;
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
    if (useThinkingLevel && THINKING_LEVELS[model]) generationConfig.thinkingConfig = { thinkingLevel: THINKING_LEVELS[model] };

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
        // Stretches sent to Gemini and not yet answered, so two requests never overlap
        this.pending = [];
        this.stopped = false;
        this.useThinkingLevel = true;
        // Models that can't be used for this episode (missing, or free quota used up)
        this.unusable = new Set();
        // Models that were overloaded, and when they may be tried again
        this.coolingUntil = new Map();
        this.lastError = '';
        this.duration = 0;
    }

    // The best model that isn't ruled out or cooling down; if all usable ones are cooling,
    // the best usable one, since waiting is the only option left
    get model() {
        const usable = MODELS.filter(m => !this.unusable.has(m));
        return usable.find(m => (this.coolingUntil.get(m) || 0) <= Date.now()) || usable[0] || null;
    }

    // Seconds prepared without a break from this time on (the whole rest at the very end)
    bufferedAhead(seconds) {
        if (!this.duration) return 0;
        const end = this.nextStart(seconds);
        return end >= this.duration - 0.5 ? Infinity : end - seconds;
    }

    preparedFraction() {
        if (!this.duration) return 0;
        const total = this.ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
        return Math.min(total / this.duration, 1);
    }

    // True once the part of the episode at this time has been prepared
    isCovered(seconds) {
        return this.ranges.some(([start, end]) => seconds >= start && seconds < end);
    }

    stop() {
        this.stopped = true;
    }

    // The next stretch starts where the prepared part around the playhead ends,
    // or at the playhead itself after a jump into an unprepared part.
    // With includePending, stretches still being prepared count as taken
    nextStart(playhead, includePending = false) {
        const taken = includePending ? [...this.ranges, ...this.pending] : this.ranges;
        let position = playhead;
        let moved = true;
        while (moved) {
            moved = false;
            for (const [start, end] of taken) {
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
        this.duration = duration;

        // Prepares the whole episode: onward from where you're listening first, then
        // any part skipped over earlier
        await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, () => this.work(duration)));
    }

    async work(duration) {
        while (!this.stopped) {
            let start = this.nextStart(this.getPlayhead(), true);
            if (start >= duration - 0.5) start = this.nextStart(0, true);
            if (start >= duration - 0.5) {
                if (!this.pending.length) this.onStatus('All subtitles are ready.');
                await wait(IDLE_CHECK_MS);
                continue;
            }

            const startSample = Math.floor(start * SAMPLE_RATE);
            const continuesPrepared = [...this.ranges, ...this.pending].some(([, rangeEnd]) => Math.abs(rangeEnd - start) < 0.01);
            const endSample = findQuietCut(this.samples, startSample, continuesPrepared ? CHUNK_SECONDS : FIRST_CHUNK_SECONDS);
            const end = endSample / SAMPLE_RATE;
            // Claimed before the request goes out, so the other worker picks the next stretch
            const claim = [start, end];
            this.pending.push(claim);
            this.onStatus(`Preparing subtitles with ${this.model}: ${Math.round(this.preparedFraction() * 100)}% ready…`);

            const result = await this.requestWithRetries(this.samples.subarray(startSample, endSample), end - start);
            this.pending = this.pending.filter(item => item !== claim);
            if (this.stopped) return;
            if (!result) {
                this.stopped = true;
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
            this.ranges.push(claim);
            this.onCues(cues);
        }
    }

    async requestWithRetries(samples, durationSeconds) {
        const wav = encodeWavBase64(samples);
        let retries = 0;
        while (!this.stopped) {
            const model = this.model;
            if (!model) return null;
            // Shows that something is happening while Gemini works on a stretch
            const startedAt = Date.now();
            const ticker = setInterval(() => {
                if (!this.stopped) this.onStatus(`Waiting for ${model} (${Math.round((Date.now() - startedAt) / 1000)} s)…`);
            }, 1000);
            try {
                return await requestSegments(this.apiKey, model, wav, durationSeconds, this.targetLang, this.useThinkingLevel);
            } catch (rawErr) {
                clearInterval(ticker);
                const err = rawErr.name === 'TimeoutError'
                    ? Object.assign(new Error(`${model} didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds`), { status: 0 })
                    : rawErr;
                this.lastError = err.message.replace(/\.+$/, '');
                console.warn("Prepared subtitles request failed:", model, err.message, err.detail?.slice(0, 500));

                // Some models don't take the thinking setting, so drop it once and resend
                if (err.status === 400 && this.useThinkingLevel && /thinking/i.test(err.detail || '')) {
                    this.useThinkingLevel = false;
                    continue;
                }

                // Missing model, no free quota at all ("limit: 0"), the day's free quota used
                // up, or still refused after every retry: don't use this model again
                const quotaGone = err.status === 429 && /limit:\s*0\b|per ?day|PerDay|daily/i.test(err.detail || '');
                const stillLimited = err.status === 429 && retries === RETRY_DELAYS_MS.length;
                if (err.status === 404 || quotaGone || stillLimited) {
                    this.unusable.add(model);
                    retries = 0;
                    if (!this.model) return null;
                    this.onStatus(err.status === 404
                        ? `${model} isn't available here. Switching to ${this.model}…`
                        : `${model}'s free limit is used up. Switching to ${this.model}…`);
                    continue;
                }

                // Wrong key, bad request or not allowed: retrying won't help
                if ([400, 401, 403].includes(err.status)) return null;

                // Overloaded, a server error or no answer: rest this model and use another
                // straight away, coming back to it after the cool-down
                const isOverloaded = err.status === 0 || err.status >= 500;
                if (isOverloaded) {
                    this.coolingUntil.set(model, Date.now() + OVERLOAD_COOLDOWN_MS);
                    const next = this.model;
                    if (next && next !== model) {
                        this.onStatus(`${model} is busy at Google. Using ${next} for now…`);
                        continue;
                    }
                }

                if (retries === RETRY_DELAYS_MS.length) return null;
                const delay = RETRY_DELAYS_MS[retries++];
                const googleReason = describeGoogleError(err.detail || '').replace(/\.+$/, '');
                const reason = err.status === 429
                    ? `Gemini's free-tier limit was reached${googleReason ? ` (${googleReason})` : ''}`
                    : this.lastError;
                this.onStatus(`${reason}. Retrying in ${delay / 1000} seconds…`);
                await wait(delay);
            } finally {
                clearInterval(ticker);
            }
        }
        return null;
    }
}
