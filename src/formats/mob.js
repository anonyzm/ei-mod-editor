// MOB (map objects): a tree of chunks {u32 id, u32 size incl. 8-byte header, payload}.
// Containers are a known id set; every other chunk is kept as raw bytes, so unknown data
// survives a load/save untouched. Typed accessors below cover the fields the editor edits.
import { cp1251 } from './bytes.js';

export const CONTAINERS = new Set([
  0xa000, 0x1e00, 0x1e01, 0x1e02, 0x1e03, 0x1e0b, 0x1e0e, 0xabd0, 0xb000, 0xb001, 0xaa01,
  0xbbab0000, 0xbbac0000, 0xbbbb0000, 0xbbbc0000, 0xbbbd0000, 0xbbbe0000, 0xbbbf0000,
  0xcc01, 0xdd01, 0xddddddd1, 0xe000, 0xe001, 0xf000, 0xff00, 0xff01, 0xff02,
]);

export const SCRIPT_IDS = [0xacceeccb, 0xacceecca];

// Kinds of placeable things: chunk id -> human name. All share the b0xx object fields.
export const KINDS = {
  0xb001: 'Объект', 0xbbbb0000: 'Существо', 0xbbab0000: 'Рычаг', 0xbbac0000: 'Ловушка',
  0xbbbf0000: 'Огонь/эффект', 0xaa01: 'Свет', 0xcc01: 'Звук', 0xdd01: 'Частицы',
};

export function readMob(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const parse = (start, end) => {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
      const id = dv.getUint32(p, true), size = dv.getUint32(p + 4, true);
      if (size < 8 || p + size > end) throw new Error(`MOB повреждён: чанк ${id.toString(16)} на ${p}`);
      out.push(CONTAINERS.has(id) ? { id, children: parse(p + 8, p + size) } : { id, data: u8.slice(p + 8, p + size) });
      p += size;
    }
    if (p !== end) out.push({ id: -1, tail: u8.slice(p, end) }); // stray bytes, kept verbatim
    return out;
  };
  return { chunks: parse(0, u8.length) };
}

const sizeOf = c => c.tail ? c.tail.length : 8 + (c.children ? c.children.reduce((a, x) => a + sizeOf(x), 0) : c.data.length);

export function writeMob(mob) {
  const out = new Uint8Array(mob.chunks.reduce((a, c) => a + sizeOf(c), 0));
  const dv = new DataView(out.buffer);
  const put = (list, p) => {
    for (const c of list) {
      if (c.tail) { out.set(c.tail, p); p += c.tail.length; continue; }
      dv.setUint32(p, c.id >>> 0, true); dv.setUint32(p + 4, sizeOf(c), true);
      if (c.children) put(c.children, p + 8); else out.set(c.data, p + 8);
      p += sizeOf(c);
    }
    return p;
  };
  put(mob.chunks, 0);
  return out;
}

// ---- tree helpers ----
export const child = (c, id) => c.children?.find(x => x.id === id);
export function walk(list, fn, parent = null) {
  for (const c of list) { fn(c, parent); if (c.children) walk(c.children, fn, c); }
}

// ---- script (XOR stream with an LCG key stored in the first 4 bytes) ----
function crypt(bytes, key) {
  for (let i = 0; i < bytes.length; i++) {
    key = (key + Math.imul((((Math.imul(key, 13) << 4) + key) << 8) - key, 4) + 2531011) >>> 0;
    bytes[i] ^= (key >>> 16) & 0xff;
  }
  return bytes;
}
export function decodeScript(data) {
  const key = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
  return cp1251.decode(crypt(data.slice(4), key));
}
export function encodeScript(text, key = 0x296c) {
  const body = crypt(cp1251.encode(text), key);
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, key, true);
  out.set(body, 4);
  return out;
}
export function getScript(mob) {
  const root = mob.chunks.find(c => c.id === 0xa000);
  const s = root?.children.find(c => SCRIPT_IDS.includes(c.id));
  if (!s) return null;
  return s.id === 0xacceecca ? cp1251.decode(s.data) : decodeScript(s.data); // ACCEECCA is plain text (zone20, main menu)
}
export function setScript(mob, text) {
  const root = mob.chunks.find(c => c.id === 0xa000);
  const s = root.children.find(c => SCRIPT_IDS.includes(c.id));
  if (s?.id === 0xacceecca) { s.data = cp1251.encode(text); return; }
  const key = s ? new DataView(s.data.buffer, s.data.byteOffset, 4).getUint32(0, true) : 0x296c;
  if (s) s.data = encodeScript(text, key); else root.children.splice(1, 0, { id: 0xacceeccb, data: encodeScript(text, key) });
}

// ---- typed leaf codecs ----
const f32s = (d, n) => { const dv = new DataView(d.buffer, d.byteOffset, d.byteLength); return Array.from({ length: n }, (_, i) => d.length >= (i + 1) * 4 ? dv.getFloat32(i * 4, true) : 0); };
const packF = vals => { const o = new Uint8Array(vals.length * 4), dv = new DataView(o.buffer); vals.forEach((v, i) => dv.setFloat32(i * 4, v, true)); return o; };
const u32 = d => d.length >= 4 ? new DataView(d.buffer, d.byteOffset, 4).getUint32(0, true) : 0;
const packU32 = v => { const o = new Uint8Array(4); new DataView(o.buffer).setUint32(0, v >>> 0, true); return o; };

