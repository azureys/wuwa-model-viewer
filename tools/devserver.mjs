// Dev server: serves web/ and exposes unzipped sample packages under /models/<id>/
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [webDir, ...pkgs] = process.argv.slice(2); // pkgs: id=dir
const models = Object.fromEntries(pkgs.map((p) => p.split('=')));
const walk = (d, b = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), b + e.name + '/') : [b + e.name]);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const DL = process.env.DLROOT;
import { execFile } from 'node:child_process';
http.createServer((req, res) => {
  const url0 = new URL(req.url, 'http://x');
  if (DL && url0.pathname === '/native/newid') { const id = url0.searchParams.get('name').replace(/[^A-Za-z0-9._ -]/g, '_'); fs.mkdirSync(path.join(DL, id), { recursive: true }); models[id] = path.join(DL, id); return res.end(id); }
  if (DL && url0.pathname === '/native/dl') {
    const id = url0.searchParams.get('id'), p = url0.searchParams.get('p'), base = url0.searchParams.get('base');
    const out = path.join(DL, id, p); fs.mkdirSync(path.dirname(out), { recursive: true });
    return execFile('curl', ['-sfL', '-o', out, base + p.split('/').map(encodeURIComponent).join('/')], (err) => { if (err) { try { fs.unlinkSync(out); } catch {} res.writeHead(404); return res.end('fail'); } res.end('ok'); });
  }
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (u === '/models/list.json') {
    const list = Object.entries(models).map(([id, dir]) => ({ id, name: id, files: walk(dir).length, size: 0 }));
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(list));
  }
  const m = u.match(/^\/models\/([^/]+)\/(.*)$/);
  if (m) {
    const dir = models[m[1]];
    if (m[2] === 'index.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ files: walk(dir) })); }
    file = path.join(dir, m[2]);
  } else file = path.join(webDir, u === '/' ? 'index.html' : u);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(data);
  });
}).listen(8123, () => console.log('http://localhost:8123'));
