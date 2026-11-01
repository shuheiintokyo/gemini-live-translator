// Main Application Controller & UI Logic
import { SUPPORTED_LANGUAGES, LIVE_MODELS, getLanguageByCode, getLiveModel } from './config.js';
import { unlockPlayback } from './audio.js';
import { connectGeminiLive, disconnectGeminiLive, isSessionActive } from './websocket.js';

// Application State
const state = {
    sourceLang: getLanguageByCode(localStorage.getItem('gemini_source_lang') || 'EN-US'),
    targetLang: getLanguageByCode(localStorage.getItem('gemini_target_lang') || 'JA-JP'),
    targetTone: localStorage.getItem('gemini_target_tone') || 'polite',
    direction: localStorage.getItem('gemini_direction') || 'mine',
    // getLiveModel falls back to the default when a retired model is still saved
    selectedModel: getLiveModel(localStorage.getItem('gemini_model')).id,
    apiKey: localStorage.getItem('gemini_api_key') || '',
    isMuted: false,
    startAfterSettings: false,
    turns: [],
    currentTurn: null
};

const TONE_LABELS = { polite: 'Polite', formal: 'Formal', casual: 'Casual', technical: 'Technical' };

// Live Translate has one fixed target language, so both ways needs the other model
function getSessionModel() {
    const model = getLiveModel(state.selectedModel);
    return state.direction === 'both' && model.isTranslateModel ? LIVE_MODELS.find(m => !m.isTranslateModel) : model;
}