export const codec = {
  str: { get: d => cp1251.decode(d), set: v => cp1251.encode(v) },
  u32: { get: u32, set: packU32 },
  u8: { get: d => d[0] ?? 0, set: v => Uint8Array.of(v & 255) },
  vec3: { get: d => f32s(d, 3), set: packF },
  quat: { get: d => f32s(d, 4), set: packF },
  f32: { get: d => f32s(d, 1)[0], set: v => packF([v]) },
  // StringArray: u32 count, then count sub-chunks {u32 id, u32 size, cp1251 bytes}; id repeats the parent's.
  strarr: {
    get: d => { const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), out = []; let p = 4;
      for (let i = 0, n = d.length >= 4 ? dv.getUint32(0, true) : 0; i < n && p + 8 <= d.length; i++) { const sz = dv.getUint32(p + 4, true); out.push(cp1251.decode(d.subarray(p + 8, p + sz))); p += sz; }
      return out; },
    set: (list, id) => { const parts = list.map(s => cp1251.encode(s)), out = new Uint8Array(4 + parts.reduce((a, b) => a + 8 + b.length, 0)), dv = new DataView(out.buffer);
      dv.setUint32(0, parts.length, true); let p = 4;
      for (const b of parts) { dv.setUint32(p, id >>> 0, true); dv.setUint32(p + 4, 8 + b.length, true); out.set(b, p + 8); p += 8 + b.length; }
      return out; },
  },
};

// Common object fields (b0xx), shared by objects, units, levers, traps...
export const OBJ = {
  id: [0xb002, 'u32'], type: [0xb003, 'u32'], name: [0xb004, 'str'], model: [0xb006, 'str'],
  prototype: [0xb00e, 'str'], texture: [0xb007, 'str'], texture2: [0xb008, 'str'],
  parentTemplate: [0xb00f, 'str'], pos: [0xb009, 'vec3'], rot: [0xb00a, 'quat'],
  complection: [0xb00c, 'vec3'], player: [0xb011, 'u8'], parentId: [0xb012, 'u32'],
  useInScript: [0xb013, 'u8'], visible: [0xb014, 'u8'],
};
export const UNIT = {
  unitPrototype: [0xbbbb0002, 'str'], armors: [0xbbbb0009, 'strarr'], weapons: [0xbbbb0008, 'strarr'], spells: [0xbbbb0007, 'strarr'],
  quickItems: [0xbbbb0006, 'strarr'], questItems: [0xbbbb0005, 'strarr'], bodyParts: [0xb00d, 'strarr'],
};
export const QUEST_INFO = [0xb016, 'str'];

export function getField(node, [id, type]) {
  const c = child(node, id);
  return c ? codec[type].get(c.data) : undefined;
}
export function setField(node, [id, type], value) {
  let c = child(node, id);
  if (!c) { c = { id, data: new Uint8Array(0) }; node.children.push(c); }
  c.data = codec[type].set(value, id);
}

// Flat list of everything placeable: [{node, kind, kindName, parent}]
export function listObjects(mob) {
  const out = [];
  walk(mob.chunks, (c, parent) => { if (KINDS[c.id] && child(c, 0xb009)) out.push({ node: c, kind: c.id, kindName: KINDS[c.id], parent }); });
  return out;
}

