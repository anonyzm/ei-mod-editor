// Phase F: creatures + routes + diplomacy for gz2mg / gz3mg
import { call } from './ei.mjs';
import fs from 'node:fs';
import * as G from './geo.mjs';
import { U, RAT_NEST } from './units.mjs';
function bad(mob, x, y) {
  if (mob === 'gz3mg') return G.caveHeight(x, y) > 4.5 ? 'wall' : (G.caveHeight(x, y) < 1.4 ? 'water' : null);
  if (x < 1 || y < 1 || x > G.W - 1 || y > G.H - 1) return 'edge';
  if (G.polyDist(G.RIVER, x, y).d < G.RIVER_HALF + 0.8) return 'river';
  const h = G.height(x, y); if (h < 1.3 && G.polySD(G.SWAMP, x, y) < 2) return 'swamp-water';
  for (const [px, py, r] of G.LAVA_POOLS) if (Math.hypot(x - px, y - py) < r + 0.5) return 'lava';
  const s = Math.max(...[[1, 0], [0, 1], [-1, 0], [0, -1]].map(([a, b]) => Math.abs(G.height(x + a, y + b) - h))); if (s > 0.9) return 'steep ' + s.toFixed(2);
  return null;
}
const flyer = u => /Bat|Willowisp|Banshee|Evileye/.test(u.unit);
function fix(u, p) { if (flyer(u) && !/edge|wall/.test(bad(u.mob, p[0], p[1]) || '')) return p; if (!bad(u.mob, p[0], p[1])) return p;
  for (let r = 1; r <= 10; r += 1) for (let a = 0; a < 6.28; a += 0.4) { const q = [+(p[0] + Math.cos(a) * r).toFixed(2), +(p[1] + Math.sin(a) * r).toFixed(2)]; if (!bad(u.mob, q[0], q[1])) return q; } return null; }
for (const u of U) { const f = fix(u, u.fields.pos); if (f) u.fields.pos = f; if (u.route) u.route = u.route.map(p => { const q = fix(u, p.pos); return q ? { ...p, pos: q } : null; }).filter(Boolean); }
let problems = 0;
for (const u of U) { const pts = [u.fields.pos, ...(u.route || []).map(p => p.pos)]; for (const [x, y] of pts) { const b = flyer(u) ? null : bad(u.mob, x, y); if (b) { problems++; console.log('BAD', u.mob, u.fields.name || u.unit, x, y, b); } } }
console.log('units', U.length, 'problems', problems);
if (process.argv[2] === 'dry') process.exit(0);
const ids = new Map();
for (const mob of ['gz2mg', 'gz3mg']) {
  const cur = await call('map_objects', { mob, kind: 'unit', limit: 10000 });
  if (cur.total) await call('map_object_delete', { mob, ids: cur.objects.map(o => o.id) });
  const list = U.filter(u => u.mob === mob);
  const r = await call('map_object_add', { mob, items: list.map(u => ({ unit: u.unit, fields: u.fields })) });
  list.forEach((u, i) => ids.set(u, r.ids[i])); console.log(mob, 'added', r.added);
  let n = 0; for (const u of list) if (u.route) { await call('map_patrol_set', { mob, id: ids.get(u), points: u.route }); n++; } else await call('map_patrol_set', { mob, id: ids.get(u), points: [{ pos: u.fields.pos.slice(0, 2), wait: 3600 }] });
  console.log(mob, 'routes', n);
}
{ const [x, y] = RAT_NEST, R = G.rng(9), it = [];
  for (let i = 0; i < 12; i++) { const a = R() * 6.28, r = 2 + R() * 6; it.push({ object: ['Bone00', 'Scull00', 'Log01', 'Stub02', 'CowCherep', 'SkeletonHip', 'Bone00'][i % 7], fields: { pos: [+(x + Math.cos(a) * r).toFixed(2), +(y + Math.sin(a) * r).toFixed(2)], yaw: Math.round(R() * 360) } }); }
  const have = await call('map_objects', { mob: 'gz2mg', near: [x, y, 9], kind: 'object' }); if (have.total < 6) console.log('rat nest', JSON.stringify(await call('map_object_add', { mob: 'gz2mg', items: it })).slice(0, 80)); }
const named = {}; for (const u of U) if (u.fields.name) named[u.mob + ':' + u.fields.name] = ids.get(u);
fs.writeFileSync('unit_ids.json', JSON.stringify(named, null, 1));
// diplomacy: 0 hero, 2 humans+lizards, 3 orcs, 4 guardians (golems, dead, traps), 5 magister, 6 beasts, 7 peaceful
const E = 'enemy', N = 'neutral', A = 'ally', set = [];
for (let a = 1; a < 10; a++) for (let b = a + 1; b < 10; b++) set.push({ a, b, value: N });
for (const b of [3, 4, 5, 6]) set.push({ a: 0, b, value: E });
set.push({ a: 0, b: 2, value: N }, { a: 0, b: 7, value: N }, { a: 2, b: 3, value: E }, { a: 2, b: 5, value: E }, { a: 3, b: 5, value: A });
console.log(JSON.stringify(await call('map_diplomacy', { mob: 'gz2mg', set })).slice(0, 300));
console.log(JSON.stringify(await call('map_diplomacy', { mob: 'gz3mg', set: [{ a: 0, b: 6, value: E }, { a: 0, b: 7, value: N }] })).slice(0, 300));
