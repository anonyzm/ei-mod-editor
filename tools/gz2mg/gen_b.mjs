// Phase B: ground painting (autotile by vertex classes) + water/swamp/lava for gz2mg and gz3mg
import { call } from './ei.mjs';
import fs from 'node:fs';
import * as G from './geo.mjs';
const { polyDist, polySD, fbm, vnoise, riverSide } = G;
const which = process.argv[2] || 'all';

export const MAIN_CLASSES = {
  grass: [2, 3, 4, 5, 6, 17, 18, 19, 20, 21, 22, 23, 24],
  dark: [7, 27, 28, 29, 30, 31, 32, 33, 34, 43, 44, 45, 46, 47, 145, 146, 147, 148, 149],
  olive: [26, 196, 197, 198, 199, 337, 338, 339, 345, 369],
  ground: [8, 222, 223, 224, 482],
  stone: [0, 1, 170, 171, 172, 173, 178, 179, 180],
  red: [514, 515],
  plates: [521, 522],
  soil: [519, 520],
  ochre: [512, 513],
  grassE: [808, 809, 810],
  stoneE: [178, 179, 180],
  pave: [811, 812, 813, 814, 815],
};
const CAVE_CLASSES = { moss: [0, 9, 10, 11, 12, 13, 14, 15, 16, 19], rock: [3, 4], pale: [1, 2, 25, 26, 27, 28, 29, 30, 31], dirt: [8] };

