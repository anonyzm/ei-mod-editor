// Phase G: cave gz3mg static objects
import { call } from './ei.mjs';
import fs from 'node:fs';
import * as G from './geo.mjs';
const R = G.rng(777), rnd = (a, b) => a + (b - a) * R(), pick = a => a[Math.floor(R() * a.length)];
const items = [], taken = [];
const put = (object, x, y, yaw = rnd(0, 360), name, r = 0.8) => { items.push({ object, fields: { pos: [+x.toFixed(2), +y.toFixed(2)], yaw: +yaw.toFixed(1), ...(name ? { name } : {}) } }); taken.push([x, y, r]); };
const copy = (from_mob, copy_of, x, y, yaw, name) => { items.push({ copy_of, from_mob, fields: { pos: [x, y], yaw, ...(name ? { name } : {}) } }); taken.push([x, y, 1.5]); };
const free = (x, y, r) => taken.every(([a, b, c]) => Math.hypot(a - x, b - y) >= r + c);
const floor = (x, y) => G.caveHeight(x, y) < 3.6, edgeFloor = (x, y) => G.caveHeight(x, y) > 3.9 && G.caveHeight(x, y) < 6.5; // decor on the foot of the walls, never on the floor
const hall = n => G.C_HALL.find(h => h[3] === n);
// entrances: mine timbers and torches
for (const [x, y] of [[12, 115.5], [12, 108.5], [176, 31.5], [176, 24.5]]) put('MineTorch00', x, y, 0);
put('OldMineRoad01', 8, 112, 90); put('OldMineRoad02', 184, 28, 90);
// old mine hall: rails, cart, ladder, crates
{ const [x, y] = hall('mine'); put('OldMine01', x - 3, y + 2, 30, undefined, 2); put('OldMine02', x + 4, y - 1, 200, undefined, 2); put('Cart00', x + 1, y + 4, 80, undefined, 1.2); put('Cart_Old', x - 5, y - 3, 10, undefined, 1.2);
  put('Ladder00', x + 6, y + 4, 0); for (let i = 0; i < 4; i++) put(pick(['Box00', 'Barrel00']), x - 2 + i * 1.1, y - 5, rnd(0, 90)); put('MineTorch00', x, y - 6.5, 0); put('MineTorch00', x - 6, y + 4, 0);
  put('SkeletonBody', x + 2, y - 2, 0); put('SkeletonHead', x + 2.6, y - 1.2, 0); put('Money00', x + 1.5, y - 3, 0); }
// panzer queen hall: cocoons and shells
{ const [x, y] = hall('queen'); for (const [dx, dy] of [[-6, 5], [5, 7], [8, -4], [-3, -8]]) copy('zone6', 1433, x + dx, y + dy, rnd(0, 360));
  for (let i = 0; i < 12; i++) { const a = R() * 6.28, r = rnd(4, 14); put(pick(['Bone00', 'Scull00', 'SkeletonHip', 'SkeletonLeftArm', 'Bone00']), x + Math.cos(a) * r, y + Math.sin(a) * r); } }
// troll den: bones, a roasting spit, sacks stolen from the villages
{ const [x, y] = hall('trolls'); copy('zone2', 1312, x, y - 2, 0, 'TrollFire'); put('vertel00', x, y - 2, 0); put('FryBoar00', x, y - 1.8, 0);
  for (let i = 0; i < 14; i++) { const a = R() * 6.28, r = rnd(3, 12); put(pick(['Bone00', 'CowCherep', 'Scull00', 'Bone00', 'SkeletonLeftLeg']), x + Math.cos(a) * r, y + Math.sin(a) * r); }
  put('Barrel00', x + 7, y + 6, 0); put('Box00', x + 8.2, y + 5.2, 20); put('Sack00', x + 6, y + 7.5, 0); put('MoneySack01', x + 7.5, y + 8, 0); put('Skin 01', x - 6, y + 5, 40);
  put('LogStack00', x - 8, y - 3, 0); copy('zone9', 2051, x + 3, y + 10, 180, 'TrollChest'); }
// beholders' hall: crystals
{ const [x, y] = hall('eyes'); put('LeftCrystals00', x - 5, y + 5, 0, undefined, 1); put('RightCrystals00', x + 6, y - 4, 0, undefined, 1); put('LeftCrystals00', x + 3, y + 7, 140, undefined, 1); }
// underground pool: a dead lizard scout
{ put('SkeletonBody', 30, 132, 70); put('SkeletonHead', 30.5, 133, 0); put('Jug00', 31.5, 131, 0); put('Bone00', 29, 130.5, 0); }
// glowing mushrooms, stones and stalagmite-like rocks along the walls
let n = 0;
for (let k = 0; k < 6000 && n < 230; k++) {
  const x = rnd(2, G.CW - 2), y = rnd(2, G.CH - 2); if (!edgeFloor(x, y)) continue;
  if (Math.hypot(x - 3, y - 112) < 14 || Math.hypot(x - 189, y - 28) < 14) continue;
  const o = pick(['Mushroom01Blue', 'Mushroom02 Blue', 'Mushroom01Blue', 'StoneSet00', 'StoneSet01', 'SingleStone00', 'SingleStone01', 'StoneSet03', 'Mushroom02', '3StoneSet03']);
  if (!free(x, y, 1.4)) continue; put(o, x, y); n++;
}
console.log('cave items', items.length);
const cur = await call('map_objects', { mob: 'gz3mg', limit: 100000 });
const old = cur.objects.filter(o => o.kind !== 'unit').map(o => o.id);
if (old.length) await call('map_object_delete', { mob: 'gz3mg', ids: old });
console.log(JSON.stringify(await call('map_object_add', { mob: 'gz3mg', items })).slice(0, 150));