// sourceLang is yours and targetLang is theirs, so "they speak" runs them in reverse
function getSessionLanguages() {
    return state.direction === 'theirs'
        ? { from: state.targetLang, to: state.sourceLang }
        : { from: state.sourceLang, to: state.targetLang };
}

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
// UI Updates for Active Languages & Model
// -----------------------------------------------------------------------------
function updateLanguageUI() {
    const src = state.sourceLang;
    const tgt = state.targetLang;
    const tone = state.targetTone;

    localStorage.setItem('gemini_source_lang', src.code);
    localStorage.setItem('gemini_target_lang', tgt.code);
    localStorage.setItem('gemini_target_tone', tone);
    localStorage.setItem('gemini_direction', state.direction);

    document.getElementById('source-lang-flag').textContent = src.flag;
    document.getElementById('source-lang-name').textContent = src.name;
    document.getElementById('source-lang-code').textContent = src.code;
    document.getElementById('target-lang-flag').textContent = tgt.flag;
    document.getElementById('target-lang-name').textContent = tgt.name;
    document.getElementById('target-lang-code').textContent = tgt.code;

    const bothWays = state.direction === 'both';
    const { from, to } = getSessionLanguages();
    document.getElementById('hero-lead').textContent = { mine: 'You speak', theirs: 'They speak', both: 'Either person speaks' }[state.direction];
    document.getElementById('hero-mid').textContent = bothWays ? '⇄' : '➔ Gemini speaks';
    document.getElementById('hero-src-name').textContent = from.name;
    document.getElementById('hero-tgt-name').textContent = to.name;
    document.getElementById('source-feed-title').textContent = bothWays ? 'Heard' : `Original · ${from.name}`;
    document.getElementById('target-feed-title').textContent = bothWays ? 'Translation' : `Translation · ${to.name}`;

    document.querySelectorAll('.btn-direction-pill').forEach(btn => {
        const base = 'btn-direction-pill flex-1 py-1 px-1 rounded-lg font-label-sm text-[10px] text-center transition-all cursor-pointer';
        btn.className = `${base} ${btn.getAttribute('data-direction') === state.direction
            ? 'bg-primary-container text-on-primary-container font-bold'
            : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'}`;
    });

    const model = getSessionModel();
    document.getElementById('active-model-name').textContent = model.label;
    document.getElementById('translate-model-hint').classList.toggle('hidden', !model.isTranslateModel);
    document.getElementById('both-ways-hint').classList.toggle('hidden', !bothWays);

    document.querySelectorAll('.btn-tone-pill').forEach(btn => {
        btn.disabled = model.isTranslateModel;
        const base = 'btn-tone-pill flex-1 py-1 px-1 rounded-lg font-label-sm text-[10px] text-center transition-all';
        const look = btn.getAttribute('data-tone') === tone
            ? 'bg-primary-container text-on-primary-container font-bold'
            : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface';
        btn.className = `${base} ${look} ${model.isTranslateModel ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`;
    });
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

// -----------------------------------------------------------------------------
// Live WebSocket Toggle Manager
// -----------------------------------------------------------------------------
function startSession() {
    state.currentTurn = null;
    const { from, to } = getSessionLanguages();
    connectGeminiLive({
        apiKey: state.apiKey,
        model: getSessionModel().id,
        sourceLang: from,
        targetLang: to,
        targetTone: state.targetTone,
        bothWays: state.direction === 'both',
        isMuted: () => state.isMuted,
        onStatusChange: updateLiveStatusUI,
        onInputText: (text) => appendToTurn('source', text),
        onOutputText: (text) => appendToTurn('translation', text),
        onTurnEnd: () => { state.currentTurn = null; },
        showToast
    });
}

function toggleLiveSession() {
    if (isSessionActive()) {
        disconnectGeminiLive();
        updateLiveStatusUI('disconnected');
        return;
    }

    unlockPlayback();
    if (!state.apiKey) {
        state.startAfterSettings = true;
        openSettings();
        promptForApiKey();
        return;
    }
    startSession();
}

function updateLiveStatusUI(status) {
    const isLive = status === 'connected';
    const isConnecting = status === 'connecting';
    const headerLabels = { connected: 'Stop Live', connecting: 'Connecting…', disconnected: 'Start Live' };
    const masterLabels = { connected: 'STOP LIVE TRANSLATION', connecting: 'CONNECTING… (CANCEL)', disconnected: 'START LIVE TRANSLATION' };
    const pillLabels = { connected: 'Listening', connecting: 'Connecting', disconnected: 'Standby' };
    const icon = isConnecting ? 'hourglass_top' : isLive ? 'stop' : 'play_arrow';

    document.getElementById('rec-dot').textContent = icon;
    document.getElementById('rec-label').textContent = headerLabels[status];
    document.getElementById('master-btn-icon').textContent = icon;
    document.getElementById('master-btn-label').textContent = masterLabels[status];

    document.getElementById('rec-toggle-btn').className = isLive
        ? 'flex items-center gap-space-xs px-3 sm:px-4 py-1.5 rounded-full bg-error text-on-error hover:bg-error-container hover:text-on-error-container transition-all font-bold text-xs sm:text-label-sm cursor-pointer'
        : 'flex items-center gap-space-xs px-3 sm:px-4 py-1.5 rounded-full bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary transition-all font-bold text-xs sm:text-label-sm shadow-[0_0_16px_rgba(160,120,255,0.4)] cursor-pointer';
    document.getElementById('master-live-btn').className = isLive
        ? 'flex-1 xl:flex-initial flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-error text-on-error font-bold text-body-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer'
        : 'flex-1 xl:flex-initial flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-gradient-to-r from-primary to-primary-container hover:from-primary-container hover:to-primary text-on-primary font-bold text-body-sm shadow-[0_0_24px_rgba(160,120,255,0.6)] hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer';

    const pill = document.getElementById('master-live-status-pill');
    pill.textContent = pillLabels[status];
    pill.className = isLive
        ? 'self-start px-2 py-0.5 rounded-full bg-secondary/20 text-secondary font-label-sm text-[10px] font-bold uppercase tracking-wider animate-pulse'
        : 'self-start px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-label-sm text-[10px] font-bold uppercase tracking-wider';
    document.getElementById('master-live-pulse-ring').className = isLive
        ? 'w-11 h-11 rounded-2xl bg-secondary/20 border border-secondary/40 flex items-center justify-center text-secondary shrink-0 shadow-inner animate-pulse'
        : 'w-11 h-11 rounded-2xl bg-surface-container-lowest border border-white/[0.08] flex items-center justify-center text-primary shrink-0 shadow-inner';
}

// -----------------------------------------------------------------------------
// Live Transcript
// -----------------------------------------------------------------------------
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
        // Both ways, each turn can go either way, so the rows can't name a language
        const bothWays = state.direction === 'both';
        const { from, to } = getSessionLanguages();
        const turn = {
            time: new Date().toLocaleTimeString(),
            sourceName: bothWays ? 'Heard' : from.name,
            targetName: bothWays ? 'Translation' : to.name,
            source: '',
            translation: ''
        };
        const row = document.createElement('div');
        row.className = 'grid grid-cols-1 md:grid-cols-2 gap-space-sm';
        const sourceCell = createTranscriptCell('border-l-2 border-secondary', turn.time);
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
    turn[`${field}El`].textContent = turn[field].trim();
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
    const turns = state.turns.map(t => `**${t.time}**\n\n- ${t.sourceName}: ${t.source.trim()}\n- ${t.targetName}: ${t.translation.trim()}`);
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
    const log = state.turns.map(t => `[${t.time}]\n${t.source.trim()}\n${t.translation.trim()}`).join('\n\n');
    navigator.clipboard.writeText(log).then(() => showToast("Transcript copied", "success", "content_copy"));
}

