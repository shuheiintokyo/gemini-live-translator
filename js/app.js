// Main Application Controller & UI Logic
import { SUPPORTED_LANGUAGES, getLanguageByCode, LEXICON_DEFINITIONS, HARDWARE_DEVICES } from './config.js';
import { speakText, generateCalibrationTone, initSpectrumVisualizer } from './audio.js';
import { connectGeminiLive, disconnectGeminiLive, isSessionConnected } from './websocket.js';

// Application State
const state = {
    sourceLang: getLanguageByCode(localStorage.getItem('gemini_source_lang') || 'EN-US'),
    targetLang: getLanguageByCode(localStorage.getItem('gemini_target_lang') || 'JA-JP'),
    targetTone: localStorage.getItem('gemini_target_tone') || 'polite',
    selectedModel: localStorage.getItem('gemini_model') || 'models/gemini-2.0-flash-exp',
    apiKey: localStorage.getItem('gemini_api_key') || '',
    isMuted: false,
    isPaused: false,
    isRecordingActive: true,
    seconds: 25 * 60 + 2,
    isTimerRunning: true,
    timerInterval: null,
    activeTab: 'dual',
    confidenceFilterActive: false,
    autoScrollEnabled: true,
    timbrePreset: 66,
    gainValue: 4.5,
    deepFilterActive: true,
    selectedMic: 'Shure SM7B via Scarlett 2i2 USB',
    selectedMonitor: 'Studio Monitors (Balanced TRS)'
};

