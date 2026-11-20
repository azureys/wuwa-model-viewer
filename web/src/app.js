// Main application: model library, viewer state and all the panels.
import * as THREE from 'three';
import { Viewer, LIGHT_PRESETS, LIGHT_TYPES, BG_PRESETS, newLight } from './viewer.js';
import { PackageSource } from './source.js';
import { Rig, textureSettings, clearTextureCache, computeIslands, setIslandHidden } from './character.js';
import { loadAnim, buildClip, sampleCurve, describeAnims, ribbonFor, ribbonTrackFilter, removeTracksFor } from './animation.js';
import { toonGlobals } from './toon.js';
import { PoseTool, SpringBones, BODY_PARTS, FINGER_PARTS } from './pose.js';
import * as platform from './platform.js';

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

// keep the playback bar just above the bottom sheet
new ResizeObserver(() => {
  const sh = $('#sheet');
  const land = matchMedia('(orientation: landscape) and (min-width: 700px)').matches;
  const hpx = sh.hidden || land ? 0 : sh.offsetHeight;
  document.body.style.setProperty('--sheet-h', `${hpx}px`);
  const cv = $('#view');
  const want = hpx ? `calc(100% - ${hpx}px - 56px)` : '100%';
  if (cv.style.height !== want) { cv.style.height = want; viewer.resize(); }
}).observe($('#sheet'));

// ---------------------------------------------------------------- state
const viewer = new Viewer($('#view'));
const S = {
  modelId: null, modelName: '', pkg: null, cat: null,
  rig: null, mixer: null, extras: [],   // extras: weapon / prop rigs { kind, entry, rig, mixer, bone, mode, anims }
  animPath: null, clip: null, ribbonPath: null, time: 0, duration: 0, playing: true, loop: true, speed: 1,
  inPlace: false, animFace: true, autoRibbon: true, mode: 'menu', animFilter: '',
  morphValues: new Map(), morphFilter: '', curves: [],
  tab: null, cutMode: false, bindPose: false,
};
const pose = new PoseTool(viewer, (why) => { if (why === 'select' && S.tab === 'pose') renderTab(); });
const springs = new SpringBones();
viewer.headPosition = () => S.rig?.findBone('Bip001Head')?.getWorldPosition(new THREE.Vector3()) ?? null;

// lights / background / look restored from the last session
viewer.setLights(platform.store.get('lights', null)?.map((l) => newLight(l.type, l)) ?? LIGHT_PRESETS['Estudio']());
viewer.setBackground(platform.store.get('bg', BG_PRESETS[0]));
viewer.setFloor(platform.store.get('floor', 'shadow'));
const look = Object.assign({ outline: 1, outlineOn: true, rim: 0.6, soft: 1, selfShadow: false, spec: 1, sat: 1, exposure: 1, renderScale: Math.min(devicePixelRatio, platform.isAndroid ? 1.75 : 2), texSize: platform.isAndroid ? 1024 : 2048, fov: 30 }, platform.store.get('look', {}));
function applyLook() {
  toonGlobals.uOutlineScale.value = look.outline; toonGlobals.uOutlineOn.value = look.outlineOn ? 1 : 0;
  toonGlobals.uRimStrength.value = look.rim; toonGlobals.uShadowSoft.value = look.soft;
  toonGlobals.uSelfShadow.value = look.selfShadow ? 1 : 0; toonGlobals.uSpecStrength.value = look.spec;
  toonGlobals.uSaturation.value = look.sat; toonGlobals.uExposure.value = look.exposure;
  textureSettings.maxSize = look.texSize;
  viewer.setFov(look.fov);
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
  try {
    status('Leyendo paquete…');
    const pkg = await PackageSource.open(`${platform.MODELS_BASE}/${encodeURIComponent(id)}`);
    S.pkg = pkg; S.cat = pkg.catalog();
    if (!S.cat.main) throw new Error('El .zip no contiene ningún personaje (.uemodel)');
    const rig = new Rig(name);
    S.rig = rig;
    viewer.world.add(rig.group);
    await rig.addModel(pkg, S.cat.main.path, { onStatus: status, label: 'Personaje' });
    for (const p of S.cat.parts) await rig.addModel(pkg, p.path, { onStatus: status, label: p.name });
    S.mixer = new THREE.AnimationMixer(rig.space);
    pose.setRig(rig); springs.setRig(rig);
    // props sharing the body skeleton are skinned to it; others get their own rig
    for (const p of S.cat.props) S.extras.push({ kind: 'prop', entry: p, rig: null, mixer: null, bone: 'Root', mode: 'auto', loaded: false });
    for (const w of S.cat.weapons) S.extras.push({ kind: 'weapon', entry: w, rig: null, mixer: null, bone: 'WeaponProp01', scabBone: 'WeaponProp02', mode: 'off', loaded: false });
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
    toast(`${name} cargado`);
    renderTab();
  } catch (e) {
    console.error(e);
    status(null);
    toast('Error: ' + e.message, 6000);
  }
}

function disposeModel() {
  S.mixer?.stopAllAction();
  for (const x of S.extras) { x.mixer?.stopAllAction(); x.rig?.dispose(); }
  S.rig?.dispose();
  S.rig = null; S.mixer = null; S.extras = []; S.animPath = null; S.clip = null; S.curves = [];
  S.morphValues.clear(); pose.setRig(null); pose.setActive(false); springs.setRig(null);
  clearTextureCache();
  $('#player').hidden = true;
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
    status('Cargando animación…');
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
    S.time = 0;
    springs.reset();
    await syncExtras();
    S.playing = true;
    pose.setActive(false);
    $('#player').hidden = false;
    updatePlayer();
    status(null);
    if (S.tab === 'anim') renderTab();
  } catch (e) { status(null); toast('No se pudo cargar la animación: ' + e.message, 5000); }
}

