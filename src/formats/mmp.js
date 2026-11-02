// MMP texture: 76-byte header {"MMP\0", w, h, mipCount, format, bpp, 4x{mask, shift, count} (A,R,G,B), offset},
// pixels at 76 + offset, mip chain follows. Formats: DXT1, DXT3, 0x8888 ARGB8, 0x4444, 0x5650 RGB565,
// 0x5551 ARGB1555, PNT3 (Nival RLE-compressed ARGB8).
const FOURCC = s => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
export const FMT = { DXT1: FOURCC('DXT1'), DXT3: FOURCC('DXT3'), PNT3: FOURCC('PNT3'), ARGB8: 0x8888, ARGB4: 0x4444, RGB565: 0x5650, ARGB1555: 0x5551 };

export function mmpInfo(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x504d4d) throw new Error('Не MMP-текстура');
  const fmt = dv.getUint32(16, true);
  const name = Object.keys(FMT).find(k => FMT[k] === fmt) || fmt.toString(16);
  return { width: dv.getUint32(4, true), height: dv.getUint32(8, true), mips: dv.getUint32(12, true), format: fmt, formatName: name, dataOffset: 76 + dv.getUint32(72, true) };
}

// -> {width, height, rgba: Uint8ClampedArray} (top mip level only)
export function decodeMmp(u8) {
  const info = mmpInfo(u8);
  const { width: w, height: h } = info;
  const src = u8.subarray(info.dataOffset);
  const out = new Uint8ClampedArray(w * h * 4);
  const sdv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  switch (info.format) {
    case FMT.DXT1: dxt(src, w, h, out, false); break;
    case FMT.DXT3: dxt(src, w, h, out, true); break;
    case FMT.ARGB8: for (let i = 0; i < w * h; i++) { out[i * 4] = src[i * 4 + 2]; out[i * 4 + 1] = src[i * 4 + 1]; out[i * 4 + 2] = src[i * 4]; out[i * 4 + 3] = src[i * 4 + 3]; } break;
    case FMT.ARGB4: for (let i = 0; i < w * h; i++) { const v = sdv.getUint16(i * 2, true); out.set([((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17, (v >> 12) * 17], i * 4); } break;
    case FMT.RGB565: for (let i = 0; i < w * h; i++) { const v = sdv.getUint16(i * 2, true); out.set([(v >> 11) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31, 255], i * 4); } break;
    case FMT.ARGB1555: for (let i = 0; i < w * h; i++) { const v = sdv.getUint16(i * 2, true); out.set([((v >> 10) & 31) * 255 / 31, ((v >> 5) & 31) * 255 / 31, (v & 31) * 255 / 31, v >> 15 ? 255 : 0], i * 4); } break;
    case FMT.PNT3: pnt3(src, w, h, out); break;
    default: throw new Error('Неизвестный формат MMP: ' + info.formatName);
  }
  return { width: w, height: h, rgba: out, info };
}

function rgb565(v) { return [((v >> 11) & 31) * 255 / 31 | 0, ((v >> 5) & 63) * 255 / 63 | 0, (v & 31) * 255 / 31 | 0]; }

function dxt(src, w, h, out, dxt3) {
  const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2), bs = dxt3 ? 16 : 8;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * bs, c = dxt3 ? o + 8 : o;
    const c0 = src[c] | (src[c + 1] << 8), c1 = src[c + 2] | (src[c + 3] << 8);
    const p0 = rgb565(c0), p1 = rgb565(c1), pal = [p0, p1];
    if (c0 > c1 || dxt3) { pal.push(p0.map((v, i) => (2 * v + p1[i]) / 3 | 0), p0.map((v, i) => (v + 2 * p1[i]) / 3 | 0)); }
    else { pal.push(p0.map((v, i) => (v + p1[i]) >> 1), [0, 0, 0]); }
    const bits = (src[c + 4] | (src[c + 5] << 8) | (src[c + 6] << 16) | (src[c + 7] << 24)) >>> 0;
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
      if (x >= w || y >= h) continue;
      const idx = (bits >>> (i * 2)) & 3, d = (y * w + x) * 4, col = pal[idx];
      out[d] = col[0]; out[d + 1] = col[1]; out[d + 2] = col[2];
      out[d + 3] = dxt3 ? ((src[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17 : (!(c0 > c1) && idx === 3 ? 0 : 255);
    }
  }
}

// PNT3 (verified on all 973 game textures): stream of u32 words; a word that is 0 or > 1000000
// is a literal BGRA pixel, any other value is a run of that many zero bytes (transparent pixels).
// For PNT3 the header's mipCount field holds the compressed size instead.
function pnt3(src, w, h, out) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let d = 0;
  for (let i = 0; i + 4 <= src.length && d < w * h * 4; i += 4) {
    const v = dv.getUint32(i, true);
    if (v === 0 || v > 1000000) { out[d] = src[i + 2]; out[d + 1] = src[i + 1]; out[d + 2] = src[i]; out[d + 3] = src[i + 3]; d += 4; }
    else d += v; // already zero-filled
  }
}

// Box-filtered mip chain, `count` levels (default: down to 1x1).
function mipChain(width, height, rgba, count = Infinity) {
  const levels = [];
  let w = width, h = height, cur = rgba;
  for (;;) {
    levels.push({ w, h, px: cur });
    if ((w === 1 && h === 1) || levels.length >= count) break;
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), nx = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      let s = 0, k = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy); s += cur[(sy * w + sx) * 4 + c]; k++; }
      nx[(y * nw + x) * 4 + c] = s / k;
    }
    w = nw; h = nh; cur = nx;
  }
  return levels;
}

