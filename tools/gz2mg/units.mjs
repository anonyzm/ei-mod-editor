// Creatures of gz2mg and gz3mg: [mob, unit proto, fields, route points | null]
import * as G from './geo.mjs';
const { polyAt, polyDist, riverSide } = G;
const R = G.rng(4242), rnd = (a, b) => a + (b - a) * R();
const face = (x, y, tx, ty) => +(Math.atan2(-(tx - x), ty - y) * 180 / Math.PI).toFixed(0); // yaw that looks from (x,y) to (tx,ty)
export const U = [];
const BRIG = ['gipat brigand shirt.tiger hide', 'gipat brigand pants.tiger hide', 'gipat brigand boots.tiger hide', 'gipat brigand gloves.tiger hide'];
function add(mob, unit, x, y, f = {}, route = null) { U.push({ mob, unit, fields: { pos: [+x.toFixed(2), +y.toFixed(2)], yaw: f.yaw ?? +rnd(0, 360).toFixed(0), ...f }, route }); }
const loop = (pts, wait = 30) => pts.map(p => ({ pos: [+p[0].toFixed(2), +p[1].toFixed(2)], wait: p[2] ?? wait }));
const circle = (x, y, r, n, wait = 20, a0 = 0) => loop(Array.from({ length: n }, (_, i) => [x + Math.cos(a0 + i / n * 6.283) * r, y + Math.sin(a0 + i / n * 6.283) * r]), wait);
// point at distance d from the river centre, on side s (-1 west, 1 east), at river parameter t
function bank(t, d) { const [x, y, a] = polyAt(G.RIVER, t); const nx = Math.sin(a), ny = -Math.cos(a); const s = riverSide(x + nx * d, y + ny * d); return [x + nx * d * s * -1 * -1, y + ny * d * s * -1 * -1, a]; }
function side(t, d, s) { const [x, y, a] = polyAt(G.RIVER, t); let nx = Math.sin(a), ny = -Math.cos(a); if (riverSide(x + nx * 3, y + ny * 3) !== s) { nx = -nx; ny = -ny; } return [x + nx * d, y + ny * d, x, y]; }
const tOfY = y => { let best = 0, bd = 1e9; for (let t = 0; t <= 1; t += 0.002) { const p = polyAt(G.RIVER, t); if (Math.abs(p[1] - y) < bd) { bd = Math.abs(p[1] - y); best = t; } } return best; };

// ===== gz2mg: west bank (side 2) =====
const M = 'gz2mg';
add(M, 'Human Gipath NPC Warlord F5', 50, 194, { name: 'Olgerd', briefing: 1, player: 2, weapons: ['long sword.iron'], armors: ['gipat highest helm.thick', 'gipat highest leggins.thick', 'gipat brigand shirt.tiger hide', 'gipat brigand gloves.tiger hide'] },
  loop([[50, 194, 150], [68, 188, 90], [72, 176, 60], [56, 184, 120]]));
const archY = [198, 192, 186, 180, 174, 169];
archY.forEach((y, i) => { const t = tOfY(y); const [bx, by, cx, cy] = side(t, 13.2, -1), [kx, ky] = side(t, 20, -1);
  add(M, i < 4 ? 'Human Kania Ranger F9' : 'Human Kania Huntress F7', bx, by, { name: 'HArcher' + (i + 1), player: 2, yaw: face(bx, by, cx, cy), weapons: [i < 4 ? 'long bow.iron' : 'long bow.bronze'], armors: BRIG },
    loop([[bx, by, 140 + i * 20], [kx, ky, 40 + i * 10], [bx + rnd(-1.5, 1.5), by + rnd(-1.5, 1.5), 120]])); });
