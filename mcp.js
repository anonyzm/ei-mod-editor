// MCP server (stdio, JSON-RPC 2.0, one message per line) giving AI agents every editor function:
// maps, objects, patrols, scripts, terrain, database, texts, quests, zones, models, textures, backups.
// Same safety as the browser editor: backups before the first write, nothing outside the game folder.
// Docs for agents: MCP.md. Run: node mcp.js (stdout is the protocol; logs go to stderr).
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { HERE, GAME, BACKUP, gamePath, loadRes, resEntry, resUpdate, readGameFile, saveGameFile, listDir, listBackups, restore } from './src/game.js';
import { cp1251 } from './src/formats/bytes.js';
import { readRes } from './src/formats/res.js';
import { readReg, writeReg, regToText, textToReg } from './src/formats/reg.js';
import { parseSchema, dbForFile, readDatabase, writeDatabase, fieldView, textToField } from './src/formats/db.js';
import * as M from './src/formats/mob.js';
import { readMpr, writeMpr, updateNormals, markDirty, heightAt, packNormal, TILE_TYPES } from './src/formats/mpr.js';
import { decodeMmp, mmpInfo, encodeMmpArgb8 } from './src/formats/mmp.js';
import { readModel, writeModel, readFig, writeFig, readLnk, writeLnk } from './src/formats/fig.js';
import { objToParts } from './src/formats/obj.js';
import { AIGRAPH_ID, readAiGraph, writeAiGraph, buildAiGraph, modelBox, objectRect } from './src/formats/aigraph.js';
import { loadWorld, saveWorld, createZone, directive, exitsOf, ISLAND } from './src/shared/world.js';
import { gameCatalog, setupUnit, setupObject, raceTexture } from './src/shared/catalog.js';
import { encodePng, decodePng, resizeRgba } from './src/png.js';

// ---------------- game access ----------------
const modelCache = new Map();
async function loadModelData(name) {
  const key = String(name || '').toLowerCase();
  if (!key) return null;
  if (!modelCache.has(key)) {
    let data = null;
    try { data = readModel(resEntry('Res/figures.res', key + '.mod'), (() => { try { return resEntry('Res/figures.res', key + '.bon'); } catch { return null; } })(), key); } catch { /* missing model */ }
    modelCache.set(key, data);
  }
  return modelCache.get(key);
}
const io = {
  file: async rel => readGameFile(rel), saveFile: async (rel, d) => saveGameFile(rel, d),
  resList: async rel => loadRes(gamePath(rel)).map(e => ({ name: e.name, size: e.data.length })),
  resEntry: async (rel, n) => resEntry(rel, n), resUpdate: async (rel, put, rm) => resUpdate(rel, put, rm), loadModelData,
};
const exists = rel => fs.existsSync(gamePath(rel));
const r2 = v => Math.round(v * 100) / 100;
const fail = msg => { throw new Error(msg); };

const SRC = { sp: ['Res/database.res', 'Res/texts.res'], mp: ['Res/databaselmp.res', 'Res/textslmp.res'] };
const srcOf = s => SRC[s || 'sp'] || fail('source: sp (одиночная) или mp (сетевая)');
const TEX_SRC = { textures: 'Res/textures.res', redress: 'Res/redress.res', menus: 'Res/menus.res' };

// "zone1", "zone1.mob", "Maps/zone1.mob" -> "Maps/zone1.mob"
const mapRel = (name, ext) => 'Maps/' + String(name || fail(`Не указан файл .${ext}`)).replace(/^maps[\\/]/i, '').replace(/\.(mob|mpr)$/i, '') + '.' + ext;

// zone12dm1.mob -> zone12.mpr; z3q1.mob -> zone3obr.mpr (same rule as the map view).
function guessMpr(mobRel) {
  const mprs = listDir('Maps').filter(f => /\.mpr$/i.test(f));
  const base = path.basename(mobRel).replace(/\.mob$/i, '').toLowerCase();
  const names = mprs.map(m => m.replace(/\.mpr$/i, '').toLowerCase()).sort((a, b) => b.length - a.length);
  const q = base.match(/^z(\d+)q\d+$/), key = q ? 'zone' + q[1] : base;
  const n = names.find(n => key === n) || names.find(n => key.startsWith(n)) || names.find(n => n.startsWith(key.replace(/[-_].*$/, ''))) || names.find(n => n.startsWith(key.slice(0, 5)));
  return n ? `Maps/${n}.mpr` : null;
}
const loadMap = rel => rel && exists(rel) ? readMpr(readGameFile(rel)) : null;

function groundZ(map, x, y) {
  if (!map) return 0;
  const xi = Math.max(0, Math.min(map.W - 2, Math.floor(x))), yi = Math.max(0, Math.min(map.H - 2, Math.floor(y))), fx = x - xi, fy = y - yi;
  const z = (i, j) => heightAt(map, (yi + j) * map.W + xi + i);
  return (z(0, 0) * (1 - fx) + z(1, 0) * fx) * (1 - fy) + (z(0, 1) * (1 - fx) + z(1, 1) * fx) * fy;
}

// ---------------- database ----------------
let schemaCache;
const schema = () => (schemaCache ??= parseSchema(Object.fromEntries(['dbfiles', 'dbblocks', 'dbtypes', 'dbheaders'].map(n => [n, fs.readFileSync(path.join(HERE, 'data', 'dbschema', n + '.txt'), 'utf8')]))));
function loadDb(source) {
  const res = srcOf(source)[0], S = schema(), files = new Map();
  for (const e of loadRes(gamePath(res))) {
    const db = dbForFile(S, e.name);
    if (db && !e.name.endsWith('.adb')) files.set(e.name.toLowerCase(), { name: e.name, db, data: readDatabase(e.data, db) });
  }
  return { res, files };
}
function dbTable(D, file, table) {
  const f = D.files.get(String(file || '').toLowerCase()) || fail(`Нет файла ${file}. Есть: ${[...D.files.keys()].join(', ')}`);
  const t = f.data.tables.find(x => x.id === +table || x.name.toLowerCase() === String(table).toLowerCase()) || fail(`Нет таблицы ${table} в ${file}. Есть: ${f.data.tables.map(x => `${x.id} ${x.name}`).join(', ')}`);
  return { f, t, db: f.db };
}
const dbType = (db, bid, fid) => db.types[bid]?.[fid];
const dbHeader = (db, bid, fid) => db.headers[bid]?.[fid]?.[0];
function recName(db, t, rec) { const f = rec.children?.find(c => c.data && /^(Fixed)?String$/.test(dbType(db, t.id, c.id) || '')); return f ? fieldView('String', f.data).text : ''; }
function dbRecord(db, t, record) {
  if (typeof record === 'number' || /^\d+$/.test(String(record))) return t.records[+record] || fail(`Нет записи №${record} (всего ${t.records.length})`);
  return t.records.find(r => recName(db, t, r).toLowerCase() === String(record).toLowerCase()) || fail(`Нет записи «${record}» в ${t.name}`);
}
function recordFields(db, t, rec) {
  return rec.children.map(n => {
    const hd = dbHeader(db, t.id, n.id), out = { id: n.id, name: hd?.name || `field${n.id}`, ...(hd?.desc ? { desc: hd.desc } : {}) };
    if (n.children) {
      const sub = +(dbType(db, t.id, n.id)?.match(/\((\d+)\)/)?.[1] || 0);
      out.sub = n.children.filter(c => c.data).map(c => ({ id: c.id, name: db.headers[sub]?.[c.id]?.[0]?.name || `field${c.id}`, ...fieldView(dbType(db, sub, c.id), c.data) }));
      return out;
    }
    return { ...out, ...fieldView(dbType(db, t.id, n.id), n.data) };
  });
}
function findField(db, bid, list, key) {
  return list.find(c => String(c.id) === String(key)) || list.find(c => (db.headers[bid]?.[c.id]?.[0]?.name || '').toLowerCase() === String(key).toLowerCase());
}
const saveDb = (D, f) => resUpdate(D.res, [{ name: f.name, data: writeDatabase(f.data) }]);

// Monsters/NPCs with their race model and texture (same as public/lib/gamedb.js units()).
function unitPrototypes() {
  const D = loadDb('sp'), f = D.files.get('units.udb'), db = f.db, d = f.data;
  const val = (rec, tid, fid) => { const c = rec.children.find(x => x.id === fid); return c?.data ? fieldView(db.types[tid][fid], c.data).text : ''; };
  const races = new Map(d.tables.find(x => x.id === 2).records.map(r => [val(r, 2, 0).toLowerCase(), { model: val(r, 2, 30), textures: [raceTexture(val(r, 2, 30), val(r, 2, 31))] }]));
  const out = [];
  for (const r of d.tables.find(x => x.id === 3).records) {
    const race = races.get(val(r, 3, 1).toLowerCase()) || {}, cx = [5, 6, 7].map(i => +val(r, 3, i));
    out.push({ name: val(r, 3, 0), kind: 'monster', race: val(r, 3, 1), model: race.model, texture: race.textures?.[0], complection: cx.every(Number.isFinite) ? cx : null });
  }
  const byName = new Map(out.map(p => [p.name.toLowerCase(), p]));
  for (const r of d.tables.find(x => x.id === 4).records) { const n = val(r, 4, 0); out.push({ ...byName.get(n.toLowerCase()), name: n, kind: 'npc' }); }
  return out.filter(u => u.name);
}

// Object templates + static object catalog from the zone maps (built once, ~1 s).
let catalogP;
const catalog = () => (catalogP ??= gameCatalog(async rel => readGameFile(rel), listDir('Maps')));

// ---------------- map objects ----------------
const UNIT = 0xbbbb0000;
const KIND = { object: 0xb001, unit: UNIT, lever: 0xbbab0000, trap: 0xbbac0000, effect: 0xbbbf0000, light: 0xaa01, sound: 0xcc01, particles: 0xdd01 };
const kindKey = id => Object.keys(KIND).find(k => KIND[k] === id);
const yawOf = q => r2(Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3])) * 180 / Math.PI);
const yawQuat = deg => { const a = deg * Math.PI / 360; return [Math.cos(a), 0, 0, Math.sin(a)]; };
function objSummary(o) {
  const g = s => M.getField(o.node, s), p = g(M.OBJ.pos) || [0, 0, 0];
  return { id: g(M.OBJ.id), kind: kindKey(o.kind), name: g(M.OBJ.name) || '', prototype: g(M.OBJ.prototype) || '', ...(o.kind === UNIT ? { unit: g(M.UNIT.unitPrototype) || '' } : {}),
    model: g(M.OBJ.model) || '', pos: p.map(r2), yaw: yawOf(g(M.OBJ.rot) || [1, 0, 0, 0]) };
}
function objDetails(o) {
  const g = s => M.getField(o.node, s), out = { ...objSummary(o), texture: g(M.OBJ.texture) || '', complection: (g(M.OBJ.complection) || []).map(r2), player: g(M.OBJ.player), quest_info: g(M.QUEST_INFO) || '', visible: g(M.OBJ.visible), use_in_script: g(M.OBJ.useInScript) };
  if (o.kind === UNIT) {
    for (const [k, s] of Object.entries({ weapons: M.UNIT.weapons, armors: M.UNIT.armors, spells: M.UNIT.spells, quick_items: M.UNIT.quickItems, quest_items: M.UNIT.questItems })) out[k] = g(s) || [];
    out.patrols = M.getPatrols(o.node).map(p => ({ guard: p.guard?.map(r2) || null, points: p.points.map(w => ({ pos: w.pos.map(r2), wait: w.wait, param: r2(w.param), flag: w.flag })) }));
  }
  return out;
}
const findObj = (mob, id) => M.listObjects(mob).find(o => M.getField(o.node, M.OBJ.id) === +id) || fail(`Нет объекта с id ${id}`);

// Placed object -> AI graph nodes (4x4 m) to rebuild around it.
async function objRect(o) {
  const data = await loadModelData(M.getField(o.node, M.OBJ.model)), box = data && modelBox(data);
  return box ? objectRect(box, M.getField(o.node, M.OBJ.pos), M.getField(o.node, M.OBJ.rot) || undefined) : null;
}
function markArea(set, map, x0, y0, x1, y1) {
  if (!map) return;
  const W = map.sx * 8, H = map.sy * 8;
  for (let y = Math.max(0, Math.floor(y0 / 4)); y <= Math.min(H - 1, Math.floor(y1 / 4)); y++)
    for (let x = Math.max(0, Math.floor(x0 / 4)); x <= Math.min(W - 1, Math.floor(x1 / 4)); x++) set.add(y * W + x);
}
async function markObj(set, map, o) {
  if (o.kind === UNIT) return; // creatures do not block paths
  const r = await objRect(o), p = M.getField(o.node, M.OBJ.pos);
  if (!r) return markArea(set, map, p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3);
  const ex = Math.abs(r.c) * r.hx + Math.abs(r.s) * r.hy, ey = Math.abs(r.s) * r.hx + Math.abs(r.c) * r.hy;
  markArea(set, map, r.x - ex - 2, r.y - ey - 2, r.x + ex + 2, r.y + ey + 2);
}
// Rebuild the marked part of the mob's path graph (only zone base mobs have one). Returns nodes rebuilt.
async function updateGraph(mob, map, set) {
  const ch = mob.chunks.find(c => c.id === AIGRAPH_ID);
  if (!ch || !map || !set.size) return 0;
  const base = readAiGraph(ch.data);
  if (base.W !== map.sx * 8 || base.H !== map.sy * 8) return 0;
  const rects = (await Promise.all(M.listObjects(mob).filter(o => o.kind !== UNIT).map(objRect))).filter(Boolean);
  ch.data = writeAiGraph(buildAiGraph(map, rects, { base, dirty: (x, y) => set.has(y * base.W + x) }));
  return set.size;
}

