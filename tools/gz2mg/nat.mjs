// «Натурализация» рельефа под стиль оригинальных зон (2026-11-17): the generated zones were made of ellipses, constant-width
// tubes and smooth blobs, 4–8× smoother than the originals (study.mjs). This post-step works from a snapshot of the zone
// (pre/<zone>.mpr, taken on the first run) and is deterministic:
//   warp   — smooth horizontal distortion of heights, ground classes and liquids (frozen near units, buildings, exits)
//   shores — noise in the band around every liquid level: bays, capes, islets, a river of changing width
//   relief — gentle undulation and rocky knolls on the plains; ridges and terraces on the high ground
//   paint  — ground classes follow the warp, stone goes where it got steep; liquids are refilled
//   objects — trees, stones and bones ride with the ground (batch copy + delete); the drowned ones are dropped
// node nat.mjs <gz1mg|gz2mg> [dry|terrain|objects] [picture.png]    dry (default) only writes the picture and prints statistics
import fs from 'node:fs';
import { call } from './ei.mjs';
import * as G from './geo.mjs';
import { blur } from './study.mjs';
const { readMpr } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/formats/mpr.js');
const { encodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const { sstep, lerp, vnoise, fbm, clamp } = G;
const [zone, mode = 'dry', out = `nat_${zone}.png`] = process.argv.slice(2);
const log = (...a) => console.log(...a.map(x => typeof x === 'string' ? x : JSON.stringify(x).slice(0, 300)));

const C5 = { grass: [2, 3, 4, 5, 6, 17, 18, 19, 20, 21, 22, 23, 24], dark: [7, 27, 28, 29, 30, 31, 32, 33, 34, 43, 44, 45, 46, 47, 145, 146, 147, 148, 149], olive: [26, 196, 197, 198, 199, 337, 338, 339, 345, 369], ground: [8, 222, 223, 224, 482], stone: [0, 1, 170, 171, 172, 173, 178, 179, 180] };
const CFG = {
  gz1mg: { classes: C5, hill: [7.5, 11], hillBias: -0.35, big: /MineEntrance|Gate|Dgun/, keep: () => false, protect: () => 1,
    // design touches [x, y, r, height]: bays and a cape of the clear lake; bays and two rock islands of the lava lake
    lobes: [[74, 61, 12, 1.6], [51, 61, 7, 1.6], [66, 60, 6, 1.7], [58, 54, 5, 4.4], [50, 34, 7, 4.3], [172, 133, 10, 2.2], [108, 150, 9, 2.2], [141, 158, 8, 6.2], [166, 164, 4.5, 5.2], [246, 47, 26, 12.5]],
    // the river from the hot spring under the lava bar down to the lake: [x, y, half-width]; it widens into a mouth
    river: { level: 3.0, path: [[44, 112, 5], [36, 104, 4.5], [27, 96, 4], [24, 86, 4], [25, 78, 4.5], [28, 70, 5], [32, 63, 6.5], [39, 55, 10]] },
    shore: (lf, n) => lf.lava ? (n > 0.45 ? 'stone' : 'ground') : lf.swamp ? 'olive' : 'ground', stone: () => 'stone' },
  gz2mg: { deep: true, hill: [7.5, 10.5], hillBias: 0, big: /MineEntrance|Bridge|Teleport|Ogre House|Crypt|KanianArc/, keep: o => /Log/.test(o.prototype) && (Math.hypot(o.pos[0] - 159, o.pos[1] - 65) < 16 || Math.hypot(o.pos[0] - 176, o.pos[1] - 67) < 16),
    shore: (lf, n, x, y) => lf.lava ? 'plates' : lf.swamp ? 'olive' : G.riverSide(x, y) > 0 ? 'soil' : 'ground', stone: (x, y) => G.riverSide(x, y) > 0 ? 'stoneE' : 'stone' },
}[zone];
const MOVABLE = /Tree|Bush|Mushroom|Stub|Log|Stone|Skeleton|Bone|Scull|Rock/;
if (zone === 'gz2mg') { // walkable corridors and building grounds keep their profile (in source space, so they ride with the warp)
  const lines = [...G.ROADS, G.SE_PATH, G.MAGE_PATH, G.RAMP, G.LAIR_RAMP], discs = [[G.HUMAN_CAMP.x, G.HUMAN_CAMP.y, 22], [G.ORC_CAMP.x, G.ORC_CAMP.y, 30], [G.LIZARD_VIL.x, G.LIZARD_VIL.y, 12], [G.GLADE.x, G.GLADE.y, G.GLADE.r], [G.RING.x, G.RING.y, 12], [G.SUMMIT.x, G.SUMMIT.y, G.SUMMIT.r], [151, 44, 7], [G.CAVE_A.x, G.CAVE_A.y - 6, 9], [G.CAVE_B.x - 5, G.CAVE_B.y, 8]];
  CFG.protect = (x, y) => { let p = sstep(2.5, 7, Math.min(...lines.map(L => G.polyDist(L, x, y).d))); p = Math.min(p, sstep(0, 4, G.polySD(G.PLATEAU, x, y))); for (const [cx, cy, r] of discs) p = Math.min(p, sstep(r, r + 6, Math.hypot(x - cx, y - cy))); return p; };
  const B = await import('./gen_b.mjs'); CFG.classes = B.MAIN_CLASSES; CFG.classAt = B.mainClass;
  // the straight embankment along the map border (geo.height's rim) is broken into separate hills
  CFG.rim = (x, y) => { const edge = Math.min(x, y, G.W - x, G.H - y), rw = 10 + 8 * fbm(x / 23, y / 23, 33);
    if (edge >= rw || (Math.abs(y - G.ENTRY.y) < 12 && x < 30) || G.polyDist(G.RIVER, x, y).d < 14 || [G.MASSIF, G.SE_MASS, G.MAGE_MASS, G.PLATEAU].some(P => G.polySD(P, x, y) < 5)) return 0;
    return (3.5 + 3.5 * fbm(x / 9, y / 9, 31)) * (1 - sstep(0, rw, edge)) * (1 - sstep(0.52, 0.66, fbm(x / 34, y / 34, 141))); };
  // corridors cut as constant-width tubes and the plateau's straight edge: their walls wobble (distance fn, band, shift range)
  CFG.paintShift = (x, y) => { let k = sstep(0, 10, G.polySD(G.SWAMP, x, y)) * sstep(12, 24, G.polyDist(G.RIVER, x, y).d) * sstep(4, 16, Math.min(x, y, G.W - x, G.H - y)) * (1 - sstep(6.5, 8, G.height(x, y)));
    for (const [cx, cy, r] of [[G.HUMAN_CAMP.x, G.HUMAN_CAMP.y, 20], [G.ORC_CAMP.x, G.ORC_CAMP.y, 28], [G.RING.x, G.RING.y, 12]]) k *= sstep(r, r + 10, Math.hypot(x - cx, y - cy));
    return [k * 5.5 * sm(x / 27, y / 27, 171), k * 5.5 * sm(x / 27, y / 27, 172)]; };
  // the cemetery plateau's ruler-straight rim crumbles in places (not under walls and crypts)
  CFG.extra = (h, qx, qy, x, y, mk) => { const sd = G.polySD(G.PLATEAU, qx, qy); return sd > -3.5 && sd < 0.5 ? h - 4.5 * mk * sstep(-3.5, -0.5, sd) * sstep(0.5, 0.7, fbm(x / 8, y / 8, 181, 3)) : h; };
  CFG.wobble = [[(x, y) => G.polyDist(G.SE_PATH, x, y).d, 2.5, 4.5, 10, 16, -3, 1.5], [(x, y) => G.polyDist(G.MAGE_PATH, x, y).d, 2.5, 4.5, 9, 14, -2.5, 1.2], [(x, y) => Math.abs(G.polySD(G.PLATEAU, x, y)), -1, 0, 4, 8, -3, 3]];
}

// ---------- snapshot ----------
fs.mkdirSync('pre', { recursive: true });
const PRE = `pre/${zone}.mpr`, POBJ = `pre/${zone}_objects.json`, PCLS = `pre/${zone}_classes.json`;
if (!fs.existsSync(PRE)) {
  fs.copyFileSync(`C:/GOG Games/EI_edit/Evil Islands/Maps/${zone}.mpr`, PRE);
  const objects = (await call('map_objects', { mob: zone, limit: 9000 })).objects;
  for (const o of objects) if (o.kind === 'unit') o.route = ((await call('map_object_get', { mob: zone, id: o.id })).patrols?.[0]?.points || []).map(p => p.pos.slice(0, 2));
  fs.writeFileSync(POBJ, JSON.stringify(objects));
  if (!CFG.classAt) fs.writeFileSync(PCLS, JSON.stringify(await call('terrain_classes', { mpr: zone, classes: CFG.classes })));
  log('snapshot taken:', PRE, objects.length, 'objects');
}
const m = readMpr(new Uint8Array(fs.readFileSync(PRE))), { W, H, TW, TH } = m, cz = m.maxZ / 65535;
const objects = JSON.parse(fs.readFileSync(POBJ, 'utf8')), cls0 = CFG.classAt ? null : JSON.parse(fs.readFileSync(PCLS, 'utf8'));
const h0 = (x, y) => { x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001); const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * W + i; return ((m.z[k] * (1 - fx) + m.z[k + 1] * fx) * (1 - fy) + (m.z[k + W] * (1 - fx) + m.z[k + W + 1] * fx) * fy) * cz; };

