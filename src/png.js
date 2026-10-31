// Minimal PNG for Node (mcp.js): encode RGBA8, decode 8-bit non-interlaced gray/RGB/palette/gray+alpha/RGBA.
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// -> { width, height, rgba: Uint8ClampedArray }
export function decodePng(buf) {
  buf = Buffer.from(buf.buffer ? buf : new Uint8Array(buf));
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('Не PNG-файл (JPG и другие форматы сначала сохраните как PNG)');
  let p = 8, w, h, depth, type, interlace, pal = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === 'PLTE') pal = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error('Поддерживаются PNG 8 бит на канал без interlace');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error('Неизвестный тип PNG: ' + type);
  const data = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = data[y * (stride + 1)], row = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      const pr = f === 4 ? (() => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })() : 0;
      cur[i] = row[i] + [0, a, b, (a + b) >> 1, pr][f];
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch, o = (y * w + x) * 4;
      if (type === 0) out.set([cur[s], cur[s], cur[s], 255], o);
      else if (type === 4) out.set([cur[s], cur[s], cur[s], cur[s + 1]], o);
      else if (type === 2) out.set([cur[s], cur[s + 1], cur[s + 2], 255], o);
      else if (type === 6) out.set(cur.subarray(s, s + 4), o);
      else out.set([pal[cur[s] * 3], pal[cur[s] * 3 + 1], pal[cur[s] * 3 + 2], trns && cur[s] < trns.length ? trns[cur[s]] : 255], o);
    }
    cur.copy(prev);
  }
  return { width: w, height: h, rgba: out };
}

// Bilinear resize of RGBA (textures must keep their original size in the game).
export function resizeRgba(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const fx = Math.max(0, (x + 0.5) * sw / dw - 0.5), fy = Math.max(0, (y + 0.5) * sh / dh - 0.5);
    const x0 = Math.min(sw - 1, fx | 0), y0 = Math.min(sh - 1, fy | 0), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < 4; c++) {
      const v = (src[(y0 * sw + x0) * 4 + c] * (1 - ax) + src[(y0 * sw + x1) * 4 + c] * ax) * (1 - ay) + (src[(y1 * sw + x0) * 4 + c] * (1 - ax) + src[(y1 * sw + x1) * 4 + c] * ax) * ay;
      out[(y * dw + x) * 4 + c] = v;
    }
  }
  return out;
}
