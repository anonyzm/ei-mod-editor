// End-to-end check of passability painting on a temporary COPY of the game (hard links; edited files are
// replaced, never written through). Closes a full row of tiles to walkers the way the map view saves it,
// then checks the files: copied pictures, tileDesc.reg type 15, the fine grid and graph seen by New EI's
// code (tools/aimap), and, with -newei, that New EI loads and draws the zone.
// Usage: node tools/passability-test.mjs [zone4] [-newei]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'Evil Islands');
const zone = process.argv.find(a => /^zone/.test(a)) || 'zone4', newei = process.argv.includes('-newei');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-pass-')), game = path.join(tmp, 'game');
(function link(s, d) { fs.mkdirSync(d, { recursive: true }); for (const f of fs.readdirSync(s, { withFileTypes: true })) f.isDirectory() ? link(path.join(s, f.name), path.join(d, f.name)) : fs.linkSync(path.join(s, f.name), path.join(d, f.name)); })(SRC, game);
process.env.EI_GAME_DIR = game; process.env.EI_BACKUP_DIR = path.join(tmp, 'backup');

const { readGameFile, saveGameFile, resEntry, resUpdate } = await import('../src/game.js');
const { aimapRaw } = await import('../src/aimap.js');
const { readMpr, writeMpr, markDirty } = await import('../src/formats/mpr.js');
const { decodeMmp } = await import('../src/formats/mmp.js');
const { readReg } = await import('../src/formats/reg.js');
const M = await import('../src/formats/mob.js');
const { AIGRAPH_ID, readAiGraph, writeAiGraph, readGrid, mergeGraph } = await import('../src/formats/aigraph.js');
const P = await import('../src/shared/passability.js');

const atlasName = (map, a) => `${map.name}${String(a).padStart(3, '0')}.mmp`;
const map = readMpr(readGameFile(`Maps/${zone}.mpr`)), mob = M.readMob(readGameFile(`Maps/${zone}.mob`));
const textures0 = map.textures, images = [];
for (let a = 0; a < map.textures; a++) images.push(decodeMmp(resEntry('Res/textures.res', atlasName(map, a))));
const before = readGrid(await aimapRaw(writeMpr(map), M.writeMob(mob)));

// --- paint: tile row ty across the whole map -> BLOCK (as map.js passBrush) ---
const ty = map.TH >> 1, pal = P.passPalette(map, images), copies = [], t0 = ty * map.TW, type0 = map.tileTypes[map.tiles[t0] & 0x3fff];
for (let tx = 0; tx < map.TW; tx++) { const c = P.retypeTile(map, pal, ty * map.TW + tx, P.BLOCK); if (c) copies.push(c); }
markDirty(map, 0, ty * 2 - 2, map.W - 1, ty * 2 + 4);
console.log(`${zone}: ${copies.length} картинок скопировано, атласов ${textures0} → ${map.textures}`);
for (let tx = 0; tx < map.TW; tx++) assert.equal(map.tileTypes[map.tiles[ty * map.TW + tx] & 0x3fff], P.BLOCK);
// "orig" goes back to the picture's original type; a second pass reuses the copies
assert.equal(P.retypeTile(map, pal, t0, null), null);
assert.equal(map.tileTypes[map.tiles[t0] & 0x3fff], type0);
assert.equal(P.retypeTile(map, pal, t0, P.BLOCK), null);
assert.equal(map.tileTypes[map.tiles[t0] & 0x3fff], P.BLOCK);

