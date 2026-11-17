// Rock00 (nast1) is an open-backed cliff slab — never used (2026-11-17)
// Object layout of gz2mg (static objects + copies). Units live in units.mjs.
import * as G from './geo.mjs';
const { polyDist, polySD, polyAt, fbm, vnoise, rng, riverSide } = G;
const R = rng(20261116);
const rnd = (a, b) => a + (b - a) * R(), pick = a => a[Math.floor(R() * a.length)];
export const items = [];          // {object|copy_of+from_mob, fields:{pos,yaw,name?}}
const taken = [];                 // [x, y, r] occupied circles
const grid = new Map();
function occ(x, y, r) { taken.push([x, y, r]); const k = Math.floor(x / 8) + ',' + Math.floor(y / 8); (grid.get(k) || grid.set(k, []).get(k)).push([x, y, r]); }
function free(x, y, r) { const gx = Math.floor(x / 8), gy = Math.floor(y / 8); for (let i = gx - 2; i <= gx + 2; i++) for (let j = gy - 2; j <= gy + 2; j++) for (const [a, b, c] of grid.get(i + ',' + j) || []) if (Math.hypot(a - x, b - y) < r + c) return false; return true; }
export function put(object, x, y, yaw = rnd(0, 360), extra = {}, r = 0) { items.push({ object, fields: { pos: [+x.toFixed(2), +y.toFixed(2), ...(extra.z !== undefined ? [extra.z] : [])], yaw: +(((yaw % 360) + 360) % 360).toFixed(1), ...(extra.name ? { name: extra.name } : {}) } }); if (r) occ(x, y, r); }
export function copy(from_mob, copy_of, x, y, yaw, name, z, r = 1.5) { items.push({ copy_of, from_mob, fields: { pos: z !== undefined ? [x, y, z] : [x, y], yaw, ...(name ? { name } : {}) } }); occ(x, y, r); }
const deg = a => a * 180 / Math.PI;
// a wall-like line of segments; long: 'x' if the model's long axis is local x
function line(object, P, step, long, opts = {}) {
  const L = []; let tot = 0; for (let i = 0; i + 1 < P.length; i++) { const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); L.push(l); tot += l; }
  for (let d = step / 2; d < tot; d += step) {
    const t = d / tot; if (opts.skip && opts.skip(t, d)) continue;
    const [x, y, a] = polyAt(P, t); const yaw = deg(a) + (long === 'x' ? 0 : -90) + (opts.jit ? rnd(-opts.jit, opts.jit) : 0);
    put(object, x, y, yaw, {}, opts.r ?? step / 2);
  }
}
// ---------- terrain queries ----------
const hgt = (x, y) => G.height(x, y);
function slopeAt(x, y) { const h = hgt(x, y); return Math.max(Math.abs(hgt(x + 1.5, y) - h), Math.abs(hgt(x, y + 1.5) - h), Math.abs(hgt(x - 1.5, y) - h), Math.abs(hgt(x, y - 1.5) - h)) / 1.5; }
const roadD = (x, y) => Math.min(...G.ROADS.map(P => polyDist(P, x, y).d));
function wet(x, y) {
  if (polyDist(G.RIVER, x, y).d < G.RIVER_HALF + 1.5) return true;
  if (polySD(G.SWAMP, x, y) < 2 && riverSide(x, y) < 0 && hgt(x, y) < G.SWAMP_LEVEL + 0.1) return true;
  for (const [px, py, r] of G.LAVA_POOLS) if (Math.hypot(x - px, y - py) < r + 1.5) return true;
  return false;
}
const pathsKeep = [[G.SE_PATH, 6], [G.MAGE_PATH, 6], [G.RAMP, 6]];
function keepClear(x, y) {
  for (const [P, w] of pathsKeep) if (polyDist(P, x, y).d < w) return true;
  const ex = [[2, 54, 9], [112, 78, 8], [296, 40, 9], [112, 87, 6], [307, 41, 6]];
  for (const [a, b, r] of ex) if (Math.hypot(x - a, y - b) < r) return true;
  return false;
}
// ---------- setpiece reservations (no random scatter inside) ----------
const RES = [[G.HUMAN_CAMP.x, G.HUMAN_CAMP.y, 24], [G.LIZARD_VIL.x, G.LIZARD_VIL.y, 13], [G.RING.x, G.RING.y, 10], [G.ORC_CAMP.x + 4, G.ORC_CAMP.y, 32], [G.BRIDGE.x, G.BRIDGE.y, 14],
  [292, 140, 27], [G.SUMMIT.x, G.SUMMIT.y, 17], [G.LAIR.x, G.LAIR.y, 12], [148, 204, 11], [151, 44, 7], [G.GLADE.x, G.GLADE.y, 9]];
