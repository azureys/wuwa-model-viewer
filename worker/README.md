# Download relay (Cloudflare Worker)

The iPhone / browser version of the viewer runs on `azureys.github.io`, but encore.moe's file storage
only allows its own website to read the model files (CORS). This tiny Cloudflare Worker fetches the same
public files and adds the header the viewer needs. It only serves model files under `Aki/` and only to
the viewer's own site. The free Cloudflare plan (100,000 requests a day) is plenty: one character is a
few hundred files.

## Deploy (about 3 minutes, free)

**Option A: one click**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/azureys/wuwa-model-viewer/tree/main/worker)

Sign in (or create a free account), accept the defaults and press **Deploy**. Copy the address it
gives you, like `https://wuwa-download-relay.<your-name>.workers.dev`.

**Option B: paste the code**

1. Go to <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it `wuwa-download-relay` and press **Deploy**.
3. Press **Edit code**, replace everything with the contents of [`worker.js`](worker.js), press **Deploy**.
4. Copy the worker's address (`https://wuwa-download-relay.<your-name>.workers.dev`).

Opening that address in a browser shows `WuWa viewer download relay: OK`.

## Use it

The address is set as `DOWNLOAD_RELAY` in `web/src/platform.js`. Until then, it can also be pasted
in the app: Library → Download characters → paste the address.
