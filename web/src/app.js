// Main application: model library, viewer state and all the panels.
import * as THREE from 'three';
import { Viewer, LIGHT_PRESETS, LIGHT_TYPES, BG_PRESETS, newLight } from './viewer.js';
import { Rig, textureSettings, clearTextureCache, computeIslands, setIslandHidden } from './character.js';
import { loadAnim, buildClip, sampleCurve, describeAnims, ribbonFor, ribbonTrackFilter, removeTracksFor, isFightAnim } from './animation.js';
import { toonGlobals } from './toon.js';
import { PoseTool, SpringBones, BODY_PARTS, FINGER_PARTS } from './pose.js';
import * as platform from './platform.js';
import { initMusic } from './music.js';
import { fetchRoster, fetchCharacter, downloadCharacter } from './encore.js';
import { icon, hydrateIcons } from './icons.js';
import { SCENES, sceneThumb } from './backgrounds.js';

hydrateIcons();

const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const toast = (msg, ms = 2600) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); };
const status = (msg) => { $('#status').hidden = !msg; $('#statusText').textContent = msg ?? ''; };

function slider(label, { min, max, step = 0.01, value, onInput, fmt = (v) => (+v).toFixed(2) }) {
  const val = h('span', { class: 'val' }, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, oninput: (e) => { val.textContent = fmt(e.target.value); onInput(+e.target.value); } });
  return h('div', { class: 'row' }, h('label', {}, label), input, val);
}
function toggle(label, checked, onChange) {
  return h('div', { class: 'row' }, h('label', {}, label),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('span')));
}
function chips(options, current, onPick) {
  return h('div', { class: 'chips' }, options.map(([v, l]) => h('button', { class: 'chip', 'aria-pressed': String(v === current), onclick: () => onPick(v) }, l)));
}

// keep the playback bar above the bottom sheet, and fit the model into the space above the panels
function updateInset() {
  const sh = $('#sheet');
  const land = matchMedia('(orientation: landscape) and (min-width: 700px)').matches;
  const open = !sh.hidden && !land && !document.body.classList.contains('photo');
  const hpx = open ? sh.offsetHeight : 0;
  document.body.style.setProperty('--sheet-h', `${hpx}px`);
  viewer.setBottomInset(open ? Math.max(0, innerHeight - sh.getBoundingClientRect().top + 8) : 0);
}
new ResizeObserver(() => updateInset()).observe($('#sheet'));

// ---------------------------------------------------------------- state
const viewer = new Viewer($('#view'));
const S = {
  modelId: null, modelName: '', pkg: null, cat: null,
  rig: null, mixer: null, extras: [],   // weapons / props: { kind, entry, pieces: [{ path, name, bone, rig, mixer }], visible, loaded }
  weapon: null, usesWeapon: false,      // the weapon picked in the top bar; whether the current animation holds one
  animPath: null, clip: null, ribbonPath: null, time: 0, duration: 0, playing: true, loop: true, speed: 1,
  inPlace: false, animFace: true, autoRibbon: true, mode: 'menu', animFilter: '',
  morphValues: new Map(), morphFilter: '', curves: [],
  tab: null, cutMode: false, bindPose: false,
};
const pose = new PoseTool(viewer, (why) => { if (why === 'select' && S.tab === 'pose') renderTab(); });
const springs = new SpringBones();
const SPRING_DEFAULTS = { enabled: springs.enabled, stiffness: springs.stiffness, gravity: springs.gravity, damping: springs.damping };
viewer.headPosition = () => S.rig?.findBone('Bip001Head')?.getWorldPosition(new THREE.Vector3()) ?? null;

// lights / background / look restored from the last session
viewer.setLights(platform.store.get('lights', null)?.map((l) => newLight(l.type, l)) ?? LIGHT_PRESETS['Studio']());
viewer.setBackground(platform.store.get('bg', BG_PRESETS[0]));
viewer.setFloor(platform.store.get('floor', 'shadow'));
const LOOK_DEFAULTS = { outline: 1, outlineOn: true, rim: 0.6, soft: 1, selfShadow: false, spec: 1, sat: 1, exposure: 1, renderScale: Math.min(devicePixelRatio, platform.isMobile ? 1.75 : 2), texSize: platform.isMobile ? 1024 : 2048, fov: 30, solid: false };
const look = Object.assign({ ...LOOK_DEFAULTS }, platform.store.get('look', {}));
function applyLook() {
  toonGlobals.uOutlineScale.value = look.outline; toonGlobals.uOutlineOn.value = look.outlineOn ? 1 : 0;
  toonGlobals.uRimStrength.value = look.rim; toonGlobals.uShadowSoft.value = look.soft;
  toonGlobals.uSelfShadow.value = look.selfShadow ? 1 : 0; toonGlobals.uSpecStrength.value = look.spec;
  toonGlobals.uSaturation.value = look.sat; toonGlobals.uExposure.value = look.exposure;
  textureSettings.maxSize = look.texSize;
  textureSettings.jsDecode = platform.isSafari;
  viewer.setFov(look.fov);
  document.body.classList.toggle('solid', !!look.solid);
  platform.store.set('look', look);
}
applyLook();
viewer.setRenderScale(look.renderScale);
const saveLights = () => platform.store.set('lights', viewer.lights);

// ---------------------------------------------------------------- loading a model
async function openModel(id, name) {
  closeLibrary();
  disposeModel();
  S.modelId = id; S.modelName = name;
  platform.store.set('lastModel', id);
  $('#title').textContent = name;
  setAvatar($('#titleAvatar'), id, name);
  try {
    status('Reading package…');
    const pkg = await platform.openPackage(id);
    S.pkg = pkg; S.cat = pkg.catalog();
    if (!S.cat.main) throw new Error('The package contains no character (.uemodel)');
    const rig = new Rig(name);
    S.rig = rig;
    viewer.world.add(rig.group);
    await rig.addModel(pkg, S.cat.main.path, { onStatus: status, label: 'Character' });
    for (const p of S.cat.parts) await rig.addModel(pkg, p.path, { onStatus: status, label: p.name });
    S.mixer = new THREE.AnimationMixer(rig.space);
    pose.setRig(rig); springs.setRig(rig);
    // props sharing the body skeleton are skinned to it; others get their own rig
    for (const p of S.cat.props) S.extras.push({ kind: 'prop', entry: p, pieces: [{ path: p.path, name: p.name, bone: 'Root' }], visible: false, loaded: false });
    for (const w of S.cat.weapons) S.extras.push({ kind: 'weapon', entry: w, pieces: w.pieces.map((p, i) => ({ ...p, bone: weaponBone(w, i) })), visible: false, loaded: false });
    setupWeaponPicker();
    rig.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const s of rig.models[0].meshes) { s.geometry.computeBoundingBox(); }
    box.setFromObject(rig.group, true);
    viewer.frameObject(box);
    viewer.setFloorHeight(box.min.y + 0.002);
    restoreModelPrefs();
    // default animation: an idle from the menu set
    const first = defaultAnim();
    if (first) await playAnim(first);
    status(null);
    toast(`${name} loaded`);
    renderTab();
  } catch (e) {
    console.error(e);
    status(null);
    toast('Error: ' + e.message, 6000);
  }
}

function disposeModel() {
  S.mixer?.stopAllAction();
  for (const x of S.extras) for (const p of x.pieces) { p.mixer?.stopAllAction(); p.rig?.dispose(); }
  S.rig?.dispose();
  S.rig = null; S.mixer = null; S.extras = []; S.weapon = null; S.animPath = null; S.clip = null; S.curves = [];
  S.morphValues.clear(); pose.setRig(null); pose.setActive(false); springs.setRig(null);
  clearTextureCache();
  $('#player').hidden = true;
  $('#weaponPill').hidden = true;
}

function defaultAnim() {
  const all = S.cat.charAnims;
  const pick = (re) => all.find((p) => re.test(p));
  return pick(/\/CommonAnim\/Stand1\.ueanim$/i) ?? pick(/UiAnim\/Team_Stand1\.ueanim$/i) ?? pick(/\/Stand\d+\.ueanim$/i) ?? pick(/Stand/i) ?? all.find((p) => !/RibbonAnim/i.test(p)) ?? null;
}

// ---------------------------------------------------------------- animation
async function playAnim(path) {
  if (!S.rig) return;
  try {
    status('Loading animation…');
    S.bindPose = false;
    const anim = await loadAnim(S.pkg, path);
    S.mixer.stopAllAction();
    S.mixer.uncacheRoot(S.rig.space);
    const clip = buildClip(S.rig, anim, { inPlace: S.inPlace });
    S.curves = clip.userData.curves;
    S.clip = clip; S.animPath = path; S.duration = clip.duration;
    S.ribbonPath = null;
    if (S.autoRibbon && !/RibbonAnim/i.test(path)) {
      const rib = ribbonFor(path, S.cat.charAnims);
      if (rib) {
        const ranim = await loadAnim(S.pkg, rib);
        const rclip = buildClip(S.rig, ranim, { name: 'ribbon', filter: ribbonTrackFilter });
        removeTracksFor(clip, rclip);
        S.mixer.clipAction(rclip).play();
        S.curves = S.curves.concat(rclip.userData.curves);
        S.ribbonPath = rib;
      }
    }
    S.mixer.clipAction(clip).play();
    S.usesWeapon = holdsWeapon(path);
    S.time = 0;
    springs.reset();
    await syncExtras();
    S.playing = true;
    pose.setActive(false);
    $('#player').hidden = false;
    updatePlayer();
    status(null);
    if (S.tab === 'anim') renderTab();
  } catch (e) { status(null); toast('Could not load the animation: ' + e.message, 5000); }
}

// Animations that use the weapon: combat, the battle stance (Stand2, StandChange) and the weapon menu poses.
function holdsWeapon(path) {
  const name = path.split('/').pop().replace(/\.ueanim$/i, '');
  return isFightAnim(path) || /weapon|^(AM_)?Stand(2|Change)/i.test(name);
}

