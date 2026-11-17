// Phase E: write static objects of gz2mg (wipes earlier generated objects first)
import { call } from './ei.mjs';
import fs from 'node:fs';
import { items, counts } from './layout.mjs';
console.log('items', items.length, JSON.stringify(counts));
if (process.argv[2] === 'dry') process.exit(0);
const cur = await call('map_objects', { mob: 'gz2mg', limit: 100000 });
const old = cur.objects.filter(o => o.kind !== 'unit').map(o => o.id);
if (old.length) console.log('delete', old.length, JSON.stringify(await call('map_object_delete', { mob: 'gz2mg', ids: old })).slice(0, 200));
for (let i = 0; i < items.length; i += 600) {
  const r = await call('map_object_add', { mob: 'gz2mg', items: items.slice(i, i + 600) });
  console.log(i, JSON.stringify(r).slice(0, 200));
}
const r = await call('terrain_render', { mpr: 'gz2mg', mob: 'gz2mg', size: 1300, grid: false });
fs.writeFileSync('render_obj.png', r.img); console.log(r.text);
