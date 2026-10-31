// Wavefront OBJ -> game model parts (for fig.js writeModel). Every `o`/`g` group becomes a part,
// attached to the first one. Static mesh: all 8 morph variants are the same geometry.
// shortcut: no skinning/animation import — characters still need ei_figer (Blender); add when needed.

// Part names live in RES/LNK; keep them short ASCII so the engine and old tools are happy.
const partName = (s, used) => {
  let base = (s || 'part').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'part', n = base, i = 1;
  while (used.has(n)) n = `${base}${i++}`;
  used.add(n);
  return n;
};

export function objToParts(text, { scale = 1, yUp = true, toGround = true } = {}) {
  const V = [], VT = [], VN = [], groups = [];
  let cur = null;
  const tf = (x, y, z) => (yUp ? [x, -z, y] : [x, y, z]).map(v => v * scale); // Y-up -> game Z-up (a rotation, keeps winding)
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/), k = t[0];
    if (k === 'v') V.push(tf(+t[1], +t[2], +t[3]));
    else if (k === 'vt') VT.push([+t[1], 1 - (+t[2] || 0)]); // OBJ v grows up, game textures go top-down
    else if (k === 'vn') VN.push(tf(+t[1], +t[2], +t[3]).map(v => v / scale));
    else if (k === 'o' || k === 'g') { cur = { name: t.slice(1).join(' '), faces: [] }; groups.push(cur); }
    else if (k === 'f') {
      if (!cur) { cur = { name: 'body', faces: [] }; groups.push(cur); }
      const idx = (s, n, len) => { const v = parseInt(s.split('/')[n], 10); return Number.isNaN(v) ? -1 : v < 0 ? len + v : v - 1; };
      const corners = t.slice(1).map(s => [idx(s, 0, V.length), idx(s, 1, VT.length), idx(s, 2, VN.length)]);
      for (let i = 1; i + 1 < corners.length; i++) cur.faces.push([corners[0], corners[i], corners[i + 1]]); // fan
    }
  }
  const used = groups.filter(g => g.faces.length);
  if (!used.length) throw new Error('В OBJ-файле нет граней (f)');
  for (const g of used) for (const f of g.faces) for (const c of f) if (!(c[0] >= 0 && c[0] < V.length)) throw new Error('OBJ ссылается на несуществующую вершину');

  const lift = toGround ? -Math.min(...used.flatMap(g => g.faces.flat().map(c => V[c[0]][2]))) : 0;
  const names = new Set();
  const parts = used.map((g, gi) => {
    const posOf = new Map(), pos = [], uvOf = new Map(), uv = [], nrmOf = new Map(), nrm = [], compOf = new Map(), comps = [], indices = [];
    const id = (map, list, key, val) => { if (!map.has(key)) { map.set(key, list.length); list.push(val); } return map.get(key); };
    // Without OBJ normals: smooth normal per position, accumulated from face normals.
    const smooth = new Map();
    if (!VN.length) for (const f of g.faces) {
      const [a, b, c] = f.map(x => V[x[0]]), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (const x of f) { const s = smooth.get(x[0]) || [0, 0, 0]; smooth.set(x[0], [s[0] + n[0], s[1] + n[1], s[2] + n[2]]); }
    }
    for (const f of g.faces) for (const [vi, ti, ni] of f) {
      const p = id(posOf, pos, vi, [V[vi][0], V[vi][1], V[vi][2] + lift]);
      const t = id(uvOf, uv, ti, ti >= 0 && VT[ti] ? VT[ti] : [0, 0]);
      const nv = ni >= 0 && VN[ni] ? VN[ni] : smooth.get(vi) || [0, 0, 1], l = Math.hypot(...nv) || 1;
      const n = id(nrmOf, nrm, ni >= 0 ? 'n' + ni : 'p' + vi, nv.map(x => x / l));
      indices.push(id(compOf, comps, `${n}/${p}/${t}`, [n, p, t]));
    }
    if (comps.length > 65535 || pos.length > 65535) throw new Error(`Часть «${g.name}» слишком большая: больше 65535 вершин`);
    const P = Float32Array.from(pos.flat());
    return {
      name: partName(g.name, names), parent: gi ? null : '',
      fig: { variants: Array(8).fill(P), normals: Float32Array.from(nrm.flat()), uv: Float32Array.from(uv.flat()), indices: Uint16Array.from(indices), comps: Uint16Array.from(comps.flat()) },
    };
  });
  for (const p of parts.slice(1)) p.parent = parts[0].name;
  return parts;
}
