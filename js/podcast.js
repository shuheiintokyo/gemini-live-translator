// Podcast Subtitles: plays an episode file and shows live subtitles from Gemini
import { SUPPORTED_LANGUAGES, LIVE_MODELS, getLanguageByCode, getTranslationLanguageCode } from './config.js';
import { startElementCapture } from './audio.js';
import { connectGeminiLive, disconnectGeminiLive, isSessionActive } from './websocket.js';
import { decodeEpisode } from './episode-audio.js';
import { FileSubtitlePipeline } from './file-subtitles.js';
import { deleteSavedSubtitles, loadSavedSubtitles, saveSubtitles, subtitleCacheKey } from './subtitle-cache.js';

// Live Translate transcribes and translates continuously, which suits long talk
const SUBTITLE_MODEL = LIVE_MODELS.find(m => m.isTranslateModel);
const AUDIO_FILE = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;
const MAX_TAG_BYTES = 8 * 1048576;
// A prepared line stays up this long after its end time, unless the next one starts
const CUE_HOLD_SECONDS = 1.2;
// Playback waits until this much is prepared ahead, and pauses again if it gets this close
const START_BUFFER_SECONDS = 8;
const STALL_BUFFER_SECONDS = 1.5;
// After playback had to stop, it waits for more, so it doesn't stop again moments later
const RESUME_BUFFER_SECONDS = 30;
// Long sentences are cut into subtitle-sized lines, about two TV lines each
// (TV styles use roughly 42 Latin characters per line, fewer for Chinese or Japanese)
const MAX_LINE_LENGTH = { spaced: 84, unspaced: 32 };

const state = {
    apiKey: localStorage.getItem('gemini_api_key') || '',
    // Prepared mode transcribes with Groq; like the Gemini key, it's saved on this device only
    groqKey: localStorage.getItem('groq_api_key') || '',
    targetLang: getLanguageByCode(localStorage.getItem('gemini_podcast_lang') || localStorage.getItem('gemini_source_lang') || 'EN-US'),
    detectedLang: null,
    episodes: [],
    currentUrl: null,
    episodeName: '',
    lines: [],
    buffers: { original: '', translation: '' },
    focus: localStorage.getItem('gemini_podcast_focus') === 'original' ? 'original' : 'translation',
    // Prepared reads ahead of the player and times each line; Live follows the audio as it plays
    mode: localStorage.getItem('gemini_podcast_mode') === 'live' ? 'live' : 'prepared',
    episodeFile: null,
    samplesFile: null,
    samplesPromise: null,
    preparer: null,
    cues: [],
    shownCue: -1,
    // Playback is held, like video buffering, until subtitles catch up
    isBuffering: false,
    resumeBuffer: START_BUFFER_SECONDS,
    bufferStart: { original: 0, translation: 0 }
};

const audioEl = document.getElementById('episode-audio');
const $ = (id) => document.getElementById(id);

function showToast(message, type = 'info', icon = 'info') {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto flex items-center gap-space-xs px-space-md py-2.5 rounded-2xl bg-surface-container-high/95 backdrop-blur-xl border border-white/[0.12] text-on-surface shadow-2xl font-body-sm text-body-sm max-w-sm';
    const iconEl = document.createElement('span');
    iconEl.className = `material-symbols-outlined text-[18px] ${type === 'error' ? 'text-error' : 'text-secondary'} font-bold`;
    iconEl.textContent = icon;
    const textEl = document.createElement('span');
    textEl.textContent = message;
    toast.append(iconEl, textEl);
    container.appendChild(toast);
    setTimeout(() => toast.remove(), type === 'error' ? 9000 : 3200);
}

// -----------------------------------------------------------------------------
// Episode titles from ID3 tags (Apple Podcasts names its files by ID only)
// -----------------------------------------------------------------------------
function decodeId3Text(bytes) {
    const encoding = bytes[0];
    const body = bytes.subarray(1);
    const label = { 0: 'latin1', 1: 'utf-16', 2: 'utf-16be', 3: 'utf-8' }[encoding] || 'latin1';
    return new TextDecoder(label).decode(body).replace(/\u0000/g, '').trim();
}