// Props appear with their own animation (same name as the body's); the chosen weapon appears in
// every animation that uses a weapon, and follows its own animation when it has one.
async function syncExtras() {
  const base = S.animPath?.split('/').pop().toLowerCase();
  for (const x of S.extras) {
    const match = base ? x.entry.anims.find((a) => a.split('/').pop().toLowerCase() === base) : null;
    const want = x.kind === 'weapon' ? x === S.weapon && (S.usesWeapon || !!match) : !!match;
    if (want && !x.loaded) await loadExtra(x);
    x.visible = want;
    const anim = match && want ? await loadAnim(S.pkg, match) : null;
    for (const p of x.pieces) {
      if (!p.rig) continue;
      p.rig.group.visible = want;
      p.mixer.stopAllAction();
      if (anim) p.mixer.clipAction(buildClip(p.rig, anim)).play();
      else p.rig.resetToBind();
    }
  }
}

// Socket of each weapon piece: two-piece weapons (gauntlets, pistols, sword + scabbard) use the right
// then the left hand socket; rectifiers float on WeaponProp07; anything else goes in the right hand.
function weaponBone(w, i) {
  if (w.pieces.length > 1) return ['WeaponProp02', 'WeaponProp01'][i] ?? 'WeaponProp01';
  return /^Device$/i.test(w.type) ? 'WeaponProp07' : 'WeaponProp02';
}

async function loadExtra(x) {
  status(`Loading ${x.entry.name}…`);
  for (const p of x.pieces) {
    const rig = new Rig(p.name);
    // attached rigs live in the parent bone's space: no unit conversion
    rig.space.rotation.set(0, 0, 0); rig.space.scale.setScalar(1);
    await rig.addModel(S.pkg, p.path, { label: p.name });
    p.rig = rig;
    p.mixer = new THREE.AnimationMixer(rig.space);
    const parent = S.rig.findBone(p.bone) ?? S.rig.findBone('WeaponProp01') ?? S.rig.bones[0];
    parent.add(rig.group);
    rig.finalizeSkeleton();
  }
  x.loaded = true;
  status(null);
}

// ---- Weapon picker (top bar, next to the character name)
const WEAPON_TYPES = { Sword: 'Sword', Knife: 'Broadblade', Gun: 'Pistols', Knuckles: 'Gauntlets', Device: 'Rectifier' };
const weaponLabel = (w) => { // Weapon/Knuckles/R5Knuckles504 → "Gauntlets 504"
  const num = /(\d+)$/.exec(w.entry.name)?.[1];
  return num ? `${WEAPON_TYPES[w.entry.type] ?? w.entry.type} ${num}` : w.entry.name;
};
function showWeaponName() {
  $('#weaponName').textContent = S.weapon ? weaponLabel(S.weapon) : 'No weapon';
  $('#weaponPill').classList.toggle('off', !S.weapon);
}
function setupWeaponPicker() {
  const weapons = S.extras.filter((x) => x.kind === 'weapon');
  const saved = platform.store.get(prefsKey(), null)?.weapon;
  S.weapon = saved === null ? null : weapons.find((w) => w.entry.name === saved) ?? weapons[0] ?? null;
  $('#weaponPill').hidden = !weapons.length;
  $('#weaponSelect').replaceChildren(h('option', { value: '' }, 'No weapon'),
    ...weapons.map((w, i) => h('option', { value: String(i), selected: w === S.weapon }, weaponLabel(w))));
  showWeaponName();
}
$('#weaponSelect').onchange = async (e) => {
  const weapons = S.extras.filter((x) => x.kind === 'weapon');
  S.weapon = weapons[+e.target.value] ?? null;
  showWeaponName();
  saveModelPrefs();
  await syncExtras();
  setTime(S.time);
};

function setTime(t) {
  S.time = t;
  S.mixer?.setTime(t);
  for (const x of S.extras) if (x.visible) for (const p of x.pieces) p.mixer?.setTime(t);
}

function applyMorphs() {
  if (!S.rig) return;
  const fromCurves = new Map();
  if (S.animFace && !S.bindPose && S.curves.length) {
    const t = S.duration ? S.time % (S.duration + 1e-6) : 0;
    for (const c of S.curves) fromCurves.set(c.morph, sampleCurve(c, t));
  }
  for (const m of S.rig.morphMeta) {
    const manual = S.morphValues.get(m.name) ?? 0;
    const v = manual !== 0 ? manual : (fromCurves.get(m.name) ?? 0);
    S.rig.setMorph(m.name, v);
  }
}

viewer.onBeforeRender.push((dt) => {
  if (!S.rig) return;
  if (!pose.active && !S.bindPose && S.clip) {
    if (S.playing) {
      let t = S.time + dt * S.speed;
      if (t > S.duration) {
        if (S.loop) { t = t % Math.max(S.duration, 1e-3); springs.reset(); }
        else { t = S.duration; S.playing = false; }
      }
      setTime(t);
      updatePlayer();
    }
  }
  applyMorphs();
  S.rig.group.updateMatrixWorld(true);
  springs.update(dt);
  pose.updateMarkers();
});

function setIcon(btn, name) { btn.replaceChildren(icon(name)); }
function updatePlayer() {
  const fps = S.clip?.userData.fps ?? 30;
  const want = S.playing && !pose.active ? 'pause' : 'play';
  if ($('#btnPlay').dataset.ic !== want) { setIcon($('#btnPlay'), want); $('#btnPlay').dataset.ic = want; }
  const nm = S.animPath ? S.animPath.split('/').pop().replace(/\.ueanim$/i, '') : '—';
  if ($('#animName').textContent !== nm) $('#animName').textContent = nm;
  if (!S.duration) return;
  $('#timeline').value = String(Math.round((S.time / S.duration) * 1000));
  $('#frameLabel').textContent = `${Math.round(S.time * fps)}/${Math.round(S.duration * fps)}`;
}
$('#btnPlay').onclick = () => {
  if (pose.active) { pose.setActive(false); if (S.tab === 'pose') renderTab(); }
  S.bindPose = false;
  if (!S.playing && S.time >= S.duration) S.time = 0;
  S.playing = !S.playing; updatePlayer();
};
$('#timeline').oninput = (e) => { S.playing = false; S.bindPose = false; pose.setActive(false); setTime((+e.target.value / 1000) * S.duration); updatePlayer(); };
$('#btnLoop').onclick = (e) => { S.loop = !S.loop; e.currentTarget.setAttribute('aria-pressed', String(S.loop)); };
$('#speed').onchange = (e) => { S.speed = +e.target.value; };

// previous / next animation (arrows, or swipe sideways on the animation name)
function animSequence() {
  if (!S.cat) return [];
  const groups = describeAnims(S.cat.charAnims.filter((p) => !/RibbonAnim/i.test(p)), S.cat.roleDir);
  const all = groups.flatMap((g) => g.items);
  const inMode = all.filter((it) => S.mode === 'all' || (S.mode === 'fight') === it.fight).map((it) => it.path);
  return inMode.includes(S.animPath) || !inMode.length ? (inMode.length ? inMode : all.map((it) => it.path)) : inMode;
}
async function stepAnim(dir) {
  const list = animSequence(); if (!list.length) return;
  const i = list.indexOf(S.animPath);
  const next = list[(i < 0 ? 0 : i + dir + list.length) % list.length];
  const lab = $('#animName');
  lab.classList.add(dir > 0 ? 'swipe-l' : 'swipe-r');
  await playAnim(next);
  lab.classList.remove('swipe-l', 'swipe-r');
}
$('#btnPrevAnim').onclick = () => stepAnim(-1);
$('#btnNextAnim').onclick = () => stepAnim(1);
{
  let sx = null;
  const bar = $('#animBar');
  bar.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) sx = { x: e.clientX, y: e.clientY }; });
  bar.addEventListener('pointerup', (e) => {
    if (!sx) return;
    const dx = e.clientX - sx.x, dy = e.clientY - sx.y; sx = null;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) stepAnim(dx < 0 ? 1 : -1);
  });
  bar.addEventListener('pointercancel', () => { sx = null; });
}
function gestureHint(text) {
  const g = $('#gestureHint'); g.textContent = text; g.hidden = false;
  g.style.animation = 'none'; void g.offsetWidth; g.style.animation = '';
  clearTimeout(gestureHint.t); gestureHint.t = setTimeout(() => (g.hidden = true), 1100);
}

// ---------------------------------------------------------------- picking (tap on the model)
const raycaster = new THREE.Raycaster();
let down = null;
viewer.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
let lastTap = null, tapTimer = null;
viewer.canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 8 || dt > 500) return;
  const now = performance.now();
  const dbl = lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
  lastTap = dbl ? null : { t: now, x: e.clientX, y: e.clientY };
  const r = viewer.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, viewer.camera);
  if (pose.active && pose.pick(raycaster)) return;
  if (S.cutMode) { cutAt(raycaster); return; }
  if (dbl) {
    clearTimeout(tapTimer);
    if (S.rig) gestureHint(viewer.toggleFaceFrame() === 'face' ? 'Face' : 'Full body');
    return;
  }
  if (photo.on) { clearTimeout(tapTimer); tapTimer = setTimeout(() => document.body.classList.toggle('photo-bare'), 330); }
});

function visibleMeshes() {
  const out = [];
  const rigs = [S.rig, ...S.extras.flatMap((x) => x.pieces.map((p) => p.rig))].filter(Boolean);
  for (const rig of rigs) for (const { model, section } of rig.allSections()) if (section.mesh.visible && rig.group.visible !== false) out.push({ rig, model, section });
  return out;
}
const cutHistory = [];
function cutAt(ray) {
  const list = visibleMeshes();
  const hits = ray.intersectObjects(list.map((x) => x.section.mesh), false);
  for (const hit of hits) {
    const it = list.find((x) => x.section.mesh === hit.object);
    const isl = computeIslands(it.section.geometry);
    const v = hit.face.a;
    const island = isl.vertIsland[v];
    if (it.section.hidden.has(island)) continue; // already hidden: look behind it
    setIslandHidden(it.section, island, true);
    cutHistory.push({ section: it.section, island });
    saveModelPrefs();
    toast(`Piece hidden (${it.section.label}). Tap “Undo” to bring it back.`);
    if (S.tab === 'parts') renderTab();
    return;
  }
}

