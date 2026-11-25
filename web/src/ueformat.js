// Parser for UEFormat files (.uemodel / .ueanim), the open mesh/animation format
// written by FModel / CUE4Parse exporters. Works in browsers and Node.
// Coordinates are returned in UE space with Y mirrored (right-handed, Z-up, centimetres).

const CHUNKED_VERSION = 10; // from this version every section is a counted list of named chunks
const MIRROR_VERSION = 8;   // from this version data is stored left-handed and must be mirrored

class Reader {
  constructor(view, pos = 0, end = view.byteLength) { this.view = view; this.pos = pos; this.end = end; }
  eof() { return this.pos >= this.end; }
  u8() { return this.view.getUint8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  floats(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = this.f32(); return a; }
  f32Array(n) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) { a[i] = this.view.getFloat32(this.pos, true); this.pos += 4; }
    return a;
  }
  u32Array(n) {
    const a = new Uint32Array(n);
    for (let i = 0; i < n; i++) { a[i] = this.view.getUint32(this.pos, true); this.pos += 4; }
    return a;
  }
  str() {
    const n = this.i32();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return new TextDecoder().decode(bytes).replace(/\0+$/, '');
  }
  sub(n) { const r = new Reader(this.view, this.pos, this.pos + n); this.pos += n; return r; }
}

// v10+: i32 count, then (name, size, payload)
function* countedChunks(r) {
  const n = r.i32();
  for (let i = 0; i < n; i++) { const name = r.str(); const size = r.i32(); yield [name, 0, r.sub(size)]; }
}
// pre-v10: (name, count, size, payload) until end of stream
function* streamChunks(r) {
  while (!r.eof()) { const name = r.str(); const count = r.i32(); const size = r.i32(); yield [name, count, r.sub(size)]; }
}

function header(buffer, expected) {
  const view = new DataView(buffer);
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
  if (magic !== 'UEFORMAT') throw new Error('Not a UEFormat file');
  const r = new Reader(view, 8);
  const ident = r.str();
  if (ident !== expected) throw new Error(`Expected ${expected} but found ${ident}`);
  const version = r.u8();
  const name = r.str();
  if (version >= CHUNKED_VERSION) r.str(); // exporter string
  if (r.u8()) throw new Error(`${name}: compressed UEFormat file (not supported)`);
  return { r, version, name };
}

const normQuat = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const mirrorVec = (v) => [v[0], -v[1], v[2]];
const mirrorQuat = (q) => [q[0], -q[1], q[2], -q[3]];

