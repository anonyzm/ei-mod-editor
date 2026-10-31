// MPR landscape: a RES with <name>.mp (header) and <name>XXXYYY.sec (one per 32x32-cell sector).
// .mp: u32 0xCE4AF672, f32 maxZ, u32 sectorsX, sectorsY, textures, textureSize, tiles, tileSize,
//      u16 materials, u32 animTiles; material[44 bytes]; u32 tileType[tiles]; {u16 tile, u16 phases}[anim].
// .sec: u32 0xCF4BF774, u8 type (0 land, 3 land+water), 33x33 vertices {s8 dx, s8 dy, u16 z, u32 normal},
//      [33x33 water vertices], 16x16 u16 land tiles, [16x16 water tiles, 16x16 u16 water material].
// Tile u16: bits 0-5 tile in atlas, 6-13 atlas (texture) index, 14-15 rotation x90.
import { Reader, Writer } from './bytes.js';
import { readRes, writeRes } from './res.js';

export const MP_MAGIC = 0xce4af672, SEC_MAGIC = 0xcf4bf774;
export const TILE_TYPES = ['трава', 'земля', 'камень', 'песок', 'скала', 'поле', 'вода', 'дорога', 'пусто', 'снег', 'лёд', 'сухая трава', 'сугробы', 'лава', 'болото', 'высокая скала'];
export const MATERIAL_TYPES = ['не задан', 'земля', 'вода без текстуры', 'вода', 'трава'];

export function readMpr(u8) {
  const entries = readRes(u8);
  const mpEntry = entries.find(e => /\.mp$/i.test(e.name));
  if (!mpEntry) throw new Error('В MPR нет заголовка .mp');
  const base = mpEntry.name.replace(/\.mp$/i, '');
  const r = new Reader(mpEntry.data);
  if (r.u32() !== MP_MAGIC) throw new Error('Неверная сигнатура .mp');
  const h = { maxZ: r.f32(), sx: r.u32(), sy: r.u32(), textures: r.u32(), textureSize: r.u32(), tileCount: r.u32(), tileSize: r.u32() };
  const nMat = r.u16(), nAnim = r.u32();
  const materials = Array.from({ length: nMat }, () => ({ type: r.u32(), color: [r.f32(), r.f32(), r.f32(), r.f32()], selfIllum: r.f32(), wave: r.f32(), warp: r.f32(), reserved: [r.f32(), r.f32(), r.f32()] }));
  const tileTypes = Array.from({ length: h.tileCount }, () => r.u32());
  const animTiles = Array.from({ length: nAnim }, () => ({ tile: r.u16(), phases: r.u16() }));

  const W = h.sx * 32 + 1, H = h.sy * 32 + 1, TW = h.sx * 16, TH = h.sy * 16;
  const map = {
    name: base, ...h, materials, tileTypes, animTiles, W, H, TW, TH,
    z: new Uint16Array(W * H), dx: new Int8Array(W * H), dy: new Int8Array(W * H), normal: new Uint32Array(W * H),
    wz: new Uint16Array(W * H), wdx: new Int8Array(W * H), wdy: new Int8Array(W * H), wnormal: new Uint32Array(W * H),
    tiles: new Uint16Array(TW * TH), waterTiles: new Uint16Array(TW * TH), waterMat: new Uint16Array(TW * TH).fill(0xffff),
    secWater: new Uint8Array(h.sx * h.sy), // original per-sector water flag, kept on save
    secRaw: new Map(), dirty: new Set(), // untouched sectors are written back byte-for-byte
    extra: entries.filter(e => e !== mpEntry && !/\.sec$/i.test(e.name)),
  };
  const secs = new Map(entries.filter(e => /\.sec$/i.test(e.name)).map(e => [e.name.slice(-10, -4), e.data]));
  for (let x = 0; x < h.sx; x++) for (let y = 0; y < h.sy; y++) {
    const d = secs.get(String(x).padStart(3, '0') + String(y).padStart(3, '0'));
    if (!d) continue;
    map.secRaw.set(y * h.sx + x, d);
    const s = new Reader(d);
    s.u32();
    const water = s.u8_();
    map.secWater[y * h.sx + x] = water;
    const verts = (z, dx, dy, nn) => {
      for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++) {
        const k = (y * 32 + j) * W + x * 32 + i;
        dx[k] = s.i8(); dy[k] = s.i8(); z[k] = s.u16(); nn[k] = s.u32();
      }
    };
    const tiles = arr => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) arr[(y * 16 + j) * TW + x * 16 + i] = s.u16(); };
    verts(map.z, map.dx, map.dy, map.normal);
    if (water) verts(map.wz, map.wdx, map.wdy, map.wnormal);
    tiles(map.tiles);
    if (water) { tiles(map.waterTiles); tiles(map.waterMat); }
  }
  return map;
}

