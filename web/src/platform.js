// Bridge to the Android app (window.WuwaNative), with a browser fallback for development.
const native = typeof window !== 'undefined' ? window.WuwaNative : undefined;
import * as webstore from './webstore.js';
import { PackageSource } from './source.js';
export const isAndroid = !!native;
export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isMobile = isAndroid || isIOS || /Android|Mobi/.test(navigator.userAgent);
// installed to the home screen (iOS) or running as an installed PWA
export const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
export const MODELS_BASE = isAndroid ? 'https://appassets.androidplatform.net/models' : './models';
// dev server with unzipped sample folders (tools/devserver.mjs) instead of on-device storage
const devModels = !isAndroid && new URLSearchParams(location.search).has('dev');
const emit = (k, ...a) => listeners[k].forEach((f) => f(...a));

const listeners = { progress: [], done: [], file: [] };
const batches = new Map();
window.__wuwa = {
  importProgress: (pct, msg) => listeners.progress.forEach((f) => f(pct, msg)),
  importDone: (json) => { const r = JSON.parse(json); listeners.done.forEach((f) => f(r)); },
  fileSaved: (msg) => listeners.file.forEach((f) => f(msg)),
  dlProgress: (token, done, total, bytes) => batches.get(token)?.progress?.(done, total, bytes),
  dlDone: (token, failed) => { const b = batches.get(token); batches.delete(token); b?.resolve(JSON.parse(failed)); },
};
export const onImportProgress = (f) => listeners.progress.push(f);
export const onImportDone = (f) => listeners.done.push(f);
export const onFileSaved = (f) => listeners.file.push(f);

export async function listModels() {
  if (isAndroid) return JSON.parse(native.listModels());
  if (devModels) { try { const r = await fetch(`${MODELS_BASE}/list.json`); return r.ok ? r.json() : []; } catch { return []; } }
  try { return await webstore.listModels(); } catch (e) { console.error(e); return []; }
}
export async function openPackage(id) {
  if (isAndroid || devModels) return PackageSource.open(`${MODELS_BASE}/${encodeURIComponent(id)}`);
  const files = await webstore.getFileList(id);
  if (!files) throw new Error('Modelo no encontrado en el dispositivo');
  return new PackageSource(`idb:${id}`, files, (path) => webstore.readFile(id, path));
}
export async function importZip() {
  if (isAndroid) { native.importZip(); return; }
  const file = await pickFile('.zip,application/zip,application/x-zip-compressed');
  if (!file) return;
  try {
    const r = await webstore.importZip(file, (pct, msg) => emit('progress', pct, msg));
    emit('done', r);
  } catch (e) { console.error(e); emit('done', { error: e.message ?? String(e) }); }
}
export const canManage = isAndroid || !devModels;
export async function deleteModel(id) { if (isAndroid) native.deleteModel(id); else await webstore.deleteModel(id); }
export async function renameModel(id, name) { if (isAndroid) native.renameModel(id, name); else await webstore.renameModel(id, name); }

// Save a data: URL or text to the device (Android: Pictures/Download), or download in the browser.
export function saveFile(name, data, mime) {
  if (isAndroid) {
    if (typeof data === 'string' && data.startsWith('data:')) native.saveBase64(name, data.split(',')[1], mime);
    else native.saveText(name, String(data), mime);
    return;
  }
  const blob = typeof data === 'string' && data.startsWith('data:') ? dataUrlToBlob(data, mime) : new Blob([data], { type: mime });
  // iPhone: the share sheet lets the user pick "Save Image" (Photos) or "Save to Files"
  if (isIOS && navigator.canShare) {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).then(() => emit('file', 'Guardado')).catch((e) => { if (e?.name !== 'AbortError') download(name, blob); });
      return;
    }
  }
  download(name, blob);
  emit('file', 'Descargado: ' + name);
}
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
function dataUrlToBlob(url, mime) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new Blob([b], { type: mime });
}

// Pick a local file (WebView file chooser on Android, Files/Photos picker on iPhone).
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.getElementById('filePicker');
    input.value = '';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const store = {
  get(key, def) { try { const v = localStorage.getItem('wuwa.' + key); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(key, v) { try { localStorage.setItem('wuwa.' + key, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---- downloads from encore.moe (Android only: files go straight to the model folder)
export const canDownload = isAndroid;
export function newModelId(name) { return native.newModelId(name); }
export function finalizeModel(id, name) { return native.finalizeModel(id, name); }
let batchSeq = 0;
export function downloadBatch(id, base, paths, progress) {
  return new Promise((resolve) => {
    const token = 'b' + (++batchSeq);
    batches.set(token, { resolve, progress });
    native.downloadBatch(id, base, JSON.stringify(paths), token);
  });
}
