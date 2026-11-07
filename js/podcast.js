// Podcast Subtitles: plays an episode file and shows live subtitles from Gemini
import { SUPPORTED_LANGUAGES, LIVE_MODELS, getLanguageByCode, getTranslationLanguageCode } from './config.js';
import { startElementCapture, unlockElementPlayback } from './audio.js';
import { connectGeminiLive, disconnectGeminiLive, isSessionActive } from './websocket.js';

// Live Translate transcribes and translates continuously, which suits long talk
const SUBTITLE_MODEL = LIVE_MODELS.find(m => m.isTranslateModel);
const AUDIO_FILE = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;
const MAX_TAG_BYTES = 8 * 1048576;
// Lines with no sentence ending are cut here so a subtitle never grows forever
const MAX_LINE_LENGTH = { spaced: 160, unspaced: 70 };

const state = {
    apiKey: localStorage.getItem('gemini_api_key') || '',
    targetLang: getLanguageByCode(localStorage.getItem('gemini_podcast_lang') || localStorage.getItem('gemini_source_lang') || 'EN-US'),
    detectedLang: null,
    episodes: [],
    currentUrl: null,
    episodeName: '',
    lines: [],
    buffers: { original: '', translation: '' },
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
    if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
    state.currentUrl = URL.createObjectURL(episode.file);
    state.episodeName = episode.title;
    audioEl.src = state.currentUrl;
    $('episode-title').textContent = episode.title;
    $('episode-show').textContent = episode.show;
    clearTranscript();
    setStatus('Press play to start subtitles. They follow the audio a few seconds behind.');
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
    if (rest.trim().length > limit) {
        const cut = isSpaced ? rest.lastIndexOf(' ', limit) : limit;
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

    // The subtitle shows the sentence being spoken, or the last one finished
    const shown = rest.trim() || done.at(-1);
    if (shown) $(kind === 'original' ? 'sub-original' : 'sub-translation').textContent = shown;
}

function flushSubtitleBuffers() {
    ['original', 'translation'].forEach(kind => {
        const text = state.buffers[kind].trim();
        if (text) addLine(kind, text, state.bufferStart[kind]);
        state.buffers[kind] = '';
    });
}

function applyDetectedLanguage(code) {
    const primary = code.toLowerCase().split('-')[0];
    const match = SUPPORTED_LANGUAGES.find(lang => getTranslationLanguageCode(lang).split('-')[0].toLowerCase() === primary);
    const name = match ? match.name : code;
    if (state.detectedLang === name) return;
    state.detectedLang = name;
    setStatus(`Speech detected: ${name}. Subtitles in ${state.targetLang.name}.`);
}

function clearTranscript() {
    state.lines = [];
    state.buffers = { original: '', translation: '' };
    state.detectedLang = null;
    $('transcript-rows').innerHTML = '';
    $('transcript-empty').classList.remove('hidden');
    $('sub-original').textContent = '';
    $('sub-translation').textContent = '';
}

// -----------------------------------------------------------------------------
// Gemini session follows the player
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
        startCapture: (onChunk) => startElementCapture(audioEl, onChunk),
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
    return state.lines.map(line => line.kind === 'original' ? `[${formatTime(line.time)}] ${line.text}` : `    ${line.text}`).join('\n');
}

function copyTranscript() {
    if (!state.lines.length) {
        showToast("Nothing to copy yet.");
        return;
    }
    navigator.clipboard.writeText(transcriptText()).then(() => showToast("Transcript copied", "success", "content_copy"));
}

function downloadTranscript() {
    if (!state.lines.length) {
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
        if (isSessionActive()) startSubtitles();
    });

    $('folder-input').addEventListener('change', (e) => loadEpisodes(e.target.files));
    $('file-input').addEventListener('change', (e) => loadEpisodes(e.target.files));
    $('copy-path-btn').addEventListener('click', () => {
        navigator.clipboard.writeText($('podcasts-path').textContent).then(() => showToast("Path copied", "success", "content_copy"));
    });

    // Once the episode plays through Web Audio, the context must be started by a tap,
    // or the player goes silent; a tap on the player's own controls is early enough
    document.addEventListener('pointerdown', () => unlockElementPlayback(audioEl), { capture: true });
    audioEl.addEventListener('play', () => {
        unlockElementPlayback(audioEl);
        if (!isSessionActive()) startSubtitles();
    });
    audioEl.addEventListener('ended', stopSubtitles);

    $('btn-copy-log').addEventListener('click', copyTranscript);
    $('btn-export-md').addEventListener('click', downloadTranscript);
    $('btn-clear-log').addEventListener('click', clearTranscript);
});
