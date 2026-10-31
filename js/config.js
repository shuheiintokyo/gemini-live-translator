// Configuration, Supported Languages, and Live Models
export const SUPPORTED_LANGUAGES = [
    { code: 'EN-US', name: 'English (US)', flag: '🇺🇸', voiceName: 'Zephyr' },
    { code: 'JA-JP', name: 'Japanese (日本語)', flag: '🇯🇵', voiceName: 'Kore' },
    { code: 'EN-GB', name: 'English (UK)', flag: '🇬🇧', voiceName: 'Puck' },
    { code: 'ES-ES', name: 'Spanish (Español)', flag: '🇪🇸', voiceName: 'Aoede' },
    { code: 'FR-FR', name: 'French (Français)', flag: '🇫🇷', voiceName: 'Fenrir' },
    { code: 'DE-DE', name: 'German (Deutsch)', flag: '🇩🇪', voiceName: 'Kore' },
    { code: 'ZH-CN', name: 'Chinese (Mandarin / 中文)', flag: '🇨🇳', voiceName: 'Aoede' },
    { code: 'KO-KR', name: 'Korean (한국어)', flag: '🇰🇷', voiceName: 'Kore' },
    { code: 'IT-IT', name: 'Italian (Italiano)', flag: '🇮🇹', voiceName: 'Zephyr' },
    { code: 'PT-BR', name: 'Portuguese (Português)', flag: '🇧🇷', voiceName: 'Puck' },
    { code: 'HI-IN', name: 'Hindi (हिन्दी)', flag: '🇮🇳', voiceName: 'Fenrir' },
    { code: 'AR-SA', name: 'Arabic (العربية)', flag: '🇸🇦', voiceName: 'Kore' },
    { code: 'RU-RU', name: 'Russian (Русский)', flag: '🇷🇺', voiceName: 'Fenrir' },
    { code: 'NL-NL', name: 'Dutch (Nederlands)', flag: '🇳🇱', voiceName: 'Zephyr' },
    { code: 'VI-VN', name: 'Vietnamese (Tiếng Việt)', flag: '🇻🇳', voiceName: 'Aoede' }
];

export function getLanguageByCode(code) {
    return SUPPORTED_LANGUAGES.find(l => l.code === code) || SUPPORTED_LANGUAGES[0];
}

export const LIVE_MODELS = [
    { id: 'models/gemini-3.8-live', label: 'Gemini 3.8 Live', isTranslateModel: false },
    { id: 'models/gemini-3.5-live-translate-preview', label: 'Gemini 3.5 Live Translate (Preview)', isTranslateModel: true }
];

export function getLiveModel(id) {
    return LIVE_MODELS.find(m => m.id === id) || LIVE_MODELS[0];
}

// The Live Translate model takes plain BCP-47 codes, e.g. "ja", "zh-Hans", "pt-BR"
export function getTranslationLanguageCode(lang) {
    if (lang.code === 'ZH-CN') return 'zh-Hans';
    if (lang.code === 'PT-BR') return 'pt-BR';
    return lang.code.split('-')[0].toLowerCase();
}

export function buildSystemInstruction(sourceLang, targetLang, tone = 'polite') {
    let toneGuidance = "natural, accurate, and fluent";
    if (targetLang.code === 'JA-JP') {
        if (tone === 'formal') {
            toneGuidance = "formal executive honorific Japanese (尊敬語・謙譲語 - Sonkeigo and Kenjougo). Use respectful corporate executive diction.";
        } else if (tone === 'casual') {
            toneGuidance = "natural, friendly casual conversational Japanese (親しみやすい日常会話). Friendly, colloquial, and warm.";
        } else if (tone === 'technical') {
            toneGuidance = "direct, concise technical Japanese (常体・技術用語重視). Clear, unambiguous, and succinct.";
        } else {
            toneGuidance = "polite business Japanese (丁寧語・ビジネス敬語 - Teineigo). Professional, courteous, and standard.";
        }
    } else if (tone === 'formal') {
        toneGuidance = "executive, formal, and diplomatic diction";
    } else if (tone === 'casual') {
        toneGuidance = "natural, friendly conversational phrasing";
    } else if (tone === 'technical') {
        toneGuidance = "concise, exact, technical precision";
    } else {
        toneGuidance = "polite, clear, and professional translation";
    }

    return `You are a professional real-time speech-to-speech translator.
The user is speaking in ${sourceLang.name} (${sourceLang.code}).
Your job is to continuously translate everything the user speaks into ${targetLang.name} (${targetLang.code}) using ${toneGuidance}.

Strict guidelines:
1. Speak the direct translation immediately without commentary, preambles, or conversational replies.
2. DO NOT answer questions or engage in conversation with the user; translate ONLY what the user said into ${targetLang.name}.
3. If the user asks a question, translate the question itself into ${targetLang.name}.
4. Preserve all technical terminology, domain names, and numbers accurately.`;
}
