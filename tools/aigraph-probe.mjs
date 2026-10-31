// Research helper: relate AI-graph edge costs to terrain. Usage: node tools/aigraph-probe.mjs zone1 [layer]
import fs from 'fs';
import { fileURLToPath } from 'url';
import { readMob } from '../src/formats/mob.js';
import { readMpr, heightAt } from '../src/formats/mpr.js';
const G = fileURLToPath(new URL('../../Evil Islands/Maps/', import.meta.url)), name = process.argv[2] || 'zone1', layer = +(process.argv[3] || 0);
const g = Buffer.from(readMob(fs.readFileSync(G + name + '.mob')).chunks.find(c => c.id === 0x31415926).data);
const map = readMpr(fs.readFileSync(G + name + '.mpr'));
const W = g.readUInt32LE(0), H = g.readUInt32LE(4), N = W * H;
const DIRS = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];
const cost = (k, x, y, d) => g.readUInt16LE(8 + k * 19 * N + y * 19 * W + x * 16 + d * 2);
const zAt = (cx, cy) => heightAt(map, Math.min(map.H - 1, cy) * map.W + Math.min(map.W - 1, cx));
const nodeZ = (x, y) => zAt(x * 4 + 2, y * 4 + 2);
const rows = [];
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) for (const d of [4, 6, 5]) {
  const [dx, dy] = DIRS[d], c = cost(layer, x, y, d), dz = nodeZ(x + dx, y + dy) - nodeZ(x, y);
  rows.push({ d, c, dz });
}
for (const d of [6, 5]) {
  const r = rows.filter(r => r.d === d);
  const buckets = {};
  for (const { c, dz } of r) { const b = Math.round(dz * 2) / 2; (buckets[b] ??= []).push(c); }
  console.log(`dir ${d} (${d === 6 ? 'прямо' : 'диагональ'}): dz -> [blocked%, median cost, n]`);
  console.log(Object.entries(buckets).sort((a, b) => a[0] - b[0]).filter(([, v]) => v.length > 20).map(([b, v]) => {
    const ok = v.filter(c => c !== 0xffff).sort((a, b) => a - b);
    return `${b}: ${(100 * (v.length - ok.length) / v.length).toFixed(0)}% ${ok[ok.length >> 1] ?? '-'} n${v.length}`;
  }).join(' | '));
}

// ---- per-node: water / land vs blocked share per layer ----
import { listObjects, getField, OBJ } from '../src/formats/mob.js';
const isWater = (x, y) => { // node covers tiles (2x..2x+1, 2y..2y+1)
  let w = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const t = (y * 2 + j) * map.TW + x * 2 + i; if (map.waterMat[t] !== 0xffff) { const k = (y * 4 + j * 2 + 1) * map.W + x * 4 + i * 2 + 1; if (map.wz[k] > map.z[k]) w++; } }
  return w >= 2;
};
const objs = new Set();
for (const o of listObjects(readMob(fs.readFileSync(G + name + '.mob')))) { const p = getField(o.node, OBJ.pos); objs.add(Math.floor(p[1] / 4) * W + Math.floor(p[0] / 4)); }
console.log('layer: blocked% of all 8 dirs on [land, water, land with object centre]');
for (let k = 0; k < 8; k++) {
  const acc = { land: [0, 0], water: [0, 0], obj: [0, 0] };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const key = objs.has(y * W + x) ? 'obj' : isWater(x, y) ? 'water' : 'land';
    for (let d = 0; d < 8; d++) { acc[key][1]++; if (cost(k, x, y, d) === 0xffff) acc[key][0]++; }
  }
  console.log('L' + k, Object.entries(acc).map(([n, [b, t]]) => `${n} ${(100 * b / t).toFixed(0)}%`).join('  '));
}

