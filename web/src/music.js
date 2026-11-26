// Background music: the bundled theme, looped seamlessly with Web Audio.
// audio/bgm.mp3 = intro + one pass of the loop (with a short crossfade at the end and a copy of
// the loop start after it), so the loop points below hold whatever decoder padding a browser adds.
//
// Robustness (Android WebView, iPhone home-screen app):
// - the file is fetched and decoded as soon as the app opens, independent of any audio context, so
//   playback can start the instant it is allowed (no decode delay after the first touch);
// - the audio context is created where the platform allows: right away on Android (no gesture needed),
//   inside the first touch on iPhone (a context made before a touch can stay locked forever there);
// - after the app comes back from the background, a context that won't resume (iPhone leaves it
//   "interrupted") is thrown away and rebuilt, continuing from the same spot in the song.
const SRC = 'audio/bgm.mp3';
const LOOP_START = 41;                 // s
const LOOP_END = 7486693 / 48000;      // s (loop length 5518693 samples at 48 kHz ≈ 114.97 s)
const VOLUME = 0.5;

const AC = window.AudioContext || window.webkitAudioContext;
const isAndroid = /Android/i.test(navigator.userAgent) || !!window.WuwaNative;
let buffer = null;          // decoded song (an AudioBuffer works in any context)
let ctx = null, node = null, gain = null;
let startedAt = 0;          // ctx.currentTime when the song position was 0
let position = 0;           // song position (s) saved when the context goes away
let wantPlay = true;        // false while the app is in the background

const songPos = () => {
  if (!ctx || !node) return position;
  const t = ctx.currentTime - startedAt;
  const end = Math.min(LOOP_END, buffer.duration);
  return t < end ? t : LOOP_START + ((t - LOOP_START) % (end - LOOP_START));
};

async function decode() {
  const data = await (await fetch(SRC)).arrayBuffer();
  // decode once, without waiting for a user touch: an offline context needs no permission
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const dec = OAC ? new OAC(2, 1, 48000) : new AC();
  buffer = await new Promise((res, rej) => {
    const p = dec.decodeAudioData(data, res, rej);
    if (p?.then) p.then(res, rej);
  });
  if (!OAC) dec.close?.();
}

function makeContext() {
  if (!AC) return;
  try { ctx?.close?.(); } catch { /* already closed */ }
  ctx = new AC();
  gain = ctx.createGain();
  gain.gain.value = VOLUME;
  gain.connect(ctx.destination);
  node = null;
  ctx.onstatechange = () => { if (ctx?.state === 'running') startSource(); };
}

function startSource() {
  if (!ctx || !buffer || node || ctx.state !== 'running') return;
  node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  node.loopStart = LOOP_START;
  node.loopEnd = Math.min(LOOP_END, buffer.duration);
  node.connect(gain);
  const at = position % buffer.duration;
  node.start(0, at);
  startedAt = ctx.currentTime - at;
}

// Bring the music back: resume the context, or rebuild it if it is stuck.
function kick(fromGesture) {
  if (!wantPlay || !AC) return;
  // in a touch, a context that played before but is not running now (iPhone after the background) is
  // rebuilt right away, while the touch still allows starting sound
  const stuck = ctx && (ctx.state === 'closed' || (fromGesture && ctx.state !== 'running' && node));
  if (!ctx || stuck) {
    if (!ctx && !fromGesture && !isAndroid) return; // iPhone: wait for a touch to create it
    if (ctx) position = songPos();
    makeContext();
  }
  if (ctx.state !== 'running') {
    const p = ctx.resume?.();
    p?.then?.(() => startSource(), () => {});
  }
  startSource();
}

function pause() {
  wantPlay = false;
  if (ctx && ctx.state === 'running') { position = songPos(); ctx.suspend?.(); }
}
function resume() {
  wantPlay = true;
  kick(false);
}

export function initMusic() {
  if (!AC) return;
  // iPhone: play like a music app, also with the silent switch on
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older iOS */ }
  try { indexedDB.deleteDatabase('wuwa-music'); } catch { /* frees the audio file older versions let you pick */ }
  wantPlay = !document.hidden;
  if (isAndroid) makeContext(); // the Android app allows sound without a touch
  decode().then(() => kick(false)).catch((e) => console.warn('music:', e));
  // only play while the app is in front
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  addEventListener('pagehide', pause);
  addEventListener('pageshow', () => { if (!document.hidden) resume(); });
  addEventListener('focus', () => { if (!document.hidden) resume(); });
  // browsers keep audio locked until a touch: every touch makes sure it is playing
  const unlock = () => { if (!document.hidden) { wantPlay = true; kick(true); } };
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  // the Android app tells us directly when it goes to / comes back from the background
  window.__wuwaAudio = (on) => (on ? resume() : pause());
  window.__music = { get state() { return ctx?.state ?? 'none'; }, get playing() { return !!node; }, get decoded() { return !!buffer; }, get pos() { return songPos(); } };
}
