// Passability painting. game.exe and New EI build the fine AI grid (0.5 m cells) from heights, water,
// objects and the terrain type of each 2 m tile: TileTypes[atlas slot] of the .mp header -> section of
// aiinfo.res/tileDesc.reg, whose CostMul gives the cost (1 road, 2 most ground, 8 water, 50 swamp) and
// closes the cell to every walking class above 70 (game.exe 0x5B8620; flyers, class 0, ignore it).
// The type belongs to an atlas slot (a picture), so a single tile changes type by moving to a copy of its
// picture in a slot of that type: a slot no tile uses, or a new atlas (game.exe loads any count, 0x6C5AA0).
import { readReg, writeReg, T_INT, T_STR } from '../formats/reg.js';
import { mmpInfo, FMT } from '../formats/mmp.js';
import { NIBBLE_COST } from '../formats/aigraph.js';

// game.exe allocates 16 terrain types (0x5B4BD5) but tileDesc.reg defines 0-14; type 15 is ours.
// tools/aimap/main.go adds the same section to its preview while tileDesc.reg lacks it.
export const BLOCK = 15;
export const BLOCK_DESC = [['Name', 'BLOCK'], ['CostMul', 100], ['Speed', 1024], ['StepLook', 100], ['StepSmell', 100], ['StepSound', 100]];

// Brushes: terrain type (null = back to the tile picture's original slot). Other types change step sounds too.
export const PASS_BRUSHES = [
  { key: 'block', type: BLOCK, label: 'Непроходимо', hint: 'тип 15 BLOCK (CostMul 100): закрыто всем, кроме летающих' },
  { key: 'road', type: 7, label: 'Дорога ×1', hint: 'тип «дорога»: самый дешёвый путь, существа предпочитают его' },
  { key: 'hard', type: 6, label: 'Трудно ×8', hint: 'тип «вода» без воды: в 4 раза дороже травы; шаги звучат как по воде' },
  { key: 'swamp', type: 14, label: 'Болото ×50', hint: 'тип «болото»: обходят, если есть путь; звук болота' },
  { key: 'orig', type: null, label: 'Как в оригинале', hint: 'вернуть тайлу тип его картинки' },
];

// Grid cell nibble of one AI class -> RGBA: closed red, road-cheap cyan, then green (grass) to orange (swamp).
export function nibbleColor(n) {
  if (!n) return [215, 30, 30, 165];
  const c = NIBBLE_COST[n];
  if (c <= 1228) return [50, 190, 230, 110];
  const t = Math.min(1, Math.max(0, Math.log(c / 2048) / Math.log(17.5)));
  return t < 0.5 ? [60 + 340 * t, 190, 60, 95] : [230, 190 - 160 * (t - 0.5), 60 - 60 * (t - 0.5), 120];
}

const slotXY = slot => [(slot & 7) * 64, (7 - ((slot >> 3) & 7)) * 64]; // atlases are stored upside down
function slotHash(img, slot) {
  const [x0, y0] = slotXY(slot);
  let h = 0x811c9dc5;
  for (let y = 0; y < 64; y++) for (let i = ((y0 + y) * img.width + x0) * 4, e = i + 256; i < e; i++) h = Math.imul(h ^ img.rgba[i], 0x01000193);
  return h >>> 0;
}

// Slots any tile, water tile or animation uses: never overwritten.
export function usedSlots(map) {
  const used = new Set();
  for (const t of map.tiles) used.add(t & 0x3fff);
  for (const t of map.waterTiles) used.add(t & 0x3fff);
  for (const a of map.animTiles) for (let p = 0; p < Math.max(1, a.phases); p++) used.add(a.tile + p);
  return used;
}

// images[a]: decoded atlas {width, height, rgba} (512x512); a new atlas is pushed here.
export function passPalette(map, images) {
  const hash = [];
  for (let s = 0; s < map.textures * 64; s++) hash.push(images[s >> 6] ? slotHash(images[s >> 6], s) : -1);
  return { images, hash, used: usedSlots(map) };
}