async function readEpisodeTags(file) {
    try {
        const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
        if (String.fromCharCode(header[0], header[1], header[2]) !== 'ID3') return {};
        const version = header[3];
        const tagSize = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9];
        // Cover art can come before the title, so read the whole tag (capped for safety)
        const head = new Uint8Array(await file.slice(0, Math.min(10 + tagSize, MAX_TAG_BYTES)).arrayBuffer());
        const tags = {};
        let i = 10;
        while (i + 10 < Math.min(10 + tagSize, head.length)) {
            const id = String.fromCharCode(head[i], head[i + 1], head[i + 2], head[i + 3]);
            if (!/^[A-Z0-9]{4}$/.test(id)) break;
            // ID3v2.4 stores frame sizes as "syncsafe" 7-bit bytes, v2.3 as plain integers
            const size = version === 4
                ? (head[i + 4] << 21) | (head[i + 5] << 14) | (head[i + 6] << 7) | head[i + 7]
                : ((head[i + 4] << 24) | (head[i + 5] << 16) | (head[i + 6] << 8) | head[i + 7]) >>> 0;
            if (id === 'TIT2') tags.title = decodeId3Text(head.subarray(i + 10, i + 10 + size));
            if (id === 'TALB') tags.show = decodeId3Text(head.subarray(i + 10, i + 10 + size));
            i += 10 + size;
        }
        return tags;
    } catch {
        return {};
    }
}

async function loadEpisodes(fileList) {
    const files = [...fileList].filter(f => AUDIO_FILE.test(f.name));
    if (!files.length) {
        showToast("No audio files found there.", "error", "folder_off");
        return;
    }
    const episodes = await Promise.all(files.map(async (file) => {
        const tags = await readEpisodeTags(file);
        // Apple keeps most titles in its own library, so untagged files there only have an ID
        const isIdOnly = /^[0-9A-F]{8}-[0-9A-F-]{27}\./i.test(file.name);
        const fallback = isIdOnly ? `Untitled episode (${new Date(file.lastModified).toLocaleString()})` : file.name;
        return { file, title: tags.title || fallback, show: tags.show || '' };
    }));
    state.episodes = episodes.sort((a, b) => b.file.lastModified - a.file.lastModified);
    // The help has done its job once something is loaded
    $('podcast-help').open = false;
    renderEpisodes();
    if (state.episodes.length === 1) selectEpisode(state.episodes[0]);
}

function renderEpisodes() {
    const list = $('episode-list');
    list.innerHTML = '';
    $('episode-empty').classList.toggle('hidden', state.episodes.length > 0);
    state.episodes.forEach(episode => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'flex flex-col items-start gap-0.5 p-space-sm rounded-xl text-left bg-surface-container-high/70 hover:bg-surface-variant border border-white/[0.04] cursor-pointer';
        const title = document.createElement('span');
        title.className = 'text-body-sm font-bold text-on-surface line-clamp-2';
        title.textContent = episode.title;
        const meta = document.createElement('span');
        meta.className = 'text-[11px] text-on-surface-variant';
        const date = new Date(episode.file.lastModified).toLocaleDateString();
        meta.textContent = [episode.show, date, `${Math.round(episode.file.size / 1048576)} MB`].filter(Boolean).join(' · ');
        btn.append(title, meta);
        btn.addEventListener('click', () => selectEpisode(episode));
        list.appendChild(btn);
    });
}

function selectEpisode(episode) {
    disconnectGeminiLive();
    stopPrepared();
    if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
    state.currentUrl = URL.createObjectURL(episode.file);
    state.episodeFile = episode.file;
    state.episodeName = episode.title;
    audioEl.src = state.currentUrl;
    $('episode-title').textContent = episode.title;
    $('episode-show').textContent = episode.show;
    clearTranscript();
    // Preparing starts straight away, so the first lines are ready by the time you press play
    if (state.mode === 'prepared') startPrepared();
    else setStatus('Press play to start subtitles. They follow the audio a few seconds behind.');
}

