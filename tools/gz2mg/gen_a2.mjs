import { call } from './ei.mjs';
import * as G from './geo.mjs';
const rows = []; for (let y = 0; y <= G.H; y += 2) { const r = []; for (let x = 0; x <= G.W; x += 2) r.push(+G.height(x, y).toFixed(2)); rows.push(r); }
console.log(JSON.stringify(await call('terrain_set_heights', { mpr: 'gz2mg', x0: 0, y0: 0, step: 2, rows })));
