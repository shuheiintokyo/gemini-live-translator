// Configuration, Supported Languages, and Live Models
export const SUPPORTED_LANGUAGES = [
    { code: 'EN-US', name: 'English (US)', flag: '🇺🇸', voiceName: 'Zephyr' },
    { code: 'JA-JP', name: 'Japanese (日本語)', flag: '🇯🇵', voiceName: 'Kore' },
    { code: 'EN-GB', name: 'English (UK)', flag: '🇬🇧', voiceName: 'Puck' },
    { code: 'ES-ES', name: 'Spanish (Español)', flag: '🇪🇸', voiceName: 'Aoede' },
    { code: 'FR-FR', name: 'French (Français)', flag: '🇫🇷', voiceName: 'Fenrir' },
    { code: 'DE-DE', name: 'German (Deutsch)', flag: '🇩🇪', voiceName: 'Kore' },
    { code: 'ZH-CN', name: 'Chinese (Simplified / 简体中文)', flag: '🇨🇳', voiceName: 'Aoede' },
    { code: 'KO-KR', name: 'Korean (한국어)', flag: '🇰🇷', voiceName: 'Kore' },
    { code: 'IT-IT', name: 'Italian (Italiano)', flag: '🇮🇹', voiceName: 'Zephyr' },
    { code: 'PT-BR', name: 'Portuguese (Brazil)', flag: '🇧🇷', voiceName: 'Puck' },
    { code: 'HI-IN', name: 'Hindi (हिन्दी)', flag: '🇮🇳', voiceName: 'Fenrir' },
    { code: 'AR-SA', name: 'Arabic (العربية)', flag: '🇸🇦', voiceName: 'Kore' },
    { code: 'RU-RU', name: 'Russian (Русский)', flag: '🇷🇺', voiceName: 'Fenrir' },
    { code: 'NL-NL', name: 'Dutch (Nederlands)', flag: '🇳🇱', voiceName: 'Zephyr' },
    { code: 'VI-VN', name: 'Vietnamese (Tiếng Việt)', flag: '🇻🇳', voiceName: 'Aoede' },
    { code: 'AF-ZA', name: 'Afrikaans', flag: '🇿🇦', voiceName: 'Zephyr' },
    { code: 'AK-GH', name: 'Akan', flag: '🇬🇭', voiceName: 'Kore' },
    { code: 'SQ-AL', name: 'Albanian (Shqip)', flag: '🇦🇱', voiceName: 'Puck' },
    { code: 'AM-ET', name: 'Amharic (አማርኛ)', flag: '🇪🇹', voiceName: 'Aoede' },
    { code: 'HY-AM', name: 'Armenian (Հայերեն)', flag: '🇦🇲', voiceName: 'Fenrir' },
    { code: 'AZ-AZ', name: 'Azerbaijani (Azərbaycan)', flag: '🇦🇿', voiceName: 'Zephyr' },
    { code: 'EU-ES', name: 'Basque (Euskara)', flag: '🇪🇸', voiceName: 'Kore' },
    { code: 'BE-BY', name: 'Belarusian (Беларуская)', flag: '🇧🇾', voiceName: 'Puck' },
    { code: 'BN-BD', name: 'Bengali (বাংলা)', flag: '🇧🇩', voiceName: 'Aoede' },
    { code: 'BG-BG', name: 'Bulgarian (Български)', flag: '🇧🇬', voiceName: 'Fenrir' },
    { code: 'MY-MM', name: 'Burmese (မြန်မာ)', flag: '🇲🇲', voiceName: 'Zephyr' },
    { code: 'CA-ES', name: 'Catalan (Català)', flag: '🇪🇸', voiceName: 'Kore' },
    { code: 'ZH-TW', name: 'Chinese (Traditional / 繁體中文)', flag: '🇹🇼', voiceName: 'Puck' },
    { code: 'HR-HR', name: 'Croatian (Hrvatski)', flag: '🇭🇷', voiceName: 'Aoede' },
    { code: 'CS-CZ', name: 'Czech (Čeština)', flag: '🇨🇿', voiceName: 'Fenrir' },
    { code: 'DA-DK', name: 'Danish (Dansk)', flag: '🇩🇰', voiceName: 'Zephyr' },
    { code: 'ET-EE', name: 'Estonian (Eesti)', flag: '🇪🇪', voiceName: 'Kore' },
    { code: 'FIL-PH', name: 'Filipino', flag: '🇵🇭', voiceName: 'Puck' },
    { code: 'FI-FI', name: 'Finnish (Suomi)', flag: '🇫🇮', voiceName: 'Aoede' },
    { code: 'GL-ES', name: 'Galician (Galego)', flag: '🇪🇸', voiceName: 'Fenrir' },
    { code: 'KA-GE', name: 'Georgian (ქართული)', flag: '🇬🇪', voiceName: 'Zephyr' },
    { code: 'EL-GR', name: 'Greek (Ελληνικά)', flag: '🇬🇷', voiceName: 'Kore' },
    { code: 'GU-IN', name: 'Gujarati (ગુજરાતી)', flag: '🇮🇳', voiceName: 'Puck' },
    { code: 'HA-NG', name: 'Hausa', flag: '🇳🇬', voiceName: 'Aoede' },
    { code: 'HE-IL', name: 'Hebrew (עברית)', flag: '🇮🇱', voiceName: 'Fenrir' },
    { code: 'HU-HU', name: 'Hungarian (Magyar)', flag: '🇭🇺', voiceName: 'Zephyr' },
    { code: 'IS-IS', name: 'Icelandic (Íslenska)', flag: '🇮🇸', voiceName: 'Kore' },
    { code: 'ID-ID', name: 'Indonesian (Bahasa Indonesia)', flag: '🇮🇩', voiceName: 'Puck' },
    { code: 'KN-IN', name: 'Kannada (ಕನ್ನಡ)', flag: '🇮🇳', voiceName: 'Aoede' },
    { code: 'KK-KZ', name: 'Kazakh (Қазақша)', flag: '🇰🇿', voiceName: 'Fenrir' },
    { code: 'KM-KH', name: 'Khmer (ខ្មែរ)', flag: '🇰🇭', voiceName: 'Zephyr' },
    { code: 'RW-RW', name: 'Kinyarwanda', flag: '🇷🇼', voiceName: 'Kore' },
    { code: 'LO-LA', name: 'Lao (ລາວ)', flag: '🇱🇦', voiceName: 'Puck' },
    { code: 'LV-LV', name: 'Latvian (Latviešu)', flag: '🇱🇻', voiceName: 'Aoede' },
    { code: 'LT-LT', name: 'Lithuanian (Lietuvių)', flag: '🇱🇹', voiceName: 'Fenrir' },
    { code: 'MK-MK', name: 'Macedonian (Македонски)', flag: '🇲🇰', voiceName: 'Zephyr' },
    { code: 'MS-MY', name: 'Malay (Bahasa Melayu)', flag: '🇲🇾', voiceName: 'Kore' },
    { code: 'ML-IN', name: 'Malayalam (മലയാളം)', flag: '🇮🇳', voiceName: 'Puck' },
    { code: 'MR-IN', name: 'Marathi (मराठी)', flag: '🇮🇳', voiceName: 'Aoede' },
    { code: 'MN-MN', name: 'Mongolian (Монгол)', flag: '🇲🇳', voiceName: 'Fenrir' },
    { code: 'NE-NP', name: 'Nepali (नेपाली)', flag: '🇳🇵', voiceName: 'Zephyr' },
    { code: 'NO-NO', name: 'Norwegian (Norsk)', flag: '🇳🇴', voiceName: 'Kore' },
    { code: 'FA-IR', name: 'Persian (فارسی)', flag: '🇮🇷', voiceName: 'Puck' },
    { code: 'PL-PL', name: 'Polish (Polski)', flag: '🇵🇱', voiceName: 'Aoede' },
    { code: 'PT-PT', name: 'Portuguese (Portugal)', flag: '🇵🇹', voiceName: 'Fenrir' },
    { code: 'PA-IN', name: 'Punjabi (ਪੰਜਾਬੀ)', flag: '🇮🇳', voiceName: 'Zephyr' },
    { code: 'RO-RO', name: 'Romanian (Română)', flag: '🇷🇴', voiceName: 'Kore' },
    { code: 'SR-RS', name: 'Serbian (Српски)', flag: '🇷🇸', voiceName: 'Puck' },
    { code: 'SD-PK', name: 'Sindhi (سنڌي)', flag: '🇵🇰', voiceName: 'Aoede' },
    { code: 'SI-LK', name: 'Sinhala (සිංහල)', flag: '🇱🇰', voiceName: 'Fenrir' },
    { code: 'SK-SK', name: 'Slovak (Slovenčina)', flag: '🇸🇰', voiceName: 'Zephyr' },
    { code: 'SL-SI', name: 'Slovenian (Slovenščina)', flag: '🇸🇮', voiceName: 'Kore' },
    { code: 'SW-KE', name: 'Swahili (Kiswahili)', flag: '🇰🇪', voiceName: 'Puck' },
    { code: 'SV-SE', name: 'Swedish (Svenska)', flag: '🇸🇪', voiceName: 'Aoede' },
    { code: 'TA-IN', name: 'Tamil (தமிழ்)', flag: '🇮🇳', voiceName: 'Fenrir' },
    { code: 'TE-IN', name: 'Telugu (తెలుగు)', flag: '🇮🇳', voiceName: 'Zephyr' },
    { code: 'TH-TH', name: 'Thai (ไทย)', flag: '🇹🇭', voiceName: 'Kore' },
    { code: 'TR-TR', name: 'Turkish (Türkçe)', flag: '🇹🇷', voiceName: 'Puck' },
    { code: 'UK-UA', name: 'Ukrainian (Українська)', flag: '🇺🇦', voiceName: 'Aoede' },
    { code: 'UR-PK', name: 'Urdu (اردو)', flag: '🇵🇰', voiceName: 'Fenrir' },
    { code: 'UZ-UZ', name: 'Uzbek (Oʻzbek)', flag: '🇺🇿', voiceName: 'Zephyr' },
    { code: 'ZU-ZA', name: 'Zulu (isiZulu)', flag: '🇿🇦', voiceName: 'Kore' }
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
    if (lang.code === 'ZH-TW') return 'zh-Hant';
    if (lang.code === 'PT-BR') return 'pt-BR';
    if (lang.code === 'PT-PT') return 'pt-PT';
    return lang.code.split('-')[0].toLowerCase();
}