// ---------------------------------------------------------------- per-model preferences
function prefsKey() { return 'model.' + S.modelId; }
function saveModelPrefs() {
  if (!S.rig) return;
  const sections = {};
  for (const { model, section } of S.rig.allSections()) {
    sections[model.file + '|' + section.name] = { v: section.visible, h: [...section.hidden] };
  }
  platform.store.set(prefsKey(), { sections, models: S.rig.models.map((m) => m.visible), weapon: S.weapon ? S.weapon.entry.name : null });
}
function restoreModelPrefs() {
  const p = platform.store.get(prefsKey(), null); if (!p) return;
  for (const { model, section } of S.rig.allSections()) {
    const s = p.sections?.[model.file + '|' + section.name]; if (!s) continue;
    S.rig.setSectionVisible(model, section, s.v);
    for (const i of s.h ?? []) setIslandHidden(section, i, true);
  }
  p.models?.forEach((v, i) => S.rig.models[i] && S.rig.setModelVisible(S.rig.models[i], v));
}

// ---------------------------------------------------------------- bottom sheet size & live preview
const SHEET_SIZES = { peek: 30, half: 50, full: 80 };
let sheetSize = platform.store.get('sheetSize', 'peek');
function setSheetSize(sz, px) {
  if (sz) { sheetSize = sz; platform.store.set('sheetSize', sz); }
  document.body.style.setProperty('--sheet-max', px != null ? `${px}px` : `${SHEET_SIZES[sheetSize]}vh`);
  document.querySelectorAll('#grip .sz button').forEach((b) => b.classList.toggle('on', b.dataset.sz === sheetSize));
}
setSheetSize(sheetSize);
document.querySelectorAll('#grip .sz button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setSheetSize(b.dataset.sz); }));
{
  const grip = $('#grip');
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { y: e.clientY, h: $('#sheet').offsetHeight, moved: false };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) setSheetSize(null, Math.max(90, Math.min(innerHeight * 0.85, drag.h + dy)));
  });
  const end = () => {
    if (!drag) return;
    if (!drag.moved) setSheetSize(sheetSize === 'peek' ? 'half' : 'peek');
    else {
      const vh = ($('#sheet').offsetHeight / innerHeight) * 100;
      const best = Object.entries(SHEET_SIZES).sort((a, b) => Math.abs(a[1] - vh) - Math.abs(b[1] - vh))[0][0];
      if (vh < 18) { S.tab = null; renderTab(); } else setSheetSize(best);
    }
    drag = null;
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
// While a slider is held, hide the rest of the panel so the change is visible on the model.
document.addEventListener('pointerdown', (e) => {
  const r = e.target.closest?.('#sheetBody input[type=range]');
  if (!r) return;
  const row = r.closest('.row') ?? r.parentElement;
  row.classList.add('live-row');
  document.body.classList.add('live');
  const stop = () => { document.body.classList.remove('live'); row.classList.remove('live-row'); removeEventListener('pointerup', stop); removeEventListener('pointercancel', stop); };
  addEventListener('pointerup', stop); addEventListener('pointercancel', stop);
});

// ---------------------------------------------------------------- tabs
const tabs = {
  anim: renderAnimTab, pose: renderPoseTab, parts: renderPartsTab,
  face: renderFaceTab, lights: renderLightsTab, scene: renderSceneTab, look: renderLookTab,
};
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.tab;
  S.tab = S.tab === t ? null : t;
  if (S.tab !== 'parts') setCutMode(false);
  if (S.tab !== 'pose' && pose.active && !pose.selected) { /* keep pose */ }
  renderTab();
}));
function renderTab() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
  const sheet = $('#sheet'), body = $('#sheetBody');
  document.body.classList.toggle('sheet-open', !!S.tab);
  if (!S.tab) { sheet.hidden = true; return; }
  sheet.hidden = false;
  const scroll = body.scrollTop;
  body.replaceChildren();
  if (!S.rig && !['lights', 'scene', 'look'].includes(S.tab)) {
    body.append(h('p', { class: 'hint' }, 'Open a model from the library (☰) to start.'));
    return;
  }
  tabs[S.tab](body);
  body.scrollTop = scroll;
}

// ---- Animation
function renderAnimTab(body) {
  body.append(h('h3', {}, 'Animations'));
  body.append(chips([['menu', 'Menu & gestures'], ['fight', 'Combat'], ['all', 'All']], S.mode, (v) => { S.mode = v; renderTab(); }));
  const search = h('input', { type: 'search', placeholder: 'Search animations…', value: S.animFilter, oninput: (e) => { S.animFilter = e.target.value; fill(); } });
  body.append(search);
  const opts = h('div', { class: 'chips' },
    h('button', { class: 'chip', 'aria-pressed': String(S.inPlace), onclick: async () => { S.inPlace = !S.inPlace; if (S.animPath) await playAnim(S.animPath); renderTab(); } }, 'In place'),
    h('button', { class: 'chip', 'aria-pressed': String(S.autoRibbon), onclick: async () => { S.autoRibbon = !S.autoRibbon; if (S.animPath) await playAnim(S.animPath); renderTab(); } }, 'Auto ribbons'),
    h('button', { class: 'chip', 'aria-pressed': String(S.animFace), onclick: () => { S.animFace = !S.animFace; renderTab(); } }, 'Animated expressions'),
    h('button', { class: 'chip', 'aria-pressed': String(S.bindPose), onclick: () => { S.bindPose = !S.bindPose; if (S.bindPose) { S.rig.resetToBind(); S.playing = false; } else setTime(S.time); updatePlayer(); renderTab(); } }, 'Bind pose (T)'),
  );
  body.append(opts);
  const list = h('div');
  body.append(list);
  function fill() {
    list.replaceChildren();
    const f = S.animFilter.trim().toLowerCase();
    const paths = S.cat.charAnims.filter((p) => !/RibbonAnim/i.test(p) || S.mode === 'all');
    const groups = describeAnims(paths, S.cat.roleDir);
    let shown = 0;
    for (const g of groups) {
      const items = g.items.filter((it) => (S.mode === 'all' || (S.mode === 'fight') === it.fight) && (!f || it.label.toLowerCase().includes(f) || g.label.toLowerCase().includes(f)));
      if (!items.length) continue;
      shown += items.length;
      const det = h('details', { open: !!f || items.some((i) => i.path === S.animPath) || groups.length <= 2 },
        h('summary', {}, `${g.label} `, h('span', { class: 'sub' }, `(${items.length})`)),
        h('div', { class: 'inner' }, items.map((it) => h('button', {
          class: 'anim-item' + (it.path === S.animPath ? ' on' : ''), onclick: () => playAnim(it.path),
        }, it.label, ribbonFor(it.path, S.cat.charAnims) ? h('span', { class: 'tag' }, '+ribbons') : null,
        S.extras.some((x) => x.entry.anims.some((a) => a.split('/').pop() === it.path.split('/').pop())) ? h('span', { class: 'tag' }, '+prop') : null))));
      list.append(det);
    }
    if (!shown) list.append(h('p', { class: 'hint' }, 'No animations in this group.'));
  }
  fill();
}

