// Avatar mode: the character in close-up, looking at you and reacting to touch.
// Everything is layered on top of the model's own animations: a calm dialog idle for the body, the
// face idle (blinks, eye darts) for the eyes, the character's dialog gestures (shy, complain…) when they
// exist, and procedural head/eye tracking, breathing, expressions, cheek squish and blush.
import * as THREE from 'three';
import { toonGlobals } from './toon.js';
import { loadAnim, buildClip, sampleCurve } from './animation.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Facial expressions as morph weights. Morphs a model lacks are skipped (or use the fallback below).
const EXPR = {
  neutral: {},
  smile: { M_Smile_L: 0.55, M_Smile_R: 0.55, B_Cheerful: 0.35 },
  // warm but natural: eyes only soften a little
  fond: { E_Smile_L: 0.22, E_Smile_R: 0.22, M_Smile_L: 0.6, M_Smile_R: 0.6, B_Happy: 0.4 },
  happy: { E_Smile_L: 0.9, E_Smile_R: 0.9, M_Smile_L: 0.8, M_Smile_R: 0.8, B_Happy: 0.7 },
  bliss: { E_Smile_L: 1, E_Smile_R: 1, M_Smile_L: 0.6, M_Smile_R: 0.6, B_Happy: 0.9, M_OpenSmall: 0.25 },
  laugh: { E_Smile_L: 1, E_Smile_R: 1, M_Laugh: 0.9, B_Happy: 0.8 },
  pinched: { E_Close: 0.55, E_Anger: 0.3, B_Anger: 0.55, M_Trapezoid: 0.3, M_Anger: 0.3 },
  pinchedMad: { E_Anger: 0.8, B_Anger: 1, M_Anger: 0.7 },
  pout: { B_Anger: 0.5, E_Insipid: 0.35, M_Ennui_L: 0.5, M_Ennui_R: 0.5 },
  angry: { B_Anger: 1, E_Anger: 0.7, M_Anger: 0.6 },
  surprised: { E_Stare: 0.85, B_Up_Add: 0.8, M_O: 0.55, Pupil_Scale: 0.3 },
  flustered: { E_Stare: 0.45, B_Sad: 0.55, M_Scared: 0.5 },
  squint: { E_Close: 1, B_Anger: 0.4, M_Trapezoid: 0.4 },
  curious: { B_Up_Add: 0.45, M_OpenSmall: 0.3, E_Focus: 0.3 },
  sad: { B_Sad: 0.8, E_Sad: 0.6, M_Ennui_L: 0.3, M_Ennui_R: 0.3 },
};
const FALLBACK = { E_Smile_L: 'E_Close', E_Smile_R: 'E_Close', M_Trapezoid: 'M_Ennui_L', M_Laugh: 'M_A', M_O: 'O', M_Scared: 'M_OpenSmall', E_Stare: 'E_Focus' };
const EMOTE = { heart: '♥', note: '♪', bang: '!', huh: '?', mad: '💢', dots: '…', sweat: '💦', sparkle: '✨' };

// Dialog gestures from the character's own files (Sequence/…/DialogAnim/<rig>/Body/<Name>_Start|_Loop|_End).
// Each kind lists name patterns in order of preference; one existing set is picked at random.
const BODY = {
  shy: [/^shy\d*$/i],
  complain: [/^(tsundere|complain)\d*$/i, /^forbear\d*$/i],
  scared: [/^scare\d*$/i, /^(shy|awareness)\d*$/i],
  happy: [/^(excite|guzhang|elevate)\d*$/i, /^fool\d*$/i],
  greet: [/^greetings?\d*$/i, /^(promise|expect)\d*$/i],
  hush: [/^xu\d*$/i, /^touch\d*$/i],
  touched: [/^touch\d*$/i, /^shy\d*$/i],
  think: [/^thinking\d*$/i, /^awareness\d*$/i],
  pleased: [/^(promise|expect|support)\d*$/i, /^shy\d*$/i],
  endure: [/^forbear\d*$/i, /^(complain|tsundere)\d*$/i],
  // calm idle gestures she does on her own now and then
  idle: [/^(calm|talk|thinking|expect|elevate)\d*$/i],
};

export class Avatar {
  constructor({ viewer, onExit } = {}) {
    this.viewer = viewer;
    this.onExit = onExit;
    this.active = false;
    this.rig = null; this.mixer = null; this.pkg = null; this.cat = null;
    this.expr = new Map();          // morph → current weight (eased)
    this.exprTarget = new Map();
    this.pose = { yaw: 0, pitch: 0, tilt: 0, nod: 0, turn: 0, lean: 0 };
    this.poseTarget = { tilt: 0, nod: 0, turn: 0, lean: 0 };
    this.blush = 0; this.blushTarget = 0;
    this.annoy = 0; this.affection = 0;
    this.phases = []; this.phaseT = 0;
    this.touch = null;
    this.gaze = new THREE.Vector3();
    this.glance = { until: 0, next: 2, off: new THREE.Vector3() };
    this.t = 0;
    this.written = new Map();       // bone → { base, out } to undo our offsets on bones no clip drives
    this.poke = { kind: -1, center: new THREE.Vector3(), offset: new THREE.Vector3(), vel: new THREE.Vector3(), radius: 0.02, local: null, release: false };
    this.clipCache = new Map();
    this.body = { cur: null, queue: [], idle: null };
    this.raycaster = new THREE.Raycaster();
    this.framing = 'bust';
    this.lastReact = 0;
  }

