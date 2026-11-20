// Pose tool (FK rotation gizmo, two-bone IK for hands/feet, hip move), pose import/export,
// and simple spring physics so hair, skirts and ribbons trail the movement.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/TransformControls.js';

export const BODY_PARTS = [
  { label: 'Cabeza', bone: 'Bip001Head' }, { label: 'Cuello', bone: 'Bip001Neck' },
  { label: 'Pecho', bone: 'Bip001Spine2' }, { label: 'Torso', bone: 'Bip001Spine1' }, { label: 'Cintura', bone: 'Bip001Spine' },
  { label: 'Cadera', bone: 'Bip001Pelvis' }, { label: 'Centro (mover)', bone: 'Bip001', move: true },
  { label: 'Hombro I', bone: 'Bip001LClavicle' }, { label: 'Hombro D', bone: 'Bip001RClavicle' },
  { label: 'Brazo I', bone: 'Bip001LUpperArm' }, { label: 'Brazo D', bone: 'Bip001RUpperArm' },
  { label: 'Codo I', bone: 'Bip001LForearm' }, { label: 'Codo D', bone: 'Bip001RForearm' },
  { label: 'Mano I', bone: 'Bip001LHand', ik: ['Bip001LUpperArm', 'Bip001LForearm'] },
  { label: 'Mano D', bone: 'Bip001RHand', ik: ['Bip001RUpperArm', 'Bip001RForearm'] },
  { label: 'Muslo I', bone: 'Bip001LThigh' }, { label: 'Muslo D', bone: 'Bip001RThigh' },
  { label: 'Rodilla I', bone: 'Bip001LCalf' }, { label: 'Rodilla D', bone: 'Bip001RCalf' },
  { label: 'Pie I', bone: 'Bip001LFoot', ik: ['Bip001LThigh', 'Bip001LCalf'] },
  { label: 'Pie D', bone: 'Bip001RFoot', ik: ['Bip001RThigh', 'Bip001RCalf'] },
  { label: 'Punta pie I', bone: 'Bip001LToe0' }, { label: 'Punta pie D', bone: 'Bip001RToe0' },
];
export const FINGER_PARTS = ['L', 'R'].flatMap((s) => [0, 1, 2, 3, 4].flatMap((f) => [
  { label: `${['Pulgar', 'Índice', 'Corazón', 'Anular', 'Meñique'][f]} ${s === 'L' ? 'I' : 'D'} ${1}`, bone: `Bip001${s}Finger${f}` },
  { label: `${['Pulgar', 'Índice', 'Corazón', 'Anular', 'Meñique'][f]} ${s === 'L' ? 'I' : 'D'} ${2}`, bone: `Bip001${s}Finger${f}1` },
  { label: `${['Pulgar', 'Índice', 'Corazón', 'Anular', 'Meñique'][f]} ${s === 'L' ? 'I' : 'D'} ${3}`, bone: `Bip001${s}Finger${f}2` },
]));

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class PoseTool {
  constructor(viewer, onChange) {
    this.viewer = viewer;
    this.onChange = onChange;
    this.active = false;
    this.rig = null;
    this.selected = null; // { bone, part }
    this.mode = 'rotate';
    this.space = 'local';
    this.gizmo = new TransformControls(viewer.camera, viewer.canvas);
    this.gizmo.setSize(0.8);
    this.gizmoHelper = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    viewer.scene.add(this.gizmoHelper);
    this.gizmo.enabled = false;
    this.gizmoHelper.visible = false;
    this.ikTarget = new THREE.Object3D();
    viewer.scene.add(this.ikTarget);
    this.undo = [];
    this.gizmo.addEventListener('dragging-changed', (e) => {
      viewer.controls.enabled = !e.value;
      if (e.value) this.pushUndo();
    });
    this.gizmo.addEventListener('objectChange', () => {
      if (this.selected?.ik && this.mode === 'move') this.solveIK();
      this.onChange?.();
    });
    this.markers = new THREE.Group();
    this.markers.visible = false;
    viewer.scene.add(this.markers);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0x7fd1c7, depthTest: false, transparent: true, opacity: 0.85 });
    this.markerSelMat = new THREE.MeshBasicMaterial({ color: 0xf0b860, depthTest: false, transparent: true, opacity: 0.95 });
  }

  setRig(rig) {
    this.rig = rig; this.deselect(); this.undo = [];
    this.markers.clear();
    if (!rig) return;
    const geo = new THREE.SphereGeometry(0.011, 10, 8);
    for (const p of BODY_PARTS) {
      const b = rig.findBone(p.bone); if (!b) continue;
      const m = new THREE.Mesh(geo, this.markerMat);
      m.renderOrder = 10; m.userData.part = p; m.userData.bone = b;
      this.markers.add(m);
    }
  }

  setActive(on) {
    this.active = on;
    this.markers.visible = on;
    if (!on) this.deselect();
  }

  updateMarkers() {
    if (!this.markers.visible) return;
    for (const m of this.markers.children) {
      m.userData.bone.getWorldPosition(m.position);
      m.material = this.selected?.bone === m.userData.bone ? this.markerSelMat : this.markerMat;
    }
    if (this.selected?.ik && this.mode !== 'move') this.selected.bone.getWorldPosition(this.ikTarget.position);
  }

  pick(raycaster) {
    if (!this.markers.visible) return false;
    const hits = raycaster.intersectObjects(this.markers.children, false);
    if (!hits.length) return false;
    this.select(hits[0].object.userData.bone, hits[0].object.userData.part);
    return true;
  }

  select(bone, part = null) {
    if (!bone) return;
    this.selected = { bone, part, ik: part?.ik ?? null, move: !!part?.move };
    this.attach();
    this.onChange?.('select');
  }
  deselect() { this.selected = null; this.gizmo.detach(); this.gizmo.enabled = false; this.gizmoHelper.visible = false; }

  setMode(mode) { this.mode = mode; this.attach(); }
  setSpace(space) { this.space = space; this.gizmo.setSpace(space); }

  attach() {
    const s = this.selected; if (!s) return;
    this.gizmo.enabled = true; this.gizmoHelper.visible = true;
    if (this.mode === 'move' && s.ik) {
      s.bone.getWorldPosition(this.ikTarget.position);
      this.gizmo.attach(this.ikTarget); this.gizmo.setMode('translate'); this.gizmo.setSpace('world');
    } else if (this.mode === 'move' && s.move) {
      this.gizmo.attach(s.bone); this.gizmo.setMode('translate'); this.gizmo.setSpace('world');
    } else {
      this.gizmo.attach(s.bone); this.gizmo.setMode('rotate'); this.gizmo.setSpace(this.space);
    }
  }

  // Analytic two-bone IK: rotates upper and mid bones so the end bone reaches the target.
  solveIK() {
    const s = this.selected; if (!s?.ik || !this.rig) return;
    const upper = this.rig.findBone(s.ik[0]), mid = this.rig.findBone(s.ik[1]), end = s.bone;
    if (!upper || !mid) return;
    upper.updateWorldMatrix(true, true);
    const a = upper.getWorldPosition(new THREE.Vector3());
    const b = mid.getWorldPosition(new THREE.Vector3());
    const c = end.getWorldPosition(new THREE.Vector3());
    const t = this.ikTarget.position.clone();
    const lab = a.distanceTo(b), lcb = b.distanceTo(c);
    const lat = THREE.MathUtils.clamp(a.distanceTo(t), 0.001, lab + lcb - 0.0001);
    // bend plane normal from current pose
    const bend = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, b));
    if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0);
    bend.normalize();
    // current and desired angles
    const ac = new THREE.Vector3().subVectors(c, a);
    const ab = new THREE.Vector3().subVectors(b, a);
    const ba = ab.clone().negate(), bc = new THREE.Vector3().subVectors(c, b);
    const ac_ab_0 = Math.acos(THREE.MathUtils.clamp(ac.clone().normalize().dot(ab.clone().normalize()), -1, 1));
    const ba_bc_0 = Math.acos(THREE.MathUtils.clamp(ba.clone().normalize().dot(bc.clone().normalize()), -1, 1));
    const ac_ab_1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
    const ba_bc_1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
    const at = new THREE.Vector3().subVectors(t, a);
    const axis0 = ac.clone().cross(ab).normalize();
    if (axis0.lengthSq() < 1e-8) axis0.copy(bend);
    const axis1 = ac.clone().cross(at).normalize();
    const rot = (bone, axisWorld, angle) => {
      if (!isFinite(angle) || Math.abs(angle) < 1e-6) return;
      const pw = bone.parent.getWorldQuaternion(_q1);
      const bw = bone.getWorldQuaternion(_q2);
      const dq = new THREE.Quaternion().setFromAxisAngle(axisWorld, angle);
      const nw = dq.multiply(bw);
      bone.quaternion.copy(pw.invert().multiply(nw));
      bone.updateWorldMatrix(false, true);
    };
    rot(upper, axis0, ac_ab_1 - ac_ab_0);
    rot(mid, axis0, ba_bc_1 - ba_bc_0);
    if (axis1.lengthSq() > 1e-8) {
      const ac2 = new THREE.Vector3().subVectors(end.getWorldPosition(_v1), upper.getWorldPosition(_v2));
      const ang = ac2.angleTo(at);
      const ax = ac2.clone().cross(at).normalize();
      if (ax.lengthSq() > 1e-8) rot(upper, ax, ang);
    }
  }

  pushUndo() {
    if (!this.rig) return;
    this.undo.push(this.capture());
    if (this.undo.length > 40) this.undo.shift();
  }
  popUndo() { const p = this.undo.pop(); if (p) this.apply(p); }

  capture() {
    const bones = {};
    for (const b of this.rig.bones) {
      const n = b.userData.name;
      bones[n] = { q: b.quaternion.toArray().map((x) => +x.toFixed(6)), p: b.position.toArray().map((x) => +x.toFixed(4)) };
    }
    return { format: 'wuwa-viewer-pose', version: 1, character: this.rig.label, bones };
  }
  apply(pose) {
    const unknown = [];
    for (const [n, v] of Object.entries(pose.bones ?? {})) {
      const b = this.rig.findBone(n);
      if (!b) { unknown.push(n); continue; }
      if (v.q) b.quaternion.fromArray(v.q);
      if (v.p) b.position.fromArray(v.p);
    }
    this.rig.group.updateMatrixWorld(true);
    this.onChange?.();
    return unknown;
  }
  resetBone() {
    const b = this.selected?.bone; if (!b) return;
    this.pushUndo();
    const d = b.userData.bind; b.quaternion.copy(d.q); b.position.copy(d.p);
    this.onChange?.();
  }
  mirror() {
    // copy the selected side's rotation to the other side (mirrored across the character's sagittal plane)
    const b = this.selected?.bone; if (!b) return;
    const n = b.userData.name;
    const other = n.includes('L') && /Bip001L|_L_|_L$/.test(n) ? n.replace(/Bip001L/, 'Bip001R').replace(/_L_/, '_R_').replace(/_L$/, '_R')
      : n.replace(/Bip001R/, 'Bip001L').replace(/_R_/, '_L_').replace(/_R$/, '_L');
    const o = this.rig.findBone(other); if (!o || o === b) return;
    this.pushUndo();
    // Bip skeletons mirror local rotations by negating x/y in the bone's local frame
    const bd = b.userData.bind.q, od = o.userData.bind.q;
    const delta = bd.clone().invert().multiply(b.quaternion);
    const md = new THREE.Quaternion(-delta.x, -delta.y, delta.z, delta.w);
    o.quaternion.copy(od).multiply(md);
    this.onChange?.();
  }
}

