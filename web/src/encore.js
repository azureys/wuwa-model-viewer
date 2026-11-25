// Download a character straight from encore.moe (same files as its "Download .zip").
import { parseUEModel, parseMaterialJson, gamePath } from './ueformat.js';
import * as platform from './platform.js';

const API = 'https://api-v2.encore.moe/api';
export const STORAGE = 'https://s3-storage-api.encore.moe/resource/Data/Game/';
const lang = () => 'en';

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function fetchRoster() {
  const d = await getJson(`${API}/${lang()}/character`);
  return (d.roleList ?? []).map((r) => ({ id: r.Id, name: r.Name, quality: r.QualityId, element: r.Element?.Name ?? '', icon: r.RoleHeadIcon, weapon: r.WeaponType?.Name ?? '' }));
}
export async function fetchCharacter(id) {
  const d = await getJson(`${API}/${lang()}/character/${id}`);
  const name = d.Name?.Content ?? d.Name ?? String(id);
  return {
    id, name,
    variants: (d.Model3D ?? []).map((m, i) => ({ index: i, name: m.Name, kind: m.Kind, model: m.Model, parts: m.Parts ?? [], anims: m.Animations ?? [] })),
    equips: (d.Model3DEquips ?? []).map((e) => ({ id: e.Id, name: e.Name, kind: e.Kind, model: e.Model, parts: e.Parts ?? [], anims: e.Animations ?? [] })),
    initWeapon: d.InitWeaponItemId,
  };
}

const rel = (u) => u.replace(/^.*?\/Game\//, '');

// Returns { id, name } of the new library entry.
export async function downloadCharacter(ch, variantIndex, weaponId, onProgress) {
  const v = ch.variants[variantIndex];
  if (!v) throw new Error('This character has no 3D model');
  const equips = ch.equips.filter((e) => e.kind === 'prop' || (weaponId != null && e.id === weaponId));
  const title = ch.variants.length > 1 ? `${ch.name} · ${v.name}` : ch.name;
  const id = await platform.newModelId(title);
  try {
    await fetchAll(id, [v.model, ...v.parts, ...equips.flatMap((e) => [e.model, ...e.parts])], [...v.anims, ...equips.flatMap((e) => e.anims)], onProgress);
    await platform.finalizeModel(id, title);
  } catch (e) {
    await platform.abortDownload(id);
    throw e;
  }
  return { id, name: title };
}

// Adds one weapon (all its pieces, materials, textures, animations) to a model already in the library.
export async function downloadWeapon(id, weapon, onProgress) {
  await platform.beginUpdate(id);
  try { await fetchAll(id, [weapon.model, ...weapon.parts], weapon.anims, onProgress); }
  finally { await platform.endUpdate(id); }
}

async function fetchAll(id, modelUrls, animUrls, onProgress) {
  let stage = '', bytesBefore = 0;
  const mb = (b) => (b / 1048576).toFixed(0);
  const batch = async (label, paths, weight0, weight1) => {
    stage = label;
    const uniq = [...new Set(paths)];
    if (!uniq.length) return [];
    let last = 0;
    const failed = await platform.downloadBatch(id, STORAGE, uniq, (done, total, bytes) => {
      last = bytes;
      onProgress?.(Math.round(weight0 + (weight1 - weight0) * (done / total)), `${stage} ${done}/${total} · ${mb(bytesBefore + bytes)} MB`);
    });
    bytesBefore += last;
    return failed;
  };
  const read = (p) => platform.readDownloaded(id, p);

  const models = modelUrls.map(rel);
  const anims = animUrls.map(rel);
  const failedModels = await batch('Models', models, 0, 15);
  if (failedModels.includes(models[0])) throw new Error('could not download ' + models[0].split('/').pop());
  // material tables referenced by each model
  const matJobs = [];
  for (const m of models) {
    try {
      const buf = await read(m); if (!buf) continue;
      const model = parseUEModel(buf);
      const dir = m.slice(0, m.lastIndexOf('/'));
      for (const mat of model.lods[0]?.materials ?? []) {
        const p = gamePath(mat.path || mat.name);
        matJobs.push({ path: p + '.json', dir }, { path: p + '_OL.json', dir });
      }
    } catch (e) { console.warn('could not read model', m, e); }
  }
  await batch('Materials', matJobs.map((j) => j.path), 15, 22);
  // textures referenced by the materials (fallback: next to the model)
  const texJobs = [];
  for (const j of matJobs) {
    try {
      const buf = await read(j.path); if (!buf) continue;
      const mat = parseMaterialJson(JSON.parse(new TextDecoder().decode(buf)));
      for (const t of Object.values(mat.textures)) {
        if (!t?.ObjectPath) continue;
        const p = gamePath(t.ObjectPath);
        texJobs.push({ path: p + '.png', alt: `${j.dir}/${p.split('/').pop()}.png` });
      }
    } catch { /* missing outline tables are normal */ }
  }
  const texMap = new Map(texJobs.map((t) => [t.path, t]));
  const failedTex = await batch('Textures', [...texMap.keys()], 22, 55);
  const alts = failedTex.map((p) => texMap.get(p)?.alt).filter(Boolean);
  if (alts.length) await batch('Textures', alts, 55, 58);
  await batch('Animations', anims, 58, 100);
}