// Encode RGBA into an uncompressed ARGB8 MMP with a full mip chain (engine accepts 0x8888 for UI and objects,
// but terrain atlases must stay DXT1 with the original 5 levels: one ARGB8 atlas left the whole landscape undrawn).
export function encodeMmpArgb8(width, height, rgba) {
  const levels = mipChain(width, height, rgba);
  const size = 76 + levels.reduce((a, l) => a + l.w * l.h * 4, 0);
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  out.set([0x4d, 0x4d, 0x50, 0]);
  dv.setUint32(4, width, true); dv.setUint32(8, height, true); dv.setUint32(12, levels.length, true);
  dv.setUint32(16, FMT.ARGB8, true); dv.setUint32(20, 32, true);
  const masks = [[0xff000000, 24, 8], [0xff0000, 16, 8], [0xff00, 8, 8], [0xff, 0, 8]];
  masks.forEach(([m, s, c], i) => { dv.setUint32(24 + i * 12, m, true); dv.setUint32(28 + i * 12, s, true); dv.setUint32(32 + i * 12, c, true); });
  let p = 76;
  for (const l of levels) for (let i = 0; i < l.w * l.h; i++, p += 4) { out[p] = l.px[i * 4 + 2]; out[p + 1] = l.px[i * 4 + 1]; out[p + 2] = l.px[i * 4]; out[p + 3] = l.px[i * 4 + 3]; }
  return out;
}

// Opaque DXT1 MMP, header as in the game's terrain atlases (bpp 4, ARGB1555 masks). Endpoints = per-block
// colour bounding box, always 4-colour mode (c0 > c1); good enough for terrain, not for sharp art.
export function encodeMmpDxt1(width, height, rgba, mips = Infinity) {
  const levels = mipChain(width, height, rgba, mips);
  const out = new Uint8Array(76 + levels.reduce((a, l) => a + Math.max(1, l.w >> 2) * Math.max(1, l.h >> 2) * 8, 0)), dv = new DataView(out.buffer);
  out.set([0x4d, 0x4d, 0x50, 0]);
  dv.setUint32(4, width, true); dv.setUint32(8, height, true); dv.setUint32(12, levels.length, true); dv.setUint32(16, FMT.DXT1, true); dv.setUint32(20, 4, true);
  [[0x8000, 15, 1], [0x7c00, 10, 5], [0x3e0, 5, 5], [0x1f, 0, 5]].forEach(([m, s, c], i) => { dv.setUint32(24 + i * 12, m, true); dv.setUint32(28 + i * 12, s, true); dv.setUint32(32 + i * 12, c, true); });
  const to565 = c => ((c[0] * 31 / 255 + 0.5) << 11) | ((c[1] * 63 / 255 + 0.5) << 5) | (c[2] * 31 / 255 + 0.5);
  let p = 76;
  for (const { w, h, px } of levels) for (let by = 0; by < Math.max(1, h >> 2); by++) for (let bx = 0; bx < Math.max(1, w >> 2); bx++, p += 8) {
    const blk = [];
    for (let i = 0; i < 16; i++) { const x = Math.min(w - 1, bx * 4 + (i & 3)), y = Math.min(h - 1, by * 4 + (i >> 2)), o = (y * w + x) * 4; blk.push([px[o], px[o + 1], px[o + 2]]); }
    const lo = [0, 1, 2].map(k => Math.min(...blk.map(c => c[k]))), hi = [0, 1, 2].map(k => Math.max(...blk.map(c => c[k])));
    let c0 = to565(hi), c1 = to565(lo);
    if (c0 < c1) [c0, c1] = [c1, c0];
    dv.setUint16(p, c0, true); dv.setUint16(p + 2, c1, true);
    if (c0 === c1) continue; // indices 0: the whole block is c0
    const p0 = rgb565(c0), p1 = rgb565(c1), pal = [p0, p1, p0.map((v, i) => (2 * v + p1[i]) / 3), p0.map((v, i) => (v + 2 * p1[i]) / 3)];
    let bits = 0;
    blk.forEach((c, i) => { let best = 0, bd = Infinity; pal.forEach((q, k) => { const d = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2; if (d < bd) { bd = d; best = k; } }); bits |= best << (i * 2); });
    dv.setUint32(p + 4, bits >>> 0, true);
  }
  return out;
}
