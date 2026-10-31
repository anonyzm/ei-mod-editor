// Binary REG (engine config): magic 0x45AB3EFB, u16 sectionCount, hash table of
// {i16 next, u32 offset} per section; section: u16 keyCount, u16 nameLen, name,
// key table {i16 next, u32 offset rel. to section}; key: u8 type, u16 nameLen, name, value.
// type & 0x7f: 0 int32, 1 float32, 2 string (u16 len); flag 0x80 = array with u16 count.
import { Reader, Writer, cp1251, hashLayout } from './bytes.js';
export const REG_MAGIC = 0x45ab3efb;
export const T_INT = 0, T_FLOAT = 1, T_STR = 2;

// -> [{name, keys: [{name, type, array, values: [...]}]}]
export function readReg(u8) {
  const r = new Reader(u8);
  if (r.u32() !== REG_MAGIC) throw new Error('Не REG-файл');
  const n = r.u16(), slots = [];
  for (let i = 0; i < n; i++) { r.i16(); slots.push(r.u32()); }
  slots.sort((a, b) => a - b); // file order = author's order, stable across saves
  return slots.map(off => {
    r.p = off;
    const kc = r.u16(), name = r.str(r.u16()), koffs = [];
    for (let i = 0; i < kc; i++) { r.i16(); koffs.push(r.u32()); }
    koffs.sort((a, b) => a - b);
    const keys = koffs.map(ko => {
      r.p = off + ko;
      const t = r.u8_(), kname = r.str(r.u16()), array = !!(t & 0x80), type = t & 0x7f;
      const cnt = array ? r.u16() : 1, values = [];
      for (let i = 0; i < cnt; i++) values.push(type === T_INT ? r.i32() : type === T_FLOAT ? r.f32() : r.str(r.u16()));
      return { name: kname, type, array, values };
    });
    return { name, keys };
  });
}

export function writeReg(sections) {
  const bodies = sections.map(sec => {
    const kb = sec.keys.map(k => {
      const kw = new Writer(), nm = cp1251.encode(k.name);
      kw.u8_(k.type | (k.array ? 0x80 : 0)); kw.u16(nm.length); kw.bytes(nm);
      if (k.array) kw.u16(k.values.length);
      for (const v of k.values) {
        if (k.type === T_INT) kw.i32(Math.round(+v || 0));
        else if (k.type === T_FLOAT) kw.f32(+v || 0);
        else { const s = cp1251.encode(String(v)); kw.u16(s.length); kw.bytes(s); }
      }
      return kw.result();
    });
    const w = new Writer(), nm = cp1251.encode(sec.name);
    const { order, next } = hashLayout(sec.keys.map(k => k.name));
    const offs = []; let o = 4 + nm.length + sec.keys.length * 6;
    for (const b of kb) { offs.push(o); o += b.length; }
    w.u16(sec.keys.length); w.u16(nm.length); w.bytes(nm);
    for (let s = 0; s < order.length; s++) { w.i16(next[s]); w.u32(offs[order[s]]); }
    for (const b of kb) w.bytes(b);
    return w.result();
  });
  const w = new Writer();
  w.u32(REG_MAGIC); w.u16(sections.length);
  const { order, next } = hashLayout(sections.map(s => s.name));
  const offs = []; let o = 6 + sections.length * 6;
  for (const b of bodies) { offs.push(o); o += b.length; }
  for (let s = 0; s < order.length; s++) { w.i16(next[s]); w.u32(offs[order[s]]); }
  for (const b of bodies) w.bytes(b);
  return w.result();
}

// INI-like text (what modders know from reg2ini), with type hints: key:i=, key:f=, key[]= for arrays.
export function regToText(sections) {
  const fmt = (k, v) => k.type === T_FLOAT ? String(Math.round(v * 1e6) / 1e6) : String(v);
  const suffix = k => (k.array ? '[]' : '') + (k.type === T_FLOAT ? ':f' : k.type === T_INT ? ':i' : '');
  return sections.map(s => `[${s.name}]\n` + s.keys.map(k =>
    (k.values.length ? k.values.map(v => `${k.name}${suffix(k)}=${fmt(k, v)}`) : [`${k.name}${suffix(k)}=`]).join('\n')
  ).join('\n')).join('\n\n') + '\n';
}

export function textToReg(text) {
  const sections = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const sm = line.match(/^\[(.*)\]$/);
    if (sm) { cur = { name: sm[1], keys: [] }; sections.push(cur); continue; }
    const m = line.match(/^([^=]*?)(\[\])?(?::([if]))?=(.*)$/);
    if (!m || !cur) throw new Error('Не понимаю строку: ' + raw);
    const [, name, arr, t, val] = m;
    const type = t === 'i' ? T_INT : t === 'f' ? T_FLOAT : T_STR;
    let k = arr ? cur.keys.find(x => x.name === name && x.array) : null;
    if (!k) { k = { name, type, array: !!arr, values: [] }; cur.keys.push(k); }
    if (arr && val === '') continue; // "key[]=" alone means an empty array
    k.values.push(type === T_STR ? val : Number(val));
  }
  return sections;
}
