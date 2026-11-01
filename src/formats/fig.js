// Models in figures.res: <m>.mod = RES of per-part FIG8 meshes + a LNK entry named <m> (hierarchy),
// <m>.bon = RES of per-part bind offsets (8 morph variants x vec3), <m>.anm = RES of animations,
// each animation a RES of per-part tracks.
// FIG8: "FIG8", u32 vertexBlocks, normalBlocks, uvCount, indexCount, vertexCompCount, morphCompCount,
//   unknown, renderGroup, textureIndex; center[8], min[8], max[8] (vec3), radius[8] (f32);
//   positions: vertexBlocks x {x[8][4], y[8][4], z[8][4]}; normals: normalBlocks x {x[4],y[4],z[4],w[4]};
//   uv[uvCount] (vec2); u16 indices[indexCount]; vertex components {u16 normal, pos, uv}; morph comps {u16, u16}.
// The 8 variants are the corners of the str/dex/height "complection" cube, blended trilinearly.
import { Reader, Writer, cp1251 } from './bytes.js';
import { readRes, writeRes } from './res.js';

export function readFig(u8) {
  const r = new Reader(u8);
  if (u8.length >= 3 && r.str(3) !== 'FIG') return readLegacyFig(u8); // game.exe takes this path for anything not "FIG"
  r.p = 0;
  if (r.str(4) !== 'FIG8') throw new Error('Не FIG8');
  const [vb, nb, uvc, ic, vcc, mcc, , group, tex] = Array.from({ length: 9 }, () => r.u32());
  const bounds = u8.slice(r.p, r.p + 320); r.p += 320;
  // Block of 4 vertices x 8 variants: x[variant][4], then y[variant][4], then z[variant][4].
  const variants = Array.from({ length: 8 }, () => new Float32Array(vb * 4 * 3));
  for (let b = 0; b < vb; b++) for (let axis = 0; axis < 3; axis++) for (let v = 0; v < 8; v++) for (let k = 0; k < 4; k++) variants[v][(b * 4 + k) * 3 + axis] = r.f32();
  const normals = new Float32Array(nb * 4 * 3);
  for (let b = 0; b < nb; b++) {
    const c = [0, 1, 2, 3].map(() => [r.f32(), r.f32(), r.f32(), r.f32()]);
    for (let k = 0; k < 4; k++) normals.set([c[0][k], c[1][k], c[2][k]], (b * 4 + k) * 3);
  }
  const uv = new Float32Array(uvc * 2);
  for (let i = 0; i < uvc * 2; i++) uv[i] = r.f32();
  const indices = new Uint16Array(ic);
  for (let i = 0; i < ic; i++) indices[i] = r.u16();
  const comps = new Uint16Array(vcc * 3);
  for (let i = 0; i < vcc * 3; i++) comps[i] = r.u16();
  const morphs = new Uint16Array(mcc * 2);
  for (let i = 0; i < mcc * 2; i++) morphs[i] = r.u16();
  return { variants, normals, uv, indices, comps, morphs, bounds, group, texture: tex };
}

// Headerless legacy mesh (sky nask0sky, some init*/efcu* items, unmoog, waterfalls), game.exe 0x4F87D0:
// u32 group, texture; bounds for 6 variants (240 bytes); u32 vb + vb blocks {x,y,z}[6][4]; u32 nb + normal
// blocks; u32 uvc + uv; u32 n + n x 52-byte triangles (unused); u32 vcc + comps; u32 mcc + morph pairs;
// u32 ic + u16 indices. The 6 variants map onto the 8 trilinear corners as [v0,v1,v2,v2,v3,v4,v5,v5]
// (dex replaces the str blend). Read-only: writeFig saves it back as FIG8.
function readLegacyFig(u8) {
  const r = new Reader(u8), group = r.u32(), tex = r.u32();
  r.p += 240;
  const count = per => { const n = r.u32(); if (n * per > u8.length - r.p) throw new Error('Меш без FIG8: неверный размер'); return n; };
  const vb = count(288), six = Array.from({ length: 6 }, () => new Float32Array(vb * 12));
  for (let b = 0; b < vb; b++) for (let axis = 0; axis < 3; axis++) for (let v = 0; v < 6; v++) for (let k = 0; k < 4; k++) six[v][(b * 4 + k) * 3 + axis] = r.f32();
  const nb = count(64), normals = new Float32Array(nb * 12);
  for (let b = 0; b < nb; b++) for (let axis = 0; axis < 4; axis++) for (let k = 0; k < 4; k++) { const v = r.f32(); if (axis < 3) normals[(b * 4 + k) * 3 + axis] = v; }
  const uv = new Float32Array(count(8) * 2);
  for (let i = 0; i < uv.length; i++) uv[i] = r.f32();
  const tris = count(52); r.p += tris * 52; // not `r.p += count()`: that reads r.p before count advances it
  const comps = new Uint16Array(count(6) * 3);
  for (let i = 0; i < comps.length; i++) comps[i] = r.u16();
  const mcc = count(4); r.p += mcc * 4;
  const indices = new Uint16Array(count(2));
  for (let i = 0; i < indices.length; i++) indices[i] = r.u16();
  const lim = [nb * 4, vb * 4, uv.length / 2];
  comps.forEach((c, i) => { if (c >= lim[i % 3]) throw new Error('Меш без FIG8: индекс вне диапазона'); });
  const variants = [0, 1, 2, 2, 3, 4, 5, 5].map(v => six[v]);
  return { variants, normals, uv, indices, comps, morphs: null, bounds: null, group, texture: tex, legacy: true };
}