for (const [x, y, r] of RES) occ(x, y, r);
const at = (P, t, side = 0) => { const [x, y, a] = polyAt(P, t); return [x - Math.sin(a) * side, y + Math.cos(a) * side, a]; };

// ================= SETPIECES (Gipat objects only, unless noted) =================
// --- broken bridge: two halves of a Bridge 00 reach out from the banks, the middle span is gone ---
{ const p = polyDist(G.RIVER, G.BRIDGE.x, G.BRIDGE.y); const [cx, cy, a] = polyAt(G.RIVER, p.t); const ux = Math.sin(a), uy = -Math.cos(a); // across the river
  const yaw = deg(Math.atan2(uy, ux)) - 90; // the model's long axis is its local y
  for (const s of [-1, 1]) { const d = 8.4; const x = cx + ux * d * s, y = cy + uy * d * s; put('Bridge 00', x, y, yaw + (s > 0 ? 180 : 0), { z: +Math.max(0, 5.1 - hgt(x, y)).toFixed(2) }, 3); }
  put('OrcBridge00', cx - ux * 1.6, cy - uy * 1.6, yaw + 90 + 9, { z: 0.7 });   // planks of the fallen span, along the bridge, half sunk
  put('OrcBridge00', cx + ux * 1.9, cy + uy * 1.9, yaw + 90 - 7, { z: 0.5 });
  put('DgunColoumnParts00_1', cx + ux * 0.3, cy + uy * 0.3, 40);                     // the stump of the middle pier
  put('Log00', cx + 3, cy - 4, 120); put('Log01', cx - 4, cy + 3, 20);
}
// --- human camp: two tents, a fire, small things spread wide ---
{ const c = G.HUMAN_CAMP;
  put('MainTent00', c.x - 10, c.y + 9, 140, {}, 4); put('Tent00_Old', c.x + 9, c.y + 13, 210, {}, 3);
  copy('zone1', 2003, c.x, c.y, 0, 'CampFire');
  put('holder00', c.x, c.y + 1.3, 0); put('vertel00', c.x, c.y, 90); put('FryBoar00', c.x, c.y + 0.1, 90);
  put('KanianBench00', c.x - 3.2, c.y - 0.5, 80, {}, 1); put('KanianBench00', c.x + 3.3, c.y + 0.8, 260, {}, 1); put('Log00', c.x + 0.5, c.y - 3.4, 5, {}, 1);
  put('WitchKettle00', c.x - 6, c.y - 5, 0, {}, 1); copy('zone2', 1312, c.x - 6, c.y - 5.2, 0, 'KettleFire');
  for (const [dx, dy, o] of [[-8, 13, 'FakeBox00'], [-7, 14.2, 'FakeBox00'], [-6.2, 12.6, 'Sack00'], [12, 6, 'FakeBox00'], [-14, 2, 'Skin 01'], [5, -9, 'Basket00'], [-2, 4, 'Jug00'], [7, 10, 'Sack00'], [-16, 9, 'Log00']]) put(o, c.x + dx, c.y + dy, rnd(0, 360), {}, 0.8);
  for (let i = 0; i < 3; i++) put(i === 1 ? 'RIP01' : 'Grave00', c.x - 20 + i * 2.4, c.y + 20, 95, {}, 1);   // the fallen
  // the archers' cover on the bank: boulders and logs, no walls
  for (const [t, o] of [[0.105, 'StoneSetGreen02'], [0.125, 'Log00'], [0.14, 'SingleStoneGreen01'], [0.16, 'StoneSetGreen00'], [0.175, 'Log00'], [0.19, 'StoneSetGreen03']]) { const [x, y] = at(G.RIVER, t, 11.3); if (riverSide(x, y) < 0) put(o, x, y, rnd(0, 360), {}, 1); else { const [x2, y2] = at(G.RIVER, t, -11.3); put(o, x2, y2, rnd(0, 360), {}, 1); } }
}
// --- lizards' swamp village: low reed huts scattered on the islet, drying hides, a fire ---
{ const c = G.LIZARD_VIL;
  for (const [dx, dy, yaw] of [[-7, 4, 30], [6, 6, 200], [8, -5, 260], [-4, -8, 110]]) put('Goblin House 00', c.x + dx, c.y + dy, yaw, {}, 3);   // straw huts
  copy('zone2', 1312, c.x, c.y, 0, 'LizardFire');
  put('Skin 00', c.x - 4, c.y + 2, 60); put('Skin 01', c.x + 3, c.y - 3, 200); put('Palka+Cherep', c.x + 1, c.y + 9, 0, {}, 0.8);
  for (let i = 0; i < 4; i++) put(pick(['Bone00', 'Scull00', 'Jug00', 'Basket00']), c.x + rnd(-4, 4), c.y + rnd(-4, 4), rnd(0, 360));
  for (let i = 0; i < 14; i++) { const a = R() * 6.28, r = rnd(10, 13); put(pick(['ReedBush01', 'ReedBush00']), c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, rnd(0, 360)); }
}
// --- witch ring with the herbalist's remains ---
{ const c = G.RING;
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2 + rnd(-0.1, 0.1), r = 8.2 + rnd(-0.4, 0.4); put(pick(['Mushroom01', 'Mushroom02', 'Mushroom01_2', 'Mushroom02_1']), c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, rnd(0, 360)); }
  for (const [o, dx, dy] of [['SkeletonHead', 0.6, 0.9], ['SkeletonBody', 0, 0], ['SkeletonHip', -0.3, -0.8], ['SkeletonLeftArm', 0.8, -0.2], ['SkeletonLeftLeg', -0.6, -1.6], ['SkeletonRightLeg', 0.2, -1.7]]) put(o, c.x + dx, c.y + dy, 20);
  put('Basket00', c.x - 1.6, c.y + 0.4, 0); put('BigTree00', c.x + 12, c.y + 6, 0, {}, 3); put('BigTree01', c.x - 11, c.y - 9, 0, {}, 3);
}
// --- orc war camp: hide huts and straw huts, skull poles, a cooking fire, war drums, supplies; no walls ---
{ put('Ogre House 00', 186, 121, 300, {}, 5); put('K2', 201, 111, 20, {}, 4); put('K2', 172, 146, 240, {}, 4);
  for (const [x, y, yaw] of [[176, 130, 270], [184, 160, 0], [206, 160, 30], [212, 122, 80], [196, 99, 15], [166, 118, 250]]) put('Goblin House 00', x, y, yaw, {}, 3);
  copy('zone2', 1312, 190, 137, 0, 'OrcFire'); put('vertel00', 190, 137, 0); put('FryBoar00', 190, 137.2, 0); put('holder00', 190, 138.5, 0); put('FarmTub00', 192.5, 139.5, 0); put('Jug00', 188, 135, 0);
  put('WitchDrum00', 183, 127, 30, {}, 1); put('WitchDrum00', 184.5, 125.8, 60, {}, 1);
  copy('zone8', 1626, 183, 117.5, 120, 'ChiefChest');
  for (const [x, y] of [[180, 124], [194, 124], [176, 140], [198, 152], [205, 133], [170, 160]]) put(pick(['Palka+Cherep', 'Cherep', 'Palka+Cherep']), x, y, rnd(0, 360), {}, 1);
  for (const [x, y] of [[183, 112], [198, 132], [168, 156]]) put('CowCherep', x, y, rnd(0, 360));
  for (let i = 0; i < 3; i++) put('Palka+Cherep', 217 - i * 0.5, 142 + i * 4, 90, {}, 0.8);   // skull poles as archery targets
  for (const [x, y] of [[203, 123], [204.3, 122.4], [203.5, 121.2], [205, 124]]) put('FakeBox00', x, y, rnd(-20, 20), {}, 0.8);
  put('FarmTub00', 206, 126, 0); put('FarmTub00', 207.2, 127, 0);
  for (const [x, y] of [[163, 152], [165, 154.5]]) for (let k = 0; k < 3; k++) put('Log00', x + k * 0.4, y + k * 0.9, 60, {}, 1);   // timber for the new crossing
  copy('zone6', 1169, 175, 113, 20, 'PrisonCage', undefined, 2);
  copy('zone6', 1170, 178.5, 110.5, 200, 'CageLever', undefined, 1);
  for (const [x, y] of [[188, 129], [200, 141], [180, 151], [194, 108]]) copy('zone1', 1844, x, y, 0);
  for (const [x, y, yaw] of [[133, 173, 140], [136, 170, 150]]) put('OrcBridge00', x, y, yaw, {}, 2);
  put('Log00', 139, 175, 10, {}, 1); put('Log00', 140, 173.5, 25, {}, 1); put('Log01', 137, 178, 30);
  for (const [t, o] of [[0.1, 'StoneSet01'], [0.13, 'FakeBox00'], [0.16, 'StoneSet03'], [0.2, 'SingleStone00'], [0.24, 'StoneSet01'], [0.28, 'FakeBox00']]) { const [x, y] = at(G.RIVER, t, -11.5); if (riverSide(x, y) > 0) put(o, x, y, rnd(0, 360), {}, 1); else { const [x2, y2] = at(G.RIVER, t, 11.5); put(o, x2, y2, rnd(0, 360), {}, 1); } }
}
// --- the giant rats' nest on an islet by the river ---
{ for (let i = 0; i < 10; i++) { const a = R() * 6.28, r = rnd(2, 6); put(pick(['Bone00', 'Scull00', 'Log01', 'Stub02', 'CowCherep', 'SkeletonHip']), 151 + Math.cos(a) * r, 44 + Math.sin(a) * r, rnd(0, 360)); } }
// --- burnt homestead of the first settlers ---
{ put('Ruins 00', 147, 206, 20, {}, 4); put('Wall00Broken01', 154, 197, 200, {}, 2); put('Wall00Broken02', 141, 210, 110, {}, 2); put('Well 00', 140, 198, 0, {}, 1.5);
  put('Van01', 160, 210, 60, {}, 2); put('Van_L_B_whell', 157, 213, 10); put('Scull00', 151, 201, 0); put('Bone00', 149, 202, 40); put('FarmTub00', 143, 203, 0); put('DryLeafTree01', 152, 210, 0, {}, 1.5); }
