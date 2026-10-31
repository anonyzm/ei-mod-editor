// Shared, cached access to the game database from the views.
import { api } from '/app.js';
import { readRes } from '/formats/res.js';
import { parseSchema, dbForFile, readDatabase, fieldView } from '/formats/db.js';

let schemaP, unitsP;

export function schema() {
  const t = n => fetch(`/data/dbschema/${n}.txt`).then(r => r.text());
  return (schemaP ??= Promise.all(['dbfiles', 'dbblocks', 'dbtypes', 'dbheaders'].map(t))
    .then(([dbfiles, dbblocks, dbtypes, dbheaders]) => parseSchema({ dbfiles, dbblocks, dbtypes, dbheaders })));
}

// Monsters + NPCs with the model/texture of their race, and race lookup by model name.
export function units() {
  return (unitsP ??= (async () => {
    const S = await schema();
    const e = readRes(await api.file('Res/database.res')).find(x => x.name === 'units.udb');
    const db = dbForFile(S, 'units.udb'), d = readDatabase(e.data, db);
    const val = (rec, tid, fid) => { const f = rec.children.find(c => c.id === fid); return f?.data ? fieldView(db.types[tid][fid], f.data).text : ''; };
    const raceList = d.tables.find(x => x.id === 2).records.map(r => ({ name: val(r, 2, 0), model: val(r, 2, 30), textures: val(r, 2, 31).split(/[;,]/).map(s => s.trim()).filter(Boolean) }));
    const races = new Map(raceList.map(r => [r.name.toLowerCase(), r]));
    const prototypes = [];
    for (const r of d.tables.find(x => x.id === 3).records) {
      const race = races.get(val(r, 3, 1).toLowerCase()) || {};
      const cx = [5, 6, 7].map(i => +val(r, 3, i));
      prototypes.push({ name: val(r, 3, 0), kind: 'монстр', model: race.model, texture: race.textures?.[0], complection: cx.every(Number.isFinite) ? cx : null });
    }
    for (const r of d.tables.find(x => x.id === 4).records) prototypes.push({ name: val(r, 4, 0), kind: 'НПС' });
    return {
      prototypes: prototypes.filter(u => u.name).sort((a, b) => a.name.localeCompare(b.name)),
      raceByModel: new Map(raceList.filter(r => r.model).map(r => [r.model.toLowerCase(), r])),
    };
  })());
}
