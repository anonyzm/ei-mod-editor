// Self-check of every file format against the real game files (read-only).
// Usage: npm test   (game folder: ../Evil Islands or config.json "gameDir")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readRes, writeRes, isRes } from '../src/formats/res.js';
import { readReg, writeReg, regToText, textToReg } from '../src/formats/reg.js';
import { parseSchema, dbForFile, readDatabase, writeDatabase, fieldView, textToField } from '../src/formats/db.js';
import { readMob, writeMob, getScript, setScript, listObjects, codec, walk, getField, OBJ, cloneChunk } from '../src/formats/mob.js';
import { readMpr, writeMpr, newMpr } from '../src/formats/mpr.js';
import { decodeMmp, encodeMmpArgb8 } from '../src/formats/mmp.js';
import { readModel, readAnimations, readFig, writeFig, readBon, writeBon, writeModel, figGeometry } from '../src/formats/fig.js';
import { objToParts } from '../src/formats/obj.js';
import { AIGRAPH_ID, readAiGraph, writeAiGraph, buildAiGraph, modelBox, objectRect } from '../src/formats/aigraph.js';
import { gameCatalog, setupUnit, setupObject } from '../src/shared/catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, '..', 'config.json'), 'utf8')); } catch { return {}; } })();
const G = path.resolve(cfg.gameDir || path.join(here, '..', '..', 'Evil Islands'));
const read = rel => fs.readFileSync(path.join(G, rel));
const maps = fs.readdirSync(path.join(G, 'Maps'));
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
let failed = 0;
function check(name, fn) {
  const t = Date.now();
  try { const info = fn(); console.log(`ok   ${name}${info ? ' — ' + info : ''} (${Date.now() - t} ms)`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

check('RES: database/texts/mq repack keeps every entry', () => {
  let n = 0;
  for (const f of ['Res/database.res', 'Res/texts.res', 'Maps/z3q1.mq']) {
    const e = readRes(read(f)), back = new Map(readRes(writeRes(e)).map(x => [x.name, x.data]));
    for (const x of e) { assert.ok(same(back.get(x.name), x.data), x.name); n++; }
  }
  return `${n} entries`;
});

check('REG: binary and INI-text roundtrip', () => {
  const regs = maps.filter(f => f.endsWith('.mq')).flatMap(f => readRes(read('Maps/' + f)).filter(e => e.name.endsWith('.reg')).map(e => e.data));
  regs.push(read('Res/music.reg'));
  for (const d of regs) { const s = readReg(d); assert.deepEqual(readReg(writeReg(textToReg(regToText(s)))), s); }
  return `${regs.length} files`;
});

check('DB: all tables byte-identical, all fields editable', () => {
  const S = n => fs.readFileSync(path.join(here, '..', 'data', 'dbschema', n + '.txt'), 'utf8');
  const schema = parseSchema({ dbfiles: S('dbfiles'), dbblocks: S('dbblocks'), dbtypes: S('dbtypes'), dbheaders: S('dbheaders') });
  let fields = 0;
  for (const res of ['Res/database.res', 'Res/databaselmp.res']) for (const e of readRes(read(res))) {
    if (e.name.endsWith('.adb')) continue;
    const db = dbForFile(schema, e.name), d = readDatabase(e.data, db);
    assert.ok(same(writeDatabase(d), e.data), e.name);
    for (const t of d.tables) for (const r of t.records) for (const f of r.children || []) if (f.data) {
      const v = fieldView(db.types[t.id]?.[f.id], f.data);
      assert.ok(same(textToField(v.type, v.text, f.data), f.data), `${e.name} ${t.name} field ${f.id}`);
      fields++;
    }
  }
  return `${fields} fields`;
});

check('MOB: every map byte-identical, scripts decrypt/encrypt', () => {
  let objs = 0, strarr = 0;
  for (const f of maps.filter(f => f.endsWith('.mob'))) {
    const u8 = read('Maps/' + f), m = readMob(u8);
    assert.ok(same(writeMob(m), u8), f);
    const s = getScript(m);
    if (s !== null) { setScript(m, s); assert.equal(getScript(readMob(writeMob(m))), s, f + ' script'); }
    objs += listObjects(m).length;
    walk(m.chunks, c => { if (c.id === 0xbbbb0008 || c.id === 0xb00d) { assert.ok(same(codec.strarr.set(codec.strarr.get(c.data), c.id), c.data)); strarr++; } });
  }
  return `${objs} objects, ${strarr} item lists`;
});

check('MPR: every landscape file keeps its sections', () => {
  for (const f of maps.filter(f => f.endsWith('.mpr'))) {
    const u8 = read('Maps/' + f), orig = new Map(readRes(u8).map(e => [e.name.toLowerCase(), e.data]));
    for (const e of readRes(writeMpr(readMpr(u8)))) assert.ok(same(orig.get(e.name.toLowerCase()), e.data), f + ' ' + e.name);
  }
  const fresh = readMpr(writeMpr(newMpr('test', 3, 2)));
  assert.equal(fresh.W, 97); assert.equal(fresh.H, 65);
  return `${maps.filter(f => f.endsWith('.mpr')).length} maps`;
});

check('MMP: all textures decode, ARGB8 encoder roundtrips', () => {
  let n = 0;
  for (const res of ['Res/textures.res', 'Res/redress.res', 'Res/menus.res']) for (const e of readRes(read(res))) if (e.name.endsWith('.mmp')) { decodeMmp(e.data); n++; }
  const px = new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i * 37) & 255);
  assert.ok(same(decodeMmp(encodeMmpArgb8(8, 8, px)).rgba, px));
  return `${n} textures`;
});

check('FIG: all models and animations parse', () => {
  const e = readRes(read('Res/figures.res')), by = new Map(e.map(x => [x.name.toLowerCase(), x.data]));
  let models = 0, anims = 0;
  for (const x of e.filter(x => x.name.endsWith('.mod'))) {
    const n = x.name.slice(0, -4), m = readModel(x.data, by.get(n + '.bon'), n);
    for (const p of m.parts) if (p.fig) { const nv = p.fig.variants[0].length / 3; for (let i = 1; i < p.fig.comps.length; i += 3) assert.ok(p.fig.comps[i] < nv, n); }
    models++;
    if (by.has(n + '.anm')) anims += readAnimations(by.get(n + '.anm')).length;
  }
  return `${models} models, ${anims} animations`;
});

check('FIG/BON writers: every game mesh rebuilds byte-for-byte', () => {
  let n = 0;
  for (const x of readRes(read('Res/figures.res'))) {
    if (x.name.endsWith('.mod')) for (const p of readRes(x.data)) if (String.fromCharCode(...p.data.subarray(0, 4)) === 'FIG8') { assert.ok(same(writeFig(readFig(p.data)), p.data), x.name + '/' + p.name); n++; }
    if (x.name.endsWith('.bon') && isRes(x.data)) for (const p of readRes(x.data)) assert.ok(same(writeBon(readBon(p.data)), p.data), x.name);
  }
  return `${n} meshes`;
});

check('OBJ import: two-part cube survives convert -> write -> read', () => {
  const obj = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nv 1 0 1\nv 1 1 1\nv 0 1 1\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n` +
    `o Box Bottom\nf 1/1 2/2 3/3 4/4\nf 5/1 6/2 7/3 8/4\ng top!\nf 1/1 2/2 6/3 5/4\nf -1/1 -2/2 -3/3\n`;
  const parts = objToParts(obj, { scale: 2, yUp: true });
  assert.deepEqual(parts.map(p => [p.name, p.parent]), [['box_bottom', ''], ['top', 'box_bottom']]);
  const { mod, bon } = writeModel('testcube', parts);
  const m = readModel(mod, bon, 'testcube');
  assert.deepEqual(m.parts.map(p => p.name), ['box_bottom', 'top']);
  const g = figGeometry(m.parts[0].fig, [0, 0, 0]);
  assert.equal(g.index.length, 12); // two quads -> four triangles
  const zs = Array.from(g.position).filter((_, i) => i % 3 === 2);
  assert.equal(Math.min(...zs), 0); assert.equal(Math.max(...zs), 2); // Y-up 0..1 scaled x2, lifted to the ground
  assert.equal(m.parts[1].fig.indices.length, 9); // quad + negative-index triangle
  return 'ok';
});

check('AI graph: every graph rebuilds byte-for-byte; untouched build keeps it', () => {
  const blobs = maps.filter(f => f.endsWith('.mob')).map(f => readMob(read('Maps/' + f)).chunks.find(c => c.id === AIGRAPH_ID)?.data).filter(Boolean);
  blobs.push(read('Maps/zone6.grp'));
  for (const b of blobs) assert.ok(same(writeAiGraph(readAiGraph(b)), b));
  const mob = readMob(read('Maps/zone1.mob')), orig = mob.chunks.find(c => c.id === AIGRAPH_ID).data, map = readMpr(read('Maps/zone1.mpr'));
  assert.ok(same(writeAiGraph(buildAiGraph(map, [], { base: readAiGraph(orig), dirty: () => false })), orig));
  return `${blobs.length} graphs`;
});

check('AI graph: builder agrees with the original on >= 85% of human-class edges (zone1)', () => {
  const mob = readMob(read('Maps/zone1.mob')), orig = readAiGraph(mob.chunks.find(c => c.id === AIGRAPH_ID).data), map = readMpr(read('Maps/zone1.mpr'));
  const figs = new Map(readRes(read('Res/figures.res')).map(e => [e.name.toLowerCase(), e.data]));
  const rects = listObjects(mob).filter(o => o.kind !== 0xbbbb0000).map(o => {
    const n = (getField(o.node, OBJ.model) || '').toLowerCase();
    if (!figs.has(n + '.mod')) return null;
    const b = modelBox(readModel(figs.get(n + '.mod'), figs.get(n + '.bon'), n));
    return b && objectRect(b, getField(o.node, OBJ.pos), getField(o.node, OBJ.rot));
  }).filter(Boolean);
  const built = buildAiGraph(map, rects), a = orig.layers[3].cost, b = built.layers[3].cost;
  let ok = 0;
  for (let i = 0; i < a.length; i++) if ((a[i] === 0xffff) === (b[i] === 0xffff)) ok++;
  assert.ok(ok / a.length >= 0.85, `${(100 * ok / a.length).toFixed(1)}%`);
  return `${(100 * ok / a.length).toFixed(1)}% of edges`;
});

const catalog = await gameCatalog(rel => Promise.resolve(read(rel)), maps);
check('Catalog: a creature and an object can be added to an empty map', () => {
  assert.ok(catalog.objects.length > 100 && catalog.templates.has(0xbbbb0000) && catalog.templates.has(0xb001));
  const mob = readMob(read('Maps/zone7chest.mob')), root = mob.chunks.find(c => c.id === 0xa000);
  const b = root.children.find(c => c.id === 0xb000);
  b.children.push(setupUnit(cloneChunk(catalog.templates.get(0xbbbb0000)), { name: 'GoblinA1', model: 'unmogo' }, 9001, [1, 2, 0]),
    setupObject(cloneChunk(catalog.templates.get(0xb001)), catalog.objects[0], 9002, [3, 4, 0]));
  const back = listObjects(readMob(writeMob(mob)));
  assert.deepEqual(back.filter(o => o.kind !== 0xbbac0000).map(o => getField(o.node, OBJ.name)), ['GoblinA1-9001', `${catalog.objects[0].proto}-9002`]);
  return `${catalog.objects.length} object types`;
});

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