// ---- ASCII maps (north up): '.' all 8 dirs open, '#' all closed, digit = closed count ----
if (process.argv[4] === 'ascii') {
  const show = (title, fn) => { console.log('\n' + title); for (let y = H - 1; y >= 0; y--) { let s = ''; for (let x = 0; x < W; x++) s += fn(x, y); console.log(s); } };
  show('terrain: ~ water, ^ steep (>2m over 4m), o object', (x, y) => isWater(x, y) ? '~' : objs.has(y * W + x) ? 'o' : Math.max(...[[1, 0], [0, 1]].map(([dx, dy]) => Math.abs(nodeZ(Math.min(W - 1, x + dx), Math.min(H - 1, y + dy)) - nodeZ(x, y)))) > 2 ? '^' : ' ');
  for (const k of (process.argv[5] || '0,1,7').split(',').map(Number))
    show('layer ' + k, (x, y) => { let n = 0; for (let d = 0; d < 8; d++) if (cost(k, x, y, d) === 0xffff) n++; return n === 0 ? '.' : n === 8 ? '#' : String(n); });
}

// ---- region ids vs connected components; the per-node byte ----
if (process.argv[4] === 'regions') {
  const reg = (k, x, y) => g.readUInt16LE(8 + k * 19 * N + y * 19 * W + W * 17 + x * 2);
  const byte = (k, x, y) => g[8 + k * 19 * N + y * 19 * W + W * 16 + x];
  for (let k = 0; k < 8; k++) {
    // flood fill over open edges
    const comp = new Int32Array(N).fill(-1); let nc = 0;
    for (let s = 0; s < N; s++) if (comp[s] < 0) { const st = [s]; comp[s] = nc; while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; for (let d = 0; d < 8; d++) if (cost(k, x, y, d) !== 0xffff) { const j = (y + DIRS[d][1]) * W + x + DIRS[d][0]; if (comp[j] < 0) { comp[j] = nc; st.push(j); } } } nc++; }
    // does each region id map to exactly one component and vice versa?
    const r2c = new Map(), c2r = new Map(); let conflicts = 0, isolatedFFFF = 0, ffff = 0;
    for (let i = 0; i < N; i++) { const r = reg(k, i % W, (i / W) | 0); if (r === 0xffff) { ffff++; continue; }
      if (r2c.has(r) && r2c.get(r) !== comp[i]) conflicts++; r2c.set(r, comp[i]); if (c2r.has(comp[i]) && c2r.get(comp[i]) !== r) conflicts++; c2r.set(comp[i], r); }
    const sym = new Set(); for (let i = 0; i < N; i++) { let open = 0; for (let d = 0; d < 8; d++) if (cost(k, i % W, (i / W) | 0, d) !== 0xffff) open++; if (!open && reg(k, i % W, (i / W) | 0) === 0xffff) isolatedFFFF++; }
    const bh = {}; for (let i = 0; i < N; i++) { const b = byte(k, i % W, (i / W) | 0); bh[b.toString(16)] = (bh[b.toString(16)] || 0) + 1; }
    console.log(`L${k}: components ${nc}, region ids ${r2c.size}, ffff ${ffff} (isolated nodes with ffff ${isolatedFFFF}), conflicts ${conflicts}; byte top: ${Object.entries(bh).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a, b]) => a + ':' + b).join(' ')}`);
  }
}

if (process.argv[4] === 'byte') {
  const byte = (k, x, y) => g[8 + k * 19 * N + y * 19 * W + W * 16 + x];
  const steep = (x, y) => Math.max(...[[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => Math.abs(nodeZ(Math.max(0, Math.min(W - 1, x + dx)), Math.max(0, Math.min(H - 1, y + dy))) - nodeZ(x, y))));
  const tileType = (x, y) => map.tileTypes[map.tiles[(y * 2) * map.TW + x * 2] & 0x3fff];
  const k = layer, by = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = byte(k, x, y).toString(16).padStart(2, '0'), s = (by[b] ??= { n: 0, water: 0, obj: 0, steep: 0, open: 0, tt: {} });
    s.n++; if (isWater(x, y)) s.water++; if (objs.has(y * W + x)) s.obj++; s.steep += steep(x, y);
    for (let d = 0; d < 8; d++) if (cost(k, x, y, d) !== 0xffff) s.open++;
    const t = tileType(x, y); s.tt[t] = (s.tt[t] || 0) + 1;
  }
  for (const [b, s] of Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 14))
    console.log(`byte ${b}: n${s.n} water ${(100 * s.water / s.n).toFixed(0)}% obj ${(100 * s.obj / s.n).toFixed(0)}% avgSteep ${(s.steep / s.n).toFixed(2)} openDirs ${(s.open / s.n).toFixed(1)} tileTypes ${Object.entries(s.tt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => t + ':' + c).join(',')}`);
}
