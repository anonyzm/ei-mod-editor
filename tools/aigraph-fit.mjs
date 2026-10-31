// Research: measure how well buildAiGraph() reproduces the original AI graphs, and (with "fit")
// search per-AI-class thresholds for RULES. Usage: node tools/aigraph-fit.mjs [zone1,zone4,...] [fit]
import fs from 'fs';
import { fileURLToPath } from 'url';
import { readMob, listObjects, getField, OBJ } from '../src/formats/mob.js';
import { readMpr } from '../src/formats/mpr.js';
import { readRes } from '../src/formats/res.js';
import { readModel } from '../src/formats/fig.js';
import { AIGRAPH_ID, CLASSES, DIRS, readAiGraph, buildAiGraph, modelBox, objectRect, edgeProbe } from '../src/formats/aigraph.js';

const G = fileURLToPath(new URL('../../Evil Islands/', import.meta.url)); // game folder next to Editor/
const zones = (process.argv[2] || 'zone1,zone4,zone9,zone15,bz2g').split(',');
const figs = new Map(readRes(fs.readFileSync(G + 'Res/figures.res')).map(e => [e.name.toLowerCase(), e.data]));
const boxes = new Map();
const boxOf = name => { if (!boxes.has(name)) { let b = null; try { b = modelBox(readModel(figs.get(name + '.mod'), figs.get(name + '.bon'), name)); } catch { /* missing model */ } boxes.set(name, b); } return boxes.get(name); };

const agree = Array(CLASSES).fill(0), allOpen = Array(CLASSES).fill(0);
let total = 0;
const fit = process.argv[3] === 'fit', samples = Array.from({ length: CLASSES }, () => []);
for (const z of zones) {
  const mob = readMob(fs.readFileSync(G + 'Maps/' + z + '.mob'));
  const orig = readAiGraph(mob.chunks.find(c => c.id === AIGRAPH_ID).data), map = readMpr(fs.readFileSync(G + 'Maps/' + z + '.mpr'));
  const rects = listObjects(mob).filter(o => o.kind !== 0xbbbb0000).map(o => { const b = boxOf((getField(o.node, OBJ.model) || '').toLowerCase()); return b && objectRect(b, getField(o.node, OBJ.pos), getField(o.node, OBJ.rot)); }).filter(Boolean);
  const built = buildAiGraph(map, rects), { W, H } = orig;
  const probe = fit && edgeProbe(map, () => rects);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let d = 0; d < 8; d++) {
    const tx = x + DIRS[d][0], ty = y + DIRS[d][1];
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    total++;
    const i = (y * W + x) * 8 + d, e = probe && probe(x, y, d);
    for (let k = 0; k < CLASSES; k++) {
      const open = orig.layers[k].cost[i] !== 0xffff;
      if (open === (built.layers[k].cost[i] !== 0xffff)) agree[k]++;
      if (open) allOpen[k]++;
      if (e) samples[k].push({ ...e, open });
    }
  }
  process.stderr.write(z + ' ');
}
console.log('\nсовпадение рёбер с оригиналом (в скобках — если бы всё было открыто):');
for (let k = 0; k < CLASSES; k++) console.log(`класс ${k}: ${(100 * agree[k] / total).toFixed(1)}% (${(100 * allOpen[k] / total).toFixed(1)}%)`);

if (fit) {
  const S = [0.5, 0.7, 0.9, 1, 1.2, 1.4, 1.7, 2, 99], D = [0, 0.2, 0.4, 0.6, 1, 1.3, 1.6, 2, Infinity], R = [-99, -2, -1, -0.5, 0, 0.5, 1, 2];
  for (let k = 0; k < CLASSES; k++) {
    let best = { acc: 0 };
    for (const ms of S) for (const md of D) for (const mr of R) {
      let ok = 0;
      for (const e of samples[k]) if ((e.slope <= ms && e.depth <= md && e.clear > mr) === e.open) ok++;
      if (ok > best.acc) best = { acc: ok, ms, md, mr };
    }
    console.log(`класс ${k}: [${best.ms}, ${best.md}, ${best.mr}] -> ${(100 * best.acc / samples[k].length).toFixed(1)}%`);
  }
}
