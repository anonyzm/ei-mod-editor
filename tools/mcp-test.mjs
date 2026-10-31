// End-to-end check of mcp.js over stdio on a temporary COPY of the game (real files are never touched).
// Usage: node tools/mcp-test.mjs   (game folder: ../Evil Islands or config.json "gameDir")
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GAME } from '../src/game.js';

const here = path.dirname(fileURLToPath(import.meta.url)), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-mcp-'));
const game = path.join(tmp, 'game');
for (const f of ['database.res', 'databaselmp.res', 'texts.res', 'textslmp.res', 'textures.res', 'figures.res', 'menus.res']) fs.cpSync(path.join(GAME, 'Res', f), path.join(game, 'Res', f));
fs.cpSync(path.join(GAME, 'Maps'), path.join(game, 'Maps'), { recursive: true });

const proc = spawn(process.execPath, [path.join(here, '..', 'mcp.js')], { env: { ...process.env, EI_GAME_DIR: game, EI_BACKUP_DIR: path.join(tmp, 'backup') }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', nextId = 1;
const waiting = new Map();
proc.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); waiting.get(m.id)?.(m); } });
const rpc = (method, params) => new Promise(res => { const id = nextId++; waiting.set(id, res); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
async function call(name, args = {}, { error = false } = {}) {
  const m = await rpc('tools/call', { name, arguments: args });
  const c = m.result.content, text = c.find(x => x.type === 'text')?.text;
  assert.equal(!!m.result.isError, error, `${name}: ${text}`);
  const img = c.find(x => x.type === 'image');
  if (img) return { img: Buffer.from(img.data, 'base64'), text };
  try { return JSON.parse(text); } catch { return text; } // plain-text results (scripts, INI)
}
let failed = 0;
async function check(name, fn) { try { const info = await fn(); console.log(`ok   ${name}${info ? ' — ' + info : ''}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } }

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'ei-editor');
  const { tools } = (await rpc('tools/list', {})).result;
  console.log(`${tools.length} tools`);

  await check('game_info', async () => { const g = await call('game_info'); assert.ok(g.ok && g.mob.length > 50); return `${g.mob.length} mob`; });
  await check('texts', async () => {
    const s = await call('texts_search', { group: 'quest', limit: 3 }); assert.ok(s.total > 10);
    await call('texts_set', { entries: [{ name: 'string mcp_test', text: 'Строка\nвторая' }] });
    assert.equal((await call('texts_get', { names: ['string mcp_test'] }))['string mcp_test'], 'Строка\nвторая');
    await call('texts_set', { delete: ['string mcp_test'] });
    assert.equal((await call('texts_get', { names: ['string mcp_test'] }))['string mcp_test'], null);
    return `${s.total} quests`;
  });
  await check('res_read reg (quest.reg in .mq)', async () => { const t = await call('res_read', { path: 'Maps/z3q1.mq', name: 'z3q1\\quest.reg', as: 'reg' }); assert.ok(t.includes('[')); });
  await check('database', async () => {
    const tables = await call('db_tables'); assert.ok(tables.some(t => t.file === 'items.idb'));
    const recs = await call('db_records', { file: 'items.idb', table: 2, limit: 2 }), name = recs.records[0][1];
    const rec = await call('db_record_get', { file: 'items.idb', table: 2, record: name });
    const price = rec.fields.find(f => f.name === 'Price');
    await call('db_record_set', { file: 'items.idb', table: 2, record: name, fields: { Price: '777' } });
    assert.equal((await call('db_record_get', { file: 'items.idb', table: 2, record: 0 })).fields.find(f => f.name === 'Price').text, '777');
    await call('db_record_add', { file: 'items.idb', table: 2, from: name, name: 'mcp_test_weapon' });
    await call('db_record_add', { file: 'items.idb', table: 2, from: name, name: 'mcp_test_weapon' }, { error: true });
    await call('db_record_delete', { file: 'items.idb', table: 2, record: 'mcp_test_weapon' });
    return `${name}: Price ${price.text} → 777`;
  });
  await check('units_list', async () => { const u = await call('units_list', { query: 'goblin' }); assert.ok(u.total > 0); return u.units[0].name; });

  // a fresh zone, then everything on it
  await check('zone_create', async () => {
    const z = await call('zone_create', { id: 'mcptest', file: 'mcptest', allod: 'gipat', tpl: 'gz1g', relief: 'flat', sx: 4, sy: 4, link: 'gz1g' });
    assert.equal(z.mpr, 'Maps/mcptest.mpr');
    assert.ok((await call('zone_get', { id: 'mcptest' })).includes('#res\nmcptest mcptest'));
    assert.ok((await call('zones_list', { allod: 'gipat' })).some(b => b.id === 'gz1g_mcptest'));
  });
  await check('terrain sculpt/heights/paint', async () => {
    const info = await call('terrain_info', { mpr: 'mcptest' }); assert.deepEqual(info.size_m, [128, 128]);
    const r = await call('terrain_sculpt', { mpr: 'mcptest', ops: [{ tool: 'raise', x: 64, y: 64, radius: 20, amount: 8 }, { tool: 'smooth', x: 64, y: 64, radius: 25, amount: 2 }] });
    assert.ok(r.path_graph_nodes_rebuilt > 0, 'graph rebuilt');
    const h = await call('terrain_heights', { mpr: 'mcptest', x0: 64, y0: 64, x1: 64, y1: 64 }); assert.ok(h.rows[0][0] > 6, 'hill ' + h.rows[0][0]);
    await call('terrain_set_heights', { mpr: 'mcptest', x0: 0, y0: 0, step: 32, rows: [[1, 1, 1, 1, 1], [1, 3, 3, 3, 1], [1, 3, 10, 3, 1], [1, 3, 3, 3, 1], [1, 1, 1, 1, 1]] });
    assert.equal((await call('terrain_heights', { mpr: 'mcptest', x0: 64, y0: 64, x1: 64, y1: 64 })).rows[0][0], 10);
    const grass = Object.entries(info.tiles_by_type).find(([k]) => k.includes('grass'))[1];
    const p = await call('terrain_paint', { mpr: 'mcptest', ops: [{ x0: 0, y0: 0, x1: 128, y1: 128, type: 'grass', rot: 'random' }, { x: 64, y: 64, radius: 6, tile: 1 }] });
    assert.deepEqual(p.saved, ['Maps/mcptest.mpr']);
    const after = await call('terrain_info', { mpr: 'mcptest' });
    assert.ok(after.most_used_tiles.every(t => grass.includes(t.tile) || t.tile === 1), 'painted grass');
    await call('terrain_sculpt', { mpr: 'mcptest', ops: [{ tool: 'nope', x: 1, y: 1 }] }, { error: true });
  });
  await check('terrain_render + heightmap + tile import', async () => {
    const img = await call('terrain_render', { mpr: 'zone1', mob: 'zone1', size: 256 });
    assert.equal(img.img.subarray(1, 4).toString(), 'PNG');
    const png = path.join(tmp, 'h.png'); fs.writeFileSync(png, img.img);
    await call('terrain_import_heightmap', { mpr: 'mcptest', png_path: png, min: 0, max: 12, x0: 0, y0: 0, x1: 40, y1: 40 });
    const t = await call('terrain_tile_import', { mpr: 'mcptest', tile: 5, png_path: png, type: 'sand' });
    assert.ok(t.atlas.includes('mcptest000.mmp'));
    assert.ok((await call('terrain_info', { mpr: 'mcptest' })).tiles_by_type['3 песок (sand)'].includes(5));
    return `${img.text}`;
  });
  await check('map objects: add unit, move, patrol, delete', async () => {
    const u = await call('map_object_add', { mob: 'mcptest', unit: (await call('units_list', { query: 'goblin' })).units[0].name, fields: { pos: [60, 60], yaw: 90 } });
    assert.ok(/goblin/i.test(u.unit)); assert.equal(Math.round(u.yaw), 90);
    const mv = await call('map_object_set', { mob: 'mcptest', id: u.id, fields: { pos: [70, 72], name: 'boss', weapons: ['test'] } });
    assert.deepEqual(mv.pos.slice(0, 2), [70, 72]); assert.equal(mv.name, 'boss');
    const pt = await call('map_patrol_set', { mob: 'mcptest', id: u.id, points: [[70, 80], [80, 80]] });
    assert.equal(pt.patrols[0].points.length, 2); assert.ok(pt.patrols[0].points[0].pos[2] > 0, 'patrol z from ground');
    const cat = await call('objects_catalog', { limit: 1 }); assert.ok(cat.total > 100, 'catalog');
    const tree = await call('map_object_add', { mob: 'mcptest', object: cat.objects[0].proto, fields: { pos: [90, 90], yaw: 45 } });
    assert.ok(tree.path_graph_nodes_rebuilt > 0 && tree.kind === 'object', 'static object on a new zone');
    const objs = await call('map_objects', { mob: 'zone1', kind: 'object', limit: 1 });
    const copy = await call('map_object_add', { mob: 'zone1', copy_of: objs.objects[0].id, fields: { pos: [100, 100] } });
    assert.ok(copy.path_graph_nodes_rebuilt > 0, 'graph around new object');
    await call('map_object_delete', { mob: 'zone1', id: copy.id });
    await call('map_object_get', { mob: 'zone1', id: copy.id }, { error: true });
    assert.equal((await call('map_objects', { mob: 'mcptest', near: [70, 72, 1] })).total, 1);
  });
  await check('map script', async () => {
    const s = await call('map_script_get', { mob: 'mcptest' }); assert.ok(s.includes('WorldScript'));
    await call('map_script_set', { mob: 'mcptest', script: s.replace('Sleep( 1 )', 'Sleep( 2 )') });
    assert.ok((await call('map_script_get', { mob: 'mcptest' })).includes('Sleep( 2 )'));
    assert.ok((await call('map_script_get', { mob: 'zone1' })).includes('z.mcptest'), 'exit opened in linked zone');
  });
  await check('models + textures', async () => {
    const ms = await call('models_list', { limit: 1 });
    const mi = await call('model_info', { name: ms.models[0] }); assert.ok(mi.parts.length);
    const obj = path.join(tmp, 'box.obj');
    fs.writeFileSync(obj, 'o box\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf 1/1 2/2 3/3\nf 1/1 3/3 4/4\n');
    const tex = await call('texture_export', { name: 'material0001', save_to: path.join(tmp, 't.png') });
    await call('model_import_obj', { name: 'mcpbox', obj_path: obj, texture_path: path.join(tmp, 't.png') });
    assert.equal((await call('model_info', { name: 'mcpbox' })).parts[0].name, 'box');
    await call('model_import_obj', { name: 'mcpbox', obj_path: obj }, { error: true });
    const t = await call('texture_import', { name: 'material0001', png_path: path.join(tmp, 'h.png') });
    assert.equal(t.created, false);
    return `${ms.models[0]}, ${tex.text}`;
  });
  await check('backups', async () => {
    const b = await call('backups_list'); assert.ok(b.some(f => f.includes('mcptest.mpr (новый)')));
    await call('backups_restore', {}, { error: true });
    await call('backups_restore', { all: true });
    assert.ok(!fs.existsSync(path.join(game, 'Maps', 'mcptest.mpr')), 'created files removed');
    assert.equal((await call('texts_get', { names: ['zone mcptest'] }))['zone mcptest'], null);
    assert.ok(!(await call('map_script_get', { mob: 'zone1' })).includes('z.mcptest'), 'zone1 restored');
  });
} finally {
  proc.stdin.end();
  await new Promise(r => proc.on('exit', r));
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} FAILED` : '\nAll MCP checks passed');
process.exit(failed ? 1 : 0);