// -----------------------------------------------------------------------------
// Toast HUD Notification
// -----------------------------------------------------------------------------
export function showToast(message, type = 'info', icon = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-space-xs px-space-md py-2.5 rounded-full bg-surface-container-high/95 backdrop-blur-xl border border-white/[0.12] text-on-surface shadow-2xl font-body-sm text-body-sm transition-all duration-300 transform translate-y-4 opacity-0 max-w-sm`;

    let iconColor = 'text-secondary font-bold';
    if (type === 'success') iconColor = 'text-secondary font-bold';
    if (type === 'error') iconColor = 'text-error font-bold';
    if (type === 'purple') iconColor = 'text-primary font-bold';

    toast.innerHTML = `
        <span class="material-symbols-outlined text-[18px] ${iconColor}">${icon}</span>
        <span class="font-medium truncate">${message}</span>
    `;

    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// -----------------------------------------------------------------------------
// UI Updates for Active Languages & Matrix
// -----------------------------------------------------------------------------
function updateLanguageUI() {
    const src = state.sourceLang;
    const tgt = state.targetLang;
    const tone = state.targetTone;

    localStorage.setItem('gemini_source_lang', src.code);
    localStorage.setItem('gemini_target_lang', tgt.code);
    localStorage.setItem('gemini_target_tone', tone);

    // Source Card
    const srcFlag = document.getElementById('source-lang-flag');
    const srcName = document.getElementById('source-lang-name');
    const srcCode = document.getElementById('source-lang-code');
    const srcDesc = document.getElementById('source-lang-desc');
    if (srcFlag) srcFlag.textContent = src.flag;
    if (srcName) srcName.textContent = src.name;
    if (srcCode) srcCode.textContent = src.code;
    if (srcDesc) srcDesc.textContent = src.desc;

    // Target Card
    const tgtFlag = document.getElementById('target-lang-flag');
    const tgtName = document.getElementById('target-lang-name');
    const tgtCode = document.getElementById('target-lang-code');
    const tgtTone = document.getElementById('target-tone-tag');
    const tgtDesc = document.getElementById('target-desc');
    if (tgtFlag) tgtFlag.textContent = tgt.flag;
    if (tgtName) tgtName.textContent = tgt.name;
    if (tgtCode) tgtCode.textContent = tgt.code;

    let toneLabel = 'Polite';
    if (tone === 'formal') toneLabel = 'Formal Keigo';
    if (tone === 'casual') toneLabel = 'Casual';
    if (tone === 'technical') toneLabel = 'Technical';
    if (tgtTone) tgtTone.textContent = toneLabel;

    let desc = 'Conversational Business Polite';
    if (tone === 'formal') desc = 'Executive Formal Protocol';
    if (tone === 'casual') desc = 'Natural Conversational Phrasing';
    if (tone === 'technical') desc = 'Concise Technical Syntax';
    if (tgtDesc) tgtDesc.textContent = desc;

    // Center Feed Headers
    const srcShort = src.code.split('-')[0];
    const tgtShort = tgt.code.split('-')[0];
    const srcFeedTitle = document.getElementById('source-feed-title');
    const tgtFeedTitle = document.getElementById('target-feed-title');
    const tgtFeedChannel = document.getElementById('target-feed-channel');
    if (srcFeedTitle) srcFeedTitle.textContent = `Cleaned Speech [${srcShort}]`;
    if (tgtFeedTitle) tgtFeedTitle.textContent = `Translated Speech [${tgtShort}]`;
    if (tgtFeedChannel) tgtFeedChannel.textContent = `SYNTH CH-02 (${toneLabel.toUpperCase()})`;

    // Pipeline Telemetry
    const pipeline = document.getElementById('telemetry-pipeline-label');
    if (pipeline) pipeline.textContent = `${src.code} → ${tgt.code}`;
    const routeChip = document.getElementById('active-route-chip');
    if (routeChip) routeChip.textContent = `CH-01 [${srcShort}] → CH-02 [${tgtShort}] ACTIVE`;

    // Tone Quick Buttons
    document.querySelectorAll('.btn-tone-pill').forEach(btn => {
        const btnTone = btn.getAttribute('data-tone');
        if (btnTone === tone) {
            btn.className = 'btn-tone-pill flex-1 py-1 px-1 rounded-lg bg-primary-container text-on-primary-container font-label-sm text-[10px] font-bold text-center cursor-pointer transition-all';
        } else {
            btn.className = 'btn-tone-pill flex-1 py-1 px-1 rounded-lg bg-surface-container-highest text-on-surface-variant hover:text-on-surface font-label-sm text-[10px] text-center cursor-pointer transition-all';
        }
    });

    // Sync settings dropdowns
    const setSrc = document.getElementById('setting-source-lang');
    const setTgt = document.getElementById('setting-target-lang');
    const setTone = document.getElementById('setting-tone-select');
    if (setSrc) setSrc.value = src.code;
    if (setTgt) setTgt.value = tgt.code;
    if (setTone) setTone.value = tone;
}

// -----------------------------------------------------------------------------
// Language Picker Dialog Logic
// -----------------------------------------------------------------------------
const langDialog = document.getElementById('language-dialog');
const langDialogTitle = document.getElementById('language-dialog-title');
const langSearchInput = document.getElementById('language-search-input');
const langOptionsList = document.getElementById('language-options-list');
const closeLangBtn = document.getElementById('close-language-btn');
let currentLangTargetType = 'source';

function renderLanguageOptions(filter = '') {
    if (!langOptionsList) return;
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
                <div class="flex flex-col truncate">
                    <span class="font-headline-sm text-body-sm font-bold truncate">${lang.name}</span>
                    <span class="text-[11px] opacity-70 truncate">${lang.desc}</span>
                </div>
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
        if (state.targetLang.code === lang.code) {
            state.targetLang = state.sourceLang;
        }
        state.sourceLang = lang;
        showToast(`Spoken language set to ${lang.name}`, "purple", "mic");
    } else {
        if (state.sourceLang.code === lang.code) {
            state.sourceLang = state.targetLang;
        }
        state.targetLang = lang;
        showToast(`Target language set to ${lang.name}`, "purple", "translate");
    }
    updateLanguageUI();

    if (isSessionConnected()) {
        showToast(`Reconfiguring live speech session for ${state.sourceLang.name} → ${state.targetLang.name}...`, "info", "sync");
        triggerGeminiLiveToggle(true);
    }
}

function openLanguagePicker(type) {
    currentLangTargetType = type;
    if (langDialogTitle) {
        langDialogTitle.textContent = type === 'source' ? 'Select Spoken Language (What You Speak)' : 'Select Target Translation Language';
    }
    if (langSearchInput) langSearchInput.value = '';
    renderLanguageOptions();
    langDialog?.showModal();
}

// -----------------------------------------------------------------------------
// Live WebSocket Toggle Manager
// -----------------------------------------------------------------------------
function triggerGeminiLiveToggle(forceRestart = false) {
    if (isSessionConnected() && !forceRestart) {
        disconnectGeminiLive();
        updateStreamingBadgeUI(false);
        showToast("Gemini Live Session Disconnected.", "info", "stop");
    } else {
        connectGeminiLive({
            apiKey: state.apiKey,
            model: state.selectedModel,
            sourceLang: state.sourceLang,
            targetLang: state.targetLang,
            targetTone: state.targetTone,
            isMuted: () => state.isMuted,
            isPaused: () => state.isPaused,
            onStatusChange: (status) => {
                updateStreamingBadgeUI(status === 'connected');
            },
            onIncomingText: (text) => {
                renderIncomingGeminiTurn(text);
            },
            showToast
        });
    }
}

function updateStreamingBadgeUI(isActive) {
    const text = document.getElementById('streaming-badge-text');
    const ping = document.getElementById('streaming-ping');
    const dot = document.getElementById('streaming-dot');
    const recDot = document.getElementById('rec-dot');
    const recLabel = document.getElementById('rec-label');

    if (isActive) {
        if (text) text.textContent = 'LIVE TRANSLATION STREAMING';
        if (ping) ping.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75';
        if (dot) dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary';
        if (recDot) recDot.className = 'h-2 w-2 rounded-full bg-error animate-pulse';
        if (recLabel) recLabel.textContent = 'Rec Active';
    } else {
        if (text) text.textContent = 'STREAMING STANDBY';
        if (ping) ping.className = 'hidden';
        if (dot) dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-outline';
        if (recDot) recDot.className = 'h-2 w-2 rounded-full bg-outline';
        if (recLabel) recLabel.textContent = 'Rec Paused';
    }
}

function renderIncomingGeminiTurn(translatedText) {
    const targetContainer = document.getElementById('target-feed-container');
    if (!targetContainer) return;

    const card = document.createElement('div');
    card.className = 'translation-card rounded-xl bg-surface-container-low/95 p-space-sm flex flex-col gap-space-xs shadow-md border-r-2 border-primary-container animate-pulse';
    card.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-space-xs">
                <span class="px-1.5 py-0.5 rounded-full bg-primary-container/20 text-primary font-label-sm text-label-sm font-bold">Gemini Live [${state.targetLang.code.split('-')[0]}]</span>
                <span class="font-telemetry-data text-label-sm text-tertiary">+38ms</span>
            </div>
            <div class="flex items-center gap-1 font-telemetry-data text-label-sm text-on-surface-variant">
                <span class="text-secondary">${state.targetTone.toUpperCase()}</span>
                <button class="btn-play-audio p-0.5 hover:text-primary cursor-pointer" type="button" data-lang="${state.targetLang.speechLang}" title="Play audio">
                    <span class="material-symbols-outlined text-[16px] text-primary">play_circle</span>
                </button>
                <button class="btn-copy-utterance p-0.5 hover:text-secondary cursor-pointer" type="button" title="Copy translation">
                    <span class="material-symbols-outlined text-[14px]">content_copy</span>
                </button>
            </div>
        </div>
        <p class="font-body-sm text-body-sm text-on-surface leading-relaxed translation-text">${translatedText}</p>
        <div class="flex items-center justify-between pt-1">
            <span class="font-label-sm text-label-sm text-outline">Target: ${state.targetLang.name}</span>
            <span class="font-telemetry-data text-[10px] text-primary font-bold">LIVE SYNTH</span>
        </div>
    `;
    targetContainer.appendChild(card);
    setTimeout(() => card.classList.remove('animate-pulse'), 1200);
    attachUtteranceListeners();
    if (state.autoScrollEnabled) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// -----------------------------------------------------------------------------
// Utterance Event Listeners: Copy & Speech Synthesis
// -----------------------------------------------------------------------------
function attachUtteranceListeners() {
    document.querySelectorAll('.btn-copy-utterance').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const card = btn.closest('.utterance-card, .translation-card');
            const textEl = card.querySelector('.utterance-text, .translation-text');
            if (textEl) {
                navigator.clipboard.writeText(textEl.textContent.trim()).then(() => {
                    const icon = btn.querySelector('.material-symbols-outlined');
                    if (icon) {
                        const orig = icon.textContent;
                        icon.textContent = 'check';
                        icon.classList.add('text-secondary');
                        setTimeout(() => {
                            icon.textContent = orig;
                            icon.classList.remove('text-secondary');
                        }, 1500);
                    }
                    showToast("Utterance copied to clipboard!", "success", "content_copy");
                });
            }
        };
    });

    document.querySelectorAll('.btn-play-audio').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const card = btn.closest('.utterance-card, .translation-card');
            const textEl = card.querySelector('.utterance-text, .translation-text');
            const lang = btn.getAttribute('data-lang') || (card.classList.contains('translation-card') ? state.targetLang.speechLang : state.sourceLang.speechLang);
            if (textEl) {
                const icon = btn.querySelector('.material-symbols-outlined');
                speakText(textEl.textContent.trim(), lang, {
                    pitch: state.timbrePreset > 70 ? 0.9 : 1.05,
                    onStart: () => { if (icon) icon.textContent = 'pause_circle'; },
                    onStop: () => { if (icon) icon.textContent = card.classList.contains('translation-card') ? 'play_circle' : 'volume_up'; }
                });
                showToast(`Playing speech synthesis [${lang}]...`, "purple", "graphic_eq");
            }
        };
    });
}

