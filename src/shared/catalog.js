// Placing anything on any map, even an empty new one: a template chunk per object kind and the
// catalog of every distinct static object (prototype + model + texture) on the game's zone maps.
// No DOM here: used by the map editor (browser) and can be used by mcp.js (Node).
import * as M from '../formats/mob.js';

// readFile(rel) -> Promise<Uint8Array> of a game file; mobFiles: names in Maps/.
export async function gameCatalog(readFile, mobFiles) {
  const templates = new Map(), objects = new Map(), units = new Map();
  for (const f of mobFiles.filter(f => /^zone\d.*\.mob$/i.test(f) && !/-lmp/i.test(f))) {
    for (const o of M.listObjects(M.readMob(await readFile('Maps/' + f)))) {
      if (!templates.has(o.kind)) templates.set(o.kind, M.cloneChunk(o.node));
      if (o.kind === 0xbbbb0000) for (const k of [M.getField(o.node, M.UNIT.unitPrototype), 'model:' + M.getField(o.node, M.OBJ.model)])
        if (k && !units.has(k.toLowerCase())) units.set(k.toLowerCase(), M.cloneChunk(o.node));
      if (o.kind !== 0xb001) continue;
      const proto = M.getField(o.node, M.OBJ.prototype) || '', model = M.getField(o.node, M.OBJ.model) || '', texture = M.getField(o.node, M.OBJ.texture) || '';
      const k = `${proto}|${model}|${texture}`.toLowerCase();
      if (objects.has(k)) objects.get(k).count++; else if (model) objects.set(k, { proto: proto || model, model, texture, count: 1 });
    }
  }
  return { templates, units, objects: [...objects.values()].sort((a, b) => a.proto.localeCompare(b.proto)) };
}

// Template chunk for a new creature: an original one of the same prototype, else of the same model, else any.
// A foreign template leaks its body parts (b00d), second texture and stats — humans then render checkered.
export function unitTemplate({ templates, units }, unit) {
  return units.get(unit.name.toLowerCase()) || units.get('model:' + (unit.model || '').toLowerCase()) || templates.get(0xbbbb0000);
}

// Map texture for a creature of a race: the race's texture list is stored with binary separators
// (\x01\x12Dragon00\x00…); humans and orcs (unhu*, unor*) always use "default0" on the original maps,
// their look comes from the armour.
export function raceTexture(model, list) {
  return /^un(hu|or)/i.test(model || '') ? 'default0' : String(list || '').split(/[;,\x00-\x1f]/).map(s => s.trim()).find(Boolean);
}

// Turn a cloned creature chunk into `unit` ({name, model?, texture?, complection?} from the database).
// pos: [x, y, height above ground].
export function setupUnit(chunk, unit, id, pos) {
  M.setField(chunk, M.OBJ.id, id);
  M.setField(chunk, M.UNIT.unitPrototype, unit.name); M.setField(chunk, M.OBJ.prototype, unit.name);
  M.setField(chunk, M.OBJ.name, `${unit.name}-${id}`);
  if (unit.model) M.setField(chunk, M.OBJ.model, unit.model);
  if (unit.texture) M.setField(chunk, M.OBJ.texture, unit.texture);
  if (unit.complection) M.setField(chunk, M.OBJ.complection, unit.complection);
  M.setField(chunk, M.OBJ.pos, pos);
  // a fresh creature starts without the template's patrol route
  for (const logic of chunk.children.filter(x => x.id === 0xbbbc0000)) logic.children = logic.children.filter(x => x.id !== 0xbbbd0000);
  return unitStandsHome(chunk);
}

// A creature without a patrol route: behaviour mode bbbc0003 = 1 and home point bbbc0005 = its position, as
// all 757 route-less creatures of the original maps. Mode 2 (patrol) without waypoints stops the game with
// "Unit N has no patrol points, switching to guard". Units with a route are left alone.
export function unitStandsHome(chunk) {
  for (const logic of chunk.children.filter(x => x.id === 0xbbbc0000)) {
    if (logic.children.some(x => x.id === 0xbbbd0000)) continue;
    M.setField(logic, [0xbbbc0003, 'u32'], 1);
    M.setField(logic, [0xbbbc0005, 'vec3'], M.getField(chunk, M.OBJ.pos));
  }
  return chunk;
}

// Turn a cloned static-object chunk into `obj` ({proto, model, texture} from the catalog or the user).
export function setupObject(chunk, obj, id, pos) {
  M.setField(chunk, M.OBJ.id, id);
  M.setField(chunk, M.OBJ.prototype, obj.proto); M.setField(chunk, M.OBJ.name, `${obj.proto}-${id}`);
  M.setField(chunk, M.OBJ.model, obj.model); M.setField(chunk, M.OBJ.texture, obj.texture);
  M.setField(chunk, M.OBJ.pos, pos); M.setField(chunk, M.OBJ.rot, [1, 0, 0, 0]);
  return chunk;
}