function parseLod(name, chunks, chunked) {
  const lod = {
    name, positions: new Float32Array(0), normals: null, tangents: null, binormalSigns: null,
    uvs: [], indices: new Uint32Array(0), materials: [], weights: [], colors: [], morphs: [],
  };
  for (const [kind, count, r] of chunks) {
    const n = () => (chunked ? r.i32() : count);
    switch (kind) {
      case 'VERTICES': lod.positions = r.f32Array(n() * 3); break;
      case 'INDICES': lod.indices = r.u32Array(n()); break;
      case 'NORMALS': {
        const c = n(); const raw = r.f32Array(c * 4);
        lod.normals = new Float32Array(c * 3); lod.binormalSigns = new Float32Array(c);
        for (let i = 0; i < c; i++) {
          lod.binormalSigns[i] = raw[i * 4];
          lod.normals[i * 3] = raw[i * 4 + 1]; lod.normals[i * 3 + 1] = raw[i * 4 + 2]; lod.normals[i * 3 + 2] = raw[i * 4 + 3];
        }
        break;
      }
      case 'TANGENTS': if (chunked) lod.tangents = r.f32Array(n() * 3); break;
      case 'TEXCOORDS': {
        const c = n();
        for (let i = 0; i < c; i++) { if (chunked) r.str(); lod.uvs.push(r.f32Array(r.i32() * 2)); }
        break;
      }
      case 'MATERIALS': {
        const c = n();
        for (let i = 0; i < c; i++) lod.materials.push({ name: r.str(), path: r.str(), firstIndex: r.i32(), numFaces: r.i32() });
        break;
      }
      case 'WEIGHTS': {
        const c = n();
        const bone = new Uint16Array(c), vertex = new Uint32Array(c), weight = new Float32Array(c);
        for (let i = 0; i < c; i++) { bone[i] = r.u16(); vertex[i] = r.i32(); weight[i] = r.f32(); }
        lod.weights = { bone, vertex, weight, count: c };
        break;
      }
      case 'VERTEXCOLORS': {
        const c = n();
        for (let i = 0; i < c; i++) {
          const cname = r.str(); const len = r.i32() * 4;
          lod.colors.push({ name: cname, rgba: new Uint8Array(r.view.buffer.slice(r.view.byteOffset + r.pos, r.view.byteOffset + r.pos + len)) });
          r.pos += len;
        }
        break;
      }
      case 'MORPHTARGETS': {
        const c = n();
        for (let i = 0; i < c; i++) {
          const mname = r.str(); const deltas = r.i32();
          const vertices = new Uint32Array(deltas); const pos = new Float32Array(deltas * 3);
          for (let k = 0; k < deltas; k++) {
            pos[k * 3] = r.f32(); pos[k * 3 + 1] = r.f32(); pos[k * 3 + 2] = r.f32();
            r.pos += 12; // tangent delta, unused
            vertices[k] = r.u32();
          }
          if (deltas) lod.morphs.push({ name: mname, group: '', vertices, deltas: pos });
        }
        break;
      }
      default: break;
    }
  }
  // Group each morph under the material section most of its vertices belong to (face, eyes, ...)
  const vcount = lod.positions.length / 3;
  if (lod.morphs.length && lod.materials.length) {
    const owner = new Uint16Array(vcount).fill(0xffff);
    lod.materials.forEach((m, mi) => {
      const end = Math.min(m.firstIndex + m.numFaces * 3, lod.indices.length);
      for (let i = m.firstIndex; i < end; i++) { const v = lod.indices[i]; if (v < vcount) owner[v] = mi; }
    });
    for (const morph of lod.morphs) {
      const counts = new Map(); let best = -1, bestN = 0;
      for (const v of morph.vertices) {
        if (v >= vcount || owner[v] === 0xffff) continue;
        const k = owner[v]; const c = (counts.get(k) || 0) + 1; counts.set(k, c);
        if (c > bestN) { bestN = c; best = k; }
      }
      morph.group = best >= 0 ? lod.materials[best].name : '';
    }
  }
  if (!lod.weights.count) lod.weights = null;
  return lod;
}

function parseBones(r, count, withScale) {
  const bones = [];
  for (let i = 0; i < count; i++) {
    bones.push({ name: r.str(), parent: r.i32(), pos: r.floats(3), rot: normQuat(r.floats(4)), scale: withScale ? r.floats(3) : [1, 1, 1] });
  }
  return bones;
}

export function parseUEModel(buffer) {
  const { r, version, name } = header(buffer, 'UEMODEL');
  if (version < 4) throw new Error(`${name}: UEFormat version ${version} not supported`);
  const model = { name, version, lods: [], bones: [], sockets: [] };
  const chunked = version >= CHUNKED_VERSION;
  const top = chunked ? countedChunks(r) : streamChunks(r);
  for (const [kind, count, c] of top) {
    if (kind === 'LODS') {
      const n = chunked ? c.i32() : count;
      for (let i = 0; i < n; i++) {
        const lodName = c.str();
        if (chunked) model.lods.push(parseLod(lodName, [...countedChunks(c)], true));
        else model.lods.push(parseLod(lodName, [...streamChunks(c.sub(c.i32()))], false));
      }
    } else if (kind === 'SKELETON') {
      const sub = chunked ? countedChunks(c) : streamChunks(c);
      for (const [sk, scount, s] of sub) {
        if (sk === 'BONES') model.bones = parseBones(s, chunked ? s.i32() : scount, chunked);
        else if (sk === 'SOCKETS' && chunked) {
          const n = s.i32();
          for (let i = 0; i < n; i++) model.sockets.push({ name: s.str(), bone: s.str(), pos: s.floats(3), rot: normQuat(s.floats(4)), scale: s.floats(3) });
        }
      }
    }
  }
  if (version >= MIRROR_VERSION) {
    for (const lod of model.lods) {
      for (let i = 1; i < lod.positions.length; i += 3) lod.positions[i] = -lod.positions[i];
      if (lod.normals) for (let i = 1; i < lod.normals.length; i += 3) lod.normals[i] = -lod.normals[i];
      if (lod.tangents) for (let i = 1; i < lod.tangents.length; i += 3) lod.tangents[i] = -lod.tangents[i];
      for (const m of lod.morphs) for (let i = 1; i < m.deltas.length; i += 3) m.deltas[i] = -m.deltas[i];
    }
    for (const b of [...model.bones, ...model.sockets]) { b.pos = mirrorVec(b.pos); b.rot = mirrorQuat(b.rot); }
  }
  return model;
}

