// Writes the precache list and a content hash into web/sw.js so the PWA works fully offline
// and updates itself whenever any file in web/ changes.   usage: node tools/gen-sw.mjs [webDir]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const web = process.argv[2] ?? new URL('../web', import.meta.url).pathname;
const skip = (rel) => rel === 'sw.js' || rel.startsWith('models/') || rel.endsWith('.LICENSE') || rel.endsWith('.md');
const walk = (d, b = '') => fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))
  .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), b + e.name + '/') : [b + e.name]);
const files = walk(web).filter((f) => !skip(f));
const hash = crypto.createHash('sha256');
for (const f of files) { hash.update(f); hash.update(fs.readFileSync(path.join(web, f))); }
const version = hash.digest('hex').slice(0, 12);
const assets = ['./', ...files.filter((f) => f !== 'index.html').map((f) => './' + f)];
const swPath = path.join(web, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8').replace(/\/\/ AUTO-BEGIN[\s\S]*?\/\/ AUTO-END/,
  `// AUTO-BEGIN\nconst VERSION = '${version}';\nconst ASSETS = ${JSON.stringify(assets, null, 1)};\n// AUTO-END`);
fs.writeFileSync(swPath, sw);
console.log(`sw.js: ${assets.length} archivos, versión ${version}`);
