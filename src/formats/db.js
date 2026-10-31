// Game database (*.idb, *.udb, *.sdb, *.pdb, *.ldb, *.qdb, prints.db, acks.db inside database.res).
// A file is a tree of nodes: u8 id, size, payload. Size is (n << 1) in one byte when n < 128,
// else ((n << 1) | 1) in 4 bytes. Nesting: file -> root(id 1) -> table(id = BlockID)
// -> record -> field(id = FieldID). TypeList fields hold one more level of sub-fields.
// Field types/headers come from the EIDBEditor descriptors (data/dbschema).
import { cp1251 } from './bytes.js';

function readSize(u8, p) {
  const b = u8[p];
  if (!(b & 1)) return { n: b >> 1, len: 1 };
  const v = (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0;
  return { n: v >>> 1, len: 4 };
}

const subBlock = type => +(type?.match(/^(?:TypeList|AcksUniqueType)\((\d+)\)/)?.[1] || 0);

// -> { nodes, tables: [{ id, name, title, node, records: [recordNode] }] }
export function readDatabase(u8, db) {
  const parse = (start, end, depth, tableId) => {
    const out = [];
    let p = start;
    while (p < end) {
      const id = u8[p];
      const { n, len } = readSize(u8, p + 1);
      const body = p + 1 + len, stop = body + n;
      if (stop > end) throw new Error(`Повреждённая БД: узел ${id} на ${p} выходит за границы`);
      const node = { id, wide: len === 4 };
      const t = depth === 1 ? id : tableId;
      const container = depth === 0 ? id === 1 : depth <= 2 ? true : depth === 3 && !!subBlock(db?.types[t]?.[id]);
      if (container) node.children = parse(body, stop, depth + 1, t);
      else node.data = u8.slice(body, stop);
      out.push(node);
      p = stop;
    }
    return out;
  };
  const nodes = parse(0, u8.length, 0, 0);
  const root = nodes.find(n => n.id === 1 && n.children);
  const tables = (root?.children || []).map(t => {
    const b = db?.blocks[t.id];
    return { id: t.id, name: b?.name || `Block${t.id}`, title: b?.title || `Таблица ${t.id}`, node: t, records: t.children };
  });
  return { nodes, tables };
}

const payloadSize = node => node.children ? node.children.reduce((a, c) => a + nodeSize(c), 0) : node.data.length;
const nodeSize = node => { const n = payloadSize(node); return 1 + (n < 128 && !node.wide ? 1 : 4) + n; };

// Keeps each node's original size width (`wide`) so untouched files roundtrip byte-for-byte.
export function writeDatabase({ nodes }) {
  const out = new Uint8Array(nodes.reduce((a, c) => a + nodeSize(c), 0));
  const put = (list, p) => {
    for (const node of list) {
      const n = payloadSize(node);
      out[p++] = node.id;
      if (n < 128 && !node.wide) out[p++] = n << 1;
      else { const v = ((n << 1) | 1) >>> 0; out[p++] = v & 255; out[p++] = (v >>> 8) & 255; out[p++] = (v >>> 16) & 255; out[p++] = v >>> 24; }
      if (node.children) p = put(node.children, p);
      else { out.set(node.data, p); p += node.data.length; }
    }
    return p;
  };
  put(nodes, 0);
  return out;
}

// ---- schema (parsed from the EIDBEditor descriptor texts) ----
export function parseSchema({ dbfiles, dbblocks, dbtypes, dbheaders }) {
  const rows = t => t.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const dbs = {};
  for (const l of rows(dbfiles)) {
    const [id, name, mask] = l.split('\t');
    dbs[name] = { id: +id, name, mask, blocks: {}, types: {}, headers: {} };
  }
  for (const l of rows(dbblocks)) {
    const [db, bid, name, , title] = l.split('\t');
    if (dbs[db]) dbs[db].blocks[+bid] = { id: +bid, name, title: title || name };
  }
  const sections = (text, fn) => {
    let cur = null;
    for (const l of rows(text)) {
      const m = l.match(/^\[(.+)\]/);
      if (m) { cur = dbs[m[1]]; continue; }
      if (cur) fn(cur, l.split('\t'));
    }
  };
  sections(dbtypes, (db, [b, f, type]) => { (db.types[+b] ??= {})[+f] = type.trim(); });
  sections(dbheaders, (db, [b, f, idx, , name, desc]) => {
    ((db.headers[+b] ??= {})[+f] ??= [])[+idx] = { name: name?.trim(), desc: desc?.trim() };
  });
  return dbs;
}

export function dbForFile(schema, fileName) {
  const f = fileName.toLowerCase();
  return Object.values(schema).find(db => {
    const mask = db.mask.toLowerCase();
    return mask.startsWith('*') ? f.endsWith(mask.slice(1)) : f === mask;
  });
}

// ---- field values <-> editable text ----
// Shortest decimal that maps back to the same float32 bits.
export function f32ToStr(v) {
  for (let p = 1; p < 10; p++) { const s = Number(v.toPrecision(p)); if (Math.fround(s) === v) return String(s); }
  return String(v);
}

export function fieldToText(type = 'Hex', data) {
  const base = type.replace(/\(.*$/, '');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const words = fn => Array.from({ length: data.length >> 2 }, (_, i) => fn(i * 4)).join(', ');
  switch (base) {
    case 'String': case 'FixedString': return cp1251.decode(data).replace(/\0+$/, '');
    case 'StringList': return cp1251.decode(data).replace(/\0+$/, '').replace(/,/g, ';');
    case 'MinfixedStringList': return cp1251.decode(data).split('\0').filter(Boolean).join('; ');
    case 'UnsignedLong': return data.length === 4 ? String(dv.getUint32(0, true)) : hex(data);
    case 'SignedLong': return data.length === 4 ? String(dv.getInt32(0, true)) : hex(data);
    case 'UnsignedLongList': return words(i => dv.getUint32(i, true));
    case 'Float': return data.length === 4 ? f32ToStr(dv.getFloat32(0, true)) : hex(data);
    case 'FloatList': return words(i => f32ToStr(dv.getFloat32(i, true)));
    case 'Byte': case 'BitByte': return data.length === 1 ? String(data[0]) : hex(data);
    case 'ByteList': return Array.from(data).join(', ');
    case 'BitList': return Array.from({ length: data.length * 8 }, (_, i) => (data[i >> 3] >> (i & 7)) & 1).join('');
    default: return hex(data);
  }
}

export function textToField(type = 'Hex', text, old) {
  const base = type.replace(/\(.*$/, ''), arg = +(type.match(/\((\d+)\)/)?.[1] || 0);
  const nums = () => text.split(/[,;\s]+/).filter(Boolean).map(Number);
  const pack = (vals, put) => { const out = new Uint8Array(vals.length * 4); const dv = new DataView(out.buffer); vals.forEach((v, i) => put(dv, i * 4, v)); return out; };
  switch (base) {
    case 'String': return cat(cp1251.encode(text), [0]);
    case 'FixedString': { const s = cp1251.encode(text); const out = new Uint8Array(Math.max(arg, s.length + 1)); out.set(s); return out; }
    case 'StringList': return cat(cp1251.encode(text.replace(/;\s*/g, ',')), [0]);
    case 'MinfixedStringList': {
      const parts = text.split(';').map(s => s.trim()).filter(Boolean).map(s => { const b = cp1251.encode(s); const o = new Uint8Array(Math.max(arg, b.length + 1)); o.set(b); return o; });
      return cat(...parts);
    }
    case 'UnsignedLong': case 'UnsignedLongList': return pack(nums(), (dv, i, v) => dv.setUint32(i, v >>> 0, true));
    case 'SignedLong': return pack(nums(), (dv, i, v) => dv.setInt32(i, v | 0, true));
    case 'Float': case 'FloatList': return pack(nums(), (dv, i, v) => dv.setFloat32(i, v, true));
    case 'Byte': case 'BitByte': case 'ByteList': return Uint8Array.from(nums(), v => v & 255);
    case 'BitList': {
      const bits = text.replace(/[^01]/g, ''), out = new Uint8Array(Math.max(old?.length || 0, Math.ceil(bits.length / 8)));
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') out[i >> 3] |= 1 << (i & 7);
      return out;
    }
    default: { const h = text.replace(/[^0-9a-f]/gi, ''); return Uint8Array.from({ length: h.length >> 1 }, (_, i) => parseInt(h.substr(i * 2, 2), 16)); }
  }
}

// What the UI should show: the typed text if it converts back exactly, otherwise raw hex.
export function fieldView(type, data) {
  const text = fieldToText(type, data);
  const back = textToField(type, text, data);
  const exact = back.length === data.length && back.every((b, i) => b === data[i]);
  return exact ? { type: type || 'Hex', text } : { type: 'Hex', text: hex(data) };
}

function cat(...parts) { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const hex = d => Array.from(d, b => b.toString(16).padStart(2, '0')).join(' ');