// Load mob (+ its landscape), run fn, rebuild path graph where objects changed, save.
async function editMob(a, fn) {
  const rel = mapRel(a.mob, 'mob'), mob = M.readMob(readGameFile(rel));
  const mprRel = a.mpr ? mapRel(a.mpr, 'mpr') : guessMpr(rel), map = loadMap(mprRel), dirty = new Set();
  const out = await fn({ mob, map, dirty, mark: o => markObj(dirty, map, o), gz: (x, y) => groundZ(map, x, y) });
  const n = await updateGraph(mob, map, dirty);
  saveGameFile(rel, M.writeMob(mob));
  return { ...out, saved: rel, ...(n ? { path_graph_nodes_rebuilt: n } : {}), ...(map ? {} : { warning: 'Ландшафт не найден — укажите mpr; высоты точек патруля посчитаны как 0' }) };
}

function applyObjFields(o, f) {
  const n = o.node, set = (s, v) => v !== undefined && M.setField(n, s, v);
  set(M.OBJ.name, f.name); set(M.OBJ.prototype, f.prototype); set(M.OBJ.model, f.model); set(M.OBJ.texture, f.texture);
  set(M.OBJ.complection, f.complection); set(M.OBJ.player, f.player); set(M.QUEST_INFO, f.quest_info);
  set(M.OBJ.visible, f.visible); set(M.OBJ.useInScript, f.use_in_script);
  if (f.pos) { if (f.pos.length < 2 || !f.pos.every(Number.isFinite)) fail('pos: [x, y] или [x, y, высота над землёй]'); M.setField(n, M.OBJ.pos, [f.pos[0], f.pos[1], f.pos[2] ?? M.getField(n, M.OBJ.pos)?.[2] ?? 0]); }
  if (f.yaw !== undefined) M.setField(n, M.OBJ.rot, yawQuat(+f.yaw));
  if (o.kind === UNIT) {
    set(M.UNIT.unitPrototype, f.unit);
    for (const [k, s] of Object.entries({ weapons: M.UNIT.weapons, armors: M.UNIT.armors, spells: M.UNIT.spells, quick_items: M.UNIT.quickItems, quest_items: M.UNIT.questItems })) set(s, f[k]);
  }
}

// ---------------- terrain ----------------
// Shape: circle {x, y, radius} with cosine falloff, or rectangle {x0, y0, x1, y1} with full weight. World metres.
function shapeOf(op, map) {
  if (op.x0 !== undefined) {
    const x0 = Math.min(op.x0, op.x1), x1 = Math.max(op.x0, op.x1), y0 = Math.min(op.y0, op.y1), y1 = Math.max(op.y0, op.y1);
    return { x0, y0, x1, y1, w: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 ? 1 : 0 };
  }
  const R = Math.max(0.5, op.radius ?? 4);
  if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) fail('Нужны x, y (+radius) или x0, y0, x1, y1');
  return { x0: op.x - R, y0: op.y - R, x1: op.x + R, y1: op.y + R, w: (x, y) => { const d = Math.hypot(x - op.x, y - op.y) / R; return d > 1 ? 0 : 0.5 + 0.5 * Math.cos(d * Math.PI); } };
}
// Load mpr, fn returns the changed vertex rect (null: landscape unchanged); save, then rebuild
// that area of the zone's path graph (heights matter for paths, ground tiles do not).
async function editMpr(a, fn, { graph = true } = {}) {
  const rel = mapRel(a.mpr, 'mpr'), map = loadMap(rel) || fail('Нет ландшафта ' + rel);
  const rect = fn(map);
  if (!rect) return { landscape_changed: false };
  saveGameFile(rel, writeMpr(map));
  const out = { saved: [rel] };
  if (!graph) return out;
  const mobRel = rel.replace(/\.mpr$/i, '.mob');
  if (exists(mobRel)) {
    const mob = M.readMob(readGameFile(mobRel)), set = new Set();
    markArea(set, map, rect[0] - 1, rect[1] - 1, rect[2] + 1, rect[3] + 1);
    const n = await updateGraph(mob, map, set);
    if (n) { saveGameFile(mobRel, M.writeMob(mob)); out.saved.push(mobRel); out.path_graph_nodes_rebuilt = n; }
  }
  if (!out.path_graph_nodes_rebuilt) out.warning = `Граф проходимости не обновлён: нет ${mobRel} с графом. Откройте основной .mob зоны в редакторе и сохраните.`;
  return out;
}
const toRaw = (map, h) => Math.max(0, Math.min(65535, Math.round(h / map.maxZ * 65535)));
function vertexRect(map, s) { return [Math.max(0, Math.floor(s.x0)), Math.max(0, Math.floor(s.y0)), Math.min(map.W - 1, Math.ceil(s.x1)), Math.min(map.H - 1, Math.ceil(s.y1))]; }
const unionRect = (a, b) => a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b;
function finishHeights(map, rect) { updateNormals(map, rect[0] - 1, rect[1] - 1, rect[2] + 1, rect[3] + 1); return rect; }

function sculpt(map, op) {
  const s = shapeOf(op, map), [x0, y0, x1, y1] = vertexRect(map, s), src = map.z.slice(), W = map.W;
  const centre = op.x0 !== undefined ? (s.x0 + s.x1) / 2 : op.x, centreY = op.x0 !== undefined ? (s.y0 + s.y1) / 2 : op.y;
  const target = op.height ?? groundZ(map, centre, centreY), passes = op.tool === 'smooth' ? Math.max(1, Math.min(20, op.amount ?? 1)) : 1;
  for (let pass = 0; pass < passes; pass++) {
    const prev = pass ? map.z.slice() : src;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w = s.w(x, y), k = y * W + x;
      if (!w) continue;
      let h = heightAt(map, k);
      if (op.tool === 'raise') h += (op.amount ?? 1) * w;
      else if (op.tool === 'lower') h -= (op.amount ?? 1) * w;
      else if (op.tool === 'flatten' || op.tool === 'set') h += (target - h) * w;
      else if (op.tool === 'smooth') { let sum = 0, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < W && yy < map.H) { sum += prev[yy * W + xx]; n++; } } h += (sum / n / 65535 * map.maxZ - h) * w * 0.5; }
      else if (op.tool === 'noise') h += (op.amount ?? 1) * w * (hash(x, y, op.seed ?? 1) * 2 - 1);
      else fail('tool: raise, lower, smooth, flatten, set, noise');
      map.z[k] = toRaw(map, h);
    }
  }
  return [x0, y0, x1, y1];
}
// Smooth value noise in [0, 1) for natural-looking bumps.
function hash(x, y, seed) { const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return v - Math.floor(v); }

// Tile code for a paint op: explicit tile/atlas+index, a random pick from a list, or a random tile of a ground type.
function tilePicker(map, op) {
  let pool;
  if (op.type !== undefined) {
    const t = typeof op.type === 'number' ? op.type : TILE_TYPES.indexOf(op.type) >= 0 ? TILE_TYPES.indexOf(op.type) : TYPE_EN.indexOf(op.type);
    if (t < 0) fail('type: ' + TILE_TYPES.map((n, i) => `${i} ${n} (${TYPE_EN[i]})`).join(', '));
    pool = []; for (let i = 0; i < map.tileCount; i++) if (map.tileTypes[i] === t) pool.push(i);
    if (!pool.length) fail(`На этом ландшафте нет тайлов типа ${op.type}`);
  } else if (op.tiles) pool = op.tiles;
  else if (op.tile !== undefined) pool = [op.tile];
  else if (op.atlas !== undefined) pool = [op.atlas * 64 + (op.index ?? 0)];
  else fail('Укажите tile, atlas+index, tiles или type');
  for (const t of pool) if (!(t >= 0 && t < map.textures * 64)) fail(`Тайл ${t} вне атласов (0…${map.textures * 64 - 1})`);
  return (x, y) => {
    const t = pool[Math.floor(hash(x, y, 7) * pool.length)];
    const rot = op.rot === 'random' ? Math.floor(hash(y, x, 3) * 4) : (op.rot ?? 0) & 3;
    return (rot << 14) | t;
  };
}
const TYPE_EN = ['grass', 'ground', 'stone', 'sand', 'rock', 'field', 'water', 'road', 'empty', 'snow', 'ice', 'dry grass', 'drifts', 'lava', 'swamp', 'high rock'];

// Atlases decoded for previews: per atlas {w, h, rgba} or null.
function atlasImages(map) {
  return Array.from({ length: map.textures }, (_, i) => { try { return decodeMmp(resEntry('Res/textures.res', `${map.name}${String(i).padStart(3, '0')}.mmp`)); } catch { return null; } });
}
// Colour of the ground at world (x, y), same UV mapping as the 3D view (public/lib/eiscene.js).
function groundColor(map, atl, x, y) {
  const tx = Math.min(map.TW - 1, Math.max(0, Math.floor(x / 2))), ty = Math.min(map.TH - 1, Math.max(0, Math.floor(y / 2)));
  return tileTexel(atl, map.tiles[ty * map.TW + tx], (x - tx * 2) / 2, (y - ty * 2) / 2);
}
// Colour of tile code (with rotation bits) at tile-local u (east) and w (north), 0…1.
function tileTexel(atl, tile, uw, ww) {
  const img = atl[(tile >> 6) & 255], local = tile & 63;
  if (!img) return [100, 120, 85];
  let u = Math.min(0.999, Math.max(0, uw)), v = 1 - Math.min(0.999, Math.max(0, ww));
  for (let r = 0; r < tile >> 14; r++) [u, v] = [v, 1 - u];
  const px = (local & 7) * 64 + 8 + Math.floor(u * 48), py = (7 - (local >> 3)) * 64 + 8 + Math.floor(v * 48), o = (py * img.width + px) * 4;
  return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]];
}