// Inverse of readFig. Missing bounds are computed; missing morph pairs default to identity over
// all position slots (what static game objects use). Positions/normals pad to blocks of 4.
export function writeFig(fig) {
  const vb = Math.ceil(fig.variants[0].length / 12), nb = Math.ceil(fig.normals.length / 12);
  const morphs = fig.morphs || Uint16Array.from({ length: vb * 8 }, (_, i) => i >> 1);
  const w = new Writer(400 + vb * 384 + nb * 64 + fig.uv.length * 4 + fig.indices.length * 2 + fig.comps.length * 2 + morphs.length * 2);
  w.bytes(cp1251.encode('FIG8'));
  for (const v of [vb, nb, fig.uv.length / 2, fig.indices.length, fig.comps.length / 3, morphs.length / 2, 0, fig.group ?? 22, fig.texture ?? 8]) w.u32(v);
  w.bytes(fig.bounds || figBounds(fig.variants));
  const at = (arr, i, axis) => arr[Math.min(i, arr.length / 3 - 1) * 3 + axis]; // pad with the last vertex
  for (let b = 0; b < vb; b++) for (let axis = 0; axis < 3; axis++) for (let v = 0; v < 8; v++) for (let k = 0; k < 4; k++) w.f32(at(fig.variants[v], b * 4 + k, axis));
  for (let b = 0; b < nb; b++) { for (let axis = 0; axis < 3; axis++) for (let k = 0; k < 4; k++) w.f32(at(fig.normals, b * 4 + k, axis)); for (let k = 0; k < 4; k++) w.f32(1); }
  for (const x of fig.uv) w.f32(x);
  for (const x of fig.indices) w.u16(x);
  for (const x of fig.comps) w.u16(x);
  for (const x of morphs) w.u16(x);
  return w.result();
}

// center[8], min[8], max[8], radius[8] — one per morph variant.
function figBounds(variants) {
  const w = new Writer(320), boxes = variants.map(p => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i++) { mn[i % 3] = Math.min(mn[i % 3], p[i]); mx[i % 3] = Math.max(mx[i % 3], p[i]); }
    return { mn, mx };
  });
  for (const { mn, mx } of boxes) for (let a = 0; a < 3; a++) w.f32((mn[a] + mx[a]) / 2);
  for (const { mn } of boxes) for (const v of mn) w.f32(v);
  for (const { mx } of boxes) for (const v of mx) w.f32(v);
  for (const { mn, mx } of boxes) w.f32(Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
  return w.result();
}

// Item models (init*.fig) store packed UVs (from ei_figer): weapons and helms once, small items twice;
// each unpack is u *= 2, v = 2v - 1. Returns the fig with unpacked UVs.
export function unpackItemUv(name, fig) {
  const n = /^init(qu|qi|limt|litr)\d+item/i.test(name) ? 2 : /^init(we[a-z]+\d+weapon|arhl\d+armor)/i.test(name) ? 1 : 0;
  if (!n) return fig;
  const uv = fig.uv.slice();
  for (let k = 0; k < n; k++) for (let i = 0; i < uv.length; i += 2) { uv[i] *= 2; uv[i + 1] = uv[i + 1] * 2 - 1; }
  return { ...fig, uv };
}

// Trilinear blend of the 8 variants; c = [str, dex, height] in 0..1 (MOB "complection").
export function blendVariants(variants, c = [0.5, 0.5, 0.5]) {
  const [s, d, h] = c, out = new Float32Array(variants[0].length);
  const w = [(1 - s) * (1 - d) * (1 - h), s * (1 - d) * (1 - h), (1 - s) * d * (1 - h), s * d * (1 - h),
    (1 - s) * (1 - d) * h, s * (1 - d) * h, (1 - s) * d * h, s * d * h];
  for (let v = 0; v < 8; v++) if (w[v]) for (let i = 0; i < out.length; i++) out[i] += variants[v][i] * w[v];
  return out;
}