// ---- Pose
// Undo every manual bone edit: back to the animation's pose at the current frame.
function resetPose() {
  if (!S.rig) return;
  if (pose.active) pose.pushUndo();
  S.bindPose = false;
  S.rig.resetToBind();
  S.mixer?.setTime(S.time);
  for (const x of S.extras) if (x.visible) for (const p of x.pieces) p.mixer?.setTime(S.time);
  springs.reset();
  S.rig.group.updateMatrixWorld(true);
  updatePlayer();
  toast('Pose reset');
}
const resetBtn = (label, onclick) => h('button', { class: 'btn reset-btn', onclick }, icon('reset'), label);
function renderPoseTab(body) {
  body.append(h('h3', {}, 'Pose tool'));
  body.append(toggle('Edit pose (freezes the animation)', pose.active, (v) => {
    pose.setActive(v);
    if (v) { S.playing = false; updatePlayer(); toast('Tap a joint (dots) or pick a bone below'); }
    renderTab();
  }));
  if (!pose.active) {
    body.append(h('p', { class: 'hint' }, 'Turn on editing to rotate bones with the gizmo, move hands and feet with IK, or save poses. Press ▶ to resume the animation.'));
  } else {
    body.append(h('div', { class: 'grid3' },
      h('button', { class: 'btn' + (pose.mode === 'rotate' ? ' on' : ''), onclick: () => { pose.setMode('rotate'); renderTab(); } }, '↻ Rotate'),
      h('button', { class: 'btn' + (pose.mode === 'move' ? ' on' : ''), onclick: () => { pose.setMode('move'); renderTab(); } }, '✥ Move / IK'),
      h('button', { class: 'btn', onclick: () => { pose.setSpace(pose.space === 'local' ? 'world' : 'local'); renderTab(); } }, pose.space === 'local' ? 'Axes: local' : 'Axes: world'),
    ));
    const sel = pose.selected;
    body.append(h('p', { class: 'hint' }, sel ? `Selected: ${sel.part?.label ?? sel.bone.userData.name}${pose.mode === 'move' && !sel.ik && !sel.move ? ' — “Move” works on hands, feet and center' : ''}` : 'Nothing selected'));
    body.append(h('div', { class: 'grid3' },
      h('button', { class: 'btn', onclick: () => pose.popUndo() }, '↶ Undo'),
      h('button', { class: 'btn', onclick: () => pose.resetBone() }, 'Reset bone'),
      h('button', { class: 'btn', onclick: () => pose.mirror() }, 'Mirror to other side'),
    ));
    body.append(h('h3', {}, 'Body'));
    body.append(h('div', { class: 'chips' }, BODY_PARTS.filter((p) => S.rig.findBone(p.bone)).map((p) =>
      h('button', { class: 'chip small' + (sel?.bone === S.rig.findBone(p.bone) ? ' on' : ''), onclick: () => { pose.select(S.rig.findBone(p.bone), p); renderTab(); } }, p.label))));
    const fingers = h('details', {}, h('summary', {}, 'Fingers'), h('div', { class: 'inner chips' }, FINGER_PARTS.filter((p) => S.rig.findBone(p.bone)).map((p) =>
      h('button', { class: 'chip small', onclick: () => { pose.select(S.rig.findBone(p.bone), p); renderTab(); } }, p.label))));
    body.append(fingers);
    const rawSearch = h('input', { type: 'search', placeholder: 'Search bones (hair, skirt, ribbons…)' });
    const rawList = h('ul', { class: 'list' });
    const fillRaw = () => {
      const f = rawSearch.value.toLowerCase();
      rawList.replaceChildren(...S.rig.bones.filter((b) => !f || b.userData.name.toLowerCase().includes(f)).slice(0, 80).map((b) =>
        h('li', { class: sel?.bone === b ? 'sel' : '', onclick: () => { pose.select(b, null); renderTab(); } }, h('span', { class: 'grow' }, b.userData.name))));
    };
    rawSearch.oninput = fillRaw; fillRaw();
    body.append(h('details', {}, h('summary', {}, `All bones (${S.rig.bones.length})`), h('div', { class: 'inner' }, rawSearch, rawList)));
  }
  body.append(resetBtn('Reset pose', () => { resetPose(); renderTab(); }));
  body.append(h('h3', {}, 'Poses'));
  body.append(h('div', { class: 'grid3' },
    h('button', { class: 'btn', onclick: () => {
      const data = JSON.stringify(pose.capture(), null, 1);
      platform.saveFile(`${S.modelName.replace(/[\\/:*?"<>|]/g, '_')}-pose.json`, data, 'application/json');
      toast('Pose exported');
    } }, 'Export'),
    h('button', { class: 'btn', onclick: async () => {
      const f = await platform.pickFile('application/json,.json'); if (!f) return;
      try {
        const p = JSON.parse(await f.text());
        pose.setActive(true); S.playing = false;
        const unknown = pose.apply(p);
        toast(unknown.length ? `Pose applied (${unknown.length} bones don’t exist on this model)` : (p.character && p.character !== S.modelName ? `Pose applied (made for ${p.character})` : 'Pose applied'));
        renderTab();
      } catch (e) { toast('Invalid pose file'); }
    } }, 'Import'),
    h('button', { class: 'btn', onclick: () => { savedPoses(); } }, 'Saved'),
  ));
  body.append(h('h3', {}, 'Physics'));
  body.append(toggle('Hair, skirt and ribbons follow the motion', springs.enabled, (v) => { springs.enabled = v; springs.reset(); }));
  body.append(slider('Stiffness', { min: 0.02, max: 0.6, value: springs.stiffness, onInput: (v) => (springs.stiffness = v) }));
  body.append(slider('Gravity', { min: 0, max: 1.5, value: springs.gravity, onInput: (v) => (springs.gravity = v) }));
  body.append(slider('Damping', { min: 0.02, max: 0.6, value: springs.damping, onInput: (v) => (springs.damping = v) }));
  body.append(resetBtn('Reset physics', () => { Object.assign(springs, SPRING_DEFAULTS); springs.reset(); renderTab(); }));
}
function savedPoses() {
  const key = 'poses.' + S.modelId;
  const list = platform.store.get(key, []);
  const body = $('#sheetBody');
  body.replaceChildren(h('h3', {}, 'Saved poses'),
    h('button', { class: 'primary', onclick: () => {
      const name = prompt('Pose name', `Pose ${list.length + 1}`); if (!name) return;
      list.push({ name, pose: pose.capture() }); platform.store.set(key, list); savedPoses();
    } }, 'Save current pose'),
    h('ul', { class: 'list' }, list.map((p, i) => h('li', {},
      h('span', { class: 'grow' }, p.name),
      h('button', { class: 'btn', onclick: () => { pose.setActive(true); S.playing = false; pose.apply(p.pose); updatePlayer(); toast('Pose applied'); } }, 'Apply'),
      h('button', { class: 'btn danger', onclick: () => { list.splice(i, 1); platform.store.set(key, list); savedPoses(); } }, '✕')))),
    h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => renderTab() }, '← Back'));
}

// ---- Parts / clothing
function setCutMode(v) {
  S.cutMode = v;
  $('#pickHint').hidden = !v;
  $('#pickHint').textContent = 'Scissors mode: tap a piece of the model to hide it';
}
function sw(checked, onChange) {
  return h('label', { class: 'switch sm', onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('span'));
}
function renderPartsTab(body) {
  body.append(h('div', { class: 'grid3' },
    h('button', { class: 'btn' + (S.cutMode ? ' on' : ''), onclick: () => { setCutMode(!S.cutMode); renderTab(); } }, S.cutMode ? '✂ On' : '✂ Scissors'),
    h('button', { class: 'btn', onclick: () => { const c = cutHistory.pop(); if (c) { setIslandHidden(c.section, c.island, false); saveModelPrefs(); renderTab(); } } }, '↶ Undo'),
    h('button', { class: 'btn', onclick: () => {
      for (const { model, section } of S.rig.allSections()) { for (const i of [...section.hidden]) setIslandHidden(section, i, false); S.rig.setSectionVisible(model, section, true); }
      S.rig.models.forEach((m) => S.rig.setModelVisible(m, true)); cutHistory.length = 0; saveModelPrefs(); renderTab();
    } }, '⟲ All'),
  ));
  if (S.cutMode) body.append(h('p', { class: 'hint' }, 'Tap a piece of the model to hide it. You can lower this panel to see better.'));
  for (const model of S.rig.models) {
    body.append(h('div', { class: 'lrow' }, h('span', { class: 'name' }, h('b', {}, model.name)), sw(model.visible, (v) => { S.rig.setModelVisible(model, v); saveModelPrefs(); })));
    for (const s of model.meshes) {
      body.append(h('div', { class: 'lrow', style: { paddingLeft: '12px' } },
        h('span', { class: 'name' }, s.label, s.hidden.size ? h('span', { class: 'sub' }, ` · ${s.hidden.size} hidden`) : null),
        h('button', { class: 'ic', title: 'Highlight', onclick: () => { toonGlobals.uHighlight.value = s.sectionId; setTimeout(() => { if (toonGlobals.uHighlight.value === s.sectionId) toonGlobals.uHighlight.value = -1; }, 1500); } }, '👁'),
        h('button', { class: 'ic', title: 'Pieces', onclick: () => renderIslands(model, s) }, '⋯'),
        sw(s.visible, (v) => { S.rig.setSectionVisible(model, s, v); saveModelPrefs(); })));
    }
  }
}
function renderIslands(model, s) {
  const body = $('#sheetBody');
  const isl = computeIslands(s.geometry);
  const order = isl.sizes.map((n, i) => i).sort((a, b) => isl.sizes[b] - isl.sizes[a]);
  body.replaceChildren(
    h('button', { class: 'btn', onclick: () => renderTab() }, '← Back'),
    h('h3', {}, `${s.label}: ${isl.count} pieces`),
    h('p', { class: 'hint' }, 'Largest first. Tap “Show” to flash a piece for a moment.'),
    h('ul', { class: 'list' }, order.slice(0, 150).map((i, k) => h('li', {},
      h('span', { class: 'grow' }, `Piece ${k + 1}`, h('span', { class: 'sub' }, ` · ${isl.sizes[i]} vertices`)),
      h('button', { class: 'chip small', onclick: () => flashIsland(s, i) }, 'Show'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !s.hidden.has(i), onchange: (e) => { setIslandHidden(s, i, !e.target.checked); saveModelPrefs(); } }), h('span'))))),
  );
}
function flashIsland(s, i) {
  const was = s.hidden.has(i);
  let n = 0;
  const iv = setInterval(() => { setIslandHidden(s, i, n % 2 === 0 ? !was : was); if (++n >= 6) { clearInterval(iv); setIslandHidden(s, i, was); } }, 220);
}

// ---- Face / morph targets
function renderFaceTab(body) {
  body.append(h('h3', {}, 'Expressions (morphs)'));
  body.append(toggle('Animation drives the face', S.animFace, (v) => { S.animFace = v; }));
  const search = h('input', { type: 'search', placeholder: 'Search morphs…', value: S.morphFilter, oninput: (e) => { S.morphFilter = e.target.value; fill(); } });
  body.append(h('div', { class: 'row' }, search, h('button', { class: 'btn', onclick: () => { S.morphValues.clear(); fill(); } }, 'Reset')));
  body.append(h('p', { class: 'hint' }, 'Any value above 0 overrides the animation. Prefixes: E_ eyes, M_ mouth, B_ brows, Pupil pupils.'));
  const list = h('div'); body.append(list);
  const groupName = (m) => {
    const g = m.group.replace(/^MI_/, '').replace(/^.*Md\d+/, '') || 'Other';
    return { Face: 'Face', Eye: 'Eyes', Up: 'Upper clothes', Down: 'Lower clothes', Hair: 'Hair', Bangs: 'Bangs' }[g] ?? g;
  };
  function fill() {
    list.replaceChildren();
    if (!S.rig.morphMeta.length) { list.append(h('p', { class: 'hint' }, 'This model has no morphs.')); return; }
    const f = S.morphFilter.trim().toLowerCase();
    const groups = new Map();
    for (const m of S.rig.morphMeta) {
      if (f && !m.name.toLowerCase().includes(f)) continue;
      const g = groupName(m); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m);
    }
    const order = ['Face', 'Eyes'];
    for (const [g, ms] of [...groups].sort((a, b) => (order.indexOf(a[0]) + 1 || 9) - (order.indexOf(b[0]) + 1 || 9))) {
      list.append(h('details', { open: order.includes(g) || !!f }, h('summary', {}, `${g} (${ms.length})`),
        h('div', { class: 'inner' }, ms.map((m) => slider(m.name, { min: 0, max: 1, step: 0.01, value: S.morphValues.get(m.name) ?? 0, onInput: (v) => S.morphValues.set(m.name, v) })))));
    }
  }
  fill();
}

