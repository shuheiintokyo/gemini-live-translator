// Configuration, Supported Languages, Live Models and Voices
export const SUPPORTED_LANGUAGES = [
    { code: 'EN-US', name: 'English (US)', flag: '🇺🇸' },
    { code: 'JA-JP', name: 'Japanese (日本語)', flag: '🇯🇵' },
    { code: 'EN-GB', name: 'English (UK)', flag: '🇬🇧' },
    { code: 'ES-ES', name: 'Spanish (Español)', flag: '🇪🇸' },
    { code: 'FR-FR', name: 'French (Français)', flag: '🇫🇷' },
    { code: 'DE-DE', name: 'German (Deutsch)', flag: '🇩🇪' },
    { code: 'ZH-CN', name: 'Chinese (Simplified / 简体中文)', flag: '🇨🇳' },
    { code: 'KO-KR', name: 'Korean (한국어)', flag: '🇰🇷' },
    { code: 'IT-IT', name: 'Italian (Italiano)', flag: '🇮🇹' },
    { code: 'PT-BR', name: 'Portuguese (Brazil)', flag: '🇧🇷' },
    { code: 'HI-IN', name: 'Hindi (हिन्दी)', flag: '🇮🇳' },
    { code: 'AR-SA', name: 'Arabic (العربية)', flag: '🇸🇦' },
    { code: 'RU-RU', name: 'Russian (Русский)', flag: '🇷🇺' },
    { code: 'NL-NL', name: 'Dutch (Nederlands)', flag: '🇳🇱' },
    { code: 'VI-VN', name: 'Vietnamese (Tiếng Việt)', flag: '🇻🇳' },
    { code: 'AF-ZA', name: 'Afrikaans', flag: '🇿🇦' },
    { code: 'AK-GH', name: 'Akan', flag: '🇬🇭' },
    { code: 'SQ-AL', name: 'Albanian (Shqip)', flag: '🇦🇱' },
    { code: 'AM-ET', name: 'Amharic (አማርኛ)', flag: '🇪🇹' },
    { code: 'HY-AM', name: 'Armenian (Հայերեն)', flag: '🇦🇲' },
    { code: 'AZ-AZ', name: 'Azerbaijani (Azərbaycan)', flag: '🇦🇿' },
    { code: 'EU-ES', name: 'Basque (Euskara)', flag: '🇪🇸' },
    { code: 'BE-BY', name: 'Belarusian (Беларуская)', flag: '🇧🇾' },
    { code: 'BN-BD', name: 'Bengali (বাংলা)', flag: '🇧🇩' },
    { code: 'BG-BG', name: 'Bulgarian (Български)', flag: '🇧🇬' },
    { code: 'MY-MM', name: 'Burmese (မြန်မာ)', flag: '🇲🇲' },
    { code: 'CA-ES', name: 'Catalan (Català)', flag: '🇪🇸' },
    { code: 'ZH-TW', name: 'Chinese (Traditional / 繁體中文)', flag: '🇹🇼' },
    { code: 'HR-HR', name: 'Croatian (Hrvatski)', flag: '🇭🇷' },
    { code: 'CS-CZ', name: 'Czech (Čeština)', flag: '🇨🇿' },
    { code: 'DA-DK', name: 'Danish (Dansk)', flag: '🇩🇰' },
    { code: 'ET-EE', name: 'Estonian (Eesti)', flag: '🇪🇪' },
    { code: 'FIL-PH', name: 'Filipino', flag: '🇵🇭' },
    { code: 'FI-FI', name: 'Finnish (Suomi)', flag: '🇫🇮' },
    { code: 'GL-ES', name: 'Galician (Galego)', flag: '🇪🇸' },
    { code: 'KA-GE', name: 'Georgian (ქართული)', flag: '🇬🇪' },
    { code: 'EL-GR', name: 'Greek (Ελληνικά)', flag: '🇬🇷' },
    { code: 'GU-IN', name: 'Gujarati (ગુજરાતી)', flag: '🇮🇳' },
    { code: 'HA-NG', name: 'Hausa', flag: '🇳🇬' },
    { code: 'HE-IL', name: 'Hebrew (עברית)', flag: '🇮🇱' },
    { code: 'HU-HU', name: 'Hungarian (Magyar)', flag: '🇭🇺' },
    { code: 'IS-IS', name: 'Icelandic (Íslenska)', flag: '🇮🇸' },
    { code: 'ID-ID', name: 'Indonesian (Bahasa Indonesia)', flag: '🇮🇩' },
    { code: 'KN-IN', name: 'Kannada (ಕನ್ನಡ)', flag: '🇮🇳' },
    { code: 'KK-KZ', name: 'Kazakh (Қазақша)', flag: '🇰🇿' },
    { code: 'KM-KH', name: 'Khmer (ខ្មែរ)', flag: '🇰🇭' },
    { code: 'RW-RW', name: 'Kinyarwanda', flag: '🇷🇼' },
    { code: 'LO-LA', name: 'Lao (ລາວ)', flag: '🇱🇦' },
    { code: 'LV-LV', name: 'Latvian (Latviešu)', flag: '🇱🇻' },
    { code: 'LT-LT', name: 'Lithuanian (Lietuvių)', flag: '🇱🇹' },
    { code: 'MK-MK', name: 'Macedonian (Македонски)', flag: '🇲🇰' },
    { code: 'MS-MY', name: 'Malay (Bahasa Melayu)', flag: '🇲🇾' },
    { code: 'ML-IN', name: 'Malayalam (മലയാളം)', flag: '🇮🇳' },
    { code: 'MR-IN', name: 'Marathi (मराठी)', flag: '🇮🇳' },
    { code: 'MN-MN', name: 'Mongolian (Монгол)', flag: '🇲🇳' },
    { code: 'NE-NP', name: 'Nepali (नेपाली)', flag: '🇳🇵' },
    { code: 'NO-NO', name: 'Norwegian (Norsk)', flag: '🇳🇴' },
    { code: 'FA-IR', name: 'Persian (فارسی)', flag: '🇮🇷' },
    { code: 'PL-PL', name: 'Polish (Polski)', flag: '🇵🇱' },
    { code: 'PT-PT', name: 'Portuguese (Portugal)', flag: '🇵🇹' },
    { code: 'PA-IN', name: 'Punjabi (ਪੰਜਾਬੀ)', flag: '🇮🇳' },
    { code: 'RO-RO', name: 'Romanian (Română)', flag: '🇷🇴' },
    { code: 'SR-RS', name: 'Serbian (Српски)', flag: '🇷🇸' },
    { code: 'SD-PK', name: 'Sindhi (سنڌي)', flag: '🇵🇰' },
    { code: 'SI-LK', name: 'Sinhala (සිංහල)', flag: '🇱🇰' },
    { code: 'SK-SK', name: 'Slovak (Slovenčina)', flag: '🇸🇰' },
    { code: 'SL-SI', name: 'Slovenian (Slovenščina)', flag: '🇸🇮' },
    { code: 'SW-KE', name: 'Swahili (Kiswahili)', flag: '🇰🇪' },
    { code: 'SV-SE', name: 'Swedish (Svenska)', flag: '🇸🇪' },
    { code: 'TA-IN', name: 'Tamil (தமிழ்)', flag: '🇮🇳' },
    { code: 'TE-IN', name: 'Telugu (తెలుగు)', flag: '🇮🇳' },
    { code: 'TH-TH', name: 'Thai (ไทย)', flag: '🇹🇭' },
    { code: 'TR-TR', name: 'Turkish (Türkçe)', flag: '🇹🇷' },
    { code: 'UK-UA', name: 'Ukrainian (Українська)', flag: '🇺🇦' },
    { code: 'UR-PK', name: 'Urdu (اردو)', flag: '🇵🇰' },
    { code: 'UZ-UZ', name: 'Uzbek (Oʻzbek)', flag: '🇺🇿' },
    { code: 'ZU-ZA', name: 'Zulu (isiZulu)', flag: '🇿🇦' }
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

export const VOICES = [
    { name: 'Kore', style: 'Firm' },
    { name: 'Puck', style: 'Upbeat' },
    { name: 'Charon', style: 'Informative' },
    { name: 'Aoede', style: 'Breezy' }
];

export function buildSystemInstruction(sourceLang, targetLang) {
    const styleGuidance = targetLang.code === 'JA-JP'
        ? "natural, polite standard Japanese (丁寧語)"
        : "natural, clear and polite phrasing";

    return `You are a professional real-time speech-to-speech translator.
The speaker is speaking in ${sourceLang.name} (${sourceLang.code}).
Your job is to continuously translate everything they say into ${targetLang.name} (${targetLang.code}) using ${styleGuidance}.

Strict guidelines:
1. Speak the direct translation immediately without commentary, preambles, or conversational replies.
2. DO NOT answer questions or engage in conversation; translate ONLY what was said into ${targetLang.name}.
3. If the speaker asks a question, translate the question itself into ${targetLang.name}.
4. Preserve all technical terminology, domain names, and numbers accurately.`;
}
