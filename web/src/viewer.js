// Renderer, orbit camera, configurable multi-light rig, backgrounds, floor and screenshots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { findBackground, paintCanvas, createGalaxy, DEFAULT_BACKGROUND } from './backgrounds.js';

export const LIGHT_TYPES = {
  directional: 'Directional', point: 'Point', spot: 'Spot', hemisphere: 'Hemisphere', ambient: 'Ambient (shadows)',
};

let lightSeq = 0;
export function newLight(type, over = {}) {
  const base = {
    id: ++lightSeq, type, name: LIGHT_TYPES[type], enabled: true, color: '#ffffff', intensity: 1,
    azimuth: 30, elevation: 35, distance: 2.5, castShadow: false, followCamera: false,
    groundColor: '#6b6f80', angle: 30, penumbra: 0.4, height: 1,
  };
  if (type === 'point' || type === 'spot') base.intensity = 3;
  if (type === 'ambient') base.intensity = 1;
  return { ...base, ...over };
}

export const LIGHT_PRESETS = {
  'Studio': () => [
    newLight('ambient', { intensity: 1 }),
    newLight('directional', { name: 'Key', azimuth: 35, elevation: 40, intensity: 1, castShadow: true }),
    newLight('directional', { name: 'Back', azimuth: 200, elevation: 25, intensity: 0.7, color: '#bfe3ff' }),
  ],
  'Game menu': () => [
    newLight('ambient', { intensity: 1.05 }),
    newLight('directional', { name: 'Key', azimuth: 20, elevation: 30, intensity: 1, castShadow: true, followCamera: true }),
    newLight('directional', { name: 'Rim', azimuth: 160, elevation: 10, intensity: 0.9, color: '#dff4ff', followCamera: true }),
  ],
  'Backlight': () => [
    newLight('ambient', { intensity: 0.8 }),
    newLight('directional', { name: 'Backlight', azimuth: 180, elevation: 30, intensity: 1.6, color: '#fff1d6' }),
    newLight('point', { name: 'Fill', azimuth: 20, elevation: 10, distance: 2, intensity: 1.5, color: '#9fb8ff' }),
  ],
  'Sunset': () => [
    newLight('hemisphere', { color: '#ffb27a', groundColor: '#3a2d55', intensity: 0.6 }),
    newLight('ambient', { intensity: 0.7, color: '#d9c6ff' }),
    newLight('directional', { name: 'Sun', azimuth: 70, elevation: 12, intensity: 1.3, color: '#ff9d5c', castShadow: true }),
    newLight('directional', { name: 'Sky', azimuth: 230, elevation: 40, intensity: 0.5, color: '#7d8cff' }),
  ],
  'Neon': () => [
    newLight('ambient', { intensity: 0.55, color: '#b8b0ff' }),
    newLight('point', { name: 'Magenta', azimuth: 60, elevation: 15, distance: 1.6, intensity: 6, color: '#ff3fb4' }),
    newLight('point', { name: 'Cyan', azimuth: 280, elevation: 25, distance: 1.6, intensity: 6, color: '#36e2ff' }),
    newLight('spot', { name: 'Top', azimuth: 0, elevation: 80, distance: 3, intensity: 5, color: '#ffffff', angle: 25 }),
  ],
  'Night': () => [
    newLight('ambient', { intensity: 0.65, color: '#8ea0d8' }),
    newLight('directional', { name: 'Moon', azimuth: 140, elevation: 45, intensity: 0.8, color: '#a9c4ff', castShadow: true }),
    newLight('point', { name: 'Lantern', azimuth: 330, elevation: 5, distance: 1.4, intensity: 4, color: '#ffc07a' }),
  ],
  'Flat': () => [newLight('ambient', { intensity: 1.4 })],
};

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderScale = Math.min(window.devicePixelRatio || 1, 2);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    this.camera.position.set(0, 1.0, 4.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 30;
    this.controls.update();
    this.controls.addEventListener('start', () => { this.tween = null; });
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.lightGroup = new THREE.Group();
    this.scene.add(this.lightGroup);
    this.lightTarget = new THREE.Object3D();
    this.lightTarget.position.set(0, 0.9, 0);
    this.scene.add(this.lightTarget);
    this.lights = [];
    this.lightObjects = new Map();
    this.markers = new THREE.Group();
    this.markers.visible = false;
    this.scene.add(this.markers);
    this.focus = new THREE.Vector3(0, 0.9, 0);
    this.focusRadius = 1;
    this.bg = DEFAULT_BACKGROUND;
    this.galaxy = createGalaxy();
    this.galaxy.visible = false;
    this.scene.add(this.galaxy);
    this.floorMode = 'shadow';
    this.floorColor = '#2a2f40';
    this.buildFloor();
    this.onBeforeRender = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyInset();
    this.applyBackground();
  }
  setRenderScale(s) { this.renderScale = s; this.resize(); }
  // Fit the whole picture into the area above a bottom panel of `px` pixels. The canvas keeps covering the
  // full screen (so the glass panels blur the scene behind them); only the projection is shrunk and moved up.
  setBottomInset(px) { this.bottomInset = px; this.applyInset(); }
  applyInset() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const vis = h - Math.min(this.bottomInset || 0, h * 0.7);
    if (vis < h - 1) {
      const k = vis / h; // full frustum drawn into the visible strip
      this.camera.setViewOffset(w * k, h * k, (w * k - w) / 2, 0, w, h);
    } else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.galaxy?.setCenterY(1 - (vis / h) / 2);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.tween) this.stepTween(dt);
    if (this.galaxy.visible) this.galaxy.update(dt);
    for (const f of this.onBeforeRender) f(dt);
    this.controls.update();
    this.updateFollowLights();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- camera ----------
  frameObject(box) {
    if (!box || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.focus.copy(center);
    this.focusRadius = Math.max(size.y, size.x, size.z) / 2;
    this.lightTarget.position.copy(center);
    this.viewPreset('front');
    this.updateLights();
  }
  // name: 'front' (whole body) or 'face' (head and shoulders). animate: glide there instead of jumping.
  viewPreset(name, animate = false) {
    const c = this.focus, r = this.focusRadius;
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.08;
    const target = new THREE.Vector3(), pos = new THREE.Vector3();
    if (name === 'face') {
      const head = this.headPosition?.() ?? new THREE.Vector3(c.x, c.y + r * 0.82, c.z);
      // keep looking from the current side, just closer
      const side = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).setY(0);
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
      side.normalize();
      target.copy(head);
      // head and shoulders fit both ways, also on a narrow portrait screen
      const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const fd = Math.max(0.22 / tv, 0.16 / (tv * this.camera.aspect));
      pos.copy(head).addScaledVector(side, fd).add(new THREE.Vector3(0, 0.02, 0));
    } else {
      target.copy(c);
      pos.copy(c).addScaledVector(new THREE.Vector3(0, 0.05, 1).normalize(), dist);
    }
    if (animate) {
      this.tween = { t: 0, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: target };
      return;
    }
    this.tween = null;
    this.controls.target.copy(target);
    this.camera.position.copy(pos);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  stepTween(dt) {
    const tw = this.tween;
    tw.t = Math.min(1, tw.t + dt / 0.45);
    const e = 1 - Math.pow(1 - tw.t, 3);
    this.camera.position.lerpVectors(tw.p0, tw.p1, e);
    this.controls.target.lerpVectors(tw.t0, tw.t1, e);
    if (tw.t >= 1) this.tween = null;
  }
  // Frame the head when far, the whole body when already close.
  toggleFaceFrame() {
    const full = (this.focusRadius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.08;
    const close = (this.tween?.p1 ?? this.camera.position).distanceTo(this.tween?.t1 ?? this.controls.target) < full * 0.6;
    this.viewPreset(close ? 'front' : 'face', true);
    return close ? 'body' : 'face';
  }

  // ---------- lights ----------
  setLights(list) { this.lights = list; this.rebuildLights(); }
  rebuildLights() {
    for (const o of this.lightObjects.values()) { o.light.removeFromParent(); o.light.dispose?.(); o.marker?.removeFromParent(); }
    this.lightObjects.clear();
    for (const spec of this.lights) {
      let light;
      switch (spec.type) {
        case 'directional': light = new THREE.DirectionalLight(); light.target = this.lightTarget; break;
        case 'point': light = new THREE.PointLight(); break;
        case 'spot': light = new THREE.SpotLight(); light.target = this.lightTarget; break;
        case 'hemisphere': light = new THREE.HemisphereLight(); break;
        default: light = new THREE.AmbientLight();
      }
      if (light.shadow) {
        light.shadow.mapSize.set(2048, 2048);
        light.shadow.bias = -0.0004;
        light.shadow.normalBias = 0.02;
        if (light.isDirectionalLight) { const c = light.shadow.camera; c.left = c.bottom = -2.2; c.right = c.top = 2.2; c.near = 0.1; c.far = 20; }
      }
      this.lightGroup.add(light);
      let marker = null;
      if (spec.type !== 'ambient' && spec.type !== 'hemisphere') {
        marker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: spec.color }));
        this.markers.add(marker);
      }
      this.lightObjects.set(spec.id, { light, marker });
    }
    this.updateLights();
  }
  lightPosition(spec, camRelative) {
    let az = THREE.MathUtils.degToRad(spec.azimuth), el = THREE.MathUtils.degToRad(spec.elevation);
    const d = spec.type === 'directional' ? 6 : spec.distance;
    if (camRelative) {
      const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      az += Math.atan2(off.x, off.z);
    }
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d).add(this.lightTarget.position);
  }
  updateLights() {
    for (const spec of this.lights) {
      const o = this.lightObjects.get(spec.id); if (!o) continue;
      const { light, marker } = o;
      light.visible = spec.enabled;
      light.color.set(spec.color);
      light.intensity = spec.intensity;
      if (spec.type === 'hemisphere') { light.groundColor.set(spec.groundColor); light.position.set(0, 10, 0); }
      if (spec.type === 'point' || spec.type === 'spot') { light.distance = 0; light.decay = 1.2; }
      if (spec.type === 'spot') { light.angle = THREE.MathUtils.degToRad(spec.angle); light.penumbra = spec.penumbra; }
      if (light.shadow) light.castShadow = !!spec.castShadow && spec.enabled;
      if (spec.type !== 'ambient' && spec.type !== 'hemisphere') light.position.copy(this.lightPosition(spec, spec.followCamera));
      if (marker) { marker.position.copy(spec.type === 'directional' ? this.lightPosition({ ...spec, type: 'point', distance: 1.4 }, spec.followCamera) : light.position); marker.material.color.set(spec.color); marker.visible = spec.enabled; }
    }
  }
  updateFollowLights() { if (this.lights.some((l) => l.followCamera)) this.updateLights(); }

  // ---------- background ----------
  // name: one of BACKGROUNDS in backgrounds.js
  setBackground(name) { this.bg = findBackground(name).name; this.applyBackground(); }
  get transparentBackground() { return this.bg === 'Transparent'; }
  applyBackground() {
    const bg = findBackground(this.bg);
    if (this.bgTexture) { this.bgTexture.dispose(); this.bgTexture = null; }
    this.scene.background = null;
    this.galaxy.visible = bg.kind === 'shader';
    const clear = bg.kind === 'none';
    this.renderer.setClearColor(0x000000, clear ? 0 : 1);
    document.body.style.background = clear ? 'repeating-conic-gradient(#2a2f3d 0% 25%, #1b1f2a 0% 50%) 0 0 / 24px 24px' : '';
    if (bg.kind === 'color') this.scene.background = new THREE.Color(bg.color);
    if (bg.kind === 'paint') {
      const t = new THREE.CanvasTexture(paintCanvas(bg, this.camera.aspect, Math.max(this.canvas.width, this.canvas.height, 1024)));
      t.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = this.bgTexture = t;
    }
  }

  // ---------- floor ----------
  buildFloor() {
    this.floor = new THREE.Group();
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.25 }));
    this.shadowPlane.rotation.x = -Math.PI / 2; this.shadowPlane.receiveShadow = true;
    this.grid = new THREE.GridHelper(10, 40, 0x6a7390, 0x3a4157);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.5;
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), new THREE.MeshBasicMaterial({ color: this.floorColor }));
    this.disc.rotation.x = -Math.PI / 2; this.disc.position.y = -0.002;
    this.floor.add(this.shadowPlane, this.grid, this.disc);
    this.scene.add(this.floor);
    this.setFloor(this.floorMode);
  }
  setFloor(mode, color) {
    this.floorMode = mode;
    if (color) { this.floorColor = color; this.disc.material.color.set(color); }
    this.floor.visible = mode !== 'none';
    this.shadowPlane.visible = mode !== 'none';
    this.grid.visible = mode === 'grid';
    this.disc.visible = mode === 'disc';
  }
  setFloorHeight(y) { this.floor.position.y = y; }

  // ---------- screenshot ----------
  // aspect: crop the centre of the view to this width/height ratio (photo mode framing).
  screenshot({ scale = 1, transparent = false, aspect = null } = {}) {
    const r = this.renderer;
    const prevBg = this.scene.background, prevRatio = r.getPixelRatio();
    const prevFloor = this.floor.visible, prevMarkers = this.markers.visible, prevGalaxy = this.galaxy.visible;
    this.markers.visible = false;
    if (transparent) { this.scene.background = null; this.galaxy.visible = false; r.setClearColor(0, 0); this.floor.visible = false; }
    r.setPixelRatio(prevRatio * scale);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    r.setSize(w, h, false);
    r.render(this.scene, this.camera);
    let url;
    if (aspect) {
      const W = this.canvas.width, H = this.canvas.height;
      const cw = Math.round(W / H > aspect ? H * aspect : W), ch = Math.round(W / H > aspect ? H : W / aspect);
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(this.canvas, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, cw, ch);
      url = c.toDataURL('image/png');
    } else url = this.canvas.toDataURL('image/png');
    this.scene.background = prevBg; this.floor.visible = prevFloor; this.markers.visible = prevMarkers; this.galaxy.visible = prevGalaxy;
    r.setPixelRatio(prevRatio); r.setSize(w, h, false);
    this.applyBackground();
    return url;
  }
}