// -----------------------------------------------------------------------------
// Subtitles
// -----------------------------------------------------------------------------
function setStatus(text) {
    $('sub-status').textContent = text;
}

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Splits finished sentences off the stream; the unfinished rest stays buffered
function takeSentences(text) {
    const done = [];
    let rest = text;
    let match;
    while ((match = /[.!?](?=\s)|[。！？]/.exec(rest))) {
        const end = match.index + 1;
        const sentence = rest.slice(0, end).trim();
        if (sentence) done.push(sentence);
        rest = rest.slice(end);
    }
    const isSpaced = /\s/.test(rest.trim());
    const limit = isSpaced ? MAX_LINE_LENGTH.spaced : MAX_LINE_LENGTH.unspaced;
    while (rest.trim().length > limit) {
        // Prefer a comma as the break, then a space, so lines split where people pause
        const head = rest.slice(0, limit);
        const comma = Math.max(head.lastIndexOf(','), head.lastIndexOf('，'), head.lastIndexOf('、'));
        const space = head.lastIndexOf(' ');
        const cut = comma > limit / 3 ? comma + 1 : (isSpaced && space > 0 ? space : limit);
        done.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut);
    }
    return { done, rest };
}

function addLine(kind, text, time) {
    state.lines.push({ kind, text, time });
    const row = document.createElement('div');
    row.className = kind === 'original'
        ? 'grid grid-cols-[3.5rem_1fr] gap-space-sm px-space-sm pt-space-sm text-body-sm text-on-surface-variant'
        : 'grid grid-cols-[3.5rem_1fr] gap-space-sm px-space-sm pb-space-sm text-body-md text-on-surface border-b border-white/[0.04]';
    const timeEl = document.createElement('span');
    timeEl.className = 'font-telemetry-data text-[11px] text-outline pt-0.5';
    timeEl.textContent = kind === 'original' ? formatTime(time) : '';
    const textEl = document.createElement('span');
    textEl.textContent = text;
    row.append(timeEl, textEl);
    $('transcript-rows').appendChild(row);
    $('transcript-empty').classList.add('hidden');
}

function onSubtitleText(kind, text) {
    if (!state.buffers[kind].trim()) state.bufferStart[kind] = audioEl.currentTime;
    state.buffers[kind] += text;
    const { done, rest } = takeSentences(state.buffers[kind]);
    done.forEach(sentence => addLine(kind, sentence, state.bufferStart[kind]));
    if (done.length) state.bufferStart[kind] = audioEl.currentTime;
    state.buffers[kind] = rest;

    // Roll-up: a finished line moves up and fades while the next one grows below it
    const id = kind === 'original' ? 'sub-original' : 'sub-translation';
    if (done.length) $(`${id}-prev`).textContent = done.at(-1);
    $(id).textContent = rest.trim();
}

function applyFocus() {
    localStorage.setItem('gemini_podcast_focus', state.focus);
    $('sub-original-block').classList.toggle('is-focus', state.focus === 'original');
    $('sub-translation-block').classList.toggle('is-focus', state.focus === 'translation');
    document.querySelectorAll('.btn-focus-pill').forEach(btn => {
        const isSelected = btn.getAttribute('data-focus') === state.focus;
        btn.setAttribute('aria-checked', String(isSelected));
        btn.setAttribute('role', 'radio');
        btn.className = `btn-focus-pill px-3 py-1 rounded-lg text-label-sm transition-all cursor-pointer ${isSelected
            ? 'bg-primary-container text-on-primary-container font-bold'
            : 'text-on-surface-variant hover:text-on-surface'}`;
    });
}

function flushSubtitleBuffers() {
    ['original', 'translation'].forEach(kind => {
        const text = state.buffers[kind].trim();
        const id = kind === 'original' ? 'sub-original' : 'sub-translation';
        if (text) {
            addLine(kind, text, state.bufferStart[kind]);
            $(`${id}-prev`).textContent = text;
            $(id).textContent = '';
        }
        state.buffers[kind] = '';
    });
}