function getToneGuidance(targetLang, tone) {
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
    return toneGuidance;
}

export function buildSystemInstruction(sourceLang, targetLang, tone = 'polite') {
    const toneGuidance = getToneGuidance(targetLang, tone);

    return `You are a professional real-time speech-to-speech translator.
The user is speaking in ${sourceLang.name} (${sourceLang.code}).
Your job is to continuously translate everything the user speaks into ${targetLang.name} (${targetLang.code}) using ${toneGuidance}.

Strict guidelines:
1. Speak the direct translation immediately without commentary, preambles, or conversational replies.
2. DO NOT answer questions or engage in conversation with the user; translate ONLY what the user said into ${targetLang.name}.
3. If the user asks a question, translate the question itself into ${targetLang.name}.
4. Preserve all technical terminology, domain names, and numbers accurately.`;
}

export function buildBothWaysInstruction(yourLang, theirLang, tone = 'polite') {
    return `You are a professional real-time interpreter between two people in a conversation.
One person speaks ${yourLang.name} (${yourLang.code}) and the other speaks ${theirLang.name} (${theirLang.code}).

Detect which of the two languages was just spoken:
- If it was ${yourLang.name}, speak the translation in ${theirLang.name} using ${getToneGuidance(theirLang, tone)}.
- If it was ${theirLang.name}, speak the translation in ${yourLang.name} using natural, accurate, and fluent phrasing.

Strict guidelines:
1. Speak the direct translation immediately without commentary, preambles, or conversational replies.
2. DO NOT answer questions or engage in conversation; translate ONLY what was said.
3. If someone asks a question, translate the question itself.
4. Stay silent for anything that is in neither language, and for background noise.
5. Preserve all technical terminology, domain names, and numbers accurately.`;
}