// weapons/props follow the current body animation when they have one with the same name
async function syncExtras() {
  const base = S.animPath?.split('/').pop().toLowerCase();
  for (const x of S.extras) {
    const match = base ? x.entry.anims.find((a) => a.split('/').pop().toLowerCase() === base) : null;
    x.activeAnim = match ?? null;
    const want = x.mode === 'on' || (x.mode === 'auto' && match);
    if (want && !x.loaded) await loadExtra(x);
    if (x.rig) {
      x.rig.group.visible = !!want;
      x.mixer.stopAllAction();
      if (match && want) {
        const clip = buildClip(x.rig, await loadAnim(S.pkg, match));
        x.mixer.clipAction(clip).play();
      } else x.rig.resetToBind();
    }
  }
}

async function loadExtra(x) {
  status(`Cargando ${x.entry.name}…`);
  const rig = new Rig(x.entry.name);
  // attached rigs live in the parent bone's space: no unit conversion
  rig.space.rotation.set(0, 0, 0); rig.space.scale.setScalar(1);
  await rig.addModel(S.pkg, x.entry.path, { label: x.entry.name });
  if (x.entry.scabbard) {
    const sc = new Rig(x.entry.scabbard.name);
    sc.space.rotation.set(0, 0, 0); sc.space.scale.setScalar(1);
    await sc.addModel(S.pkg, x.entry.scabbard.path, { label: 'Vaina' });
    x.scabbard = sc;
  }
  x.rig = rig;
  x.mixer = new THREE.AnimationMixer(rig.space);
  x.loaded = true;
  attachExtra(x);
  status(null);
}
function attachExtra(x) {
  if (!x.rig || !S.rig) return;
  const parent = S.rig.findBone(x.bone) ?? S.rig.sockets.get(x.bone) ?? S.rig.bones[0];
  parent.add(x.rig.group);
  x.rig.finalizeSkeleton();
  if (x.scabbard) {
    const p2 = S.rig.findBone(x.scabBone) ?? parent;
    p2.add(x.scabbard.group);
    x.scabbard.group.visible = x.rig.group.visible && x.showScabbard !== false;
    x.scabbard.finalizeSkeleton();
  }
}

function setTime(t) {
  S.time = t;
  S.mixer?.setTime(t);
  for (const x of S.extras) if (x.rig?.group.visible) x.mixer.setTime(t);
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

function updatePlayer() {
  const fps = S.clip?.userData.fps ?? 30;
  $('#btnPlay').textContent = S.playing && !pose.active ? '⏸' : '▶';
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

// ---------------------------------------------------------------- picking (tap on the model)
const raycaster = new THREE.Raycaster();
let down = null;
viewer.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
viewer.canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 8 || dt > 500) return;
  const r = viewer.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, viewer.camera);
  if (pose.active && pose.pick(raycaster)) return;
  if (S.cutMode) cutAt(raycaster);
});

function visibleMeshes() {
  const out = [];
  const rigs = [S.rig, ...S.extras.flatMap((x) => [x.rig, x.scabbard])].filter(Boolean);
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
    toast(`Pieza ocultada (${it.section.label}). Pulsa «Deshacer» para recuperarla.`);
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
  platform.store.set(prefsKey(), { sections, models: S.rig.models.map((m) => m.visible) });
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

// ---------------------------------------------------------------- tabs
const tabs = {
  anim: renderAnimTab, pose: renderPoseTab, parts: renderPartsTab, equip: renderEquipTab,
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
  sheet.classList.toggle('tall', ['anim', 'face', 'lights'].includes(S.tab));
  if (!S.rig && !['lights', 'scene', 'look'].includes(S.tab)) {
    body.append(h('p', { class: 'hint' }, 'Abre un modelo desde la biblioteca (☰) para empezar.'));
    return;
  }
  tabs[S.tab](body);
  body.scrollTop = scroll;
}

// ---- Animation
function renderAnimTab(body) {
  body.append(h('h3', {}, 'Animaciones'));
  body.append(chips([['menu', 'Menú y gestos'], ['fight', 'Combate'], ['all', 'Todas']], S.mode, (v) => { S.mode = v; renderTab(); }));
  const search = h('input', { type: 'search', placeholder: 'Buscar animación…', value: S.animFilter, oninput: (e) => { S.animFilter = e.target.value; fill(); } });
  body.append(search);
  const opts = h('div', { class: 'chips' },
    h('button', { class: 'chip', 'aria-pressed': String(S.inPlace), onclick: async () => { S.inPlace = !S.inPlace; if (S.animPath) await playAnim(S.animPath); renderTab(); } }, 'En el sitio'),
    h('button', { class: 'chip', 'aria-pressed': String(S.autoRibbon), onclick: async () => { S.autoRibbon = !S.autoRibbon; if (S.animPath) await playAnim(S.animPath); renderTab(); } }, 'Cintas automáticas'),
    h('button', { class: 'chip', 'aria-pressed': String(S.animFace), onclick: () => { S.animFace = !S.animFace; renderTab(); } }, 'Expresiones de la animación'),
    h('button', { class: 'chip', 'aria-pressed': String(S.bindPose), onclick: () => { S.bindPose = !S.bindPose; if (S.bindPose) { S.rig.resetToBind(); S.playing = false; } else setTime(S.time); updatePlayer(); renderTab(); } }, 'Pose base (T)'),
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
        }, it.label, ribbonFor(it.path, S.cat.charAnims) ? h('span', { class: 'tag' }, '+cintas') : null,
        S.extras.some((x) => x.entry.anims.some((a) => a.split('/').pop() === it.path.split('/').pop())) ? h('span', { class: 'tag' }, '+objeto') : null))));
      list.append(det);
    }
    if (!shown) list.append(h('p', { class: 'hint' }, 'No hay animaciones en este grupo.'));
  }
  fill();
}

