// RES archive (Nival): header {magic 0x019CE23C, count, tableOffset, namesLength},
// then 22-byte entries {next i32, size, offset, time, nameLen u16, nameOffset}, then names blob.
// Entries form a hash table: bucket = nameHash(name) % count, chained via `next`.
import { nameHash, hashLayout } from './bytes.js';
export const RES_MAGIC = 0x019ce23c;
export const resHash = nameHash;

export function isRes(buf) {
  return buf.byteLength >= 16 && new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true) === RES_MAGIC;
}

// Names stay raw byte strings (latin1) so any non-ASCII name roundtrips untouched.
export function readRes(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== RES_MAGIC) throw new Error('Не RES-архив');
  const count = dv.getUint32(4, true), table = dv.getUint32(8, true);
  const namesAt = table + count * 22;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const p = table + i * 22;
    const size = dv.getUint32(p + 4, true), offset = dv.getUint32(p + 8, true);
    const time = dv.getUint32(p + 12, true);
    const nameLen = dv.getUint16(p + 16, true), nameOff = dv.getUint32(p + 18, true);
    const name = latin(buf.subarray(namesAt + nameOff, namesAt + nameOff + nameLen));
    entries.push({ name, time, data: buf.subarray(offset, offset + size) });
  }
  return entries;
}

export function writeRes(entries) {
  const n = entries.length;
  const names = entries.map(e => fromLatin(e.name));
  const { order, next } = hashLayout(entries.map(e => e.name));
  const namesLen = names.reduce((a, b) => a + b.length, 0);
  const pad = n => (n + 15) & ~15; // the original packer aligns every file to 16 bytes
  let dataLen = 0;
  for (const e of entries) dataLen += pad(e.data.length);
  const tableOff = 16 + dataLen;
  const out = new Uint8Array(tableOff + n * 22 + namesLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, RES_MAGIC, true); dv.setUint32(4, n, true);
  dv.setUint32(8, tableOff, true); dv.setUint32(12, namesLen, true);
  const offsets = [];
  let p = 16;
  for (const e of entries) { out.set(e.data, p); offsets.push(p); p += pad(e.data.length); }
  let nameOff = 0;
  const nameOffs = names.map(nm => { const o = nameOff; nameOff += nm.length; return o; });
  const now = Math.floor(Date.now() / 1000);
  for (let s = 0; s < n; s++) {
    const i = order[s], q = tableOff + s * 22;
    dv.setInt32(q, next[s], true);
    dv.setUint32(q + 4, entries[i].data.length, true);
    dv.setUint32(q + 8, offsets[i], true);
    dv.setUint32(q + 12, entries[i].time ?? now, true);
    dv.setUint16(q + 16, names[i].length, true);
    dv.setUint32(q + 18, nameOffs[i], true);
    out.set(names[i], tableOff + n * 22 + nameOffs[i]);
  }
  return out;
}

export function latin(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s; }
export function fromLatin(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; }