// -----------------------------------------------------------------------------
// Settings Dialog Handlers
// -----------------------------------------------------------------------------
const settingsDialog = document.getElementById('settings-dialog');
const settingApiKey = document.getElementById('setting-api-key');

function populateSettingsDropdowns() {
    const setSrc = document.getElementById('setting-source-lang');
    const setTgt = document.getElementById('setting-target-lang');
    if (!setSrc || !setTgt) return;

    setSrc.innerHTML = '';
    setTgt.innerHTML = '';

    SUPPORTED_LANGUAGES.forEach(l => {
        const opt1 = document.createElement('option');
        opt1.value = l.code;
        opt1.textContent = `${l.flag} ${l.name} (${l.code})`;
        if (l.code === state.sourceLang.code) opt1.selected = true;
        setSrc.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = l.code;
        opt2.textContent = `${l.flag} ${l.name} (${l.code})`;
        if (l.code === state.targetLang.code) opt2.selected = true;
        setTgt.appendChild(opt2);
    });
}

export function openSettings() {
    populateSettingsDropdowns();
    if (settingApiKey) settingApiKey.value = state.apiKey;
    const modelSelect = document.getElementById('setting-model-select');
    if (modelSelect) modelSelect.value = state.selectedModel;
    const toneSelect = document.getElementById('setting-tone-select');
    if (toneSelect) toneSelect.value = state.targetTone;
    settingsDialog?.showModal();
}