// --- save (as map.js save) ---
const raws = new Map(), out = new Set();
// copies (new Uint8Array): Node's Buffer.slice() is a view and would write into the cached atlas 0
const raw = a => { if (!raws.has(a)) { try { raws.set(a, new Uint8Array(resEntry('Res/textures.res', atlasName(map, a)))); } catch { raws.set(a, new Uint8Array(raw(0))); } } return raws.get(a); };
for (const c of copies) { P.copyTileBlocks(raw(c.from >> 6), raw(c.to >> 6), c.from, c.to); out.add(c.to >> 6); }
resUpdate("Res/textures.res", [...out].map(a => ({ name: atlasName(map, a), data: raws.get(a) })));
const reg = P.withBlockDesc(resEntry('Res/aiinfo.res', 'tileDesc.reg'));
assert.ok(reg, 'тип 15 уже был в оригинальном tileDesc.reg');
resUpdate('Res/aiinfo.res', [{ name: 'tileDesc.reg', data: reg }]);
assert.equal(P.withBlockDesc(resEntry('Res/aiinfo.res', 'tileDesc.reg')), null);
const mprBytes = writeMpr(map), g = readGrid(await aimapRaw(mprBytes, M.writeMob(mob), { graph: true }));
const ch = mob.chunks.find(c => c.id === AIGRAPH_ID), base = readAiGraph(ch.data);
const merged = mergeGraph(base, g.costs, (x, y) => y === ty >> 1);
ch.data = writeAiGraph(merged);
saveGameFile(`Maps/${zone}.mpr`, mprBytes); saveGameFile(`Maps/${zone}.mob`, M.writeMob(mob));

// --- check what was written ---
const map2 = readMpr(readGameFile(`Maps/${zone}.mpr`));
assert.equal(map2.textures, map.textures); assert.equal(map2.tileTypes.length, map2.textures * 64);
for (const c of copies) { // the copied picture decodes to the source's (top mip)
  const s = decodeMmp(resEntry('Res/textures.res', atlasName(map2, c.from >> 6))), d = decodeMmp(resEntry('Res/textures.res', atlasName(map2, c.to >> 6)));
  const xy = t => [(t & 7) * 64, (7 - ((t >> 3) & 7)) * 64], [sx, sy] = xy(c.from), [dx, dy] = xy(c.to);
  for (let y = 0; y < 64; y += 7) assert.deepEqual(d.rgba.subarray(((dy + y) * 512 + dx) * 4, ((dy + y) * 512 + dx + 64) * 4), s.rgba.subarray(((sy + y) * 512 + sx) * 4, ((sy + y) * 512 + sx + 64) * 4));
}
assert.ok(readReg(resEntry('Res/aiinfo.res', 'tileDesc.reg')).some(s => s.name === '15'));
// grid: every dry cell of the row closed to humans (class 3), flyers as before; under water game.exe takes
// the type of the (animated) water tile, which the brush leaves alone
const row = ty * 4 + 1, nib = (v, k) => (v >>> (4 * k)) & 15;
let shut = 0, dry = 0, fly = 0;
for (let x = 12; x < g.W - 12; x++) {
  const i = row * g.W + x, wet = map.waterMat[ty * map.TW + (x >> 2)] !== 0xffff && g.type[i] !== P.BLOCK;
  if (!wet) { dry++; shut += nib(g.nibble[i], 3) === 0; } // wet cells may still close: clearance next to the wall
  fly += nib(g.nibble[i], 0) === nib(before.nibble[i], 0);
}
assert.equal(shut, dry, 'не все сухие клетки полосы закрыты для класса 3');
assert.equal(fly, g.W - 24, 'летающим полоса не должна мешать');
// graph: humans can no longer get from the south half to the north half
const reg3 = merged.layers[3].region, s = reg3[(ty >> 1) - 3 > 0 ? ((ty >> 1) - 3) * merged.W + (merged.W >> 1) : 0], n = reg3[((ty >> 1) + 3) * merged.W + (merged.W >> 1)];
assert.notEqual(s, n, 'граф: север и юг остались связаны для людей');
console.log(`сетка: закрыто для людей ${shut} из ${dry} сухих клеток полосы; граф: регионы юг ${s}, север ${n}`);

if (newei) { // New EI loads the edited zone (new atlas included) and draws it
  const exe = path.resolve(SRC, '..', 'New EI', 'bin', 'newei.exe'), png = path.join(tmp, 'shot.png');
  execFileSync(exe, ['-game', game, '-zone', zone, '-shot', png, '-sound=false'], { stdio: 'inherit', timeout: 120000 });
  assert.ok(fs.statSync(png).size > 10000);
  console.log('New EI: зона загружена, кадр', png);
} else fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok');