// Gives tile ti (index into map.tiles) terrain type `type` (null: the type of the first slot with its
// picture, the original). Returns {from, to, newAtlas} when a picture was copied (repeat it on the atlas
// files with copyTileBlocks), else null. Caller marks the sector dirty.
export function retypeTile(map, pal, ti, type) {
  const w = map.tiles[ti], s = w & 0x3fff, rot = w & 0xc000, { images, hash, used } = pal;
  const twins = [];
  for (let t = 0; t < hash.length; t++) if (hash[t] === hash[s]) twins.push(t);
  const set = t => { map.tiles[ti] = rot | t; used.add(t); return null; };
  if (type === null) return twins[0] !== s ? set(twins[0]) : null;
  if (map.tileTypes[s] === type) return null;
  const twin = twins.find(t => map.tileTypes[t] === type);
  if (twin !== undefined) return set(twin);
  let to = -1;
  for (let t = map.textures * 64 - 1; t >= 0 && to < 0; t--) if (!used.has(t) && images[t >> 6]) to = t;
  let newAtlas = false;
  if (to < 0) {
    if (map.textures >= 255) throw new Error('Нет свободных тайлов и места для нового атласа');
    const a = map.textures++;
    map.tileCount = map.textures * 64;
    while (map.tileTypes.length < map.tileCount) map.tileTypes.push(0);
    images[a] = { width: images[0].width, height: images[0].height, rgba: new Uint8ClampedArray(images[0].rgba.length) };
    for (let t = a * 64; t < a * 64 + 64; t++) hash.push(-1);
    to = a * 64 + 63; newAtlas = true;
  }
  const [sx, sy] = slotXY(s), [dx, dy] = slotXY(to), si = images[s >> 6], di = images[to >> 6];
  for (let y = 0; y < 64; y++) di.rgba.set(si.rgba.subarray(((sy + y) * si.width + sx) * 4, ((sy + y) * si.width + sx + 64) * 4), ((dy + y) * di.width + dx) * 4);
  hash[to] = hash[s]; map.tileTypes[to] = type;
  set(to);
  return { from: s, to, newAtlas };
}

// Copies the compressed blocks of a 64 px tile between two DXT atlas files of the same size, every mip
// level where the tile is still at least one block (all 5 levels of the game's 512x512 atlases).
export function copyTileBlocks(src, dst, from, to) {
  const a = mmpInfo(src), b = mmpInfo(dst);
  if (![FMT.DXT1, FMT.DXT3].includes(a.format) || a.format !== b.format || a.width !== b.width || a.height !== b.height) throw new Error('Атласы ландшафта не DXT одного размера — копировать тайл не умею');
  const bs = a.format === FMT.DXT1 ? 8 : 16, n = a.width / 8;
  let pa = a.dataOffset, pb = b.dataOffset;
  for (let L = 0; L < Math.min(a.mips, b.mips); L++) {
    const lw = Math.max(1, a.width >> L), lh = Math.max(1, a.height >> L), bpr = Math.max(1, lw >> 2), tb = (n >> L) >> 2;
    if (tb < 1) break;
    const row = (slot, by) => (((7 - ((slot >> 3) & 7)) * tb + by) * bpr + (slot & 7) * tb) * bs;
    for (let by = 0; by < tb; by++) dst.set(src.subarray(pa + row(from, by), pa + row(from, by) + tb * bs), pb + row(to, by));
    const size = bpr * Math.max(1, lh >> 2) * bs;
    pa += size; pb += size;
  }
}

// tileDesc.reg with section 15 added, or null when it is already there.
export function withBlockDesc(regU8) {
  const secs = readReg(regU8);
  if (secs.some(s => s.name === String(BLOCK))) return null;
  secs.push({ name: String(BLOCK), keys: BLOCK_DESC.map(([name, v]) => ({ name, type: typeof v === 'string' ? T_STR : T_INT, array: false, values: [v] })) });
  return writeReg(secs);
}
