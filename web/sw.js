// Offline app shell for the iPhone / browser version. Models are not here: they live in IndexedDB.
// The block between the AUTO markers is written by tools/gen-sw.mjs (run it after changing web/).
// AUTO-BEGIN
const VERSION = '20476486a6dd';
const ASSETS = [
 "./",
 "./icons/apple-touch-icon.png",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./manifest.webmanifest",
 "./src/animation.js",
 "./src/app.js",
 "./src/character.js",
 "./src/encore.js",
 "./src/music.js",
 "./src/platform.js",
 "./src/png.js",
 "./src/pose.js",
 "./src/source.js",
 "./src/toon.js",
 "./src/ueformat.js",
 "./src/viewer.js",
 "./src/webstore.js",
 "./styles.css",
 "./vendor/addons/OrbitControls.js",
 "./vendor/addons/TransformControls.js",
 "./vendor/fflate.js",
 "./vendor/three.module.js"
];
// AUTO-END
const CACHE = 'wuwa-shell-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('wuwa-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // encore.moe etc. go to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) ?? (req.mode === 'navigate' ? await cache.match('./') : undefined);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && url.pathname.startsWith(new URL('./', location).pathname)) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('Sin conexión', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});
