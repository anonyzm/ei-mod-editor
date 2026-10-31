// Little helpers shared by all binary formats. Text in game files is Windows-1251.
const dec = new TextDecoder('windows-1251');
const encTable = (() => {
  const m = new Map();
  const s = dec.decode(new Uint8Array(256).map((_, i) => i));
  for (let i = 0; i < 256; i++) m.set(s[i], i);
  return m;
})();

export const cp1251 = {
  decode: bytes => dec.decode(bytes),
  encode: str => Uint8Array.from(str, ch => encTable.get(ch) ?? 0x3f),
};

export class Reader {
  constructor(u8, off = 0) { this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.p = off; }
  get eof() { return this.p >= this.u8.length; }
  u8_() { return this.u8[this.p++]; }
  i8() { const v = this.dv.getInt8(this.p); this.p += 1; return v; }
  i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
  bytes(n) { const v = this.u8.subarray(this.p, this.p + n); this.p += n; return v; }
  str(n) { return cp1251.decode(this.bytes(n)); }
}

export class Writer {
  constructor(cap = 1024) { this.u8 = new Uint8Array(cap); this.p = 0; this.dv = new DataView(this.u8.buffer); }
  need(n) {
    if (this.p + n <= this.u8.length) return;
    const b = new Uint8Array(Math.max(this.u8.length * 2, this.p + n)); b.set(this.u8);
    this.u8 = b; this.dv = new DataView(b.buffer);
  }
  u8_(v) { this.need(1); this.u8[this.p++] = v; }
  i16(v) { this.need(2); this.dv.setInt16(this.p, v, true); this.p += 2; }
  u16(v) { this.need(2); this.dv.setUint16(this.p, v, true); this.p += 2; }
  i32(v) { this.need(4); this.dv.setInt32(this.p, v, true); this.p += 4; }
  u32(v) { this.need(4); this.dv.setUint32(this.p, v >>> 0, true); this.p += 4; }
  f32(v) { this.need(4); this.dv.setFloat32(this.p, v, true); this.p += 4; }
  bytes(b) { this.need(b.length); this.u8.set(b, this.p); this.p += b.length; }
  result() { return this.u8.slice(0, this.p); }
}

// Same bucket hash the engine uses for RES and REG lookups.
export function nameHash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i) & 0xff;
    h += c >= 65 && c <= 90 ? c + 32 : c;
  }
  return h;
}

// Lay out names into a chained hash table of the same size. Returns {order, next}:
// order[slot] = index into names, next[slot] = next slot in the chain or -1.
export function hashLayout(names) {
  const n = names.length, order = new Array(n).fill(-1), next = new Array(n).fill(-1), pending = [];
  names.forEach((nm, i) => { const b = nameHash(nm) % n; if (order[b] === -1) order[b] = i; else pending.push(i); });
  let free = 0;
  for (const i of pending) {
    while (order[free] !== -1) free++;
    order[free] = i;
    let s = nameHash(names[i]) % n;
    while (next[s] !== -1) s = next[s];
    next[s] = free;
  }
  return { order, next };
}