  // ------------------------------------------------------------ enter / exit
  async enter({ rig, mixer, pkg, cat }) {
    this.rig = rig; this.mixer = mixer; this.pkg = pkg; this.cat = cat;
    this.head = rig.findBone('Bip001Head');
    if (!this.head) throw new Error('this model has no head bone');
    this.bones = {
      head: this.head, neck: rig.findBone('Bip001Neck'), chest: rig.findBone('Bip001Spine2'),
      spine1: rig.findBone('Bip001Spine1'), spine: rig.findBone('Bip001Spine'),
      clavL: rig.findBone('Bip001LClavicle'), clavR: rig.findBone('Bip001RClavicle'),
      // soft-body bones some outfits have (left / right); the touch wiggle is skipped without them
      chestL: rig.findBone('Bone_Chest001_L'), chestR: rig.findBone('Bone_Chest001_R'),
    };
    this.jiggle = null;
    this.morphs = new Set(rig.morphIndex.keys());
    this.calibrate();
    // body idle: the calm dialog stance faces the camera; fall back to the menu idle the viewer played
    this.dialogDir = this.findDialogDir();
    const idlePath = this.dialogBody('Stand01') ?? this.dialogBody('Stand1') ?? this.dialogBody('Calm01_Loop') ?? null;
    mixer.stopAllAction();
    mixer.uncacheRoot(rig.space);
    this.clipCache.clear();
    this.body = { cur: null, queue: [], idle: null };
    if (idlePath) this.body.idle = await this.clip(idlePath);
    this.faceClip = null;
    const facePath = this.dialogDir && cat.charAnims.find((p) => p.startsWith(this.dialogDir + '/Face/') && /Idle0?1\.ueanim$/i.test(p));
    if (facePath) this.faceClip = await this.clip(facePath);
    this.faceT = 0;
    if (this.body.idle) {
      const a = mixer.clipAction(this.body.idle);
      a.reset().play();
      this.body.cur = { action: a, clip: this.body.idle, idle: true, t: 0 };
    }
    this.hasOwnBlink = !this.faceClip && !(this.body.idle?.userData.curves ?? []).some((c) => c.morph === 'E_Close');
    this.nextBlink = 1;
    this.expr.clear(); this.exprTarget.clear();
    Object.assign(this.pose, { yaw: 0, pitch: 0, tilt: 0, nod: 0, turn: 0, lean: 0 });
    Object.assign(this.poseTarget, { tilt: 0, nod: 0, turn: 0, lean: 0 });
    this.blush = this.blushTarget = 0; this.annoy = 0; this.affection = 0; this.phases = [];
    // this.t restarts at 0 on every entry: timers from the previous character must restart too, or every
    // touch is ignored until the clock catches up with them
    this.lastReact = -1; this.lastGesture = -10; this.phasePriority = 0; this.gestureToken = (this.gestureToken ?? 0) + 1;
    this.touch = null; this.hover = null; this.idleT = 0; this.nextIdle = 6; this.gestureIdleT = 0; this.nextGestureIdle = rand(12, 20);
    this.glance.next = 2; this.glance.until = 0;
    this.poke.kind = -1; this.poke.release = false; this.poke.offset.set(0, 0, 0); this.poke.vel.set(0, 0, 0);
    this.written.clear();
    this.active = true;
    this.t = 0;
    this.update(0);
    this.frame(true);
    this.say(pick(['greet', 'smile']));
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.restoreBones();
    toonGlobals.uPokeKind.value = -1;
    toonGlobals.uBlush.value = 0;
    this.touch = null;
    this.mixer?.stopAllAction();
    this.onExit?.();
  }

  findDialogDir() {
    // ".../DialogAnim/FemaleMS/Kamola/Body/Stand01.ueanim" → ".../DialogAnim/FemaleMS/Kamola"
    const p = this.cat.charAnims.find((x) => /\/DialogAnim\/[^/]+\/[^/]+\/Body\/[^/]+\.ueanim$/i.test(x));
    return p ? p.replace(/\/Body\/[^/]+$/i, '') : null;
  }
  dialogBody(name) {
    if (!this.dialogDir) return null;
    const want = (this.dialogDir + '/Body/' + name + '.ueanim').toLowerCase();
    return this.cat.charAnims.find((p) => p.toLowerCase() === want) ?? null;
  }
  // a gesture set { start, loop, end } or { once } for one of the BODY kinds
  gesture(kind) {
    if (!this.dialogDir) return null;
    const dir = this.dialogDir + '/Body/';
    const names = this.cat.charAnims.filter((p) => p.startsWith(dir) && !p.slice(dir.length).includes('/')).map((p) => p.slice(dir.length).replace(/\.ueanim$/i, ''));
    for (const re of BODY[kind] ?? []) {
      const bases = [...new Set(names.map((n) => n.replace(/_(Start|Loop|End)$/i, '')).filter((b) => re.test(b)))];
      if (!bases.length) continue;
      const b = pick(bases);
      const get = (suf) => names.find((n) => n.toLowerCase() === (b + suf).toLowerCase());
      const s = get('_Start'), l = get('_Loop'), e = get('_End'), o = get('');
      if (s && e) return { start: dir + s + '.ueanim', loop: l ? dir + l + '.ueanim' : null, end: dir + e + '.ueanim' };
      if (o) return { once: dir + o + '.ueanim' };
    }
    return null;
  }
  async clip(path) {
    if (!this.clipCache.has(path)) {
      this.clipCache.set(path, loadAnim(this.pkg, path).then((a) => buildClip(this.rig, a, { inPlace: true, name: path })));
    }
    return this.clipCache.get(path);
  }

