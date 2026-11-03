// Main Application Controller & UI Logic
import { SUPPORTED_LANGUAGES, LIVE_MODELS, VOICES, getLanguageByCode, getTranslationLanguageCode } from './config.js';
import { unlockPlayback } from './audio.js';
import { connectGeminiLive, disconnectGeminiLive, isSessionActive } from './websocket.js';

const MODES = {
    speak: {
        sourceLabel: 'You speak',
        targetLabel: 'Translate into',
        hint: 'Speak in your language. Gemini says it in the other language and shows the text.'
    },
    listen: {
        sourceLabel: 'Translate into',
        targetLabel: 'They speak · detected automatically',
        hint: 'Let the mic hear someone. Their words and the translation appear as text, with no audio.'
    },
    talk: {
        sourceLabel: 'Your language',
        targetLabel: 'Their language',
        hint: 'A conversation. Tap the mic to switch who is speaking: blue is you, purple is them.'
    }
};

const savedMode = localStorage.getItem('gemini_mode');
const savedVoice = localStorage.getItem('gemini_voice');

// Application State
const state = {
    sourceLang: getLanguageByCode(localStorage.getItem('gemini_source_lang') || 'EN-US'),
    targetLang: getLanguageByCode(localStorage.getItem('gemini_target_lang') || 'JA-JP'),
    mode: MODES[savedMode] ? savedMode : 'speak',
    voice: VOICES.some(v => v.name === savedVoice) ? savedVoice : VOICES[0].name,
    talkSpeaker: 'me',
    status: 'disconnected',
    apiKey: localStorage.getItem('gemini_api_key') || '',
    startAfterSettings: false,
    turns: [],
    currentTurn: null
};

