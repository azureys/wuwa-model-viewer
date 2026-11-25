// Scene, camera, renderer, configurable multi-light rig, backgrounds, floor and screenshots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

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

export const BG_PRESETS = [
  { name: 'Studio', type: 'gradient', top: '#3a4157', bottom: '#12141c' },
  { name: 'Menu', type: 'gradient', top: '#d9dde8', bottom: '#8e95a8' },
  { name: 'Sky', type: 'gradient', top: '#7ec3ff', bottom: '#e9f4ff' },
  { name: 'Sunset', type: 'gradient', top: '#3b2a63', bottom: '#ff9e6b' },
  { name: 'Night', type: 'gradient', top: '#05070f', bottom: '#1d2645' },
  { name: 'Sakura', type: 'gradient', top: '#ffe0ec', bottom: '#c8a2c8' },
  { name: 'Black', type: 'color', color: '#000000' },
  { name: 'White', type: 'color', color: '#ffffff' },
  { name: 'Croma verde', type: 'color', color: '#00b140' },
];

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
    this.bg = { type: 'gradient', top: '#3a4157', bottom: '#12141c', color: '#20242f', image: null, fit: 'cover' };
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
    this.camera.updateProjectionMatrix();
    this.applyBackground();
  }
  setRenderScale(s) { this.renderScale = s; this.resize(); }
  // Shift the picture up so the model stays visible above a bottom panel of `px` pixels.
  setBottomInset(px) { this.bottomInset = px; this.applyInset(); }
  applyInset() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const y = Math.min(this.bottomInset || 0, h * 0.6) * 0.5;
    if (y > 1) this.camera.setViewOffset(w, h, 0, y, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
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
  viewPreset(name) {
    const c = this.focus, r = this.focusRadius;
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.08;
    const dirs = {
      front: [0, 0.05, 1], back: [0, 0.05, -1], left: [-1, 0.05, 0], right: [1, 0.05, 0],
      top: [0, 1, 0.001], low: [0, -0.35, 1], threeq: [0.7, 0.15, 0.7],
    };
    if (name === 'face') {
      const head = this.headPosition?.() ?? new THREE.Vector3(c.x, c.y + r * 0.82, c.z);
      this.controls.target.copy(head);
      this.camera.position.copy(head).add(new THREE.Vector3(0, 0.02, 0.75));
    } else {
      const d = new THREE.Vector3(...dirs[name] ?? dirs.front).normalize();
      this.controls.target.copy(c);
      this.camera.position.copy(c).addScaledVector(d, dist);
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  setFov(f) { this.camera.fov = f; this.camera.updateProjectionMatrix(); }

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
  setBackground(bg) { Object.assign(this.bg, bg); this.applyBackground(); }
  applyBackground() {
    const bg = this.bg;
    if (this.bgTexture) { this.bgTexture.dispose?.(); this.bgTexture = null; }
    if (bg.type === 'transparent') { this.scene.background = null; this.renderer.setClearColor(0x000000, 0); document.body.style.background = 'repeating-conic-gradient(#2a2f3d 0% 25%, #1b1f2a 0% 50%) 0 0 / 24px 24px'; return; }
    document.body.style.background = '';
    this.renderer.setClearColor(0x000000, 1);
    if (bg.type === 'color') { this.scene.background = new THREE.Color(bg.color); return; }
    if (bg.type === 'gradient') {
      const c = document.createElement('canvas'); c.width = 4; c.height = 256;
      const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, bg.top); grd.addColorStop(1, bg.bottom); g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = t; this.bgTexture = t; return;
    }
    if (bg.type === 'image' && bg.image) {
      const t = new THREE.Texture(bg.image); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      const ia = bg.image.width / bg.image.height, ca = this.camera.aspect;
      if (bg.fit === 'cover') {
        if (ia > ca) { t.repeat.set(ca / ia, 1); t.offset.set((1 - ca / ia) / 2, 0); } else { t.repeat.set(1, ia / ca); t.offset.set(0, (1 - ia / ca) / 2); }
      }
      this.scene.background = t; this.bgTexture = t;
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
  screenshot({ scale = 1, transparent = false } = {}) {
    const r = this.renderer;
    const prevBg = this.scene.background, prevRatio = r.getPixelRatio();
    const prevFloor = this.floor.visible, prevMarkers = this.markers.visible;
    this.markers.visible = false;
    if (transparent) { this.scene.background = null; r.setClearColor(0, 0); this.floor.visible = false; }
    r.setPixelRatio(prevRatio * scale);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    r.setSize(w, h, false);
    r.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.scene.background = prevBg; this.floor.visible = prevFloor; this.markers.visible = prevMarkers;
    r.setPixelRatio(prevRatio); r.setSize(w, h, false);
    this.applyBackground();
    return url;
  }
}