// ---- autotiling: tiles are chosen so their corner colours match the ground class of each 2 m vertex ----
// Original maps blend ground types with the atlases' transition tiles; neighbouring tiles agree in colour
// at shared corners (median spread ~6 RGB on zone1), which this reproduces.
const PATCH = 0.2; // corner patch, fraction of a tile
function tileProbe(atl, tile) { // mean colour of [SW, SE, NE, NW corner, centre]
  const at = (u0, w0) => { const s = [0, 0, 0]; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { const c = tileTexel(atl, tile, u0 + (i + 0.5) / 5 * PATCH, w0 + (j + 0.5) / 5 * PATCH); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; } return s.map(v => v / 25); };
  const e = 1 - PATCH, m = 0.5 - PATCH / 2;
  return [at(0, 0), at(e, 0), at(e, e), at(0, e), at(m, m)];
}
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function autotile(map, classes, ops, rect) {
  const atl = atlasImages(map), names = Object.keys(classes), VW = map.TW + 1, VH = map.TH + 1;
  if (!names.length) fail('classes: {"имя": [тайлы…]}');
  const probes = new Map(), probe = t => probes.get(t) ?? (probes.set(t, tileProbe(atl, t)), probes.get(t));
  const target = names.map(n => {
    const pool = classes[n]; if (!Array.isArray(pool) || !pool.length) fail(`classes.${n}: список тайлов`);
    const s = [0, 0, 0]; let k = 0;
    for (const t of pool) { if (!(t >= 0 && t < map.textures * 64)) fail(`Тайл ${t} вне атласов`); for (const c of probe(t)) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; k++; } }
    return s.map(v => v / k);
  });
  const nearest = c => { let b = 0; for (let i = 1; i < target.length; i++) if (rgbDist(c, target[i]) < rgbDist(c, target[b])) b = i; return b; };
  // vertex classes: from the current tiles, then the ops
  const vc = new Int8Array(VW * VH);
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
    const s = [0, 0, 0]; let k = 0;
    for (const [dx, dy, corner] of [[-1, -1, 2], [0, -1, 3], [0, 0, 0], [-1, 0, 1]]) {
      const tx = i + dx, ty = j + dy; if (tx < 0 || ty < 0 || tx >= map.TW || ty >= map.TH) continue;
      const c = probe(map.tiles[ty * map.TW + tx])[corner]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; k++;
    }
    vc[j * VW + i] = nearest(s.map(v => v / k));
  }
  for (const op of ops) {
    const ci = names.indexOf(op.class); if (ci < 0) fail(`class: ${names.join(', ')}`);
    const s = shapeOf({ radius: 2, ...op }, map);
    for (let j = Math.max(0, Math.floor(s.y0 / 2)); j <= Math.min(VH - 1, Math.ceil(s.y1 / 2)); j++)
      for (let i = Math.max(0, Math.floor(s.x0 / 2)); i <= Math.min(VW - 1, Math.ceil(s.x1 / 2)); i++) if (s.w(i * 2, j * 2) > 0) vc[j * VW + i] = ci;
  }
  // candidates for mixed cells: every land tile of the atlases in 4 rotations
  const cands = [];
  for (let t = 0; t < map.textures * 64; t++) if (atl[t >> 6] && map.tileTypes[t] !== 6 && map.tileTypes[t] !== 13) for (let r = 0; r < 4; r++) cands.push((r << 14) | t);
  // uniform areas also use look-alike variants from all atlases (originals use ~500 distinct tiles per zone)
  const pools = names.map((n, ci) => [...new Set([...classes[n], ...cands.filter(c => c < 1 << 14 && probe(c).every(p => rgbDist(p, target[ci]) < 20) && probe(c).reduce((s, p) => s + rgbDist(p, target[ci]), 0) < 5 * 11)])]);
  const [tx0, ty0, tx1, ty1] = [Math.max(0, Math.floor(rect[0] / 2)), Math.max(0, Math.floor(rect[1] / 2)), Math.min(map.TW - 1, Math.floor(rect[2] / 2)), Math.min(map.TH - 1, Math.floor(rect[3] / 2))];
  let mixed = 0, err = 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const k = [vc[ty * VW + tx], vc[ty * VW + tx + 1], vc[(ty + 1) * VW + tx + 1], vc[(ty + 1) * VW + tx]];
    if (k.every(c => c === k[0])) { const pool = pools[k[0]]; map.tiles[ty * map.TW + tx] = (Math.floor(hash(ty, tx, 3) * 4) << 14) | pool[Math.floor(hash(tx, ty, 7) * pool.length)]; continue; }
    let best = Infinity; const scored = [];
    for (const c of cands) { const p = probe(c); const s = rgbDist(p[0], target[k[0]]) + rgbDist(p[1], target[k[1]]) + rgbDist(p[2], target[k[2]]) + rgbDist(p[3], target[k[3]]); scored.push(s); if (s < best) best = s; }
    const ok = []; for (let i = 0; i < cands.length; i++) if (scored[i] <= best * 1.08 + 4) ok.push(cands[i]);
    map.tiles[ty * map.TW + tx] = ok[Math.floor(hash(tx, ty, 11) * ok.length)];
    mixed++; err += best / 4;
  }
  markDirty(map, tx0 * 2 - 2, ty0 * 2 - 2, tx1 * 2 + 4, ty1 * 2 + 4);
  return { tiles: (tx1 - tx0 + 1) * (ty1 - ty0 + 1), transition_tiles: mixed, mean_corner_error: mixed ? Math.round(err / mixed) : 0, pool_sizes: Object.fromEntries(names.map((n, i) => [n, pools[i].length])) };
}

// ---------------- tools ----------------
const S = {
  str: d => ({ type: 'string', description: d }), num: d => ({ type: 'number', description: d }), int: d => ({ type: 'integer', description: d }),
  bool: d => ({ type: 'boolean', description: d }), arr: (d, items = {}) => ({ type: 'array', description: d, items }), obj: (d, extra = {}) => ({ type: 'object', description: d, ...extra }),
};
const MOB = S.str('Файл объектов карты: "zone1", "zone1.mob" или "Maps/zone1.mob"');
const MPR = S.str('Файл ландшафта: "zone1" или "zone1.mpr"');
const SOURCE = { type: 'string', enum: ['sp', 'mp'], description: 'sp — одиночная кампания (по умолчанию), mp — сетевая игра' };
const tools = new Map();
const tool = (name, description, properties, required, run) => tools.set(name, { name, description, inputSchema: { type: 'object', properties, required }, run });

// ---- general ----
tool('game_info', 'Папка игры, список карт (Maps/*.mob, *.mpr, *.mq), ресурсов Res/*.res и число изменённых файлов. Начинайте с этого.', {}, [], () => {
  const maps = listDir('Maps');
  return { gameDir: GAME, ok: exists('Res/database.res'), mob: maps.filter(f => /\.mob$/i.test(f)), mpr: maps.filter(f => /\.mpr$/i.test(f)), mq: maps.filter(f => /\.mq$/i.test(f)), res: listDir('Res'), changed_files: listBackups().length };
});
tool('backups_list', 'Файлы игры, изменённые редактором (оригиналы лежат в Editor/backup), и созданные редактором (помечены «(новый)»).', {}, [], () => listBackups());
tool('backups_restore', 'Вернуть оригинал одного файла (path) или ВСЕХ файлов (all: true — также удаляет созданные редактором файлы). Необратимо для правок.', { path: S.str('Путь файла от папки игры, например "Maps/zone1.mob"'), all: S.bool('true — откатить всё') }, [], a => {
  if (!a.path && a.all !== true) fail('Укажите path или all: true');
  return { restored: restore(a.path) };
});
tool('game_launch', 'Запустить game.exe, чтобы проверить мод в игре.', {}, [], () => { exec(`start "" "${path.join(GAME, 'game.exe')}"`, { cwd: GAME }); return { ok: true }; });

// ---- raw resources ----
tool('res_list', 'Список записей RES-архива (Res/*.res, Maps/*.mpr, Maps/*.mq).', { path: S.str('например "Res/texts.res"'), query: S.str('Фильтр по подстроке имени'), limit: S.int('По умолчанию 200') }, ['path'], a => {
  const all = loadRes(gamePath(a.path)).filter(e => !a.query || e.name.toLowerCase().includes(a.query.toLowerCase()));
  return { total: all.length, entries: all.slice(0, a.limit ?? 200).map(e => ({ name: e.name, size: e.data.length })) };
});
tool('res_read', 'Прочитать запись RES-архива. as: text (cp1251), reg (конфиг .reg как INI-текст, например quest.reg в .mq), hex, base64.', { path: S.str('Архив'), name: S.str('Имя записи'), as: { type: 'string', enum: ['text', 'reg', 'hex', 'base64'] } }, ['path', 'name'], a => {
  const d = resEntry(a.path, a.name), as = a.as || 'text';
  if (as === 'reg') return regToText(readReg(d));
  if (as === 'hex') return Buffer.from(d).toString('hex').slice(0, 20000);
  if (as === 'base64') return Buffer.from(d).toString('base64');
  return cp1251.decode(d);
});
tool('res_write', 'Записать/создать запись RES-архива (ровно одно из text, reg, base64) или удалить её (delete: true). Текст пишется как есть в cp1251 — для текстов игры удобнее texts_set.', { path: S.str('Архив'), name: S.str('Имя записи'), text: S.str('Текст'), reg: S.str('INI-текст .reg в формате res_read as=reg'), base64: S.str('Двоичные данные'), delete: S.bool('Удалить запись') }, ['path', 'name'], a => {
  if (a.delete) return { entries: resUpdate(a.path, [], [a.name]) };
  const data = a.text !== undefined ? cp1251.encode(a.text) : a.reg !== undefined ? writeReg(textToReg(a.reg)) : a.base64 !== undefined ? new Uint8Array(Buffer.from(a.base64, 'base64')) : fail('Нужно text, reg или base64');
  return { entries: resUpdate(a.path, [{ name: a.name, data }]) };
});

// ---- texts & quests ----
const textsOf = source => readRes(readGameFile(srcOf(source)[1])).map(e => ({ name: e.name, text: cp1251.decode(e.data) }));
tool('texts_search', 'Поиск в текстах игры (названия и описания предметов, существ, квесты "quest <id>", брифинги-диалоги "briefing <id>", зоны "zone <id>", строки интерфейса). Ищет по ключу и тексту.', { query: S.str('Подстрока (регистр не важен)'), group: S.str('Первое слово ключа: quest, briefing, unit, weapon, armor, spell, zone, string…'), source: SOURCE, limit: S.int('По умолчанию 50') }, [], a => {
  const q = (a.query || '').toLowerCase(), all = textsOf(a.source).filter(e => (!a.group || e.name.split(' ')[0].toLowerCase() === a.group.toLowerCase()) && (!q || e.name.toLowerCase().includes(q) || e.text.toLowerCase().includes(q)));
  return { total: all.length, items: all.slice(0, a.limit ?? 50).map(e => ({ name: e.name, preview: e.text.replace(/\r?\n/g, ' ⏎ ').slice(0, 120) })) };
});
tool('texts_get', 'Полный текст записей по ключам (например "quest q1_1", "briefing b1_1", "unit goblin").', { names: S.arr('Ключи', { type: 'string' }), source: SOURCE }, ['names'], a => {
  const map = new Map(textsOf(a.source).map(e => [e.name.toLowerCase(), e]));
  return Object.fromEntries(a.names.map(n => [n, map.get(n.toLowerCase())?.text.replace(/\r\n/g, '\n') ?? null]));
});
tool('texts_set', 'Создать или изменить тексты (переводы строк \\n сами станут \\r\\n) и удалить ненужные. Формат квестов и брифингов — в MCP.md.', { entries: S.arr('[{name, text}]', { type: 'object', properties: { name: { type: 'string' }, text: { type: 'string' } }, required: ['name', 'text'] }), delete: S.arr('Ключи для удаления', { type: 'string' }), source: SOURCE }, [], a => {
  const put = (a.entries || []).map(e => ({ name: e.name, data: cp1251.encode(e.text.replace(/\r?\n/g, '\r\n')) }));
  return { entries: resUpdate(srcOf(a.source)[1], put, a.delete || []) };
});

// ---- database ----
tool('db_tables', 'Все таблицы базы данных: файл (items.idb, units.udb, spells.sdb, perks.pdb, levers.ldb, quests.qdb, prints.db, acks.db), id таблицы, название и число записей.', { source: SOURCE }, [], a => {
  const D = loadDb(a.source);
  return [...D.files.values()].flatMap(f => f.data.tables.map(t => ({ file: f.name, table: t.id, name: t.name, title: t.title, records: t.records.length })));
});
tool('db_records', 'Записи таблицы: индекс, имя и первые поля. Для поиска используйте query.', { file: S.str('Файл, например "items.idb"'), table: S.str('id или имя таблицы'), query: S.str('Подстрока имени'), offset: S.int(''), limit: S.int('По умолчанию 100'), source: SOURCE }, ['file', 'table'], a => {
  const { t, db } = dbTable(loadDb(a.source), a.file, a.table);
  const rows = t.records.map((r, i) => ({ i, r, name: recName(db, t, r) })).filter(x => !a.query || x.name.toLowerCase().includes(a.query.toLowerCase()));
  const cols = (t.records[0]?.children || []).filter(c => c.data).slice(1, 6).map(c => c.id);
  return { total: rows.length, columns: cols.map(id => dbHeader(db, t.id, id)?.name || `field${id}`), records: rows.slice(a.offset ?? 0, (a.offset ?? 0) + (a.limit ?? 100)).map(x => [x.i, x.name, ...cols.map(id => { const f = x.r.children.find(c => c.id === id); return f?.data ? fieldView(dbType(db, t.id, id), f.data).text : ''; })]) };
});
tool('db_record_get', 'Все поля записи: id, имя, тип, значение, описание. Вложенные поля — в sub.', { file: S.str(''), table: S.str(''), record: S.str('Индекс или имя записи'), source: SOURCE }, ['file', 'table', 'record'], a => {
  const { t, db } = dbTable(loadDb(a.source), a.file, a.table), rec = dbRecord(db, t, a.record);
  return { index: t.records.indexOf(rec), name: recName(db, t, rec), fields: recordFields(db, t, rec) };
});
tool('db_record_set', 'Изменить поля записи. fields: {"Price": "120", "D.Min": "5"} — ключ это имя или id поля, для вложенных "Поле.Подполе". Значения — текстом, как их возвращает db_record_get (списки через запятую, BitList строкой 0/1).', { file: S.str(''), table: S.str(''), record: S.str('Индекс или имя'), fields: S.obj('{поле: значение}', { additionalProperties: { type: ['string', 'number'] } }), source: SOURCE }, ['file', 'table', 'record', 'fields'], a => {
  const D = loadDb(a.source), { f, t, db } = dbTable(D, a.file, a.table), rec = dbRecord(db, t, a.record), changed = {};
  for (const [key, value] of Object.entries(a.fields)) {
    const [k1, k2] = String(key).split('.');
    const node = findField(db, t.id, rec.children, k1) || fail(`Нет поля ${k1}. Поля: ${rec.children.map(c => dbHeader(db, t.id, c.id)?.name || c.id).join(', ')}`);
    let target = node, bid = t.id;
    if (k2 !== undefined) {
      bid = +(dbType(db, t.id, node.id)?.match(/\((\d+)\)/)?.[1] || 0);
      target = findField(db, bid, node.children || [], k2) || fail(`Нет подполя ${k2} в ${k1}`);
    }
    if (!target.data) fail(`${key} — составное поле, укажите подполе через точку`);
    const type = fieldView(dbType(db, bid, target.id), target.data).type;
    target.data = textToField(type, String(value), target.data);
    changed[key] = fieldView(type, target.data).text;
  }
  saveDb(D, f);
  return { record: recName(db, t, rec), changed };
});
tool('db_record_add', 'Новая запись копированием существующей (from) с новым именем name. Имя должно быть уникальным; затем поменяйте поля через db_record_set.', { file: S.str(''), table: S.str(''), from: S.str('Индекс или имя образца'), name: S.str('Новое имя'), source: SOURCE }, ['file', 'table', 'from', 'name'], a => {
  const D = loadDb(a.source), { f, t, db } = dbTable(D, a.file, a.table), src = dbRecord(db, t, a.from);
  if (t.records.some(r => recName(db, t, r).toLowerCase() === a.name.toLowerCase())) fail('Запись с таким именем уже есть');
  const copy = structuredClone(src), nameNode = copy.children.find(c => c.data && /^(Fixed)?String$/.test(dbType(db, t.id, c.id) || ''));
  if (nameNode) nameNode.data = textToField(dbType(db, t.id, nameNode.id), a.name, nameNode.data);
  t.records.splice(t.records.indexOf(src) + 1, 0, copy);
  saveDb(D, f);
  return { index: t.records.indexOf(copy), name: a.name };
});
tool('db_record_delete', 'Удалить запись. Если её имя используется на картах или в других таблицах, игра может упасть — сначала проверьте.', { file: S.str(''), table: S.str(''), record: S.str('Индекс или имя'), source: SOURCE }, ['file', 'table', 'record'], a => {
  const D = loadDb(a.source), { f, t, db } = dbTable(D, a.file, a.table), rec = dbRecord(db, t, a.record), name = recName(db, t, rec);
  t.records.splice(t.records.indexOf(rec), 1);
  saveDb(D, f);
  return { deleted: name };
});
tool('units_list', 'Прототипы существ из базы (монстры и НПС) с моделью и текстурой их расы — для map_object_add.', { query: S.str('Подстрока имени'), limit: S.int('По умолчанию 100') }, [], a => {
  const all = unitPrototypes().filter(u => !a.query || u.name.toLowerCase().includes(a.query.toLowerCase()));
  return { total: all.length, units: all.slice(0, a.limit ?? 100).map(u => ({ name: u.name, kind: u.kind, race: u.race, model: u.model })) };
});

