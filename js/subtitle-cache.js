// Saved Subtitles: prepared lines are kept on this device per episode and language,
// so opening the same episode again doesn't spend Gemini requests on it twice
const DB_NAME = 'podcast-subtitles';
const STORE = 'episodes';

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withStore(mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = () => reject(transaction.error);
    });
}

// The same file chosen again has the same name, size and date. The method is part of the
// key, so lines made one way are never mixed with lines made another way
export function subtitleCacheKey(file, targetLang, method) {
    return [method, file.name, file.size, file.lastModified, targetLang.code].join('|');
}

// Saving is a convenience: if storage is blocked or full, subtitles still work, just unsaved
export async function loadSavedSubtitles(key) {
    try {
        return (await withStore('readonly', store => store.get(key))) || null;
    } catch (err) {
        console.warn("Could not read saved subtitles:", err);
        return null;
    }
}

export async function saveSubtitles(key, saved) {
    try {
        await withStore('readwrite', store => store.put(saved, key));
    } catch (err) {
        console.warn("Could not save subtitles:", err);
    }
}

export async function deleteSavedSubtitles(key) {
    try {
        await withStore('readwrite', store => store.delete(key));
    } catch (err) {
        console.warn("Could not delete saved subtitles:", err);
    }
}
