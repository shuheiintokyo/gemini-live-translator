// Configuration, Supported Languages, and Global Constants
export const SUPPORTED_LANGUAGES = [
    { code: 'EN-US', name: 'English (US)', flag: '🇺🇸', speechLang: 'en-US', desc: 'Realtime Neural VAD • Low Jitter', voiceName: 'Zephyr' },
    { code: 'JA-JP', name: 'Japanese (日本語)', flag: '🇯🇵', speechLang: 'ja-JP', desc: 'Keigo Politeness Protocol Active', voiceName: 'Kore' },
    { code: 'EN-GB', name: 'English (UK)', flag: '🇬🇧', speechLang: 'en-GB', desc: 'Standard British Prosody & Idioms', voiceName: 'Puck' },
    { code: 'ES-ES', name: 'Spanish (Español)', flag: '🇪🇸', speechLang: 'es-ES', desc: 'Castilian & Latin American Spanish', voiceName: 'Aoede' },
    { code: 'FR-FR', name: 'French (Français)', flag: '🇫🇷', speechLang: 'fr-FR', desc: 'Metropolitan French Natural Phrasing', voiceName: 'Fenrir' },
    { code: 'DE-DE', name: 'German (Deutsch)', flag: '🇩🇪', speechLang: 'de-DE', desc: 'Standard Hochdeutsch Articulation', voiceName: 'Kore' },
    { code: 'ZH-CN', name: 'Chinese (Mandarin / 中文)', flag: '🇨🇳', speechLang: 'zh-CN', desc: 'Putonghua Standard Four Tones', voiceName: 'Aoede' },
    { code: 'KO-KR', name: 'Korean (한국어)', flag: '🇰🇷', speechLang: 'ko-KR', desc: 'Honorific Jondaetmal (존댓말) Tuning', voiceName: 'Kore' },
    { code: 'IT-IT', name: 'Italian (Italiano)', flag: '🇮🇹', speechLang: 'it-IT', desc: 'Standard Italian Conversational Flow', voiceName: 'Zephyr' },
    { code: 'PT-BR', name: 'Portuguese (Português)', flag: '🇧🇷', speechLang: 'pt-BR', desc: 'Brazilian & Iberian Portuguese', voiceName: 'Puck' },
    { code: 'HI-IN', name: 'Hindi (हिन्दी)', flag: '🇮🇳', speechLang: 'hi-IN', desc: 'Standard Hindi & Modern Conversational', voiceName: 'Fenrir' },
    { code: 'AR-SA', name: 'Arabic (العربية)', flag: '🇸🇦', speechLang: 'ar-SA', desc: 'Modern Standard Arabic (الفصحى)', voiceName: 'Kore' },
    { code: 'RU-RU', name: 'Russian (Русский)', flag: '🇷🇺', speechLang: 'ru-RU', desc: 'Standard Literary Russian Cadence', voiceName: 'Fenrir' },
    { code: 'NL-NL', name: 'Dutch (Nederlands)', flag: '🇳🇱', speechLang: 'nl-NL', desc: 'Standard Algemeen Nederlands', voiceName: 'Zephyr' },
    { code: 'VI-VN', name: 'Vietnamese (Tiếng Việt)', flag: '🇻🇳', speechLang: 'vi-VN', desc: 'Northern & Southern Tonal Prosody', voiceName: 'Aoede' }
];

export function getLanguageByCode(code) {
    return SUPPORTED_LANGUAGES.find(l => l.code === code) || SUPPORTED_LANGUAGES[0];
}

export const LEXICON_DEFINITIONS = {
    'KV-Cache Compression': 'A speculative decoding optimization that compresses key-value cache memory footprints by ~40% during cross-lingual sentence tokenization.',
    '推論レイテンシ': 'Inference latency: Time elapsed from incoming 16kHz audio packet ingestion to initial decoded token generation in Gemini 2.5 Argon.',
    'Cross-Lingual Diarization': 'Real-time multi-speaker acoustic segregation separating distinct voice prints across concurrent multilingual channels.',
    'Keigo Politeness': 'Japanese honorific language structure (丁寧語, 尊敬語, 謙譲語) maintained dynamically to preserve executive business etiquette.',
    'WebRTC Opus 24kHz': 'Low-delay wideband audio codec transmitting 24kHz sampled voice packets over bidirectional WebRTC data channels.'
};

export const HARDWARE_DEVICES = {
    mics: [
        'Shure SM7B via Scarlett 2i2 USB',
        'Built-In Device Array / Mobile Mic',
        'Rode VideoMic NTG (USB-C)',
        'Virtual Aggregate Loopback Device'
    ],
    monitors: [
        'Studio Monitors (Balanced TRS)',
        'Wireless Headphones (Opus Direct)',
        'Built-in Device Speaker Output',
        'System Default Audio Out'
    ]
};

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
1. Provide the direct translation immediately without commentary, preambles, or conversational replies.
2. Output both text transcription of the translation and synthesized voice audio.
3. DO NOT answer questions or engage in conversation with the user; translate ONLY what the user said into ${targetLang.name}.
4. If the user asks a question, translate the question itself into ${targetLang.name}.
5. Preserve all technical terminology, domain names, and numbers accurately.`;
}
