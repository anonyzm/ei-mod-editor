// Shared layout of gz2mg «Огненный рубеж» (320×256 m) and gz3mg «Панцирные норы» (192×160 m).
export const W = 320, H = 256, CW = 192, CH = 160;

// ---------- small math ----------
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function vnoise(x, y, s = 0) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash(i, j, s), hash(i + 1, j, s), u), lerp(hash(i, j + 1, s), hash(i + 1, j + 1, s), u), v);
}
export const fbm = (x, y, s = 0, o = 4) => { let a = 0, f = 1, w = 0.5, n = 0; for (let k = 0; k < o; k++) { a += w * vnoise(x * f, y * f, s + k * 17); n += w; f *= 2; w *= 0.5; } return a / n; };
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// distance from point to polyline + parameter t (0..1 along length) + nearest point
export function polyDist(P, x, y) {
  let best = 1e9, bt = 0, total = 0, acc = 0, bx = 0, by = 0;
  const L = []; for (let i = 0; i + 1 < P.length; i++) { const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); L.push(l); total += l; }
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, ay] = P[i], [cx, cy] = P[i + 1], dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0, px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
    if (d < best) { best = d; bt = (acc + t * L[i]) / total; bx = px; by = py; }
    acc += L[i];
  }
  return { d: best, t: bt, x: bx, y: by };
}
// point at fraction t along polyline
export function polyAt(P, t) {
  const L = []; let total = 0; for (let i = 0; i + 1 < P.length; i++) { const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); L.push(l); total += l; }
  let want = t * total; for (let i = 0; i < L.length; i++) { if (want <= L[i] || i === L.length - 1) { const f = L[i] ? want / L[i] : 0; return [lerp(P[i][0], P[i + 1][0], f), lerp(P[i][1], P[i + 1][1], f), Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0])]; } want -= L[i]; }
}
export function inPoly(P, x, y) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
// signed distance to polygon (negative inside)
export function polySD(P, x, y) { let d = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) d = Math.min(d, polyDist([P[j], P[i]], x, y).d); return inPoly(P, x, y) ? -d : d; }

// ---------- gz2mg features ----------
export const RIVER = [[80, 262], [82, 205], [90, 182], [106, 164], [124, 150], [142, 136], [157, 116], [165, 84], [170, 50], [174, 16], [176, -6]];
export const RIVER_HALF = 7.5;       // water half-width
export const WATER_LEVEL = 2.0;
export const BRIDGE = { x: 115, y: 157, yaw: 128 }; // across the river, broken
export const riverSide = (x, y) => { const p = polyDist(RIVER, x, y); return x > p.x ? 1 : -1; }; // 1 east (orcs), -1 west

export const SWAMP = [[18, -4], [30, 18], [52, 40], [70, 62], [84, 84], [96, 86], [150, 84], [152, 60], [158, 30], [162, -4]];
export const MASSIF = [[88, 96], [96, 116], [106, 132], [120, 138], [133, 128], [141, 112], [140, 96], [126, 90], [112, 89], [98, 90]];
export const CAVE_A = { x: 112, y: 87, yaw: 180 };   // mouth in the massif's south foot, faces south (yaw: 0 N, 90 W, 180 S, 270 E)
export const CAVE_B = { x: 307, y: 41, yaw: 90 };      // mouth in the SE corner, faces west
export const SE_MASS = [[196, -8], [203, 40], [208, 84], [228, 92], [252, 99], [274, 110], [330, 112], [330, -8]];
export const SE_PATH = [[304, 41], [292, 37], [262, 31], [238, 33], [229, 47], [236, 63], [256, 72], [272, 84], [281, 100], [287, 116], [292, 126]];
export const PLATEAU = [[270, 118], [276, 112], [312, 114], [316, 120], [316, 162], [306, 168], [276, 166], [268, 158]];
export const PLATEAU_Z = 11.5;
export const RAMP = [[272, 146], [258, 148], [244, 150]]; // plateau -> burnt plains
export const MAGE_MASS = [[236, 172], [262, 170], [320, 172], [330, 172], [330, 262], [228, 262], [226, 214]];
export const MAGE_PATH = [[244, 168], [256, 180], [250, 194], [262, 206], [282, 202], [298, 212], [296, 228], [288, 238]];
export const SUMMIT = { x: 289, y: 242, r: 15, z: 18.2 };
export const LAIR = { x: 194, y: 236, r: 22 };   // fire lizard crater
export const LAIR_RAMP = [[199, 204], [198, 214], [196, 222], [194, 228]];
export const LAVA_POOLS = [[194, 236, 7], [168, 205, 4], [233, 196, 3.5], [140, 238, 3.5], [214, 222, 3]];
export const RING = { x: 40, y: 226, r: 9 };     // mushroom ring (witch circle)
export const HUMAN_CAMP = { x: 56, y: 188 };
export const SWAMP_LEVEL = 1.5;
export const GLADE = { x: 221, y: 55, r: 8 };     // grassy turn of the golem path (red troll)
export const LIZARD_VIL = { x: 128, y: 52 };
export const ORC_CAMP = { x: 196, y: 138 };
export const PALISADE = [[203, 172], [214, 150], [222, 128], [230, 106], [234, 96]];
export const ORC_GATE = 0.5; // gap at the middle of the palisade
export const ENTRY = { x: 4, y: 54 };            // from gz1mg (west edge)
export const ROADS = [
  [[0, 54], [18, 58], [34, 74], [44, 100], [50, 126], [56, 150], [62, 172], [64, 184]],       // entry -> human camp
  [[44, 100], [62, 92], [80, 80], [88, 70], [94, 62], [104, 55], [106, 58], [109, 69]],         // -> cave A over the swamp's central island (2026-11-17: the way along the massif foot is blocked)
  [[100, 84], [116, 70], [128, 56]],                                                           // -> lizard village
  [[50, 126], [44, 160], [42, 196], [40, 214]],                                                // -> mushroom ring
  [[64, 184], [84, 172], [100, 164]],                                                          // camp -> bridge
  [[128, 167], [150, 160], [172, 150], [190, 140], [212, 132], [232, 134], [244, 150]],        // bridge -> orc camp -> ramp
  [[212, 132], [196, 116], [182, 104]],                                                        // camp south
  [[232, 134], [240, 160], [244, 168]],                                                        // -> mage path
  [[190, 140], [196, 180], [194, 214]],                                                        // -> fire lizard
  [[128, 56], [142, 62], [153, 64]],                                                           // lizard islet -> ferry raft
];

