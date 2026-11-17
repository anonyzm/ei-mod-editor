// sanity check of units: side, route, standing in a closed AI cell, same spot, same name.  node audit.mjs gz1mg gz2mg
import { call } from './ei.mjs';
const { decodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
for (const mob of process.argv.slice(2)) {
  const us = (await call('map_objects', { mob, kind: 'unit', limit: 1000 })).objects;
  const p = await call('terrain_passability', { mpr: mob, class: 3 }), im = decodePng(p.img), Hm = im.height / 2;
  const closed = (x, y) => { const i = (Math.round((Hm - y) * 2) * im.width + Math.round(x * 2)) * 4; return im.rgba[i] > 180 && im.rgba[i + 1] < 90; };
  const names = {}, spots = {}, sides = {};
  for (const u of us) {
    const g = await call('map_object_get', { mob, id: u.id }); const n = (g.patrols?.[0]?.points || g.patrol?.points || []).length;
    (sides[g.player ?? g.fields?.player] ||= []).push(u.name);
    (names[u.name] ||= []).push(u.id); (spots[u.pos.slice(0, 2).map(v => Math.round(v)).join(',')] ||= []).push(u.name + (n ? '' : '*'));
    if (closed(u.pos[0], u.pos[1]) && !/Toad|Wisp|Banshee|Bat|Dragon$/.test(u.name)) console.log(mob, 'CLOSED', u.name, u.pos.join(','));
    u.n = n;
  }
  console.log(mob, 'dup names', Object.entries(names).filter(([, v]) => v.length > 1).map(([k, v]) => k + ':' + v));
  console.log(mob, 'same spot (* = no route)', Object.entries(spots).filter(([, v]) => v.length > 1).map(([k, v]) => k + ' ' + v.join('+')).join(' | '));
  console.log(mob, 'sides', Object.entries(sides).map(([k, v]) => k + ':' + v.length + ' ' + v.slice(0, 6).join(',')).join(' | '));
  console.log(mob, 'no route', us.filter(u => !u.n).length, 'of', us.length, us.filter(u => !u.n).map(u => u.name).join(','));
}