function parseTracks(r, n) {
  const tracks = [];
  const keys = (dim) => { const c = r.i32(); const out = new Array(c); for (let i = 0; i < c; i++) out[i] = { frame: r.i32(), v: r.floats(dim) }; return out; };
  for (let i = 0; i < n; i++) {
    const t = { name: r.str(), pos: keys(3), rot: keys(4), scale: keys(3) };
    for (const k of t.rot) k.v = normQuat(k.v);
    tracks.push(t);
  }
  return tracks;
}

export function parseUEAnim(buffer) {
  const { r, version, name } = header(buffer, 'UEANIM');
  const anim = { name, version, numFrames: 0, fps: 30, additive: 0, tracks: [], curves: [] };
  const readCurves = (s, n) => {
    for (let i = 0; i < n; i++) {
      const c = { name: s.str(), keys: [] }; const k = s.i32();
      for (let j = 0; j < k; j++) c.keys.push({ frame: s.i32(), value: s.f32() });
      anim.curves.push(c);
    }
  };
  const readMeta = (s) => { anim.numFrames = s.i32(); anim.fps = s.f32(); s.str(); anim.additive = s.u8(); };
  if (version >= CHUNKED_VERSION) {
    for (const [kind, , s] of countedChunks(r)) {
      if (kind === 'METADATA') readMeta(s);
      else if (kind === 'TRACKS') anim.tracks = parseTracks(s, s.i32());
      else if (kind === 'CURVES') readCurves(s, s.i32());
    }
  } else {
    if (version < 7) { anim.numFrames = r.i32(); anim.fps = r.f32(); }
    for (const [kind, count, s] of streamChunks(r)) {
      if (kind === 'METADATA') readMeta(s);
      else if (kind === 'TRACKS') anim.tracks = parseTracks(s, count);
      else if (kind === 'CURVES') readCurves(s, count);
    }
  }
  if (version >= MIRROR_VERSION) {
    for (const t of anim.tracks) { for (const k of t.pos) k.v = mirrorVec(k.v); for (const k of t.rot) k.v = mirrorQuat(k.v); }
  }
  return anim;
}

// Material JSON exported by CUE4Parse (array of objects with Properties) → flat parameter tables.
export function parseMaterialJson(json) {
  if (json && !Array.isArray(json) && json.Textures) {
    return {
      textures: json.Textures ?? {}, colors: json.Colors ?? {}, scalars: json.Scalars ?? {}, switches: json.Switches ?? {},
      parent: json.Parent ?? '', blendMode: json.BlendMode ?? 0, twoSided: !!json.TwoSided, raw: json,
    };
  }
  const arr = Array.isArray(json) ? json : [json];
  const props = arr.find((o) => o && o.Properties)?.Properties ?? {};
  const table = (list, pick) => Object.fromEntries((list ?? []).map((p) => [p?.ParameterInfo?.Name, pick(p)]));
  return {
    textures: table(props.TextureParameterValues, (p) => p.ParameterValue),
    colors: table(props.VectorParameterValues, (p) => p.ParameterValue),
    scalars: table(props.ScalarParameterValues, (p) => p.ParameterValue),
    switches: table(props.StaticParameters?.StaticSwitchParameters, (p) => p.Value),
    parent: props.Parent?.ObjectName ?? '',
    blendMode: props.BlendMode ?? props.BasePropertyOverrides?.BlendMode ?? '',
    twoSided: props.TwoSided ?? props.BasePropertyOverrides?.TwoSided ?? false,
    raw: props,
  };
}

// "Client/Content/Aki/Foo/T_Bar.T_Bar" | "/Game/Aki/Foo/T_Bar" → "Aki/Foo/T_Bar"
export function gamePath(p) {
  return p.replace(/^.*?\/?(?:Client\/Content|Game)\//, '').replace(/^\/+/, '').replace(/\.[^./]+$/, '');
}