for (let i = 0; i < 3; i++) { const c = G.HUMAN_CAMP; add(M, 'Human Gipath Villager F1', c.x - 12 + i * 8, c.y - 10, { name: 'Militia' + (i + 1), player: 2, weapons: ['stone spear.rock'], armors: BRIG }, circle(c.x, c.y + 2, 16 + i * 3, 5, 40, i)); }
add(M, 'Human Gipath Villager F1 Female', 48, 192, { name: 'Healer', player: 2 }, loop([[48, 192, 60], [53, 191, 80], [59, 191.5, 80], [60, 196, 40]]));
add(M, 'Human Gipath Villager F1 Female', 49, 183, { name: 'Cook', player: 2, yaw: 300 }, loop([[49, 183.5, 120], [56, 186, 40], [44, 197, 60]]));
add(M, 'Human Gipath Villager F1', 69, 198, { name: 'Fletcher', player: 2, yaw: 200, weapons: ['stone spear.rock'], armors: BRIG }, loop([[69, 198, 200], [71, 190, 60]]));
for (let i = 0; i < 2; i++) add(M, 'Human Kania Ranger F9', 54 + i * 4, 182, { name: 'RestArcher' + (i + 1), player: 2, yaw: i ? 300 : 40, weapons: ['long bow.iron'], armors: BRIG });
for (let i = 0; i < 2; i++) add(M, 'Human Gipath Villager F1', 34 + i * 30, 170 + i * 36, { name: 'Sentry' + (i + 3), player: 2, weapons: ['stone spear.rock'], armors: BRIG }, circle(G.HUMAN_CAMP.x, G.HUMAN_CAMP.y, 25, 7, 30, i * 3));
add(M, 'Human Gipath Villager F1', 53, 191, { name: 'Wounded1', player: 2, yaw: 30 });
add(M, 'Human Gipath Villager F1', 59, 191.5, { name: 'Wounded2', player: 2, yaw: -40 });
add(M, 'Human Gipath Runner Male F1', 60, 178, { name: 'Runner', player: 2 }, loop([[60, 178, 60], [50, 126, 5], [44, 100, 5], [100, 84, 5], [124, 60, 90], [100, 84, 5], [62, 92, 5], [50, 140, 5]]));
// lizards at the front south of the bridge, and their village
[[0.3, 'DragonkinGreenF7'], [0.33, 'DragonkinGreenF7'], [0.36, 'DragonkinJunF11'], [0.39, 'DragonkinGreenF7'], [0.42, 'DragonkinJunF11'], [0.45, 'DragonkinGreenF7']].forEach(([t, p], i) => {
  const [bx, by, cx, cy] = side(t, 12.5, -1), [kx, ky] = side(t, 19, -1); if (G.height(kx, ky) > 8) { kx === kx; }
  add(M, p, bx, by, { name: 'LizardWarrior' + (i + 1), player: 2, yaw: face(bx, by, cx, cy) }, loop([[bx, by, 100 + i * 15], [kx, ky, 50], [bx + rnd(-2, 2), by + rnd(-2, 2), 90]])); });
{ const c = G.LIZARD_VIL; add(M, 'DragonkinJunF11', c.x + 1.5, c.y + 1.5, { name: 'LizardElder', briefing: 1, player: 2, yaw: 200, complection: [0.6, 0.4, 0.9] }, loop([[c.x + 1.5, c.y + 1.5, 300], [c.x + 5, c.y - 3, 60]]));
  for (let i = 0; i < 4; i++) add(M, 'DragonkinGreenF3', c.x + rnd(-6, 6), c.y + rnd(-6, 6), { name: 'Lizard' + (i + 1), player: 2 }, i < 2 ? circle(c.x, c.y, 5 + i, 4, 50, i) : loop([[c.x, c.y - 10, 30], [c.x - 22 - i * 4, c.y - 20, 80], [c.x - 30, c.y + 6, 60], [c.x - 8, c.y + 12, 30]])); }

