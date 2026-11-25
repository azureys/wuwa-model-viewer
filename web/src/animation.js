// Converts UEFormat animations into three.js clips for a Rig, including facial curves → morph targets.
import * as THREE from 'three';
import { parseUEAnim } from './ueformat.js';

const animCache = new Map();
export async function loadAnim(src, path) {
  const key = src.base + '|' + path;
  if (!animCache.has(key)) animCache.set(key, src.buffer(path).then(parseUEAnim));
  return animCache.get(key);
}

// opts.inPlace: drop the horizontal motion of the root so the character stays centred
export function buildClip(rig, anim, { inPlace = false, name, filter = null } = {}) {
  const fps = anim.fps || 30;
  const tracks = [];
  const dur = Math.max(anim.numFrames - 1, 1) / fps;
  for (const t of anim.tracks) {
    const bone = rig.findBone(t.name);
    if (!bone) continue;
    if (filter && !filter(t)) continue;
    const bn = bone.name;
    if (t.pos.length) {
      const times = t.pos.map((k) => k.frame / fps);
      const vals = [];
      for (const k of t.pos) vals.push(k.v[0], k.v[1], k.v[2]);
      if (inPlace && (t.name === 'Root')) {
        for (let i = 0; i < vals.length; i += 3) { vals[i] = 0; vals[i + 1] = 0; }
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${bn}.position`, times, vals));
    }
    if (t.rot.length) {
      const times = t.rot.map((k) => k.frame / fps);
      const vals = [];
      let prev = null;
      for (const k of t.rot) {
        const q = k.v.slice();
        if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) { q[0] = -q[0]; q[1] = -q[1]; q[2] = -q[2]; q[3] = -q[3]; }
        vals.push(q[0], q[1], q[2], q[3]); prev = q;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bn}.quaternion`, times, vals));
    }
    if (t.scale.length) {
      const times = t.scale.map((k) => k.frame / fps);
      const vals = [];
      for (const k of t.scale) vals.push(k.v[0], k.v[1], k.v[2]);
      tracks.push(new THREE.VectorKeyframeTrack(`${bn}.scale`, times, vals));
    }
  }
  // Facial / ribbon curves → morph target weights (sampled per frame by the player)
  const curves = [];
  for (const c of anim.curves) {
    let target = rig.morphIndex.has(c.name) ? c.name : null;
    if (!target && c.name.startsWith('Mor_') && rig.morphIndex.has(c.name.slice(4))) target = c.name.slice(4);
    if (!target || !c.keys.length) continue;
    // Morph weights live in 0..1, but the "Mor_" corrective curves (shoulders, chest…) are authored in
    // percent (0..100): Iuno's shoulder sat at weight ~6 instead of 0.06 and blew up.
    const scale = c.name.startsWith('Mor_') ? 0.01 : 1;
    curves.push({ morph: target, times: c.keys.map((k) => k.frame / fps), values: c.keys.map((k) => Math.min(1, Math.max(0, k.value * scale))) });
  }
  const clip = new THREE.AnimationClip(name ?? anim.name, dur, tracks);
  clip.userData = { curves, additive: anim.additive, fps, frames: anim.numFrames };
  return clip;
}

export function sampleCurve(c, t) {
  const { times, values } = c;
  if (t <= times[0]) return values[0];
  const n = times.length;
  if (t >= times[n - 1]) return values[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const a = (t - times[lo]) / (times[hi] - times[lo] || 1);
  return values[lo] + (values[hi] - values[lo]) * a;
}

// Labels for the animation list, grouped by folder.
const FIGHT_RE = /^AM_|^(Attack|AirAttack|Skill|Burst|Execute|Hattack|QTE|Rogue|Jump|Move)/i;
// Combat / movement animation (also its baked ribbon twin "Rib_Attack01"); used to free space.
export function isFightAnim(path) {
  if (!/\.ueanim$/i.test(path)) return false;
  const name = path.split('/').pop().replace(/\.ueanim$/i, '').replace(/^Rib_/i, '').replace(/_?Rib\d*$/i, '');
  return FIGHT_RE.test(name);
}
export function describeAnims(paths, roleDir) {
  const groups = new Map();
  for (const p of paths) {
    let rel = roleDir && p.startsWith(roleDir + '/') ? p.slice(roleDir.length + 1) : p.replace(/^.*\/(SequenceAnim\/)/, 'Sequence/');
    rel = rel.replace(/\.ueanim$/i, '');
    const parts = rel.split('/');
    const label = parts.pop();
    let group = parts.join('/') || 'General';
    group = group.replace(/^[^/]*Md\d+\/RibbonAnim\d*/i, 'Ribbons').replace(/^CommonAnim\/UiAnim/i, 'Menu (UI)').replace(/^CommonAnim$/i, 'Common');
    const isFight = FIGHT_RE.test(label);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ path: p, label, fight: isFight, ribbon: /RibbonAnim/i.test(p) });
  }
  return [...groups].map(([label, items]) => ({ label, items: items.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Ribbon animations ("Rib_Stand1") pair with body animations of the same name.
export function ribbonFor(path, all) {
  const base = path.split('/').pop().replace(/\.ueanim$/i, '').toLowerCase();
  return all.find((p) => /RibbonAnim/i.test(p) && p.split('/').pop().replace(/\.ueanim$/i, '').replace(/^Rib_/i, '').replace(/_?Rib\d*$/i, '').toLowerCase() === base) ?? null;
}

// Ribbon clips are baked cloth simulations: keep only the animated secondary bones.
export const ribbonTrackFilter = (t) => !/^(Root|Bip001.*|WeaponProp\d+|HuluProp\d+)$/.test(t.name) && (t.rot.length > 1 || t.pos.length > 1);

export function removeTracksFor(clip, otherClip) {
  const names = new Set(otherClip.tracks.map((t) => t.name));
  clip.tracks = clip.tracks.filter((t) => !names.has(t.name));
}
