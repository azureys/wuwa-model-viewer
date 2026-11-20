// Download a character straight from encore.moe (same files as its "Download .zip").
import { parseUEModel, parseMaterialJson, gamePath } from './ueformat.js';
import * as platform from './platform.js';

const API = 'https://api-v2.encore.moe/api';
export const STORAGE = 'https://s3-storage-api.encore.moe/resource/Data/Game/';
const lang = () => (navigator.language || 'es').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'es';

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
  if (!v) throw new Error('Este personaje no tiene modelo 3D');
  const equips = ch.equips.filter((e) => e.kind === 'prop' || (weaponId != null && e.id === weaponId));
  const title = ch.variants.length > 1 ? `${ch.name} · ${v.name}` : ch.name;
  const id = platform.newModelId(title);
  const base = `${platform.MODELS_BASE}/${encodeURIComponent(id)}/`;
  const local = (p) => base + p.split('/').map(encodeURIComponent).join('/');
  let stage = '';
  const batch = async (label, paths, weight0, weight1) => {
    stage = label;
    const uniq = [...new Set(paths)];
    if (!uniq.length) return [];
    return platform.downloadBatch(id, STORAGE, uniq, (done, total, bytes) =>
      onProgress?.(Math.round(weight0 + (weight1 - weight0) * (done / total)), `${stage} ${done}/${total} · ${(bytes / 1048576).toFixed(0)} MB`));
  };

  const models = [v.model, ...v.parts, ...equips.flatMap((e) => [e.model, ...e.parts])].map(rel);
  const anims = [...v.anims, ...equips.flatMap((e) => e.anims)].map(rel);
  await batch('Modelos', models, 0, 15);
  // material tables referenced by each model
  const matJobs = [];
  for (const m of models) {
    try {
      const r = await fetch(local(m)); if (!r.ok) continue;
      const model = parseUEModel(await r.arrayBuffer());
      const dir = m.slice(0, m.lastIndexOf('/'));
      for (const mat of model.lods[0]?.materials ?? []) {
        const p = gamePath(mat.path || mat.name);
        matJobs.push({ path: p + '.json', dir }, { path: p + '_OL.json', dir });
      }
    } catch (e) { console.warn('modelo no leído', m, e); }
  }
  await batch('Materiales', matJobs.map((j) => j.path), 15, 22);
  // textures referenced by the materials (fallback: next to the model)
  const texJobs = [];
  for (const j of matJobs) {
    try {
      const r = await fetch(local(j.path)); if (!r.ok) continue;
      const mat = parseMaterialJson(await r.json());
      for (const t of Object.values(mat.textures)) {
        if (!t?.ObjectPath) continue;
        const p = gamePath(t.ObjectPath);
        texJobs.push({ path: p + '.png', alt: `${j.dir}/${p.split('/').pop()}.png` });
      }
    } catch { /* missing outline tables are normal */ }
  }
  const texMap = new Map(texJobs.map((t) => [t.path, t]));
  const failedTex = await batch('Texturas', [...texMap.keys()], 22, 55);
  const alts = failedTex.map((p) => texMap.get(p)?.alt).filter(Boolean);
  if (alts.length) await batch('Texturas', alts, 55, 58);
  await batch('Animaciones', anims, 58, 100);
  platform.finalizeModel(id, title);
  return { id, name: title };
}