// ===== west wildlife (side 6) and peaceful animals (side 7) =====
for (let i = 0; i < 4; i++) add(M, 'WolfGreyF3', 70 + i * 2, 230 + rnd(-2, 2), { player: 6 }, loop([[70 + i * 2, 230, 60], [22 + i * 2, 196, 30], [24, 150 + i * 2, 30], [64, 214, 40]]));
for (let i = 0; i < 2; i++) add(M, 'WolfWhiteF5', 22 + i * 2, 120, { player: 6 }, loop([[22 + i * 2, 120, 50], [36, 86, 40], [14, 92, 30]]));
for (let i = 0; i < 3; i++) add(M, 'BoarDarkF4', 30 + i * 3, 78 + i, { player: 6 }, loop([[30 + i * 3, 78, 80], [44, 64, 40], [26, 50, 60]]));
for (let i = 0; i < 2; i++) add(M, 'BoarDarkF5', 76 + i * 2.5, 140, { player: 6 }, loop([[76 + i * 2, 140, 90], [84, 118, 50]]));
for (let i = 0; i < 6; i++) { const x = rnd(50, 140), y = rnd(10, 75); if (G.height(x, y) < 1.3) { i--; continue; } add(M, i < 4 ? 'ToadM4' : 'ToadM6', x, y, { player: 6 }, loop([[x, y, 90], [x + rnd(-8, 8), y + rnd(-8, 8), 60]])); }
export const RAT_NEST = [151, 44];
for (let i = 0; i < 4; i++) add(M, 'RatGiantF10', 151 + rnd(-4, 4), 44 + rnd(-4, 4), { player: 6 }, circle(151, 44, 4 + i, 4, 30, i));
add(M, 'RatGiantF11', 152, 45, { name: 'RatQueen', player: 6, complection: [0.8, 0.5, 1] }, loop([[152, 45, 200], [146, 52, 60]]));
for (let i = 0; i < 3; i++) add(M, 'WillowispM5', G.RING.x + 6, G.RING.y, { name: 'RingWisp' + (i + 1), player: 6 }, circle(G.RING.x, G.RING.y, 6, 6, 5, i * 2.1));
add(M, 'BansheeLightF4', G.RING.x + 0.5, G.RING.y + 1, { name: 'HerbGhost', player: 6 }, loop([[G.RING.x + 0.5, G.RING.y + 1, 600]]));
add(M, 'BansheeLightF3', 74, 34, { name: 'SwampBanshee1', player: 6 }, loop([[74, 34, 60], [96, 22, 40], [112, 40, 60], [88, 52, 40]]));
add(M, 'BansheeLightF4', 132, 22, { name: 'SwampBanshee2', player: 6 }, loop([[132, 22, 80], [118, 10, 40], [100, 30, 60]]));
for (let i = 0; i < 3; i++) add(M, 'WillowispM3', 80 + i * 20, 40 + i * 6, { player: 6 }, loop([[80 + i * 20, 40, 20], [70 + i * 18, 20, 20], [96 + i * 10, 30, 20]]));
for (let i = 0; i < 3; i++) add(M, 'BatRedM5', 100 + i * 10, 120, { player: 6 }, circle(116, 114, 14, 5, 10, i));
for (let i = 0; i < 3; i++) add(M, 'DeerF0', 20 + i * 4, 216, { player: 7 }, loop([[20 + i * 4, 216, 120], [30, 180, 80], [14, 236, 90]]));
for (let i = 0; i < 5; i++) { const x = rnd(15, 70), y = rnd(95, 240); add(M, 'HareF0', x, y, { player: 7 }, loop([[x, y, 60], [x + rnd(-10, 10), y + rnd(-10, 10), 60]])); }

// ===== east bank: orc front line (side 3) =====
const OA = ['OrcFemaleTribeRA7', 'OrcFemaleA7', 'OrcFemaleTribeRA7', 'OrcFemaleA7', 'OrcFemaleTribeRA7', 'OrcFemaleA7', 'OrcFemaleTribeRA7'];
[190, 184, 178, 172, 166, 159, 152].forEach((y, i) => { const t = tOfY(y); const [bx, by, cx, cy] = side(t, 13.5, 1), [kx, ky] = side(t, 21, 1);
  add(M, OA[i], bx, by, { name: 'OArcher' + (i + 1), player: 3, yaw: face(bx, by, cx, cy), weapons: ['bone long bow.burned bones'] }, loop([[bx, by, 130 + i * 15], [kx, ky, 50 + i * 5], [bx + rnd(-1.5, 1.5), by + rnd(-1.5, 1.5), 110]])); });