// ---------- anchors: masks for the warp (MW) and for the relief detail (MD) ----------
const MW = new Float32Array(W * H).fill(1), MD = new Float32Array(W * H).fill(1);
function stamp(F, x, y, r0, r1) { for (let j = Math.max(0, Math.floor(y - r1)); j <= Math.min(H - 1, Math.ceil(y + r1)); j++) for (let i = Math.max(0, Math.floor(x - r1)); i <= Math.min(W - 1, Math.ceil(x + r1)); i++) { const v = sstep(r0, r1, Math.hypot(i - x, j - y)); if (v < F[j * W + i]) F[j * W + i] = v; } }
const movable = o => o.kind === 'object' && MOVABLE.test(o.prototype) && !CFG.big.test(o.prototype) && !CFG.keep(o);
for (const o of objects) {
  if (movable(o)) continue;
  const [x, y] = o.pos, big = CFG.big.test(o.prototype || '');
  if (o.kind === 'unit') { stamp(MW, x, y, 3, 11); stamp(MD, x, y, 1.5, 5); for (const p of o.route || []) { stamp(MW, p[0], p[1], 1.5, 6); stamp(MD, p[0], p[1], 1.5, 5); } }
  else { stamp(MW, x, y, big ? 14 : 4, big ? 26 : 14); stamp(MD, x, y, big ? 7 : 2, big ? 15 : 7); }
}
for (const mt of String(await call('zone_get', { id: zone })).matchAll(/#(?:deploy|remove)\s+([\d. -]+)/g)) { const [a, b, c, d] = mt[1].trim().split(/\s+/).map(Number); stamp(MW, (a + c) / 2, (b + d) / 2, 10, 22); stamp(MD, (a + c) / 2, (b + d) / 2, 8, 16); }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) MW[y * W + x] *= sstep(2, 12, Math.min(x, y, W - 1 - x, H - 1 - y));
const mAt = (F, x, y) => F[clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)];

// ---------- the warp ----------
const sm = (x, y, s) => (vnoise(x, y, s) + 0.5 * vnoise(x * 2, y * 2, s + 9)) / 1.5 * 2 - 1;
const nz = (x, y, s) => clamp((fbm(x, y, s, 3) - 0.5) * 4.2, -1, 1); // fbm sits in 0.3…0.7: stretch it to ±1
// signed distance to the snapshot's shores (m, < 0 in the liquid) and its gradient: shores are moved along their normal
const SD = (() => { const INF = 1e6, wetV = (x, y) => { const t = Math.min(TH - 1, y >> 1) * TW + Math.min(TW - 1, x >> 1), k = Math.min(TH - 1, y >> 1) * 2 * W + Math.min(TW - 1, x >> 1) * 2; return m.waterMat[t] !== 0xffff && m.wz[k] > m.z[k]; };
  const dt = inside => { const d = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = wetV(x, y) === inside ? 0 : INF;
    const pass = (ys, xs, s) => { for (const y of ys) for (const x of xs) { const k = y * W + x; let v = d[k]; for (const [dx, dy, c] of [[-s, 0, 1], [0, -s, 1], [-s, -s, 1.414], [s, -s, 1.414]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) v = Math.min(v, d[ny * W + nx] + c); } d[k] = v; } };
    const xs = [...Array(W).keys()], ys = [...Array(H).keys()]; pass(ys, xs, 1); pass([...ys].reverse(), [...xs].reverse(), -1); return d; };
  const out = dt(true), inn = dt(false), d = new Float32Array(W * H); for (let i = 0; i < d.length; i++) d[i] = out[i] > 0 ? Math.min(out[i], 99) : -Math.min(inn[i], 99);
  return blur(d, W, H, 2); })();
const sdAt = (x, y) => SD[clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)];
// source point of (x, y): the big smooth warp, then the shore shift (liquids mostly grow: bays up to 9 m, capes up to 3 m)
const warp = (x, y) => { const k = mAt(MW, x, y);
  let dx = k * (15 * sm(x / 64, y / 64, 101) + 4 * sm(x / 20, y / 20, 103) + 1.2 * sm(x / 7, y / 7, 105)), dy = k * (15 * sm(x / 64, y / 64, 102) + 4 * sm(x / 20, y / 20, 104) + 1.2 * sm(x / 7, y / 7, 106));
  const qx = x + dx, qy = y + dy, w = 1 - sstep(14, 28, Math.abs(sdAt(qx, qy)));
  if (w > 0) { const gx = sdAt(qx + 2, qy) - sdAt(qx - 2, qy), gy = sdAt(qx, qy + 2) - sdAt(qx, qy - 2), l = Math.hypot(gx, gy);
    if (l > 0.5) { const N = k * w * CFG.protect(qx, qy) * clamp(7 * nz(x / 26, y / 26, 107) + 3 * nz(x / 9, y / 9, 108) - 2, -9, 3); dx += gx / l * N; dy += gy / l * N; } }
  (CFG.wobble || []).forEach(([dist, a0, a1, b0, b1, lo, hi], i) => { const X = x + dx, Y = y + dy, d = dist(X, Y), w = sstep(a0, a1, d) * (1 - sstep(b0, b1, d)); if (w <= 0) return;
    const gx = dist(X + 1, Y) - dist(X - 1, Y), gy = dist(X, Y + 1) - dist(X, Y - 1), l = Math.hypot(gx, gy); if (l < 0.2) return;
    const N = k * w * clamp(3.5 * nz(x / 12, y / 12, 150 + i), lo, hi); dx += gx / l * N; dy += gy / l * N; });
  return [dx, dy]; };

