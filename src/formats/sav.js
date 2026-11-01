// Save games (saves/saveN/*.sav): u32 magic (0x102 zone/mission state, 0xDEAD scenario), u32 version (0x74),
// u32 checksum of the unpacked data, u8 packed flag, then (packed) u32 unpacked size + LZ stream.
// Decoder transcribed from game.exe 0x430960: bits come LSB-first from single bytes of the stream, literals are
// whole bytes taken from the stream as they come; a 1024-byte zeroed ring holds the history.
//   bit 0: literal byte. bit 1: match = length code, then distance code; copy from ring[pos - dist - 1].
//   length: 0x 2|4 by 1 bit; 10 1 bits(2)+7 | 10 0 (1 bits(3)+11 | 0 3); 110 (1 bits(6)+35 | 0 5);
//           1110 6; 11110 bits(4)+19; 11111 bits(7)+99   (bits after the prefix, read in that order)
//   distance: 1 (1 bits(10)+354 | 0 bits(12)+1378); 0 1 (1 bits(8)+98 | 0 bits(6)+34);
//             0 0 1 (1 (1 bits(1) | 0 bits(4)+18) | 0 bits(2)+6); 0 0 0 (1 bits(2)+2 | 0 bits(3)+10)
export const SAV_ZONE = 0x102, SAV_SCENARIO = 0xdead;

export function savChecksum(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let h = 0;
  for (let i = 0; i + 4 <= u8.length; i += 4) { h = (h ^ dv.getUint32(i, true)) >>> 0; h = Math.imul(h, (h & 0xfc) | 3) >>> 0; }
  return h;
}

export function unpackLz(src, start = 0) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const size = dv.getUint32(start, true), out = new Uint8Array(size), ring = new Uint8Array(1024);
  let p = start + 4, buf = 0, cnt = 0, o = 0, rp = 0;
  const bit = () => { if (!cnt) { buf = src[p++]; cnt = 8; } const b = buf & 1; buf >>>= 1; cnt--; return b; };
  const bits = n => { while (cnt < n) { buf += src[p++] << cnt; cnt += 8; } const v = buf & ((1 << n) - 1); buf >>>= n; cnt -= n; return v; };
  const put = c => { out[o++] = c; ring[rp] = c; rp = (rp + 1) & 1023; };
  while (o < size) {
    if (!bit()) { put(src[p++]); continue; }
    let len;
    if (!bit()) len = bit() ? 4 : 2;
    else if (!bit()) len = bit() ? bits(2) + 7 : bit() ? bits(3) + 11 : 3;
    else if (!bit()) len = bit() ? bits(6) + 35 : 5;
    else if (!bit()) len = 6;
    else len = bit() ? bits(7) + 99 : bits(4) + 19;
    let dist;
    if (bit()) dist = bit() ? bits(10) + 354 : bits(12) + 1378;
    else if (bit()) dist = bit() ? bits(8) + 98 : bits(6) + 34;
    else if (bit()) dist = bit() ? (bit() ? bits(1) : bits(4) + 18) : bits(2) + 6;
    else dist = bit() ? bits(2) + 2 : bits(3) + 10;
    for (let k = 0; k < Math.min(len, size - o); k++) put(ring[(rp - dist - 1) & 1023]);
  }
  return out;
}

export function readSav(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = dv.getUint32(0, true), version = dv.getUint32(4, true);
  let p = 8, checksum = null, packed = false;
  if (version > 0x6b) { checksum = dv.getUint32(p, true); p += 4; }
  if (version > 0x71) packed = !!u8[p++];
  const data = packed ? unpackLz(u8, p) : u8.slice(p);
  return { magic, version, checksum, packed, data, ok: checksum === null || savChecksum(data) === checksum };
}

// Packed like the game writes it (an unpacked file, flag 0, loads to a black screen). The stream holds
// literals only: a zero flag byte, then 8 data bytes, and so on.
// shortcut: no match search, the file is ~12% bigger than the data; fine for scenario.sav.
export function packLz(data) {
  const out = new Uint8Array(4 + data.length + Math.ceil(data.length / 8));
  new DataView(out.buffer).setUint32(0, data.length, true);
  let o = 4;
  for (let i = 0; i < data.length; i++) { if (i % 8 === 0) out[o++] = 0; out[o++] = data[i]; }
  return out;
}
export function writeSav({ magic, version }, data) {
  const lz = packLz(data), out = new Uint8Array(13 + lz.length), dv = new DataView(out.buffer);
  dv.setUint32(0, magic, true); dv.setUint32(4, version, true); dv.setUint32(8, savChecksum(data), true);
  out[12] = 1; out.set(lz, 13);
  return out;
}