[0.36, 0.41, 0.46, 0.51].forEach((t, i) => { const [bx, by, cx, cy] = side(t, 11, 1), [b2x, b2y] = side(t + 0.04, 12, 1);
  add(M, 'ElementalLavaF12', bx, by, { name: 'FireEl' + (i + 1), player: 3, yaw: face(bx, by, cx, cy) }, loop([[bx, by, 80], [b2x, b2y, 60]])); });
{ const [x, y] = side(0.38, 19, 1); add(M, 'OrcFemaleShaivarM7', x, y, { name: 'OrcShaman', player: 3, spells: ['arrow{e2}', 'fireball{e2}', 'firewall{e2}', 'strength{d2}'] }, loop([[x, y, 120], [x + 8, y - 10, 80], [x - 2, y + 8, 80]])); }
for (let i = 0; i < 3; i++) add(M, 'OrcMaleF5', 163 - i, 150 + i, { name: 'Worker' + (i + 1), player: 3, weapons: ['stone axe.malachite'] }, loop([[163, 151 + i, 25 + i * 10], [137, 171 + i, 40]]));
// camp life: march squad, sparring pairs, archery practice, drummer, cook, chief with guards, gate guards, sentries
for (let i = 0; i < 5; i++) add(M, 'OrcMaleTribeRF7', 176 + i * 1.5, 166, { name: 'March' + (i + 1), player: 3, weapons: ['stone battle axe.silicon'] }, loop([[176 + i * 1.5, 166, 10], [198 + i * 1.2, 170, 8], [204, 160 - i * 1.2, 8], [182 - i * 1.2, 156, 8]]));
[[190, 151, 192, 151], [193, 151, 191, 151], [190, 146, 192, 146], [193, 146, 191, 146]].forEach(([x, y, tx, ty], i) => { const a = i % 2 ? 1 : -1; add(M, 'OrcMaleShaivarF7', x + (i % 2 ? 0.4 : -0.4), y, { name: 'Spar' + (i + 1), player: 3, yaw: face(x, y, tx + a * 0.1, ty), weapons: ['stone battle axe.silicon'] }); });
for (let i = 0; i < 4; i++) add(M, 'OrcFemaleTribeLA7', 207.5, 142 + i * 3, { name: 'Range' + (i + 1), player: 3, yaw: 270, weapons: ['bone long bow.burned bones'] });
add(M, 'OrcFemaleShaivarM7', 182, 126.5, { name: 'Drummer', player: 3, yaw: 300 });
add(M, 'OrcFemaleM5', 188, 137, { name: 'Cook', player: 3 }, loop([[188, 137, 90], [201, 125, 40], [190, 139, 90]]));
add(M, 'OrcMaleShaivarKeykeeperF7', 189, 125, { name: 'Warchief', player: 3, complection: [0.9, 0.5, 1], weapons: ['stone battle axe.malachite'] }, loop([[189, 125, 200], [196, 150, 60], [212, 140, 60], [214, 128, 40], [200, 114, 60]]));
for (let i = 0; i < 2; i++) add(M, 'OrcMaleShaivarF7', 187 + i * 3, 123, { name: 'ChiefGuard' + (i + 1), player: 3, weapons: ['stone battle axe.silicon'] }, loop([[187 + i * 3, 123, 200], [194 + i * 2, 150, 60], [210 + i, 141, 60], [212 + i, 128, 40], [198, 116 + i * 2, 60]]));
{ let gate = 0.5, best = 1e9; for (let t = 0; t <= 1; t += 0.01) { const [x, y] = polyAt(G.PALISADE, t); const d = polyDist(G.ROADS[5], x, y).d; if (d < best) { best = d; gate = t; } }
  const [gx, gy] = polyAt(G.PALISADE, gate); add(M, 'OrcMaleTribeLF7', gx - 3, gy - 3, { name: 'GateGuard1', player: 3, yaw: 250, weapons: ['stone battle axe.silicon'] }); add(M, 'OrcMaleTribeLF7', gx - 3, gy + 3, { name: 'GateGuard2', player: 3, yaw: 290, weapons: ['stone battle axe.silicon'] });
  add(M, 'OrcFemaleTribeLA7', gx - 4, gy, { name: 'GateArcher', player: 3, yaw: 270, weapons: ['bone long bow.burned bones'] }); }
