// Download relay for the WuWa viewer.
// encore.moe's file storage only answers browsers on encore.moe itself (CORS), so the iPhone/web
// version of the viewer can't read the model files directly. This Worker fetches the same public
// files and adds the CORS header for the viewer's own site. It only serves model files
// (.uemodel / .ueanim / .json / .png under Aki/) and only to the allowed origins below.
const UPSTREAM = 'https://s3-storage-api.encore.moe/resource/Data/Game/';
const ALLOWED = [
  /^https:\/\/azureys\.github\.io$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];
const FILE = /^Aki\/[^?#]+\.(uemodel|ueanim|json|png)$/i;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const ok = ALLOWED.some((re) => re.test(origin));
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin : 'https://azureys.github.io',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Expose-Headers': 'Content-Length',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    if (url.pathname === '/' ) return new Response('WuWa viewer download relay: OK', { headers: { ...cors, 'Content-Type': 'text/plain' } });
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { decoded = ''; }
    if (!FILE.test(decoded) || decoded.split('/').includes('..')) return new Response('Not found', { status: 404, headers: cors });
    const up = await fetch(UPSTREAM + path, { method: request.method, cf: { cacheEverything: true, cacheTtl: 604800 } });
    const headers = new Headers(cors);
    for (const k of ['Content-Type', 'Content-Length', 'ETag', 'Last-Modified']) {
      const v = up.headers.get(k);
      if (v) headers.set(k, v);
    }
    headers.set('Cache-Control', up.ok ? 'public, max-age=604800' : 'no-store');
    return new Response(up.body, { status: up.status, headers });
  },
};