// ---- maps: objects, units, patrols, scripts ----
tool('map_objects', 'Объекты карты: id, вид (unit, object, lever, trap, effect, light, sound, particles), имя, прототип, модель, позиция [x, y, высота над землёй] в метрах, поворот yaw в градусах.', { mob: MOB, kind: { type: 'string', enum: Object.keys(KIND) }, query: S.str('Подстрока имени/прототипа/модели'), near: S.arr('[x, y, радиус]', { type: 'number' }), limit: S.int('По умолчанию 200') }, ['mob'], a => {
  const mob = M.readMob(readGameFile(mapRel(a.mob, 'mob'))), q = (a.query || '').toLowerCase();
  const all = M.listObjects(mob).map(objSummary).filter(o => (!a.kind || o.kind === a.kind) && (!q || [o.name, o.prototype, o.model, o.unit].some(s => s?.toLowerCase().includes(q))) && (!a.near || Math.hypot(o.pos[0] - a.near[0], o.pos[1] - a.near[1]) <= a.near[2]));
  return { total: all.length, objects: all.slice(0, a.limit ?? 200) };
});
tool('map_object_get', 'Все свойства объекта, для существ — снаряжение и маршруты патруля.', { mob: MOB, id: S.int('id объекта') }, ['mob', 'id'], a => objDetails(findObj(M.readMob(readGameFile(mapRel(a.mob, 'mob'))), a.id)));
const OBJ_FIELDS = { name: S.str('Имя на карте (для скриптов)'), prototype: S.str(''), unit: S.str('Прототип существа из базы'), model: S.str('Модель из figures.res'), texture: S.str(''), pos: S.arr('[x, y] или [x, y, высота над землёй]', { type: 'number' }), yaw: S.num('Поворот, градусы'), complection: S.arr('[сила, ловкость, рост] 0…1', { type: 'number' }), player: S.int('Сторона/группа дипломатии'), quest_info: S.str(''), visible: S.int('0/1'), use_in_script: S.int('0/1'), weapons: S.arr('', { type: 'string' }), armors: S.arr('', { type: 'string' }), spells: S.arr('', { type: 'string' }), quick_items: S.arr('', { type: 'string' }), quest_items: S.arr('', { type: 'string' }) };
tool('map_object_set', 'Изменить объект. Передавайте только меняемые поля. Граф проходимости вокруг объекта пересчитывается сам.', { mob: MOB, mpr: MPR, id: S.int(''), fields: S.obj('Поля объекта', { properties: OBJ_FIELDS }) }, ['mob', 'id', 'fields'], a => editMob(a, async ({ mob, mark }) => {
  const o = findObj(mob, a.id);
  await mark(o); applyObjFields(o, a.fields); await mark(o);
  return objDetails(o);
}));
tool('objects_catalog', 'Каталог статичных объектов со всех зон игры (деревья, дома, камни, заборы…): прототип, модель, текстура, сколько раз встречается. Для map_object_add {object}.', { query: S.str('Подстрока прототипа/модели'), limit: S.int('По умолчанию 100') }, [], async a => {
  const q = (a.query || '').toLowerCase(), all = (await catalog()).objects.filter(o => !q || o.proto.toLowerCase().includes(q) || o.model.toLowerCase().includes(q));
  return { total: all.length, objects: all.slice(0, a.limit ?? 100) };
});
// One new object from spec {unit | object | copy_of, fields} (as map_object_add).
async function addObject(mob, mark, a) {
  const id = M.maxObjectId(mob) + 1, pos = a.fields?.pos ? [a.fields.pos[0], a.fields.pos[1], a.fields.pos[2] ?? 0] : null;
  let node, kind, parent;
  if (a.copy_of !== undefined) {
    const src = findObj(mob, a.copy_of);
    node = M.cloneChunk(src.node); kind = src.kind; parent = src.parent;
    M.setField(node, M.OBJ.id, id); M.setField(node, M.OBJ.name, (M.getField(node, M.OBJ.name) || '').replace(/-\d+$/, '') + '-' + id);
    parent.children.splice(parent.children.indexOf(src.node) + 1, 0, node);
  } else {
    if (!pos) fail('Укажите fields.pos');
    const { templates, objects } = await catalog();
    if (a.unit) {
      const u = unitPrototypes().find(x => x.name.toLowerCase() === a.unit.toLowerCase()) || fail(`Нет прототипа ${a.unit} (см. units_list)`);
      kind = UNIT; node = setupUnit(M.cloneChunk(templates.get(UNIT)), u, id, pos);
    } else if (a.object) {
      const q = a.object.toLowerCase(), obj = objects.find(o => o.proto.toLowerCase() === q) || objects.find(o => o.model.toLowerCase() === q)
        || (loadRes(gamePath('Res/figures.res')).some(e => e.name.toLowerCase() === q + '.mod') ? { proto: a.object, model: a.object, texture: a.fields?.texture || a.object } : fail(`Нет объекта ${a.object} (см. objects_catalog, models_list)`));
      kind = 0xb001; node = setupObject(M.cloneChunk(templates.get(kind)), obj, id, pos);
    } else fail('Укажите unit, object или copy_of');
    const root = mob.chunks.find(c => c.id === 0xa000) || fail('В .mob нет корневого блока');
    parent = root.children.find(c => c.id === 0xb000) || (root.children.push({ id: 0xb000, children: [] }), root.children.at(-1));
    parent.children.push(node);
  }
  const o = { node, kind, parent };
  applyObjFields(o, a.fields || {});
  await mark(o);
  return objDetails(o);
}
tool('map_object_add', 'Добавить объект на любую карту, даже пустую новую: существо из базы (unit: прототип из units_list — модель, текстура и телосложение по расе), статичный объект из каталога (object: прототип или модель из objects_catalog, или своя импортированная модель) или копию объекта этой карты (copy_of: id). Много объектов сразу — items: [{unit | object | copy_of, fields}, …] (одно сохранение файла вместо сотен вызовов).', { mob: MOB, mpr: MPR, unit: S.str('Прототип существа'), object: S.str('Прототип или модель статичного объекта'), copy_of: S.int('id объекта-образца на этой карте'), fields: S.obj('Поля нового объекта; pos обязательно для unit и object', { properties: OBJ_FIELDS }), items: S.arr('Пакет: [{unit | object | copy_of, fields}, …]', { type: 'object' }) }, ['mob'], a => editMob(a, async ({ mob, mark }) => {
  if (!a.items) return addObject(mob, mark, a);
  const added = [];
  for (const [i, it] of a.items.entries()) { try { added.push((await addObject(mob, mark, it)).id); } catch (e) { fail(`items[${i}]: ${e.message} (ничего не сохранено)`); } }
  return { added: added.length, ids: added };
}));
tool('map_object_delete', 'Удалить объект. Если скрипт карты ссылается на его имя, скрипт сломается — проверьте map_script_get.', { mob: MOB, mpr: MPR, id: S.int('') }, ['mob', 'id'], a => editMob(a, async ({ mob, mark }) => {
  const o = findObj(mob, a.id), name = M.getField(o.node, M.OBJ.name);
  await mark(o);
  o.parent.children.splice(o.parent.children.indexOf(o.node), 1);
  return { deleted: a.id, name };
}));
tool('map_patrol_set', 'Маршрут патруля существа. points — новый маршрут целиком: точка [x, y] или {pos: [x, y], wait, param, flag} (высота берётся с земли); [] — убрать маршрут. edit — поправить отдельные точки, не трогая остальные: [{index, pos?, wait?, param?, flag?}]. wait — ожидание в точке (в оригиналах чаще 30…150, 3600 — стоять долго); param и flag — малоизученные поля (почти всегда 0). guard — точка охраны [x, y]. Существо должно иметь блок поведения (он есть у существ, добавленных map_object_add).', { mob: MOB, mpr: MPR, id: S.int('id существа'), points: S.arr('[[x, y] | {pos, wait, param, flag}, …]', {}), edit: S.arr('[{index, pos?, wait?, param?, flag?}]', { type: 'object' }), wait: S.int('Ожидание по умолчанию для точек без wait, 15'), guard: S.arr('Точка охраны [x, y] (необязательно)', { type: 'number' }) }, ['mob', 'id'], a => editMob(a, async ({ mob, gz }) => {
  const o = findObj(mob, a.id);
  if (o.kind !== UNIT) fail('Это не существо');
  const logic = o.node.children.find(c => c.id === 0xbbbc0000) || fail('У существа нет блока поведения — скопируйте патрульного с другой карты (map_object_add copy_of)');
  let p = logic.children.find(c => c.id === 0xbbbd0000);
  const pos = M.getField(o.node, M.OBJ.pos), at = xy => (Array.isArray(xy) && xy.length >= 2 && xy.every(Number.isFinite) ? [xy[0], xy[1], gz(xy[0], xy[1])] : fail('Точка: [x, y]'));
  if (!p && (a.points?.length || a.guard)) { p = { id: 0xbbbd0000, children: [{ id: 0xbbbd0001, data: M.codec.vec3.set(at(pos)) }] }; logic.children.push(p); M.setField(logic, [0xbbbc0003, 'u32'], 2); }
  if (!p) fail('У существа нет маршрута — задайте points');
  if (a.guard) M.setField(p, [0xbbbd0001, 'vec3'], at(a.guard));
  if (a.points) p.children = p.children.filter(c => c.id !== 0xbbbe0000).concat(a.points.map(pt => Array.isArray(pt)
    ? M.newWaypoint(at(pt), a.wait ?? 15)
    : M.newWaypoint(at(pt.pos), pt.wait ?? a.wait ?? 15, pt.param ?? 0, pt.flag ?? 0)));
  const wps = p.children.filter(c => c.id === 0xbbbe0000);
  for (const e of a.edit || []) {
    const w = wps[e.index] || fail(`Нет точки №${e.index} (точек: ${wps.length}, нумерация с 0)`);
    M.setWaypoint(w, { ...e, pos: e.pos && at(e.pos) });
  }
  return objDetails(o);
}));
tool('map_script_get', 'Скрипт карты (язык скриптов ПЗ: GlobalVars, Declare/Script/WorldScript, триггеры).', { mob: MOB }, ['mob'], a => (M.getScript(M.readMob(readGameFile(mapRel(a.mob, 'mob')))) ?? '').replace(/\r\n/g, '\n'));
tool('map_script_set', 'Записать скрипт карты целиком (\\n станут \\r\\n). Сначала прочитайте текущий через map_script_get.', { mob: MOB, script: S.str('Полный текст скрипта') }, ['mob', 'script'], a => {
  const rel = mapRel(a.mob, 'mob'), mob = M.readMob(readGameFile(rel));
  M.setScript(mob, a.script.replace(/\r?\n/g, '\r\n'));
  saveGameFile(rel, M.writeMob(mob));
  return { saved: rel };
});

