// File Subtitles: transcribes an episode file with Groq Whisper, then translates the
// lines with Gemini's regular API. The browser calls both directly with the keys saved
// on this device. Pieces are processed from where you're listening until the episode is done
import { SAMPLE_RATE, encodeWav, findQuietCut } from './episode-audio.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
// Choices shown on the Podcast page. Groq lists v3 with fewer errors (10.3% vs 12%)
// and turbo as faster and cheaper, and recommends turbo for multilingual use
export const WHISPER_MODELS = [
    { id: 'whisper-large-v3-turbo', label: 'Fast · Whisper v3 Turbo' },
    { id: 'whisper-large-v3', label: 'More accurate · Whisper v3' }
];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Fast first. Translating text needs little reasoning, so each uses its lowest thinking
// level; if one is overloaded or out of free quota, the next one is tried
export const TRANSLATION_MODELS = [
    { id: 'gemini-3.6-flash', thinkingLevel: 'minimal', label: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal', label: 'Gemini 3.5 Flash-Lite · fastest' },
    { id: 'gemini-3.8-flash', thinkingLevel: 'low', label: 'Gemini 3.8 Flash · newest' }
];
// "auto" tries the models above in order; any other value uses only that model
export const AUTO_TRANSLATION = 'auto';
const REQUEST_TIMEOUT_MS = 90000;

// About 4 minutes per piece: 16kHz mono WAV is 32 KB a second, so a piece is under 8 MB,
// well inside Groq's 25 MB free-tier limit. The first piece is short so playback starts sooner
const PIECE_SECONDS = { min: 200, max: 240 };
const FIRST_PIECE_SECONDS = { min: 20, max: 30 };
// Groq's free tier allows about 20 transcriptions a minute, so pieces start at least this
// far apart and the limit isn't hit in the first place
const MIN_GAP_BETWEEN_PIECES_MS = 3200;
// Longer waits than this stop processing with a message instead of waiting silently
const MAX_RATE_LIMIT_WAIT_SECONDS = 90;
const MAX_ATTEMPTS = 4;
const IDLE_CHECK_MS = 1000;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

class ServiceError extends Error {
    constructor(status, message, retryAfter = null) {
        super(message || `Request failed (${status})`);
        Object.assign(this, { status, retryAfter });
    }
}

// A provider's own error text, short enough for the status line
async function providerMessage(response) {
    try {
        const parsed = await response.json();
        return String(parsed.error?.message || parsed.message || '').split('\n')[0].slice(0, 200);
    } catch {
        return '';
    }
}

async function transcribeWithGroq(apiKey, wavBuffer, model) {
    const form = new FormData();
    form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'piece.wav');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('temperature', '0');
    const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
        // Groq's retry-after header may not be readable from a browser, so it's optional
        throw new ServiceError(response.status, await providerMessage(response), Number(response.headers.get('retry-after')) || null);
    }
    const data = await response.json();
    return {
        // Groq doesn't document a language field, so it's only used when present
        language: data.language || null,
        segments: (data.segments || [])
            .map(segment => ({ start: Number(segment.start), end: Number(segment.end), text: String(segment.text || '').trim() }))
            .filter(segment => segment.text && Number.isFinite(segment.start))
    };
}

function buildTranslationPrompt(lines, targetLanguage, sourceLanguage) {
    return `Translate these subtitle lines${sourceLanguage ? ` from ${sourceLanguage}` : ''} into ${targetLanguage}.
They are consecutive lines from one podcast, so use the surrounding lines for context.
Translate each line on its own, keeping its meaning and a natural subtitle style. Keep names, numbers and amounts exact.
If a line is already in ${targetLanguage}, repeat it unchanged.
Return only JSON in this shape: {"translations": [{"id": <the line's id>, "text": "<translation>"}]}, one entry per line, in the same order.

Lines:
${JSON.stringify(lines)}`;
}

