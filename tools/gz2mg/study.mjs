// relief / water statistics of landscapes, to compare our zones with the originals.  node study.mjs zone1 gz1mg ...
import fs from 'node:fs';
const { readMpr } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/formats/mpr.js');
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
export function load(name) { return readMpr(new Uint8Array(fs.readFileSync(`C:/GOG Games/EI_edit/Evil Islands/Maps/${name}.mpr`))); }
export function blur(z, W, H, r) { // box blur via two passes
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x < W; x++) { if (x + r < W) s += z[y * W + Math.min(W - 1, x + r)]; if (x - r - 1 >= 0) s -= z[y * W + x - r - 1]; if (x >= 0) t[y * W + x] = s / (Math.min(W - 1, x + r) - Math.max(0, x - r) + 1); } }
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y < H; y++) { if (y + r < H) s += t[Math.min(H - 1, y + r) * W + x]; if (y - r - 1 >= 0) s -= t[(y - r - 1) * W + x]; if (y >= 0) o[y * W + x] = s / (Math.min(H - 1, y + r) - Math.max(0, y - r) + 1); } }
  return o;
}
export function stats(name) {
  const m = load(name), { W, H, TW, TH } = m, z = Float32Array.from(m.z, v => v / 65535 * m.maxZ);
  const sl = [], lap = []; let nz = 0, sd = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x;
    sl.push(Math.hypot(z[k + 1] - z[k - 1], z[k + W] - z[k - W]) / 2); lap.push(Math.abs(z[k] - (z[k - 1] + z[k + 1] + z[k - W] + z[k + W]) / 4));
    if (m.dx[k] || m.dy[k]) nz++; sd += m.dx[k] * m.dx[k] + m.dy[k] * m.dy[k]; }
  sl.sort((a, b) => a - b); lap.sort((a, b) => a - b);
  const band = r => { const b = blur(z, W, H, r); let s = 0; for (let i = 0; i < z.length; i++) s += (z[i] - b[i]) ** 2; return Math.sqrt(s / z.length); };
  // water bodies on the tile grid
  const wet = new Uint8Array(TW * TH); for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) { const k = ty * 2 * W + tx * 2; if (m.waterMat[ty * TW + tx] !== 0xffff && m.wz[k] > m.z[k]) wet[ty * TW + tx] = 1; }
  const seen = new Uint8Array(TW * TH), bodies = [];
  for (let s = 0; s < TW * TH; s++) if (wet[s] && !seen[s]) { const st = [s]; seen[s] = 1; let A = 0, P = 0, x0 = 1e9, x1 = 0, y0 = 1e9, y1 = 0;
    while (st.length) { const c = st.pop(), x = c % TW, y = (c / TW) | 0; A++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const n = ny * TW + nx; if (!wet[n]) { P++; continue; } if (!seen[n]) { seen[n] = 1; st.push(n); } } }
    // the staircase of a tile grid inflates the perimeter by ~4/π
    if (A > 40) bodies.push({ area: A * 4, round: +(4 * Math.PI * A / (P * Math.PI / 4) ** 2).toFixed(2), fill: +(A / ((x1 - x0 + 1) * (y1 - y0 + 1))).toFixed(2), box: [x0 * 2, y0 * 2, x1 * 2 + 2, y1 * 2 + 2] }); }
  return { name, size: [W - 1, H - 1], maxZ: +m.maxZ.toFixed(1), zmed: +q(Float32Array.from(z).sort(), 0.5).toFixed(1), slope: [0.5, 0.75, 0.9, 0.99].map(p => +q(sl, p).toFixed(2)), steep06: +(sl.filter(v => v > 0.6).length / sl.length).toFixed(3),
    lap: [0.5, 0.9, 0.99].map(p => +q(lap, p).toFixed(3)), band: [1, 3, 8, 24].map(r => +band(r).toFixed(2)), jitter: [+(nz / sl.length).toFixed(2), +Math.sqrt(sd / sl.length).toFixed(1)], bodies: bodies.sort((a, b) => b.area - a.area).slice(0, 5) };
}
if ((process.argv[1] || '').endsWith('study.mjs')) for (const n of process.argv.slice(2)) console.log(JSON.stringify(stats(n)));