// --- fire lizard crater ---
{ const c = G.LAIR;
  for (const [dx, dy] of [[-8, 4], [7, 6], [2, -8]]) copy('zone6', 1433, c.x + dx, c.y + dy, rnd(0, 360), undefined, undefined, 1.2);
  for (let i = 0; i < 8; i++) { const a = R() * 6.28, r = rnd(8, 11); put(pick(['Bone00', 'Scull00', 'CowCherep', 'SkeletonHip']), c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, rnd(0, 360)); }
  for (let i = 0; i < 7; i++) { const a = R() * 6.28, r = rnd(15, 20); put(pick(['StoneSet03', 'StoneSet01', 'StoneSet03', 'SingleStone00']), c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, rnd(0, 360)); }
}
// --- old cemetery: an arch at the top of the trail, crossing stone paths, family plots, crypts against the rock ---
{ put('KanianArc00', 291.5, 121.5, 0, {}, 1.5); put('CemetryColoumn01', 288.5, 124, 0, {}, 0.8); put('CemetryColoumn01', 294.5, 124, 0, {}, 0.8);
  const plot = (x0, y0, nx, ny, dx, dy, kinds, tilt) => { for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (R() < 0.15) continue; put(pick(kinds), x0 + i * dx + rnd(-0.25, 0.25), y0 + j * dy + rnd(-0.2, 0.2), 90 + rnd(-tilt, tilt), {}, 0.9); } };
  plot(277, 128, 4, 3, 3.2, 4.2, ['RIP01', 'RIP02'], 25);
  plot(297, 128, 4, 3, 3.4, 4.2, ['Grave00'], 6);
  plot(278, 149, 3, 3, 3.6, 4.4, ['Grave00', 'RIP02'], 12);
  put('CemetryColoumn00', 292, 144, 0, {}, 1); put('NecroTable00', 297, 151.5, 90, {}, 1.2); put('PotFire00', 297, 154, 0); put('PotFire00', 297, 149, 0); put('NecroIdol01', 299.5, 151.5, 270, {}, 1);
  put('Crypt00', 309, 162, 200, {}, 1.5); put('Crypt00', 312.5, 150, 250, {}, 1.5);
  copy('zone9', 2051, 306.5, 160, 200, 'MithrilChest'); put('Money00', 308, 158.5, 0);
  put('WallTowerBroken00', 274, 162, 30, {}, 2); put('Wall00Broken01', 278.5, 164, 10, {}, 2); put('Wall01Broken00', 313, 129, 95, {}, 2);
  for (const [x, y] of [[276, 136], [312, 140], [286, 160], [303, 126]]) put(pick(['DryLeafTree00', 'DryLeafTree01']), x, y, rnd(0, 360), {}, 1.5);
  for (let i = 0; i < 6; i++) put(pick(['Bone00', 'SkeletonLeftArm', 'Scull00', 'SkeletonHead']), 280 + rnd(0, 30), 128 + rnd(0, 34), rnd(0, 360));
}
// --- golem trail ---
{ for (const t of [0.17, 0.3, 0.46, 0.6, 0.78, 0.9]) { const s = t * 10 % 2 < 1 ? 1 : -1, [x, y] = at(G.SE_PATH, t, 4.3 * s); put(pick(['DgunColoumn00', 'DgunColoumn01', 'DgunColoumnParts00_1', 'Dgun Torch Ruins 01']), x, y, rnd(0, 360), {}, 1); }
  { const [x, y, a] = at(G.SE_PATH, 0.69, -4.6); put('Dgun Bird Ruins 00', x, y, deg(a), {}, 1.5); }
  for (const [t, side, o, n] of [[0.37, 1, 'LeftCrystals00', 'Crystal1'], [0.55, -1, 'RightCrystals00', 'Crystal2'], [0.74, 1, 'LeftCrystals00', 'Crystal3'], [0.9, -1, 'RightCrystals00', 'Crystal4']]) { const [x, y] = at(G.SE_PATH, t, 4.2 * side); put(o, x, y, rnd(0, 360), { name: n }, 1); }
  for (const t of [0.5, 0.84]) { const [x, y] = polyAt(G.SE_PATH, t); copy('zone8', 1720, x, y, 0, undefined, 5, 0.5); }
  const g = G.GLADE; put('BigTree00', g.x - 3, g.y + 3, 0, {}, 3); put('LeafTree01', g.x + 4, g.y + 4.5, 0, {}, 2); put('Bush00', g.x - 5, g.y - 3, 0); put('Bush00', g.x + 5, g.y - 2, 0); put('StoneSetGreen01', g.x + 1, g.y - 5, 0, {}, 1); put('Mushroom01', g.x - 2, g.y - 1, 0);
  for (let i = 0; i < 5; i++) put(pick(['Bone00', 'Scull00', 'CowCherep']), g.x + rnd(-4, 4), g.y + rnd(-4, 4), rnd(0, 360));
  put('MineEntrance00', G.CAVE_B.x, G.CAVE_B.y, G.CAVE_B.yaw, { name: 'MineMouthB', z: +(3.2 - hgt(G.CAVE_B.x, G.CAVE_B.y)).toFixed(2) }, 4); put('MineTorch00', 304.5, 37, 0); put('MineTorch00', 304.5, 45.5, 0); put('Cart_Old', 297, 33, 30, {}, 1);
  for (const [o, t] of [['SkeletonBody', 0.55], ['SkeletonHead', 0.555]]) { const [x, y] = polyAt(G.SE_PATH, t); put(o, x + 1.5, y + 1, rnd(0, 360)); }
}
// --- cave mouth A in the massif ---
{ put('MineEntrance00', G.CAVE_A.x, G.CAVE_A.y, G.CAVE_A.yaw, { name: 'MineMouthA', z: +(2.6 - hgt(G.CAVE_A.x, G.CAVE_A.y)).toFixed(2) }, 4); put('MineTorch00', 108.5, 82.5, 0); put('MineTorch00', 115.5, 82.5, 0); put('Cart_Old', 105.5, 79, 100, {}, 1); put('Bone00', 116, 77, 20); put('OldMineRoad01', 112, 79.5, 0); }
// --- the summit: a Dgun shrine with a small teleport, colonnades and torches; the magister's tent and work place ---
{ const c = G.SUMMIT, px = c.x + 3, py = c.y + 3;
  put('DgunTeleportSmall00', px, py, 0, { name: 'DgunTeleport' }, 2); put('DgunTeleportSmallPath00', px, py - 3.5, 0, {}, 1);
  // the ring stays open to the south (i = 4) — that is the way in; Dgun Gate 00 is solid for the AI graph, so no gate
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.5; if (i === 4) continue; put(i % 2 ? 'DgunColoumns00' : 'DgunColoumns01', px + Math.cos(a) * 7.8, py + Math.sin(a) * 7.8, deg(a) + 90, {}, 1.5); }
  for (const a of [0.0, 1.57, 3.14, 4.71]) copy('zone4', 533082, +(px + Math.cos(a + 0.8) * 5.5).toFixed(2), +(py + Math.sin(a + 0.8) * 5.5).toFixed(2), 0, undefined, undefined, 0.8);   // lit Dgun torches (effect)
  put('LeftCrystals00', px - 3, py + 2.5, 0, { name: 'ZartCrystalL' }, 1); put('RightCrystals00', px + 3, py + 2.5, 0, { name: 'ZartCrystalR' }, 1);
  put('Dgun Dragon 00', px - 5, py - 8.3, 0, {}, 1.5); put('Dgun Dragon 00', px + 5, py - 8.3, 0, {}, 1.5);
  put('MainTent00', c.x - 9, c.y - 3, 60, {}, 3); put('Carpet00', c.x - 5.5, c.y - 6, 90); put('Podium00', c.x - 4, c.y - 8.5, 20, {}, 1);   // the Hadagan's own things
  put('WitchKettle00', c.x - 8, c.y - 8.5, 0, {}, 1); copy('zone2', 1312, c.x - 8, c.y - 8.7, 0, 'ZartFire'); put('KanianBench00', c.x - 10.5, c.y - 7, 70);
  for (const [dx, dy, o] of [[-12, 1, 'FakeBox00'], [-11.2, 2.3, 'FakeBox00'], [-12.5, 3.2, 'Sack00'], [-6, -10.5, 'Jug00'], [-2, -10, 'Sack00']]) put(o, c.x + dx, c.y + dy, rnd(0, 360));
  for (let i = 0; i < 4; i++) { const a = 0.9 + i * 1.4 + rnd(-0.2, 0.2), r = rnd(16, 19); put(pick(['StoneSet03', 'StoneSet03', 'DryLeafTree00']), c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, rnd(0, 360), {}, 3); }
}
// ================= SCATTER =================
function scatter(n, region, choose, minR, tries = 30) {
  let made = 0;
  for (let k = 0; k < n * tries && made < n; k++) {
    const x = rnd(2, G.W - 2), y = rnd(2, G.H - 2); if (!region(x, y)) continue;
    const o = choose(x, y); if (!o) continue; const r = typeof minR === 'function' ? minR(o) : minR;
    if (!free(x, y, r) || keepClear(x, y)) continue;
    put(o, x, y, rnd(0, 360), {}, r); made++;
  }
  return made;
}
const west = (x, y) => riverSide(x, y) < 0, east = (x, y) => riverSide(x, y) > 0;
const forest = (x, y) => west(x, y) && polySD(G.SWAMP, x, y) > 3 && !wet(x, y) && roadD(x, y) > 2.6 && polySD(G.MASSIF, x, y) > -2;
const swamp = (x, y) => west(x, y) && polySD(G.SWAMP, x, y) < 2 && roadD(x, y) > 2;
const hummock = (x, y) => swamp(x, y) && hgt(x, y) > G.SWAMP_LEVEL + 0.25;
const shore = (x, y) => swamp(x, y) && Math.abs(hgt(x, y) - G.SWAMP_LEVEL) < 0.3;
const massif = (x, y) => polySD(G.MASSIF, x, y) < -1;
const burnt = (x, y) => east(x, y) && !wet(x, y) && roadD(x, y) > 2.4 && hgt(x, y) < 9 && polyDist(G.RIVER, x, y).d > 11;
const rocks = (x, y) => east(x, y) && hgt(x, y) >= 9;
const treeR = o => /BigTree/.test(o) ? 3 : /Tree/.test(o) ? 2.2 : 1.2;
export const counts = {};
counts.forestTrees = scatter(520, (x, y) => forest(x, y) && fbm(x / 30, y / 30, 71) > 0.33, (x, y) => { const n = fbm(x / 25, y / 25, 73); return pick(n > 0.55 ? ['FirTree00', 'FirTree00', 'FirTree00', 'LeafTree00', 'BigTree01'] : ['LeafTree00', 'LeafTree01', 'LeafTree00', 'FirTree00', 'BigTree00']); }, treeR);
counts.forestBush = scatter(320, forest, () => pick(['Bush00', 'Bush00', 'Bush00', 'Stub01', 'Stub00', 'Log00', 'Stub02']), 1.1);
counts.forestMisc = scatter(60, forest, () => pick(['Mushroom01', 'Mushroom02', 'Mushroom01_2', 'Mushroom02_1', 'SingleStoneGreen00', 'SingleStoneGreen01', 'StoneSetGreen00', 'StoneSetGreen01', 'StoneSetGreen02', 'StoneSetGreen03', '3StoneSet00']), 1.2);
counts.reeds = scatter(420, (x, y) => (shore(x, y) || (west(x, y) && polyDist(G.RIVER, x, y).d < G.RIVER_HALF + 4 && polyDist(G.RIVER, x, y).d > G.RIVER_HALF - 0.5)), () => pick(['ReedBush01', 'ReedBush01', 'ReedBush00']), 0.8);
counts.hummocks = scatter(110, hummock, () => pick(['DryLeafTree00', 'DryLeafTree01', 'Stub01', 'Stub02', 'Mushroom01', 'Mushroom02', 'Bush00', 'LeafTree01', 'BigTree01', 'Stub00']), o => treeR(o));
counts.swampLogs = scatter(25, (x, y) => swamp(x, y) && hgt(x, y) < G.SWAMP_LEVEL, () => pick(['Log00', 'Stub01']), 1.5);
counts.massif = scatter(60, massif, (x, y) => slopeAt(x, y) > 0.9 ? pick(['StoneSet00', 'StoneSet02', 'SingleStone00', 'StoneSet03']) : pick(['FirTree00', 'FirTree00', 'Bush00', 'StoneSetGreen01', 'SingleStoneGreen00']), 1.8);
counts.burntTrees = scatter(140, burnt, () => pick(['DryLeafTree00', 'DryLeafTree01', 'DryLeafTree01', 'Stub01', 'Stub02', 'Stub00', 'Log00']), 2);
counts.burntBones = scatter(60, burnt, () => pick(['Scull00', 'Bone00', 'CowCherep', 'SkeletonHip', 'SingleStone00', 'SingleStone01', 'StoneSet01', 'StoneSet03', 'Stub02']), 1.4);
counts.rocks = scatter(32, (x, y) => rocks(x, y) && slopeAt(x, y) > 0.35 && slopeAt(x, y) < 1.1 && Math.hypot(x - G.SUMMIT.x, y - G.SUMMIT.y) > 24, () => pick(['StoneSet01', 'StoneSet03', 'SingleStone00', 'SingleStone01', 'StoneSet03', 'DryLeafTree00', 'DryLeafTree01']), 6);
counts.highGreen = scatter(22, (x, y) => rocks(x, y) && slopeAt(x, y) < 0.35 && fbm(x / 7, y / 7, 47) > 0.6, () => pick(['Bush00', 'Bush00', 'FirTree00', 'StoneSetGreen01', 'LeafTree01']), 1.8);
