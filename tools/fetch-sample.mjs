// Dev tool: builds a test .zip with the same layout as encore.moe's "Download .zip"
// (paths relative to /Game/, .uemodel/.ueanim + material .json/_OL.json + .png textures).
// Usage: node fetch-sample.mjs <character.json> <outDir> [variantIndex] [weaponId]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseUEModel, parseMaterialJson, gamePath } from '../web/src/ueformat.js';

const BASE = 'https://s3-storage-api.encore.moe/resource/Data/Game/';
const [charFile, outDir, variantIdx = '0', weaponId] = process.argv.slice(2);
const ch = JSON.parse(fs.readFileSync(charFile, 'utf8'));
const variant = ch.Model3D[+variantIdx];
const equips = (ch.Model3DEquips ?? []).filter((e) => e.Kind === 'prop' || String(e.Id) === weaponId);

const rel = (u) => u.replace(/^.*\/Game\//, '');
const seen = new Set();
function get(relPath) {
  const dest = path.join(outDir, relPath);
  if (fs.existsSync(dest)) return fs.readFileSync(dest);
  try {
    const buf = execFileSync('curl', ['-sfL', BASE + relPath.split('/').map(encodeURIComponent).join('/')], { maxBuffer: 1 << 30 });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return buf;
  } catch { return null; }
}
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

function material(relJson, modelDir) {
  if (seen.has(relJson)) return; seen.add(relJson);
  const b = get(relJson); if (!b) { if (!relJson.endsWith('_OL.json')) console.warn('missing', relJson); return; }
  const m = parseMaterialJson(JSON.parse(b.toString('utf8')));
  for (const t of Object.values(m.textures)) {
    if (!t?.ObjectPath) continue;
    const p = gamePath(t.ObjectPath);
    if (!get(p + '.png')) { const alt = `${modelDir}/${p.split('/').pop()}.png`; if (!get(alt)) console.warn('missing tex', p); }
  }
}
function model(url) {
  const r = rel(url); const b = get(r); if (!b) { console.warn('missing model', r); return; }
  const m = parseUEModel(ab(b));
  const dir = r.slice(0, r.lastIndexOf('/'));
  for (const mat of m.lods[0]?.materials ?? []) {
    const p = gamePath(mat.path);
    material(p + '.json', dir); material(p + '_OL.json', dir);
  }
}
for (const e of [variant, ...equips]) {
  model(e.Model); (e.Parts ?? []).forEach(model);
  for (const a of e.Animations ?? []) get(rel(a));
}
fs.writeFileSync(path.join(outDir, 'source-variant.json'), JSON.stringify({ variant, equips }, null, 1));
console.log('done');