// Live Translate reports codes like "ko-KR"; Whisper may report names like "korean"
function applyDetectedLanguage(code) {
    const lower = code.toLowerCase();
    const primary = lower.split('-')[0];
    const match = SUPPORTED_LANGUAGES.find(lang => getTranslationLanguageCode(lang).split('-')[0].toLowerCase() === primary)
        || (lower.length > 3 && SUPPORTED_LANGUAGES.find(lang => lang.name.toLowerCase().startsWith(lower)));
    const name = match ? match.name : code;
    if (state.detectedLang === name) return;
    state.detectedLang = name;
    if (state.mode === 'prepared') showPreparedStatus();
    else setStatus(`Speech detected: ${name}. Subtitles in ${state.targetLang.name}.`);
}

function clearTranscript() {
    state.lines = [];
    state.cues = [];
    state.shownCue = -1;
    state.buffers = { original: '', translation: '' };
    state.detectedLang = null;
    $('transcript-rows').innerHTML = '';
    $('transcript-empty').classList.remove('hidden');
    ['sub-original', 'sub-original-prev', 'sub-translation', 'sub-translation-prev'].forEach(id => { $(id).textContent = ''; });
}

// Keeps the screen on while subtitles run, since a sleeping phone stops the audio.
// Older browsers have no Wake Lock, so this is best effort
let wakeLock = null;

