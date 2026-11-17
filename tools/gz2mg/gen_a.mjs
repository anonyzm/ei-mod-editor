// Phase A: zones, atlases, relief, water (gz2mg + gz3mg)
import { call } from './ei.mjs';
import * as G from './geo.mjs';
const step = 2, log = (...a) => console.log(...a);
const zl = await call('zones_list', { allod: 'gipat' });
if (!zl.find(z => z.id === 'gz2mg')) log(await call('zone_create', { id: 'gz2mg', file: 'gz2mg', allod: 'gipat', tpl: 'gz1mg', relief: 'flat', sx: 10, sy: 8, link: 'gz1mg', title: 'Огненный рубеж' }));
if (!zl.find(z => z.id === 'gz3mg')) log(await call('zone_create', { id: 'gz3mg', file: 'gz3mg', allod: 'gipat', tpl: 'gz10g', relief: 'flat', sx: 6, sy: 5, link: 'gz2mg', title: 'Панцирные норы' }));
let ti = await call('terrain_info', { mpr: 'gz2mg' });
log('gz2mg atlases', ti.atlases, 'max', ti.max_height);
for (let a = ti.atlases; a < 12; a++) log(await call('terrain_tile_import', { mpr: 'gz2mg', atlas: a, from_mpr: 'zone16', from_atlas: a - 8 }));
function rows(f, Wm, Hm) { const r = []; for (let y = 0; y <= Hm; y += step) { const row = []; for (let x = 0; x <= Wm; x += step) row.push(+f(x, y).toFixed(2)); r.push(row); } return r; }
log('heights main', JSON.stringify(await call('terrain_set_heights', { mpr: 'gz2mg', x0: 0, y0: 0, step, rows: rows(G.height, G.W, G.H) })).slice(0, 300));
log('heights cave', JSON.stringify(await call('terrain_set_heights', { mpr: 'gz3mg', x0: 0, y0: 0, step, rows: rows(G.caveHeight, G.CW, G.CH) })).slice(0, 300));
ti = await call('terrain_info', { mpr: 'gz2mg' }); log('gz2mg', ti.atlases, ti.max_height, JSON.stringify(ti.height_range));
const tc = await call('terrain_info', { mpr: 'gz3mg' }); log('gz3mg', tc.atlases, tc.max_height, JSON.stringify(tc.height_range), JSON.stringify(tc.tiles_by_type).slice(0, 1500));