export function writeMpr(map) {
  const mp = new Writer();
  mp.u32(MP_MAGIC); mp.f32(map.maxZ); mp.u32(map.sx); mp.u32(map.sy);
  mp.u32(map.textures); mp.u32(map.textureSize); mp.u32(map.tileCount); mp.u32(map.tileSize);
  mp.u16(map.materials.length); mp.u32(map.animTiles.length);
  for (const m of map.materials) { mp.u32(m.type); m.color.forEach(v => mp.f32(v)); mp.f32(m.selfIllum); mp.f32(m.wave); mp.f32(m.warp); m.reserved.forEach(v => mp.f32(v)); }
  for (let i = 0; i < map.tileCount; i++) mp.u32(map.tileTypes[i] ?? 0);
  for (const a of map.animTiles) { mp.u16(a.tile); mp.u16(a.phases); }
  const entries = [{ name: map.name + '.mp', data: mp.result() }];
  const { W, TW } = map;
  for (let x = 0; x < map.sx; x++) for (let y = 0; y < map.sy; y++) {
    const secName = `${map.name}${String(x).padStart(3, '0')}${String(y).padStart(3, '0')}.sec`;
    const raw = map.secRaw?.get(y * map.sx + x);
    if (raw && !map.dirty?.has(y * map.sx + x)) { entries.push({ name: secName, data: raw }); continue; }
    let water = map.secWater?.[y * map.sx + x] || 0;
    for (let j = 0; j < 16 && !water; j++) for (let i = 0; i < 16; i++) if (map.waterMat[(y * 16 + j) * TW + x * 16 + i] !== 0xffff) { water = 3; break; }
    const s = new Writer(water ? 22000 : 11000);
    s.u32(SEC_MAGIC); s.u8_(water);
    const verts = (z, dx, dy, nn) => {
      for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++) {
        const k = (y * 32 + j) * W + x * 32 + i;
        s.u8_(dx[k] & 255); s.u8_(dy[k] & 255); s.u16(z[k]); s.u32(nn[k]);
      }
    };
    const tiles = arr => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) s.u16(arr[(y * 16 + j) * TW + x * 16 + i]); };
    verts(map.z, map.dx, map.dy, map.normal);
    if (water) verts(map.wz, map.wdx, map.wdy, map.wnormal);
    tiles(map.tiles);
    if (water) { tiles(map.waterTiles); tiles(map.waterMat); }
    entries.push({ name: secName, data: s.result() });
  }
  return writeRes([...entries, ...map.extra]);
}

// Call after editing vertices/tiles in a vertex-coordinate rectangle (inclusive).
export function markDirty(map, x0, y0, x1, y1) {
  for (let sy = Math.max(0, Math.floor((y0 - 1) / 32)); sy <= Math.min(map.sy - 1, Math.floor((y1 + 1) / 32)); sy++)
    for (let sx = Math.max(0, Math.floor((x0 - 1) / 32)); sx <= Math.min(map.sx - 1, Math.floor((x1 + 1) / 32)); sx++) map.dirty.add(sy * map.sx + sx);
}

// World coordinates: 1 unit per grid cell, z in the same units.
export const heightAt = (map, k) => map.z[k] / 65535 * map.maxZ;
export const waterHeightAt = (map, k) => map.wz[k] / 65535 * map.maxZ;

export function packNormal(x, y, z) {
  const f = v => Math.floor(v * 1000 + 1e-3);
  return ((f(Math.max(0, Math.min(1, z))) << 22) | (f(Math.max(-1, Math.min(1, x)) + 1) << 11) | f(Math.max(-1, Math.min(1, y)) + 1)) >>> 0;
}

// Recompute normals in a vertex rectangle (after sculpting).
export function updateNormals(map, x0 = 0, y0 = 0, x1 = map.W - 1, y1 = map.H - 1) {
  const { W, H } = map, s = map.maxZ / 65535;
  const hz = (x, y) => map.z[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))] * s;
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
    const nx = hz(x - 1, y) - hz(x + 1, y), ny = hz(x, y - 1) - hz(x, y + 1), nz = 2;
    const l = Math.hypot(nx, ny, nz);
    map.normal[y * W + x] = packNormal(nx / l, ny / l, nz / l);
  }
  markDirty(map, x0, y0, x1, y1);
}

// Blank landscape for a new island/zone.
export function newMpr(name, sx, sy, { textures = 1, height = 0.1, maxZ = 50 } = {}) {
  const W = sx * 32 + 1, H = sy * 32 + 1, TW = sx * 16, TH = sy * 16;
  const map = {
    name, maxZ, sx, sy, textures, textureSize: 512, tileCount: textures * 64, tileSize: 64,
    materials: [{ type: 3, color: [0.2, 0.35, 0.5, 0.6], selfIllum: 0, wave: 0.5, warp: 0.2, reserved: [0, 0, 0] }],
    tileTypes: new Array(textures * 64).fill(0), animTiles: [], W, H, TW, TH,
    z: new Uint16Array(W * H).fill(Math.round(height * 65535)), dx: new Int8Array(W * H), dy: new Int8Array(W * H), normal: new Uint32Array(W * H),
    wz: new Uint16Array(W * H), wdx: new Int8Array(W * H), wdy: new Int8Array(W * H), wnormal: new Uint32Array(W * H),
    tiles: new Uint16Array(TW * TH), waterTiles: new Uint16Array(TW * TH), waterMat: new Uint16Array(TW * TH).fill(0xffff), secWater: new Uint8Array(sx * sy), secRaw: new Map(), dirty: new Set(), extra: [],
  };
  updateNormals(map);
  return map;
}