// ---------- liquids of the snapshot: level field, spread 20 m around every body ----------
const LV = new Float32Array(TW * TH), LM = new Int16Array(TW * TH).fill(-1), surf = {};
{ const q = [];
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) { const t = ty * TW + tx, k = ty * 2 * W + tx * 2; if (m.waterMat[t] !== 0xffff && m.wz[k] > m.z[k]) { LV[t] = m.wz[k] * cz; LM[t] = m.waterMat[t]; (surf[LM[t]] ||= new Set()).add(m.waterTiles[t] & 0x3fff); q.push(t); } }
  const dist = new Uint8Array(TW * TH); let head = 0;
  while (head < q.length) { const c = q[head++], x = c % TW, y = (c / TW) | 0; if (dist[c] >= 10) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const n = ny * TW + nx; if (LM[n] >= 0) continue; LM[n] = LM[c]; LV[n] = LV[c]; dist[n] = dist[c] + 1; q.push(n); } } }
const matKind = i => { const c = m.materials[i]; return c.selfIllum > 0 ? 'lava' : c.color[1] > c.color[2] ? 'swamp' : 'water'; };
const levelAt = (x, y) => { const t = clamp(Math.floor(y / 2), 0, TH - 1) * TW + clamp(Math.floor(x / 2), 0, TW - 1); return LM[t] < 0 ? null : { L: LV[t], mat: LM[t], lava: matKind(LM[t]) === 'lava', swamp: matKind(LM[t]) === 'swamp' }; };