for (let i = 0; i < 2; i++) { const P = [[212, 168], [222, 140], [220, 112], [196, 94], [168, 106], [160, 140], [178, 172]]; add(M, 'OrcMaleTribeRF7', P[0][0], P[0][1] - i * 20, { name: 'Sentry' + (i + 1), player: 3, weapons: ['stone axe.malachite'] }, loop(i ? [...P].reverse().map(p => [...p, 20]) : P.map(p => [...p, 20]))); }
add(M, 'Human Gipath Villager F1', 175, 113, { name: 'Prisoner', briefing: 1, player: 7, yaw: 200 });
// fire lizard crater (side 6) and scavengers of the burnt plains
add(M, 'DragonkinFireF14', G.LAIR.x + 2, G.LAIR.y - 5, { name: 'FireLizard', player: 6, texture: 'LizardManFire', complection: [0.9, 0.5, 1], spells: ['fireball{e2,e2}', 'firewall{e2}'] }, circle(G.LAIR.x, G.LAIR.y, 9.5, 6, 40));
for (let i = 0; i < 2; i++) add(M, 'DragonkinOrcishF9', G.LAIR.x - 6 + i * 12, G.LAIR.y + 6, { name: 'FireLizardYoung' + (i + 1), player: 6, texture: 'LizardManFire', complection: [0.4, 0.6, 0.55] }, loop([[G.LAIR.x - 6 + i * 12, G.LAIR.y + 6, 90], [G.LAIR.x + 6 - i * 12, G.LAIR.y - 6, 60]]));
for (let i = 0; i < 5; i++) add(M, 'HyenaF6', 150 + i * 2, 220 + rnd(-2, 2), { player: 6 }, loop([[150 + i * 2, 220, 60], [168, 190, 20], [226, 178, 30], [210, 210, 40]]));
for (let i = 0; i < 3; i++) add(M, 'HyenaF6', 236 + i * 2, 70 + 60, { player: 6 }, loop([[236 + i * 2, 160, 40], [250, 128, 30], [226, 172, 40]]));
for (let i = 0; i < 3; i++) add(M, 'BatRedM5', G.LAIR.x, G.LAIR.y, { player: 6 }, circle(G.LAIR.x, G.LAIR.y, 16, 6, 5, i * 2));

// ===== golem path (side 4) =====
[[0.27, 'ElementalEarthF8'], [0.36, 'GolemVerticalF20'], [0.52, 'GolemHorizontalF20'], [0.66, 'GolemVerticalF20'], [0.86, 'ElementalEarthF8']].forEach(([t, p], i) => {
  const [x, y, a] = polyAt(G.SE_PATH, t); add(M, p, x, y, { name: 'PathGuard' + (i + 1), player: 4, yaw: +(a * 180 / Math.PI + 90).toFixed(0) }); });
add(M, 'TrollRedF14', G.GLADE.x + 1, G.GLADE.y, { name: 'FireTroll', player: 4, texture: 'TrollRed00', complection: [0.9, 0.4, 0.95], spells: ['firewall{e2,e2}', 'fireball{e2}'] }, loop([[G.GLADE.x + 1, G.GLADE.y, 300], [G.GLADE.x - 3, G.GLADE.y - 3, 90]]));
// ===== cemetery (side 4) =====
const C = [[280, 132], [300, 134], [286, 146], [306, 146], [282, 156], [298, 160], [308, 126], [276, 140]];
['SkeletonF4', 'SkeletonF4', 'SkeletonF4', 'SkeletonF4', 'SkeletonF4', 'SkeletonWarriorF7', 'SkeletonWarriorF7', 'SkeletonWarriorF7', 'ZombieMaleF12', 'ZombieMaleF12', 'ZombieFemaleF12', 'ZombieFemaleF12'].forEach((p, i) => {
  const a = C[i % C.length], b = C[(i + 3) % C.length]; add(M, p, a[0] + rnd(-1, 1), a[1] + rnd(-1, 1), { name: 'Dead' + (i + 1), player: 4 }, loop([[a[0], a[1], 60 + i * 10], [b[0], b[1], 40]])); });
