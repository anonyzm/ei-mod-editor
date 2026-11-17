// which static objects live on which island (original maps only)
import { call } from './ei.mjs';
import fs from 'node:fs';
const zl = (await Promise.all(['gipat', 'ingos', 'suslanger'].map(a => call('zones_list', { allod: a })))).flat();
const isl = {}; for (const z of zl) if (z.type !== 'edge' && z.res) { const mob = z.res.split(/\s+/)[1]; if (!/mg$/.test(z.id)) isl[mob] = z.allod; }
const use = {};
for (const [mob, a] of Object.entries(isl)) {
  let r; try { r = await call('map_objects', { mob, limit: 100000 }); } catch { continue; }
  for (const o of r.objects) if (o.kind !== 'unit') { const k = o.prototype; (use[k] ||= { gipat: 0, ingos: 0, suslanger: 0, zones: new Set() })[a]++; use[k].zones.add(mob); }
}
const out = Object.entries(use).map(([k, v]) => ({ proto: k, gipat: v.gipat, ingos: v.ingos, suslanger: v.suslanger, zones: [...v.zones].slice(0, 6).join(',') }));
fs.writeFileSync('origin.json', JSON.stringify(out, null, 0));
console.log(out.filter(o => o.gipat).sort((a, b) => b.gipat - a.gipat).map(o => `${o.proto}:${o.gipat}[${o.zones}]`).join('  '));