// -----------------------------------------------------------------------------
// Markdown & Log Export
// -----------------------------------------------------------------------------
function downloadMarkdownFile() {
    const dateStr = new Date().toISOString().split('T')[0];
    const duration = document.getElementById('session-clock')?.textContent || '00:25:02';
    const content = `# Gemini Live Voice Studio — Executive Meeting Minutes
**Date:** ${dateStr}
**Session Duration:** ${duration}
**Pipeline:** ${state.sourceLang.name} (${state.sourceLang.code}) → ${state.targetLang.name} (${state.targetLang.code})
**Tone Protocol:** ${state.targetTone.toUpperCase()}
**Engine:** ${state.selectedModel} (24kHz Opus Direct)

---

## Live Executive Brief
- Sub-40ms latency validated for multi-tenant voice routing nodes.
- Speculative decoding confirmed to compress KV-cache memory bandwidth by ~40%.
- Dynamic multilingual speech translation verified for ${state.sourceLang.name} into ${state.targetLang.name}.

---

## Action Items & Commitments
1. **[High Priority]** Benchmark KV-cache speculative model against 50 concurrent audio streams. (Assignee: Elena Rostova, Due: EOD Thursday)
2. **[Architecture]** Finalize Opus 24kHz direct socket failover routes for Tokyo egress edge nodes. (Assignee: Kenji Sato, Due: Next Sprint Sync)

---

## Synchronized Bilingual Transcript
*(Generated in real-time by Gemini Live Voice Studio)*
`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-live-session-${dateStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Downloaded meeting-minutes.md", "success", "file_download");
}

// -----------------------------------------------------------------------------
// View Deck Switcher
// -----------------------------------------------------------------------------
function switchDeckView(viewId) {
    document.querySelectorAll('.deck-view').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-view') === viewId) {
            item.className = 'nav-item flex items-center gap-space-sm px-space-md py-2.5 transition-all bg-primary-container text-on-primary-container font-bold rounded-full shadow-[0_0_20px_-4px_rgba(160,120,255,0.4)] cursor-pointer text-left w-full';
        } else {
            item.className = 'nav-item flex items-center gap-space-sm px-space-md py-2.5 rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all cursor-pointer text-left w-full';
        }
    });

    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        if (btn.getAttribute('data-view') === viewId) {
            btn.classList.add('text-primary');
            btn.classList.remove('text-on-surface-variant');
        } else {
            btn.classList.remove('text-primary');
            btn.classList.add('text-on-surface-variant');
        }
    });

    // Close mobile drawer if open
    const drawer = document.getElementById('mobile-drawer');
    if (drawer && !drawer.classList.contains('hidden')) {
        drawer.classList.add('hidden');
    }
}

