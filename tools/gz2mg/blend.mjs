// Builds blend atlas(es) of soft transition tiles between texture classes of different palettes and adds them to gz2mg.
// Layout of an atlas PNG = texture_export: tile index i sits at column i%8, row 7-(i>>3), 64 px cells (48 visible + 8 border).
import fs from 'node:fs';
import { call } from './ei.mjs';
import * as G from './geo.mjs';
const { decodePng, encodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const atl = {};
function tile(mpr, code) { // 48×48 visible picture of a tile -> Float32 rgb
  const a = code >> 6, l = code & 63, k = mpr + a;
  const im = atl[k] ??= decodePng(fs.readFileSync(`${mpr}${String(a).padStart(3, '0')}.png`));
  const s = im.width / 8, sx = (l & 7) * s + s / 8, sy = (7 - (l >> 3)) * s + s / 8, out = new Float32Array(48 * 48 * 3);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const i = ((sy + Math.floor(y * s * 0.75 / 48)) * im.width + sx + Math.floor(x * s * 0.75 / 48)) * 4; out.set([im.rgba[i], im.rgba[i + 1], im.rgba[i + 2]], (y * 48 + x) * 3); }
  return out;
}
const tone = (t, f) => { const o = new Float32Array(t); for (let i = 0; i < o.length; i += 3) { const g = (o[i] + o[i + 1] + o[i + 2]) / 3; o[i] = (o[i] * f[0] + g * f[3]) ; o[i + 1] = (o[i + 1] * f[1] + g * f[3]); o[i + 2] = (o[i + 2] * f[2] + g * f[3]); } return o; };
// base pictures
const RED = [tile('gz2mg', 514), tile('gz2mg', 515)];
const GRASS = [20, 22, 24].map(c => tone(tile('gz2mg', c), [0.78, 0.7, 0.55, 0.12]));          // dry, darker grass of the burnt hills
const STONE = [180, 178, 179].map(c => tile('gz2mg', c));
const PAVE = [58, 59, 57].map(c => tile('zone10', c));
const CARVED = [113, 114].map(c => tile('zone10', c));
const SOIL = [tile('gz2mg', 519)];
const im = new Uint8Array(512 * 512 * 4), types = Array(64).fill('stone');
let slot = 0;
function put(fn, type) { // fn(u,v) -> [r,g,b] for u,v in visible units (0..1 is the 48 px picture)
  const i = slot++, cx = (i & 7) * 64, cy = (7 - (i >> 3)) * 64;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const c = fn((x - 8 + 0.5) / 48, (y - 8 + 0.5) / 48); const o = ((cy + y) * 512 + cx + x) * 4; im[o] = Math.max(0, Math.min(255, c[0])); im[o + 1] = Math.max(0, Math.min(255, c[1])); im[o + 2] = Math.max(0, Math.min(255, c[2])); im[o + 3] = 255; }
  types[i] = type; return i;
}
const sample = (t, u, v) => { const x = ((Math.floor(u * 48) % 48) + 48) % 48, y = ((Math.floor(v * 48) % 48) + 48) % 48, k = (y * 48 + x) * 3; return [t[k], t[k + 1], t[k + 2]]; };
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// corners: [TL, TR, BL, BR] in picture space (v down); 1 = class B
function blendTile(A, B, corners, seed, typeA, typeB, grain = 0.62) {
  const [tl, tr, bl, br] = corners;
  return put((u, v) => {
    const uu = Math.max(0, Math.min(1, u)), vv = Math.max(0, Math.min(1, v));
    const w = (tl * (1 - uu) + tr * uu) * (1 - vv) + (bl * (1 - uu) + br * uu) * vv;
    const n = 0.65 * G.fbm(u * 1.9 + seed * 7.1, v * 1.9 + seed * 3.3, seed, 3) + 0.35 * G.fbm(u * 6 + seed, v * 6 - seed, seed + 5, 3);
    const m = sst(0.24, 0.76, w + grain * (n - 0.5) * 2);
    const a = sample(A, u, v), b = sample(B, u, v);
    const edge = 1 - 0.08 * Math.exp(-((m - 0.5) ** 2) / 0.03); // a faint darker seam line, like eroded edges
    return [(a[0] * (1 - m) + b[0] * m) * edge, (a[1] * (1 - m) + b[1] * m) * edge, (a[2] * (1 - m) + b[2] * m) * edge];
  }, corners.reduce((s, c) => s + c, 0) >= 2 ? typeB : typeA);
}
const SHAPES = [[1, 0, 0, 0], [1, 1, 0, 0], [1, 0, 0, 1], [1, 1, 1, 0]];
const pairs = [[RED, GRASS, 'stone', 'grass'], [RED, STONE, 'stone', 'stone'], [RED, PAVE, 'stone', 'road'], [STONE, GRASS, 'stone', 'grass'], [SOIL, GRASS, 'ground', 'grass'], [STONE, PAVE, 'stone', 'road']];
const out = {};
pairs.forEach(([A, B, ta, tb], p) => { out[p] = []; for (const [k, s] of SHAPES.entries()) for (let v = 0; v < (p < 4 ? 2 : 1); v++) out[p].push(blendTile(A[v % A.length], B[(v + k) % B.length], s, p * 10 + k * 2 + v + 1, ta, tb)); });
const pure = { grass: GRASS.map(t => put((u, v) => sample(t, u, v), 'grass')), pave: [...PAVE, ...CARVED].map((t, i) => put((u, v) => sample(t, u, v), i < 3 ? 'road' : 'stone')) };
for (const [k, sh] of SHAPES.entries()) for (let v = 0; v < 2; v++) blendTile(SOIL[0], STONE[(v + k) % STONE.length], sh, 90 + k * 2 + v, 'ground', 'stone');   // soil <-> stone paths (appended: earlier codes stay)
console.log('slots used', slot, JSON.stringify(pure));
fs.writeFileSync('blend_atlas.png', encodePng(512, 512, im));
if (process.argv[2] === 'write') {
  const ti = await call('terrain_info', { mpr: 'gz2mg' });
  const atlas = ti.atlases >= 13 ? 12 : ti.atlases; // replace our blend atlas on re-runs
  console.log(JSON.stringify(await call('terrain_tile_import', { mpr: 'gz2mg', atlas, png_path: process.cwd() + '/blend_atlas.png', types })));
  fs.writeFileSync('blend_codes.json', JSON.stringify({ atlas, grass: pure.grass.map(i => atlas * 64 + i), pave: pure.pave.slice(0, 3).map(i => atlas * 64 + i), carved: pure.pave.slice(3).map(i => atlas * 64 + i) }));
}