// ---- terrain ----
tool('terrain_info', 'Ландшафт: размер в метрах (1 единица = 1 м, сектор 32 м, тайл текстуры 2×2 м), максимальная высота, перепад высот, атласы текстур и какие тайлы каким типом земли помечены (трава, камень, вода…).', { mpr: MPR }, ['mpr'], a => {
  const map = loadMap(mapRel(a.mpr, 'mpr')) || fail('Нет ландшафта');
  let lo = Infinity, hi = -Infinity; for (const z of map.z) { lo = Math.min(lo, z); hi = Math.max(hi, z); }
  const types = {}; for (let i = 0; i < map.tileCount; i++) (types[`${map.tileTypes[i]} ${TILE_TYPES[map.tileTypes[i]] || '?'} (${TYPE_EN[map.tileTypes[i]] || '?'})`] ??= []).push(i);
  const used = new Map(); for (const t of map.tiles) used.set(t & 0x3fff, (used.get(t & 0x3fff) || 0) + 1);
  return { name: map.name, size_m: [map.W - 1, map.H - 1], sectors: [map.sx, map.sy], max_height: r2(map.maxZ), height_range: [r2(lo / 65535 * map.maxZ), r2(hi / 65535 * map.maxZ)], atlases: map.textures, tile_code: 'atlas*64 + index (0…63); bits 14-15 — поворот', tiles_by_type: types, most_used_tiles: [...used].sort((x, y) => y[1] - x[1]).slice(0, 24).map(([t, n]) => ({ tile: t, type: TYPE_EN[map.tileTypes[t]], count: n })), water_tiles: map.waterMat.filter(v => v !== 0xffff).length };
});
tool('terrain_heights', 'Высоты (м) в прямоугольнике с шагом step. rows[0] — строка y0, далее по возрастанию y; в строке x растёт вправо. Не больше 4096 значений.', { mpr: MPR, x0: S.num(''), y0: S.num(''), x1: S.num(''), y1: S.num(''), step: S.num('Шаг в метрах, по умолчанию подбирается') }, ['mpr'], a => {
  const map = loadMap(mapRel(a.mpr, 'mpr')) || fail('Нет ландшафта');
  const x0 = a.x0 ?? 0, y0 = a.y0 ?? 0, x1 = a.x1 ?? map.W - 1, y1 = a.y1 ?? map.H - 1;
  const step = a.step ?? Math.max(1, Math.ceil(Math.sqrt((x1 - x0 + 1) * (y1 - y0 + 1) / 4096)));
  const rows = [];
  for (let y = y0; y <= y1; y += step) { const row = []; for (let x = x0; x <= x1; x += step) row.push(Math.round(groundZ(map, x, y) * 10) / 10); rows.push(row); }
  if (rows.length * rows[0].length > 4096) fail('Слишком много значений — увеличьте step или уменьшите область');
  return { x0, y0, step, rows };
});
tool('terrain_sculpt', 'Изменить рельеф пачкой операций. Каждая op: {tool, x, y, radius} (круг с мягким краем) или {tool, x0, y0, x1, y1} (прямоугольник). tool: raise/lower (amount м, по умолчанию 1), flatten (к высоте центра или height), set (к height), smooth (amount проходов), noise (неровности ±amount м, seed). Нормали и граф проходимости обновляются сами.', { mpr: MPR, ops: S.arr('Операции по порядку', { type: 'object' }) }, ['mpr', 'ops'], a => editMpr(a, map => {
  let rect = null;
  for (const op of a.ops) rect = unionRect(rect, sculpt(map, op));
  return rect && finishHeights(map, rect);
}));
tool('terrain_set_heights', 'Задать рельеф сеткой высот (м): rows[j][i] — высота в точке (x0 + i*step, y0 + j*step), между точками — плавная интерполяция. Удобно, чтобы «нарисовать» холмы, долины, реки целиком. blend 0…1 смешивает со старым рельефом.', { mpr: MPR, x0: S.num('По умолчанию 0'), y0: S.num('По умолчанию 0'), step: S.num('Шаг сетки, м'), rows: S.arr('Строки высот', { type: 'array', items: { type: 'number' } }), blend: S.num('1 — заменить (по умолчанию)') }, ['mpr', 'step', 'rows'], a => editMpr(a, map => {
  const x0 = a.x0 ?? 0, y0 = a.y0 ?? 0, R = a.rows, nY = R.length, nX = R[0]?.length || 0, blend = a.blend ?? 1;
  if (nX < 2 || nY < 2 || R.some(r => r.length !== nX)) fail('rows — прямоугольная сетка минимум 2×2');
  const rect = [Math.max(0, Math.ceil(x0)), Math.max(0, Math.ceil(y0)), Math.min(map.W - 1, Math.floor(x0 + (nX - 1) * a.step)), Math.min(map.H - 1, Math.floor(y0 + (nY - 1) * a.step))];
  for (let y = rect[1]; y <= rect[3]; y++) for (let x = rect[0]; x <= rect[2]; x++) {
    const gx = (x - x0) / a.step, gy = (y - y0) / a.step, i = Math.min(nX - 2, Math.floor(gx)), j = Math.min(nY - 2, Math.floor(gy)), fx = gx - i, fy = gy - j;
    const s = t => t * t * (3 - 2 * t), h = (R[j][i] * (1 - s(fx)) + R[j][i + 1] * s(fx)) * (1 - s(fy)) + (R[j + 1][i] * (1 - s(fx)) + R[j + 1][i + 1] * s(fx)) * s(fy);
    const k = y * map.W + x;
    map.z[k] = toRaw(map, heightAt(map, k) * (1 - blend) + h * blend);
  }
  return finishHeights(map, rect);
}));
tool('terrain_import_heightmap', 'Загрузить рельеф из PNG-карты высот (серый: чёрный = min, белый = max метров) на всю карту или в прямоугольник. Подходит для карт из World Machine, Gaea, Photoshop.', { mpr: MPR, png_path: S.str('Абсолютный путь к PNG'), min: S.num('Высота чёрного, м (по умолчанию 0)'), max: S.num('Высота белого, м (по умолчанию максимальная высота карты)'), x0: S.num(''), y0: S.num(''), x1: S.num(''), y1: S.num('') }, ['mpr', 'png_path'], a => editMpr(a, map => {
  const img = decodePng(fs.readFileSync(a.png_path)), lo = a.min ?? 0, hi = a.max ?? map.maxZ;
  const x0 = Math.max(0, a.x0 ?? 0), y0 = Math.max(0, a.y0 ?? 0), x1 = Math.min(map.W - 1, a.x1 ?? map.W - 1), y1 = Math.min(map.H - 1, a.y1 ?? map.H - 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    // image top row = north (max y), like terrain_render
    const px = Math.min(img.width - 1, Math.round((x - x0) / Math.max(1, x1 - x0) * (img.width - 1))), py = Math.min(img.height - 1, Math.round((y1 - y) / Math.max(1, y1 - y0) * (img.height - 1)));
    const o = (py * img.width + px) * 4, g = (img.rgba[o] * 0.299 + img.rgba[o + 1] * 0.587 + img.rgba[o + 2] * 0.114) / 255;
    map.z[y * map.W + x] = toRaw(map, lo + (hi - lo) * g);
  }
  return finishHeights(map, [x0, y0, x1, y1]);
}));
tool('terrain_paint', 'Рисовать текстурой земли пачкой операций. Форма: {x, y, radius} или {x0, y0, x1, y1}. Что класть: tile (код), atlas+index, tiles (случайно из списка) или type ("grass", "stone", "sand", "road", "swamp"… — случайный тайл этого типа из terrain_info). rot: 0-3 или "random".', { mpr: MPR, ops: S.arr('Операции', { type: 'object' }) }, ['mpr', 'ops'], a => editMpr(a, map => {
  let rect = null;
  for (const op of a.ops) {
    const s = shapeOf({ radius: 2, ...op }, map), pick = tilePicker(map, op);
    for (let ty = Math.max(0, Math.floor(s.y0 / 2)); ty <= Math.min(map.TH - 1, Math.floor(s.y1 / 2)); ty++)
      for (let tx = Math.max(0, Math.floor(s.x0 / 2)); tx <= Math.min(map.TW - 1, Math.floor(s.x1 / 2)); tx++)
        if (s.w(tx * 2 + 1, ty * 2 + 1) > 0) map.tiles[ty * map.TW + tx] = pick(tx, ty);
    const r = [Math.floor(s.x0) - 2, Math.floor(s.y0) - 2, Math.ceil(s.x1) + 2, Math.ceil(s.y1) + 2];
    markDirty(map, ...r); rect = unionRect(rect, r);
  }
  return rect;
}, { graph: false }));
tool('terrain_autotile', 'Покраска земли с переходами, как на оригинальных картах. classes — классы земли и их «чистые» тайлы: {"grass": [0, 9, 10], "ground": [8], "stone": [1, 2, 3, 4]}. ops — формы {x, y, radius} или {x0, y0, x1, y1} с class: каждой вершине сетки (шаг 2 м) внутри формы назначается класс. Затем в затронутой области каждому тайлу подбирается тайл атласа с поворотом, у которого цвета углов совпадают с классами вершин (переходные тайлы трава→земля и т. п.); внутри однородных участков кладутся случайные тайлы класса. Остальные вершины получают класс по текущим тайлам.', { mpr: MPR, classes: S.obj('{класс: [тайлы]}'), ops: S.arr('Операции {форма, class}', { type: 'object' }) }, ['mpr', 'classes', 'ops'], a => {
  let stats;
  return editMpr(a, map => {
    let rect = null;
    for (const op of a.ops) { const s = shapeOf({ radius: 2, ...op }, map); rect = unionRect(rect, [Math.floor(s.x0) - 2, Math.floor(s.y0) - 2, Math.ceil(s.x1) + 2, Math.ceil(s.y1) + 2]); }
    if (!rect) return null;
    stats = autotile(map, a.classes, a.ops, rect);
    return rect;
  }, { graph: false }).then(r => ({ ...r, ...stats }));
});
const LIQUIDS = { water: { type: 3, color: [0.19, 0.32, 0.65, 0.6], selfIllum: 0, wave: 0.5, warp: 0, reserved: [0, 0, 0] }, lava: { type: 3, color: [0.8, 0, 0, 1], selfIllum: 1, wave: 0.5, warp: 0, reserved: [0, 0, 0] } };
function liquidMaterial(map, m) {
  if (Number.isInteger(m)) return m < map.materials.length ? m : fail(`material: 0…${map.materials.length - 1}`);
  const p = LIQUIDS[m] || fail('material: "water", "lava" или номер материала');
  const i = map.materials.findIndex(x => x.type === p.type && x.selfIllum === p.selfIllum && Math.abs(x.color[0] - p.color[0]) < 0.1 && Math.abs(x.color[2] - p.color[2]) < 0.1);
  return i >= 0 ? i : map.materials.push(structuredClone(p)) - 1;
}
tool('terrain_water', 'Вода или лава (жидкость с поверхностью) пачкой операций. Форма: {x, y, radius} или {x0, y0, x1, y1}. level — высота поверхности, м; заливаются тайлы, где земля ниже level. material: "water", "lava" (материал добавится, если его нет) или номер; тайл поверхности — tile/tiles/type, как в terrain_paint (rot "random" по умолчанию). remove: true — убрать жидкость. Граф проходимости обновляется сам.', { mpr: MPR, ops: S.arr('Операции', { type: 'object' }) }, ['mpr', 'ops'], a => editMpr(a, map => {
  let rect = null;
  const UP = packNormal(0, 0, 1);
  for (const op of a.ops) {
    const s = shapeOf({ radius: 4, ...op }, map), mat = op.remove ? 0xffff : liquidMaterial(map, op.material ?? 'water'), pick = op.remove ? null : tilePicker(map, { rot: 'random', ...op });
    const lv = op.remove ? 0 : toRaw(map, op.level ?? fail('Нужен level — высота поверхности, м'));
    for (let ty = Math.max(0, Math.floor(s.y0 / 2)); ty <= Math.min(map.TH - 1, Math.floor(s.y1 / 2)); ty++)
      for (let tx = Math.max(0, Math.floor(s.x0 / 2)); tx <= Math.min(map.TW - 1, Math.floor(s.x1 / 2)); tx++) {
        if (!(s.w(tx * 2 + 1, ty * 2 + 1) > 0)) continue;
        const corners = [0, 1, 2].flatMap(j => [0, 1, 2].map(i => (ty * 2 + j) * map.W + tx * 2 + i));
        if (!op.remove && corners.every(k => map.z[k] >= lv)) continue; // dry tile
        map.waterMat[ty * map.TW + tx] = mat;
        if (op.remove) continue;
        map.waterTiles[ty * map.TW + tx] = pick(tx, ty);
        for (const k of corners) { map.wz[k] = lv; map.wdx[k] = map.wdy[k] = 0; map.wnormal[k] = UP; }
      }
    const r = [Math.floor(s.x0) - 2, Math.floor(s.y0) - 2, Math.ceil(s.x1) + 2, Math.ceil(s.y1) + 2];
    markDirty(map, ...r); rect = unionRect(rect, r);
  }
  return rect;
}));
// Top view of a landscape (north up): ground textures with relief shading and liquids, optional 32 m grid.
function topView(map, { x0 = 0, y0 = 0, x1 = map.W - 1, y1 = map.H - 1, size = 768, grid = true } = {}) {
  const atl = atlasImages(map), sc = Math.min(1536, size) / Math.max(x1 - x0, y1 - y0), w = Math.max(1, Math.round((x1 - x0) * sc)), h = Math.max(1, Math.round((y1 - y0) * sc));
  const px = new Uint8ClampedArray(w * h * 4), L = [-0.43, -0.26, 0.86];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const x = x0 + (c + 0.5) / sc, y = y1 - (r + 0.5) / sc, xi = Math.min(map.W - 1, Math.round(x)), yi = Math.min(map.H - 1, Math.round(y)), n = map.normal[yi * map.W + xi];
    const nx = (((n >>> 11) & 0x7ff) - 1000) / 1000, ny = ((n & 0x7ff) - 1000) / 1000, nz = (n >>> 22) / 1000, shade = 0.45 + 0.75 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    let col = groundColor(map, atl, x, y).map(v => v * shade);
    const tx = Math.min(map.TW - 1, Math.floor(x / 2)), ty = Math.min(map.TH - 1, Math.floor(y / 2));
    const wm = map.materials[map.waterMat[ty * map.TW + tx]];
    if (wm && map.wz[yi * map.W + xi] > map.z[yi * map.W + xi]) col = col.map((v, i) => v * 0.45 + (wm.color[i] * 160 + 40) * 0.55);
    if (grid && (Math.abs(x % 32) < 0.5 / sc || Math.abs(y % 32) < 0.5 / sc)) col = col.map(v => v * 0.7 + 255 * 0.3);
    px.set([...col, 255], (r * w + c) * 4);
  }
  return { x0, y0, x1, y1, sc, w, h, px };
}
tool('terrain_render', 'Картинка ландшафта сверху (PNG): текстуры земли с тенями рельефа, вода, объекты карты точками (красные — существа, жёлтые — прочие), сетка секторов 32 м. Верх картинки — север (большие y), x растёт вправо. Используйте, чтобы увидеть результат правок.', { mpr: MPR, mob: S.str('Показать объекты этой карты (необязательно)'), x0: S.num(''), y0: S.num(''), x1: S.num(''), y1: S.num(''), size: S.int('Длинная сторона, px (по умолчанию 768, максимум 1536)'), grid: S.bool('Сетка секторов (по умолчанию да)') }, ['mpr'], a => {
  const map = loadMap(mapRel(a.mpr, 'mpr')) || fail('Нет ландшафта');
  const { x0, y0, x1, y1, sc, w, h, px } = topView(map, { x0: a.x0 ?? 0, y0: a.y0 ?? 0, x1: a.x1 ?? map.W - 1, y1: a.y1 ?? map.H - 1, size: a.size ?? 768, grid: a.grid !== false });
  let objects = 0;
  if (a.mob) for (const o of M.listObjects(M.readMob(readGameFile(mapRel(a.mob, 'mob'))))) {
    const p = M.getField(o.node, M.OBJ.pos), c = Math.round((p[0] - x0) * sc), r = Math.round((y1 - p[1]) * sc), col = o.kind === UNIT ? [230, 40, 40] : [255, 210, 60];
    if (c < 0 || r < 0 || c >= w || r >= h) continue;
    objects++;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (c + i >= 0 && r + j >= 0 && c + i < w && r + j < h) px.set([...(Math.abs(i) === 2 || Math.abs(j) === 2 ? [0, 0, 0] : col), 255], ((r + j) * w + c + i) * 4);
  }
  return { image: encodePng(w, h, px), text: `Область x ${x0}…${x1}, y ${y0}…${y1} м, ${r2(sc)} px/м${a.mob ? `, объектов: ${objects}` : ''}. Верх — y=${y1}.` };
});

