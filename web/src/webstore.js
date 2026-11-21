// Browser / iPhone (PWA) storage: imported model packages live in IndexedDB, one Blob per file.
// The .zip is read straight from the picked File in slices, so a 300 MB package never sits in memory at once.

const DB = 'wuwa-models', MODELS = 'models', FILES = 'files';
const SEP = '\u0000';
let dbp = null;

function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(MODELS, { keyPath: 'id' });
      r.result.createObjectStore(FILES);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error ?? new Error('IndexedDB')); });
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const fileKey = (id, path) => id + SEP + path;

export async function listModels() {
  const d = await db();
  const all = await req(d.transaction(MODELS).objectStore(MODELS).getAll());
  return all.sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).map(({ list, ...m }) => m);
}
async function getMeta(id) { const d = await db(); return req(d.transaction(MODELS).objectStore(MODELS).get(id)); }
export async function getFileList(id) { return (await getMeta(id))?.list ?? null; }
export async function readFile(id, path) {
  const d = await db();
  return req(d.transaction(FILES).objectStore(FILES).get(fileKey(id, path)));
}
export async function deleteModel(id) {
  const d = await db();
  const t = d.transaction([MODELS, FILES], 'readwrite');
  t.objectStore(MODELS).delete(id);
  t.objectStore(FILES).delete(IDBKeyRange.bound(id + SEP, id + SEP + '￿'));
  await done(t);
}
export async function renameModel(id, name) {
  const d = await db();
  const t = d.transaction(MODELS, 'readwrite');
  const s = t.objectStore(MODELS);
  const m = await req(s.get(id));
  if (m) s.put({ ...m, name });
  await done(t);
}
async function uniqueId(name) {
  let id = name.replace(/[^A-Za-z0-9._ -]/g, '_').trim() || 'modelo';
  if (await getMeta(id)) id = `${id}-${Math.floor(Date.now() / 1000)}`;
  return id;
}

// ---------------------------------------------------------------- zip reading
async function bytes(file, start, len) { return new Uint8Array(await file.slice(start, start + len).arrayBuffer()); }
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

async function zipEntries(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = await bytes(file, file.size - tailLen, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('el archivo no es un .zip válido');
  let count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) { // ZIP64
    const loc = e - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error('.zip64 no soportado');
    const z64 = await bytes(file, u64(tail, loc + 8), 56);
    count = u64(z64, 32); cdSize = u64(z64, 40); cdOff = u64(z64, 48);
  }
  const cd = await bytes(file, cdOff, cdSize);
  const utf8 = new TextDecoder();
  const out = [];
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) throw new Error('directorio del .zip dañado');
    const method = u16(cd, p + 10);
    let comp = u32(cd, p + 20), size = u32(cd, p + 24), off = u32(cd, p + 42);
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 extended sizes
    for (let x = p + 46 + nameLen, end = x + extraLen; x + 4 <= end;) {
      const tag = u16(cd, x), len = u16(cd, x + 2);
      if (tag === 1) {
        let q = x + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (comp === 0xffffffff) { comp = u64(cd, q); q += 8; }
        if (off === 0xffffffff) { off = u64(cd, q); }
      }
      x += 4 + len;
    }
    p += 46 + nameLen + extraLen + commentLen;
    const path = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.endsWith('/') || /(^|\/)__MACOSX\//.test(path) || /(^|\/)\.DS_Store$/.test(path)) continue;
    if (path.split('/').includes('..')) continue;
    out.push({ path, method, comp, size, off });
  }
  return out;
}

let fflate = null;
async function inflate(file, ent) {
  const head = await bytes(file, ent.off, 30);
  if (u32(head, 0) !== 0x04034b50) throw new Error('entrada del .zip dañada: ' + ent.path);
  const start = ent.off + 30 + u16(head, 26) + u16(head, 28);
  const slice = file.slice(start, start + ent.comp);
  if (ent.method === 0) return new Blob([await slice.arrayBuffer()]);
  if (ent.method !== 8) throw new Error(`compresión no soportada (${ent.method}) en ${ent.path}`);
  if (typeof DecompressionStream !== 'undefined') {
    try { return await new Response(slice.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob(); } catch { /* fall back */ }
  }
  fflate ??= await import('../vendor/fflate.js');
  return new Blob([fflate.inflateSync(new Uint8Array(await slice.arrayBuffer()), { out: new Uint8Array(ent.size) })]);
}

// Import a picked .zip. Returns { id, name }.
export async function importZip(file, onProgress) {
  const name = file.name.replace(/\.zip$/i, '') || 'Modelo';
  onProgress?.(0, `Leyendo ${name}…`);
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  const entries = await zipEntries(file);
  if (!entries.some((x) => /\.uemodel$/i.test(x.path))) throw new Error('el .zip no contiene modelos .uemodel');
  const total = entries.reduce((s, x) => s + x.size, 0);
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota && est.quota - (est.usage ?? 0) < total) throw new Error(`no hay espacio suficiente (necesita ${(total / 1048576).toFixed(0)} MB)`);
  } catch (e) { if (/espacio/.test(e.message)) throw e; }
  const id = await uniqueId(name);
  const d = await db();
  const list = [];
  let batch = [], batchBytes = 0, written = 0;
  const flush = async () => {
    if (!batch.length) return;
    const t = d.transaction(FILES, 'readwrite');
    const s = t.objectStore(FILES);
    for (const [k, v] of batch) s.put(v, k);
    await done(t);
    batch = []; batchBytes = 0;
  };
  try {
    for (let i = 0; i < entries.length; i++) {
      const ent = entries[i];
      const blob = await inflate(file, ent);
      batch.push([fileKey(id, ent.path), blob]); batchBytes += blob.size; written += blob.size;
      list.push(ent.path);
      if (batchBytes > 24 * 1048576 || batch.length >= 64) await flush();
      if (i % 5 === 0) onProgress?.(Math.round(written * 100 / Math.max(1, total)), `Guardando ${i + 1}/${entries.length}`);
    }
    await flush();
    const t = d.transaction(MODELS, 'readwrite');
    t.objectStore(MODELS).put({ id, name, size: written, files: list.length, date: Date.now(), list });
    await done(t);
  } catch (e) {
    await deleteModel(id).catch(() => {});
    if (e?.name === 'QuotaExceededError') throw new Error('no queda espacio en el dispositivo');
    throw e;
  }
  onProgress?.(100, 'Listo');
  return { id, name };
}
