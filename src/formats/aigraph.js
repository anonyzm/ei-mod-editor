// AI path graph: top-level MOB chunk 0x31415926 (zone6 keeps the same bytes in Maps/zone6.grp).
// u32 W, u32 H (= sectors x 8: one node per 4x4 m), then 8 layers, one per AI class of the races
// in the database (0 flyers, 1 small animals, 2 goblins, 3 humans/orcs, ... 7 trolls/cyclops).
// Each layer is H rows; a row is W x 8 u16 edge costs, W x u8 anchor, W x u16 region id.
//   edge cost: to the neighbour in direction d (0 = -y, then counter-clockwise: -x-y, -x, -x+y, +y, +x+y, +x, +x-y),
//     0xFFFF = no passage; 16 x metres for class 0, 32 x metres for the others.
//   anchor: walk point inside the node, high nibble y / low nibble x in 0.5 m steps (0x33 = centre-ish).
//   region: connected component of open edges, numbered from 1 in row-major order.
// The original builder (Nival's editor) is not available; buildAiGraph() uses rules fitted to the
// original zones (~85% of edges agree) and is meant for changed areas and brand-new zones.
export const AIGRAPH_ID = 0x31415926;
export const CLASSES = 8;
export const DIRS = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];
const NONE = 0xffff;

export function readAiGraph(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const W = dv.getUint32(0, true), H = dv.getUint32(4, true), N = W * H;
  if (u8.length !== 8 + N * 19 * CLASSES) throw new Error(`Граф проходимости: размер ${u8.length} не совпадает с сеткой ${W}x${H}`);
  const layers = Array.from({ length: CLASSES }, (_, k) => {
    const cost = new Uint16Array(N * 8), anchor = new Uint8Array(N), region = new Uint16Array(N);
    for (let y = 0; y < H; y++) {
      const row = 8 + k * 19 * N + y * 19 * W;
      for (let i = 0; i < W * 8; i++) cost[y * W * 8 + i] = dv.getUint16(row + i * 2, true);
      anchor.set(u8.subarray(row + W * 16, row + W * 17), y * W);
      for (let x = 0; x < W; x++) region[y * W + x] = dv.getUint16(row + W * 17 + x * 2, true);
    }
    return { cost, anchor, region };
  });
  return { W, H, layers };
}

export function writeAiGraph({ W, H, layers }) {
  const N = W * H, out = new Uint8Array(8 + N * 19 * CLASSES), dv = new DataView(out.buffer);
  dv.setUint32(0, W, true); dv.setUint32(4, H, true);
  layers.forEach(({ cost, anchor, region }, k) => {
    for (let y = 0; y < H; y++) {
      const row = 8 + k * 19 * N + y * 19 * W;
      for (let i = 0; i < W * 8; i++) dv.setUint16(row + i * 2, cost[y * W * 8 + i], true);
      out.set(anchor.subarray(y * W, (y + 1) * W), row + W * 16);
      for (let x = 0; x < W; x++) dv.setUint16(row + W * 17 + x * 2, region[y * W + x], true);
    }
  });
  return out;
}

// Connected components over open edges, numbered from 1 in row-major order (as the originals are).
export function computeRegions(gr) {
  const { W, H } = gr, N = W * H;
  for (const L of gr.layers) {
    L.region.fill(0);
    let id = 0;
    for (let s = 0; s < N; s++) {
      if (L.region[s]) continue;
      L.region[s] = ++id;
      const stack = [s];
      while (stack.length) {
        const i = stack.pop(), x = i % W, y = (i / W) | 0;
        for (let d = 0; d < 8; d++) {
          if (L.cost[i * 8 + d] === NONE) continue;
          const j = (y + DIRS[d][1]) * W + x + DIRS[d][0];
          if (!L.region[j]) { L.region[j] = id; stack.push(j); }
        }
      }
    }
  }
}

// ---- building from terrain + objects ----
// [max slope (rise/run along the edge), max water depth m, object clearance m] per AI class,
// fitted on zone1/4/9/15 and bz2g by tools/aigraph-fit.mjs.
export const RULES = [[2, Infinity, -2], [1.4, 0.4, -2], [1.4, 1.3, -2], [1.4, 1.6, -2], [1.4, 2, -2], [1.2, 1.6, -1], [1.2, Infinity, -1], [0.9, Infinity, -1]];

// Horizontal bounding box of a model (readModel output), parts placed through their parent chain.
export function modelBox(model) {
  const off = new Map();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of model.parts) {
    const po = off.get(p.parent.toLowerCase()) || [0, 0], b = p.bon?.[0] || [0, 0, 0], o = [po[0] + b[0], po[1] + b[1]];
    off.set(p.name.toLowerCase(), o);
    if (!p.fig) continue;
    const v = p.fig.variants[0];
    for (let i = 0; i < v.length; i += 3) { x0 = Math.min(x0, v[i] + o[0]); x1 = Math.max(x1, v[i] + o[0]); y0 = Math.min(y0, v[i + 1] + o[1]); y1 = Math.max(y1, v[i + 1] + o[1]); }
  }
  return x1 > x0 ? { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2 } : null;
}