// ---- zones ----
tool('zones_list', 'Зоны мира из map.txt: id, остров (gipat, ingos, suslanger), тип (game — карта, brief — база, edge — переход), файлы карты (#res) и переходы.', { allod: S.str('Фильтр по острову') }, [], async a => (await loadWorld(io)).blocks.filter(b => !a.allod || b.allod === a.allod).map(b => ({ id: b.id, allod: b.allod, type: b.type, res: directive(b.text, 'res') || null, exits: exitsOf(b.text).map(x => `${x.n}→${x.to}#${x.entrance}`) })));
tool('zone_get', 'Блок зоны из map.txt целиком (#res, #maps, #position, #exit, #deploy…).', { id: S.str('id зоны') }, ['id'], async a => ((await loadWorld(io)).blocks.find(b => b.id === a.id) || fail('Нет зоны ' + a.id)).text.replace(/\r\n/g, '\n'));
tool('zone_set', 'Заменить блок зоны в map.txt (текст в формате zone_get). Строку #zone <id> не меняйте.', { id: S.str(''), text: S.str('') }, ['id', 'text'], async a => {
  const w = await loadWorld(io), b = w.blocks.find(x => x.id === a.id) || fail('Нет зоны ' + a.id);
  if (!new RegExp(`^#zone\\s+${a.id}\\s`, 'm').test(a.text)) fail(`Текст должен содержать строку "#zone ${a.id} …"`);
  b.text = a.text.replace(/\r?\n/g, '\r\n'); if (!b.text.endsWith('\r\n')) b.text += '\r\n';
  await saveWorld(io, w);
  return { saved: 'Res/texts.res: map.txt' };
});
tool('zone_create', 'Новая зона (как мастер в редакторе): ландшафт .mpr (ровный нужного размера или копия образца), .mob с графом проходимости, текстуры земли и миникарта из зоны-образца, запись в map.txt, по желанию переход из соседней зоны. Потом лепите рельеф terrain_* и расставляйте объекты map_object_add.', { id: S.str('id зоны, латиница, например gz22g'), file: S.str('Имя файлов карты, латиница'), title: S.str('Комментарий'), allod: { type: 'string', enum: Object.keys(ISLAND) }, tpl: S.str('id зоны-образца (zones_list, type=game)'), relief: { type: 'string', enum: ['flat', 'copy'] }, sx: S.int('Ширина в секторах по 32 м (2…16)'), sy: S.int('Высота в секторах'), link: S.str('id зоны для перехода (необязательно)'), open: S.bool('Открыть переход в скрипте соседней зоны (по умолчанию true)') }, ['id', 'file', 'allod', 'tpl'], async a => createZone(io, await loadWorld(io), a));

