// Three.js helpers for game data: textures (MMP), models (FIG/LNK/BON), terrain (MPR).
// The game is Z-up; we keep its coordinates as-is and set camera.up = +Z.
import * as THREE from 'three';
import { api } from '/app.js';
import { decodeMmp } from '/formats/mmp.js';
import { readModel, figGeometry, blendVariants } from '/formats/fig.js';
import { heightAt, waterHeightAt } from '/formats/mpr.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// ---- textures ----
const texCache = new Map();
export function mmpToTexture(u8, { flipY = false } = {}) {
  const img = decodeMmp(u8);
  const t = new THREE.DataTexture(img.rgba, img.width, img.height, THREE.RGBAFormat);
  t.flipY = flipY; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4; t.needsUpdate = true;
  t.userData.image = img;
  return t;
}
export function gameTexture(name, res = 'Res/textures.res') {
  const key = (res + ':' + name).toLowerCase();
  if (!texCache.has(key)) texCache.set(key, api.resEntry(res, name.toLowerCase().endsWith('.mmp') ? name : name + '.mmp').then(u8 => mmpToTexture(u8)).catch(() => null));
  return texCache.get(key);
}

// ---- models ----
const modelCache = new Map();
export function loadModelData(name) {
  const key = name.toLowerCase();
  if (!modelCache.has(key)) {
    modelCache.set(key, Promise.all([
      api.resEntry('Res/figures.res', key + '.mod'),
      api.resEntry('Res/figures.res', key + '.bon').catch(() => null),
    ]).then(([mod, bon]) => readModel(mod, bon, key)).catch(() => null));
  }
  return modelCache.get(key);
}
// After a model/texture with this name was (re)written to the game files.
export function forgetCached(name) {
  modelCache.delete(name.toLowerCase());
  texCache.delete(('Res/textures.res:' + name).toLowerCase());
}

// Builds a hierarchy of part meshes; returns null if the model is missing.
// `data` (from readModel) and `map` (a texture) let callers preview a model not yet in the game files.
export async function buildModel(name, { texture, complection = [0.5, 0.5, 0.5], material, data, map } = {}) {
  data ||= await loadModelData(name);
  if (!data) return null;
  const tex = map || (texture ? await gameTexture(texture) : null);
  const mat = material || new THREE.MeshLambertMaterial({ map: tex, color: tex ? 0xffffff : 0xb0a890, alphaTest: 0.5, side: THREE.DoubleSide });
  const root = new THREE.Group();
  root.userData.parts = new Map();
  for (const p of data.parts) {
    const node = new THREE.Group();
    node.name = p.name;
    if (p.bon?.length >= 8) node.position.fromArray(blendVariants(p.bon.slice(0, 8).map(v => Float32Array.from(v)), complection));
    else if (p.bon?.length) node.position.fromArray(p.bon[0]);
    if (p.fig) {
      const g = figGeometry(p.fig, complection), geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = p.name;
      node.add(mesh);
    }
    root.userData.parts.set(p.name.toLowerCase(), node);
    (root.userData.parts.get(p.parent.toLowerCase()) || root).add(node);
  }
  root.userData.model = data;
  return root;
}

// Pose a built model with one animation frame (tracks from readAnimations()).
export function poseModel(root, anim, frame) {
  for (const [name, node] of root.userData.parts) {
    const t = anim.tracks.get(name);
    if (!t) continue;
    const r = t.rot[Math.min(frame, t.rot.length - 1)];
    if (r) node.quaternion.set(r[1], r[2], r[3], r[0]);
    const p = t.trans[Math.min(frame, t.trans.length - 1)];
    if (p && name === [...root.userData.parts.keys()][0]) node.position.fromArray(p);
  }
}

// ---- terrain ----
// One quad per grid cell; UVs pick the 48px interior of a 64px tile from the atlas, rotated by tile bits.
export function buildTerrain(map, atlases) {
  const { W, H, TW } = map, cells = (W - 1) * (H - 1);
  const pos = new Float32Array(cells * 4 * 3), nrm = new Float32Array(cells * 4 * 3), uv = new Float32Array(cells * 4 * 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geo, atlases.map(t => new THREE.MeshLambertMaterial({ map: t, color: t ? 0xffffff : 0x667755 })));
  mesh.userData.map = map;
  updateTerrain(mesh, 0, 0, W - 1, H - 1);
  retileTerrain(mesh);
  return mesh;
}

