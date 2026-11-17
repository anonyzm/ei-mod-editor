// connectivity check on the class-3 passability picture (1 px = 0.5 m, north up)
import fs from 'node:fs';
import * as G from './geo.mjs';
const { decodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const im = decodePng(fs.readFileSync(process.argv[2] || 'pass_main.png')), W = im.width, H = im.height, Hm = H / 2;
const open = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { const r = im.rgba[i * 4], g = im.rgba[i * 4 + 1]; open[i] = !(r > 180 && g < 90) ? 1 : 0; }
const px = (x, y) => [Math.round(x * 2), Math.round((Hm - y) * 2)];
function flood(sx, sy, block = () => false) {
  const seen = new Uint8Array(W * H); let [x0, y0] = px(sx, sy);
  // nudge to an open cell
  let s = -1; for (let r = 0; r < 12 && s < 0; r++) for (let dy = -r; dy <= r && s < 0; dy++) for (let dx = -r; dx <= r && s < 0; dx++) { const x = x0 + dx, y = y0 + dy; if (x >= 0 && y >= 0 && x < W && y < H && open[y * W + x] && !block(x / 2, Hm - y / 2)) s = y * W + x; }
  if (s < 0) return null; const q = [s]; seen[s] = 1;
  while (q.length) { const c = q.pop(), x = c % W, y = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (seen[n] || !open[n] || block(nx / 2, Hm - ny / 2)) continue; seen[n] = 1; q.push(n); } }
  return (x, y) => { const [a, b] = px(x, y); for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const i = (b + dy) * W + a + dx; if (seen[i]) return true; } return false; };
}
const P = { entry: [6, 54], camp: [56, 188], glade: [221, 55], lizards: [128, 52], caveA: [112, 80], ring: [40, 226], rats: [151, 44], ferryW: [153.8, 64],
  pocket: [292, 38], cemetery: [292, 140], plains: [200, 140], orcbank: [130, 170], summit: [285, 236], lair: [194, 236], ferryE: [181.5, 68], farm: [148, 200] };
if (process.argv[3] === 'liz') { const F = flood(6, 54); const out = []; for (const R of [G.ROADS[1], G.ROADS[2]]) for (let t = 0; t <= 1.0001; t += 0.1) { const [x, y] = G.polyAt(R, t); out.push(t.toFixed(1) + ':' + (F(x, y) ? 1 : 0) + '@' + x.toFixed(0) + ',' + y.toFixed(0) + ' h' + G.height(x, y).toFixed(2)); } for (const [x, y] of [[128, 60], [124, 55], [128, 52], [132, 50], [120, 52]]) out.push('isl ' + x + ',' + y + ':' + (F(x, y) ? 1 : 0) + ' h' + G.height(x, y).toFixed(2)); console.log(out.join(' | ')); process.exit(0); }
if (process.argv[3] === 'dry') { // 2026-11-17: dry way to cave A = over the central island only; the teleport is reachable
  const wet = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) { const r = im.rgba[i * 4], g = im.rgba[i * 4 + 1], b = im.rgba[i * 4 + 2]; wet[i] = r > 180 && g > 70 && g < 170 && b < 80 ? 1 : 0; }
  const dryBlock = extra => (x, y) => wet[Math.round((Hm - y) * 2) * W + Math.round(x * 2)] || extra(x, y);
  const cause = (x, y) => G.polyDist(G.ROADS[1].slice(3), x, y).d < 3.5;
  console.log('dry entry->caveA', flood(...P.entry, dryBlock(() => false))(...P.caveA), '| without the causeway', flood(...P.entry, dryBlock(cause))(...P.caveA));
  console.log('plains->teleport door', flood(...P.plains)(292, 239.5));
  process.exit(0); }
if (process.argv[3] === 'diag') { const Pl = flood(200, 140); const out = []; for (let t = 0; t <= 1.0001; t += 0.04) { const [x, y] = G.polyAt(G.MAGE_PATH, t); out.push(t.toFixed(2) + ':' + (Pl(x, y) ? 1 : 0) + '@' + x.toFixed(0) + ',' + y.toFixed(0) + ' h' + G.height(x, y).toFixed(1)); } console.log(out.join('  ')); process.exit(0); }
if (process.argv[2] === 'pass_cave.png') { const f = flood(14, 112); console.log('cave west->east', f(186, 28), 'trolls', f(116, 130), 'queen', f(86, 80), 'mine', f(80, 38), 'pool', f(26, 140)); process.exit(0); }
const W0 = flood(...P.entry), Pk = flood(...P.pocket), Pl = flood(...P.plains);
console.log('from west entry:', Object.entries(P).map(([k, v]) => k + '=' + W0(...v)).join(' '));
console.log('from SE pocket:', Object.entries(P).map(([k, v]) => k + '=' + Pk(...v)).join(' '));
console.log('from plains:', Object.entries(P).map(([k, v]) => k + '=' + Pl(...v)).join(' '));
const noPlateau = flood(...P.pocket, (x, y) => G.inPoly(G.PLATEAU, x, y));
console.log('pocket reaches plains without the cemetery plateau:', noPlateau(...P.plains));
const noPath = flood(...P.plains, (x, y) => G.polyDist(G.MAGE_PATH, x, y).d < 4 && G.polyDist(G.MAGE_PATH, x, y).t > 0.15 && G.polyDist(G.MAGE_PATH, x, y).t < 0.9);
console.log('plains reach summit without the serpentine:', noPath(...P.summit));
