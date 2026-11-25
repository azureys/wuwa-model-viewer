// Builds three.js rigs (skeleton + per-section skinned meshes + outlines) from UEFormat models.
import * as THREE from 'three';
import { parseUEModel, parseMaterialJson, gamePath } from './ueformat.js';
import { makeToonMaterial, makeOutlineMaterial } from './toon.js';
import { decodePng, shrinkToFit } from './png.js';

const textureCache = new Map();
// jsDecode: decode PNGs in JS (Safari/iPhone, whose image decoder premultiplies alpha)
export const textureSettings = { maxSize: 2048, jsDecode: false };

const WHITE = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();

export async function loadTexture(src, path, srgb = true) {
  const key = `${src.base}|${path}|${srgb}|${textureSettings.maxSize}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const p = (async () => {
    try {
      const blob = await src.blob(path);
      if (textureSettings.jsDecode) {
        const img = await decodePng(await blob.arrayBuffer());
        if (img) {
          const { width, height, data } = shrinkToFit(img, textureSettings.maxSize);
          const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
          tex.flipY = false;
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.generateMipmaps = true;
          tex.anisotropy = 4;
          tex.needsUpdate = true;
          return tex;
        }
      }
      let bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const max = textureSettings.maxSize;
      if (bmp.width > max || bmp.height > max) {
        const s = max / Math.max(bmp.width, bmp.height);
        const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
        bmp.close?.();
        bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      }
      const tex = new THREE.Texture(bmp);
      tex.flipY = false;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      return tex;
    } catch (e) {
      console.warn('Texture not loaded', path, e);
      return null;
    }
  })();
  textureCache.set(key, p);
  return p;
}
export function clearTextureCache() {
  for (const p of textureCache.values()) p.then((t) => t?.dispose());
  textureCache.clear();
}

async function loadMaterialSet(src, matRef, modelDir) {
  const gp = gamePath(matRef.path || matRef.name);
  const jsonPath = src.find(gp + '.json', modelDir) ?? src.find(matRef.name + '.json', modelDir);
  const olPath = src.find(gp + '_OL.json', modelDir) ?? src.find(matRef.name + '_OL.json', modelDir);
  const mat = jsonPath ? parseMaterialJson(await src.json(jsonPath).catch(() => null)) : null;
  const ol = olPath ? parseMaterialJson(await src.json(olPath).catch(() => null)) : null;
  const texPath = (m, keys) => {
    for (const k of keys) {
      const t = m?.textures?.[k];
      if (!t?.ObjectPath) continue;
      const p = gamePath(t.ObjectPath);
      if (/DefaultColor(White|Black)|DefaultNormal|DefaultMask/i.test(p) && k !== keys[keys.length - 1]) continue;
      const f = src.find(p + '.png', modelDir);
      if (f) return f;
    }
    return null;
  };
  const albedoPath = texPath(mat, ['MainTex', 'PM_Diffuse', 'D', 'Base', 'BaseColor', 'Diffuse']);
  const maskPath = mat ? texPath(mat, ['MaskTex']) : null;
  const olTexPath = ol ? texPath(ol, ['MainTex']) : null;
  // Fallback: guess the diffuse texture from the material name (MI_X → T_X_D)
  let albedo = albedoPath;
  if (!albedo) {
    const guess = matRef.name.replace(/^MI_/, 'T_') + '_D.png';
    albedo = src.find(guess, modelDir);
  }
  const [map, maskMap, olMap] = await Promise.all([
    albedo ? loadTexture(src, albedo, true) : null,
    maskPath ? loadTexture(src, maskPath, false) : null,
    olTexPath ? loadTexture(src, olTexPath, true) : null,
  ]);
  return { mat, ol, map: map ?? WHITE, maskMap, olMap };
}

// Decode the smoothed outline normal the exporter packs (octahedral, tangent space) in UV channel 1.
function decodeOutlineNormals(lod) {
  const { normals, tangents, binormalSigns } = lod;
  const uv = lod.uvs[1];
  if (!normals || !tangents || !binormalSigns || !uv) return null;
  const n = binormalSigns.length;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = uv[i * 2], y = uv[i * 2 + 1];
    let z = 1 - Math.abs(x) - Math.abs(y);
    if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
    const k = i * 3;
    const nx = normals[k], ny = normals[k + 1], nz = normals[k + 2];
    const tx = tangents[k], ty = tangents[k + 1], tz = tangents[k + 2];
    const s = -binormalSigns[i];
    const bx = (ny * tz - nz * ty) * s, by = (nz * tx - nx * tz) * s, bz = (nx * ty - ny * tx) * s;
    let ox = tx * x + bx * y + nx * z, oy = ty * x + by * y + ny * z, oz = tz * x + bz * y + nz * z;
    const l = Math.hypot(ox, oy, oz) || 1;
    ox /= l; oy /= l; oz /= l;
    // a smoothed normal pointing away from the surface would tear the outline into spikes
    out[k] = ox; out[k + 1] = oy; out[k + 2] = oz;
  }
  return out;
}

// Average normals of vertices sharing a position (fallback outline normals).
function smoothNormals(positions, normals) {
  const n = positions.length / 3;
  const map = new Map();
  const key = (i) => `${Math.round(positions[i * 3] * 100)},${Math.round(positions[i * 3 + 1] * 100)},${Math.round(positions[i * 3 + 2] * 100)}`;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let a = map.get(k); if (!a) { a = [0, 0, 0]; map.set(k, a); }
    a[0] += normals[i * 3]; a[1] += normals[i * 3 + 1]; a[2] += normals[i * 3 + 2];
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = map.get(key(i)); const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  return out;
}

function buildSkinAttributes(lod, vcount, boneMap) {
  const idx = new Uint16Array(vcount * 4);
  const wts = new Float32Array(vcount * 4);
  const w = lod.weights;
  if (!w) { for (let i = 0; i < vcount; i++) { idx[i * 4] = boneMap[0] ?? 0; wts[i * 4] = 1; } return { idx, wts }; }
  for (let i = 0; i < w.count; i++) {
    const v = w.vertex[i]; if (v >= vcount) continue;
    const b = boneMap[w.bone[i]] ?? 0; const wt = w.weight[i];
    const o = v * 4;
    let slot = -1, minW = Infinity, minS = 0;
    for (let s = 0; s < 4; s++) {
      if (wts[o + s] === 0 && slot < 0) slot = s;
      if (wts[o + s] < minW) { minW = wts[o + s]; minS = s; }
    }
    if (slot < 0) { if (wt <= minW) continue; slot = minS; }
    idx[o + slot] = b; wts[o + slot] = wt;
  }
  for (let v = 0; v < vcount; v++) {
    const o = v * 4; const s = wts[o] + wts[o + 1] + wts[o + 2] + wts[o + 3];
    if (s > 0) { for (let k = 0; k < 4; k++) wts[o + k] /= s; } else { idx[o] = boneMap[0] ?? 0; wts[o] = 1; }
  }
  return { idx, wts };
}

// Split one LOD into a compact geometry per material section.
function sectionGeometries(lod, skin, packedNormals, smoothed) {
  const vcount = lod.positions.length / 3;
  const color = lod.colors[0]?.rgba;
  const out = [];
  lod.materials.forEach((m, mi) => {
    const start = m.firstIndex, end = Math.min(m.firstIndex + m.numFaces * 3, lod.indices.length);
    if (end <= start) return;
    const remap = new Int32Array(vcount).fill(-1);
    const verts = [];
    const index = new Uint32Array(end - start);
    for (let i = start; i < end; i++) {
      const v = lod.indices[i];
      if (remap[v] < 0) { remap[v] = verts.length; verts.push(v); }
      index[i - start] = remap[v];
    }
    const n = verts.length;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), oln = new Float32Array(n * 3);
    const col = new Uint8Array(n * 4), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const uv0 = lod.uvs[0];
    // Body/cloth sections pack smoothed outline normals in UV1; hair and face use UV1 for
    // something else, which tears the outline into slabs and spikes. Use whichever agrees.
    let agree = 0;
    if (packedNormals) for (const v of verts) agree += packedNormals[v * 3] * smoothed[v * 3] + packedNormals[v * 3 + 1] * smoothed[v * 3 + 1] + packedNormals[v * 3 + 2] * smoothed[v * 3 + 2];
    const outlineNormals = packedNormals && agree / verts.length > 0.85 ? packedNormals : smoothed;
    verts.forEach((v, j) => {
      for (let k = 0; k < 3; k++) {
        pos[j * 3 + k] = lod.positions[v * 3 + k];
        nor[j * 3 + k] = lod.normals ? lod.normals[v * 3 + k] : 0;
        oln[j * 3 + k] = outlineNormals[v * 3 + k];
      }
      if (uv0) { uv[j * 2] = uv0[v * 2]; uv[j * 2 + 1] = uv0[v * 2 + 1]; }
      for (let k = 0; k < 4; k++) {
        col[j * 4 + k] = color ? color[v * 4 + k] : (k === 1 ? 128 : 255);
        si[j * 4 + k] = skin.idx[v * 4 + k]; sw[j * 4 + k] = skin.wts[v * 4 + k];
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('olNormal', new THREE.BufferAttribute(oln, 3));
    g.setAttribute('vcol', new THREE.BufferAttribute(col, 4, true));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('hide', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    // morph targets touching this section
    const morphs = [];
    for (const mt of lod.morphs) {
      let arr = null;
      for (let k = 0; k < mt.vertices.length; k++) {
        const v = mt.vertices[k]; if (v >= vcount) continue;
        const j = remap[v]; if (j < 0) continue;
        if (!arr) arr = new Float32Array(n * 3);
        arr[j * 3] = mt.deltas[k * 3]; arr[j * 3 + 1] = mt.deltas[k * 3 + 1]; arr[j * 3 + 2] = mt.deltas[k * 3 + 2];
      }
      if (arr) morphs.push({ name: mt.name, group: mt.group, attr: new THREE.BufferAttribute(arr, 3) });
    }
    if (morphs.length) {
      g.morphAttributes.position = morphs.map((x) => x.attr);
      g.morphTargetsRelative = true;
    }
    g.computeBoundingBox(); g.computeBoundingSphere();
    out.push({ geometry: g, matIndex: mi, matRef: m, morphNames: morphs.map((x) => x.name), morphGroups: morphs.map((x) => x.group), srcVerts: verts });
  });
  return out;
}

let rigCounter = 0;

// A rig: one skeleton with any number of models skinned to it.
export class Rig {
  constructor(label) {
    this.id = ++rigCounter;
    this.prefix = `r${this.id}_`;
    this.label = label;
    this.group = new THREE.Group();       // placed in the world (Y-up metres)
    this.group.name = `rig${this.id}`;
    this.space = new THREE.Group();       // converts UE space (Z-up centimetres) to three.js space
    this.space.rotation.x = -Math.PI / 2;
    this.space.scale.setScalar(0.01);
    this.group.add(this.space);
    this.bones = [];                      // THREE.Bone
    this.boneByName = new Map();          // original name → bone
    this.skeleton = null;
    this.models = [];                     // { name, meshes: [section entries] }
    this.sockets = new Map();
    this.morphIndex = new Map();          // morph name → [{mesh, slot}]
    this.morphMeta = [];                  // [{name, group}]
  }

  // Adds the bones of `model`, reusing bones that already exist by name. Returns index map.
  mergeBones(model) {
    const map = [];
    model.bones.forEach((b, i) => {
      let bone = this.boneByName.get(b.name);
      if (!bone) {
        bone = new THREE.Bone();
        bone.name = this.prefix + b.name;
        bone.userData.name = b.name;
        bone.position.set(b.pos[0], b.pos[1], b.pos[2]);
        bone.quaternion.set(b.rot[0], b.rot[1], b.rot[2], b.rot[3]);
        bone.scale.set(b.scale[0], b.scale[1], b.scale[2]);
        bone.userData.bind = { p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() };
        const parent = b.parent >= 0 ? map[b.parent] : null;
        (parent ?? this.space).add(bone);
        this.bones.push(bone);
        this.boneByName.set(b.name, bone);
      }
      map[i] = bone;
    });
    for (const s of model.sockets ?? []) {
      if (this.sockets.has(s.name)) continue;
      const parent = this.boneByName.get(s.bone); if (!parent) continue;
      const o = new THREE.Object3D();
      o.name = this.prefix + 'socket_' + s.name;
      o.position.set(s.pos[0], s.pos[1], s.pos[2]);
      o.quaternion.set(s.rot[0], s.rot[1], s.rot[2], s.rot[3]);
      parent.add(o);
      this.sockets.set(s.name, o);
    }
    return map;
  }

  finalizeSkeleton() {
    this.group.updateMatrixWorld(true);
    // Rebuild the skeleton from scratch so inverse bind matrices match the bind pose.
    this.resetToBind();
    this.group.updateMatrixWorld(true);
    const old = this.skeleton;
    this.skeleton = new THREE.Skeleton(this.bones);
    for (const m of this.models) for (const s of m.meshes) {
      s.mesh.bind(this.skeleton, s.mesh.matrixWorld);
      s.outline?.bind(this.skeleton, s.outline.matrixWorld);
    }
    old?.dispose();
  }

  resetToBind() {
    for (const b of this.bones) {
      const d = b.userData.bind; if (!d) continue;
      b.position.copy(d.p); b.quaternion.copy(d.q); b.scale.copy(d.s);
    }
  }

  async addModel(src, path, { onStatus, label } = {}) {
    onStatus?.('Loading mesh…');
    const model = parseUEModel(await src.buffer(path));
    const lod = model.lods[0];
    if (!lod) throw new Error(`${model.name}: the model has no LODs`);
    const boneObjs = this.mergeBones(model);
    const boneIndex = new Map(this.bones.map((b, i) => [b, i]));
    const boneMap = boneObjs.map((b) => boneIndex.get(b));
    const skin = buildSkinAttributes(lod, lod.positions.length / 3, boneMap);
    const smoothed = smoothNormals(lod.positions, lod.normals ?? new Float32Array(lod.positions.length));
    const sections = sectionGeometries(lod, skin, decodeOutlineNormals(lod), smoothed);
    onStatus?.('Loading textures…');
    const modelDir = path.split('/').slice(0, -1).join('/');
    const mats = await Promise.all(lod.materials.map((m) => loadMaterialSet(src, m, modelDir)));
    const entry = { name: label ?? model.name, file: path, model, meshes: [], visible: true };
    for (const s of sections) {
      const ms = mats[s.matIndex];
      const sectionId = this.models.reduce((a, m) => a + m.meshes.length, 0) + entry.meshes.length;
      const material = makeToonMaterial({ name: s.matRef.name, mat: ms.mat, map: ms.map, maskMap: ms.maskMap, sectionId });
      const mesh = new THREE.SkinnedMesh(s.geometry, material);
      mesh.name = s.matRef.name;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.section = { rig: this, sectionId };
      let outline = null;
      if (material.userData.kind !== 3 && material.userData.kind !== 4) {
        outline = new THREE.SkinnedMesh(s.geometry, makeOutlineMaterial({ name: s.matRef.name, ol: ms.ol, map: ms.olMap, albedoMap: ms.map }));
        outline.frustumCulled = false;
        outline.renderOrder = -1;
        outline.raycast = () => {};
        this.space.add(outline);
      }
      if (material.transparent) mesh.renderOrder = 2;
      this.space.add(mesh);
      if (s.morphNames.length) {
        mesh.morphTargetInfluences = new Array(s.morphNames.length).fill(0);
        if (outline) outline.morphTargetInfluences = mesh.morphTargetInfluences;
        s.morphNames.forEach((n, slot) => {
          if (!this.morphIndex.has(n)) { this.morphIndex.set(n, []); this.morphMeta.push({ name: n, group: s.morphGroups[slot] }); }
          this.morphIndex.get(n).push({ mesh, slot });
        });
      }
      entry.meshes.push({
        name: s.matRef.name, label: prettySection(s.matRef.name, model.name), mesh, outline, visible: true,
        geometry: s.geometry, islands: null, hidden: new Set(), sectionId,
      });
    }
    this.models.push(entry);
    this.finalizeSkeleton();
    return entry;
  }

  setMorph(name, value) {
    for (const t of this.morphIndex.get(name) ?? []) t.mesh.morphTargetInfluences[t.slot] = value;
  }

  setModelVisible(entry, v) {
    entry.visible = v;
    for (const s of entry.meshes) this.applySectionVisibility(entry, s);
  }
  setSectionVisible(entry, s, v) { s.visible = v; this.applySectionVisibility(entry, s); }
  applySectionVisibility(entry, s) {
    const v = entry.visible && s.visible;
    s.mesh.visible = v;
    if (s.outline) s.outline.visible = v;
  }

  allSections() { return this.models.flatMap((m) => m.meshes.map((s) => ({ model: m, section: s }))); }

  findBone(name) { return this.boneByName.get(name) ?? null; }

  dispose() {
    this.group.removeFromParent();
    for (const m of this.models) for (const s of m.meshes) {
      s.geometry.dispose(); s.mesh.material.dispose(); s.outline?.material.dispose();
    }
    this.skeleton?.dispose();
  }
}

function prettySection(matName, modelName) {
  let n = matName.replace(/^MI_/, '');
  const base = modelName.replace(/^MI_/, '');
  if (n.startsWith(base)) n = n.slice(base.length);
  n = n.replace(/^_/, '');
  const dict = { Up: 'Upper body', Down: 'Lower body', Hair: 'Hair', Bangs: 'Bangs', Face: 'Face', Eye: 'Eyes', Item: 'Accessories', Alpha: 'Transparent parts', Body: 'Body', Cloth: 'Clothes', Skin: 'Skin', Weapon: 'Weapon' };
  return dict[n] ? `${dict[n]} (${n})` : (n || matName);
}

// ---------- Loose pieces ("islands") for hiding individual garments ----------

// Connected components of one section, joining vertices that share a position (UV seams).
export function computeIslands(geometry) {
  if (geometry.userData.islands) return geometry.userData.islands;
  const pos = geometry.attributes.position.array;
  const index = geometry.index.array;
  const n = pos.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 50)},${Math.round(pos[i * 3 + 1] * 50)},${Math.round(pos[i * 3 + 2] * 50)}`;
    const o = seen.get(k); if (o === undefined) seen.set(k, i); else unite(i, o);
  }
  for (let i = 0; i < index.length; i += 3) { unite(index[i], index[i + 1]); unite(index[i], index[i + 2]); }
  const ids = new Map(); const vertIsland = new Int32Array(n); const sizes = [];
  for (let i = 0; i < n; i++) {
    const r = find(i); let id = ids.get(r);
    if (id === undefined) { id = ids.size; ids.set(r, id); sizes.push(0); }
    vertIsland[i] = id; sizes[id]++;
  }
  const centers = sizes.map(() => [0, 0, 0]);
  for (let i = 0; i < n; i++) { const c = centers[vertIsland[i]]; c[0] += pos[i * 3]; c[1] += pos[i * 3 + 1]; c[2] += pos[i * 3 + 2]; }
  centers.forEach((c, i) => { c[0] /= sizes[i]; c[1] /= sizes[i]; c[2] /= sizes[i]; });
  const res = { vertIsland, sizes, centers, count: sizes.length };
  geometry.userData.islands = res;
  return res;
}

export function setIslandHidden(section, island, hidden) {
  const isl = computeIslands(section.geometry);
  const attr = section.geometry.attributes.hide;
  for (let i = 0; i < isl.vertIsland.length; i++) if (isl.vertIsland[i] === island) attr.array[i] = hidden ? 1 : 0;
  attr.needsUpdate = true;
  if (hidden) section.hidden.add(island); else section.hidden.delete(island);
}
