// shortest open path between two points on a class-3 passability picture: where does a leak go?  node path.mjs png x0 y0 x1 y1
import fs from 'node:fs';
const { decodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const [png, X0, Y0, X1, Y1] = process.argv.slice(2), im = decodePng(fs.readFileSync(png)), W = im.width, H = im.height;
const open = i => !(im.rgba[i * 4] > 180 && im.rgba[i * 4 + 1] < 90), px = (x, y) => { let c = Math.round((H / 2 - y) * 2) * W + Math.round(x * 2); for (let r = 0; r < 12 && !open(c); r++) for (let d = -r; d <= r; d++) for (const e of [c + d + r * W, c + d - r * W, c + r + d * W, c - r + d * W]) if (e >= 0 && e < W * H && open(e)) return e; return c; };
const s = px(+X0, +Y0), t = px(+X1, +Y1), par = new Int32Array(W * H).fill(-1), q = [s]; par[s] = s;
for (let h = 0; h < q.length && par[t] < 0; h++) { const c = q[h], x = c % W; for (const n of [c + 1, c - 1, c + W, c - W]) if (n >= 0 && n < W * H && par[n] < 0 && open(n) && Math.abs(n % W - x) <= 1) { par[n] = c; q.push(n); } }
if (par[t] < 0) { console.log('no path'); process.exit(0); }
const p = []; for (let c = t; c !== s; c = par[c]) p.push(c); console.log('path', p.length / 2, 'm:', p.reverse().filter((_, i) => i % 40 === 0).map(c => (c % W / 2).toFixed(0) + ',' + (H / 2 - ((c / W) | 0) / 2).toFixed(0)).join(' '));