// Expand to non-indexed-by-component arrays for rendering.
export function figGeometry(fig, complection) {
  const pos = blendVariants(fig.variants, complection), n = fig.comps.length / 3;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), T = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [ni, pi, ti] = [fig.comps[i * 3], fig.comps[i * 3 + 1], fig.comps[i * 3 + 2]];
    P.set(pos.subarray(pi * 3, pi * 3 + 3), i * 3);
    N.set(fig.normals.subarray(ni * 3, ni * 3 + 3), i * 3);
    T.set(fig.uv.subarray(ti * 2, ti * 2 + 2), i * 2);
  }
  return { position: P, normal: N, uv: T, index: fig.indices };
}

// LNK: u32 n, n x {u32 len, child (NUL-terminated), u32 len, parent}; root has an empty parent.
export function readLnk(u8) {
  const r = new Reader(u8), n = r.u32(), out = [];
  const s = () => { const len = r.u32(); return len ? r.str(len).replace(/\0.*$/, '') : ''; };
  for (let i = 0; i < n; i++) { const name = s(); out.push({ name, parent: s() }); }
  return out;
}
export function writeLnk(links) {
  const w = new Writer(), s = t => { if (!t) return w.u32(0); const b = cp1251.encode(t); w.u32(b.length + 1); w.bytes(b); w.u8_(0); };
  w.u32(links.length);
  for (const l of links) { s(l.name); s(l.parent); }
  return w.result();
}

export function readBon(u8) {
  const r = new Reader(u8);
  return Array.from({ length: Math.floor(u8.length / 12) }, () => [r.f32(), r.f32(), r.f32()]);
}
export function writeBon(vecs) {
  const w = new Writer(vecs.length * 12);
  for (const v of vecs) v.forEach(x => w.f32(x));
  return w.result();
}

// parts: [{name, parent, fig, bon: [x,y,z] offset from the parent}], root first (depth-first order)
// -> { mod, bon } RES blobs to store in figures.res as <name>.mod / <name>.bon.
export function writeModel(name, parts) {
  const mod = writeRes([...parts.map(p => ({ name: p.name, data: writeFig(p.fig) })), { name, data: writeLnk(parts) }]);
  const bon = writeRes(parts.map(p => ({ name: p.name, data: writeBon(Array(8).fill(p.bon || [0, 0, 0])) })));
  return { mod, bon };
}

// Per-part track: rotations (w,x,y,z), translations, optional morph frames.
export function readAnmTrack(u8) {
  const r = new Reader(u8);
  const rot = Array.from({ length: r.u32() }, () => [r.f32(), r.f32(), r.f32(), r.f32()]);
  const trans = Array.from({ length: r.u32() }, () => [r.f32(), r.f32(), r.f32()]);
  const frames = r.u32(), verts = r.u32();
  const morph = Array.from({ length: frames }, () => { const a = new Float32Array(verts * 3); for (let i = 0; i < a.length; i++) a[i] = r.f32(); return a; });
  return { rot, trans, morph };
}

// Whole model: { parts: [{name, parent, fig, bon}] } from the .mod and .bon RES blobs.
export function readModel(modU8, bonU8, name) {
  const files = readRes(modU8);
  // The LNK is named after the model; other entries are FIG8 or legacy headerless meshes.
  const figs = new Map();
  let lnk = files.find(f => f.name.toLowerCase() === name.toLowerCase());
  for (const f of files) if (f !== lnk) {
    if (String.fromCharCode(...f.data.subarray(0, 4)) === 'FIG8') { figs.set(f.name.toLowerCase(), readFig(f.data)); continue; }
    try { figs.set(f.name.toLowerCase(), readLegacyFig(f.data)); } catch { lnk ??= f; }
  }
  const links = lnk ? readLnk(lnk.data) : files.map(f => ({ name: f.name, parent: '' }));
  const bons = new Map(bonU8 ? readRes(bonU8).map(f => [f.name.toLowerCase(), readBon(f.data)]) : []);
  const parts = links.map(l => ({ name: l.name, parent: l.parent, fig: figs.get(l.name.toLowerCase()) || null, bon: bons.get(l.name.toLowerCase()) || null }));
  return { parts };
}

export function readAnimations(anmU8) {
  return readRes(anmU8).map(a => ({ name: a.name, tracks: new Map(readRes(a.data).map(t => [t.name.toLowerCase(), readAnmTrack(t.data)])) }));
}
