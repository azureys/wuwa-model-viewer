// Scene backgrounds. One list drives the Scene tab dropdown and the photo mode strip.
//   paint:  drawn once on a canvas at the screen's aspect ratio (so nothing is stretched)
//   color:  a plain colour
//   shader: animated, drawn every frame behind the model (Galaxy)
//   none:   transparent (the page shows a checkerboard, screenshots keep the alpha)
import * as THREE from 'three';

// ---------------------------------------------------------------- painted backgrounds
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function vgrad(g, w, h, stops) { const v = g.createLinearGradient(0, 0, 0, h); stops.forEach(([o, c]) => v.addColorStop(o, c)); g.fillStyle = v; g.fillRect(0, 0, w, h); }
function glow(g, x, y, r, color, alpha = 1) {
  const rg = g.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, color); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha; g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
}
const S = (w, h) => Math.max(w, h);

const PAINTERS = {
  studio(g, w, h) { vgrad(g, w, h, [[0, '#3a4157'], [1, '#12141c']]); },
  dusk(g, w, h) {
    vgrad(g, w, h, [[0, '#2a1d4f'], [0.55, '#8a3f74'], [1, '#ff9e6b']]);
    const r = rng(11);
    for (let i = 0; i < 38; i++) {
      const x = r() * w, y = h * (0.25 + r() * 0.75), rad = (12 + r() * 60) * S(w, h) / 900;
      glow(g, x, y, rad, `hsla(${20 + r() * 40},100%,${70 + r() * 20}%,.9)`, 0.25 + r() * 0.35);
    }
  },
  starry(g, w, h) {
    vgrad(g, w, h, [[0, '#03050d'], [0.6, '#0d1631'], [1, '#22315e']]);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-0.5);
    glow(g, 0, 0, S(w, h) * 0.6, 'rgba(120,140,220,.25)'); g.restore();
    const r = rng(3);
    for (let i = 0; i < 420; i++) { const a = r(), s = a > 0.95 ? 2.2 : 1.2; g.fillStyle = `rgba(255,255,255,${a * a})`; g.fillRect(r() * w, r() * h * 0.85, s, s); }
    glow(g, w / 2, h, S(w, h) * 0.5, 'rgba(90,120,255,.25)');
  },
  sakura(g, w, h) {
    vgrad(g, w, h, [[0, '#fff0f5'], [0.6, '#f6c9da'], [1, '#c9a0c9']]);
    glow(g, w * 0.5, h * 0.35, S(w, h) * 0.5, 'rgba(255,255,255,.8)');
    const r = rng(21);
    for (let i = 0; i < 60; i++) {
      const x = r() * w, y = r() * h, s = (4 + r() * 9) * S(w, h) / 900;
      g.save(); g.translate(x, y); g.rotate(r() * 6.28); g.fillStyle = `rgba(255,${150 + r() * 60},${190 + r() * 40},${0.45 + r() * 0.4})`;
      g.beginPath(); g.ellipse(0, 0, s, s * 0.6, 0, 0, 7); g.fill(); g.restore();
    }
  },
};

export const BACKGROUNDS = [
  { name: 'Studio', kind: 'paint', paint: PAINTERS.studio },
  { name: 'Galaxy', kind: 'shader', thumb: 'radial-gradient(circle at 50% 45%, #fff6e0 0 6%, #8fd8ff 14%, #3b4fb8 34%, #150f3a 60%, #04050f 80%)' },
  { name: 'Starry night', kind: 'paint', paint: PAINTERS.starry },
  { name: 'Dusk', kind: 'paint', paint: PAINTERS.dusk },
  { name: 'Sakura', kind: 'paint', paint: PAINTERS.sakura },
  { name: 'Black', kind: 'color', color: '#000000' },
  { name: 'White', kind: 'color', color: '#ffffff' },
  { name: 'Transparent', kind: 'none', thumb: 'repeating-conic-gradient(#888 0% 25%, #ddd 0% 50%) 0 0 / 10px 10px' },
];
export const DEFAULT_BACKGROUND = 'Studio';
export const findBackground = (name) => BACKGROUNDS.find((b) => b.name === name) ?? BACKGROUNDS[0];

const paintCache = new Map();
// Canvas for a painted background at roughly the given aspect (longest side `size` px).
export function paintCanvas(bg, aspect, size = 1280) {
  const w = Math.round(aspect >= 1 ? size : size * aspect), h = Math.round(aspect >= 1 ? size / aspect : size);
  const key = `${bg.name}|${w}x${h}`;
  if (paintCache.has(key)) return paintCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  bg.paint(c.getContext('2d'), w, h);
  if (paintCache.size > 6) paintCache.delete(paintCache.keys().next().value);
  paintCache.set(key, c);
  return c;
}

const thumbCache = new Map();
// CSS background for a small preview swatch.
export function backgroundThumb(name) {
  const bg = findBackground(name);
  if (bg.thumb) return bg.thumb;
  if (bg.kind === 'color') return bg.color;
  if (!thumbCache.has(name)) thumbCache.set(name, `url(${paintCanvas(bg, 1, 96).toDataURL()}) center / cover`);
  return thumbCache.get(name);
}

// ---------------------------------------------------------------- Galaxy (animated)
// A tilted spiral galaxy floating in deep blue space behind the character: bright warm core, cyan-blue arms
// with violet dust, drifting nebula, twinkling stars and slow sparkles. Drawn in screen space by a full-screen
// quad that is rendered first, so it works with the panel inset and with high-resolution screenshots.
const GALAXY_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;