// -----------------------------------------------------------------------------
// Toast HUD Notification
// -----------------------------------------------------------------------------
function showToast(message, type = 'info', icon = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-space-xs px-space-md py-2.5 rounded-2xl bg-surface-container-high/95 backdrop-blur-xl border border-white/[0.12] text-on-surface shadow-2xl font-body-sm text-body-sm transition-all duration-300 transform translate-y-4 opacity-0 max-w-sm`;

    let iconColor = 'text-secondary font-bold';
    if (type === 'error') iconColor = 'text-error font-bold';
    if (type === 'purple') iconColor = 'text-primary font-bold';

    const iconEl = document.createElement('span');
    iconEl.className = `material-symbols-outlined text-[18px] ${iconColor}`;
    iconEl.textContent = icon;
    const textEl = document.createElement('span');
    textEl.className = 'font-medium';
    textEl.textContent = message;
    toast.append(iconEl, textEl);

    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    // Errors explain why a session failed, so they stay up long enough to read
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, type === 'error' ? 9000 : 3200);
}

// -----------------------------------------------------------------------------
// Session Plan: which model, direction and audio each mode uses
// -----------------------------------------------------------------------------
// Voices can only be set on Gemini 3.8 Live; Live Translate picks its own and changes it
const VOICE_MODEL = LIVE_MODELS.find(m => !m.isTranslateModel);
// Live Translate detects the spoken language itself and keeps translating without pauses
const LISTEN_MODEL = LIVE_MODELS.find(m => m.isTranslateModel);

// sourceLang is the user's language and targetLang the other person's
function getSessionPlan() {
    const mine = state.sourceLang;
    const theirs = state.targetLang;
    if (state.mode === 'listen') return { model: LISTEN_MODEL, from: theirs, to: mine, playAudio: false };
    const reverse = state.mode === 'talk' && state.talkSpeaker === 'them';
    return { model: VOICE_MODEL, from: reverse ? theirs : mine, to: reverse ? mine : theirs, playAudio: true };
}

function getListeningMessage(plan) {
    if (state.mode === 'listen') return `Listening. Translating into ${plan.to.name}.`;
    if (state.mode === 'talk') {
        return state.talkSpeaker === 'me' ? `Your turn. Speak in ${plan.from.name}.` : `Their turn. Listening for ${plan.from.name}.`;
    }
    return `Listening. Speak in ${plan.from.name}.`;
}

// -----------------------------------------------------------------------------
// UI Updates for Mode, Languages & Voice
// -----------------------------------------------------------------------------
function pillClass(base, isSelected) {
    return `${base} ${isSelected
        ? 'bg-primary-container text-on-primary-container font-bold'
        : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'}`;
}

function updateLanguageUI() {
    const src = state.sourceLang;
    const tgt = state.targetLang;
    const mode = MODES[state.mode];
    const plan = getSessionPlan();

    localStorage.setItem('gemini_source_lang', src.code);
    localStorage.setItem('gemini_target_lang', tgt.code);
    localStorage.setItem('gemini_mode', state.mode);
    localStorage.setItem('gemini_voice', state.voice);

    document.getElementById('source-lang-label').textContent = mode.sourceLabel;
    document.getElementById('source-lang-flag').textContent = src.flag;
    document.getElementById('source-lang-name').textContent = src.name;
    document.getElementById('source-lang-code').textContent = src.code;
    document.getElementById('target-lang-label').textContent = mode.targetLabel;
    document.getElementById('target-lang-flag').textContent = tgt.flag;
    document.getElementById('target-lang-name').textContent = tgt.name;
    document.getElementById('target-lang-code').textContent = tgt.code;
    document.getElementById('mode-hint').textContent = mode.hint;
    document.getElementById('active-model-name').textContent = plan.model.label;
    document.getElementById('source-feed-title').textContent = `Original · ${plan.from.name}`;
    document.getElementById('target-feed-title').textContent = `Translation · ${plan.to.name}`;

    document.querySelectorAll('.btn-mode-tab').forEach(btn => {
        const isSelected = btn.getAttribute('data-mode') === state.mode;
        btn.setAttribute('aria-selected', String(isSelected));
        btn.className = pillClass('btn-mode-tab flex flex-col items-center gap-0.5 py-2 rounded-xl font-label-sm text-label-sm transition-all cursor-pointer', isSelected);
    });

    document.getElementById('voice-group').classList.toggle('hidden', !plan.playAudio);
    document.querySelectorAll('.btn-voice-pill').forEach(btn => {
        const voice = VOICES.find(v => v.name === btn.getAttribute('data-voice'));
        btn.title = voice.style;
        btn.className = pillClass('btn-voice-pill py-1.5 px-1 rounded-lg font-label-sm text-[11px] text-center transition-all cursor-pointer', voice.name === state.voice);
    });

    renderMic();
}

const MIC_BASE = 'w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer active:scale-95';
const MIC_LOOKS = {
    idle: 'bg-gradient-to-br from-primary to-primary-container text-on-primary shadow-[0_0_32px_rgba(160,120,255,0.6)]',
    stop: 'bg-error text-on-error shadow-[0_0_32px_rgba(255,180,171,0.5)]',
    me: 'bg-tertiary text-on-tertiary shadow-[0_0_32px_rgba(123,208,255,0.7)]',
    them: 'bg-primary-container text-on-primary-container shadow-[0_0_32px_rgba(160,120,255,0.7)]'
};

function renderMic() {
    const { status, mode, talkSpeaker } = state;
    const plan = getSessionPlan();
    const isConnecting = status === 'connecting';
    const isIdle = status === 'disconnected';
    let look = 'idle';
    let icon = 'mic';
    let label = 'Tap the mic to start';
    let hint = '';

    if (!isIdle && mode === 'talk') {
        look = talkSpeaker;
        label = talkSpeaker === 'me' ? `You're speaking · ${plan.from.name}` : `They're speaking · ${plan.from.name}`;
        hint = isConnecting ? 'Connecting…' : `Gemini says it in ${plan.to.name}. Tap the mic to switch.`;
    } else if (!isIdle) {
        look = 'stop';
        icon = 'stop';
        label = mode === 'listen' ? 'Listening…' : `Listening · speak ${plan.from.name}`;
        hint = isConnecting ? 'Connecting…' : 'Tap to stop.';
    } else if (mode === 'talk') {
        hint = 'You speak first. Tap again whenever the other person speaks.';
    }
    if (isConnecting) icon = 'hourglass_top';

    document.getElementById('mic-btn').className = `${MIC_BASE} ${MIC_LOOKS[look]} ${status === 'connected' ? 'animate-pulse-glow' : ''}`;
    document.getElementById('mic-btn-icon').textContent = icon;
    document.getElementById('mic-status').textContent = label;
    document.getElementById('mic-hint').textContent = hint;
    document.getElementById('stop-btn').classList.toggle('hidden', isIdle || mode !== 'talk');
}

function updateLiveStatusUI(status) {
    state.status = status;
    renderMic();
}

function restartIfLive() {
    if (isSessionActive()) startSession();
}

// -----------------------------------------------------------------------------
// Language Picker Dialog Logic
// -----------------------------------------------------------------------------
const langDialog = document.getElementById('language-dialog');
const langSearchInput = document.getElementById('language-search-input');
const langOptionsList = document.getElementById('language-options-list');
let currentLangTargetType = 'source';

function renderLanguageOptions(filter = '') {
    langOptionsList.innerHTML = '';
    const query = filter.toLowerCase().trim();
    const activeCode = currentLangTargetType === 'source' ? state.sourceLang.code : state.targetLang.code;

    SUPPORTED_LANGUAGES.forEach(lang => {
        if (query && !lang.name.toLowerCase().includes(query) && !lang.code.toLowerCase().includes(query)) {
            return;
        }
        const isSelected = lang.code === activeCode;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flex items-center justify-between p-space-sm rounded-2xl text-left transition-all cursor-pointer border ${isSelected ? 'bg-primary-container text-on-primary-container font-bold border-primary shadow-md' : 'bg-surface-container-high/70 hover:bg-surface-variant text-on-surface border-white/[0.04]'}`;
        btn.innerHTML = `
            <div class="flex items-center gap-space-xs truncate">
                <span class="text-xl shrink-0">${lang.flag}</span>
                <span class="font-headline-sm text-body-sm font-bold truncate">${lang.name}</span>
            </div>
            <span class="font-telemetry-data text-label-sm px-1.5 py-0.5 rounded ${isSelected ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-outline'} shrink-0 ml-1">${lang.code}</span>
        `;
        btn.addEventListener('click', () => {
            selectLanguage(lang, currentLangTargetType);
            langDialog.close();
        });
        langOptionsList.appendChild(btn);
    });
}

function selectLanguage(lang, type) {
    if (type === 'source') {
        if (state.targetLang.code === lang.code) state.targetLang = state.sourceLang;
        state.sourceLang = lang;
    } else {
        if (state.sourceLang.code === lang.code) state.sourceLang = state.targetLang;
        state.targetLang = lang;
    }
    updateLanguageUI();
    restartIfLive();
}

function openLanguagePicker(type) {
    currentLangTargetType = type;
    document.getElementById('language-dialog-title').textContent = type === 'source' ? 'Your language' : 'Their language';
    langSearchInput.value = '';
    renderLanguageOptions();
    langDialog.showModal();
}

// Listen mode: Live Translate reports the language it heard, which becomes their language
function applyDetectedLanguage(code) {
    const normalized = code.toLowerCase();
    const candidates = SUPPORTED_LANGUAGES.filter(lang => lang.code !== state.sourceLang.code);
    const match = candidates.find(lang => getTranslationLanguageCode(lang).toLowerCase() === normalized)
        || candidates.find(lang => getTranslationLanguageCode(lang).split('-')[0].toLowerCase() === normalized.split('-')[0]);
    if (!match || match.code === state.targetLang.code) return;
    state.targetLang = match;
    updateLanguageUI();
}

// -----------------------------------------------------------------------------
// Live Session Controls
// -----------------------------------------------------------------------------
function startSession() {
    state.currentTurn = null;
    const plan = getSessionPlan();
    connectGeminiLive({
        apiKey: state.apiKey,
        model: plan.model.id,
        sourceLang: plan.from,
        targetLang: plan.to,
        voiceName: state.voice,
        playAudio: plan.playAudio,
        silenceWhilePlaying: plan.playAudio,
        listeningMessage: getListeningMessage(plan),
        onStatusChange: updateLiveStatusUI,
        onInputText: (text, languageCode) => {
            if (state.mode === 'listen' && languageCode) applyDetectedLanguage(languageCode);
            appendToTurn('source', text);
        },
        onOutputText: (text) => appendToTurn('translation', text),
        onTurnEnd: () => { state.currentTurn = null; },
        showToast
    });
}

function stopSession() {
    disconnectGeminiLive();
    updateLiveStatusUI('disconnected');
}

function handleMicTap() {
    unlockPlayback();
    if (state.mode === 'talk' && isSessionActive()) {
        state.talkSpeaker = state.talkSpeaker === 'me' ? 'them' : 'me';
        updateLanguageUI();
        startSession();
        return;
    }
    if (isSessionActive()) {
        stopSession();
        return;
    }
    if (!state.apiKey) {
        state.startAfterSettings = true;
        openSettings();
        promptForApiKey();
        return;
    }
    state.talkSpeaker = 'me';
    updateLanguageUI();
    startSession();
}

function selectMode(mode) {
    if (mode === state.mode) return;
    if (isSessionActive()) stopSession();
    state.mode = mode;
    state.talkSpeaker = 'me';
    state.currentTurn = null;
    updateLanguageUI();
}

// -----------------------------------------------------------------------------
// Live Transcript
// -----------------------------------------------------------------------------
// Gemini 3.8 Live sometimes leaks working notes around the translation, such as
// "🧠[ja]<not fr>source✨translation<partial>" or "{pause}💃[en]<not ja>"
function cleanTranscript(text) {
    return text
        .replace(/🧠[\s\S]*?(✨|$)/gu, '')
        .replace(/\p{Extended_Pictographic}️?\s*\[[^\]]*\]\s*<not [^>]*>[^✨]*✨/gu, '')
        .replace(/\[[a-z]{2,3}(?:-[A-Za-z]+)?\]\s*<not [^>]*>/g, '')
        .replace(/\{[a-z]+\}|<[a-z]+>/g, '')
        .replace(/[\p{Extended_Pictographic}‍️]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function createTranscriptCell(borderClass, label) {
    const cell = document.createElement('div');
    cell.className = `rounded-xl bg-surface-container-low/95 p-space-sm flex flex-col gap-space-xs shadow-md ${borderClass}`;
    const labelEl = document.createElement('span');
    labelEl.className = 'font-telemetry-data text-label-sm text-on-surface-variant';
    labelEl.textContent = label;
    const textEl = document.createElement('p');
    textEl.className = 'font-body-sm text-body-sm text-on-surface leading-relaxed';
    textEl.textContent = '…';
    cell.append(labelEl, textEl);
    return { cell, textEl };
}

// Transcripts arrive as fragments, so each turn is one row that keeps growing
function appendToTurn(field, text) {
    if (!state.currentTurn) {
        const plan = getSessionPlan();
        const turn = {
            time: new Date().toLocaleTimeString(),
            sourceName: plan.from.name,
            targetName: plan.to.name,
            source: '',
            translation: ''
        };
        const row = document.createElement('div');
        row.className = 'grid grid-cols-1 md:grid-cols-2 gap-space-sm';
        const sourceCell = createTranscriptCell('border-l-2 border-secondary', `${turn.time} · ${turn.sourceName}`);
        const translationCell = createTranscriptCell('border-l-2 border-primary-container', turn.targetName);
        row.append(sourceCell.cell, translationCell.cell);
        document.getElementById('transcript-rows').appendChild(row);

        turn.row = row;
        turn.sourceEl = sourceCell.textEl;
        turn.translationEl = translationCell.textEl;
        state.turns.push(turn);
        state.currentTurn = turn;
        document.getElementById('transcript-empty').classList.add('hidden');
    }

    const turn = state.currentTurn;
    turn[field] += text;
    turn[`${field}El`].textContent = cleanTranscript(turn[field]) || '…';
    turn.row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearTranscript() {
    state.turns = [];
    state.currentTurn = null;
    document.getElementById('transcript-rows').innerHTML = '';
    document.getElementById('transcript-empty').classList.remove('hidden');
}

// -----------------------------------------------------------------------------
// Markdown & Log Export
// -----------------------------------------------------------------------------
function downloadMarkdownFile() {
    if (!state.turns.length) {
        showToast("Nothing to export yet.", "info", "info");
        return;
    }
    const dateStr = new Date().toISOString().split('T')[0];
    const turns = state.turns.map(t => `**${t.time}**\n\n- ${t.sourceName}: ${cleanTranscript(t.source)}\n- ${t.targetName}: ${cleanTranscript(t.translation)}`);
    const content = `# Live Translation Transcript\n\n**Date:** ${dateStr}\n\n${turns.join('\n\n')}\n`;

    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-live-transcript-${dateStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function copyTranscript() {
    if (!state.turns.length) {
        showToast("Nothing to copy yet.", "info", "info");
        return;
    }
    const log = state.turns.map(t => `[${t.time}]\n${cleanTranscript(t.source)}\n${cleanTranscript(t.translation)}`).join('\n\n');
    navigator.clipboard.writeText(log).then(() => showToast("Transcript copied", "success", "content_copy"));
}

// -----------------------------------------------------------------------------
// Settings Dialog Handlers
// -----------------------------------------------------------------------------
const settingsDialog = document.getElementById('settings-dialog');
const settingApiKey = document.getElementById('setting-api-key');

function openSettings() {
    settingApiKey.value = state.apiKey;
    document.getElementById('settings-key-prompt').classList.add('hidden');
    settingsDialog.showModal();
}

// Lives inside the dialog because toasts can't show above an open modal
function promptForApiKey() {
    document.getElementById('settings-key-prompt').classList.remove('hidden');
    settingApiKey.focus();
}

function saveSettings() {
    if (state.startAfterSettings && !settingApiKey.value.trim()) {
        promptForApiKey();
        return;
    }
    unlockPlayback();

    state.apiKey = settingApiKey.value.trim();
    localStorage.setItem('gemini_api_key', state.apiKey);
    settingsDialog.close();

    if (state.startAfterSettings && state.apiKey) {
        state.startAfterSettings = false;
        state.talkSpeaker = 'me';
        updateLanguageUI();
        startSession();
    } else {
        restartIfLive();
    }
}

// -----------------------------------------------------------------------------
// API Key Setup Guide
// -----------------------------------------------------------------------------
const keyGuideDialog = document.getElementById('key-guide-dialog');
const keyGuideSteps = [...document.querySelectorAll('.guide-step')];
let keyGuideStep = 0;

function showKeyGuideStep(index) {
    keyGuideStep = index;
    keyGuideSteps.forEach((step, i) => step.classList.toggle('hidden', i !== index));
    document.getElementById('key-guide-back-btn').disabled = index === 0;
    document.getElementById('key-guide-next-btn').disabled = index === keyGuideSteps.length - 1;
    document.getElementById('key-guide-dots').innerHTML = keyGuideSteps
        .map((_, i) => `<span class="w-2 h-2 rounded-full ${i === index ? 'bg-secondary' : 'bg-surface-container-highest'}"></span>`)
        .join('');
}

function openKeyGuide() {
    showKeyGuideStep(0);
    keyGuideDialog.showModal();
}

// -----------------------------------------------------------------------------
// DOM Event Listeners Initialization
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.btn-mode-tab').forEach(btn => {
        btn.addEventListener('click', () => selectMode(btn.getAttribute('data-mode')));
    });

    // Language Selector Buttons
    document.getElementById('source-lang-btn').addEventListener('click', () => openLanguagePicker('source'));
    document.getElementById('target-lang-btn').addEventListener('click', () => openLanguagePicker('target'));
    document.getElementById('close-language-btn').addEventListener('click', () => langDialog.close());
    langSearchInput.addEventListener('input', (e) => renderLanguageOptions(e.target.value));

    document.getElementById('swap-lang-btn').addEventListener('click', () => {
        document.getElementById('swap-icon').classList.toggle('rotate-180');
        [state.sourceLang, state.targetLang] = [state.targetLang, state.sourceLang];
        updateLanguageUI();
        restartIfLive();
    });

    document.querySelectorAll('.btn-voice-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            state.voice = btn.getAttribute('data-voice');
            updateLanguageUI();
            showToast(`Voice set: ${state.voice}`, "purple", "record_voice_over");
            restartIfLive();
        });
    });

    // Live Translation Controls
    document.getElementById('mic-btn').addEventListener('click', handleMicTap);
    document.getElementById('stop-btn').addEventListener('click', stopSession);

    // Transcript Actions
    document.getElementById('btn-export-md').addEventListener('click', downloadMarkdownFile);
    document.getElementById('btn-copy-log').addEventListener('click', copyTranscript);
    document.getElementById('btn-clear-log').addEventListener('click', clearTranscript);

    // Settings Modal
    document.getElementById('header-settings-btn').addEventListener('click', openSettings);
    document.getElementById('close-settings-btn').addEventListener('click', () => settingsDialog.close());
    document.getElementById('cancel-settings-btn').addEventListener('click', () => settingsDialog.close());
    settingsDialog.addEventListener('close', () => { state.startAfterSettings = false; });
    document.getElementById('toggle-key-visibility').addEventListener('click', () => {
        settingApiKey.type = settingApiKey.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

    // API Key Setup Guide
    document.getElementById('open-key-guide-btn').addEventListener('click', openKeyGuide);
    document.getElementById('close-key-guide-btn').addEventListener('click', () => keyGuideDialog.close());
    document.getElementById('key-guide-back-btn').addEventListener('click', () => showKeyGuideStep(keyGuideStep - 1));
    document.getElementById('key-guide-next-btn').addEventListener('click', () => showKeyGuideStep(keyGuideStep + 1));
    document.getElementById('key-guide-paste-btn').addEventListener('click', () => {
        keyGuideDialog.close();
        if (!settingsDialog.open) settingsDialog.showModal();
        settingApiKey.focus();
    });

    updateLanguageUI();
    updateLiveStatusUI('disconnected');
});