// Patrol route of a unit (game.exe 0x5D67D2, New EI ei/logic.go): every bbbd0000 block of the behaviour block bbbc0000 is
// ONE ROUTE POINT (bbbd0001 = its place); its bbbe0000 children are the looks taken there — where to look (bbbe0001, a spot
// 1…4 m away on the originals) and for how long (bbbe0002, ticks). Until 2026-11-17 the editor took the looks for the
// waypoints and wrote a whole route into one block: such a creature stands still and turns its head (legacyRoute finds them).
// Returned shape is kept for the views: { node: the behaviour block, guard: null, points: [{ node: the bbbd0000 block, … }] }.
const lookOf = p => child(p, 0xbbbe0000);
export function getPatrols(unit) {
  const out = [];
  for (const logic of unit.children.filter(c => c.id === 0xbbbc0000)) {
    const nodes = logic.children.filter(c => c.id === 0xbbbd0000);
    if (!nodes.length) continue;
    out.push({ node: logic, guard: null, points: nodes.map(p => { const w = lookOf(p); return {
      node: p, pos: codec.vec3.get(child(p, 0xbbbd0001).data),
      wait: w ? codec.u32.get(child(w, 0xbbbe0002)?.data || new Uint8Array(4)) : 0,
      // meaning unknown; originals: 0 almost always, 5/30 on a few archers and elementals
      param: w && child(w, 0xbbbe0003) ? codec.f32.get(child(w, 0xbbbe0003).data) : 0,
      flag: (w && child(w, 0xbbbe0004)?.data[0]) ?? 0,
      looks: p.children.filter(c => c.id === 0xbbbe0000).length,
    }; }) });
  }
  return out;
}
// A route written the old way: one block whose "looks" lie far from it. Returns them as the intended points, or null.
export function legacyRoute(unit) {
  const logic = unit.children.find(c => c.id === 0xbbbc0000), nodes = logic?.children.filter(c => c.id === 0xbbbd0000) || [];
  if (nodes.length !== 1) return null;
  const at = codec.vec3.get(child(nodes[0], 0xbbbd0001).data), looks = nodes[0].children.filter(c => c.id === 0xbbbe0000).map(w => ({ pos: codec.vec3.get(child(w, 0xbbbe0001).data), wait: codec.u32.get(child(w, 0xbbbe0002)?.data || new Uint8Array(4)) }));
  return looks.length > 1 || looks.some(l => Math.hypot(l.pos[0] - at[0], l.pos[1] - at[1]) > 5) ? looks : null;
}
const newLook = (pos, wait, param, flag) => ({ id: 0xbbbe0000, children: [
  { id: 0xbbbe0001, data: codec.vec3.set(pos) }, { id: 0xbbbe0002, data: codec.u32.set(wait) },
  { id: 0xbbbe0003, data: codec.f32.set(param) }, { id: 0xbbbe0004, data: Uint8Array.of(flag ? 1 : 0) },
] });
// A route point with one look (2 m to the north until aimLooks turns it along the route).
export function newWaypoint(pos, wait = 15, param = 0, flag = 0) {
  return { id: 0xbbbd0000, children: [{ id: 0xbbbd0001, data: codec.vec3.set(pos) }, newLook([pos[0], pos[1] + 2, pos[2]], wait, param, flag)] };
}
// Change a route point in place ({pos, wait, param, flag}, any subset): its looks move with it; wait/param/flag are its first look's.
export function setWaypoint(p, { pos, wait, param, flag }) {
  if (pos) { const at = child(p, 0xbbbd0001), old = codec.vec3.get(at.data), d = [pos[0] - old[0], pos[1] - old[1], pos[2] - old[2]];
    at.data = codec.vec3.set(pos);
    for (const w of p.children.filter(c => c.id === 0xbbbe0000)) { const k = child(w, 0xbbbe0001), v = codec.vec3.get(k.data); k.data = codec.vec3.set([v[0] + d[0], v[1] + d[1], v[2] + d[2]]); } }
  if (wait === undefined && param === undefined && flag === undefined) return;
  let w = lookOf(p); if (!w) { const at = codec.vec3.get(child(p, 0xbbbd0001).data); w = newLook([at[0], at[1] + 2, at[2]], 15, 0, 0); p.children.push(w); }
  const put = (id, data) => { const c = child(w, id); if (c) c.data = data; else w.children.push({ id, data }); };
  if (wait !== undefined) put(0xbbbe0002, codec.u32.set(Math.max(0, Math.round(wait))));
  if (param !== undefined) put(0xbbbe0003, codec.f32.set(+param));
  if (flag !== undefined) put(0xbbbe0004, Uint8Array.of(flag ? 1 : 0));
}
// Points with a single look glance on along the route (towards the next point; the last one back at the first).
export function aimLooks(logic) {
  const nodes = logic.children.filter(c => c.id === 0xbbbd0000);
  nodes.forEach((p, i) => { const ls = p.children.filter(c => c.id === 0xbbbe0000); if (ls.length !== 1 || nodes.length < 2) return;
    const at = codec.vec3.get(child(p, 0xbbbd0001).data), to = codec.vec3.get(child(nodes[(i + 1) % nodes.length], 0xbbbd0001).data), l = Math.hypot(to[0] - at[0], to[1] - at[1]);
    if (l > 0.1) child(ls[0], 0xbbbe0001).data = codec.vec3.set([at[0] + (to[0] - at[0]) / l * 2, at[1] + (to[1] - at[1]) / l * 2, at[2]]); });
}

// Deep copy (for duplicating objects).
export function cloneChunk(c) {
  return c.children ? { id: c.id, children: c.children.map(cloneChunk) } : c.tail ? { id: -1, tail: c.tail.slice() } : { id: c.id, data: c.data.slice() };
}

// A base (brief zone) finds who offers briefing b.<name>.<id> by object id, not by name: game.exe 0x461360
// hashes the name as h = h*5 + toupper(c) (u32) and takes h % 1e9 + 1e9 (Elder 1000054752, OLiz 1000012230).
export function briefingUnitId(name) {
  let h = 0;
  for (const b of cp1251.encode(name)) h = (h * 5 + (b >= 0x61 && b <= 0x7a ? b - 32 : b)) >>> 0;
  return h % 1e9 + 1e9;
}

export function maxObjectId(mob) {
  let m = 0;
  // ids from 1e9 up are name hashes of base NPCs (briefingUnitId), not part of the running numbering
  walk(mob.chunks, c => { if (c.id === 0xb002) { const v = codec.u32.get(c.data); if (v < 1e9) m = Math.max(m, v); } });
  return m;
}
