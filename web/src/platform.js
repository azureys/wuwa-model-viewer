// Bridge to the Android app (window.WuwaNative), with a browser fallback for development.
const native = typeof window !== 'undefined' ? window.WuwaNative : undefined;
export const isAndroid = !!native;
export const MODELS_BASE = isAndroid ? 'https://appassets.androidplatform.net/models' : './models';

const listeners = { progress: [], done: [], file: [] };
window.__wuwa = {
  importProgress: (pct, msg) => listeners.progress.forEach((f) => f(pct, msg)),
  importDone: (json) => { const r = JSON.parse(json); listeners.done.forEach((f) => f(r)); },
  fileSaved: (msg) => listeners.file.forEach((f) => f(msg)),
};
export const onImportProgress = (f) => listeners.progress.push(f);
export const onImportDone = (f) => listeners.done.push(f);
export const onFileSaved = (f) => listeners.file.push(f);

export async function listModels() {
  if (isAndroid) return JSON.parse(native.listModels());
  try { const r = await fetch(`${MODELS_BASE}/list.json`); return r.ok ? r.json() : []; } catch { return []; }
}
export function importZip() {
  if (isAndroid) native.importZip();
  else alert('La importación de .zip solo está disponible en la app Android.');
}
export function deleteModel(id) { if (isAndroid) native.deleteModel(id); }
export function renameModel(id, name) { if (isAndroid) native.renameModel(id, name); }

// Save a data: URL or text to the device (Android: Pictures/Download), or download in the browser.
export function saveFile(name, data, mime) {
  if (isAndroid) {
    if (typeof data === 'string' && data.startsWith('data:')) native.saveBase64(name, data.split(',')[1], mime);
    else native.saveText(name, String(data), mime);
    return;
  }
  const a = document.createElement('a');
  a.href = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type: mime }));
  a.download = name; a.click();
}

// Pick a local file through the WebView file chooser.
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.getElementById('filePicker');
    input.value = '';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export const store = {
  get(key, def) { try { const v = localStorage.getItem('wuwa.' + key); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(key, v) { try { localStorage.setItem('wuwa.' + key, JSON.stringify(v)); } catch { /* ignore */ } },
};