// ---- Pose
function renderPoseTab(body) {
  body.append(h('h3', {}, 'Herramienta de pose'));
  body.append(toggle('Editar pose (congela la animación)', pose.active, (v) => {
    pose.setActive(v);
    if (v) { S.playing = false; updatePlayer(); toast('Toca una articulación (puntos) o elige un hueso abajo'); }
    renderTab();
  }));
  if (!pose.active) {
    body.append(h('p', { class: 'hint' }, 'Activa la edición para girar huesos con el gizmo, mover manos y pies con IK o guardar poses. Al pulsar ▶ vuelve la animación.'));
  } else {
    body.append(h('div', { class: 'grid3' },
      h('button', { class: 'btn' + (pose.mode === 'rotate' ? ' on' : ''), onclick: () => { pose.setMode('rotate'); renderTab(); } }, '↻ Rotar'),
      h('button', { class: 'btn' + (pose.mode === 'move' ? ' on' : ''), onclick: () => { pose.setMode('move'); renderTab(); } }, '✥ Mover / IK'),
      h('button', { class: 'btn', onclick: () => { pose.setSpace(pose.space === 'local' ? 'world' : 'local'); renderTab(); } }, pose.space === 'local' ? 'Ejes: local' : 'Ejes: mundo'),
    ));
    const sel = pose.selected;
    body.append(h('p', { class: 'hint' }, sel ? `Seleccionado: ${sel.part?.label ?? sel.bone.userData.name}${pose.mode === 'move' && !sel.ik && !sel.move ? ' — «Mover» funciona con manos, pies y centro' : ''}` : 'Nada seleccionado'));
    body.append(h('div', { class: 'grid3' },
      h('button', { class: 'btn', onclick: () => pose.popUndo() }, '↶ Deshacer'),
      h('button', { class: 'btn', onclick: () => pose.resetBone() }, 'Reiniciar hueso'),
      h('button', { class: 'btn', onclick: () => pose.mirror() }, 'Copiar al otro lado'),
    ));
    body.append(h('h3', {}, 'Cuerpo'));
    body.append(h('div', { class: 'chips' }, BODY_PARTS.filter((p) => S.rig.findBone(p.bone)).map((p) =>
      h('button', { class: 'chip small' + (sel?.bone === S.rig.findBone(p.bone) ? ' on' : ''), onclick: () => { pose.select(S.rig.findBone(p.bone), p); renderTab(); } }, p.label))));
    const fingers = h('details', {}, h('summary', {}, 'Dedos'), h('div', { class: 'inner chips' }, FINGER_PARTS.filter((p) => S.rig.findBone(p.bone)).map((p) =>
      h('button', { class: 'chip small', onclick: () => { pose.select(S.rig.findBone(p.bone), p); renderTab(); } }, p.label))));
    body.append(fingers);
    const rawSearch = h('input', { type: 'search', placeholder: 'Buscar hueso (pelo, falda, cintas…)' });
    const rawList = h('ul', { class: 'list' });
    const fillRaw = () => {
      const f = rawSearch.value.toLowerCase();
      rawList.replaceChildren(...S.rig.bones.filter((b) => !f || b.userData.name.toLowerCase().includes(f)).slice(0, 80).map((b) =>
        h('li', { class: sel?.bone === b ? 'sel' : '', onclick: () => { pose.select(b, null); renderTab(); } }, h('span', { class: 'grow' }, b.userData.name))));
    };
    rawSearch.oninput = fillRaw; fillRaw();
    body.append(h('details', {}, h('summary', {}, `Todos los huesos (${S.rig.bones.length})`), h('div', { class: 'inner' }, rawSearch, rawList)));
  }
  body.append(h('h3', {}, 'Poses'));
  body.append(h('div', { class: 'grid3' },
    h('button', { class: 'btn', onclick: () => {
      const data = JSON.stringify(pose.capture(), null, 1);
      platform.saveFile(`${S.modelName.replace(/[\\/:*?"<>|]/g, '_')}-pose.json`, data, 'application/json');
      toast('Pose exportada');
    } }, 'Exportar'),
    h('button', { class: 'btn', onclick: async () => {
      const f = await platform.pickFile('application/json,.json'); if (!f) return;
      try {
        const p = JSON.parse(await f.text());
        pose.setActive(true); S.playing = false;
        const unknown = pose.apply(p);
        toast(unknown.length ? `Pose aplicada (${unknown.length} huesos no existen en este modelo)` : (p.character && p.character !== S.modelName ? `Pose aplicada (creada para ${p.character})` : 'Pose aplicada'));
        renderTab();
      } catch (e) { toast('Archivo de pose no válido'); }
    } }, 'Importar'),
    h('button', { class: 'btn', onclick: () => { savedPoses(); } }, 'Guardadas'),
  ));
  body.append(h('h3', {}, 'Física'));
  body.append(toggle('Pelo, falda y cintas siguen el movimiento', springs.enabled, (v) => { springs.enabled = v; springs.reset(); }));
  body.append(slider('Rigidez', { min: 0.02, max: 0.6, value: springs.stiffness, onInput: (v) => (springs.stiffness = v) }));
  body.append(slider('Gravedad', { min: 0, max: 1.5, value: springs.gravity, onInput: (v) => (springs.gravity = v) }));
  body.append(slider('Amortiguación', { min: 0.02, max: 0.6, value: springs.damping, onInput: (v) => (springs.damping = v) }));
}
function savedPoses() {
  const key = 'poses.' + S.modelId;
  const list = platform.store.get(key, []);
  const body = $('#sheetBody');
  body.replaceChildren(h('h3', {}, 'Poses guardadas'),
    h('button', { class: 'primary', onclick: () => {
      const name = prompt('Nombre de la pose', `Pose ${list.length + 1}`); if (!name) return;
      list.push({ name, pose: pose.capture() }); platform.store.set(key, list); savedPoses();
    } }, 'Guardar la pose actual'),
    h('ul', { class: 'list' }, list.map((p, i) => h('li', {},
      h('span', { class: 'grow' }, p.name),
      h('button', { class: 'btn', onclick: () => { pose.setActive(true); S.playing = false; pose.apply(p.pose); updatePlayer(); toast('Pose aplicada'); } }, 'Aplicar'),
      h('button', { class: 'btn danger', onclick: () => { list.splice(i, 1); platform.store.set(key, list); savedPoses(); } }, '✕')))),
    h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => renderTab() }, '← Volver'));
}

