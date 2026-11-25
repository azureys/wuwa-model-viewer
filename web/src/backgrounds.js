// Painted backgrounds for photos: drawn on a canvas at the screen's aspect ratio, so nothing is stretched.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function vgrad(g, w, h, stops) { const v = g.createLinearGradient(0, 0, 0, h); stops.forEach(([o, c]) => v.addColorStop(o, c)); g.fillStyle = v; g.fillRect(0, 0, w, h); }
function glow(g, x, y, r, color, alpha = 1) {
  const rg = g.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, color); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha; g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
}
const S = (w, h) => Math.max(w, h);

export const SCENES = {
  'Menu glow': (g, w, h) => {
    vgrad(g, w, h, [[0, '#f3f5fa'], [0.55, '#cfd6e4'], [1, '#8f99b0']]);
    glow(g, w / 2, h * 0.42, S(w, h) * 0.55, 'rgba(255,255,255,.95)');
    g.strokeStyle = 'rgba(120,135,170,.22)'; g.lineWidth = Math.max(1, S(w, h) / 900);
    for (let i = 1; i <= 6; i++) { g.beginPath(); g.ellipse(w / 2, h * 0.86, w * 0.12 * i, h * 0.018 * i, 0, 0, Math.PI * 2); g.stroke(); }
    const r = rng(7);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`; g.beginPath(); g.arc(r() * w, r() * h * 0.8, (0.6 + r() * 2.2) * S(w, h) / 900, 0, 7); g.fill(); }
  },
  'Dusk bokeh': (g, w, h) => {
    vgrad(g, w, h, [[0, '#2a1d4f'], [0.55, '#8a3f74'], [1, '#ff9e6b']]);
    const r = rng(11);
    for (let i = 0; i < 38; i++) {
      const x = r() * w, y = h * (0.25 + r() * 0.75), rad = (12 + r() * 60) * S(w, h) / 900;
      glow(g, x, y, rad, `hsla(${20 + r() * 40},100%,${70 + r() * 20}%,.9)`, 0.25 + r() * 0.35);
    }
  },
  'Starry night': (g, w, h) => {
    vgrad(g, w, h, [[0, '#03050d'], [0.6, '#0d1631'], [1, '#22315e']]);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-0.5);
    glow(g, 0, 0, S(w, h) * 0.6, 'rgba(120,140,220,.25)'); g.restore();
    const r = rng(3);
    for (let i = 0; i < 420; i++) { const a = r(); g.fillStyle = `rgba(255,255,255,${a * a})`; g.fillRect(r() * w, r() * h * 0.85, a > 0.95 ? 2.2 : 1.2, a > 0.95 ? 2.2 : 1.2); }
    glow(g, w / 2, h, S(w, h) * 0.5, 'rgba(90,120,255,.25)');
  },
  'Aurora': (g, w, h) => {
    vgrad(g, w, h, [[0, '#020a12'], [1, '#0b2a33']]);
    g.globalCompositeOperation = 'lighter';
    const bands = [['rgba(60,255,170,.35)', 0.28, 0], ['rgba(120,90,255,.28)', 0.36, 2], ['rgba(40,200,255,.25)', 0.22, 4]];
    for (const [c, y0, ph] of bands) {
      g.fillStyle = c; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 40) g.lineTo(x, h * y0 + Math.sin(x / w * 6 + ph) * h * 0.06 + Math.sin(x / w * 13 + ph) * h * 0.02);
      g.lineTo(w, h); g.closePath(); g.filter = `blur(${Math.round(S(w, h) / 60)}px)`; g.fill(); g.filter = 'none';
    }
    g.globalCompositeOperation = 'source-over';
    vgrad2(g, w, h);
  },
  'Spotlight': (g, w, h) => {
    vgrad(g, w, h, [[0, '#0c0c10'], [1, '#18181f']]);
    g.globalCompositeOperation = 'lighter';
    const cone = g.createLinearGradient(0, 0, 0, h);
    cone.addColorStop(0, 'rgba(255,240,215,.35)'); cone.addColorStop(1, 'rgba(255,240,215,.05)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(w * 0.44, 0); g.lineTo(w * 0.56, 0); g.lineTo(w * 0.85, h); g.lineTo(w * 0.15, h); g.closePath();
    g.filter = `blur(${Math.round(S(w, h) / 50)}px)`; g.fill(); g.filter = 'none';
    g.save(); g.translate(w / 2, h * 0.9); g.scale(1, 0.18); glow(g, 0, 0, w * 0.45, 'rgba(255,240,215,.55)'); g.restore();
    g.globalCompositeOperation = 'source-over';
  },
  'Tech grid': (g, w, h) => {
    vgrad(g, w, h, [[0, '#050816'], [0.62, '#0d1c3d'], [1, '#050816']]);
    const hz = h * 0.62;
    glow(g, w / 2, hz, S(w, h) * 0.5, 'rgba(70,170,255,.45)');
    g.strokeStyle = 'rgba(110,200,255,.45)'; g.lineWidth = Math.max(1, S(w, h) / 1000);
    for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(w / 2 + i * w * 0.02, hz); g.lineTo(w / 2 + i * w * 0.2, h); g.stroke(); }
    for (let k = 1; k < 14; k++) { const y = hz + (h - hz) * Math.pow(k / 13, 2.2); g.globalAlpha = 0.25 + k / 20; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.globalAlpha = 1;
  },
  'Sakura': (g, w, h) => {
    vgrad(g, w, h, [[0, '#fff0f5'], [0.6, '#f6c9da'], [1, '#c9a0c9']]);
    glow(g, w * 0.5, h * 0.35, S(w, h) * 0.5, 'rgba(255,255,255,.8)');
    const r = rng(21);
    for (let i = 0; i < 60; i++) {
      const x = r() * w, y = r() * h, s = (4 + r() * 9) * S(w, h) / 900;
      g.save(); g.translate(x, y); g.rotate(r() * 6.28); g.fillStyle = `rgba(255,${150 + r() * 60},${190 + r() * 40},${0.45 + r() * 0.4})`;
      g.beginPath(); g.ellipse(0, 0, s, s * 0.6, 0, 0, 7); g.fill(); g.restore();
    }
  },
  'Clear sky': (g, w, h) => {
    vgrad(g, w, h, [[0, '#3f8fe8'], [0.6, '#8cc6ff'], [1, '#eaf6ff']]);
    const r = rng(5);
    for (let i = 0; i < 14; i++) {
      const cx = r() * w, cy = h * (0.15 + r() * 0.5), s = (60 + r() * 120) * S(w, h) / 900;
      for (let k = 0; k < 6; k++) glow(g, cx + (r() - 0.5) * s * 2, cy + (r() - 0.5) * s * 0.5, s * (0.5 + r() * 0.6), 'rgba(255,255,255,.75)', 0.6);
    }
  },
  'Ink wash': (g, w, h) => {
    vgrad(g, w, h, [[0, '#f4f1ea'], [1, '#d9d3c6']]);
    g.fillStyle = 'rgba(40,45,55,.16)';
    for (let L = 0; L < 3; L++) {
      const base = h * (0.55 + L * 0.12), r = rng(30 + L);
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 24) g.lineTo(x, base - Math.abs(Math.sin(x / w * (3 + L) + L)) * h * (0.18 - L * 0.04) - r() * h * 0.02);
      g.lineTo(w, h); g.closePath(); g.filter = `blur(${2 + L * 2}px)`; g.fill(); g.filter = 'none';
    }
    glow(g, w * 0.72, h * 0.22, S(w, h) * 0.12, 'rgba(200,60,50,.55)');
  },
};
function vgrad2(g, w, h) { const v = g.createLinearGradient(0, h * 0.7, 0, h); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.5)'); g.fillStyle = v; g.fillRect(0, 0, w, h); }

const cache = new Map();
// Canvas for a scene at roughly the given aspect (longest side `size` px).
export function sceneCanvas(name, aspect, size = 1280) {
  const w = Math.round(aspect >= 1 ? size : size * aspect), h = Math.round(aspect >= 1 ? size / aspect : size);
  const key = `${name}|${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  (SCENES[name] ?? SCENES['Menu glow'])(c.getContext('2d'), w, h);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  cache.set(key, c);
  return c;
}
// Small preview for buttons.
export function sceneThumb(name) { return sceneCanvas(name, 1, 96).toDataURL(); }