// Scenario variables (scenario.sav data): records "name\0" + f32, ended by an empty name; no count.
// The table is the longest run of such records that contains z.*/q.* names.
function varTable(d) {
  const nameEnd = o => { let e = o; while (e < d.length && d[e] >= 0x20 && d[e] < 0x7f) e++; return d[e] === 0 && e - o >= 2 && e + 5 <= d.length ? e : -1; };
  const anchor = Buffer.from(d).indexOf('z.g');
  if (anchor < 0) throw new Error('В scenario.sav нет таблицы переменных');
  const chainEnd = o => { let n = 0; for (let e; (e = nameEnd(o)) >= 0; o = e + 5) n++; return { n, end: o }; };
  // anchor is mid-record if the name has a prefix; stop at the previous value's bytes, the chain realigns after one record
  let start = anchor; while (start > 0 && d[start - 1] >= 0x20 && d[start - 1] < 0x7f) start--;
  const end = chainEnd(start).end;
  for (let s = Math.max(0, start - 20000); s < start; s++) if (chainEnd(s).end === end && chainEnd(s).n > 2) { start = s; break; }
  if (d[end] !== 0) throw new Error('Конец таблицы переменных не найден');
  return { start, end, nameEnd };
}
export function savVars(d) {
  const { start, end, nameEnd } = varTable(d), dv = new DataView(d.buffer, d.byteOffset, d.byteLength), out = {};
  for (let o = start, e; o < end; o = e + 5) { e = nameEnd(o); out[Buffer.from(d.subarray(o, e)).toString('latin1')] = dv.getFloat32(e + 1, true); }
  return out;
}
// scenario.sav data is a chunk tree (reader at game.exe 0x409070): root = length, then chunks
// [id u8][length u8 | u32 if bit 0 is set; value >> 1][payload]; the root length is u16 | u32 the same way.
// The game checks every length, so a grown table needs every chunk around it grown (root > 2 > 1 > 1 > 2 > 2).
// Returns the offsets of those length fields with their widths.
function chunkPath(d, end) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const field = (p, wide) => wide ? dv.getUint32(p, true) >>> 1 : (p === 0 ? dv.getUint16(0, true) : d[p]) >>> 1;
  const list = (a, e) => { const o = []; for (let p = a; p < e;) { const w = d[p + 1] & 1, ps = p + (w ? 5 : 2), pe = ps + field(p + 1, w); if (pe > e) return null; o.push({ at: p + 1, w, ps, pe }); p = pe; } return o; };
  const rw = d[0] & 1, path = [{ at: 0, w: rw, root: true }];
  for (let lo = rw ? 4 : 2, hi = lo + field(0, rw); ;) {
    const c = list(lo, hi)?.find(c => c.ps <= end && end < c.pe);
    if (!c) break;
    path.push(c); lo = c.ps; hi = c.pe;
  }
  if (path.length < 2) throw new Error('Блоки вокруг таблицы переменных не найдены');
  return path.map(c => ({ ...c, len: field(c.at, c.w) }));
}
// Set variables (existing ones in place, new ones before the terminator); returns new data.
export function setSavVars(d, vars) {
  const { start, end, nameEnd } = varTable(d), add = [];
  d = d.slice();
  const dv = new DataView(d.buffer);
  const todo = new Map(Object.entries(vars));
  for (let o = start, e; o < end; o = e + 5) {
    e = nameEnd(o); const n = Buffer.from(d.subarray(o, e)).toString('latin1');
    if (todo.has(n)) { dv.setFloat32(e + 1, todo.get(n), true); todo.delete(n); }
  }
  for (const [n, v] of todo) { const r = new Uint8Array(n.length + 5); r.set(Buffer.from(n, 'latin1')); new DataView(r.buffer).setFloat32(n.length + 1, v, true); add.push(r); }
  const len = add.reduce((s, r) => s + r.length, 0), out = new Uint8Array(d.length + len);
  out.set(d.subarray(0, end)); let o = end; for (const r of add) { out.set(r, o); o += r.length; } out.set(d.subarray(end), o);
  const odv = new DataView(out.buffer);
  for (const c of len ? chunkPath(d, end) : []) {
    const v = (c.len + len) * 2 + c.w;
    // shortcut: a length that outgrows its narrow form would need a wider header; never seen around the table yet
    if (!c.w && v >= (c.root ? 0x10000 : 0x100)) throw new Error('Блок с таблицей переменных переполнен — такой сейв не трогаю');
    if (c.w) odv.setUint32(c.at, v, true); else if (c.root) odv.setUint16(0, v, true); else out[c.at] = v;
  }
  return out;
}