// ---- Parts / clothing
function setCutMode(v) {
  S.cutMode = v;
  $('#pickHint').hidden = !v;
  $('#pickHint').textContent = 'Modo tijera: toca una pieza del modelo para ocultarla';
}
function renderPartsTab(body) {
  body.append(h('h3', {}, 'Piezas sueltas'));
  body.append(h('div', { class: 'grid3' },
    h('button', { class: 'btn' + (S.cutMode ? ' on' : ''), onclick: () => { setCutMode(!S.cutMode); renderTab(); } }, S.cutMode ? '✂ Tijera activa' : '✂ Modo tijera'),
    h('button', { class: 'btn', onclick: () => { const c = cutHistory.pop(); if (c) { setIslandHidden(c.section, c.island, false); saveModelPrefs(); renderTab(); } } }, '↶ Deshacer'),
    h('button', { class: 'btn', onclick: () => {
      for (const { model, section } of S.rig.allSections()) { for (const i of [...section.hidden]) setIslandHidden(section, i, false); S.rig.setSectionVisible(model, section, true); }
      S.rig.models.forEach((m) => S.rig.setModelVisible(m, true)); cutHistory.length = 0; saveModelPrefs(); renderTab();
    } }, 'Mostrar todo'),
  ));
  body.append(h('p', { class: 'hint' }, 'Con la tijera, cada toque oculta la pieza suelta que tocas (pantalón, falda, lazo, guante…). Las secciones de abajo ocultan grupos enteros de material.'));
  for (const model of S.rig.models) {
    const card = h('div', { class: 'card' });
    card.append(h('div', { class: 'head' }, h('span', { class: 'grow' }, model.name),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: model.visible, onchange: (e) => { S.rig.setModelVisible(model, e.target.checked); saveModelPrefs(); } }), h('span'))));
    for (const s of model.meshes) {
      const isl = s.islands ?? null;
      const row = h('div', { class: 'row' },
        h('label', {}, s.label, s.hidden.size ? h('span', { class: 'sub' }, `  · ${s.hidden.size} pieza(s) ocultas`) : null),
        h('button', { class: 'chip small', onclick: () => { toonGlobals.uHighlight.value = toonGlobals.uHighlight.value === s.sectionId ? -1 : s.sectionId; setTimeout(() => { if (toonGlobals.uHighlight.value === s.sectionId) toonGlobals.uHighlight.value = -1; }, 1500); } }, 'Ver'),
        h('button', { class: 'chip small', onclick: () => renderIslands(model, s) }, 'Piezas'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s.visible, onchange: (e) => { S.rig.setSectionVisible(model, s, e.target.checked); saveModelPrefs(); } }), h('span')));
      void isl;
      card.append(row);
    }
    body.append(card);
  }
}
function renderIslands(model, s) {
  const body = $('#sheetBody');
  const isl = computeIslands(s.geometry);
  const order = isl.sizes.map((n, i) => i).sort((a, b) => isl.sizes[b] - isl.sizes[a]);
  body.replaceChildren(
    h('button', { class: 'btn', onclick: () => renderTab() }, '← Volver'),
    h('h3', {}, `${s.label}: ${isl.count} piezas`),
    h('p', { class: 'hint' }, 'Ordenadas de mayor a menor. Pulsa «Ver» para resaltar una pieza un momento.'),
    h('ul', { class: 'list' }, order.slice(0, 150).map((i, k) => h('li', {},
      h('span', { class: 'grow' }, `Pieza ${k + 1}`, h('span', { class: 'sub' }, ` · ${isl.sizes[i]} vértices`)),
      h('button', { class: 'chip small', onclick: () => flashIsland(s, i) }, 'Ver'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !s.hidden.has(i), onchange: (e) => { setIslandHidden(s, i, !e.target.checked); saveModelPrefs(); } }), h('span'))))),
  );
}
function flashIsland(s, i) {
  const was = s.hidden.has(i);
  let n = 0;
  const iv = setInterval(() => { setIslandHidden(s, i, n % 2 === 0 ? !was : was); if (++n >= 6) { clearInterval(iv); setIslandHidden(s, i, was); } }, 220);
}