// Placed object -> rotated rectangle in world space. pos from MOB (x, y), rot quaternion (w, x, y, z).
export function objectRect(box, pos, rot = [1, 0, 0, 0]) {
  const [w, , , z] = rot, yaw = Math.atan2(2 * w * z + 2 * rot[1] * rot[2], 1 - 2 * (rot[2] * rot[2] + z * z)), c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: pos[0] + box.cx * c - box.cy * s, y: pos[1] + box.cx * s + box.cy * c, hx: box.hx, hy: box.hy, c, s };
}
const rectDist = (o, x, y) => { const dx = x - o.x, dy = y - o.y, lx = Math.abs(dx * o.c + dy * o.s) - o.hx, ly = Math.abs(-dx * o.s + dy * o.c) - o.hy; return lx > 0 || ly > 0 ? Math.hypot(Math.max(lx, 0), Math.max(ly, 0)) : Math.max(lx, ly); };

// Slope, water depth and object clearance along the edge from node (x, y) in direction d.
export function edgeProbe(map, objectsNear) {
  const zAt = (x, y) => { x = Math.max(0, Math.min(map.W - 1.001, x)); y = Math.max(0, Math.min(map.H - 1.001, y)); const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, Z = (i, j) => map.z[(yi + j) * map.W + xi + i] / 65535 * map.maxZ; return (Z(0, 0) * (1 - fx) + Z(1, 0) * fx) * (1 - fy) + (Z(0, 1) * (1 - fx) + Z(1, 1) * fx) * fy; };
  const depthAt = (x, y) => { const tx = Math.min(map.TW - 1, (x / 2) | 0), ty = Math.min(map.TH - 1, (y / 2) | 0); if (map.waterMat[ty * map.TW + tx] === 0xffff) return 0; const k = Math.min(map.H - 1, Math.round(y)) * map.W + Math.min(map.W - 1, Math.round(x)); return Math.max(0, (map.wz[k] - map.z[k]) / 65535 * map.maxZ); };
  return (x, y, d) => {
    const ax = x * 4 + 2, ay = y * 4 + 2, bx = ax + DIRS[d][0] * 4, by = ay + DIRS[d][1] * 4, len = Math.hypot(bx - ax, by - ay);
    let slope = 0, depth = 0, clear = 99, prev = zAt(ax, ay);
    const near = objectsNear(x, y);
    for (let s = 0; s <= 8; s++) {
      const t = s / 8, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      if (s) { const z = zAt(px, py); slope = Math.max(slope, Math.abs(z - prev) / (len / 8)); prev = z; }
      depth = Math.max(depth, depthAt(px, py));
      for (const o of near) clear = Math.min(clear, rectDist(o, px, py));
    }
    return { slope, depth, clear };
  };
}

// Builds a graph for `map` (MPR) with object rectangles. With `base` (the original graph) only nodes
// for which `dirty(x, y)` is true (plus their neighbours) are rebuilt; everything else is kept as is.
export function buildAiGraph(map, rects, { base = null, dirty = () => true } = {}) {
  const W = map.sx * 8, H = map.sy * 8, N = W * H;
  const partial = !!base && base.W === W && base.H === H;
  const gr = partial
    ? { W, H, layers: base.layers.map(L => ({ cost: L.cost.slice(), anchor: L.anchor.slice(), region: L.region.slice() })) }
    : { W, H, layers: Array.from({ length: CLASSES }, () => ({ cost: new Uint16Array(N * 8).fill(NONE), anchor: new Uint8Array(N).fill(0x33), region: new Uint16Array(N) })) };
  const buckets = new Map();
  for (const o of rects) { const k = Math.floor(o.y / 4) * W + Math.floor(o.x / 4); (buckets.get(k) || buckets.set(k, []).get(k)).push(o); }
  const objectsNear = (x, y) => { const out = []; for (let j = -3; j <= 4; j++) for (let i = -3; i <= 4; i++) for (const o of buckets.get((y + j) * W + x + i) || []) out.push(o); return out; };
  const probe = edgeProbe(map, objectsNear);
  const rebuild = new Uint8Array(N);
  let any = false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!partial || dirty(x, y)) {
    any = true;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (x + i >= 0 && y + j >= 0 && x + i < W && y + j < H) rebuild[(y + j) * W + x + i] = 1;
  }
  if (!any) return gr; // nothing changed: keep the original bytes, regions included
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = y * W + x;
    if (!rebuild[n]) continue;
    for (let d = 0; d < 8; d++) {
      const tx = x + DIRS[d][0], ty = y + DIRS[d][1];
      const e = tx >= 0 && ty >= 0 && tx < W && ty < H ? probe(x, y, d) : null;
      gr.layers.forEach((L, k) => {
        const [ms, md, mc] = RULES[k], open = e && e.slope <= ms && e.depth <= md && e.clear > mc;
        L.cost[n * 8 + d] = open ? Math.floor((k ? 32 : 16) * 4 * (d % 2 ? Math.SQRT2 : 1)) : NONE; // 64/90, 128/181
        L.anchor[n] = 0x33;
      });
    }
  }
  computeRegions(gr);
  return gr;
}