// ---- Lights
function renderLightsTab(body) {
  body.append(resetBtn('Reset lights', () => { viewer.setLights(LIGHT_PRESETS['Studio']()); viewer.markers.visible = false; S.openLight = null; saveLights(); renderTab(); toast('Lights reset'); }));
  body.append(h('div', { class: 'chips', style: { flexWrap: 'nowrap', overflowX: 'auto' } }, Object.keys(LIGHT_PRESETS).map((n) => h('button', { class: 'chip', style: { flex: 'none' }, onclick: () => { viewer.setLights(LIGHT_PRESETS[n]()); S.openLight = null; saveLights(); renderTab(); } }, n))));
  body.append(h('div', { class: 'row' },
    h('select', { class: 'full', style: { flex: '1' }, onchange: (e) => {
      const t = e.target.value; if (!t) return;
      const L = newLight(t, { name: `${LIGHT_TYPES[t]} ${viewer.lights.filter((x) => x.type === t).length + 1}`, azimuth: Math.round(Math.random() * 360) });
      viewer.lights.push(L); S.openLight = L.id; viewer.rebuildLights(); saveLights(); renderTab();
    } }, h('option', { value: '' }, '＋ Add light…'), Object.entries(LIGHT_TYPES).map(([t, l]) => h('option', { value: t }, l))),
    h('button', { class: 'ic' + (viewer.markers.visible ? ' on' : ''), title: 'Show light positions', style: { height: '38px' }, onclick: () => { viewer.markers.visible = !viewer.markers.visible; renderTab(); } }, icon('sparkle'))));
  viewer.lights.forEach((L, i) => {
    const upd = () => { viewer.updateLights(); saveLights(); };
    const open = S.openLight === L.id;
    body.append(h('div', { class: 'lrow', onclick: () => { S.openLight = open ? null : L.id; renderTab(); } },
      h('span', { class: 'dot', style: { background: L.color } }),
      h('span', { class: 'name' }, L.name, h('span', { class: 'sub' }, ` · ${L.name === LIGHT_TYPES[L.type] ? '' : LIGHT_TYPES[L.type] + ' · '}${(+L.intensity).toFixed(1)}`)),
      sw(L.enabled, (v) => { L.enabled = v; upd(); }),
      h('span', { class: 'sub' }, open ? '▾' : '▸')));
    if (!open) return;
    const inner = h('div', { class: 'lpanel' });
    requestAnimationFrame(() => inner.scrollIntoView({ block: 'nearest' }));
    inner.append(h('div', { class: 'row' }, h('label', {}, 'Color'), h('input', { type: 'color', value: L.color, oninput: (e) => { L.color = e.target.value; upd(); } }),
      L.type === 'hemisphere' ? h('label', {}, 'Ground') : null,
      L.type === 'hemisphere' ? h('input', { type: 'color', value: L.groundColor, oninput: (e) => { L.groundColor = e.target.value; upd(); } }) : null));
    inner.append(slider('Intensity', { min: 0, max: L.type === 'point' || L.type === 'spot' ? 20 : 4, value: L.intensity, onInput: (v) => { L.intensity = v; upd(); } }));
    if (L.type !== 'ambient' && L.type !== 'hemisphere') {
      inner.append(slider('Horizontal', { min: -180, max: 180, step: 1, value: ((L.azimuth + 180) % 360 + 360) % 360 - 180, onInput: (v) => { L.azimuth = v; upd(); }, fmt: (v) => `${Math.round(v)}°` }));
      inner.append(slider('Height', { min: -89, max: 89, step: 1, value: L.elevation, onInput: (v) => { L.elevation = v; upd(); }, fmt: (v) => `${Math.round(v)}°` }));
    }
    if (L.type === 'point' || L.type === 'spot') inner.append(slider('Distance', { min: 0.3, max: 8, value: L.distance, onInput: (v) => { L.distance = v; upd(); } }));
    if (L.type === 'spot') {
      inner.append(slider('Cone angle', { min: 3, max: 80, step: 1, value: L.angle, onInput: (v) => { L.angle = v; upd(); }, fmt: (v) => `${Math.round(v)}°` }));
      inner.append(slider('Soft edge', { min: 0, max: 1, value: L.penumbra, onInput: (v) => { L.penumbra = v; upd(); } }));
    }
    const opts = h('div', { class: 'chips' });
    if (L.type !== 'ambient' && L.type !== 'hemisphere') opts.append(h('button', { class: 'chip small', 'aria-pressed': String(L.followCamera), onclick: () => { L.followCamera = !L.followCamera; upd(); renderTab(); } }, 'Follows camera'));
    if (L.type === 'directional' || L.type === 'spot') opts.append(h('button', { class: 'chip small', 'aria-pressed': String(L.castShadow), onclick: () => { L.castShadow = !L.castShadow; upd(); renderTab(); } }, 'Shadow'));
    opts.append(
      h('button', { class: 'chip small', onclick: () => { const n = prompt('Light name', L.name); if (n) { L.name = n; saveLights(); renderTab(); } } }, '✎ Rename'),
      h('button', { class: 'chip small', onclick: () => { const c = newLight(L.type, { ...L, id: undefined, name: L.name + ' (copy)' }); viewer.lights.splice(i + 1, 0, c); S.openLight = c.id; viewer.rebuildLights(); saveLights(); renderTab(); } }, '⧉ Duplicate'),
      h('button', { class: 'chip small danger', onclick: () => { viewer.lights.splice(i, 1); viewer.rebuildLights(); saveLights(); renderTab(); } }, '🗑 Delete'));
    inner.append(opts);
    if (L.type === 'ambient') inner.append(h('p', { class: 'hint' }, 'Sets how dark the toon shadows are.'));
    body.append(inner);
  });
}