// ---- Equipment: weapons & props
function renderEquipTab(body) {
  const boneOptions = () => {
    const names = ['Root', 'WeaponProp01', 'WeaponProp02', 'WeaponProp03', 'WeaponProp04', 'WeaponProp05', 'WeaponProp06', 'WeaponProp07', 'Bip001RHand', 'Bip001LHand', 'Bip001Spine2', 'Bip001Pelvis', 'Bip001Head', 'HuluProp01', ...S.rig.sockets.keys()];
    return [...new Set(names)].filter((n) => S.rig.findBone(n) || S.rig.sockets.get(n));
  };
  const weapons = S.extras.filter((x) => x.kind === 'weapon');
  const props = S.extras.filter((x) => x.kind === 'prop');
  body.append(h('h3', {}, 'Arma'));
  if (!weapons.length) body.append(h('p', { class: 'hint' }, 'Este .zip no incluye armas. En encore.moe elige un arma antes de pulsar «Download .zip».'));
  else {
    const current = weapons.find((w) => w.mode === 'on');
    const sel = h('select', { class: 'full', onchange: async (e) => {
      for (const w of weapons) { w.mode = 'off'; if (w.rig) w.rig.group.visible = false; if (w.scabbard) w.scabbard.group.visible = false; }
      const w = weapons[+e.target.value];
      if (w) { w.mode = 'on'; if (!w.loaded) await loadExtra(w); w.rig.group.visible = true; if (w.scabbard) w.scabbard.group.visible = w.showScabbard !== false; await syncExtras(); }
      renderTab();
    } }, h('option', { value: '-1' }, 'Sin arma'), weapons.map((w, i) => h('option', { value: String(i), selected: w === current }, w.entry.name.replace(/Md\d+$/, ''))));
    body.append(sel);
    if (current) {
      body.append(boneRow('Mano / hueso del arma', current.bone, boneOptions(), (v) => { current.bone = v; attachExtra(current); }));
      if (current.scabbard) {
        body.append(boneRow('Hueso de la vaina', current.scabBone, boneOptions(), (v) => { current.scabBone = v; attachExtra(current); }));
        body.append(toggle('Mostrar vaina', current.showScabbard !== false, (v) => { current.showScabbard = v; current.scabbard.group.visible = v; }));
      }
      body.append(offsetControls(current));
    }
  }
  body.append(h('h3', {}, 'Objetos de las animaciones'));
  if (!props.length) body.append(h('p', { class: 'hint' }, 'Sin objetos en este paquete.'));
  for (const x of props) {
    body.append(h('div', { class: 'card' },
      h('div', { class: 'head' }, h('span', { class: 'grow' }, prettyProp(x.entry.name)), h('span', { class: 'sub' }, `${x.entry.anims.length} anim.`)),
      chips([['auto', 'Con su animación'], ['on', 'Siempre'], ['off', 'Nunca']], x.mode, async (v) => { x.mode = v; await syncExtras(); renderTab(); }),
      boneRow('Unido a', x.bone, boneOptions(), (v) => { x.bone = v; attachExtra(x); }),
      x.entry.anims.length ? h('p', { class: 'hint' }, 'Aparece en: ' + x.entry.anims.map((a) => a.split('/').pop().replace('.ueanim', '')).join(', ')) : null,
    ));
  }
}
const prettyProp = (n) => n.replace(/Md\d+$/, '').replace(/^E(?=[A-Z])/i, '').replace(/^([a-z])/, (c) => c.toUpperCase());
function boneRow(label, value, options, onChange) {
  return h('div', { class: 'row' }, h('label', {}, label), h('select', { class: 'full', style: { flex: '2' }, onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o, selected: o === value }, o))));
}
function offsetControls(x) {
  const g = x.rig.group;
  const d = h('details', {}, h('summary', {}, 'Ajuste fino de posición'));
  const inner = h('div', { class: 'inner' });
  const axes = ['x', 'y', 'z'];
  axes.forEach((a) => inner.append(slider(`Mover ${a.toUpperCase()}`, { min: -30, max: 30, step: 0.1, value: g.position[a], onInput: (v) => (g.position[a] = v), fmt: (v) => (+v).toFixed(1) })));
  axes.forEach((a) => inner.append(slider(`Girar ${a.toUpperCase()}`, { min: -180, max: 180, step: 1, value: THREE.MathUtils.radToDeg(g.rotation[a]), onInput: (v) => (g.rotation[a] = THREE.MathUtils.degToRad(v)), fmt: (v) => `${Math.round(v)}°` })));
  inner.append(h('button', { class: 'btn', onclick: () => { g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); renderTab(); } }, 'Reiniciar ajuste'));
  d.append(inner);
  return d;
}

