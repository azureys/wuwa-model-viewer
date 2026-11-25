// Background music: the bundled theme, looped seamlessly with Web Audio.
// audio/bgm.mp3 = intro + one pass of the loop (with a short crossfade at the end and a copy of
// the loop start after it), so the loop points below hold whatever decoder padding a browser adds.
const SRC = 'audio/bgm.mp3';
const LOOP_START = 41;                 // s
const LOOP_END = 7486693 / 48000;      // s (loop length 5518693 samples at 48 kHz ≈ 114.97 s)
const VOLUME = 0.5;

let ctx = null, node = null;

async function start() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const gain = ctx.createGain();
  gain.gain.value = VOLUME;
  gain.connect(ctx.destination);
  const data = await (await fetch(SRC)).arrayBuffer();
  const buffer = await new Promise((res, rej) => ctx.decodeAudioData(data, res, rej));
  node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  node.loopStart = LOOP_START;
  node.loopEnd = Math.min(LOOP_END, buffer.duration);
  node.connect(gain);
  node.start();
  if (document.hidden) ctx.suspend();
}

export function initMusic() {
  // iPhone: play like a music app, also with the silent switch on
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older iOS */ }
  try { indexedDB.deleteDatabase('wuwa-music'); } catch { /* frees the audio file older versions let you pick */ }
  start().catch((e) => console.warn('music:', e));
  // only play while the app is in front
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
  // browsers keep audio locked until the first touch
  const unlock = () => { if (ctx && ctx.state !== 'running' && !document.hidden) ctx.resume(); };
  for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { capture: true });
}
