// 2026-11-17: routes written by the editor before the patrol model was fixed (all "waypoints" as looks of one block — the
// creature stood still) are rewritten as real routes: one block per point.  node patrol_fix.mjs gz1mg gz2mg gz3mg bz1mg
import fs from 'node:fs';
import { call } from './ei.mjs';
const M = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/formats/mob.js');
for (const mob of process.argv.slice(2)) {
  const m = M.readMob(new Uint8Array(fs.readFileSync(`C:/GOG Games/EI_edit/Evil Islands/Maps/${mob}.mob`))); let n = 0, cyc = 0;
  for (const o of M.listObjects(m)) { if (o.kind !== 0xbbbb0000) continue; const old = M.legacyRoute(o.node); if (!old) continue;
    const logic = o.node.children.find(c => c.id === 0xbbbc0000); if (logic.children.some(c => c.id === 0xbbbc0002)) cyc++;
    await call('map_patrol_set', { mob, id: M.getField(o.node, M.OBJ.id), cyclic: old.length > 2, points: old.map(l => ({ pos: l.pos.slice(0, 2), wait: l.wait })) }); n++; }
  console.log(mob, 'routes rewritten:', n, 'with a cyclic flag:', cyc);
}