// ---- Face / morph targets
function renderFaceTab(body) {
  body.append(h('h3', {}, 'Expresiones (morphs)'));
  body.append(toggle('La animación controla la cara', S.animFace, (v) => { S.animFace = v; }));
  const search = h('input', { type: 'search', placeholder: 'Buscar morph…', value: S.morphFilter, oninput: (e) => { S.morphFilter = e.target.value; fill(); } });
  body.append(h('div', { class: 'row' }, search, h('button', { class: 'btn', onclick: () => { S.morphValues.clear(); fill(); } }, 'Reiniciar')));
  body.append(h('p', { class: 'hint' }, 'Un valor distinto de 0 manda sobre la animación. Prefijos: E_ ojos, M_ boca, B_ cejas, Pupil pupilas.'));
  const list = h('div'); body.append(list);
  const groupName = (m) => {
    const g = m.group.replace(/^MI_/, '').replace(/^.*Md\d+/, '') || 'Otros';
    return { Face: 'Cara', Eye: 'Ojos', Up: 'Ropa superior', Down: 'Ropa inferior', Hair: 'Pelo', Bangs: 'Flequillo' }[g] ?? g;
  };
  function fill() {
    list.replaceChildren();
    if (!S.rig.morphMeta.length) { list.append(h('p', { class: 'hint' }, 'Este modelo no tiene morphs.')); return; }
    const f = S.morphFilter.trim().toLowerCase();
    const groups = new Map();
    for (const m of S.rig.morphMeta) {
      if (f && !m.name.toLowerCase().includes(f)) continue;
      const g = groupName(m); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m);
    }
    const order = ['Cara', 'Ojos'];
    for (const [g, ms] of [...groups].sort((a, b) => (order.indexOf(a[0]) + 1 || 9) - (order.indexOf(b[0]) + 1 || 9))) {
      list.append(h('details', { open: order.includes(g) || !!f }, h('summary', {}, `${g} (${ms.length})`),
        h('div', { class: 'inner' }, ms.map((m) => slider(m.name, { min: 0, max: 1, step: 0.01, value: S.morphValues.get(m.name) ?? 0, onInput: (v) => S.morphValues.set(m.name, v) })))));
    }
  }
  fill();
}