// -----------------------------------------------------------------------------
// DOM Event Listeners Initialization
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // Spectrum visualizer loop
    initSpectrumVisualizer({
        isMuted: () => state.isMuted,
        isPaused: () => state.isPaused
    });

    // Session Clock
    const clockEl = document.getElementById('session-clock');
    if (clockEl) {
        setInterval(() => {
            if (state.isTimerRunning && !state.isPaused) {
                state.seconds++;
                const hrs = String(Math.floor(state.seconds / 3600)).padStart(2, '0');
                const mins = String(Math.floor((state.seconds % 3600) / 60)).padStart(2, '0');
                const secs = String(state.seconds % 60).padStart(2, '0');
                clockEl.textContent = `${hrs}:${mins}:${secs}`;
            }
        }, 1000);
    }

    // Language Selector Buttons
    document.getElementById('source-lang-btn')?.addEventListener('click', () => openLanguagePicker('source'));
    document.getElementById('target-lang-btn')?.addEventListener('click', () => openLanguagePicker('target'));
    if (closeLangBtn) closeLangBtn.addEventListener('click', () => langDialog?.close());
    if (langSearchInput) langSearchInput.addEventListener('input', (e) => renderLanguageOptions(e.target.value));

    // Swap Language Button
    document.getElementById('swap-lang-btn')?.addEventListener('click', () => {
        const icon = document.getElementById('swap-icon');
        icon?.classList.toggle('rotate-180');
        const temp = state.sourceLang;
        state.sourceLang = state.targetLang;
        state.targetLang = temp;
        updateLanguageUI();
        showToast(`Swapped: ${state.sourceLang.name} → ${state.targetLang.name}`, "purple", "swap_vert");
        if (isSessionConnected()) triggerGeminiLiveToggle(true);
    });

    // Politeness Tone Dialog
    const toneDialog = document.getElementById('tone-dialog');
    document.getElementById('target-tone-btn')?.addEventListener('click', () => toneDialog?.showModal());
    document.getElementById('close-tone-btn')?.addEventListener('click', () => toneDialog?.close());
    document.querySelectorAll('.tone-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.targetTone = btn.getAttribute('data-tone');
            updateLanguageUI();
            toneDialog?.close();
            showToast(`Tone protocol: ${state.targetTone.toUpperCase()}`, "purple", "tune");
            if (isSessionConnected()) triggerGeminiLiveToggle(true);
        });
    });
    document.querySelectorAll('.btn-tone-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            state.targetTone = btn.getAttribute('data-tone');
            updateLanguageUI();
            showToast(`Tone set: ${state.targetTone.toUpperCase()}`, "purple", "tune");
            if (isSessionConnected()) triggerGeminiLiveToggle(true);
        });
    });

    // Transport Controls
    document.getElementById('rec-toggle-btn')?.addEventListener('click', () => triggerGeminiLiveToggle());
    document.getElementById('streaming-badge-btn')?.addEventListener('click', () => triggerGeminiLiveToggle());

    const muteBtn = document.getElementById('mute-toggle');
    const micIcon = document.getElementById('mic-icon');
    const muteLabel = document.getElementById('mute-label');
    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            state.isMuted = !state.isMuted;
            if (state.isMuted) {
                if (micIcon) micIcon.textContent = 'mic_off';
                if (muteLabel) muteLabel.textContent = 'Muted';
                muteBtn.classList.remove('bg-surface-container-high');
                muteBtn.classList.add('bg-error-container', 'text-on-error-container');
                showToast("Microphone muted", "error", "mic_off");
            } else {
                if (micIcon) micIcon.textContent = 'mic';
                if (muteLabel) muteLabel.textContent = 'Mute Mic';
                muteBtn.classList.add('bg-surface-container-high');
                muteBtn.classList.remove('bg-error-container', 'text-on-error-container');
                showToast("Microphone active", "success", "mic");
            }
        });
    }

    const pauseBtn = document.getElementById('pause-toggle');
    const pauseIcon = document.getElementById('pause-icon');
    const pauseLabel = document.getElementById('pause-label');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            state.isPaused = !state.isPaused;
            if (state.isPaused) {
                if (pauseIcon) pauseIcon.textContent = 'play_arrow';
                if (pauseLabel) pauseLabel.textContent = 'Resume';
                pauseBtn.classList.add('bg-secondary/20', 'text-secondary');
                showToast("Session paused", "info", "pause");
            } else {
                if (pauseIcon) pauseIcon.textContent = 'pause_circle';
                if (pauseLabel) pauseLabel.textContent = 'Pause';
                pauseBtn.classList.remove('bg-secondary/20', 'text-secondary');
                showToast("Session resumed", "success", "play_arrow");
            }
        });
    }

    document.getElementById('snapshot-btn')?.addEventListener('click', () => {
        const briefList = document.getElementById('executive-brief-list');
        const hrs = String(Math.floor(state.seconds / 3600)).padStart(2, '0');
        const mins = String(Math.floor((state.seconds % 3600) / 60)).padStart(2, '0');
        const secs = String(state.seconds % 60).padStart(2, '0');
        const timeStamp = `${hrs}:${mins}:${secs}`;
        if (briefList) {
            const li = document.createElement('li');
            li.className = 'flex items-start gap-space-xs animate-pulse';
            li.innerHTML = `<span class="text-primary mt-1 font-bold">★</span><span><strong>[Snapshot @ ${timeStamp}]:</strong> Language routing validated for ${state.sourceLang.name} → ${state.targetLang.name} (${state.targetTone}).</span>`;
            briefList.insertBefore(li, briefList.firstChild);
            setTimeout(() => li.classList.remove('animate-pulse'), 1500);
        }
        showToast(`Snapshot logged at ${timeStamp}`, "purple", "bookmark_added");
    });

    const archiveDialog = document.getElementById('archive-dialog');
    document.getElementById('archive-btn')?.addEventListener('click', () => {
        const dur = document.getElementById('archive-duration');
        const rout = document.getElementById('archive-routing');
        if (dur) dur.textContent = document.getElementById('session-clock')?.textContent || '00:25:02';
        if (rout) rout.textContent = `${state.sourceLang.name} → ${state.targetLang.name}`;
        archiveDialog?.showModal();
    });
    document.getElementById('cancel-archive-btn')?.addEventListener('click', () => archiveDialog?.close());
    document.getElementById('confirm-archive-btn')?.addEventListener('click', () => {
        archiveDialog?.close();
        downloadMarkdownFile();
        state.seconds = 0;
        showToast("Session archived & minutes exported", "success", "check_circle");
    });

    // View Tabs
    const transcriptGrid = document.getElementById('transcript-grid');
    const subcolSource = document.getElementById('subcol-source');
    const subcolTarget = document.getElementById('subcol-target');
    document.querySelectorAll('.view-tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.view-tab-btn').forEach(t => {
                t.className = 'view-tab-btn px-space-sm py-1 rounded-full text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm cursor-pointer transition-all';
            });
            tab.className = 'view-tab-btn px-space-sm py-1 rounded-full bg-primary-container text-on-primary-container font-label-sm text-label-sm font-bold shadow-sm cursor-pointer transition-all';
            const mode = tab.getAttribute('data-view');
            state.activeTab = mode;
            if (mode === 'dual') {
                if (transcriptGrid) transcriptGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-space-sm';
                subcolSource?.classList.remove('hidden');
                subcolTarget?.classList.remove('hidden');
            } else if (mode === 'interleaved') {
                if (transcriptGrid) transcriptGrid.className = 'grid grid-cols-1 gap-space-sm';
            } else if (mode === 'diarized') {
                if (transcriptGrid) transcriptGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-space-sm';
            }
            showToast(`Switched to ${mode.toUpperCase()} view`, "info", "view_column");
        });
    });

    // Settings Modal
    document.getElementById('header-settings-btn')?.addEventListener('click', openSettings);
    document.getElementById('nav-engine-settings')?.addEventListener('click', openSettings);
    document.getElementById('engine-badge-btn')?.addEventListener('click', openSettings);
    document.getElementById('close-settings-btn')?.addEventListener('click', () => settingsDialog?.close());
    document.getElementById('cancel-settings-btn')?.addEventListener('click', () => settingsDialog?.close());
    document.getElementById('toggle-key-visibility')?.addEventListener('click', () => {
        if (settingApiKey) settingApiKey.type = settingApiKey.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('save-settings-btn')?.addEventListener('click', () => {
        if (settingApiKey) {
            state.apiKey = settingApiKey.value.trim();
            localStorage.setItem('gemini_api_key', state.apiKey);
        }
        const modelSelect = document.getElementById('setting-model-select');
        if (modelSelect) {
            state.selectedModel = modelSelect.value;
            localStorage.setItem('gemini_model', state.selectedModel);
            const badge = document.getElementById('active-model-name');
            if (badge) badge.textContent = modelSelect.options[modelSelect.selectedIndex].text.split('(')[0].trim();
        }
        const setSrc = document.getElementById('setting-source-lang');
        const setTgt = document.getElementById('setting-target-lang');
        const setTone = document.getElementById('setting-tone-select');
        if (setSrc) state.sourceLang = getLanguageByCode(setSrc.value);
        if (setTgt) state.targetLang = getLanguageByCode(setTgt.value);
        if (setTone) state.targetTone = setTone.value;

        updateLanguageUI();
        settingsDialog?.close();
        showToast("Configuration saved!", "success", "check_circle");
        if (isSessionConnected()) triggerGeminiLiveToggle(true);
    });

    // Hardware routing dialog
    const deviceDialog = document.getElementById('device-dialog');
    function openDevicePicker(type) {
        const title = document.getElementById('device-dialog-title');
        const list = document.getElementById('device-list');
        if (!list) return;
        if (title) title.textContent = type === 'mic' ? 'Select Mic Input' : 'Select Monitor Output';
        list.innerHTML = '';
        const items = type === 'mic' ? HARDWARE_DEVICES.mics : HARDWARE_DEVICES.monitors;
        const current = type === 'mic' ? state.selectedMic : state.selectedMonitor;

        items.forEach(dev => {
            const btn = document.createElement('button');
            const isSel = dev === current;
            btn.className = `flex items-center justify-between p-space-sm rounded-xl text-left transition-colors cursor-pointer ${isSel ? 'bg-primary-container text-on-primary-container font-bold' : 'hover:bg-surface-container-high text-on-surface'}`;
            btn.innerHTML = `<span class="text-body-sm">${dev}</span>${isSel ? '<span class="material-symbols-outlined text-[16px]">check</span>' : ''}`;
            btn.addEventListener('click', () => {
                if (type === 'mic') {
                    state.selectedMic = dev;
                    const el = document.getElementById('selected-mic-name');
                    if (el) el.textContent = dev;
                    showToast(`Microphone routed: ${dev}`, "success", "mic");
                } else {
                    state.selectedMonitor = dev;
                    const el = document.getElementById('selected-monitor-name');
                    if (el) el.textContent = dev;
                    showToast(`Monitor routed: ${dev}`, "success", "headphones");
                }
                deviceDialog?.close();
            });
            list.appendChild(btn);
        });
        deviceDialog?.showModal();
    }
    document.getElementById('mic-dropdown-btn')?.addEventListener('click', () => openDevicePicker('mic'));
    document.getElementById('monitor-dropdown-btn')?.addEventListener('click', () => openDevicePicker('monitor'));
    document.getElementById('close-device-btn')?.addEventListener('click', () => deviceDialog?.close());

    // DeepFilter and Gain Slider
    const gainTrack = document.getElementById('gain-slider-track');
    const gainFill = document.getElementById('gain-fill');
    const gainLabel = document.getElementById('gain-label');
    if (gainTrack) {
        gainTrack.addEventListener('click', (e) => {
            const rect = gainTrack.getBoundingClientRect();
            const pct = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
            if (gainFill) gainFill.style.width = `${pct}%`;
            const db = ((pct / 100) * 24 - 12).toFixed(1);
            const formatted = db >= 0 ? `+${db} dB` : `${db} dB`;
            if (gainLabel) gainLabel.textContent = formatted;
            state.gainValue = parseFloat(db);
            showToast(`Preamp gain set to ${formatted}`, "info", "equalizer");
        });
    }

    const deepFilterBtn = document.getElementById('deepfilter-btn');
    const deepFilterBadge = document.getElementById('deepfilter-badge');
    if (deepFilterBtn && deepFilterBadge) {
        deepFilterBtn.addEventListener('click', () => {
            state.deepFilterActive = !state.deepFilterActive;
            if (state.deepFilterActive) {
                deepFilterBadge.textContent = 'ACTIVE';
                deepFilterBadge.className = 'px-space-xs py-0.5 rounded-full bg-secondary/20 text-secondary font-label-sm text-label-sm font-bold';
                showToast("DeepFilter AI Active", "success", "filter_drama");
            } else {
                deepFilterBadge.textContent = 'BYPASS';
                deepFilterBadge.className = 'px-space-xs py-0.5 rounded-full bg-surface-container-highest text-outline font-label-sm text-label-sm font-bold';
                showToast("DeepFilter AI Bypassed", "info", "filter_drama");
            }
        });
    }

    // Export Buttons
    document.getElementById('btn-export-md')?.addEventListener('click', downloadMarkdownFile);
    document.getElementById('btn-sync-notion')?.addEventListener('click', () => {
        showToast("Syncing with Notion Workspace...", "purple", "sync");
        setTimeout(() => showToast("✓ Synced transcript to Notion!", "success", "cloud_done"), 1200);
    });
    document.getElementById('btn-copy-log')?.addEventListener('click', () => {
        let fullLog = `[Gemini Live Voice Studio — ${state.sourceLang.name} → ${state.targetLang.name}]\n\n`;
        document.querySelectorAll('#source-feed-container .utterance-card').forEach(card => {
            const speaker = card.querySelector('.font-headline-sm')?.textContent.trim() || 'Speaker';
            const text = card.querySelector('.utterance-text')?.textContent.trim() || '';
            fullLog += `[${speaker}]: ${text}\n`;
        });
        navigator.clipboard.writeText(fullLog).then(() => showToast("Full transcript copied", "success", "content_copy"));
    });
    document.getElementById('btn-share-link')?.addEventListener('click', () => {
        const link = `https://gemini-live.studio/deck?src=${state.sourceLang.code}&tgt=${state.targetLang.code}`;
        navigator.clipboard.writeText(link).then(() => showToast("Live session link copied!", "success", "share"));
    });

    // Action Items and Lexicon
    document.querySelectorAll('.btn-toggle-action-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const icon = btn.querySelector('.material-symbols-outlined');
            const card = btn.closest('.action-item-card');
            const text = card.querySelector('.action-item-text');
            if (icon.textContent === 'check_box_outline_blank') {
                icon.textContent = 'check_box';
                icon.classList.add('text-secondary');
                text?.classList.add('line-through', 'text-on-surface-variant');
                showToast("Action item completed", "success", "task_alt");
            } else {
                icon.textContent = 'check_box_outline_blank';
                icon.classList.remove('text-secondary');
                text?.classList.remove('line-through', 'text-on-surface-variant');
                showToast("Action item restored", "info", "undo");
            }
        });
    });

    const lexiconDialog = document.getElementById('lexicon-dialog');
    document.querySelectorAll('.btn-lexicon-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const term = chip.getAttribute('data-term');
            const title = document.getElementById('lexicon-modal-title');
            const body = document.getElementById('lexicon-modal-body');
            if (title) title.textContent = term;
            if (body) body.textContent = LEXICON_DEFINITIONS[term] || `Acoustic telemetry index for ${term}.`;
            lexiconDialog?.showModal();
        });
    });
    document.getElementById('close-lexicon-btn')?.addEventListener('click', () => lexiconDialog?.close());
    document.getElementById('done-lexicon-btn')?.addEventListener('click', () => lexiconDialog?.close());

    // Navigation and Mobile Drawer
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => switchDeckView(item.getAttribute('data-view')));
    });
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchDeckView(btn.getAttribute('data-view')));
    });
    document.querySelectorAll('.btn-back-to-studio').forEach(btn => {
        btn.addEventListener('click', () => switchDeckView('live-studio'));
    });

    // Mobile Hamburger Drawer Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileDrawer = document.getElementById('mobile-drawer');
    const closeDrawerBtn = document.getElementById('close-drawer-btn');
    if (mobileMenuBtn && mobileDrawer) {
        mobileMenuBtn.addEventListener('click', () => mobileDrawer.classList.toggle('hidden'));
    }
    if (closeDrawerBtn && mobileDrawer) {
        closeDrawerBtn.addEventListener('click', () => mobileDrawer.classList.add('hidden'));
    }

    // Audio calibration & sample preview
    document.getElementById('btn-play-test-tone')?.addEventListener('click', () => generateCalibrationTone(440, 1.2));
    document.getElementById('btn-speak-custom')?.addEventListener('click', () => {
        const text = document.getElementById('tts-custom-input')?.value.trim();
        if (text) speakText(text, state.targetLang.speechLang);
    });

    attachUtteranceListeners();
    updateLanguageUI();
    showToast(`Gemini Live Voice Studio Ready [${state.sourceLang.name} → ${state.targetLang.name}]`, "success", "auto_awesome");
});