async function updateWakeLock() {
    const wanted = !audioEl.paused && document.visibilityState === 'visible';
    if (wanted && !wakeLock && 'wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        } catch (err) {
            console.warn("Could not keep the screen on:", err.name);
        }
    } else if (!wanted && wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

// Both modes read the same decoded copy of the episode, so it's decoded only once
function getEpisodeSamples() {
    if (state.samplesFile !== state.episodeFile) {
        state.samplesFile = state.episodeFile;
        state.samplesPromise = decodeEpisode(state.episodeFile);
    }
    return state.samplesPromise;
}

// -----------------------------------------------------------------------------
// Prepared mode: timed lines from Gemini, shown as the player reaches them
// -----------------------------------------------------------------------------
async function startPrepared({ forget = false } = {}) {
    stopPrepared();
    state.isStartingPrepared = true;
    try {
        await beginPrepared(forget);
    } finally {
        state.isStartingPrepared = false;
    }
}

async function beginPrepared(forget) {
    clearTranscript();
    if (!state.episodeFile) return;
    if (!state.groqKey || !state.apiKey) {
        setStatus(`Add your ${!state.groqKey && !state.apiKey ? 'Groq and Gemini keys' : !state.groqKey ? 'Groq key' : 'Gemini key'} under "API keys" on the left to prepare subtitles.`);
        $('api-keys').open = true;
        return;
    }

    // Anything prepared before for this episode and language is reused, not requested again
    const cacheKey = subtitleCacheKey(state.episodeFile, state.targetLang, 'whisper');
    const startedFor = state.episodeFile;
    if (forget) await deleteSavedSubtitles(cacheKey);
    const saved = forget ? null : await loadSavedSubtitles(cacheKey);
    if (state.episodeFile !== startedFor || state.mode !== 'prepared' || state.preparer) return;
    if (saved?.cues?.length) {
        state.cues = saved.cues;
        renderPreparedTranscript();
        renderPreparedAt(audioEl.currentTime, true);
    }

    $('processing-time').textContent = '';
    const preparer = new FileSubtitlePipeline({
        groqKey: state.groqKey,
        geminiKey: state.apiKey,
        onTiming: (text) => { if (state.preparer === preparer) $('processing-time').textContent = text; },
        loadSamples: getEpisodeSamples,
        targetLang: state.targetLang,
        savedRanges: saved?.ranges || [],
        getPlayhead: () => audioEl.currentTime,
        onCues: (cues) => {
            if (state.preparer !== preparer) return;
            state.cues = [...state.cues, ...cues.filter(c => c.original || c.translation)].sort((a, b) => a.start - b.start);
            saveSubtitles(cacheKey, { cues: state.cues, ranges: preparer.ranges });
            renderPreparedTranscript();
            renderPreparedAt(audioEl.currentTime, true);
            resumeIfBuffered();
        },
        onLanguage: (code) => { if (state.preparer === preparer) applyDetectedLanguage(code); },
        onStatus: (text) => {
            if (state.preparer !== preparer) return;
            state.preparerStatus = text;
            showPreparedStatus();
        },
        onError: (text) => {
            if (state.preparer !== preparer) return;
            setStatus(text);
            showToast(text, "error", "warning");
        }
    });
    state.preparer = preparer;
    preparer.run();
}

function stopPrepared() {
    state.preparer?.stop();
    state.preparer = null;
    state.isBuffering = false;
    clearInterval(state.bufferTimer);
    state.preparerStatus = '';
}

function showPreparedStatus() {
    const speech = state.detectedLang ? `Speech: ${state.detectedLang}. ` : '';
    const waiting = state.isBuffering ? 'Playback starts as soon as the next subtitles are ready. ' : '';
    setStatus(`${speech}${waiting}${state.preparerStatus || ''}`.trim());
}

// The audio only plays once the lines for it are ready, so subtitles never lag behind
function hasBufferAhead(margin) {
    return state.preparer && state.preparer.bufferedAhead(audioEl.currentTime) >= margin;
}

function holdForSubtitles(afterStall = false) {
    state.isBuffering = true;
    // Saved subtitles need no new answer from Gemini, so readiness is also checked on a timer
    clearInterval(state.bufferTimer);
    state.bufferTimer = setInterval(resumeIfBuffered, 500);
    state.resumeBuffer = afterStall ? RESUME_BUFFER_SECONDS : START_BUFFER_SECONDS;
    audioEl.pause();
    showPreparedStatus();
}

function resumeIfBuffered() {
    if (!state.isBuffering || !hasBufferAhead(state.resumeBuffer)) return;
    state.isBuffering = false;
    clearInterval(state.bufferTimer);
    showPreparedStatus();
    audioEl.play().catch(() => setStatus('Subtitles are ready. Press play to continue.'));
}

function cueIndexAt(seconds) {
    let index = -1;
    for (let i = 0; i < state.cues.length && state.cues[i].start <= seconds; i++) index = i;
    return index;
}

function renderPreparedAt(seconds, force = false) {
    const index = cueIndexAt(seconds);
    const cue = state.cues[index];
    const isActive = cue && seconds <= cue.end + CUE_HOLD_SECONDS;
    const key = isActive ? index : -2 - index;
    if (key === state.shownCue && !force) return;
    state.shownCue = key;

    // Same roll-up look as Live: the line before stays above, faded
    const previous = state.cues[isActive ? index - 1 : index];
    $('sub-original').textContent = isActive ? cue.original : '';
    $('sub-translation').textContent = isActive ? cue.translation : '';
    $('sub-original-prev').textContent = previous ? previous.original : '';
    $('sub-translation-prev').textContent = previous ? previous.translation : '';
    document.querySelectorAll('#transcript-rows [data-cue]').forEach(row => {
        row.classList.toggle('bg-primary-container/20', isActive && Number(row.dataset.cue) === index);
    });
}

function renderPreparedTranscript() {
    const rows = $('transcript-rows');
    rows.innerHTML = '';
    $('transcript-empty').classList.toggle('hidden', state.cues.length > 0);
    state.cues.forEach((cue, i) => {
        // Tapping a line jumps the episode there, which helps when studying a sentence
        const row = document.createElement('button');
        row.type = 'button';
        row.dataset.cue = String(i);
        row.className = 'grid grid-cols-[3.5rem_1fr] gap-space-sm p-space-sm text-left rounded-lg border-b border-white/[0.04] hover:bg-surface-container-high/60 cursor-pointer';
        const timeEl = document.createElement('span');
        timeEl.className = 'font-telemetry-data text-[11px] text-outline pt-0.5';
        timeEl.textContent = formatTime(cue.start);
        const textEl = document.createElement('span');
        textEl.className = 'flex flex-col gap-0.5';
        const original = document.createElement('span');
        original.className = 'text-body-sm text-on-surface-variant';
        original.textContent = cue.original;
        const translation = document.createElement('span');
        translation.className = 'text-body-md text-on-surface';
        translation.textContent = cue.translation;
        textEl.append(original, translation);
        row.append(timeEl, textEl);
        row.addEventListener('click', () => { audioEl.currentTime = cue.start; });
        rows.appendChild(row);
    });
}

// Checks the playhead every frame while playing, so a line appears the moment it starts
function followPlayhead() {
    if (state.mode !== 'prepared' || audioEl.paused) return;
    if (!hasBufferAhead(STALL_BUFFER_SECONDS)) {
        holdForSubtitles(true);
        return;
    }
    renderPreparedAt(audioEl.currentTime);
    requestAnimationFrame(followPlayhead);
}

// -----------------------------------------------------------------------------
// Live mode: Gemini session follows the player
// -----------------------------------------------------------------------------
function startSubtitles() {
    if (!state.apiKey) {
        audioEl.pause();
        setStatus('Add your Gemini API key on the Live page first: open Settings there, then come back.');
        showToast("No API key on this device yet.", "error", "key");
        return;
    }
    connectGeminiLive({
        apiKey: state.apiKey,
        model: SUBTITLE_MODEL.id,
        sourceLang: state.targetLang,
        targetLang: state.targetLang,
        playAudio: false,
        silenceWhilePlaying: false,
        listeningMessage: `Subtitles on, in ${state.targetLang.name}.`,
        startCapture: async (onChunk) => {
            setStatus('Reading the episode…');
            startElementCapture(audioEl, await getEpisodeSamples(), onChunk);
        },
        onStatusChange: (status) => {
            if (status === 'connecting') setStatus('Connecting to Gemini…');
            if (status === 'connected') setStatus(`Subtitles on, in ${state.targetLang.name}. They follow the audio a few seconds behind.`);
            if (status === 'disconnected') setStatus('Subtitles off. Press play to start them again.');
        },
        onInputText: (text, languageCode) => {
            if (languageCode) applyDetectedLanguage(languageCode);
            onSubtitleText('original', text);
        },
        onOutputText: (text) => onSubtitleText('translation', text),
        onTurnEnd: flushSubtitleBuffers,
        showToast
    });
}

function stopSubtitles() {
    flushSubtitleBuffers();
    disconnectGeminiLive();
}

// -----------------------------------------------------------------------------
// Transcript Export
// -----------------------------------------------------------------------------
function transcriptText() {
    if (state.mode === 'prepared') {
        return state.cues.map(cue => `[${formatTime(cue.start)}] ${cue.original}\n    ${cue.translation}`).join('\n');
    }
    return state.lines.map(line => line.kind === 'original' ? `[${formatTime(line.time)}] ${line.text}` : `    ${line.text}`).join('\n');
}

function hasTranscript() {
    return state.mode === 'prepared' ? state.cues.length > 0 : state.lines.length > 0;
}

function copyTranscript() {
    if (!hasTranscript()) {
        showToast("Nothing to copy yet.");
        return;
    }
    navigator.clipboard.writeText(transcriptText()).then(() => showToast("Transcript copied", "success", "content_copy"));
}

function downloadTranscript() {
    if (!hasTranscript()) {
        showToast("Nothing to export yet.");
        return;
    }
    const content = `# ${state.episodeName}\n\nSubtitles in ${state.targetLang.name}\n\n${transcriptText()}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.episodeName.replace(/[^\w\- ]+/g, '').slice(0, 60) || 'podcast'}-subtitles.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const select = $('target-lang-select');
    SUPPORTED_LANGUAGES.forEach(lang => select.add(new Option(`${lang.flag} ${lang.name}`, lang.code)));
    select.value = state.targetLang.code;
    select.addEventListener('change', () => {
        state.targetLang = getLanguageByCode(select.value);
        localStorage.setItem('gemini_podcast_lang', state.targetLang.code);
        if (state.mode === 'prepared') startPrepared();
        else if (isSessionActive()) startSubtitles();
    });

    $('folder-input').addEventListener('change', (e) => loadEpisodes(e.target.files));
    $('file-input').addEventListener('change', (e) => loadEpisodes(e.target.files));
    $('groq-key-input').value = state.groqKey;
    $('gemini-key-input').value = state.apiKey;
    if (!state.groqKey || !state.apiKey) $('api-keys').open = true;
    $('save-keys-btn').addEventListener('click', () => {
        state.groqKey = $('groq-key-input').value.trim();
        state.apiKey = $('gemini-key-input').value.trim();
        localStorage.setItem('groq_api_key', state.groqKey);
        localStorage.setItem('gemini_api_key', state.apiKey);
        if (state.groqKey && state.apiKey) $('api-keys').open = false;
        showToast("Keys saved on this device", "success", "key");
        if (state.mode === 'prepared' && state.episodeFile) startPrepared();
    });

    $('copy-path-btn').addEventListener('click', () => {
        navigator.clipboard.writeText($('podcasts-path').textContent).then(() => showToast("Path copied", "success", "content_copy"));
    });

    audioEl.addEventListener('play', () => {
        if (state.mode === 'live' && !isSessionActive()) startSubtitles();
        if (state.mode === 'prepared') {
            if (!state.preparer && !state.isStartingPrepared) startPrepared();
            if (hasBufferAhead(START_BUFFER_SECONDS)) {
                state.isBuffering = false;
                showPreparedStatus();
                followPlayhead();
            } else {
                holdForSubtitles();
            }
        }
    });
    audioEl.addEventListener('seeked', () => {
        if (state.mode !== 'prepared') return;
        renderPreparedAt(audioEl.currentTime, true);
        resumeIfBuffered();
    });
    audioEl.addEventListener('ended', () => { if (state.mode === 'live') stopSubtitles(); });
    ['play', 'pause', 'ended'].forEach(type => audioEl.addEventListener(type, updateWakeLock));
    document.addEventListener('visibilitychange', updateWakeLock);

    document.querySelectorAll('.btn-focus-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            state.focus = btn.getAttribute('data-focus');
            applyFocus();
        });
    });
    applyFocus();

    $('btn-copy-log').addEventListener('click', copyTranscript);
    $('btn-export-md').addEventListener('click', downloadTranscript);
    // Clearing in Prepared mode starts the preparation over, since lines are kept by time
    $('btn-clear-log').addEventListener('click', () => (state.mode === 'prepared' ? startPrepared({ forget: true }) : clearTranscript()));

    document.querySelectorAll('.btn-mode-pill').forEach(btn => {
        btn.addEventListener('click', () => selectMode(btn.getAttribute('data-mode')));
    });
    applyMode();
});

function applyMode() {
    localStorage.setItem('gemini_podcast_mode', state.mode);
    document.querySelectorAll('.btn-mode-pill').forEach(btn => {
        const isSelected = btn.getAttribute('data-mode') === state.mode;
        btn.setAttribute('aria-checked', String(isSelected));
        btn.className = `btn-mode-pill px-3 py-1 rounded-lg text-label-sm transition-all cursor-pointer ${isSelected
            ? 'bg-primary-container text-on-primary-container font-bold'
            : 'text-on-surface-variant hover:text-on-surface'}`;
    });
    $('mode-hint').textContent = state.mode === 'prepared'
        ? 'Prepared: Groq Whisper transcribes the file with timestamps, then Gemini translates each line. Much faster than real time, and each line appears as it is spoken.'
        : 'Live (the old method): streams the audio to the Gemini Live API as it plays, a few seconds behind. Uses your own key from the Live page.';
}

function selectMode(mode) {
    if (mode === state.mode) return;
    stopSubtitles();
    stopPrepared();
    state.mode = mode;
    applyMode();
    clearTranscript();
    if (state.mode === 'prepared') startPrepared();
    else if (!audioEl.paused) startSubtitles();
    else setStatus('Press play to start subtitles. They follow the audio a few seconds behind.');
}