  // Measure the face once in the bind pose: where the eyes, cheeks, chin and top of the head are, in a
  // frame that rides on the head bone (x right, y up, z forward as seen from the front, metres).
  calibrate() {
    const rig = this.rig, head = this.head;
    const saved = rig.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
    rig.resetToBind();
    rig.group.updateMatrixWorld(true);
    const hp = head.getWorldPosition(new THREE.Vector3()), hq = head.getWorldQuaternion(new THREE.Quaternion());
    const inv = hq.clone().invert();
    const R = new THREE.Vector3(1, 0, 0).applyQuaternion(inv), U = new THREE.Vector3(0, 1, 0).applyQuaternion(inv), F = new THREE.Vector3(0, 0, 1).applyQuaternion(inv);
    this.axes = { R, U, F };
    const boxes = { 1: new THREE.Box3(), 2: new THREE.Box3(), 3: new THREE.Box3() };
    const facePts = [], hairPts = [];
    const p = new THREE.Vector3();
    for (const { section } of rig.allSections()) {
      const kind = section.mesh.material.userData.kind;
      if (!boxes[kind]) continue;
      const pos = section.geometry.attributes.position.array, mw = section.mesh.matrixWorld;
      const step = kind === 1 ? 3 : 1;
      for (let i = 0; i < pos.length; i += 3 * step) {
        p.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(mw).sub(hp).applyQuaternion(inv);
        const fc = new THREE.Vector3(p.dot(R), p.dot(U), p.dot(F));
        if (kind === 2) { boxes[2].expandByPoint(fc); facePts.push(fc); }
        else if (kind === 3) boxes[3].expandByPoint(fc);
        else hairPts.push(fc);
      }
    }
    for (let i = 0; i < saved.length; i++) { const b = rig.bones[i]; b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); }
    rig.group.updateMatrixWorld(true);
    const fb = boxes[2];
    if (fb.isEmpty()) { // no face material: guess from the head bone
      fb.set(new THREE.Vector3(-0.07, -0.02, -0.06), new THREE.Vector3(0.07, 0.18, 0.09));
    }
    let eb = boxes[3];
    const fs = fb.getSize(new THREE.Vector3());
    if (eb.isEmpty() || eb.getSize(_v1).x > fs.x * 1.2) {
      eb = new THREE.Box3(new THREE.Vector3(fb.min.x * 0.7, fb.min.y + fs.y * 0.45, 0), new THREE.Vector3(fb.max.x * 0.7, fb.min.y + fs.y * 0.6, fb.max.z));
    }
    const eyeY = (eb.min.y + eb.max.y) / 2, eyeHalfW = Math.max(Math.abs(eb.min.x), Math.abs(eb.max.x));
    const halfW = Math.max(Math.abs(fb.min.x), Math.abs(fb.max.x));
    // the chin is the lowest face point near the middle, the forehead line is the eyes' top
    let chinY = Infinity;
    for (const q of facePts) if (Math.abs(q.x) < halfW * 0.25 && q.z > fb.max.z - fs.z * 0.5) chinY = Math.min(chinY, q.y);
    if (!isFinite(chinY)) chinY = fb.min.y;
    let top = fb.max.y;
    for (const q of hairPts) if (Math.abs(q.x) < halfW * 0.8 && Math.abs(q.z - (fb.min.z + fb.max.z) / 2) < fs.z) top = Math.max(top, q.y);
    top = Math.min(top, fb.max.y + fs.y * 0.8);
    // cheeks: below the outer half of each eye, on the front surface
    const cheekY = eb.min.y - (eb.min.y - chinY) * 0.28;
    const surface = (x, y) => {
      let z = -Infinity;
      for (const q of facePts) if (Math.abs(q.x - x) < 0.006 && Math.abs(q.y - y) < 0.006) z = Math.max(z, q.z);
      return isFinite(z) ? z : fb.max.z - fs.z * 0.2;
    };
    const cx = eyeHalfW * 0.62;
    this.face = {
      box: fb, eyeBox: eb, eyeY, eyeHalfW, halfW, chinY, top,
      center: new THREE.Vector3(0, (chinY + top) / 2, (fb.min.z + fb.max.z) / 2),
      eyes: new THREE.Vector3(0, eyeY, surface(cx, eyeY)),
      cheekL: new THREE.Vector3(-cx, cheekY, surface(-cx, cheekY) + 0.002),
      cheekR: new THREE.Vector3(cx, cheekY, surface(cx, cheekY) + 0.002),
      // from the eyes, not the face mesh, which can include long (elf) ears
      size: clamp(eyeHalfW * 3, 0.08, Math.max(fs.x, 0.08)),
    };
  }

  // face coordinates ↔ world, with the head where it is right now
  toWorld(fc, out = new THREE.Vector3()) {
    const { R, U, F } = this.axes;
    this.head.getWorldQuaternion(_q3);
    out.copy(R).multiplyScalar(fc.x).addScaledVector(U, fc.y).addScaledVector(F, fc.z).applyQuaternion(_q3);
    return out.add(this.head.getWorldPosition(_v3));
  }
  toFace(w, out = new THREE.Vector3()) {
    const { R, U, F } = this.axes;
    this.head.getWorldQuaternion(_q3).invert();
    const l = _v3.copy(w).sub(this.head.getWorldPosition(new THREE.Vector3())).applyQuaternion(_q3);
    return out.set(l.dot(R), l.dot(U), l.dot(F));
  }

  // ------------------------------------------------------------ camera
  frame(jump = false) {
    const v = this.viewer, cam = v.camera;
    this.rig.group.updateMatrixWorld(true);
    const top = this.toWorld(new THREE.Vector3(0, this.face.top + 0.03, 0));
    const chin = this.toWorld(new THREE.Vector3(0, this.face.chinY, 0));
    const headC = this.toWorld(this.face.center);
    const chest = this.bones.chest?.getWorldPosition(new THREE.Vector3()) ?? chin.clone().add(new THREE.Vector3(0, -0.25, 0));
    const close = this.framing === 'face';
    const bottomY = close ? chin.y - (top.y - chin.y) * 0.45 : chest.y - (chin.y - chest.y) * 1.6;
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const halfH = (top.y - bottomY) / 2;
    const halfWide = close ? this.face.size * 0.75 : this.face.size * 1.15;
    const dist = Math.max(halfH / tv, halfWide / (tv * cam.aspect)) * 1.02;
    // keep the top of the head near the top edge; any extra room goes below
    const target = new THREE.Vector3(headC.x, top.y - dist * tv * 0.94, headC.z);
    // look from the front of the body, at eye height, so the character meets your eyes
    const pos = target.clone().add(new THREE.Vector3(0, 0, dist));
    pos.y = THREE.MathUtils.lerp(target.y, this.toWorld(this.face.eyes).y, 0.6);
    if (jump) { v.tween = null; v.controls.target.copy(target); cam.position.copy(pos); v.controls.update(); }
    else v.tween = { t: 0, p0: cam.position.clone(), t0: v.controls.target.clone(), p1: pos, t1: target };
  }
  toggleFraming() { this.framing = this.framing === 'face' ? 'bust' : 'face'; this.frame(); return this.framing; }

  // ------------------------------------------------------------ per frame
  update(dt) {
    if (!this.rig) return;
    this.t += dt;
    this.restoreBones();
    this.stepBody(dt);
    this.mixer.update(dt);
    this.rig.group.updateMatrixWorld(true);
    this.stepPhases(dt);
    this.stepTouch(dt);
    this.stepMood(dt);
    this.applyMorphs(dt);
    this.applyBones(dt);
    this.applyShader(dt);
  }

  // body animation: the idle, or a gesture (start → loop → end) cross-faded in and out of it
  async playGesture(kind, hold = 1.2) {
    const g = this.gesture(kind);
    if (!g) return false;
    if (this.t - this.lastGesture < 1.5 && this.body.cur && !this.body.cur.idle) return false;
    this.lastGesture = this.t;
    const token = (this.gestureToken = (this.gestureToken ?? 0) + 1);
    const steps = g.once ? [{ path: g.once }] : [{ path: g.start }, ...(g.loop ? [{ path: g.loop, hold }] : []), { path: g.end }];
    const clips = await Promise.all(steps.map((s) => this.clip(s.path)));
    if (token !== this.gestureToken || !this.active) return false;
    this.body.queue = steps.map((s, i) => ({ clip: clips[i], hold: s.hold }));
    this.advanceBody(0.45);
    return true;
  }
  advanceBody(fade = 0.35) {
    const next = this.body.queue.shift();
    const clip = next?.clip ?? this.body.idle;
    if (!clip) return;
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(next ? (next.hold ? THREE.LoopRepeat : THREE.LoopOnce) : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = true;
    a.play();
    const prev = this.body.cur?.action;
    if (prev && prev !== a) prev.crossFadeTo(a, fade, false);
    this.body.cur = { action: a, clip, idle: !next, t: 0, len: next?.hold ?? clip.duration };
  }
  stepBody(dt) {
    const c = this.body.cur;
    if (!c || c.idle) return;
    c.t += dt;
    if (c.t >= c.len - 0.4) this.advanceBody(0.45);
  }

  // timed expression changes for one reaction: [{ d, expr, w, pose, blush, emote }]
  react(phases, { priority = 1 } = {}) {
    if (this.phases.length && priority < (this.phasePriority ?? 0)) return;
    this.phasePriority = priority;
    this.phases = phases.map((p) => ({ ...p }));
    this.phaseT = 0;
    this.startPhase();
  }
  startPhase() {
    const p = this.phases[0];
    if (!p) { this.setExpr('neutral'); this.poseTarget.tilt = this.poseTarget.nod = this.poseTarget.turn = this.poseTarget.lean = 0; this.blushTarget = 0; this.phasePriority = 0; return; }
    this.setExpr(p.expr ?? 'neutral', p.w ?? 1);
    Object.assign(this.poseTarget, { tilt: 0, nod: 0, turn: 0, lean: 0 }, p.pose ?? {});
    if (p.blush != null) this.blushTarget = p.blush;
    if (p.emote) this.emote(p.emote);
    if (p.gesture) this.playGesture(p.gesture, p.hold);
  }
  stepPhases(dt) {
    if (!this.phases.length || this.touch?.holding) return;
    this.phaseT += dt;
    if (this.phaseT >= this.phases[0].d) { this.phases.shift(); this.phaseT = 0; this.startPhase(); }
  }
  setExpr(name, w = 1) {
    this.exprTarget.clear();
    for (const [k, v] of Object.entries(EXPR[name] ?? {})) {
      const m = this.morphs.has(k) ? k : (FALLBACK[k] && this.morphs.has(FALLBACK[k]) ? FALLBACK[k] : null);
      if (m) this.exprTarget.set(m, Math.max(this.exprTarget.get(m) ?? 0, v * w));
    }
  }

  stepMood(dt) {
    this.annoy = Math.max(0, this.annoy - dt * 0.06);
    this.affection = Math.max(0, this.affection - dt * 0.01);
    // idle life: glance away now and then, smile at you when you've been nice
    if (!this.touch && !this.phases.length) {
      this.idleT = (this.idleT ?? 0) + dt;
      if (this.idleT > (this.nextIdle ?? 6)) {
        this.idleT = 0; this.nextIdle = rand(5, 10);
        const r = Math.random();
        if (r < 0.35 + this.affection * 0.3) this.react([{ d: rand(1.5, 2.5), expr: 'smile', blush: this.affection * 0.5 }, { d: 0.1 }], { priority: 0 });
        else if (r < 0.55) this.react([{ d: 1.8, expr: 'curious', pose: { tilt: rand(-0.12, 0.12) } }, { d: 0.1 }], { priority: 0 });
      }
    } else this.idleT = 0;
    // every so often a calm gesture of her own (talking, thinking…), only while nobody is touching
    if (!this.touch && !this.phases.length && this.body.cur?.idle) {
      this.gestureIdleT += dt;
      if (this.gestureIdleT > this.nextGestureIdle) { this.gestureIdleT = 0; this.nextGestureIdle = rand(14, 26); this.playGesture('idle', rand(1.5, 3)); }
    } else this.gestureIdleT = 0;
  }

  // ------------------------------------------------------------ morphs
  applyMorphs(dt) {
    const rig = this.rig;
    const base = new Map();
    // curves of the clips playing now (cloth correctives, the idle's blinks), weighted by their fade
    for (const a of this.mixer._actions) {
      const w = a.getEffectiveWeight(); if (w <= 0.001) continue;
      for (const c of a.getClip().userData.curves ?? []) base.set(c.morph, (base.get(c.morph) ?? 0) + sampleCurve(c, a.time) * w);
    }
    // the face idle: blinks and little eye darts
    if (this.faceClip) {
      this.faceT = (this.faceT + dt) % Math.max(this.faceClip.duration, 0.1);
      for (const c of this.faceClip.userData.curves) if (/^(E_Close|Pupil_|B_Down_Add)/.test(c.morph)) base.set(c.morph, Math.max(base.get(c.morph) ?? 0, sampleCurve(c, this.faceT)));
    } else if (this.hasOwnBlink) {
      this.nextBlink -= dt;
      if (this.nextBlink < 0) { this.blinkT = 0; this.nextBlink = rand(2.5, 5.5); }
      if (this.blinkT != null) {
        this.blinkT += dt;
        const k = this.blinkT / 0.16;
        base.set('E_Close', Math.max(base.get('E_Close') ?? 0, k < 1 ? Math.sin(k * Math.PI) : 0));
        if (k >= 1) this.blinkT = null;
      }
    }
    // expressions ease in and out
    for (const k of new Set([...this.expr.keys(), ...this.exprTarget.keys()])) {
      const v = damp(this.expr.get(k) ?? 0, this.exprTarget.get(k) ?? 0, this.exprTarget.has(k) ? 12 : 7, dt);
      if (v < 0.002 && !this.exprTarget.has(k)) this.expr.delete(k); else this.expr.set(k, v);
    }
    const closed = Math.max(this.expr.get('E_Smile_L') ?? 0, this.expr.get('E_Smile_R') ?? 0, this.expr.get('E_Close') ?? 0, this.expr.get('E_Stare') ?? 0);
    // eyes follow what they look at (what the head doesn't turn), on top of the idle darts
    const ey = this.eyeYaw ?? 0, ep = this.eyePitch ?? 0;
    // full pupil morphs roll the eyes to the very edge: a third of it is already a clear look aside
    const pupils = { Pupil_L: Math.max(0, ey) * 0.35, Pupil_R: Math.max(0, -ey) * 0.35, Pupil_Up: Math.max(0, ep) * 0.3, Pupil_Down: Math.max(0, -ep) * 0.25 };
    const out = new Map(base);
    for (const [k, v] of Object.entries(pupils)) out.set(k, clamp((base.get(k) ?? 0) * 0.4 + v, 0, 1));
    // a held expression wins over the blink, so smiling eyes don't double-close
    if (closed > 0.05) out.set('E_Close', Math.max((base.get('E_Close') ?? 0) * (1 - closed), this.expr.get('E_Close') ?? 0));
    for (const [k, v] of this.expr) if (k !== 'E_Close') out.set(k, Math.max(out.get(k) ?? 0, v));
    for (const m of rig.morphMeta) {
      const manual = this.manual?.get(m.name) ?? 0;
      rig.setMorph(m.name, manual !== 0 ? manual : clamp(out.get(m.name) ?? 0, 0, 1));
    }
  }

  // ------------------------------------------------------------ bones
  restoreBones() {
    // bones a clip drives get rewritten by the mixer; others would keep our last offset, so put them back
    for (const [b, w] of this.written) if (b.quaternion.equals(w.out)) b.quaternion.copy(w.base);
    this.written.clear();
  }
  rot(bone, axis, angle) {
    if (!bone || !angle) return;
    if (!this.written.has(bone)) this.written.set(bone, { base: bone.quaternion.clone(), out: new THREE.Quaternion() });
    const pw = bone.parent.getWorldQuaternion(_q1);
    const bw = bone.getWorldQuaternion(_q2);
    bw.premultiply(_q3.setFromAxisAngle(axis, angle));
    bone.quaternion.copy(pw.invert().multiply(bw));
    bone.updateWorldMatrix(false, true);
    this.written.get(bone).out.copy(bone.quaternion);
  }
  applyBones(dt) {
    const B = this.bones, P = this.pose, T = this.poseTarget;
    for (const k of ['tilt', 'nod', 'turn', 'lean']) P[k] = damp(P[k], T[k], k === 'lean' ? 6 : 8, dt);
    // where to look: your finger while touching, otherwise you (with an occasional glance away)
    const cam = this.viewer.camera.position;
    if (this.touch?.gaze) this.gaze.lerp(this.touch.gaze, 1 - Math.exp(-12 * dt));
    else if (this.hover && !this.touch && !this.phases.length) this.gaze.lerp(this.hover, 1 - Math.exp(-8 * dt));
    else {
      this.glance.next -= dt;
      if (this.glance.next < 0) {
        this.glance.next = rand(3, 7); this.glance.until = this.t + rand(0.6, 1.4);
        this.glance.off.set(rand(-0.5, 0.5), rand(-0.25, 0.3), 0);
      }
      _v1.copy(cam);
      if (this.t < this.glance.until && !this.phases.length) _v1.add(this.glance.off);
      this.gaze.lerp(_v1, 1 - Math.exp(-6 * dt));
    }
    const headC = this.toWorld(this.face.eyes, new THREE.Vector3());
    const fwd = _v2.copy(this.axes.F).applyQuaternion(B.head.getWorldQuaternion(_q1));
    const d = _v1.copy(this.gaze).sub(headC).normalize();
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const yawNeed = wrap(Math.atan2(d.x, d.z) - Math.atan2(fwd.x, fwd.z));
    const pitchNeed = Math.asin(clamp(d.y, -1, 1)) - Math.asin(clamp(fwd.y, -1, 1));
    // during one of the character's own gestures, let its head motion show instead of locking onto you
    const gw = this.body.cur && !this.body.cur.idle && !this.touch ? 0.35 : 1;
    this.gazeW = damp(this.gazeW ?? 1, gw, 3, dt);
    const yawT = clamp(yawNeed * 0.8, -0.75, 0.75) * this.gazeW + P.turn;
    const pitchT = clamp(pitchNeed * 0.75, -0.4, 0.35) * this.gazeW;
    const rate = this.touch ? 7 : 4;
    P.yaw = damp(P.yaw, yawT, rate, dt); P.pitch = damp(P.pitch, pitchT, rate, dt);
    // while held the head is pulled around but the eyes stay on you; in a reaction they look away with the head
    this.eyeYaw = clamp((yawNeed - P.yaw + (this.touch ? 0 : P.turn * 0.6)) / 0.45, -1, 1);
    this.eyePitch = clamp((pitchNeed - P.pitch) / 0.35, -1, 1);
    // small life: breathing and a slow sway
    const t = this.t;
    const breath = Math.sin(t * Math.PI * 2 / 3.8);
    const swayY = Math.sin(t * 0.41) * 0.018 + Math.sin(t * 0.23 + 1) * 0.012;
    const swayR = Math.sin(t * 0.33 + 2) * 0.014;
    const headNoiseY = Math.sin(t * 0.7) * 0.02 + Math.sin(t * 1.3 + 0.5) * 0.01;
    const headNoiseP = Math.sin(t * 0.9 + 1.7) * 0.015;
    const fwdW = new THREE.Vector3(0, 0, 1);
    const pitchAxis = new THREE.Vector3(1, 0, 0);
    // spine: lean, breathing, sway
    this.rot(B.spine, UP, swayY);
    this.rot(B.spine, fwdW, swayR);
    this.rot(B.spine1, pitchAxis, -P.lean * 0.5 + breath * 0.008);
    this.rot(B.chest, pitchAxis, -P.lean * 0.5 - breath * 0.012);
    this.rot(B.clavL, fwdW, breath * 0.012);
    this.rot(B.clavR, fwdW, -breath * 0.012);
    // look: spread over chest, neck and head
    const yaw = P.yaw + headNoiseY, pitch = -(P.pitch) + P.nod + headNoiseP;
    this.rot(B.chest, UP, yaw * 0.15);
    this.rot(B.neck, UP, yaw * 0.35);
    this.rot(B.neck, pitchAxis, pitch * 0.35);
    this.rot(B.head, UP, yaw * 0.5);
    this.rot(B.head, pitchAxis, pitch * 0.65);
    // tilt (roll) about the face's forward direction
    const faceFwd = _v2.copy(this.axes.F).applyQuaternion(B.head.getWorldQuaternion(_q1)).setY(0).normalize();
    this.rot(B.neck, faceFwd, P.tilt * 0.35);
    this.rot(B.head, faceFwd, P.tilt * 0.65);
    // a short, damped bounce after a touch on the chest: a small detail, a few degrees at most
    const J = this.jiggle;
    if (J) {
      J.t += dt;
      const env = Math.exp(-J.t * 5.5);
      if (env < 0.01) this.jiggle = null;
      else {
        const w = Math.sin(J.t * Math.PI * 2 * 3.2) * env, w2 = Math.sin(J.t * Math.PI * 2 * 2.3 + 0.8) * env;
        for (const [bone, k] of [[B.chestL, J.side < 0 ? 1 : 0.6], [B.chestR, J.side > 0 ? 1 : 0.6]]) {
          this.rot(bone, pitchAxis, w * 0.07 * k);
          this.rot(bone, UP, w2 * 0.025 * k * (bone === B.chestL ? -1 : 1));
        }
      }
    }
  }

  // ------------------------------------------------------------ shader effects
  applyShader(dt) {
    const cam = this.viewer.camera;
    cam.updateMatrixWorld();
    const view = cam.matrixWorldInverse;
    this.blush = damp(this.blush, Math.max(this.blushTarget, this.affection * 0.35), 3, dt);
    toonGlobals.uBlush.value = this.blush;
    toonGlobals.uBlushL.value.copy(this.toWorld(this.face.cheekL)).applyMatrix4(view);
    toonGlobals.uBlushR.value.copy(this.toWorld(this.face.cheekR)).applyMatrix4(view);
    toonGlobals.uBlushRadius.value = this.face.size * 0.16;
    const pk = this.poke;
    if (pk.kind >= 0) {
      if (pk.release) {
        // spring back with a little wobble
        // small fixed steps (semi-implicit) so slow phones with big frame times stay stable
        const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
        for (let i = 0; i < n; i++) {
          pk.vel.addScaledVector(pk.offset, -260 * h).multiplyScalar(Math.exp(-24 * h));
          pk.offset.addScaledVector(pk.vel, h);
        }
        if (pk.offset.lengthSq() < 1e-9 && pk.vel.lengthSq() < 1e-7) { pk.kind = -1; pk.release = false; }
      }
      toonGlobals.uPokeCenter.value.copy(this.toWorld(pk.local)).applyMatrix4(view);
      toonGlobals.uPokeOffset.value.copy(pk.offset);
      toonGlobals.uPokeRadius.value = pk.radius;
    }
    toonGlobals.uPokeKind.value = pk.kind;
  }

  // ------------------------------------------------------------ touch
  // NDC of a pointer event on the canvas
  ndc(e) {
    const r = this.viewer.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  // world point under the finger, on a plane between the face and the camera
  fingerPoint(e) {
    const cam = this.viewer.camera;
    this.raycaster.setFromCamera(this.ndc(e), cam);
    const headC = this.toWorld(this.face.eyes);
    const n = _v1.copy(cam.position).sub(headC).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, headC.clone().addScaledVector(n, cam.position.distanceTo(headC) * 0.45));
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? headC;
  }
  pixelToWorld(px) {
    // metres per pixel at the face's distance
    const cam = this.viewer.camera;
    const dist = cam.position.distanceTo(this.toWorld(this.face.eyes));
    return (px * 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / (this.viewer.canvas.clientHeight || innerHeight);
  }
  hitTest(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.viewer.camera);
    const meshes = this.rig.allSections().filter(({ model, section }) => model.visible && section.visible).map(({ section }) => section.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) {
      // a near miss above the head (thin strands, ahoge) still counts as a pat
      const c = this.toWorld(this.face.center);
      const p = this.raycaster.ray.intersectSphere(new THREE.Sphere(c, this.face.size * 0.9), new THREE.Vector3());
      if (p && this.toFace(p).y > this.face.eyeY) return { zone: 'head', point: p, fc: this.toFace(p), kind: 1 };
      return null;
    }
    const kind = hit.object.material.userData.kind;
    const fc = this.toFace(hit.point);
    const F = this.face;
    const inHead = fc.y > F.chinY - 0.012 && Math.abs(fc.x) < F.halfW * 1.7 && fc.y < F.top + 0.06 && fc.z > F.box.min.z - F.size;
    let zone;
    if (inHead && (kind === 2 || kind === 3)) {
      if (fc.y > F.eyeBox.max.y + 0.004) zone = 'forehead';
      else if (fc.y > F.eyeBox.min.y - 0.002 && Math.abs(fc.x) < F.eyeHalfW * 1.1) zone = 'eye';
      else if (Math.abs(fc.x) > F.eyeHalfW * 0.3) zone = fc.x > 0 ? 'cheekR' : 'cheekL';
      else zone = 'mouth';
    } else if (inHead && fc.y > F.eyeY - 0.01) zone = 'head';
    else if (inHead) zone = 'hair';
    else zone = this.bodyZone(hit.point);
    return { zone, point: hit.point.clone(), fc, kind };
  }
  bodyZone(p) {
    const near = (names) => Math.min(...names.map((n) => this.rig.findBone(n)).filter(Boolean).map((b) => b.getWorldPosition(_v1).distanceTo(p)));
    const d = {
      hand: near(['Bip001LHand', 'Bip001RHand', 'Bip001LForearm', 'Bip001RForearm', 'Bip001LFinger1', 'Bip001RFinger1']),
      arm: near(['Bip001LUpperArm', 'Bip001RUpperArm']),
      shoulder: near(['Bip001LClavicle', 'Bip001RClavicle', 'Bip001Neck']),
      chest: near(['Bip001Spine2']),
      belly: near(['Bip001Spine1', 'Bip001Spine']),
      hips: near(['Bip001Pelvis', 'Bip001LThigh', 'Bip001RThigh']),
    };
    // the chest bone sits deep inside the body: favour it in front of the ribcage
    const chestY = this.bones.chest?.getWorldPosition(_v2).y ?? 0, spineY = this.bones.spine?.getWorldPosition(_v2).y ?? 0;
    if (d.hand > 0.09 && d.arm > 0.08 && p.y < chestY + 0.06 && p.y > (chestY + spineY) / 2) d.chest *= 0.6;
    return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
  }

  pointerDown(e) {
    if (!this.active) return;
    // a finger whose "up" never arrived (system gesture, second finger) must not block new touches
    if (this.touch) { if (this.touch.id === e.pointerId) return; this.pointerUp({ pointerId: this.touch.id }); }
    const hit = this.hitTest(e);
    const now = performance.now();
    this.touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, zone: hit?.zone ?? null, hit, moved: 0, gaze: this.fingerPoint(e), holding: false, strokes: 0, dir: 0 };
    const z = this.touch.zone;
    if (z === 'cheekL' || z === 'cheekR') {
      // grab the cheek: the poke centre rides on the face, the offset follows the finger
      const pk = this.poke;
      pk.kind = 2; pk.release = false; pk.vel.set(0, 0, 0); pk.offset.set(0, 0, 0);
      pk.local = hit.fc.clone();
      pk.radius = this.face.size * 0.15;
      // even without dragging, the grabbed cheek puffs out sideways and toward you
      const side = z === 'cheekR' ? 1 : -1;
      pk.grab = _v1.copy(this.axes.R).multiplyScalar(side).applyQuaternion(this.head.getWorldQuaternion(_q1)).transformDirection(this.viewer.camera.matrixWorldInverse).multiplyScalar(pk.radius * 0.12).clone();
      pk.grab.z = pk.radius * 0.06;
      pk.offset.copy(pk.grab);
      this.touch.holding = true;
      this.touch.gaze = null; // looks at you while being pinched
    } else if (z === 'head' || z === 'hair' || z === 'forehead') {
      this.touch.holding = true;
      this.startPat(hit);
    }
  }
  pointerMove(e) {
    if (!this.active) return;
    const T = this.touch;
    if (!T) { if (e.pointerType === 'mouse') this.hover = this.fingerPoint(e); return; }
    if (e.pointerId !== T.id) return;
    const dx = e.clientX - T.x, dy = e.clientY - T.y;
    T.moved += Math.hypot(dx, dy);
    T.x = e.clientX; T.y = e.clientY;
    if (T.gaze) T.gaze = this.fingerPoint(e);
    if (T.zone === 'cheekL' || T.zone === 'cheekR') {
      // stretch: drag in screen space, pull a little toward the camera, never more than the poke radius
      const pk = this.poke;
      const m = this.pixelToWorld(1);
      const sx = (T.x - T.x0) * m, sy = -(T.y - T.y0) * m;
      // skin resists more the further it goes: soft limit at ~a third of the radius (a few millimetres)
      const len = Math.hypot(sx, sy), max = pk.radius * 0.38;
      const k = len > 1e-6 ? (max * Math.tanh(len * 0.6 / max)) / len : 0;
      pk.offset.set(sx * k, sy * k, 0).add(pk.grab).setZ(pk.grab.z + len * k * 0.25);
    } else if (T.pat) {
      // stroking: count direction changes, lean the head with the hand
      const dir = Math.sign(dx);
      if (dir && T.dir && dir !== T.dir && Math.abs(dx) > 1) T.strokes++;
      if (dir) T.dir = dir;
      T.patV = clamp((T.patV ?? 0) + Math.hypot(dx, dy) * 0.004, 0, 1);
      T.patX = clamp((T.x - T.x0) * this.pixelToWorld(1) / (this.face.size * 1.2), -1, 1);
      this.movePat(e);
    }
  }
  pointerUp(e) {
    const T = this.touch;
    if (!T || e.pointerId !== T.id) return;
    this.touch = null;
    const dur = (performance.now() - T.t0) / 1000;
    const tap = T.moved < 12 && dur < 0.35;
    const z = T.zone;
    if (z === 'cheekL' || z === 'cheekR') {
      this.poke.release = true;
      if (tap) this.onCheekPoke(z);
      else this.onPinchRelease(dur);
    } else if (T.pat) {
      this.endPat(T, tap, dur);
    } else if (z) this.onTouch(z, T, tap);
  }

  // head pats --------------------------------------------------
  startPat(hit) {
    const T = this.touch;
    T.pat = true; T.patV = 0.35; T.patX = 0; T.patTime = 0;
    T.gaze = null;
    const pk = this.poke;
    pk.kind = 1; pk.release = false; pk.vel.set(0, 0, 0); pk.offset.set(0, 0, 0);
    pk.local = hit.fc.clone();
    pk.radius = this.face.size * 0.3;
    this.phases = []; this.phasePriority = 0;
    this.setExpr(this.annoy > 0.7 ? 'pout' : 'happy', 0.6);
  }
  movePat(e) {
    // keep the hand on the head: intersect the finger ray with a sphere around the head
    this.raycaster.setFromCamera(this.ndc(e), this.viewer.camera);
    const c = this.toWorld(this.face.center);
    const s = new THREE.Sphere(c, this.face.size * 0.95);
    const p = this.raycaster.ray.intersectSphere(s, new THREE.Vector3());
    if (p) this.poke.local = this.toFace(p);
  }
  stepTouch(dt) {
    const T = this.touch;
    if (!T) return;
    const held = (performance.now() - T.t0) / 1000;
    if (T.pat) {
      T.patTime += dt;
      T.patV = Math.max(0.25, T.patV - dt * 0.6);
      const joy = clamp(0.45 + T.patTime * 0.35, 0, 1);
      this.affection = Math.min(1, this.affection + dt * 0.08 * T.patV);
      this.annoy = Math.max(0, this.annoy - dt * 0.15);
      this.setExpr(this.annoy > 0.7 ? 'pout' : T.patTime > 2.5 ? 'bliss' : 'happy', joy);
      // pressed down by the hand, tilting into it
      this.poseTarget.nod = 0.035 + 0.025 * T.patV;
      this.poseTarget.tilt = -T.patX * 0.08 + Math.sin(this.t * 5) * 0.01 * T.patV;
      this.poseTarget.turn = 0; this.poseTarget.lean = 0;
      this.blushTarget = clamp(0.25 + T.patTime * 0.12, 0, 0.75);
      const press = this.face.size * (0.012 + 0.014 * T.patV); // just the hair giving a little, not the skull
      // push the hair down along the head's "up", in view space
      const up = _v1.copy(this.axes.U).applyQuaternion(this.head.getWorldQuaternion(_q1)).transformDirection(this.viewer.camera.matrixWorldInverse);
      this.poke.offset.copy(up).multiplyScalar(-press);
      if (T.patTime > 1.2 && !T.hearted) { T.hearted = true; this.emote('heart'); }
      if (T.strokes >= 6 && !T.gestured) { T.gestured = true; this.playGesture('shy', 1.5); }
    } else if (T.zone === 'cheekL' || T.zone === 'cheekR') {
      const mad = this.annoy > 0.6 || held > 2.5;
      this.setExpr(mad ? 'pinchedMad' : 'pinched', 1);
      const s = T.zone === 'cheekR' ? 1 : -1;
      // the head goes along with the pull a little
      this.poseTarget.turn = clamp(this.poke.offset.x * 4, -0.06, 0.06);
      this.poseTarget.tilt = -clamp(this.poke.offset.x * 4, -0.1, 0.1) + s * 0.02;
      this.poseTarget.nod = clamp(-this.poke.offset.y * 4, -0.08, 0.08);
      this.blushTarget = 0.5;
      this.annoy = Math.min(1, this.annoy + dt * 0.12);
      if (held > 2.5 && !T.madEmote) { T.madEmote = true; this.emote('mad'); }
    }
  }
  endPat(T, tap, dur) {
    this.poke.release = true;
    if (tap) {
      this.react([{ d: 0.9, expr: 'happy', w: 0.8, pose: { nod: 0.06 }, blush: 0.3 }, { d: 1.2, expr: 'smile', blush: 0.15 }, { d: 0.1 }]);
      this.affection = Math.min(1, this.affection + 0.05);
      return;
    }
    const long = dur > 2;
    this.react([
      { d: 0.8, expr: long ? 'bliss' : 'happy', w: 0.8, pose: { nod: 0.03 }, blush: long ? 0.6 : 0.35, emote: long ? 'heart' : null, gesture: long && !T.gestured ? 'shy' : null, hold: 1.2 },
      { d: 2.2, expr: 'smile', blush: long ? 0.4 : 0.15 },
      { d: 0.1 },
    ]);
  }

  // cheeks -----------------------------------------------------
  onCheekPoke(z) {
    const pk = this.poke;
    // push in and spring out
    pk.kind = 2; pk.release = true;
    pk.vel.set(0, 0, -this.face.size * 0.6);
    this.annoy = Math.min(1, this.annoy + 0.12);
    const s = z === 'cheekR' ? 1 : -1;
    this.react([
      { d: 0.35, expr: 'squint', w: 0.7, pose: { tilt: -s * 0.06, turn: -s * 0.05 } },
      { d: 1.4, expr: this.annoy > 0.5 ? 'pout' : 'curious', blush: 0.25, emote: this.annoy > 0.5 ? 'dots' : 'huh', gesture: Math.random() < 0.5 ? 'touched' : null, hold: 0.8 },
      { d: 0.1 },
    ], { priority: 2 });
  }
  onPinchRelease(dur) {
    this.annoy = Math.min(1, this.annoy + 0.25);
    const mad = this.annoy > 0.6;
    this.react([
      { d: 0.25, expr: 'surprised', w: 0.6 },
      { d: mad ? 2.4 : 1.6, expr: mad ? 'angry' : 'pout', blush: 0.4, pose: { turn: mad ? 0.35 : 0.12, tilt: -0.05, nod: 0.03 }, emote: mad ? 'mad' : null, gesture: mad ? 'complain' : 'touched', hold: 0.8 },
      { d: 1, expr: 'pout', w: 0.5, blush: 0.2 },
      { d: 0.1 },
    ], { priority: 2 });
  }

  // other touches ------------------------------------------------
  onTouch(z, T, tap) {
    const now = this.t;
    if (now - this.lastReact < 0.25) return;
    this.lastReact = now;
    const s = (T.hit?.fc?.x ?? 0) > 0 ? 1 : -1;
    switch (z) {
      case 'eye':
        this.annoy = Math.min(1, this.annoy + 0.25);
        this.react([{ d: 0.6, expr: 'squint', pose: { nod: 0.08, lean: 0.05 } }, { d: 1.6, expr: 'angry', w: 0.7, emote: 'mad', blush: 0.15, gesture: 'endure', hold: 0.8 }, { d: 0.1 }], { priority: 2 });
        break;
      case 'mouth':
        this.react([{ d: 0.3, expr: 'squint', w: 0.6, pose: { lean: 0.06, nod: -0.04 } }, { d: 0.6, expr: 'surprised', w: 0.8, emote: 'bang' }, { d: 1.6, expr: this.annoy > 0.5 ? 'pout' : 'laugh', w: 0.7, blush: 0.3, gesture: 'hush', hold: 0.8 }, { d: 0.1 }], { priority: 2 });
        break;
      case 'chest':
      case 'hips': {
        if (z === 'chest' && (this.bones.chestL || this.bones.chestR)) {
          const near = (b) => b ? b.getWorldPosition(_v1).distanceTo(T.hit.point) : Infinity;
          if (Math.min(near(this.bones.chestL), near(this.bones.chestR)) < this.face.size * 1.2) this.jiggle = { t: 0, side: near(this.bones.chestL) < near(this.bones.chestR) ? -1 : 1 };
        }
        this.annoy = Math.min(1, this.annoy + 0.35);
        const mad = this.annoy > 0.55;
        this.react([
          { d: 0.45, expr: 'surprised', pose: { lean: 0.12, nod: -0.05 }, blush: 0.9, emote: 'bang', gesture: mad ? 'complain' : 'scared', hold: 1 },
          { d: mad ? 2.6 : 2, expr: mad ? 'angry' : 'flustered', blush: 1, pose: { turn: mad ? 0.45 * s : 0.2 * s, lean: 0.06 }, emote: mad ? 'mad' : null },
          { d: 1.4, expr: 'pout', w: 0.6, blush: 0.5 },
          { d: 0.1 },
        ], { priority: 3 });
        break;
      }
      case 'belly':
        this.annoy = Math.max(0, this.annoy - 0.05);
        this.react([{ d: 0.3, expr: 'surprised', w: 0.6, pose: { lean: 0.08 } }, { d: 1.8, expr: 'laugh', blush: 0.45, pose: { lean: -0.04, tilt: 0.08 * s }, emote: 'note', gesture: 'happy', hold: 0.6 }, { d: 0.8, expr: 'smile' }, { d: 0.1 }], { priority: 2 });
        break;
      case 'hand':
      case 'arm':
        this.affection = Math.min(1, this.affection + 0.04);
        this.react([{ d: 0.4, expr: 'curious', pose: { tilt: 0.06 * s } }, { d: 1.8, expr: 'fond', blush: 0.25, emote: 'heart', gesture: 'pleased', hold: 1 }, { d: 0.1 }]);
        break;
      case 'shoulder':
        this.react([{ d: 0.3, expr: 'surprised', w: 0.5, pose: { turn: 0.3 * s } }, { d: 1.6, expr: 'curious', pose: { turn: 0.15 * s, tilt: 0.08 * s }, emote: 'huh', gesture: 'think', hold: 1 }, { d: 0.6, expr: 'smile' }, { d: 0.1 }]);
        break;
      default: break;
    }
  }

  // on entering: a little hello
  say(kind) {
    if (kind === 'greet' && this.gesture('greet')) this.react([{ d: 2.2, expr: 'fond', gesture: 'greet', blush: 0.15 }, { d: 0.1 }]);
    else this.react([{ d: 1.8, expr: 'smile', blush: 0.1 }, { d: 0.1 }]);
  }

  // floating emote next to the head
  emote(name) {
    const layer = this.emoteLayer; if (!layer) return;
    // beside the head at brow height, kept well inside the screen
    const F = this.face;
    const p = this.toWorld(new THREE.Vector3(F.halfW * 1.25, (F.eyeY + F.top) / 2, F.center.z)).project(this.viewer.camera);
    const r = this.viewer.canvas.getBoundingClientRect();
    p.x = clamp(p.x, -0.75, 0.75); p.y = clamp(p.y, -0.6, 0.62);
    const el = document.createElement('div');
    el.className = 'emote emote-' + name;
    el.textContent = EMOTE[name] ?? name;
    el.style.left = `${r.left + ((p.x + 1) / 2) * r.width + rand(-10, 10)}px`;
    el.style.top = `${r.top + ((1 - p.y) / 2) * r.height}px`;
    layer.append(el);
    setTimeout(() => el.remove(), 1600);
  }
}
