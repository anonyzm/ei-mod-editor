import { call } from './ei.mjs';
import * as G from './geo.mjs';
for (const [mpr, f, Wm, Hm] of [['gz2mg', G.height, G.W, G.H], ['gz3mg', G.caveHeight, G.CW, G.CH]]) {
  const rows = []; for (let y = 0; y <= Hm; y += 2) { const r = []; for (let x = 0; x <= Wm; x += 2) r.push(+f(x, y).toFixed(2)); rows.push(r); }
  console.log(mpr, JSON.stringify(await call('terrain_set_heights', { mpr, x0: 0, y0: 0, step: 2, rows })));
}