const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
// Refresh positions/normals/uvs for cells touching the vertex rect.
export function updateTerrain(mesh, x0, y0, x1, y1) {
  const map = mesh.userData.map, { W, H, TW } = map;
  const pos = mesh.geometry.attributes.position.array, nrm = mesh.geometry.attributes.normal.array, uv = mesh.geometry.attributes.uv.array;
  const cx0 = Math.max(0, x0 - 1), cy0 = Math.max(0, y0 - 1), cx1 = Math.min(W - 2, x1), cy1 = Math.min(H - 2, y1);
  const vx = new Float32Array(3);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const c = cy * (W - 1) + cx, tile = map.tiles[(cy >> 1) * TW + (cx >> 1)];
    // Atlases are stored upside down: tile rows count from the bottom and each tile is flipped in v.
    // (Picked by measuring colour seams between neighbouring tiles over the whole map.)
    const local = tile & 63, rot = tile >> 14, tu = (local & 7) / 8, tv = (7 - (local >> 3)) / 8;
    for (let k = 0; k < 4; k++) {
      const [ox, oy] = CORNERS[k], x = cx + ox, y = cy + oy, i = y * W + x, o = c * 4 + k;
      vertex(map, i, x, y, vx);
      pos.set(vx, o * 3);
      const n = map.normal[i];
      nrm[o * 3] = (((n >>> 11) & 0x7ff) - 1000) / 1000; nrm[o * 3 + 1] = ((n & 0x7ff) - 1000) / 1000; nrm[o * 3 + 2] = (n >>> 22) / 1000;
      // position inside the 2x2-cell tile, 0..1, flipped, then rotated clockwise around the centre
      let u = ((cx & 1) + ox) / 2, v = 1 - ((cy & 1) + oy) / 2;
      for (let r = 0; r < rot; r++) [u, v] = [v, 1 - u];
      uv[o * 2] = tu + (8 + u * 48) / 512; uv[o * 2 + 1] = tv + (8 + v * 48) / 512;
    }
  }
  for (const a of ['position', 'normal', 'uv']) mesh.geometry.attributes[a].needsUpdate = true;
  mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
}

function vertex(map, i, x, y, out) {
  out[0] = x + map.dx[i] / 254; out[1] = y + map.dy[i] / 254; out[2] = heightAt(map, i);
  return out;
}

// Rebuild index groups (one per atlas texture) after tile painting.
export function retileTerrain(mesh) {
  const map = mesh.userData.map, { W, H, TW } = map;
  const byAtlas = Array.from({ length: Math.max(1, mesh.material.length) }, () => []);
  for (let cy = 0; cy < H - 1; cy++) for (let cx = 0; cx < W - 1; cx++) {
    const a = Math.min(byAtlas.length - 1, (map.tiles[(cy >> 1) * TW + (cx >> 1)] >> 6) & 255), b = (cy * (W - 1) + cx) * 4;
    byAtlas[a].push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const total = byAtlas.reduce((s, l) => s + l.length, 0), idx = new Uint32Array(total);
  mesh.geometry.clearGroups();
  let o = 0;
  byAtlas.forEach((l, a) => { idx.set(l, o); mesh.geometry.addGroup(o, l.length, a); o += l.length; });
  mesh.geometry.setIndex(new THREE.BufferAttribute(idx, 1));
}

// Water: one translucent quad per 2x2 tile that has a water material.
export function buildWater(map) {
  const { W, TW, TH } = map, P = [];
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    if (map.waterMat[ty * TW + tx] === 0xffff) continue;
    const q = [[0, 0], [2, 0], [2, 2], [0, 2]].map(([ox, oy]) => { const x = tx * 2 + ox, y = ty * 2 + oy; return [x, y, waterHeightAt(map, y * W + x)]; });
    P.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x3d6f8f, transparent: true, opacity: 0.55, depthWrite: false }));
}

export async function loadAtlases(map) {
  return Promise.all(Array.from({ length: map.textures }, (_, i) => gameTexture(`${map.name}${String(i).padStart(3, '0')}.mmp`)));
}