// ---- globe ----
// Island globe = <lnk> (parts "down" + one patch per game zone, files <lnk><part>.fig/.bon in figures.res);
// map.txt #figure <lnk><part> names a zone's patch. Patches are meshes on the island surface, textured by a
// planar projection of <tex> (zone borders are painted into that texture, <tex>g has none).
const GLOBES = { gipat: { lnk: 'ingm1', tex: 'gipatmap' }, suslanger: { lnk: 'ingm4', tex: 'suslangermap' } };
const originalRes = rel => { const b = path.join(BACKUP, rel); return fs.existsSync(b) ? loadRes(b) : loadRes(gamePath(rel)); };
function globeOf(allod) {
  const g = GLOBES[allod] || fail(allod === 'ingos' ? 'Глобус Ингоса хранится в ingm3.mod — пока не поддерживается' : 'allod: ' + Object.keys(GLOBES).join(', '));
  const figs = loadRes(gamePath('Res/figures.res')), get = n => figs.find(e => e.name.toLowerCase() === n.toLowerCase());
  const lnk = readLnk(get(g.lnk + '.lnk').data), origLnk = readLnk(originalRes('Res/figures.res').find(e => e.name.toLowerCase() === g.lnk + '.lnk').data);
  const fig = part => { const e = get(g.lnk + part + '.fig'); return e ? readFig(e.data) : null; };
  const pts = f => { const out = []; for (let c = 0; c < f.comps.length / 3; c++) { const p = f.comps[c * 3 + 1], t = f.comps[c * 3 + 2]; out.push({ x: f.variants[0][p * 3], y: f.variants[0][p * 3 + 1], u: f.uv[t * 2], v: f.uv[t * 2 + 1] }); } return out; };
  const down = fig('down'), tris = [];
  for (let t = 0; t < down.indices.length; t += 3) tris.push([0, 1, 2].map(k => { const p = down.comps[down.indices[t + k] * 3 + 1]; return [down.variants[0][p * 3], down.variants[0][p * 3 + 1], down.variants[0][p * 3 + 2]]; }));
  // island top under (x, y); null over the sea and in the holes under original zone patches
  const surface = (x, y) => {
    let best = null;
    for (const [a, b, c] of tris) {
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(d) < 1e-12) continue;
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const z = l1 * a[2] + l2 * b[2] + l3 * c[2]; if (best === null || z > best) best = z;
    }
    return best !== null && best > 0 ? best : null;
  };
  // texture projection, least-squares fit on an original zone patch: u = au*x + bu, v = av*y + bv
  const refPart = origLnk.find(l => l.name !== 'down').name, ref = pts(fig(refPart));
  const fit = (src, k) => { const xs = ref.map(p => p[src]), ys = ref.map(p => p[k]), n = xs.length, mx = xs.reduce((s, v) => s + v) / n, my = ys.reduce((s, v) => s + v) / n; let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; }); const a = sxy / sxx; return [a, my - a * mx]; };
  const [au, bu] = fit('x', 'u'), [av, bv] = fit('y', 'v');
  const bbox = f => { const p = pts(f); return [Math.min(...p.map(q => q.x)), Math.min(...p.map(q => q.y)), Math.max(...p.map(q => q.x)), Math.max(...p.map(q => q.y))].map(r2); };
  return { ...g, links: lnk, origLinks: origLnk, refPart, fig, surface, uv: (x, y) => [au * x + bu, av * y + bv], proj: { au, bu, av, bv }, bbox, down };
}
// Outer edges of a patch, in texture pixels.
function patchOutline(f, size) {
  const cnt = new Map(), key = (a, b) => a < b ? a + ',' + b : b + ',' + a, pos = c => f.comps[c * 3 + 1];
  for (let t = 0; t < f.indices.length; t += 3) for (let k = 0; k < 3; k++) { const kk = key(pos(f.indices[t + k]), pos(f.indices[t + (k + 1) % 3])); cnt.set(kk, (cnt.get(kk) || 0) + 1); }
  const uvOf = new Map(); for (let c = 0; c < f.comps.length / 3; c++) uvOf.set(f.comps[c * 3 + 1], [f.uv[f.comps[c * 3 + 2] * 2] * size - 0.5, f.uv[f.comps[c * 3 + 2] * 2 + 1] * size - 0.5]);
  return [...cnt].filter(([, c]) => c === 1).map(([k]) => k.split(',').map(Number).map(p => uvOf.get(p)));
}
// Yellow zone border like the original ones: 2 px core, dark rim.
function paintBorder(img, segs) {
  const dseg = (px, py, [a, b]) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy); };
  const xs = segs.flat().map(p => p[0]), ys = segs.flat().map(p => p[1]);
  for (let py = Math.max(0, Math.floor(Math.min(...ys)) - 4); py <= Math.min(img.height - 1, Math.ceil(Math.max(...ys)) + 4); py++)
    for (let px = Math.max(0, Math.floor(Math.min(...xs)) - 4); px <= Math.min(img.width - 1, Math.ceil(Math.max(...xs)) + 4); px++) {
      const d = Math.min(...segs.map(s => dseg(px, py, s))), o = (py * img.width + px) * 4;
      const [col, al] = d < 1.0 ? [[243, 222, 70], 1] : d < 1.8 ? [[197, 173, 33], 0.8] : d < 2.6 ? [[115, 99, 8], 0.45] : [null, 0];
      if (col) for (let q = 0; q < 3; q++) img.rgba[o + q] = img.rgba[o + q] * (1 - al) + col[q] * al;
    }
}
// Set (or add after the #zone line) a one-line directive of a map.txt block.
function setDirective(text, d, val) {
  const re = new RegExp(`(^#${d}[ \\t]*\\r?\\n)[^\\r\\n]*`, 'm');
  return re.test(text) ? text.replace(re, `$1${val}`) : text.replace(/\r?\n/, m => `${m}#${d}\r\n${val}\r\n`);
}
tool('globe_info', 'Глобус острова: части-участки зон (какие зоны на них ссылаются, габариты в координатах глобуса), габариты острова, текстура глобуса и формула перевода координат глобуса в текстуру (пиксель = u·ширина, v·высота; север — большие y). Посмотрите текстуру texture_export, чтобы выбрать свободную сушу для globe_zone.', { allod: S.str('gipat или suslanger') }, ['allod'], async a => {
  const g = globeOf(a.allod), w = await loadWorld(io), zonesOf = fig => w.blocks.filter(b => (directive(b.text, 'figure') || '').trim().toLowerCase() === fig).map(b => b.id);
  const k = v => Math.round(v * 10000) / 10000;
  return { model: g.lnk + '.lnk', texture: g.tex + '.mmp', island_bbox: g.bbox(g.down), uv: `u = ${k(g.proj.au)}·x + ${k(g.proj.bu)}, v = ${k(g.proj.av)}·y + ${k(g.proj.bv)}`,
    parts: g.links.filter(l => l.name !== 'down').map(l => ({ part: l.name, figure: g.lnk + l.name, zones: zonesOf(g.lnk + l.name), original: g.origLinks.some(o => o.name === l.name), bbox: g.fig(l.name) ? g.bbox(g.fig(l.name)) : null })) };
});
tool('globe_zone', 'Показать игровую зону на глобусе, как оригинальные: участок поверхности острова (скруглённый прямоугольник w×h с центром x, y в координатах глобуса — см. globe_info), жёлтая граница на текстуре глобуса, #figure зоны в map.txt и #position её переходов (точка на границе участка в сторону соседней зоны). Повторный вызов переносит участок; границы рисуются заново поверх оригинальной текстуры из бэкапа.', { zone: S.str('id игровой зоны'), x: S.num('Центр, координаты глобуса'), y: S.num(''), w: S.num('Ширина (участки Гипата 0,5…1,7)'), h: S.num('Высота') }, ['zone', 'x', 'y', 'w', 'h'], async a => {
  const world = await loadWorld(io), b = world.blocks.find(x => x.id === a.zone) || fail('Нет зоны ' + a.zone);
  if (b.type !== 'game') fail('Участок на глобусе бывает только у зон type=game');
  const g = globeOf(b.allod), cur = (directive(b.text, 'figure') || '').trim().toLowerCase();
  const sharedFig = world.blocks.some(x => x.id !== b.id && (directive(x.text, 'figure') || '').trim().toLowerCase() === cur);
  let part = cur.startsWith(g.lnk) && !sharedFig && !g.origLinks.some(l => g.lnk + l.name === cur) ? cur.slice(g.lnk.length) : null;
  if (!part) { const used = new Set(g.links.map(l => +l.name).filter(Number.isFinite)); let n = 21; while (used.has(n)) n++; part = String(n); }
  // grid draped on the island; outer vertices snapped onto the exact outline so the border is smooth
  const RX = a.w / 2, RY = a.h / 2, f4 = (x, y) => (Math.abs(x - a.x) / RX) ** 4 + (Math.abs(y - a.y) / RY) ** 4, STEP = Math.min(RX, RY) / 8, N = Math.ceil(Math.max(RX, RY) / STEP) + 1;
  const id = new Map(), pos = [], uv = [], idx = [];
  for (let j = -N; j <= N; j++) for (let i = -N; i <= N; i++) {
    const x = a.x + i * STEP, y = a.y + j * STEP; if (f4(x, y) >= 1) continue;
    const z = g.surface(x, y); if (z === null) continue;
    id.set(i + ',' + j, pos.length / 3); pos.push(x, y, z + 0.01); uv.push(...g.uv(x, y));
  }
  if (pos.length < 30) fail('Здесь почти нет свободной суши острова — выберите место по globe_info и texture_export');
  for (let j = -N; j < N; j++) for (let i = -N; i < N; i++) {
    const [p, q, r, s] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([u, v]) => id.get(u + ',' + v));
    if (p !== undefined && q !== undefined && r !== undefined) idx.push(p, q, r);
    if (p !== undefined && r !== undefined && s !== undefined) idx.push(p, r, s);
  }
  const eu = new Map(), ek = (p, q) => p < q ? p + ',' + q : q + ',' + p;
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { const kk = ek(idx[t + k], idx[t + (k + 1) % 3]); eu.set(kk, (eu.get(kk) || 0) + 1); }
  let offIsland = 0;
  for (const v of new Set([...eu].filter(([, c]) => c === 1).flatMap(([k]) => k.split(',').map(Number)))) {
    const s = f4(pos[v * 3], pos[v * 3 + 1]) ** -0.25, x = a.x + (pos[v * 3] - a.x) * s, y = a.y + (pos[v * 3 + 1] - a.y) * s, z = g.surface(x, y);
    if (z === null) { offIsland++; continue; }
    pos.splice(v * 3, 3, x, y, z + 0.01); uv.splice(v * 2, 2, ...g.uv(x, y));
  }
  const n = pos.length / 3, P4 = Math.ceil(n / 4) * 4, nrm = new Float32Array(P4 * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [p, q, r] = [idx[t], idx[t + 1], idx[t + 2]].map(k => pos.slice(k * 3, k * 3 + 3)), e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const k of [idx[t], idx[t + 1], idx[t + 2]]) for (let m = 0; m < 3; m++) nrm[k * 3 + m] += c[m];
  }
  for (let k = 0; k < n; k++) { const l = Math.hypot(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]) || 1; for (let m = 0; m < 3; m++) nrm[k * 3 + m] /= l; }
  const variants = Array.from({ length: 8 }, () => { const v = new Float32Array(P4 * 3); v.set(pos); return v; }), comps = new Uint16Array(n * 3);
  for (let k = 0; k < n; k++) comps.set([k, k, k], k * 3);
  const ref = g.fig(g.refPart), figData = writeFig({ variants, normals: nrm, uv: Float32Array.from(uv), indices: Uint16Array.from(idx), comps, group: ref.group, texture: ref.texture });
  const lnk = g.links.some(l => l.name === part) ? g.links : [...g.links, { name: part, parent: 'down' }];
  const bon = loadRes(gamePath('Res/figures.res')).find(e => e.name.toLowerCase() === g.lnk + g.refPart + '.bon');
  resUpdate('Res/figures.res', [{ name: g.lnk + part + '.fig', data: figData }, ...(bon ? [{ name: g.lnk + part + '.bon', data: bon.data }] : []), { name: g.lnk + '.lnk', data: writeLnk(lnk) }]);
  // borders: original texture + every added patch (so moving a patch leaves no old border)
  const img = decodeMmp(originalRes('Res/textures.res').find(e => e.name.toLowerCase() === g.tex + '.mmp').data);
  for (const l of lnk) if (l.name !== 'down' && !g.origLinks.some(o => o.name === l.name)) { const pf = l.name === part ? readFig(figData) : g.fig(l.name); if (pf) paintBorder(img, patchOutline(pf, img.width)); }
  resUpdate('Res/textures.res', [{ name: g.tex + '.mmp', data: encodeMmpArgb8(img.width, img.height, img.rgba) }]);
  // map.txt: #figure of the zone; #position of its edge zones on the patch border facing the neighbour
  b.text = setDirective(b.text, 'figure', g.lnk + part);
  const edges = [];
  for (const ex of exitsOf(b.text)) {
    const e = world.blocks.find(x => x.id === ex.to && x.type === 'edge'); if (!e) continue;
    const other = exitsOf(e.text).map(x => world.blocks.find(y => y.id === x.to)).find(y => y && y.id !== b.id);
    const oFig = other && (directive(other.text, 'figure') || '').trim().toLowerCase(), of = oFig?.startsWith(g.lnk) ? g.fig(oFig.slice(g.lnk.length)) : null;
    let dir = [-1, 0]; if (of) { const bb = g.bbox(of); dir = [(bb[0] + bb[2]) / 2 - a.x, (bb[1] + bb[3]) / 2 - a.y]; }
    const ang = Math.atan2(dir[1], dir[0]), cx = Math.cos(ang), cy = Math.sin(ang), s = ((Math.abs(cx) / RX) ** 4 + (Math.abs(cy) / RY) ** 4) ** -0.25;
    const px = a.x + cx * s, py = a.y + cy * s, val = `${r2(px)} ${r2(py)} ${r2(g.surface(px, py) ?? 0.3)}`;
    e.text = setDirective(e.text, 'position', val); edges.push({ edge: e.id, position: val });
  }
  await saveWorld(io, world);
  return { zone: b.id, figure: g.lnk + part, vertices: n, triangles: idx.length / 3, outline_points_off_island: offIsland, edges, saved: ['Res/figures.res', 'Res/textures.res: ' + g.tex + '.mmp', 'Res/texts.res: map.txt'] };
});
tool('zone_maps', 'Перерисовать миникарту и карту целей зоны по её текущему ландшафту (мастер новой зоны копирует их из зоны-образца, и они показывают чужую местность). Миникарта — вид сверху; карта целей — пергамент той же формы, что сейчас (или из parchment), с тенями рельефа, штриховкой склонов, водой и лавой.', { zone: S.str('id зоны'), parchment: S.str('Текстура-основа пергамента (по умолчанию текущая карта целей зоны)') }, ['zone'], async a => {
  const b = (await loadWorld(io)).blocks.find(x => x.id === a.zone) || fail('Нет зоны ' + a.zone);
  // #maps: line 1 = size in sectors, line 2 = minimap and objectives textures
  const mpr = (directive(b.text, 'res') || '').trim().split(/\s+/)[0], [miniName, questName] = (b.text.match(/^#maps[ \t]*\r?\n[^\r\n]*\r?\n([^#\r\n][^\r\n]*)/m)?.[1] || '').trim().split(/\s+/);
  if (!mpr || !questName) fail('В блоке зоны нет #res или #maps с именами текстур');
  const map = loadMap(mapRel(mpr, 'mpr')) || fail('Нет ландшафта ' + mpr), mi = mmpInfo(resEntry('Res/textures.res', miniName + '.mmp'));
  // longest side of the map across the texture width (zone10: 256x192 m -> 256x192 px of a 256x256 minimap)
  const top = topView(map, { size: mi.width, grid: false }), mini = new Uint8Array(mi.width * mi.height * 4);
  for (let i = 3; i < mini.length; i += 4) mini[i] = 255;
  for (let y = 0; y < Math.min(top.h, mi.height); y++) for (let x = 0; x < Math.min(top.w, mi.width); x++) mini.set(top.px.subarray((y * top.w + x) * 4, (y * top.w + x) * 4 + 4), (y * mi.width + x) * 4);
  const old = decodeMmp(resEntry('Res/textures.res', (a.parchment || questName) + '.mmp')), QW = old.width, QH = old.height;
  let base = Float32Array.from(old.rgba); // blur the old drawing away, keep parchment tone and torn edges
  for (let pass = 0; pass < 3; pass++) for (const horiz of [true, false]) {
    const nb = new Float32Array(base.length);
    for (let y = 0; y < QH; y++) for (let x = 0; x < QW; x++) {
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (let k = -6; k <= 6; k++) { const xx = horiz ? x + k : x, yy = horiz ? y : y + k; if (xx < 0 || yy < 0 || xx >= QW || yy >= QH || !old.rgba[(yy * QW + xx) * 4 + 3]) continue; const o = (yy * QW + xx) * 4; s0 += base[o]; s1 += base[o + 1]; s2 += base[o + 2]; n++; }
      const o = (y * QW + x) * 4; nb.set(n ? [s0 / n, s1 / n, s2 / n, old.rgba[o + 3]] : [base[o], base[o + 1], base[o + 2], old.rgba[o + 3]], o);
    }
    base = nb;
  }
  const hz = (x, y) => heightAt(map, Math.max(0, Math.min(map.H - 1, Math.round(y))) * map.W + Math.max(0, Math.min(map.W - 1, Math.round(x))));
  const quest = new Uint8Array(QW * QH * 4), mpp = Math.max(map.W - 1, map.H - 1) / QW;
  for (let y = 0; y < QH; y++) for (let x = 0; x < QW; x++) {
    const o = (y * QW + x) * 4, al = old.rgba[o + 3]; if (!al) continue;
    let col = [base[o], base[o + 1], base[o + 2]];
    const wx = (x + 0.5) * mpp, wy = map.H - 1 - (y + 0.5) * mpp;
    if (wy >= 0 && wx <= map.W - 1) {
      const gx = (hz(wx + 1, wy) - hz(wx - 1, wy)) / 2, gy = (hz(wx, wy + 1) - hz(wx, wy - 1)) / 2, sl = Math.hypot(gx, gy);
      col = col.map(v => v * Math.max(0.72, Math.min(1.12, 1 - 0.21 * (gx - gy))));
      if (sl > 0.2) { const k = Math.min(0.6, (sl - 0.2) * 1.6); col = col.map((v, i) => v * (1 - k) + [92, 58, 20][i] * k); } // slope hatching
      const t = Math.min(map.TH - 1, Math.floor(wy / 2)) * map.TW + Math.min(map.TW - 1, Math.floor(wx / 2)), kk = Math.round(wy) * map.W + Math.round(wx), m = map.materials[map.waterMat[t]];
      if (m && map.wz[kk] > map.z[kk]) col = m.selfIllum > 0 ? col.map((v, i) => v * 0.3 + [200, 70, 30][i] * 0.7) : col.map((v, i) => v * 0.4 + [70, 98, 132][i] * 0.6);
    }
    quest.set([...col.map(v => Math.max(0, Math.min(255, Math.round(v)))), al], o);
  }
  resUpdate('Res/textures.res', [{ name: miniName + '.mmp', data: encodeMmpArgb8(mi.width, mi.height, mini) }, { name: questName + '.mmp', data: encodeMmpArgb8(QW, QH, quest) }]);
  return { minimap: miniName + '.mmp', objectives: questName + '.mmp', map_px: [top.w, top.h] };
});

// ---- models ----
tool('models_list', 'Модели в figures.res (имя без .mod).', { query: S.str(''), limit: S.int('По умолчанию 200') }, [], a => {
  const all = loadRes(gamePath('Res/figures.res')).filter(e => /\.mod$/i.test(e.name)).map(e => e.name.slice(0, -4)).filter(n => !a.query || n.toLowerCase().includes(a.query.toLowerCase())).sort();
  return { total: all.length, models: all.slice(0, a.limit ?? 200) };
});
tool('model_info', 'Части модели (иерархия, вершины, треугольники), габариты в метрах и есть ли анимации.', { name: S.str('') }, ['name'], async a => {
  const d = await loadModelData(a.name) || fail('Нет модели ' + a.name), box = modelBox(d);
  return { parts: d.parts.map(p => ({ name: p.name, parent: p.parent, verts: p.fig ? p.fig.variants[0].length / 3 : 0, tris: p.fig ? p.fig.indices?.length / 3 : 0 })), footprint_m: box && { cx: r2(box.cx), cy: r2(box.cy), w: r2(box.hx * 2), d: r2(box.hy * 2) }, animations: exists('Res/figures.res') && loadRes(gamePath('Res/figures.res')).some(e => e.name.toLowerCase() === a.name.toLowerCase() + '.anm') };
});
tool('model_import_obj', 'Импорт статичной модели из Wavefront OBJ (здания, деревья, предметы на карте) с текстурой PNG. Каждый o/g — часть модели. Модель и текстура появятся в figures.res/textures.res под именем name.', { name: S.str('Имя модели, латиница'), obj_path: S.str('Абсолютный путь к .obj'), texture_path: S.str('PNG-текстура (необязательно)'), scale: S.num('Масштаб (по умолчанию 1 = метры)'), y_up: S.bool('OBJ с осью Y вверх (Blender по умолчанию) — true'), to_ground: S.bool('Поставить низ модели на землю — true'), overwrite: S.bool('Заменить существующую модель') }, ['name', 'obj_path'], a => {
  const name = a.name.toLowerCase();
  if (!/^[a-z0-9_]+$/.test(name)) fail('Имя: латиница, цифры, _');
  if (!a.overwrite && loadRes(gamePath('Res/figures.res')).some(e => e.name.toLowerCase() === name + '.mod')) fail('Модель уже есть — overwrite: true, чтобы заменить');
  const parts = objToParts(fs.readFileSync(a.obj_path, 'utf8'), { scale: a.scale ?? 1, yUp: a.y_up ?? true, toGround: a.to_ground ?? true });
  const { mod, bon } = writeModel(name, parts);
  resUpdate('Res/figures.res', [{ name: name + '.mod', data: mod }, { name: name + '.bon', data: bon }]);
  if (a.texture_path) { const img = decodePng(fs.readFileSync(a.texture_path)); resUpdate('Res/textures.res', [{ name: name + '.mmp', data: encodeMmpArgb8(img.width, img.height, img.rgba) }]); }
  modelCache.delete(name);
  return { model: name, parts: parts.map(p => p.name), texture: a.texture_path ? name : null, hint: `На карте: map_object_add copy_of=<любой объект>, fields {model: "${name}", texture: "${name}", pos: […]}` };
});

// ---- textures ----
tool('textures_list', 'Текстуры (MMP) в архиве: textures (мир, модели, атласы земли <зона>000…), redress (одежда), menus.', { source: { type: 'string', enum: Object.keys(TEX_SRC) }, query: S.str(''), limit: S.int('По умолчанию 200') }, [], a => {
  const all = loadRes(gamePath(TEX_SRC[a.source || 'textures'])).filter(e => /\.mmp$/i.test(e.name) && (!a.query || e.name.toLowerCase().includes(a.query.toLowerCase())));
  return { total: all.length, textures: all.slice(0, a.limit ?? 200).map(e => e.name) };
});
tool('texture_export', 'Показать текстуру (PNG-картинка в ответе) и по желанию сохранить её в файл save_to.', { source: { type: 'string', enum: Object.keys(TEX_SRC) }, name: S.str('Имя .mmp'), save_to: S.str('Путь для PNG (необязательно)') }, ['name'], a => {
  const n = /\.mmp$/i.test(a.name) ? a.name : a.name + '.mmp', u8 = resEntry(TEX_SRC[a.source || 'textures'], n), info = mmpInfo(u8), img = decodeMmp(u8), png = encodePng(img.width, img.height, img.rgba);
  if (a.save_to) fs.writeFileSync(a.save_to, png);
  return { image: png, text: `${n}: ${info.width}×${info.height}, ${info.formatName}${a.save_to ? ', сохранено в ' + a.save_to : ''}` };
});
tool('texture_import', 'Заменить или создать текстуру из PNG. Существующая масштабируется под свой исходный размер (так модели и тайлы не ломаются); новая сохраняется в размере PNG (лучше степени двойки: 64, 128, 256, 512).', { source: { type: 'string', enum: Object.keys(TEX_SRC) }, name: S.str('Имя .mmp'), png_path: S.str('Абсолютный путь к PNG') }, ['name', 'png_path'], a => {
  const res = TEX_SRC[a.source || 'textures'], n = /\.mmp$/i.test(a.name) ? a.name : a.name + '.mmp', img = decodePng(fs.readFileSync(a.png_path));
  let old = null; try { old = mmpInfo(resEntry(res, n)); } catch { /* new texture */ }
  const w = old?.width ?? img.width, h = old?.height ?? img.height;
  resUpdate(res, [{ name: n, data: encodeMmpArgb8(w, h, resizeRgba(img.rgba, img.width, img.height, w, h)) }]);
  return { texture: n, size: [w, h], created: !old };
});
tool('terrain_tile_import', 'Своя текстура земли: PNG кладётся в тайл атласа ландшафта (64×64, видимая часть — центральные 48×48, края — запас для стыков). Затем рисуйте этим тайлом через terrain_paint. Тип земли тайла (звук шагов, проходимость) задаётся type. Вместо PNG можно скопировать тайл из атласа другого ландшафта: from_mpr + from_tile (тип берётся оттуда). Атлас общий для всех карт с тем же именем ландшафта.', { mpr: MPR, tile: S.int('Код тайла atlas*64+index, который заменить'), png_path: S.str('PNG, лучше бесшовный; масштабируется до 48×48'), from_mpr: S.str('Или взять тайл из атласа другого ландшафта (например вода из zone5_1)…'), from_tile: S.int('…его код atlas*64+index'), type: S.str('Тип земли: grass, ground, stone, sand, rock, road, swamp… (необязательно)') }, ['mpr', 'tile'], async a => {
  let atlasName;
  const out = await editMpr(a, map => {
  if (!(a.tile >= 0 && a.tile < map.textures * 64)) fail(`tile 0…${map.textures * 64 - 1}`);
  atlasName = `${map.name}${String(a.tile >> 6).padStart(3, '0')}.mmp`;
  const atlas = decodeMmp(resEntry('Res/textures.res', atlasName));
  if (atlas.width !== 512 || atlas.height !== 512) fail('Атлас не 512×512');
  let cell;
  if (a.from_mpr !== undefined) { // the 48x48 visible picture of a tile of another landscape, same atlas layout
    const fm = loadMap(mapRel(a.from_mpr, 'mpr')) || fail('Нет ландшафта ' + a.from_mpr);
    if (!(a.from_tile >= 0 && a.from_tile < fm.textures * 64)) fail(`from_tile 0…${fm.textures * 64 - 1}`);
    const sa = decodeMmp(resEntry('Res/textures.res', `${fm.name}${String(a.from_tile >> 6).padStart(3, '0')}.mmp`)), sl = a.from_tile & 63, sx0 = (sl & 7) * 64 + 8, sy0 = (7 - (sl >> 3)) * 64 + 8;
    cell = new Uint8Array(48 * 48 * 4);
    for (let y = 0; y < 48; y++) cell.set(sa.rgba.subarray(((sy0 + y) * sa.width + sx0) * 4, ((sy0 + y) * sa.width + sx0 + 48) * 4), y * 48 * 4);
    if (a.type === undefined) a.type = TYPE_EN[fm.tileTypes[a.from_tile]];
  } else {
    if (!a.png_path) fail('Укажите png_path или from_mpr + from_tile');
    const src = decodePng(fs.readFileSync(a.png_path)); cell = resizeRgba(src.rgba, src.width, src.height, 48, 48);
  }
  const local = a.tile & 63;
  // 64x64 cell: 48x48 picture in the middle, 8 px border repeats the picture's opposite edge (seamless wrap)
  const ox = (local & 7) * 64, oy = (7 - (local >> 3)) * 64;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const sx = (x - 8 + 48) % 48, sy = (y - 8 + 48) % 48; atlas.rgba.set(cell.subarray((sy * 48 + sx) * 4, (sy * 48 + sx) * 4 + 4), ((oy + y) * 512 + ox + x) * 4); }
  resUpdate('Res/textures.res', [{ name: atlasName, data: encodeMmpArgb8(512, 512, atlas.rgba) }]);
  if (a.type === undefined) return null;
  const t = TYPE_EN.indexOf(a.type) >= 0 ? TYPE_EN.indexOf(a.type) : TILE_TYPES.indexOf(a.type);
  if (t < 0) fail('type: ' + TYPE_EN.join(', '));
  map.tileTypes[a.tile] = t; // lives in the .mp header, which is always rewritten
  return [0, 0, 0, 0];
  }, { graph: false });
  return { atlas: 'Res/textures.res: ' + atlasName, tile: a.tile, ...out };
});

// ---------------- JSON-RPC over stdio ----------------
const INSTRUCTIONS = `Редактор модов Evil Islands (Проклятые Земли). Все правки сразу пишутся в файлы игры; оригиналы сохраняются в Editor/backup (backups_list, backups_restore).
Координаты — метры: x вправо (восток), y вверх по карте (север), высота z. Позиция объекта хранит высоту НАД землёй; точки патруля — абсолютные (инструменты считают их сами).
Порядок работы: game_info → zones_list/map_objects/terrain_info → правки → terrain_render, чтобы посмотреть результат. Подробно: Editor/MCP.md.
Если в браузере открыт редактор с несохранёнными правками того же файла, его «Сохранить» перезапишет правки MCP.`;

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function toContent(out) {
  if (out?.image) return [{ type: 'image', data: Buffer.from(out.image).toString('base64'), mimeType: 'image/png' }, { type: 'text', text: out.text || '' }];
  return [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out ?? { ok: true }) }];
}
async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (method === 'initialize') return { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ei-editor', version: '1.0.0' }, instructions: INSTRUCTIONS };
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
  if (method === 'tools/call') {
    const t = tools.get(params.name);
    if (!t) return { content: [{ type: 'text', text: 'Нет инструмента ' + params.name }], isError: true };
    const args = params.arguments || {};
    try {
      for (const r of t.inputSchema.required || []) if (args[r] === undefined || args[r] === null) fail(`Не указан параметр ${r}`);
      return { content: toContent(await t.run(args)) };
    } catch (e) {
      return { content: [{ type: 'text', text: 'Ошибка: ' + e.message }], isError: true };
    }
  }
  if (id === undefined) return undefined; // notification
  throw Object.assign(new Error('Метод не поддерживается: ' + method), { rpc: -32601 });
}

export { tools, handle }; // for tools/mcp-test.mjs

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, 'mcp.js')) {
  let buf = '', queue = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      // one call at a time: tools read-modify-write the same game files
      queue = queue.then(async () => {
        try { const result = await handle(msg); if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result }); }
        catch (e) { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.rpc || -32603, message: e.message } }); }
      });
    }
  });
  process.stdin.on('end', () => queue.then(() => process.exit(0)));
  console.error(`ei-editor MCP: ${tools.size} инструментов, игра: ${GAME}`);
}
