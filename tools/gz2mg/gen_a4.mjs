// re-set heights only around the two mine mouths (keeps the rest of the map and its paint)
import { call } from './ei.mjs';
import * as G from './geo.mjs';
for (const [cx, cy] of [[G.CAVE_A.x, G.CAVE_A.y], [G.CAVE_B.x, G.CAVE_B.y]]) {
  const x0 = Math.max(0, Math.floor((cx - 14) / 2) * 2), y0 = Math.max(0, Math.floor((cy - 14) / 2) * 2), rows = [];
  for (let y = y0; y <= Math.min(G.H, y0 + 28); y += 2) { const r = []; for (let x = x0; x <= Math.min(G.W, x0 + 28); x += 2) r.push(+G.height(x, y).toFixed(2)); rows.push(r); }
  console.log(JSON.stringify(await call('terrain_set_heights', { mpr: 'gz2mg', x0, y0, step: 2, rows })));
}