// ---------- spring bones ----------
export class SpringBones {
  constructor() {
    this.enabled = false;
    this.stiffness = 0.12;
    this.damping = 0.18;
    this.gravity = 0.4;
    this.chains = [];
    this.rig = null;
  }
  setRig(rig) {
    this.rig = rig;
    this.chains = [];
    if (!rig) return;
    const dyn = (b) => /^(Bone_(Hair|Piao|Skirt|Other|Chest|Tail|Prop)|Hair|Skirt|Ribbon)/i.test(b.userData.name ?? '');
    for (const b of rig.bones) {
      if (!dyn(b) || !(b.parent?.isBone)) continue;
      const child = b.children.find((c) => c.isBone);
      const tailLocal = child ? child.position.clone() : (b.position.lengthSq() > 1e-6 ? b.position.clone().normalize().multiplyScalar(Math.max(b.position.length() * 0.8, 2)) : new THREE.Vector3(3, 0, 0));
      this.chains.push({ bone: b, tailLocal, p: null, pp: null, len: 0, depth: depthOf(b) });
    }
    this.chains.sort((a, b) => a.depth - b.depth);
  }
  reset() { for (const c of this.chains) c.p = null; }
  update(dt) {
    if (!this.enabled || !this.rig || !dt) return;
    const g = new THREE.Vector3(0, -this.gravity * 9.8, 0);
    for (const c of this.chains) {
      const b = c.bone;
      b.updateWorldMatrix(true, false);
      const head = b.getWorldPosition(_v1);
      const target = _v2.copy(c.tailLocal).applyMatrix4(b.matrixWorld);
      if (!c.p) { c.p = target.clone(); c.pp = target.clone(); c.len = head.distanceTo(target); continue; }
      const vel = _v3.subVectors(c.p, c.pp).multiplyScalar(1 - this.damping);
      c.pp.copy(c.p);
      c.p.add(vel).addScaledVector(g, dt * dt).lerp(target, this.stiffness);
      const dir = new THREE.Vector3().subVectors(c.p, head);
      const l = dir.length() || 1;
      c.p.copy(head).addScaledVector(dir, c.len / l);
      // rotate the bone from its animated direction to the simulated one
      const from = new THREE.Vector3().subVectors(target, head).normalize();
      const to = new THREE.Vector3().subVectors(c.p, head).normalize();
      const dq = new THREE.Quaternion().setFromUnitVectors(from, to);
      const pw = b.parent.getWorldQuaternion(_q1);
      const bw = b.getWorldQuaternion(_q2);
      b.quaternion.copy(pw.invert().multiply(dq.multiply(bw)));
      b.updateWorldMatrix(false, false);
    }
  }
}
function depthOf(o) { let d = 0; while (o.parent) { d++; o = o.parent; } return d; }
