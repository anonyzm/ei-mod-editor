// 2026-11-17 fixes after the user's review of gz2mg:
//  swamp: causeway peninsula → central island → cave causeway; the road along the massif foot is blocked
//  summit: the shrine ring had no gap and Dgun Gate 00 (solid for the AI graph) sat on the path → open the south side
//  rocks: Rock00 (nast1) is an open-backed cliff slab → closed stone sets
// node fix_1117.mjs [swamp|summit|rocks]   (no arg = all)
import { call } from './ei.mjs';
import * as G from './geo.mjs';
const only = process.argv[2], mob = 'gz2mg', mpr = 'gz2mg';
const log = (...a) => console.log(...a.map(x => typeof x === 'string' ? x : JSON.stringify(x).slice(0, 300)));
const along = (P, step) => { const out = []; for (let i = 0; i + 1 < P.length; i++) { const [ax, ay] = P[i], [bx, by] = P[i + 1], n = Math.ceil(Math.hypot(bx - ax, by - ay) / step); for (let k = 0; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); } return out; };

if (only === 'swamp1') { // (ran on 2026-11-17; the rest is 'swamp')
  const CAUSE = G.ROADS[1].slice(3); // [88,70] … [109,69]: the new dry way over the central island
  const pts = along(CAUSE.slice(1), 1.2);
  // clear what stands on it
  const hit = new Set();
  for (const [x, y] of along(CAUSE, 2)) for (const o of (await call('map_objects', { mob, near: [x, y, 2.8], kind: 'object' })).objects) hit.add(o.id);
  if (hit.size) log('cleared', await call('map_object_delete', { mob, ids: [...hit] }));
  log('sculpt', await call('terrain_sculpt', { mpr, ops: pts.map(([x, y]) => ({ tool: 'set', x, y, radius: 2.6, height: 2.1 })) }));
  // ground on the causeway; the old road along the foot becomes grass again
  const ti = await call('terrain_info', { mpr }), exclude = Object.entries(ti.tiles_by_type).filter(([k]) => /water|swamp|lava/.test(k)).flatMap(([, v]) => v);
  const classes = { grass: [2, 3, 4, 5, 6, 17, 18, 19, 20, 21, 22, 23, 24], dark: [7, 27, 28, 29, 30, 31, 32, 33, 34, 43, 44, 45, 46, 47, 145, 146, 147, 148, 149], ground: [8, 222, 223, 224, 482] };
  const OLD = [[82, 86], [100, 84], [104, 81]];
  log('paint', await call('terrain_autotile', { mpr, classes, exclude, ops: [
    ...along(OLD, 1.5).filter(([x]) => x > 86).map(([x, y], i) => ({ x, y, radius: 2.4, class: i % 5 < 3 ? 'dark' : 'grass' })),
    ...pts.map(([x, y]) => ({ x, y, radius: 1.5, class: 'ground' })) ] }));
}
if (!only || only === 'swamp') {
  // the neck between the swamp and the massif cliff (x≈97, y 77…90): a rockfall across the old road. Objects are solid
  // boxes for the AI graph, so it closes the way in both games (the tile brush needs textures.res, locked while game.exe runs)
  log('rockfall', await call('map_object_add', { mob, items: [
    { object: 'StoneSet01', fields: { pos: [97, 80], yaw: 90 } }, { object: 'StoneSet03', fields: { pos: [96.5, 86.5], yaw: 95 } },
    { object: 'SingleStone01', fields: { pos: [99.5, 76.5], yaw: 140 } }, { object: 'SingleStone00', fields: { pos: [95, 91], yaw: 30 } },
    { object: 'Bush00', fields: { pos: [93, 82] } }, { object: 'Bush00', fields: { pos: [101, 85] } } ] }));
}

if (!only || only === 'summit') {
  const byName = async n => (await call('map_objects', { mob, query: n, limit: 20 })).objects.find(o => o.name === n);
  const P = { x: G.SUMMIT.x + 3, y: G.SUMMIT.y + 3 }; // teleport (292, 245); its path tile and entrance face south
  const south = (await call('map_objects', { mob, near: [P.x, P.y - 7.8, 1.5], query: 'DgunColoumns' })).objects;
  const gate = await byName('Dgun Gate 00-467') || (await call('map_objects', { mob, near: [290, 235, 4], query: 'Dgun Gate' })).objects[0];
  const del = [...south.map(o => o.id), ...(gate ? [gate.id] : [])];
  if (del.length) log('summit del', await call('map_object_delete', { mob, ids: del }));
  const dragons = (await call('map_objects', { mob, near: [290, 235, 6], query: 'Dgun Dragon' })).objects;
  for (const [o, x] of dragons.map((o, i) => [o, i ? P.x + 5 : P.x - 5])) await call('map_object_set', { mob, id: o.id, fields: { pos: [x, P.y - 8.3], yaw: 0 } });
  for (const [n, x, y] of [['GateGuardH1', P.x - 3, P.y - 10.5], ['GateGuardH2', P.x + 3, P.y - 10.5]]) {
    const u = await byName(n); await call('map_object_set', { mob, id: u.id, fields: { pos: [x, y], yaw: 0 } });
    await call('map_patrol_set', { mob, id: u.id, points: [{ pos: [x, y], wait: 3600 }] });
  }
  const ap = await byName('Apprentice'); await call('map_object_set', { mob, id: ap.id, fields: { pos: [P.x + 9, P.y - 6] } });
  log('summit ok', dragons.length, 'dragons');
}

if (!only || only === 'rocks') {
  const rocks = (await call('map_objects', { mob, query: 'Rock00', kind: 'object', limit: 200 })).objects.filter(o => o.prototype === 'Rock00');
  if (rocks.length) {
    log('rocks add', await call('map_object_add', { mob, items: rocks.map((o, i) => ({ object: i % 2 ? 'StoneSet01' : 'StoneSet03', fields: { pos: o.pos.slice(0, 2), yaw: o.yaw } })) }));
    log('rocks del', await call('map_object_delete', { mob, ids: rocks.map(o => o.id) }));
  }
}
