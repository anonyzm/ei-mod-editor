// hillshade + height tint + liquids of a landscape → PNG (2 px/m, north up).  node shade.mjs zone1 out.png [x0 y0 x1 y1]
import fs from 'node:fs';
import { load } from './study.mjs';
const { encodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const [name, out, X0 = 0, Y0 = 0, X1, Y1] = process.argv.slice(2);
const m = load(name), { W, H, TW } = m, x0 = +X0, y0 = +Y0, x1 = +(X1 ?? W - 1), y1 = +(Y1 ?? H - 1), S = 2, w = (x1 - x0) * S, h = (y1 - y0) * S, o = new Uint8Array(w * h * 4);
const z = (x, y) => { x = Math.max(0, Math.min(W - 1.001, x)); y = Math.max(0, Math.min(H - 1.001, y)); const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * W + i, c = m.maxZ / 65535; return ((m.z[k] * (1 - fx) + m.z[k + 1] * fx) * (1 - fy) + (m.z[k + W] * (1 - fx) + m.z[k + W + 1] * fx) * fy) * c; };
for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
  const x = x0 + px / S, y = y1 - py / S, gx = z(x + 0.5, y) - z(x - 0.5, y), gy = z(x, y + 0.5) - z(x, y - 0.5);
  const l = Math.max(0.15, Math.min(1.6, 0.85 + (-gx * 0.7 + gy * 0.7) * 0.55)), t = z(x, y) / m.maxZ;
  let c = [90 + 150 * t, 130 + 60 * t, 70 + 60 * t].map(v => v * l);
  const k = Math.round(y) * W + Math.round(x), tk = Math.min(m.TH - 1, y >> 1) * TW + Math.min(TW - 1, x >> 1), mat = m.materials[m.waterMat[tk]];
  if (mat && m.wz[k] > m.z[k]) c = mat.selfIllum > 0 ? [220, 80, 30] : [60, 100, 170];
  const i = (py * w + px) * 4; o[i] = Math.min(255, c[0]); o[i + 1] = Math.min(255, c[1]); o[i + 2] = Math.min(255, c[2]); o[i + 3] = 255;
}
fs.writeFileSync(out, encodePng(w, h, o));