function slope(f, x, y) { const h = f(x, y); return Math.max(Math.abs(f(x + 2, y) - h), Math.abs(f(x - 2, y) - h), Math.abs(f(x, y + 2) - h), Math.abs(f(x, y - 2) - h)); }
const H = {}; const hc = (x, y) => (H[x + ',' + y] ??= G.height(x, y));
export function mainClass(x, y) {
  const east = riverSide(x, y) > 0, s = slope(hc, x, y), rd = polyDist(G.RIVER, x, y).d, n = fbm(x / 13, y / 13, 41), n2 = vnoise(x / 5, y / 5, 43);
  const road = Math.min(...G.ROADS.map(R => polyDist(R, x, y).d));
  if (east) {
    const h = hc(x, y), n3 = fbm(x / 7, y / 7, 47), pathD = polyDist(G.SE_PATH, x, y).d, sumD = Math.hypot(x - G.SUMMIT.x - 3, y - G.SUMMIT.y - 3);
    if (rd < G.RIVER_HALF + 1) return 'soil';
    if (sumD < 8.5 + 1.5 * n2) return 'pave';                                           // Dgun plaza around the teleport
    if (Math.hypot(x - G.SUMMIT.x, y - G.SUMMIT.y) < G.SUMMIT.r + 1 && h > 17) return n > 0.5 ? 'stoneE' : (n3 > 0.62 ? 'grassE' : 'plates');
    if (Math.hypot(x - G.GLADE.x, y - G.GLADE.y) < G.GLADE.r + 1.5 * n2) return 'grassE';
    if (pathD < 4.2 + n2) return n3 > 0.58 ? 'stoneE' : 'soil';
    if (G.inPoly(G.PLATEAU, x, y)) { const px = 292 + 2.2 * Math.sin(y / 5.5) + 1.2 * Math.sin(y / 2.3), py = 144 + 2 * Math.sin(x / 6.5); const g = fbm(x / 4.5, y / 4.5, 91);
      if (Math.abs(x - px) < 1.1 + 0.9 * n2 || Math.abs(y - py) < 1 + 0.8 * n2) return 'stoneE'; return g > 0.56 ? 'grassE' : (g < 0.36 && n2 > 0.5 ? 'stoneE' : 'soil'); }
    if (s >= 0.8) return 'stoneE';
    if (h > 9.5) { if (s < 0.35 && n3 > 0.63) return 'grassE'; if (s >= 0.6) return 'stoneE'; return n < 0.32 ? 'plates' : 'red'; }
    for (const [px, py, r] of G.LAVA_POOLS) if (Math.hypot(x - px, y - py) < r + 3 + 3 * n) return 'plates';
    if (road < 1.7 + n2 * 0.8) return 'soil';
    if (rd < G.RIVER_HALF + 4 + 3 * n) return 'soil';
    return n > 0.7 ? 'ochre' : (n < 0.3 ? 'plates' : 'red');
  }
  if (rd < G.RIVER_HALF + 3.5 + 2 * n2) return 'ground';
  const edge = Math.min(x, y, G.W - x, G.H - y);
  if (edge < 20 && polySD(G.MASSIF, x, y) > 0) { if (s >= 0.8 && n2 > 0.6) return 'stone'; if (s >= 0.4) return 'dark'; }
  if (s >= 0.8 || (s >= 0.55 && n2 > 0.45)) return 'stone';
  if (road < 1.6 + n2 * 1.2) return 'ground';
  const sw = polySD(G.SWAMP, x, y);
  if (sw < -2) { const h = hc(x, y); if (h < G.SWAMP_LEVEL + 0.15) return n2 > 0.6 ? 'dark' : 'olive'; return n < 0.45 ? 'dark' : 'grass'; }
  if (Math.hypot(x - G.HUMAN_CAMP.x, y - G.HUMAN_CAMP.y) < 16) return n2 < 0.45 ? 'ground' : 'grass';
  const rg = Math.hypot(x - G.RING.x, y - G.RING.y);
  if (rg < 11) return rg > 7.5 ? 'dark' : 'grass';
  return n < 0.45 ? 'dark' : (n < 0.66 ? 'grass' : (n2 > 0.7 ? 'olive' : 'grass'));
}
function caveClass(x, y) {
  const h = G.caveHeight(x, y), s = slope(G.caveHeight, x, y), n = fbm(x / 9, y / 9, 51);
  if (h > 6 || s >= 1.2) return h > 9 && fbm(x / 16, y / 16, 57) > 0.6 ? 'pale' : 'rock';
  return n < 0.4 ? 'dirt' : 'moss';
}
function runs(fn, Wm, Hm) {
  const ops = [];
  for (let y = 0; y <= Hm; y += 2) { let x0 = 0, c = fn(0, y); for (let x = 2; x <= Wm + 2; x += 2) { const k = x <= Wm ? fn(x, y) : null; if (k !== c) { ops.push({ x0, x1: x - 2, y0: y, y1: y, class: c }); x0 = x; c = k; } } }
  return ops;
}
async function paint(mpr, classes, ops) {
  const ti = await call('terrain_info', { mpr }), exclude = Object.entries(ti.tiles_by_type).filter(([k]) => /water|swamp|lava/.test(k)).flatMap(([, v]) => v);
  for (let i = 0; i < ops.length; i += 4000) {
    const r = await call('terrain_autotile', { mpr, classes, ops: ops.slice(i, i + 4000), exclude });
    console.log(mpr, i, JSON.stringify(r).slice(0, 200));
  }
}
// (nat.mjs imports mainClass; the painting below runs only as a script — and nat.mjs must be rerun after it)
if ((process.argv[1] || '').endsWith('gen_b.mjs')) {
if (which === 'all' || which === 'main') {
  await paint('gz2mg', MAIN_CLASSES, runs(mainClass, G.W, G.H));
  // river water, swamp pools, lava
  const ops = [];
  for (let t = 0; t <= 1; t += 0.02) { const [x, y] = G.polyAt(G.RIVER, t); ops.push({ x, y, radius: G.RIVER_HALF + 3, level: G.WATER_LEVEL, material: 'water', tiles: [64] }); }
  ops.unshift({ x0: 0, y0: 0, x1: 320, y1: 256, remove: true });
  ops.push({ x0: 14, y0: 0, x1: 158, y1: 86, level: G.SWAMP_LEVEL, material: 'swamp', tiles: [9, 10, 11, 12, 13, 14, 15, 16] });
  for (const [x, y, r] of G.LAVA_POOLS) ops.push({ x, y, radius: r + 2, level: 3.8, material: 'lava', tiles: [516, 517, 518] });
  console.log(JSON.stringify(await call('terrain_water', { mpr: 'gz2mg', ops })).slice(0, 300));
}
if (which === 'all' || which === 'cave') {
  await paint('gz3mg', CAVE_CLASSES, runs(caveClass, G.CW, G.CH));
  console.log(JSON.stringify(await call('terrain_water', { mpr: 'gz3mg', ops: [{ x: G.C_POOL.x, y: G.C_POOL.y, radius: G.C_POOL.r + 3, level: 1.5, material: 'water', tiles: [511] }, { x: 26, y: 140, radius: 9, level: 1.6, material: 'water', tiles: [511] }] })).slice(0, 300));
}
for (const m of which === 'all' ? ['gz2mg', 'gz3mg'] : [which === 'main' ? 'gz2mg' : 'gz3mg']) { const r = await call('terrain_render', { mpr: m, size: 1100 }); fs.writeFileSync('render_' + m + '.png', r.img); }
}