// ---------- new heights ----------
const rid = (x, y, s) => 1 - Math.abs(2 * fbm(x, y, s, 3) - 1), MAXZ = 32; // the originals' ceilings are 22…53 m; ours was 19.9
const Z = new Float32Array(W * H), QX = new Float32Array(W * H), QY = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const k = y * W + x, [dx, dy] = warp(x, y), qx = x + dx, qy = y + dy; QX[k] = qx; QY[k] = qy;
  let h = h0(qx, qy); const md = Math.min(MD[k], CFG.protect(qx, qy)), lf = levelAt(qx, qy);
  if (CFG.rim) h -= CFG.rim(qx, qy);
  if (CFG.extra) h = CFG.extra(h, qx, qy, x, y, MD[k]);
  if (md > 0) {
    if (lf) { // shores: small unevenness; islets in the deep of the big bodies
      h += md * (1 - sstep(0.8, 2.4, Math.abs(h - lf.L))) * 0.55 * nz(x / 11, y / 11, 111);
      if (CFG.lobes && h < lf.L - 0.9) h += md * (lf.L - h + 0.9) * sstep(0.6, 0.72, fbm(x / 21, y / 21, 113)) * sstep(0.9, 2.2, lf.L - h);
    }
    for (const [lx, ly, r, t] of CFG.lobes || []) { const d = Math.hypot(x - lx, y - ly) + 0.35 * r * nz(x / 7, y / 7, 160); if (d < r) h = lerp(h, t < h ? Math.min(h, lerp(t, h, sstep(0.45 * r, r, d))) : Math.max(h, lerp(t, h, sstep(0.3 * r, r, d))), md); }
    if (CFG.river) { const P = CFG.river.path, L = CFG.river.level, p = G.polyDist(P, x, y);
      if (p.d < 16) { let acc = 0, tot = 0, w = P[0][2]; const len = P.slice(1).map((q, i) => Math.hypot(q[0] - P[i][0], q[1] - P[i][1])); tot = len.reduce((a, b) => a + b, 0);
        for (let i = 0; i < len.length; i++) { if (p.t * tot <= acc + len[i] || i === len.length - 1) { w = lerp(P[i][2], P[i + 1][2], clamp((p.t * tot - acc) / len[i], 0, 1)); break; } acc += len[i]; }
        w *= 1 + 0.25 * nz(x / 9, y / 9, 195); const d = p.d + 1.2 * nz(x / 5, y / 5, 196);
        if (d < w + 4.5) { const bed = lerp(L - 1.1, L - 0.5, sstep(w * 0.35, w, d)), c = d < w ? bed : lerp(L - 0.5, Math.max(h, L + 0.5), sstep(w, w + 4.5, d)); h = lerp(h, d < w ? Math.min(h, c) : (h < L + 0.5 ? c : h), md); } } }
    const wm = sstep(CFG.hill[0], CFG.hill[1], h), dry = lf ? sstep(0.4, 1.6, h - lf.L) : 1;
    // plains: broad swells, undulation, a few rocky crags
    h += md * (1 - wm) * dry * (1.0 * nz(x / 60, y / 60, 120) + 0.5 * nz(x / 23, y / 23, 121) + 0.15 * nz(x / 6.5, y / 6.5, 122));
    h += md * (1 - wm) * dry * sstep(0.67, 0.8, fbm((x + 0.6 * y) / 15, (y - 0.6 * x) / 9, 123, 3)) * (1.2 + 1.6 * rid(x / 5, y / 5, 124));
    // high ground: the massifs grow into mountains with ridges, crags and terraces
    if (wm > 0) { h += md * wm * (h - CFG.hill[0]) * (0.15 + 1.1 * sstep(0.3, 0.75, fbm(x / 40, y / 40, 130)));
      h += md * wm * (3.0 * (rid(x / 12, y / 12, 131) - 0.55 + CFG.hillBias) + 1.8 * (rid(x / 4.5, y / 4.5, 132) - 0.5) + 0.7 * (vnoise(x / 1.7, y / 1.7, 133) - 0.5));
      const t = 2.2, f = h / t - Math.floor(h / t); h = lerp(h, (Math.floor(h / t) + sstep(0.3, 0.7, f)) * t, 0.6 * wm * md); }
  }
  // the AI grid closes water deeper than ~1.5 m: the river must stay a barrier along its whole length
  if (CFG.deep && lf && !lf.swamp && !lf.lava && h < lf.L - 1.0) h = Math.min(h, lf.L - 1.8);
  Z[k] = clamp(h, 0.2, MAXZ - 0.4);
}
// liquids on the tile grid. A tile's liquid quad covers the whole 2×2 m tile, so a shore looks right only when every tile
// next to the liquid has all its ground above the level — otherwise the quad ends in a ruler-straight edge (the "staircase"
// the user saw at the lava lake, 2026-11-17). So: 1) a tile is wet when any of its 9 vertices is below the level (the rule
// of terrain_water); 2) the liquid spreads on into low tiles next to it, up to 8 m beyond the level field; 3) the dry tiles
// around get their low vertices lifted just above the level.
const wet = new Uint8Array(TW * TH), wlv = new Float32Array(TW * TH), sill = new Uint8Array(TW * TH);
{ const low = (t, L) => { const tx = t % TW, ty = (t / TW) | 0; for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) if (Z[(ty * 2 + j) * W + tx * 2 + i] < L - 0.03) return true; return false; };
  const q = [], far = new Uint8Array(TW * TH), field = new Int16Array(TW * TH).fill(-1);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) { const t = ty * TW + tx, c = (ty * 2 + 1) * W + tx * 2 + 1, lf = levelAt(QX[c], QY[c]); if (!lf) continue; field[t] = lf.mat; if (low(t, lf.L)) { wet[t] = 1 + lf.mat; wlv[t] = lf.L; q.push(t); } }
  for (let h = 0; h < q.length; h++) { const c = q[h], x = c % TW, y = (c / TW) | 0; if (far[c] >= 4) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const n = ny * TW + nx;
      if (wet[n] || (field[n] >= 0 && field[n] !== wet[c] - 1) || !low(n, wlv[c])) continue; wet[n] = wet[c]; wlv[n] = wlv[c]; far[n] = field[n] < 0 ? far[c] + 1 : far[c]; q.push(n); } }
  // two liquids never touch (their quads would meet in a staircase of tile edges): where lava meets water, or the swamp the
  // river, a bar of ground rises between them — a front of cooled lava (2) or a shoal (1), a tile or two wide
  { const near = (tx, ty, r, f) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = tx + dx, ny = ty + dy; if (nx >= 0 && ny >= 0 && nx < TW && ny < TH && f(ny * TW + nx)) return true; } return false; };
    const bar = [];
    for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) { const t = ty * TW + tx, a = wet[t]; if (!a) continue;
      const r = fbm(tx / 5, ty / 5, 191) > 0.5 ? 2 : 1; let other = 0; near(tx, ty, r, n => { if (wet[n] && wet[n] !== a) { other = wet[n]; return true; } return false; });
      if (other && (r === 1 || wlv[t] >= (near(tx, ty, r, n => wet[n] === other && wlv[n] > wlv[t]) ? 1e9 : 0))) bar.push([t, Math.max(wlv[t], ...[other].map(o => { let L = 0; near(tx, ty, r, n => { if (wet[n] === o) L = Math.max(L, wlv[n]); return false; }); return L; })), matKind(a - 1) === 'lava' || matKind(other - 1) === 'lava' ? 2 : 1]); }
    for (const [t, L, kind] of bar) { wet[t] = 0; sill[t] = kind; const tx = t % TW, ty = (t / TW) | 0;
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) { const x = tx * 2 + i, y = ty * 2 + j, k = y * W + x; Z[k] = Math.max(Z[k], L + 0.3 + (kind === 2 ? 1.1 : 0.35) * rid(x / 4, y / 4, 192)); } } }
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) { const t = ty * TW + tx; if (wet[t]) continue; let L = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = tx + dx, ny = ty + dy; if (nx >= 0 && ny >= 0 && nx < TW && ny < TH && wet[ny * TW + nx]) L = Math.max(L, wlv[ny * TW + nx]); }
    if (L) for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) { const k = (ty * 2 + j) * W + tx * 2 + i; if (Z[k] < L + 0.15) Z[k] = L + 0.15; } } }

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let L = 1e9, n = 0, lava = false; for (const [tx, ty] of [[x >> 1, y >> 1], [(x - 1) >> 1, y >> 1], [x >> 1, (y - 1) >> 1], [(x - 1) >> 1, (y - 1) >> 1]]) { if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) continue; n++; const t = ty * TW + tx; if (!wet[t] || matKind(wet[t] - 1) === 'swamp') { L = -1; break; } L = Math.min(L, wlv[t]); lava = matKind(wet[t] - 1) === 'lava'; }
  if (n && L > 0) { const k = y * W + x; Z[k] = Math.min(Z[k], L - (lava ? 1.8 : 0.35)); } }
