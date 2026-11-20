// Background music: the user picks an audio file, it is kept in IndexedDB and looped.
import { store } from './platform.js';

const DB = 'wuwa-music', OS = 'tracks', KEY = 'bg';
const audio = new Audio();
audio.loop = true;
let url = null;

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(OS, mode); const req = fn(t.objectStore(OS));
    t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error);
  });
}

export const music = {
  audio,
  name: store.get('music.name', null),
  get enabled() { return store.get('music.on', true); },
  get volume() { return store.get('music.vol', 0.5); },
  get playing() { return !audio.paused; },
  async init() {
    audio.volume = this.volume;
    try {
      const blob = await tx('readonly', (s) => s.get(KEY));
      if (blob) { this._set(blob); if (this.enabled) this.play(); }
    } catch { /* no storage */ }
    // only play while the app is in front
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) audio.pause(); else if (this.enabled && url) this.play();
    });
    // WebView/browsers may block autoplay until the first touch
    const kick = () => { if (this.enabled && url && audio.paused) this.play(); };
    window.addEventListener('pointerdown', kick, { once: true });
  },
  _set(blob) { if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob); audio.src = url; },
  async load(file) {
    this._set(file);
    this.name = file.name.replace(/\.[^.]+$/, '');
    store.set('music.name', this.name);
    store.set('music.on', true);
    try { await tx('readwrite', (s) => s.put(file, KEY)); } catch { /* kept for this session only */ }
    this.play();
  },
  async remove() {
    audio.pause(); audio.removeAttribute('src'); if (url) URL.revokeObjectURL(url); url = null;
    this.name = null; store.set('music.name', null);
    try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* ignore */ }
  },
  play() { if (url) audio.play().catch(() => {}); },
  setEnabled(v) { store.set('music.on', v); if (v) this.play(); else audio.pause(); },
  setVolume(v) { store.set('music.vol', v); audio.volume = v; },
};