const GALAXY_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec2 uRes;      // drawing buffer size in pixels
uniform float uCenterY; // vertical centre of the visible area, 0..1 from the bottom
varying vec2 vUv;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// one layer of stars on a grid of cells, each cell holding at most one twinkling star
vec3 stars(vec2 p, float scale, float density, float t) {
  vec2 g = p * scale, id = floor(g), f = fract(g) - 0.5;
  float h = hash(id);
  if (h > density) return vec3(0.0);
  vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float d = length(f - o * 0.7);
  float tw = 0.55 + 0.45 * sin(t * (1.0 + 2.0 * hash(id + 1.3)) + h * 40.0);
  float core = smoothstep(0.09, 0.0, d) + 0.35 * smoothstep(0.3, 0.0, d) * smoothstep(0.03, 0.0, min(abs(f.x - o.x * 0.7), abs(f.y - o.y * 0.7)));
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash(id + 9.2));
  return tint * core * tw;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - vec2(0.5, uCenterY + 0.06)) * vec2(aspect, 1.0); // galaxy sits just above the model's middle
  float t = uTime;

  // deep space: navy at the top, a little lighter indigo towards the floor
  vec3 col = mix(vec3(0.035, 0.05, 0.12), vec3(0.01, 0.012, 0.035), smoothstep(-0.6, 0.7, vUv.y));
  col += vec3(0.05, 0.03, 0.10) * smoothstep(0.5, 0.0, vUv.y);

  // drifting nebula clouds
  float neb = fbm(p * 2.2 + vec2(t * 0.012, -t * 0.008));
  float neb2 = fbm(p * 4.0 - vec2(t * 0.01, 0.0) + 5.0);
  col += vec3(0.10, 0.06, 0.22) * pow(neb, 2.5) * 1.6;
  col += vec3(0.02, 0.12, 0.20) * pow(neb2, 3.0) * 1.2;

  // galaxy plane: tilted and inclined, slowly turning
  vec2 q = rot(0.32) * p;
  q.y /= 0.38;
  float r = length(q);
  float a = atan(q.y, q.x) - t * 0.035;
  float logr = log(max(r, 1e-3));
  float spiral = a - logr * 3.2;                 // logarithmic spiral, two arms
  float arms = pow(0.5 + 0.5 * cos(2.0 * spiral), 2.5);
  vec2 polar = vec2(spiral * 1.6, logr * 3.0);
  float dust = fbm(polar * 1.7 + vec2(0.0, t * 0.02));
  float clump = fbm(q * 9.0 + vec2(t * 0.03, 0.0));
  float disc = exp(-r * 3.2);
  float body = disc * (0.35 + 1.4 * arms * (0.55 + 0.9 * dust));
  vec3 armCol = mix(vec3(0.25, 0.55, 1.0), vec3(0.55, 0.95, 1.0), arms);
  armCol = mix(armCol, vec3(0.75, 0.45, 1.0), smoothstep(0.25, 0.65, r) * 0.6);
  col += armCol * body * 0.7;
  col -= vec3(0.10, 0.08, 0.05) * disc * smoothstep(0.55, 0.85, dust) * (1.0 - arms) * 1.4; // dark dust lanes
  col += vec3(0.7, 0.9, 1.0) * disc * arms * pow(clump, 6.0) * 6.0;                          // star-forming knots
  // core and bulge
  col += vec3(1.0, 0.93, 0.8) * exp(-r * r * 90.0) * 1.3;
  col += vec3(1.0, 0.85, 0.65) * exp(-r * r * 14.0) * 0.45;
  col += vec3(0.4, 0.6, 1.0) * exp(-r * 1.6) * 0.12; // halo

  // stars: far, middle and a few bright ones with a cross glint
  vec2 sp = vUv * vec2(aspect, 1.0);
  col += stars(sp, 140.0, 0.30, t * 1.3) * 0.55;
  col += stars(sp + 3.7, 70.0, 0.18, t * 1.0) * 0.8;
  col += stars(sp + 9.1, 26.0, 0.10, t * 0.8) * 1.2;

  // sparkles drifting up slowly
  vec2 dp = sp * 9.0 + vec2(0.0, -t * 0.12);
  vec2 did = floor(dp); vec2 df = fract(dp) - 0.5;
  float dh = hash(did + 17.0);
  if (dh < 0.12) {
    vec2 o = vec2(hash(did + 2.0), hash(did + 5.0)) - 0.5;
    float d = length(df - o * 0.6);
    col += vec3(0.6, 0.85, 1.0) * smoothstep(0.08, 0.0, d) * (0.5 + 0.5 * sin(t * 2.0 + dh * 60.0)) * 0.7;
  }

  // soft vignette
  col *= 1.0 - 0.45 * pow(length((vUv - 0.5) * vec2(1.1, 0.9)), 2.2);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export function createGalaxy() {
  const uniforms = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uCenterY: { value: 0.5 } };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms, vertexShader: GALAXY_VERT, fragmentShader: GALAXY_FRAG, depthTest: false, depthWrite: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (renderer) => renderer.getDrawingBufferSize(uniforms.uRes.value);
  mesh.update = (dt) => { uniforms.uTime.value += dt; };
  mesh.setCenterY = (y) => { uniforms.uCenterY.value = y; };
  return mesh;
}