// steam: points along the cooled-lava bars between lava and water (live.mjs puts "Smoke" particle sources there)
{ const pts = []; for (let t = 0; t < TW * TH; t++) if (sill[t] === 2) { const x = (t % TW) * 2 + 1, y = ((t / TW) | 0) * 2 + 1; if (!pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 4.5)) pts.push([x, y, +(Z[y * W + x] + 0.4).toFixed(2)]); }
  fs.writeFileSync(`pre/${zone}_steam.json`, JSON.stringify(pts.slice(0, 10))); }

// ---------- statistics and picture ----------
{ const sl = [], lap = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x; sl.push(Math.hypot(Z[k + 1] - Z[k - 1], Z[k + W] - Z[k - W]) / 2); lap.push(Math.abs(Z[k] - (Z[k - 1] + Z[k + 1] + Z[k - W] + Z[k + W]) / 4)); }
  sl.sort((a, b) => a - b); lap.sort((a, b) => a - b); const q = (a, p) => +a[Math.floor(a.length * p)].toFixed(2);
  const band = r => { const b = blur(Z, W, H, r); let s = 0; for (let i = 0; i < Z.length; i++) s += (Z[i] - b[i]) ** 2; return +Math.sqrt(s / Z.length).toFixed(2); };
  log(zone, 'slope p50/75/90/99', [0.5, 0.75, 0.9, 0.99].map(p => q(sl, p)), 'steep>0.6', +(sl.filter(v => v > 0.6).length / sl.length).toFixed(3), 'lap p50/90/99', [0.5, 0.9, 0.99].map(p => q(lap, p)), 'band 1/3/8/24', [1, 3, 8, 24].map(band));
  log('  originals (zone1, zone3obr, zone7): slope .15-.22/.5-.6/1.2-1.4/3.6-4.3, steep .22-.26, lap .03-.07/.47-.5/1.7-2.2, band .5/1/1.6/2.6'); }
{ const S = 2, w = (W - 1) * S, h = (H - 1) * S, o = new Uint8Array(w * h * 4), zb = (x, y) => { x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001); const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * W + i; return (Z[k] * (1 - fx) + Z[k + 1] * fx) * (1 - fy) + (Z[k + W] * (1 - fx) + Z[k + W + 1] * fx) * fy; };
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) { const x = px / S, y = H - 1 - py / S, l = clamp(0.85 + (-(zb(x + 0.5, y) - zb(x - 0.5, y)) * 0.7 + (zb(x, y + 0.5) - zb(x, y - 0.5)) * 0.7) * 0.55, 0.15, 1.6), t = zb(x, y) / MAXZ;
    let c = [90 + 150 * t, 130 + 60 * t, 70 + 60 * t].map(v => v * l); const wt = wet[clamp(y >> 1, 0, TH - 1) * TW + clamp(x >> 1, 0, TW - 1)];
    if (wt) c = { lava: [220, 80, 30], swamp: [70, 130, 110], water: [60, 100, 170] }[matKind(wt - 1)];
    const i = (py * w + px) * 4; o[i] = Math.min(255, c[0]); o[i + 1] = Math.min(255, c[1]); o[i + 2] = Math.min(255, c[2]); o[i + 3] = 255; }
  for (const ob of objects) if (!movable(ob)) { const px = Math.round(ob.pos[0] * S), py = Math.round((H - 1 - ob.pos[1]) * S); for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) { const i = ((py + a) * w + px + b) * 4; if (i >= 0 && i + 2 < o.length) { o[i] = 255; o[i + 1] = ob.kind === 'unit' ? 40 : 230; o[i + 2] = 40; } } }
  fs.writeFileSync(out, encodePng(w, h, o)); log('picture', out); }
