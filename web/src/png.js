// Minimal PNG decoder that keeps the colour of transparent pixels.
// Safari (iPhone) always premultiplies decoded images, which wipes the RGB of pixels with low alpha.
// WuWa textures store masks in the alpha channel, so that turns parts of the model black.

async function inflateZlib(blob) {
  if (typeof DecompressionStream !== 'undefined') {
    try { return new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); } catch { /* fall back */ }
  }
  const { unzlibSync } = await import('../vendor/fflate.js');
  return unzlibSync(new Uint8Array(await blob.arrayBuffer()));
}

// Returns { width, height, data: Uint8Array RGBA } or null when the file uses a feature not handled here.
export async function decodePng(buf) {
  const b = new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) return null;
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') palette = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (interlace || !(depth === 8 || depth === 16) || ![0, 2, 3, 4, 6].includes(ctype) || (ctype === 3 && depth !== 8)) return null;
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = chans * (depth / 8), stride = w * bpp;
  const raw = await inflateZlib(new Blob(idat));
  if (raw.length < h * (stride + 1)) return null;
  // undo the per-row filters in place
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, up = y ? px[prev + x] : 0, c = (x >= bpp && y) ? px[prev + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[row + x] = v;
    }
  }
  const out = new Uint8Array(w * h * 4);
  const step = depth / 8; // 16-bit: keep the high byte
  for (let i = 0, o = 0, n = w * h; i < n; i++, o += 4) {
    const s = i * bpp;
    if (ctype === 6) { out[o] = px[s]; out[o + 1] = px[s + step]; out[o + 2] = px[s + 2 * step]; out[o + 3] = px[s + 3 * step]; }
    else if (ctype === 2) { out[o] = px[s]; out[o + 1] = px[s + step]; out[o + 2] = px[s + 2 * step]; out[o + 3] = 255; }
    else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = px[s]; out[o + 3] = 255; }
    else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = px[s]; out[o + 3] = px[s + step]; }
    else { const k = px[s]; out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { width: w, height: h, data: out };
}

// Halve the image (2x2 box filter) until both sides fit in `max`.
export function shrinkToFit(img, max) {
  let { width: w, height: h, data } = img;
  while (w > max || h > max) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), d = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1), y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
      const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, e = (y1 * w + x1) * 4, o = (y * nw + x) * 4;
      for (let k = 0; k < 4; k++) d[o + k] = (data[a + k] + data[b + k] + data[c + k] + data[e + k] + 2) >> 2;
    }
    w = nw; h = nh; data = d;
  }
  return { width: w, height: h, data };
}