// ---- Scene
function renderSceneTab(body) {
  const bg = viewer.bg;
  const saveBg = () => platform.store.set('bg', { ...viewer.bg, image: null, type: viewer.bg.type === 'image' ? 'gradient' : viewer.bg.type });
  body.append(h('h3', {}, 'Background'));
  body.append(h('div', { class: 'chips' }, BG_PRESETS.map((p) => h('button', { class: 'chip small', onclick: () => { viewer.setBackground(p); saveBg(); renderTab(); } },
    h('span', { style: { display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', marginRight: '5px', background: p.type === 'gradient' ? `linear-gradient(${p.top},${p.bottom})` : p.color } }), p.name))));
  body.append(h('div', { class: 'chips', style: { flexWrap: 'nowrap', overflowX: 'auto' } }, Object.keys(SCENES).map((n) => h('button', { class: 'chip small' + (bg.type === 'scene' && bg.scene === n ? ' on' : ''), style: { flex: 'none' }, onclick: () => { viewer.setBackground({ type: 'scene', scene: n }); saveBg(); renderTab(); } },
    h('span', { style: { display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', marginRight: '6px', verticalAlign: '-2px', background: `url(${sceneThumb(n)}) center/cover` } }), n))));
  body.append(chips([['gradient', 'Gradient'], ['color', 'Color'], ['image', 'Image'], ['transparent', 'Transparent']], bg.type, async (v) => {
    if (v === 'image') {
      const f = await platform.pickFile('image/*'); if (!f) return;
      const img = await createImageBitmap(f);
      viewer.setBackground({ type: 'image', image: img });
    } else viewer.setBackground({ type: v });
    saveBg(); renderTab();
  }));
  if (bg.type === 'gradient') body.append(h('div', { class: 'row' }, h('label', {}, 'Top'), h('input', { type: 'color', value: bg.top, oninput: (e) => { viewer.setBackground({ top: e.target.value }); saveBg(); } }),
    h('label', {}, 'Bottom'), h('input', { type: 'color', value: bg.bottom, oninput: (e) => { viewer.setBackground({ bottom: e.target.value }); saveBg(); } })));
  if (bg.type === 'color') body.append(h('div', { class: 'row' }, h('label', {}, 'Color'), h('input', { type: 'color', value: bg.color, oninput: (e) => { viewer.setBackground({ color: e.target.value }); saveBg(); } })));
  if (bg.type === 'image') body.append(chips([['cover', 'Fill'], ['stretch', 'Stretch']], bg.fit, (v) => { viewer.setBackground({ fit: v }); renderTab(); }));
  body.append(h('h3', {}, 'Floor'));
  body.append(chips([['shadow', 'Shadow only'], ['disc', 'Platform'], ['grid', 'Grid'], ['none', 'None']], viewer.floorMode, (v) => { viewer.setFloor(v); platform.store.set('floor', v); renderTab(); }));
  if (viewer.floorMode === 'disc') body.append(h('div', { class: 'row' }, h('label', {}, 'Platform color'), h('input', { type: 'color', value: viewer.floorColor, oninput: (e) => viewer.setFloor('disc', e.target.value) })));
  body.append(h('h3', {}, 'Camera'));
  body.append(h('div', { class: 'grid3' }, [['front', 'Front'], ['threeq', '3/4'], ['left', 'Side'], ['back', 'Back'], ['top', 'Top'], ['low', 'Low angle'], ['face', 'Face']].map(([k, l]) =>
    h('button', { class: 'btn', onclick: () => viewer.viewPreset(k, true) }, l))));
  body.append(slider('Field of view', { min: 10, max: 75, step: 1, value: look.fov, onInput: (v) => { look.fov = v; applyLook(); }, fmt: (v) => `${Math.round(v)}°` }));
  body.append(toggle('Auto-rotate', viewer.controls.autoRotate, (v) => { viewer.controls.autoRotate = v; }));
  body.append(slider('Rotation speed', { min: -10, max: 10, step: 0.5, value: viewer.controls.autoRotateSpeed, onInput: (v) => (viewer.controls.autoRotateSpeed = v), fmt: (v) => (+v).toFixed(1) }));
  body.append(h('h3', {}, 'Screenshot'));
  body.append(h('button', { class: 'btn wide', style: { marginBottom: '6px' }, onclick: () => enterPhoto() }, icon('camera'), 'Photo mode (framing, timer, backgrounds)'));
  body.append(h('div', { class: 'grid3' },
    h('button', { class: 'btn', onclick: () => shot({}) }, '📷 Normal'),
    h('button', { class: 'btn', onclick: () => shot({ scale: 2 }) }, '📷 High (2×)'),
    h('button', { class: 'btn', onclick: () => shot({ transparent: true, scale: 2 }) }, '📷 Transparent')));
}
function shot(opts) {
  pose.markers.visible && (pose.markers.visible = false);
  const helperVis = pose.gizmoHelper.visible; pose.gizmoHelper.visible = false;
  const url = viewer.screenshot(opts);
  pose.gizmoHelper.visible = helperVis; pose.markers.visible = pose.active;
  platform.saveFile(`${(S.modelName || 'screenshot').replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.png`, url, 'image/png');
}
$('#btnResetView').onclick = () => viewer.viewPreset('front', true);
$('#btnHideUi').onclick = () => { const on = document.body.classList.toggle('ui-hidden'); setIcon($('#btnHideUi'), on ? 'eyeOff' : 'eye'); };
$('#btnPhoto').onclick = () => enterPhoto();
$('#titlePill').onclick = () => openLibrary();

// ---- Look
function renderLookTab(body) {
  body.append(h('h3', {}, 'Interface'));
  body.append(toggle('Reduce transparency (faster on older phones)', !!look.solid, (v) => { look.solid = v; applyLook(); }));
  body.append(h('h3', {}, 'Outline'));
  body.append(toggle('Show outline', look.outlineOn, (v) => { look.outlineOn = v; applyLook(); }));
  body.append(slider('Outline width', { min: 0, max: 4, value: look.outline, onInput: (v) => { look.outline = v; applyLook(); } }));
  body.append(h('h3', {}, 'Shading'));
  body.append(slider('Shadow softness', { min: 0.1, max: 5, value: look.soft, onInput: (v) => { look.soft = v; applyLook(); } }));
  body.append(slider('Rim light', { min: 0, max: 3, value: look.rim, onInput: (v) => { look.rim = v; applyLook(); } }));
  body.append(slider('Specular highlights', { min: 0, max: 3, value: look.spec, onInput: (v) => { look.spec = v; applyLook(); } }));
  body.append(toggle('Cast shadows on the character', look.selfShadow, (v) => { look.selfShadow = v; applyLook(); }));
  body.append(h('h3', {}, 'Color'));
  body.append(slider('Exposure', { min: 0.3, max: 2, value: look.exposure, onInput: (v) => { look.exposure = v; applyLook(); } }));
  body.append(slider('Saturation', { min: 0, max: 2, value: look.sat, onInput: (v) => { look.sat = v; applyLook(); } }));
  body.append(h('h3', {}, 'Performance'));
  body.append(slider('Render scale', { min: 0.5, max: 3, step: 0.25, value: look.renderScale, onInput: (v) => { look.renderScale = v; viewer.setRenderScale(v); applyLook(); }, fmt: (v) => `${(+v).toFixed(2)}×` }));
  body.append(h('div', { class: 'row' }, h('label', {}, 'Texture quality'), h('select', { class: 'full', style: { flex: '1' }, onchange: (e) => { look.texSize = +e.target.value; applyLook(); toast('Applies next time you open the model'); } },
    [[512, 'Low (512)'], [1024, 'Medium (1024)'], [2048, 'High (2048)'], [4096, 'Maximum']].map(([v, l]) => h('option', { value: String(v), selected: v === look.texSize }, l)))));
  body.append(resetBtn('Reset look', () => { const keep = { renderScale: look.renderScale, texSize: look.texSize, solid: look.solid }; Object.assign(look, LOOK_DEFAULTS, keep); applyLook(); renderTab(); }));
}

// ---------------------------------------------------------------- library (portrait cards)
// Per-model extras kept on the device: { [modelId]: { charId, icon (data: URL), element } }
const libInfo = platform.store.get('libInfo', {});
const saveLibInfo = () => platform.store.set('libInfo', libInfo);
const EL_COLORS = { Glacio: '#5aa9e6', Fusion: '#e5603f', Electro: '#9b6ad8', Aero: '#3fc59a', Spectro: '#d9b545', Havoc: '#b2457d' };
const mb = (b) => b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(0, Math.round((b ?? 0) / 1048576))} MB`;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
// The roster entry a library model belongs to (downloads are named "Name" or "Name · Variant"; imports after the zip)
function rosterMatch(m) {
  const info = libInfo[m.id];
  if (info?.charId && roster) return roster.find((r) => r.id === info.charId) ?? null;
  if (!roster) return null;
  const n = norm(m.name);
  return roster.filter((r) => norm(r.name) && n.startsWith(norm(r.name))).sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}
// Keep a small copy of the portrait so the library looks right offline.
async function portraitData(url) {
  try {
    const r = await fetch(url); if (!r.ok) throw new Error();
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas'); c.width = c.height = 160;
    c.getContext('2d').drawImage(bmp, 0, 0, 160, 160);
    return c.toDataURL('image/png');
  } catch { return url; }
}
async function rememberCharacter(modelId, r) {
  if (!r) return;
  libInfo[modelId] = { charId: r.id, element: r.element, icon: await portraitData(r.icon) };
  saveLibInfo();
}
function setAvatar(el, id, name) {
  const icon = libInfo[id]?.icon;
  el.style.backgroundImage = icon ? `url("${icon}")` : '';
  el.textContent = icon ? '' : (name || '?').trim().charAt(0).toUpperCase();
}
function portrait(m, cls = '') {
  const info = libInfo[m.id];
  return info?.icon ? h('img', { src: info.icon, alt: '', class: cls, loading: 'lazy' }) : h('div', { class: 'initial ' + cls }, (m.name || '?').trim().charAt(0).toUpperCase());
}
function popMenu(anchor, items) {
  const r = anchor.getBoundingClientRect();
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  const menu = h('div', { class: 'popmenu glass' }, items.map(([ic, label, fn, cls]) => h('button', { class: cls ?? '', onclick: () => { close(); fn(); } }, icon(ic), label)));
  const close = () => { scrim.remove(); menu.remove(); popMenu.close = null; };
  document.body.append(scrim, menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw))}px`;
  menu.style.top = `${r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
  popMenu.close = close;
}
let libModels = [];
async function openLibrary() {
  $('#library').hidden = false;
  libModels = await platform.listModels();
  renderLibrary();
  updateStorageSummary();
  // older downloads/imports have no portrait yet: look them up once the character list is reachable
  if (libModels.some((m) => !libInfo[m.id]) && !roster) {
    try { roster = await fetchRoster(); } catch { return; }
    let changed = false;
    for (const m of libModels) if (!libInfo[m.id]) { const r = rosterMatch(m); if (r) { await rememberCharacter(m.id, r); changed = true; } }
    if (changed && !$('#library').hidden) renderLibrary();
    if (changed && S.modelId) setAvatar($('#titleAvatar'), S.modelId, S.modelName);
  }
}
function renderLibrary() {
  const grid = $('#modelGrid');
  grid.replaceChildren();
  if (!libModels.length) {
    grid.append(h('div', { class: 'empty-card glass' }, h('b', {}, 'No characters yet'), h('p', { class: 'hint' }, platform.canDownload ? 'Tap “Download characters” and pick one.' : 'Import a .zip from encore.moe’s 3D viewer (“Download .zip”).')));
    return;
  }
  for (const m of libModels) {
    const info = libInfo[m.id];
    const card = h('div', { class: 'mcard' + (m.id === S.modelId ? ' current' : ''), style: { '--el': EL_COLORS[info?.element] ?? '#5d6890' }, onclick: () => openModel(m.id, m.name) },
      h('div', { class: 'bgglow' }),
      portrait(m),
      h('div', { class: 'info glass' }, h('b', {}, m.name), h('span', { class: 'sub' }, `${info?.element ? info.element + ' · ' : ''}${mb(m.size)}`)));
    if (platform.canManage) {
      const more = h('button', { class: 'icon glass menu', title: 'More', onclick: (e) => {
        e.stopPropagation();
        popMenu(more, [
          ['edit', 'Rename', async () => { const n = prompt('New name', m.name); if (n) { await platform.renameModel(m.id, n); if (m.id === S.modelId) { S.modelName = n; $('#title').textContent = n; } openLibrary(); } }],
          ['storage', 'Storage', () => openStorage()],
          ['trash', 'Delete', () => deleteModelAsk(m), 'danger'],
        ]);
      } }, icon('more'));
      card.append(more);
    }
    grid.append(card);
  }
}
async function deleteModelAsk(m) {
  if (!confirm(`Delete ${m.name}? This frees ${mb(m.size)}.`)) return false;
  await platform.deleteModel(m.id);
  platform.store.set('model.' + m.id, null);
  delete libInfo[m.id]; saveLibInfo();
  if (m.id === S.modelId) { disposeModel(); S.modelId = null; S.modelName = ''; $('#title').textContent = '3D Viewer'; setAvatar($('#titleAvatar'), null, ''); }
  await openLibrary();
  return true;
}
async function updateStorageSummary() {
  const total = libModels.reduce((n, m) => n + (m.size ?? 0), 0);
  const info = await platform.storageInfo();
  $('#storageSummary').textContent = `${libModels.length} character${libModels.length === 1 ? '' : 's'} · ${mb(total)} used${info.free != null ? ` · ${mb(info.free)} free` : ''}`;
}
function closeLibrary() { $('#library').hidden = true; }
$('#btnLibrary').onclick = openLibrary;
$('#btnCloseLibrary').onclick = closeLibrary;
$('#btnImport').onclick = () => platform.importZip();
$('#btnStore').onclick = () => openStore();
$('#btnStorage').onclick = () => openStorage();

// ---------------------------------------------------------------- storage view
async function openStorage() {
  $('#store').hidden = false;
  storeView = 'storage';
  $('#storeTitle').textContent = 'Storage';
  const body = $('#storeBody');
  const models = await platform.listModels();
  const info = await platform.storageInfo();
  const used = models.reduce((n, m) => n + (m.size ?? 0), 0);
  const cap = info.free != null ? used + info.free : null;
  body.replaceChildren(
    h('div', { class: 'store-total glass' },
      h('div', { class: 'sub' }, 'Characters on this device'),
      h('div', { class: 'big' }, mb(used)),
      cap ? h('div', { class: 'meter', style: { margin: '10px 0 6px' } }, h('div', { style: { width: `${Math.max(2, Math.min(100, used * 100 / cap))}%` } })) : null,
      h('div', { class: 'sub' }, info.free != null ? `${mb(info.free)} free for the app` : '')),
    h('p', { class: 'hint' }, 'Combat animations (attacks, skills, movement) are usually the biggest part of a character. Deleting them keeps menu poses, idles and gestures.'));
  if (!models.length) body.append(h('p', { class: 'hint' }, 'No characters stored yet.'));
  const CATS = [['fight', 'Combat animations', '#ff8a92'], ['anim', 'Other animations', '#ffd08a'], ['tex', 'Textures', '#8fe3d8'], ['mesh', 'Models', '#9bb0ff'], ['other', 'Other', '#9aa2b8']];
  for (const m of models) {
    const row = h('div', { class: 'store-row glass' },
      h('div', { class: 'top' }, portrait(m), h('div', { class: 'grow' }, h('b', {}, m.name), h('div', { class: 'sub' }, `${mb(m.size)} · ${m.files ?? '?'} files`))),
      h('p', { class: 'hint' }, 'Calculating…'));
    body.append(row);
    platform.fileSizes(m.id).then((sizes) => {
      const by = Object.fromEntries(CATS.map(([k]) => [k, { n: 0, paths: [] }]));
      for (const [p, n] of Object.entries(sizes)) {
        const k = isFightAnim(p) ? 'fight' : /\.ueanim$/i.test(p) ? 'anim' : /\.png$/i.test(p) ? 'tex' : /\.uemodel$/i.test(p) ? 'mesh' : 'other';
        by[k].n += n; by[k].paths.push(p);
      }
      const tot = Object.values(by).reduce((a, b) => a + b.n, 0) || 1;
      row.lastChild.replaceWith(
        h('div', { class: 'split' }, CATS.map(([k, , c]) => h('i', { style: { width: `${by[k].n * 100 / tot}%`, background: c } }))),
        h('div', { class: 'legend' }, CATS.filter(([k]) => by[k].n > 0).map(([k, l, c]) => h('span', { style: { '--c': c } }, `${l} ${mb(by[k].n)}`))),
        h('div', { class: 'acts' },
          by.fight.paths.length ? h('button', { class: 'btn', onclick: async (e) => {
            if (!confirm(`Delete ${by.fight.paths.length} combat animations of ${m.name}? This frees ${mb(by.fight.n)}. Menu poses and idles stay.`)) return;
            e.currentTarget.disabled = true; e.currentTarget.textContent = 'Deleting…';
            await platform.deleteFiles(m.id, by.fight.paths);
            toast(`Freed ${mb(by.fight.n)}`);
            if (m.id === S.modelId) await openModel(m.id, m.name).then(() => { $('#store').hidden = false; });
            openStorage();
          } }, icon('trash'), `Combat animations (${mb(by.fight.n)})`) : h('span', { class: 'hint' }, 'No combat animations stored'),
          h('button', { class: 'btn danger', onclick: async () => { if (await deleteModelAsk(m)) openStorage(); } }, icon('trash'), 'Delete')));
    }).catch((e) => { row.lastChild.textContent = 'Could not read sizes: ' + e.message; });
  }
}

// ---------------------------------------------------------------- encore.moe downloads
let roster = null, storeView = 'list', storeFilter = '', storeEl = '', downloading = false;
async function openStore() {
  $('#store').hidden = false;
  storeView = 'list';
  if (platform.needsRelay()) renderRelaySetup(); else renderStoreList();
}
function closeStore() { if (!downloading) $('#store').hidden = true; }
$('#btnStoreClose').onclick = closeStore;
$('#btnStoreBack').onclick = () => { if (downloading) return; if (storeView === 'detail') { storeView = 'list'; renderStoreList(); } else closeStore(); };
// Browser / iPhone only: encore.moe's file storage needs the download relay (see worker/README.md)
function renderRelaySetup(err) {
  storeView = 'setup';
  $('#storeTitle').textContent = 'Download setup';
  const input = h('input', { type: 'url', placeholder: 'https://wuwa-download-relay.<name>.workers.dev', value: platform.relayUrl(), autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const msg = h('p', { class: 'hint' }, err ?? '');
  $('#storeBody').replaceChildren(
    h('p', { class: 'hint' }, 'encore.moe only lets its own website download model files, so this version of the app downloads them through a small relay. Paste the relay address once and downloads work from then on.'),
    input,
    h('button', { class: 'primary', style: { marginTop: '10px' }, onclick: async () => {
      const url = input.value.trim().replace(/\/+$/, '');
      if (!/^https:\/\/\S+$/.test(url)) { msg.textContent = 'Enter an address starting with https://'; return; }
      msg.textContent = 'Checking…';
      try {
        const r = await fetch(url + '/');
        if (!r.ok || !/relay/i.test(await r.text())) throw new Error(`HTTP ${r.status}`);
      } catch (e) { msg.textContent = 'That address did not answer like a relay (' + e.message + ').'; return; }
      platform.setRelay(url);
      renderStoreList();
    } }, 'Save'),
    msg);
}
async function renderStoreList() {
  storeView = 'list';
  const body = $('#storeBody');
  $('#storeTitle').textContent = 'Characters';
  if (!roster) {
    body.replaceChildren(h('p', { class: 'hint' }, 'Loading the character list…'));
    try { roster = await fetchRoster(); } catch (e) { body.replaceChildren(h('p', { class: 'hint' }, 'Could not reach encore.moe: ' + e.message), h('button', { class: 'btn', onclick: () => renderStoreList() }, 'Retry')); return; }
  }
  libModels = await platform.listModels();
  const have = new Set(libModels.map((m) => rosterMatch(m)?.id).filter((x) => x != null));
  const grid = h('div', { class: 'roster' });
  const fill = () => {
    const f = storeFilter.trim().toLowerCase();
    grid.replaceChildren(...roster.filter((r) => (!f || r.name.toLowerCase().includes(f)) && (!storeEl || (storeEl === 'have' ? have.has(r.id) : r.element === storeEl))).map((r) =>
      h('button', { class: 'q' + r.quality, onclick: () => renderStoreDetail(r) },
        have.has(r.id) ? h('span', { class: 'badge', title: 'Downloaded' }, icon('check')) : null,
        h('img', { src: r.icon, loading: 'lazy', alt: '' }), h('span', {}, r.name), h('span', { class: 'el' }, `${r.element}${r.weapon ? ' · ' + r.weapon : ''}`))));
  };
  const search = h('input', { type: 'search', placeholder: 'Search by name…', value: storeFilter, oninput: (e) => { storeFilter = e.target.value; fill(); } });
  const els = [...new Set(roster.map((r) => r.element).filter(Boolean))];
  const filters = h('div', { class: 'chips', style: { flexWrap: 'nowrap', overflowX: 'auto' } });
  const drawFilters = () => filters.replaceChildren(...[['', 'All'], ['have', `Downloaded (${have.size})`], ...els.map((e) => [e, e])].map(([v, l]) =>
    h('button', { class: 'chip small', style: { flex: 'none' }, 'aria-pressed': String(storeEl === v), onclick: () => { storeEl = v; drawFilters(); fill(); } }, l)));
  drawFilters(); fill();
  body.replaceChildren(search, filters, grid);
}
async function renderStoreDetail(r) {
  storeView = 'detail';
  const body = $('#storeBody');
  $('#storeTitle').textContent = r.name;
  body.replaceChildren(h('p', { class: 'hint' }, 'Loading character data…'));
  let ch;
  try { ch = await fetchCharacter(r.id); } catch (e) { body.replaceChildren(h('p', { class: 'hint' }, 'Error: ' + e.message)); return; }
  if (!ch.variants.length) { body.replaceChildren(h('p', { class: 'hint' }, 'This character has no 3D model on encore.moe yet.')); return; }
  const weapons = ch.equips.filter((e) => e.kind === 'weapon');
  const props = ch.equips.filter((e) => e.kind === 'prop');
  const owned = libModels.filter((m) => rosterMatch(m)?.id === r.id);
  // same default as encore.moe's viewer: the character's signature weapon
  let variant = 0, weapon = weapons.some((w) => w.id === ch.initWeapon) ? ch.initWeapon : null;
  const draw = () => {
    const v = ch.variants[variant];
    body.replaceChildren(
      h('div', { class: 'detail-head' }, h('img', { src: r.icon, alt: '' }), h('div', {}, h('h2', {}, ch.name), h('div', { class: 'hint' }, `${r.element} · ${r.weapon}`),
        owned.length ? h('span', { class: 'tagline' }, icon('check'), `Downloaded: ${owned.map((m) => m.name).join(', ')}`) : null)),
      owned.length ? h('button', { class: 'btn wide', style: { marginBottom: '8px' }, onclick: () => { $('#store').hidden = true; openModel(owned[0].id, owned[0].name); } }, 'Open ' + owned[0].name) : null,
      h('button', { class: 'primary', onclick: () => startDownload(ch, variant, weapon, r) }, icon('download'), owned.length ? 'Download again' : 'Download'),
      h('h3', {}, 'Model'),
      chips(ch.variants.map((x, i) => [i, `${x.name}${x.kind === 'morph' ? ' (form)' : ''}`]), variant, (i) => { variant = i; draw(); }),
      h('p', { class: 'hint' }, `${v.anims.length} animations${v.parts.length ? ` · ${v.parts.length} extra part(s)` : ''} · ${props.length} animation prop(s)`),
      h('h3', {}, 'Weapon'),
      h('select', { class: 'full', onchange: (e) => { weapon = e.target.value === '' ? null : +e.target.value; } },
        h('option', { value: '' }, 'No weapon'), weapons.map((w) => h('option', { value: String(w.id), selected: w.id === weapon }, `${w.name}${w.anims.length ? ` (${w.anims.length} anim.)` : ''}`))),
      h('p', { class: 'hint' }, 'A character is usually 100–300 MB. Use Wi‑Fi if you can. Once downloaded it works offline. You can delete its combat animations later in Library › Storage.'),
    );
  };
  draw();
}
async function startDownload(ch, variant, weapon, r) {
  downloading = true;
  const body = $('#storeBody');
  const bar = h('div', { class: 'bar' }, h('div'));
  const label = h('span', {}, 'Preparing…');
  body.replaceChildren(h('h3', {}, 'Downloading ' + ch.name), h('div', { id: 'importProgress' }, bar, label), h('p', { class: 'hint' }, 'Keep the app open until it finishes.'));
  let wake = null;
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  try {
    const res = await downloadCharacter(ch, variant, weapon, (pct, msg) => { bar.firstChild.style.width = pct + '%'; label.textContent = `${pct}% · ${msg}`; });
    await rememberCharacter(res.id, r);
    downloading = false;
    $('#store').hidden = true;
    toast(`${res.name} downloaded`);
    openModel(res.id, res.name);
  } catch (e) {
    downloading = false;
    body.replaceChildren(h('p', { class: 'hint' }, 'The download failed: ' + e.message), h('button', { class: 'btn', onclick: () => renderStoreDetail(r) }, 'Back'));
  } finally { wake?.release?.().catch(() => {}); }
}
platform.onImportProgress((pct, msg) => {
  const p = $('#importProgress'); p.hidden = false;
  p.querySelector('.bar div').style.width = `${pct}%`; p.querySelector('span').textContent = msg ?? `${pct}%`;
});
platform.onImportDone((r) => {
  $('#importProgress').hidden = true;
  if (r.error) { toast('Could not import: ' + r.error, 6000); return; }
  toast(`Imported: ${r.name}`);
  openLibrary();
});
platform.onFileSaved((msg) => toast(msg));

// ---------------------------------------------------------------- photo mode
const photo = { on: false, ratio: platform.store.get('photoRatio', '9:16'), timer: platform.store.get('photoTimer', 0) };
const RATIOS = [['full', 'Full'], ['9:16', '9:16'], ['4:5', '4:5'], ['1:1', '1:1']];
const PHOTO_BGS = [
  ...Object.keys(SCENES).map((n) => ({ name: n, bg: { type: 'scene', scene: n }, thumb: () => `url(${sceneThumb(n)})` })),
  ...BG_PRESETS.filter((p) => ['Studio', 'Menu', 'Black', 'White', 'Green screen'].includes(p.name)).map((p) => ({ name: p.name, bg: p, thumb: () => p.type === 'gradient' ? `linear-gradient(${p.top},${p.bottom})` : p.color })),
  { name: 'Transparent', bg: { type: 'transparent' }, thumb: () => 'repeating-conic-gradient(#888 0% 25%, #ddd 0% 50%) 0 0 / 12px 12px' },
];
const ratioValue = () => (photo.ratio === 'full' ? null : (([a, b]) => a / b)(photo.ratio.split(':').map(Number)));
function layoutFrame() {
  const a = ratioValue(), W = innerWidth, H = innerHeight;
  $('#frameMask').classList.toggle('full', !a);
  const hole = $('#frameHole');
  if (!a) { hole.style.width = W + 'px'; hole.style.height = H + 'px'; return; }
  const w = W / H > a ? H * a : W, hh = W / H > a ? H : W / a;
  hole.style.width = `${w}px`; hole.style.height = `${hh}px`;
}
function drawPhotoControls() {
  $('#ratioSeg').replaceChildren(...RATIOS.map(([v, l]) => h('button', { class: photo.ratio === v ? 'on' : '', onclick: () => { photo.ratio = v; platform.store.set('photoRatio', v); layoutFrame(); drawPhotoControls(); } }, l)));
  $('#timerLabel').textContent = photo.timer ? `${photo.timer}s` : '';
  $('#btnTimer').classList.toggle('on', !!photo.timer);
  const cur = viewer.bg;
  $('#bgStrip').replaceChildren(...PHOTO_BGS.map((b) => {
    const on = b.bg.type === cur.type && (b.bg.type === 'scene' ? b.bg.scene === cur.scene : b.bg.type === 'transparent' || (b.bg.type === 'color' ? b.bg.color === cur.color : b.bg.top === cur.top && b.bg.bottom === cur.bottom));
    return h('button', { class: on ? 'on' : '', onclick: () => { viewer.setBackground({ ...b.bg }); platform.store.set('bg', { ...viewer.bg, image: null }); drawPhotoControls(); } }, h('i', { style: { background: b.thumb() } }), b.name);
  }));
}
function enterPhoto() {
  if (photo.on) return;
  photo.on = true;
  photo.markers = pose.markers.visible; pose.markers.visible = false;
  photo.gizmo = pose.gizmoHelper.visible; pose.gizmoHelper.visible = false;
  setCutMode(false);
  S.tab = null; renderTab();
  document.body.classList.add('photo'); document.body.classList.remove('photo-bare', 'ui-hidden');
  $('#photo').hidden = false;
  updateInset();
  layoutFrame(); drawPhotoControls();
}
function exitPhoto() {
  if (!photo.on) return;
  photo.on = false;
  pose.markers.visible = photo.markers && pose.active; pose.gizmoHelper.visible = photo.gizmo && pose.active;
  document.body.classList.remove('photo', 'photo-bare');
  $('#photo').hidden = true;
  updateInset();
}
async function takePhoto() {
  if (photo.busy) return;
  photo.busy = true;
  if (photo.timer) {
    document.body.classList.add('photo-bare');
    const cd = $('#countdown'); cd.hidden = false;
    for (let n = photo.timer; n > 0; n--) { cd.textContent = n; await new Promise((r) => setTimeout(r, 1000)); }
    cd.hidden = true;
  }
  const url = viewer.screenshot({ scale: 2, aspect: ratioValue(), transparent: viewer.bg.type === 'transparent' });
  const f = $('#flash'); f.hidden = false; f.style.animation = 'none'; void f.offsetWidth; f.style.animation = ''; setTimeout(() => (f.hidden = true), 380);
  if (photo.timer) document.body.classList.remove('photo-bare');
  platform.saveFile(`${(S.modelName || 'photo').replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.png`, url, 'image/png');
  photo.busy = false;
}
$('#btnShutter').onclick = takePhoto;
$('#btnPhotoExit').onclick = exitPhoto;
$('#btnTimer').onclick = () => { photo.timer = photo.timer === 0 ? 3 : photo.timer === 3 ? 10 : 0; platform.store.set('photoTimer', photo.timer); drawPhotoControls(); };
$('#btnPhotoHide').onclick = () => { document.body.classList.add('photo-bare'); gestureHint('Tap the screen to show the controls'); };
$('#btnPhotoFace').onclick = () => { if (S.rig) gestureHint(viewer.toggleFaceFrame() === 'face' ? 'Face' : 'Full body'); };
addEventListener('resize', () => { if (photo.on) layoutFrame(); });

// start
if (!platform.canDownload) $('#btnStore').hidden = true;
if (platform.isIOS && !platform.isStandalone) {
  $('.lib-actions').after(h('p', { class: 'hint install' }, '📲 To install: tap ', h('b', {}, 'Share'), ' (the square with the arrow), then ', h('b', {}, 'Add to Home Screen'), '. Always open the app from that icon so your models are kept.'));
}
(async () => {
  const list = await platform.listModels();
  const last = platform.store.get('lastModel', null);
  const m = list.find((x) => x.id === last) ?? (list.length === 1 ? list[0] : null);
  if (m) openModel(m.id, m.name); else openLibrary();
})();
document.addEventListener('visibilitychange', () => { if (S.modelId) platform.store.set('lastModel', S.modelId); });
initMusic();
window.__dbg = { S, viewer, pose, springs, THREE, playAnim, renderTab, setCutMode, enterPhoto, exitPhoto, openStorage, openLibrary };
// Android back button: close the open layer first
window.__wuwaBack = () => {
  if (popMenu.close) { popMenu.close(); return true; }
  if (!$('#store').hidden) { $('#btnStoreBack').click(); return true; }
  if (!$('#library').hidden && S.rig) { closeLibrary(); return true; }
  if (photo.on) { if (document.body.classList.contains('photo-bare')) document.body.classList.remove('photo-bare'); else exitPhoto(); return true; }
  if (S.cutMode) { setCutMode(false); renderTab(); return true; }
  if (S.tab) { S.tab = null; renderTab(); return true; }
  if (document.body.classList.contains('ui-hidden')) { $('#btnHideUi').click(); return true; }
  return false;
};

// iPhone home-screen app: size the layout to the real screen
if (platform.isIOS && platform.isStandalone) {
  const fit = () => {
    const land = matchMedia('(orientation: landscape)').matches;
    const H = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    document.documentElement.classList.add('ios-full');
    document.documentElement.style.setProperty('--app-h', H + 'px');
    viewer.resize();
  };
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 300));
}
// iPhone: no page zoom from pinch (the canvas handles its own gestures)
if (platform.isIOS) {
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
// offline app shell for the browser / iPhone version
if (!platform.isAndroid && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller; // first install is silent
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'activated' && hadController) toast('New version installed: it will be used next time you open the app', 5000); });
    });
  }).catch((e) => console.warn('Service worker', e));
}