if (mode === 'dry') process.exit(0);

const slopeAt = (x, y) => { const i = clamp(Math.round(x), 1, W - 2), j = clamp(Math.round(y), 1, H - 2), k = j * W + i; return Math.max(Math.abs(Z[k + 1] - Z[k - 1]), Math.abs(Z[k + W] - Z[k - W])); }; // rise per 2 m
const wetAt = (x, y) => { const t = clamp(Math.floor(y / 2), 0, TH - 1) * TW + clamp(Math.floor(x / 2), 0, TW - 1); if (!wet[t]) return 0; const i = clamp(Math.floor(x), 0, W - 2), j = clamp(Math.floor(y), 0, H - 2), k = j * W + i; return Math.min(Z[k], Z[k + 1], Z[k + W], Z[k + W + 1]) < wlv[t] + 0.25 ? wet[t] : 0; };

if (mode === 'terrain') {
  const rows = []; for (let y = 0; y < H; y++) rows.push(Array.from(Z.subarray(y * W, y * W + W), v => +v.toFixed(2)));
  log('heights', await call('terrain_set_heights', { mpr: zone, x0: 0, y0: 0, step: 1, rows, max_height: MAXZ }));
  // ground classes: the source point's class; stone where it got steep; shore strips
  const cls = (x, y) => { const k = y * W + x, ps = CFG.paintShift ? CFG.paintShift(QX[k], QY[k]) : [0, 0], qx = QX[k] + ps[0], qy = QY[k] + ps[1], s = slopeAt(x, y), n = vnoise(x / 5, y / 5, 43), lf = levelAt(qx, qy);
    let c = CFG.classAt ? CFG.classAt(Math.round(qx), Math.round(qy)) : cls0.names[parseInt(cls0.rows[clamp(Math.round(qy / 2), 0, cls0.rows.length - 1)][clamp(Math.round(qx / 2), 0, cls0.rows[0].length - 1)], 36)];
    if (lf && Z[k] < lf.L + 0.45 && wetAt(x, y) + wetAt(x - 1, y) + wetAt(x, y - 1) + wetAt(x - 1, y - 1) > 0 && MD[k] > 0.3) c = CFG.shore(lf, n, x, y); // shores and beds: sand, cooled lava, mud — never grass under water
    if ((s >= 0.85 || (s >= 0.6 && n > 0.45)) && MD[k] > 0.3) c = CFG.stone(x, y);
    { const tx = clamp(x >> 1, 0, TW - 1), ty = clamp(y >> 1, 0, TH - 1), b = Math.max(sill[ty * TW + tx], sill[ty * TW + Math.max(0, tx - 1)], sill[Math.max(0, ty - 1) * TW + tx], sill[Math.max(0, ty - 1) * TW + Math.max(0, tx - 1)]); if (b === 2) c = CFG.stone(x, y); else if (b === 1) c = CFG.shore({ lava: false, swamp: false }, n, x, y); }
    return c; };
  const ops = []; for (let y = 0; y < H; y += 2) { let x0 = 0, c = cls(0, y); for (let x = 2; x <= W + 1; x += 2) { const k = x < W ? cls(x, y) : null; if (k !== c) { ops.push({ x0, x1: x - 2, y0: y, y1: y, class: c }); x0 = x; c = k; } } }
  const ti = await call('terrain_info', { mpr: zone }), exclude = Object.entries(ti.tiles_by_type).filter(([k]) => /water|swamp|lava/.test(k)).flatMap(([, v]) => v);
  for (let i = 0; i < ops.length; i += 4000) log('paint', i, await call('terrain_autotile', { mpr: zone, classes: CFG.classes, ops: ops.slice(i, i + 4000), exclude }));
  const wops = [{ x0: 0, y0: 0, x1: W - 1, y1: H - 1, remove: true }];
  for (let ty = 0; ty < TH; ty++) { let x0 = -1, c = 0; for (let tx = 0; tx <= TW; tx++) { const k = tx < TW ? wet[ty * TW + tx] : 0; if (k !== c) { if (c) wops.push({ x0: x0 * 2 + 0.5, x1: tx * 2 - 0.5, y0: ty * 2 + 0.5, y1: ty * 2 + 1.5, level: +wlv[ty * TW + x0].toFixed(2), material: c - 1, tiles: [...surf[c - 1]] }); x0 = tx; c = k; } } }
  log('liquids', wops.length, await call('terrain_water', { mpr: zone, ops: wops }));
  if (!m.dx.some(v => v)) log('jitter', await call('terrain_jitter', { mpr: zone, share: 0.5, amount: 64, seed: 7 }));
  log('maps', await call('zone_maps', { zone }));
}
if (mode === 'objects') { // trees, stones and bones ride with the ground (p' + warp(p') = p): all of them are laid out anew from the snapshot
  const ids = (await call('map_objects', { mob: zone, limit: 9000 })).objects.filter(movable).map(o => o.id), items = [];
  let dropped = 0;
  for (const o of objects) { if (!movable(o)) continue;
    let [x, y] = o.pos; for (let i = 0; i < 4; i++) { const [dx, dy] = warp(x, y); x = o.pos[0] - dx; y = o.pos[1] - dy; }
    // reeds that stood in the swamp stay in it; what the new liquid or a new cliff took is dropped
    const bad = (x, y) => (wetAt(x, y) && sdAt(o.pos[0], o.pos[1]) >= 0) || slopeAt(x, y) > 2.4 || x < 1 || y < 1 || x > W - 2 || y > H - 2;
    if (bad(x, y)) { let ok = null; for (const r of [2.5, 5, 7.5]) for (let a = 0; a < 8 && !ok; a++) { const X = x + r * Math.cos(a * 0.785 + o.id), Y = y + r * Math.sin(a * 0.785 + o.id); if (!bad(X, Y) && !wetAt(X, Y) && MD[clamp(Math.round(Y), 0, H - 1) * W + clamp(Math.round(X), 0, W - 1)] > 0.9) ok = [X, Y]; }
      if (!ok) { dropped++; continue; } [x, y] = ok; }
    items.push({ object: o.prototype, fields: { pos: [+x.toFixed(2), +y.toFixed(2), o.pos[2] || 0], yaw: o.yaw } }); }
  log('objects laid out', items.length, 'dropped', dropped, await call('map_object_add', { mob: zone, items }));
  if (ids.length) log('old removed', await call('map_object_delete', { mob: zone, ids }));
}