add(M, 'UndeadKeeperF16', 291.5, 151, { name: 'GraveKeeper', player: 4, yaw: 270 }, loop([[291.5, 151, 300], [291.5, 140, 60], [300, 156, 60]]));
// ===== magister's path and summit (side 5) =====
[[0.12, 'ElementalLavaF12', 'MEl1'], [0.3, 'Human Hadagan Guards F14', 'HGuard1'], [0.45, 'ElementalLavaF12', 'MEl2'], [0.6, 'Human Hadagan Guards F14', 'HGuard2'], [0.75, 'Human Hadagan Guards M14', 'HGuard3'], [0.9, 'Human Hadagan Guards M14', 'HGuard4']].forEach(([t, p, n], i) => {
  const [x, y, a] = polyAt(G.MAGE_PATH, t), [x2, y2] = polyAt(G.MAGE_PATH, Math.min(1, t + 0.08));
  add(M, p, x, y, { name: n, player: 5, yaw: +(a * 180 / Math.PI + 90 + 180).toFixed(0) }, /El/.test(n) ? loop([[x, y, 60], [x2, y2, 60]]) : loop([[x, y, 3600]])); });
{ const c = G.SUMMIT;
  add(M, 'Human Hadagan Fire Mage M14', c.x + 12, c.y - 3, { name: 'Apprentice', player: 5 }, circle(c.x + 3, c.y + 3, 10.5, 5, 60));
  // door guards beside the shrine's open south side, not in it (2026-11-17)
  add(M, 'Human Hadagan Guards F14', c.x, c.y - 7.5, { name: 'GateGuardH1', player: 5, yaw: 0 }); add(M, 'Human Hadagan Guards F14', c.x + 6, c.y - 7.5, { name: 'GateGuardH2', player: 5, yaw: 0 });
  add(M, 'Human Hadagan Guards M14', c.x - 7, c.y - 1, { name: 'TentGuard', player: 5, yaw: 240 });
  for (let i = 0; i < 2; i++) add(M, 'Human Hadagan Guards F14', c.x + 3 + (i ? 9 : -9), c.y + 3, { name: 'PlazaGuard' + (i + 1), player: 5 }, circle(c.x + 3, c.y + 3, 9.5, 6, 25, i * 3.14));
  add(M, 'Hadagan Magister Zart', c.x - 2, c.y - 7.5, { name: 'Zart', player: 5, spells: ['fireball{e2,e2,e1}', 'firewall{e2,e2}', 'lightning{e1,e2,e2}', 'strength{d2}'], armors: ['Gipat Low Boots.Thin', 'Gipat Low Gloves.Thin', 'Gipat Low Pants.Thin', 'Gipat Low Shirt.Thin'] },
    loop([[c.x - 2, c.y - 7.5, 200], [c.x - 3, c.y + 4, 120], [c.x + 11, c.y + 4, 120], [c.x + 4, c.y - 3, 90]])); }

// ===== cave gz3mg (side 6) =====
const K = 'gz3mg', hall = n => G.C_HALL.find(h => h[3] === n);
{ const [x, y] = hall('nest'); for (let i = 0; i < 6; i++) add(K, i % 2 ? 'ScrabBlueF5' : 'ScrabGreyF5', x + rnd(-6, 6), y + rnd(-6, 6), { player: 6 }, circle(x, y, 4 + i, 4, 40, i)); }
{ const [x, y] = hall('queen'); for (let i = 0; i < 7; i++) add(K, i % 3 ? 'ScrabBlueF5' : 'ScrabGreyF5', x + rnd(-10, 10), y + rnd(-10, 10), { player: 6 }, circle(x, y, 6 + i * 1.3, 4, 30, i));
  add(K, 'ScrabMotherPoisonedF6', x + 2, y + 2, { name: 'PanzerQueen', player: 6, complection: [1, 0.5, 1] }, loop([[x + 2, y + 2, 300]])); }
{ const [x, y] = hall('trolls'); add(K, 'TrollGreenOldF13', x - 2, y + 4, { name: 'OldTroll', player: 6, complection: [0.9, 0.3, 1], yaw: 180 }, loop([[x - 2, y + 4, 400], [x + 5, y + 8, 100]]));
  add(K, 'TrollGreenF10', x + 4, y - 4, { name: 'YoungTroll1', player: 6, complection: [0.5, 0.6, 0.55] }, loop([[x + 4, y - 4, 120], [x - 4, y - 8, 90], [x - 6, y + 2, 90]]));
  add(K, 'TrollGreenF10', x - 5, y - 3, { name: 'YoungTroll2', player: 6, complection: [0.45, 0.7, 0.5] }, loop([[x - 5, y - 3, 150], [x + 6, y + 2, 80]])); }
{ const [x, y] = hall('eyes'); for (let i = 0; i < 3; i++) add(K, 'EvileyeSimpleM6', x + rnd(-4, 4), y + rnd(-4, 4), { player: 6 }, circle(x, y, 5, 4, 30, i * 2)); }
{ const [x, y] = hall('mine'); for (let i = 0; i < 3; i++) add(K, 'RatGiantF9', x + rnd(-4, 4), y + rnd(-4, 4), { player: 6 }, circle(x, y, 5, 4, 50, i * 2)); }
for (let i = 0; i < 3; i++) add(K, 'BatRedM5', 60 + i * 30, 90 - i * 20, { player: 6 }, loop([[60 + i * 30, 90 - i * 20, 20], [70 + i * 30, 70 - i * 15, 20]]));