// ---- Lights
function renderLightsTab(body) {
  body.append(h('h3', {}, 'Ambientes de luz'));
  body.append(h('div', { class: 'chips' }, Object.keys(LIGHT_PRESETS).map((n) => h('button', { class: 'chip', onclick: () => { viewer.setLights(LIGHT_PRESETS[n]()); saveLights(); renderTab(); } }, n))));
  body.append(toggle('Mostrar posición de las luces', viewer.markers.visible, (v) => (viewer.markers.visible = v)));
  body.append(h('h3', {}, `Luces (${viewer.lights.length})`));
  const addRow = h('div', { class: 'chips' }, Object.entries(LIGHT_TYPES).map(([t, l]) => h('button', { class: 'chip small', onclick: () => {
    viewer.lights.push(newLight(t, { name: `${l} ${viewer.lights.filter((x) => x.type === t).length + 1}`, azimuth: Math.round(Math.random() * 360) }));
    viewer.rebuildLights(); saveLights(); renderTab();
  } }, '＋ ' + l)));
  body.append(addRow);
  if (viewer.lights.length > 12) body.append(h('p', { class: 'hint' }, 'Muchas luces pueden ir lentas en móviles modestos.'));
  viewer.lights.forEach((L, i) => {
    const upd = () => { viewer.updateLights(); saveLights(); };
    const card = h('details', { class: 'card', open: viewer.lights.length <= 3 });
    card.append(h('summary', {},
      h('span', { style: { display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%', background: L.color, border: '1px solid #fff4' } }),
      ` ${L.name}`, h('span', { class: 'sub' }, ` · ${LIGHT_TYPES[L.type]}${L.enabled ? '' : ' (apagada)'}`)));
    const inner = h('div', { class: 'inner' });
    inner.append(toggle('Encendida', L.enabled, (v) => { L.enabled = v; upd(); }));
    inner.append(h('div', { class: 'row' }, h('label', {}, 'Color'), h('input', { type: 'color', value: L.color, oninput: (e) => { L.color = e.target.value; upd(); } }),
      L.type === 'hemisphere' ? h('label', {}, 'Suelo') : null,
      L.type === 'hemisphere' ? h('input', { type: 'color', value: L.groundColor, oninput: (e) => { L.groundColor = e.target.value; upd(); } }) : null));
    inner.append(slider('Intensidad', { min: 0, max: L.type === 'point' || L.type === 'spot' ? 20 : 4, value: L.intensity, onInput: (v) => { L.intensity = v; upd(); } }));
    if (L.type !== 'ambient' && L.type !== 'hemisphere') {
      inner.append(slider('Ángulo horizontal', { min: -180, max: 180, step: 1, value: ((L.azimuth + 180) % 360 + 360) % 360 - 180, onInput: (v) => { L.azimuth = v; upd(); }, fmt: (v) => `${Math.round(v)}°` }));
      inner.append(slider('Altura', { min: -89, max: 89, step: 1, value: L.elevation, onInput: (v) => { L.elevation = v; upd(); }, fmt: (v) => `${Math.round(v)}°` }));
      inner.append(toggle('Girar con la cámara', L.followCamera, (v) => { L.followCamera = v; upd(); }));
    }
    if (L.type === 'point' || L.type === 'spot') inner.append(slider('Distancia', { min: 0.3, max: 8, value: L.distance, onInput: (v) => { L.distance = v; upd(); } }));
    if (L.type === 'spot') {
      inner.append(slider('Apertura', { min: 3, max: 80, step: 1, value: L.angle, onInput: (v) => { L.angle = v; upd(); }, fmt: (v) => `${Math.round(v)}°` }));
      inner.append(slider('Borde suave', { min: 0, max: 1, value: L.penumbra, onInput: (v) => { L.penumbra = v; upd(); } }));
    }
    if (L.type === 'directional' || L.type === 'spot') inner.append(toggle('Proyecta sombra', L.castShadow, (v) => { L.castShadow = v; upd(); }));
    inner.append(h('div', { class: 'row' },
      h('input', { type: 'text', value: L.name, onchange: (e) => { L.name = e.target.value; saveLights(); renderTab(); }, style: { flex: '1' } }),
      h('button', { class: 'btn', onclick: () => { viewer.lights.splice(i + 1, 0, newLight(L.type, { ...L, id: undefined, name: L.name + ' (copia)' })); viewer.rebuildLights(); saveLights(); renderTab(); } }, 'Duplicar'),
      h('button', { class: 'btn danger', onclick: () => { viewer.lights.splice(i, 1); viewer.rebuildLights(); saveLights(); renderTab(); } }, 'Borrar')));
    card.append(inner);
    body.append(card);
  });
  body.append(h('p', { class: 'hint' }, 'La luz «Ambiente» fija lo oscuras que son las sombras del dibujo (toon). Las demás iluminan y crean brillos de borde.'));
}

// ---- Scene
function renderSceneTab(body) {
  const bg = viewer.bg;
  const saveBg = () => platform.store.set('bg', { ...viewer.bg, image: null, type: viewer.bg.type === 'image' ? 'gradient' : viewer.bg.type });
  body.append(h('h3', {}, 'Fondo'));
  body.append(h('div', { class: 'chips' }, BG_PRESETS.map((p) => h('button', { class: 'chip small', onclick: () => { viewer.setBackground(p); saveBg(); renderTab(); } },
    h('span', { style: { display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', marginRight: '5px', background: p.type === 'gradient' ? `linear-gradient(${p.top},${p.bottom})` : p.color } }), p.name))));
  body.append(chips([['gradient', 'Degradado'], ['color', 'Color'], ['image', 'Imagen'], ['transparent', 'Transparente']], bg.type, async (v) => {
    if (v === 'image') {
      const f = await platform.pickFile('image/*'); if (!f) return;
      const img = await createImageBitmap(f);
      viewer.setBackground({ type: 'image', image: img });
    } else viewer.setBackground({ type: v });
    saveBg(); renderTab();
  }));
  if (bg.type === 'gradient') body.append(h('div', { class: 'row' }, h('label', {}, 'Arriba'), h('input', { type: 'color', value: bg.top, oninput: (e) => { viewer.setBackground({ top: e.target.value }); saveBg(); } }),
    h('label', {}, 'Abajo'), h('input', { type: 'color', value: bg.bottom, oninput: (e) => { viewer.setBackground({ bottom: e.target.value }); saveBg(); } })));
  if (bg.type === 'color') body.append(h('div', { class: 'row' }, h('label', {}, 'Color'), h('input', { type: 'color', value: bg.color, oninput: (e) => { viewer.setBackground({ color: e.target.value }); saveBg(); } })));
  if (bg.type === 'image') body.append(chips([['cover', 'Rellenar'], ['stretch', 'Estirar']], bg.fit, (v) => { viewer.setBackground({ fit: v }); renderTab(); }));
  body.append(h('h3', {}, 'Suelo'));
  body.append(chips([['shadow', 'Solo sombra'], ['disc', 'Plataforma'], ['grid', 'Rejilla'], ['none', 'Nada']], viewer.floorMode, (v) => { viewer.setFloor(v); platform.store.set('floor', v); renderTab(); }));
  if (viewer.floorMode === 'disc') body.append(h('div', { class: 'row' }, h('label', {}, 'Color plataforma'), h('input', { type: 'color', value: viewer.floorColor, oninput: (e) => viewer.setFloor('disc', e.target.value) })));
  body.append(h('h3', {}, 'Cámara'));
  body.append(h('div', { class: 'grid3' }, [['front', 'Frente'], ['threeq', '3/4'], ['left', 'Lado'], ['back', 'Espalda'], ['top', 'Arriba'], ['low', 'Contrapicado'], ['face', 'Cara']].map(([k, l]) =>
    h('button', { class: 'btn', onclick: () => viewer.viewPreset(k) }, l))));
  body.append(slider('Campo de visión', { min: 10, max: 75, step: 1, value: look.fov, onInput: (v) => { look.fov = v; applyLook(); }, fmt: (v) => `${Math.round(v)}°` }));
  body.append(toggle('Girar automáticamente', viewer.controls.autoRotate, (v) => { viewer.controls.autoRotate = v; }));
  body.append(slider('Velocidad de giro', { min: -10, max: 10, step: 0.5, value: viewer.controls.autoRotateSpeed, onInput: (v) => (viewer.controls.autoRotateSpeed = v), fmt: (v) => (+v).toFixed(1) }));
  body.append(h('h3', {}, 'Captura'));
  body.append(h('div', { class: 'grid3' },
    h('button', { class: 'btn', onclick: () => shot({}) }, '📷 Normal'),
    h('button', { class: 'btn', onclick: () => shot({ scale: 2 }) }, '📷 Alta (2×)'),
    h('button', { class: 'btn', onclick: () => shot({ transparent: true, scale: 2 }) }, '📷 Transparente')));
}
function shot(opts) {
  pose.markers.visible && (pose.markers.visible = false);
  const helperVis = pose.gizmoHelper.visible; pose.gizmoHelper.visible = false;
  const url = viewer.screenshot(opts);
  pose.gizmoHelper.visible = helperVis; pose.markers.visible = pose.active;
  platform.saveFile(`${(S.modelName || 'captura').replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.png`, url, 'image/png');
  if (!platform.isAndroid) toast('Captura guardada');
}
$('#btnShot').onclick = () => shot({ scale: 1.5 });
$('#btnResetView').onclick = () => viewer.viewPreset('front');
$('#btnHideUi').onclick = () => document.body.classList.toggle('ui-hidden');

// ---- Look
function renderLookTab(body) {
  body.append(h('h3', {}, 'Contorno'));
  body.append(toggle('Mostrar contorno', look.outlineOn, (v) => { look.outlineOn = v; applyLook(); }));
  body.append(slider('Grosor del contorno', { min: 0, max: 4, value: look.outline, onInput: (v) => { look.outline = v; applyLook(); } }));
  body.append(h('h3', {}, 'Sombreado'));
  body.append(slider('Suavidad de sombras', { min: 0.1, max: 5, value: look.soft, onInput: (v) => { look.soft = v; applyLook(); } }));
  body.append(slider('Brillo de borde (rim)', { min: 0, max: 3, value: look.rim, onInput: (v) => { look.rim = v; applyLook(); } }));
  body.append(slider('Brillos especulares', { min: 0, max: 3, value: look.spec, onInput: (v) => { look.spec = v; applyLook(); } }));
  body.append(toggle('Sombras proyectadas sobre el personaje', look.selfShadow, (v) => { look.selfShadow = v; applyLook(); }));
  body.append(h('h3', {}, 'Color'));
  body.append(slider('Exposición', { min: 0.3, max: 2, value: look.exposure, onInput: (v) => { look.exposure = v; applyLook(); } }));
  body.append(slider('Saturación', { min: 0, max: 2, value: look.sat, onInput: (v) => { look.sat = v; applyLook(); } }));
  body.append(h('h3', {}, 'Rendimiento'));
  body.append(slider('Escala de render', { min: 0.5, max: 3, step: 0.25, value: look.renderScale, onInput: (v) => { look.renderScale = v; viewer.setRenderScale(v); applyLook(); }, fmt: (v) => `${(+v).toFixed(2)}×` }));
  body.append(h('div', { class: 'row' }, h('label', {}, 'Calidad de texturas'), h('select', { class: 'full', style: { flex: '1' }, onchange: (e) => { look.texSize = +e.target.value; applyLook(); toast('Se aplicará al volver a abrir el modelo'); } },
    [[512, 'Baja (512)'], [1024, 'Media (1024)'], [2048, 'Alta (2048)'], [4096, 'Máxima']].map(([v, l]) => h('option', { value: String(v), selected: v === look.texSize }, l)))));
}

// ---------------------------------------------------------------- library
async function openLibrary() {
  $('#library').hidden = false;
  const list = await platform.listModels();
  const ul = $('#modelList');
  ul.replaceChildren();
  if (!list.length) ul.append(h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Sin modelos todavía'), h('div', { class: 'sub' }, 'Pulsa «Importar .zip» y elige un archivo descargado de encore.moe.'))));
  for (const m of list) {
    ul.append(h('li', {},
      h('div', { class: 'grow', onclick: () => openModel(m.id, m.name) },
        h('div', { class: 'name' }, m.name),
        h('div', { class: 'sub' }, `${m.files ?? '?'} archivos · ${((m.size ?? 0) / 1048576).toFixed(0)} MB`)),
      h('button', { class: 'btn', onclick: () => openModel(m.id, m.name) }, 'Abrir'),
      platform.isAndroid ? h('button', { class: 'btn', onclick: () => { const n = prompt('Nuevo nombre', m.name); if (n) { platform.renameModel(m.id, n); openLibrary(); } } }, '✎') : null,
      platform.isAndroid ? h('button', { class: 'btn danger', onclick: () => { if (confirm(`¿Borrar ${m.name}?`)) { platform.deleteModel(m.id); platform.store.set('model.' + m.id, null); openLibrary(); } } }, '🗑') : null));
  }
}
function closeLibrary() { $('#library').hidden = true; }
$('#btnLibrary').onclick = openLibrary;
$('#btnCloseLibrary').onclick = closeLibrary;
$('#btnImport').onclick = () => platform.importZip();
platform.onImportProgress((pct, msg) => {
  const p = $('#importProgress'); p.hidden = false;
  p.querySelector('.bar div').style.width = `${pct}%`; p.querySelector('span').textContent = msg ?? `${pct}%`;
});
platform.onImportDone((r) => {
  $('#importProgress').hidden = true;
  if (r.error) { toast('No se pudo importar: ' + r.error, 6000); return; }
  toast(`Importado: ${r.name}`);
  openLibrary();
});
platform.onFileSaved((msg) => toast(msg));

// start
(async () => {
  const list = await platform.listModels();
  const last = platform.store.get('lastModel', null);
  const m = list.find((x) => x.id === last) ?? (list.length === 1 ? list[0] : null);
  if (m) openModel(m.id, m.name); else openLibrary();
})();
document.addEventListener('visibilitychange', () => { if (S.modelId) platform.store.set('lastModel', S.modelId); });
window.__dbg = { S, viewer, pose, springs, THREE, playAnim, renderTab, setCutMode };
// Android back button: close the open layer first
window.__wuwaBack = () => {
  if (!$('#library').hidden && S.rig) { closeLibrary(); return true; }
  if (S.cutMode) { setCutMode(false); renderTab(); return true; }
  if (S.tab) { S.tab = null; renderTab(); return true; }
  if (document.body.classList.contains('ui-hidden')) { document.body.classList.remove('ui-hidden'); return true; }
  return false;
};