async function translateWithGemini(apiKey, lines, targetLanguage, sourceLanguage, modelChoice) {
    const models = modelChoice === AUTO_TRANSLATION
        ? TRANSLATION_MODELS
        : TRANSLATION_MODELS.filter(model => model.id === modelChoice);
    let lastError = null;
    for (const model of models) {
        try {
            const response = await fetch(`${GEMINI_API_BASE}/${model.id}:generateContent?key=${encodeURIComponent(apiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: buildTranslationPrompt(lines, targetLanguage, sourceLanguage) }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.2,
                        thinkingConfig: { thinkingLevel: model.thinkingLevel }
                    }
                })
            });
            if (!response.ok) throw new ServiceError(response.status, await providerMessage(response));
            const data = await response.json();
            const text = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('');
            const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
            return (Array.isArray(parsed) ? parsed : parsed.translations || [])
                .map(item => ({ id: Number(item.id), text: String(item.text || '').trim() }));
        } catch (err) {
            lastError = err;
            console.warn('Translation failed:', model.id, err.status || err.name, err.message);
            // A wrong key or rejected request won't work with another model either
            if ([400, 401, 403].includes(err.status)) break;
        }
    }
    throw lastError;
}

export class FileSubtitlePipeline {
    // savedRanges are parts already done earlier (kept on this device), which are skipped
    constructor({ groqKey, geminiKey, whisperModel, translationModel, loadSamples, targetLang, getPlayhead, onCues, onLanguage, onStatus, onTiming, onError, savedRanges = [] }) {
        Object.assign(this, { groqKey, geminiKey, whisperModel, translationModel, loadSamples, targetLang, getPlayhead, onCues, onLanguage, onStatus, onTiming, onError });
        this.ranges = savedRanges.map(range => [...range]);
        this.stopped = false;
        this.duration = 0;
        this.sourceLanguage = '';
        this.lastPieceStartedAt = 0;
        // Processing time, so this method can be compared with the old live one
        this.timing = { audioSeconds: 0, transcribeMs: 0, translateMs: 0, startedAt: 0, reported: false };
    }

    stop() {
        this.stopped = true;
    }

    // Seconds ready without a break from this time on (the whole rest at the very end)
    bufferedAhead(seconds) {
        if (!this.duration) return 0;
        const end = this.nextStart(seconds);
        return end >= this.duration - 0.5 ? Infinity : end - seconds;
    }

    preparedFraction() {
        if (!this.duration) return 0;
        return Math.min(this.ranges.reduce((sum, [start, end]) => sum + (end - start), 0) / this.duration, 1);
    }

    nextStart(position) {
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
        let samples;
        try {
            this.onStatus('Reading the episode…');
            samples = await this.loadSamples();
        } catch (err) {
            console.error("Could not decode the episode:", err);
            if (!this.stopped) this.onError("This episode couldn't be read. Switch to Live mode instead.");
            return;
        }
        this.duration = samples.length / SAMPLE_RATE;
        this.timing.startedAt = performance.now();

        while (!this.stopped) {
            // Onward from where you're listening first, then any part skipped earlier
            let start = this.nextStart(this.getPlayhead());
            if (start >= this.duration - 0.5) start = this.nextStart(0);
            if (start >= this.duration - 0.5) {
                this.reportFinished();
                await wait(IDLE_CHECK_MS);
                continue;
            }

            const startSample = Math.floor(start * SAMPLE_RATE);
            const continuesDone = this.ranges.some(([, end]) => Math.abs(end - start) < 0.01);
            const endSample = findQuietCut(samples, startSample, continuesDone ? PIECE_SECONDS : FIRST_PIECE_SECONDS);
            const end = endSample / SAMPLE_RATE;

            const ok = await this.processPiece(samples.subarray(startSample, endSample), start, end);
            if (!ok || this.stopped) return;
        }
    }

    async processPiece(pieceSamples, start, end) {
        const percent = Math.round(this.preparedFraction() * 100);
        const sinceLast = performance.now() - this.lastPieceStartedAt;
        if (sinceLast < MIN_GAP_BETWEEN_PIECES_MS) await wait(MIN_GAP_BETWEEN_PIECES_MS - sinceLast);
        this.lastPieceStartedAt = performance.now();

        this.onStatus(`Transcribing ${formatDuration(start)}–${formatDuration(end)} with ${this.whisperModel} (${percent}% done)…`);
        const transcribeStarted = performance.now();
        const wav = encodeWav(pieceSamples);
        const transcript = await this.callWithRetries('Groq', () => transcribeWithGroq(this.groqKey, wav, this.whisperModel));
        if (!transcript) return false;
        this.timing.transcribeMs += performance.now() - transcribeStarted;
        if (transcript.language && !this.sourceLanguage) {
            this.sourceLanguage = transcript.language;
            this.onLanguage(transcript.language);
        }

        const lines = transcript.segments.map((segment, id) => ({ id, text: segment.text }));
        let translations = new Map();
        if (lines.length) {
            this.onStatus(`Translating ${lines.length} lines with Gemini (${percent}% done)…`);
            const translateStarted = performance.now();
            const translated = await this.callWithRetries('Gemini', () => translateWithGemini(this.geminiKey, lines, this.targetLang.name, this.sourceLanguage, this.translationModel));
            if (!translated) return false;
            this.timing.translateMs += performance.now() - translateStarted;
            translations = new Map(translated.map(item => [item.id, item.text]));
        }

        // Whisper sometimes gives a time just past the end of the piece; keeping each line
        // inside its piece stops it overlapping the next piece's lines
        const pieceLength = end - start;
        const cues = transcript.segments.map((segment, id) => ({
            start: start + Math.min(Math.max(0, segment.start), pieceLength - 0.5),
            end: start + Math.min(pieceLength, Math.max(segment.end, segment.start + 0.5)),
            original: segment.text,
            translation: translations.get(id) || ''
        }));
        this.ranges.push([start, end]);
        this.timing.audioSeconds += end - start;
        this.onCues(cues);
        this.reportTiming();
        return true;
    }

    async callWithRetries(service, request) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.stopped; attempt++) {
            try {
                return await request();
            } catch (err) {
                console.warn(`${service} request failed:`, err.status, err.message);
                // A wrong key or rejected request: waiting won't help
                if ([401, 403].includes(err.status)) {
                    this.onError(`Your ${service} API key was refused (${err.message}). Check it under "API keys" on the left.`);
                    return null;
                }
                if ([400, 404, 413].includes(err.status)) {
                    this.onError(`${service}: ${err.message}`);
                    return null;
                }
                if (err.status === 429) {
                    const waitSeconds = err.retryAfter || 20 * attempt;
                    if (waitSeconds > MAX_RATE_LIMIT_WAIT_SECONDS || attempt === MAX_ATTEMPTS) {
                        this.onError(`${service}'s free-tier limit was reached (${err.message || 'too many requests'}). Try again later, or switch to Live mode.`);
                        return null;
                    }
                    await this.countdown(waitSeconds, `${service}'s free-tier limit was reached (${err.message || 'too many requests'}).`);
                    continue;
                }
                const reason = err.name === 'TimeoutError' ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds` : err.message;
                if (attempt === MAX_ATTEMPTS) {
                    this.onError(`${service} failed (${reason}). Try again later, or switch to Live mode.`);
                    return null;
                }
                await this.countdown(3 * attempt, `${service} failed (${reason}).`);
            }
        }
        return null;
    }

    async countdown(seconds, reason) {
        for (let left = Math.ceil(seconds); left > 0 && !this.stopped; left--) {
            this.onStatus(`${reason} Trying again in ${left} s…`);
            await wait(1000);
        }
    }

    reportTiming() {
        const { audioSeconds, transcribeMs, translateMs, startedAt } = this.timing;
        const elapsed = (performance.now() - startedAt) / 1000;
        const speed = elapsed > 0 ? Math.round(audioSeconds / elapsed) : 0;
        this.onTiming(`Processed ${formatDuration(audioSeconds)} of audio in ${formatDuration(elapsed)} (${speed}× faster than real time). `
            + `Transcription ${formatDuration(transcribeMs / 1000)} · translation ${formatDuration(translateMs / 1000)}.`);
    }

    reportFinished() {
        if (this.timing.reported) return;
        this.timing.reported = true;
        const elapsed = (performance.now() - this.timing.startedAt) / 1000;
        this.onStatus('Subtitles are ready for the whole episode.');
        if (this.timing.audioSeconds > 0) {
            const speed = Math.round(this.timing.audioSeconds / Math.max(elapsed, 1));
            this.onTiming(`Whole episode done: ${formatDuration(this.timing.audioSeconds)} of audio processed in ${formatDuration(elapsed)} (${speed}× faster than real time). `
                + `Live mode needs the full ${formatDuration(this.duration)}, since it works as the audio plays.`);
        }
    }
}
