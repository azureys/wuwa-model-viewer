# WuWa 3D Viewer (Android and iPhone, offline)

3D viewer for Wuthering Waves character models. It ships no models: pick a character in the app and it
downloads that character's files from encore.moe (the same files as encore.moe's **Download .zip**), or
import a `.zip` you downloaded yourself.

## Features
- Toon rendering with outlines, per-material shadow colors and rim light.
- The package's animations (menu, gestures, combat) with ribbons and facial expressions.
- Weapon picker in the top bar: the chosen weapon appears in every animation that uses one; animation props appear with their animation.
- Pose tool: per-bone rotation, hand/foot IK, undo, mirror, export/import/save poses.
- Simple physics for hair, skirts and ribbons.
- Clothes: hide material sections, "scissors mode" to hide loose pieces by tapping them, piece list.
- Face: every morph target, with search.
- Lights: as many as you want (directional, point, spot, hemisphere, ambient), color, intensity, position, shadows, presets.
- Scene: backgrounds (gradient, color, your own image, transparent), floor, camera presets, auto-rotate, PNG screenshots (also transparent).
- Background music: the character select theme (`web/audio/bgm.mp3`), looped seamlessly with Web Audio.

## Downloading characters
- **Android:** the app downloads natively, straight into its storage.
- **iPhone / browser:** encore.moe's file storage only answers requests from encore.moe itself (CORS), so the web
  version downloads through a small Cloudflare Worker relay (`worker/`, see [worker/README.md](worker/README.md)).
  Its address is `DOWNLOAD_RELAY` in `web/src/platform.js` (or pasted once in the app). Files go to IndexedDB.

## iPhone (PWA)
`web/` also works as an installable web app (PWA), published to GitHub Pages by `.github/workflows/pages.yml`
on every push to `main` that touches `web/`.
- Safari → open the site → Share → **Add to Home Screen**. After that it works offline.
- Models are stored in the iPhone's IndexedDB (imported zips are read in slices, never fully in memory).
- `web/sw.js` caches the app for offline use; `node tools/gen-sw.mjs` regenerates its file list and version
  (the workflow does it when publishing).

## Layout
- `web/` — the viewer (three.js, no build step). `web/src/ueformat.js` reads `.uemodel`/`.ueanim` (UEFormat).
- `android/` — Kotlin WebView app that serves `web/` from its assets and the downloaded models from internal storage.
- `worker/` — download relay for the web version (Cloudflare Worker).
- `tools/devserver.mjs` — server to try the viewer in a browser with an unzipped folder (open with `?dev`).

## Build
```
cd android && ./gradlew assembleDebug   # needs the Android SDK (compileSdk 35)
```
