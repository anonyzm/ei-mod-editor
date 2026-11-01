// Three.js helpers for game data: textures (MMP), models (FIG/LNK/BON), terrain (MPR).
// The game is Z-up; we keep its coordinates as-is and set camera.up = +Z.
import * as THREE from 'three';
import { api } from '/app.js';
import { decodeMmp } from '/formats/mmp.js';
import { readModel, readFig, unpackItemUv, figGeometry, blendVariants } from '/formats/fig.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightAt, waterHeightAt } from '/formats/mpr.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// ---- textures ----
const texCache = new Map();
export function mmpToTexture(u8, { flipY = false } = {}) {
  const img = decodeMmp(u8);
  bleedTransparent(img);
  const t = new THREE.DataTexture(img.rgba, img.width, img.height, THREE.RGBAFormat);
  t.flipY = flipY; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4; t.needsUpdate = true;
  t.userData.image = img;
  return t;
}
// Transparent texels of DXT1 cut-outs (leaves) are black; mipmaps would average that black into the
// visible edge and trees turn into dark silhouettes. Copy the nearest opaque colours into them (alpha stays 0).
function bleedTransparent({ rgba, width: w, height: h }) {
  let todo = []; for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] === 0) todo.push(i);
  if (!todo.length || todo.length === w * h) return;
  const done = new Uint8Array(w * h).fill(1); for (const i of todo) done[i] = 0;
  for (let pass = 0; pass < 16 && todo.length; pass++) {
    const next = [], filled = [];
    for (const i of todo) {
      const x = i % w, y = (i / w) | 0; let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = ((y + dy + h) % h) * w + (x + dx + w) % w;
        if (done[j]) { r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++; }
      }
      if (n) { rgba[i * 4] = r / n; rgba[i * 4 + 1] = g / n; rgba[i * 4 + 2] = b / n; filled.push(i); } else next.push(i);
    }
    for (const i of filled) done[i] = 1;
    todo = next;
  }
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
// Item models are single FIG files in figures.res (<name>.fig), not .mod sets.
const figCache = new Map();
export function loadFigModel(name) {
  const key = name.toLowerCase();
  if (!figCache.has(key)) figCache.set(key, api.resEntry('Res/figures.res', key + '.fig').then(u8 => ({ parts: [{ name: key, parent: '', fig: unpackItemUv(key, readFig(u8)), bon: null }] })).catch(() => null));
  return figCache.get(key);
}

// Small picture of a texture (icons) as a data URL, cached.
const urlCache = new Map();
export function textureDataUrl(name) {
  const key = name.toLowerCase();
  if (!urlCache.has(key)) urlCache.set(key, api.resEntry('Res/textures.res', key + '.mmp').then(u8 => {
    const img = decodeMmp(u8), c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
    return c.toDataURL();
  }).catch(() => null));
  return urlCache.get(key);
}

// A small embedded 3D viewer: preview.show(object3d) frames it; preview.dispose() when the view goes away.
export function createPreview(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(devicePixelRatio);
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444033, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, -3, 4); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 500), controls = new OrbitControls(camera, renderer.domElement);
  controls.autoRotate = true; controls.autoRotateSpeed = 3;
  let current = null;
  const ro = new ResizeObserver(() => { const r = container.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); });
  ro.observe(container);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
  return {
    show(obj) {
      if (current) scene.remove(current);
      current = obj;
      if (!obj) return;
      scene.add(obj);
      const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), r = Math.max(0.05, box.getSize(new THREE.Vector3()).length());
      controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(r * 0.7, -r * 1.3, r * 0.6));
    },
    dispose() { ro.disconnect(); renderer.setAnimationLoop(null); renderer.dispose(); },
  };
}

// After a model/texture with this name was (re)written to the game files.
export function forgetCached(name) {
  modelCache.delete(name.toLowerCase());
  texCache.delete(('Res/textures.res:' + name).toLowerCase());
}

// Builds a hierarchy of part meshes; returns null if the model is missing.
// `data` (from readModel) and `map` (a texture) let callers preview a model not yet in the game files.
export async function buildModel(name, { texture, complection = [0.5, 0.5, 0.5], material, data, map } = {}) {
  data ||= await loadModelData(name) || await loadFigModel(name);
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
      // tree crowns store zero normals (the game does not light them); unlit they would render black
      if (g.normal.every(v => v === 0)) geo.computeVertexNormals();
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

// Water and lava: one quad per 2x2 tile with a liquid material, textured with its surface tile, tinted by the
// material colour; opacity is the material alpha and fades out where the liquid gets shallow (shores).
// Self-lit materials (lava) ignore lighting.
export function buildWater(map, atlases = []) {
  const { W, TW, TH } = map, groups = new Map();
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const mat = map.waterMat[ty * TW + tx];
    if (mat === 0xffff || !map.materials[mat]) continue;
    const tile = map.waterTiles[ty * TW + tx], local = tile & 63, rot = tile >> 14, tu = (local & 7) / 8, tv = (7 - (local >> 3)) / 8;
    const key = mat + ':' + ((tile >> 6) & 255);
    if (!groups.has(key)) groups.set(key, { mat, atlas: (tile >> 6) & 255, P: [], UV: [], C: [] });
    const g = groups.get(key), a = map.materials[mat].color[3] ?? 0.6;
    const q = CORNERS.map(([ox, oy]) => {
      const x = tx * 2 + ox * 2, y = ty * 2 + oy * 2, k = y * W + x, depth = waterHeightAt(map, k) - heightAt(map, k);
      let u = ox, v = 1 - oy;
      for (let r = 0; r < rot; r++) [u, v] = [v, 1 - u];
      return { p: [x, y, waterHeightAt(map, k)], uv: [tu + (8 + u * 48) / 512, tv + (8 + v * 48) / 512], c: [1, 1, 1, a * Math.min(1, Math.max(0, depth / 0.7))] };
    });
    for (const i of [0, 1, 2, 0, 2, 3]) { g.P.push(...q[i].p); g.UV.push(...q[i].uv); g.C.push(...q[i].c); }
  }
  const root = new THREE.Group();
  for (const g of groups.values()) {
    const m = map.materials[g.mat], geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.P), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.UV), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.C), 4));
    geo.computeVertexNormals();
    const tint = new THREE.Color().setRGB(...m.color.slice(0, 3), THREE.SRGBColorSpace), map_ = atlases[g.atlas] || null;
    // the tile already carries the colour (lava, water texture); tint only untextured or lightly coloured liquids
    const opts = { map: map_, color: map_ ? new THREE.Color(0xffffff).lerp(tint, 0.35) : tint, vertexColors: true, transparent: true, depthWrite: false };
    root.add(new THREE.Mesh(geo, m.selfIllum > 0 ? new THREE.MeshBasicMaterial(opts) : new THREE.MeshLambertMaterial(opts)));
  }
  return root;
}

export async function loadAtlases(map) {
  return Promise.all(Array.from({ length: map.textures }, (_, i) => gameTexture(`${map.name}${String(i).padStart(3, '0')}.mmp`)));
}