// ---------- heights (m), max ≈ 19.5 ----------
const ridged = (x, y, s) => { const n = fbm(x, y, s); return 0.55 * (1 - Math.abs(2 * n - 1)) + 0.45 * n; };
const T_BRIDGE = polyDist(RIVER, BRIDGE.x, BRIDGE.y).t;
export function height(x, y) {
  const east = riverSide(x, y) > 0;
  let h = east ? 5 + 2.2 * (fbm(x / 45, y / 45, 3) - 0.5) : 4.5 + 3 * (fbm(x / 40, y / 40, 1) - 0.5);
  // extra hills and knolls
  for (const [hx, hy, r, a] of [[24, 140, 22, 4], [30, 96, 16, 2.5], [70, 118, 14, 2.5], [62, 210, 14, 2], [150, 192, 10, 3.5], [186, 80, 12, 3], [178, 176, 8, 2.5], [228, 70, 10, 0], [242, 132, 9, 2]]) h += a * (1 - sstep(r * 0.3, r, Math.hypot(x - hx, y - hy)));
  // NW hill with the mushroom ring on a flat top
  h += 3.2 * (1 - sstep(10, 34, Math.hypot(x - RING.x, y - RING.y)));
  if (Math.hypot(x - RING.x, y - RING.y) < 14) h = lerp(h, 7.6, 1 - sstep(10, 14, Math.hypot(x - RING.x, y - RING.y)));
  // swamp lowland
  const sw = polySD(SWAMP, x, y);
  if (!east) { const k = 1 - sstep(-14, 4, sw), n = fbm(x / 9, y / 9, 5), n2 = fbm(x / 23, y / 31, 6); const isl = sstep(0.5, 0.6, 0.65 * n + 0.35 * n2);
    h = lerp(h, lerp(0.55 + 0.6 * n, 2.0 + 1.4 * Math.max(0, n - 0.5), isl), k); }
  // western massif (cliffs, peaks)
  const md = polySD(MASSIF, x, y);
  if (md < 3) { const k = 1 - sstep(-5, 2, md); h = Math.max(h, lerp(h, 9 + 10.5 * ridged(x / 12, y / 12, 7), k)); }
  // cave A mouth: a level notch cut into the south foot
  if (y < CAVE_A.y - 0.5) { const d = Math.hypot(x - CAVE_A.x, y - (CAVE_A.y - 6)); if (d < 9) h = lerp(2.6, h, sstep(5.5, 9, d)); }
  if (Math.abs(x - CAVE_A.x) < 9 && y > CAVE_A.y - 1.5 && y < CAVE_A.y + 14) { const t = Math.min(19, 2.6 + (y - (CAVE_A.y - 1.8)) * 2.8); h = Math.max(h, lerp(t, h, sstep(5, 9, Math.abs(x - CAVE_A.x)))); }
  // SE rock mass with the golem path cut into it
  const sd = polySD(SE_MASS, x, y);
  if (sd < 4 && !(x < 200 && y > 60)) {
    const k = 1 - sstep(-5, 1.5, sd);
    let rock = 9.5 + 7.5 * ridged(x / 13, y / 13, 9);
    h = Math.max(h, lerp(h, rock, k));
  }
  { const p = polyDist(SE_PATH, x, y); const pz = lerp(3.2, PLATEAU_Z, sstep(0.25, 1, p.t)); const w = 4.6 + 1.5 * vnoise(p.t * 30, 0, 4);
    if (p.d < w + 3) h = lerp(pz, h, sstep(w, w + 3, p.d)); }
  { const d = Math.hypot(x - GLADE.x, y - GLADE.y) + 2.5 * (vnoise(x / 4, y / 4, 81) - 0.5); if (d < GLADE.r + 3) h = lerp(3.7 + 0.4 * fbm(x / 5, y / 5, 82), h, sstep(GLADE.r, GLADE.r + 3, d)); }
  if (x < CAVE_B.x + 0.5) { const d = Math.hypot(x - (CAVE_B.x - 5), y - CAVE_B.y); if (d < 7) h = lerp(3.2, h, sstep(4.5, 7, d)); }
  if (Math.abs(y - CAVE_B.y) < 9 && x > CAVE_B.x - 1.5) { const t = Math.min(19, 3.2 + (x - (CAVE_B.x - 1.8)) * 2.8); h = Math.max(h, lerp(t, h, sstep(5, 9, Math.abs(y - CAVE_B.y)))); }
  // cemetery plateau and its ramp to the burnt plains
  const pd = polySD(PLATEAU, x, y);
  if (pd < 3) { const k = 1 - sstep(-1, 2.5, pd); h = Math.max(h, lerp(h, PLATEAU_Z + 0.8 * (fbm(x / 9, y / 9, 11) - 0.5), k)); }
  { const p = polyDist(RAMP, x, y); if (p.d < 9) { const pz = lerp(PLATEAU_Z, 5.2, p.t); h = lerp(pz, h, sstep(4.5, 9, p.d)); } }
  // mage mountain with the serpentine path
  const gd = polySD(MAGE_MASS, x, y);
  if (gd < 3) { const k = 1 - sstep(-5, 1.5, gd); const ds = Math.hypot(x - SUMMIT.x, y - SUMMIT.y), rock = Math.min(9 + 6.5 * ridged(x / 13, y / 13, 13), lerp(SUMMIT.z - 3.2, 17, sstep(22, 50, ds))); h = Math.max(h, lerp(h, rock, k)); }
  { const p = polyDist(MAGE_PATH, x, y); if (p.d < 7.5) { const pz = lerp(5.2, SUMMIT.z - 0.4, sstep(0, 1, p.t)); h = lerp(pz, h, sstep(3.6, 7.5, p.d)); } }
  { const d = Math.hypot(x - SUMMIT.x, y - SUMMIT.y), a = Math.atan2(y - SUMMIT.y, x - SUMMIT.x), r = SUMMIT.r * (0.78 + 0.45 * fbm(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, 71));
    if (d < r + 2.5) h = lerp(SUMMIT.z + 0.35 * (fbm(x / 6, y / 6, 72) - 0.5), h, sstep(r, r + 2.5, d)); }
  // fire lizard crater: rim of rocks around a hot basin
  { const d = Math.hypot(x - LAIR.x, y - LAIR.y); const rim = Math.exp(-((d - LAIR.r * 0.8) ** 2) / 40) * (6 + 3 * fbm(x / 6, y / 6, 21)); h += rim * (y > LAIR.y - 26 ? 1 : 0); if (d < LAIR.r * 0.6) h = lerp(3.3, h, sstep(LAIR.r * 0.45, LAIR.r * 0.6, d)); }
  // gap in the crater rim towards the plains (south-east)
  { const d = Math.hypot(x - (LAIR.x + 9), y - (LAIR.y - 14)); if (d < 7) h = lerp(4.4, h, sstep(4, 7, d)); }
  // lava pools: small hollows
  for (const [px, py, r] of LAVA_POOLS) { const d = Math.hypot(x - px, y - py); if (d < r + 3) h = Math.min(h, lerp(3.0, h, sstep(r - 1, r + 3, d))); }
  // flat building grounds: lizard islet, orc camp, human camp
  { const d = Math.hypot(x - LIZARD_VIL.x, y - LIZARD_VIL.y); if (d < 16) h = lerp(2.5 + 0.3 * vnoise(x / 3, y / 3, 61), h, sstep(11, 16, d)); }
  { const d = Math.hypot(x - ORC_CAMP.x, y - ORC_CAMP.y); if (d < 40 && east) h = lerp(5.2 + 0.4 * (fbm(x / 20, y / 20, 3) - 0.5), h, sstep(28, 40, d)); }
  { const d = Math.hypot(x - HUMAN_CAMP.x, y - HUMAN_CAMP.y); if (d < 32) h = lerp(4.4 + 0.5 * (fbm(x / 20, y / 20, 1) - 0.5), h, sstep(22, 32, d)); }
  { const d = Math.hypot(x - 151, y - 44); if (d < 9) h = Math.max(h, lerp(2.2, h, sstep(5, 9, d))); }   // rats' islet
  // causeways across the swamp (to the cave mouth and the lizard islet)
  if (!east && polySD(SWAMP, x, y) < 4) for (const R of [ROADS[1], ROADS[2], ROADS[9]]) { const d = polyDist(R, x, y).d; if (d < 3) h = Math.max(h, lerp(2.0, h, sstep(1.9, 3, d))); }
  // ramp down into the fire lizard crater
  { const p = polyDist(LAIR_RAMP, x, y); if (p.d < 6) { const pz = lerp(5.0, 3.6, p.t); h = lerp(pz, h, sstep(3.2, 6, p.d)); } }
  // river bed and banks
  { const p = polyDist(RIVER, x, y), g = sstep(0.015, 0.06, Math.abs(p.t - T_BRIDGE)); const half = (RIVER_HALF + 1.2 * (vnoise(p.t * 18, 1, 2) - 0.5)) * lerp(0.6, 1, g);
    if (p.d < half + 7) { const bank = lerp(5.2, east ? 4.2 : 3.6, g); const land = lerp(bank, h, sstep(half + 3, half + 7, p.d)); h = p.d < half ? lerp(0.4, 1.4, sstep(half - 3, half, p.d)) : lerp(1.6, land, sstep(half, half + 3, p.d)); } }
  // map rim: hills along the borders (not at the west entrance or under the river)
  const edge = Math.min(x, y, W - x, H - y);
  const entry = Math.abs(y - ENTRY.y) < 12 && x < 30, river = polyDist(RIVER, x, y).d < 14;
  const rw = 10 + 8 * fbm(x / 23, y / 23, 33);
  if (edge < rw && !entry && !river) h = Math.max(h, lerp(h + 3.5 + 3.5 * fbm(x / 9, y / 9, 31), h, sstep(0, rw, edge)));
  return clamp(h, 0.2, 19.5);
}

