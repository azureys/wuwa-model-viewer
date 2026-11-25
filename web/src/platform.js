// Bridge to the Android app (window.WuwaNative), with a browser fallback for development.
const native = typeof window !== 'undefined' ? window.WuwaNative : undefined;
import * as webstore from './webstore.js';
import { PackageSource } from './source.js';
export const isAndroid = !!native;
export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Safari's image decoder premultiplies alpha (all iPhone browsers use it); ?jsdecode forces the JS PNG decoder for testing
export const isSafari = isIOS || (/Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Android|Edg\//.test(navigator.userAgent)) || new URLSearchParams(location.search).has('jsdecode');
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
  if (!files) throw new Error('Model not found on this device');
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
      navigator.share({ files: [file] }).then(() => emit('file', 'Saved')).catch((e) => { if (e?.name !== 'AbortError') download(name, blob); });
      return;
    }
  }
  download(name, blob);
  emit('file', 'Downloaded: ' + name);
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
    if (accept) input.accept = accept; else input.removeAttribute('accept');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const store = {
  get(key, def) { try { const v = localStorage.getItem('wuwa.' + key); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(key, v) { try { localStorage.setItem('wuwa.' + key, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---- downloads from encore.moe
// Android downloads natively straight into the model folder. The browser / iPhone version can't read
// encore.moe's file storage directly (it only allows encore.moe itself), so it goes through a small
// relay (Cloudflare Worker, see worker/) and keeps the files in IndexedDB.
export const DOWNLOAD_RELAY = '';
export function relayUrl() {
  const q = new URLSearchParams(location.search).get('relay');
  return String(q || store.get('relay', '') || DOWNLOAD_RELAY).trim().replace(/\/+$/, '');
}
export const canDownload = isAndroid || !devModels;
export const needsRelay = () => !isAndroid && !relayUrl();
export function setRelay(url) { store.set('relay', url.trim()); }

const webDl = new Map(); // id -> { list: Set<path>, size }
export async function newModelId(name) {
  if (isAndroid) return native.newModelId(name);
  const id = await webstore.newModelId(name);
  webDl.set(id, { list: new Set(), size: 0 });
  return id;
}
export async function finalizeModel(id, name) {
  if (isAndroid) return native.finalizeModel(id, name);
  const st = webDl.get(id); webDl.delete(id);
  return webstore.finalizeDownload(id, name, [...st.list], st.size);
}
export async function abortDownload(id) {
  if (isAndroid) { try { native.deleteModel(id); } catch { /* ignore */ } return; }
  webDl.delete(id);
  await webstore.deleteModel(id).catch(() => {});
}
// Read a file that was just downloaded (Android: local folder; web: IndexedDB).
export async function readDownloaded(id, path) {
  if (isAndroid) {
    const r = await fetch(`${MODELS_BASE}/${encodeURIComponent(id)}/` + path.split('/').map(encodeURIComponent).join('/'));
    return r.ok ? r.arrayBuffer() : null;
  }
  const b = await webstore.readFile(id, path);
  return b ? b.arrayBuffer() : null;
}
let batchSeq = 0;
// Download paths (relative to base) into model `id`. progress(done, total, bytesSoFar). Resolves with the failed paths.
export function downloadBatch(id, base, paths, progress) {
  if (!isAndroid) return webBatch(id, paths, progress);
  return new Promise((resolve) => {
    const token = 'b' + (++batchSeq);
    batches.set(token, { resolve, progress });
    native.downloadBatch(id, base, JSON.stringify(paths), token);
  });
}
async function fetchRetry(url) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404 || r.status === 403 || i >= 2) return r;
    } catch (e) { if (i >= 2) throw e; }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
}
async function webBatch(id, paths, progress) {
  const st = webDl.get(id);
  const relay = relayUrl();
  if (!relay) throw new Error('no download relay set');
  const failed = [], size0 = st.size;
  let next = 0, done = 0, pending = [], pendingBytes = 0, fatal = null;
  const flush = async () => {
    if (!pending.length) return;
    const b = pending; pending = []; pendingBytes = 0;
    await webstore.putFiles(id, b);
  };
  const worker = async () => {
    while (next < paths.length && !fatal) {
      const p = paths[next++];
      try {
        const r = await fetchRetry(`${relay}/${p.split('/').map(encodeURIComponent).join('/')}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        pending.push([p, blob]); pendingBytes += blob.size;
        st.list.add(p); st.size += blob.size;
        if (pendingBytes > 16 * 1048576 || pending.length >= 48) await flush();
      } catch (e) {
        if (e?.name === 'QuotaExceededError') fatal = new Error('not enough free space on this device');
        else if (e instanceof TypeError) failed.push(p), (st.netErrors = (st.netErrors ?? 0) + 1);
        else failed.push(p);
      }
      done++;
      progress?.(done, paths.length, st.size - size0);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  try { await flush(); } catch (e) { fatal ??= e?.name === 'QuotaExceededError' ? new Error('not enough free space on this device') : e; }
  if (fatal) throw fatal;
  if (paths.length && st.netErrors >= paths.length) throw new Error('could not reach the download relay (check your connection)');
  return failed;
}