// -----------------------------------------------------------------------------
// Settings Dialog Handlers
// -----------------------------------------------------------------------------
const settingsDialog = document.getElementById('settings-dialog');
const settingApiKey = document.getElementById('setting-api-key');
const modelSelect = document.getElementById('setting-model-select');

function openSettings() {
    settingApiKey.value = state.apiKey;
    modelSelect.value = state.selectedModel;
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
    state.selectedModel = modelSelect.value;
    localStorage.setItem('gemini_model', state.selectedModel);
    updateLanguageUI();
    settingsDialog.close();

    if (state.startAfterSettings && state.apiKey) {
        state.startAfterSettings = false;
        startSession();
    } else {
        restartIfLive();
    }
}

// -----------------------------------------------------------------------------
// DOM Event Listeners Initialization
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
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

    document.querySelectorAll('.btn-direction-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            state.direction = btn.getAttribute('data-direction');
            updateLanguageUI();
            restartIfLive();
        });
    });

    document.querySelectorAll('.btn-tone-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            state.targetTone = btn.getAttribute('data-tone');
            updateLanguageUI();
            showToast(`Tone set: ${TONE_LABELS[state.targetTone]}`, "purple", "tune");
            restartIfLive();
        });
    });

    // Live Translation Controls
    document.getElementById('rec-toggle-btn').addEventListener('click', toggleLiveSession);
    document.getElementById('master-live-btn').addEventListener('click', toggleLiveSession);

    const muteBtn = document.getElementById('mute-toggle');
    muteBtn.addEventListener('click', () => {
        state.isMuted = !state.isMuted;
        document.getElementById('mic-icon').textContent = state.isMuted ? 'mic_off' : 'mic';
        document.getElementById('mute-label').textContent = state.isMuted ? 'Muted' : 'Mute';
        muteBtn.classList.toggle('bg-surface-container-high', !state.isMuted);
        muteBtn.classList.toggle('bg-error-container', state.isMuted);
        muteBtn.classList.toggle('text-on-error-container', state.isMuted);
    });

    // Transcript Actions
    document.getElementById('btn-export-md').addEventListener('click', downloadMarkdownFile);
    document.getElementById('btn-copy-log').addEventListener('click', copyTranscript);
    document.getElementById('btn-clear-log').addEventListener('click', clearTranscript);

    // Settings Modal
    LIVE_MODELS.forEach(model => modelSelect.add(new Option(model.label, model.id)));
    document.getElementById('header-settings-btn').addEventListener('click', openSettings);
    document.getElementById('engine-badge-btn').addEventListener('click', openSettings);
    document.getElementById('close-settings-btn').addEventListener('click', () => settingsDialog.close());
    document.getElementById('cancel-settings-btn').addEventListener('click', () => settingsDialog.close());
    settingsDialog.addEventListener('close', () => { state.startAfterSettings = false; });
    document.getElementById('toggle-key-visibility').addEventListener('click', () => {
        settingApiKey.type = settingApiKey.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

    updateLanguageUI();
    updateLiveStatusUI('disconnected');
});