// ---------- cave gz3mg ----------
export const C_TUN = [ // tunnels: polyline + half width
  [[[0, 112], [16, 112], [30, 108], [44, 104]], 7],
  [[[44, 104], [60, 96], [78, 84]], 7.5],
  [[[86, 84], [98, 96], [104, 110], [112, 124]], 6.5],          // to troll den
  [[[92, 76], [110, 66], [128, 56], [142, 48]], 7],
  [[[142, 48], [160, 40], [176, 30], [192, 28]], 6.5],
  [[[60, 96], [56, 76], [62, 52], [78, 40]], 5.5],              // side loop with the old mine
  [[[78, 40], [100, 34], [118, 40], [128, 56]], 5.5],
];
export const C_HALL = [ // halls: x, y, r, name
  [44, 104, 13, 'nest'], [86, 80, 20, 'queen'], [116, 130, 16, 'trolls'], [144, 46, 12, 'eyes'], [80, 38, 10, 'mine'], [26, 140, 9, 'pool'],
];
export const C_POOL = { x: 72, y: 70, r: 6 };
export const C_ENTRY_W = { x: 3, y: 112 }, C_ENTRY_E = { x: 189, y: 28 };
export function caveHeight(x, y) {
  let open = 0;
  for (const [P, w] of C_TUN) { const d = polyDist(P, x, y).d; open = Math.max(open, 1 - sstep(w * 0.75, w + 2.5, d + 1.2 * (vnoise(x / 4, y / 4, 3) - 0.5) * 2)); }
  for (const [hx, hy, r] of C_HALL) { const d = Math.hypot(x - hx, y - hy) + 3 * (vnoise(x / 6, y / 6, 8) - 0.5); open = Math.max(open, 1 - sstep(r * 0.8, r + 3, d)); }
  { const p = polyDist([[26, 140], [30, 124], [38, 110]], x, y); open = Math.max(open, 1 - sstep(3.5, 6.5, p.d)); }
  const floor = 2 + 1.1 * fbm(x / 10, y / 10, 2), wall = 13 + 5 * fbm(x / 9, y / 9, 6);
  let h = lerp(wall, floor, open);
  { const d = Math.hypot(x - C_POOL.x, y - C_POOL.y); if (d < C_POOL.r + 2) h = Math.min(h, lerp(0.6, h, sstep(C_POOL.r - 2, C_POOL.r + 2, d))); }
  { const d = Math.hypot(x - 26, y - 140); if (d < 7) h = Math.min(h, lerp(0.8, h, sstep(4, 7, d))); }
  return clamp(h, 0.3, 19.5);
}
export function caveOpen(x, y) { return caveHeight(x, y) < 5; }
