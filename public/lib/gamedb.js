// Shared, cached access to game data from the views: database schema, unit prototypes,
// human-readable names (texts.res), icons and 3D models of database records.
import { api } from '/app.js';
import { readRes } from '/formats/res.js';
import { cp1251 } from '/formats/bytes.js';
import { parseSchema, dbForFile, readDatabase, fieldView } from '/formats/db.js';

let schemaP, unitsP, textsP, texListP;

export function schema() {
  const t = n => fetch(`/data/dbschema/${n}.txt`).then(r => r.text());
  return (schemaP ??= Promise.all(['dbfiles', 'dbblocks', 'dbtypes', 'dbheaders'].map(t))
    .then(([dbfiles, dbblocks, dbtypes, dbheaders]) => parseSchema({ dbfiles, dbblocks, dbtypes, dbheaders })));
}

// ---- names from texts.res: keys are "<category> <name>", e.g. "UNIT Human_Kania_NPC_Captain_F14" ----
export const normKey = s => String(s).toLowerCase().trim().replace(/[\s_]+/g, '_');
export function texts() {
  return (textsP ??= api.file('Res/texts.res').then(u8 => {
    const map = new Map();
    for (const e of readRes(u8)) {
      const [cat, ...rest] = e.name.split(' '), lines = cp1251.decode(e.data).split(/\r?\n/);
      map.set(normKey(cat) + ' ' + normKey(rest.join(' ')), { title: lines[0].trim(), desc: lines.slice(1).join('\n').trim() });
    }
    const keys = [...map.keys()];
    // exact "<cat> <name>", else the first "<cat> <name> <variant>" (weapons/armor carry a material suffix)
    const title = (cats, name) => {
      if (!name) return null;
      for (const c of [cats].flat()) {
        const k = c + ' ' + normKey(name);
        if (map.has(k)) return map.get(k).title;
        const v = keys.find(x => x.startsWith(k + ' '));
        if (v) return map.get(v).title;
      }
      return null;
    };
    return { map, title };
  }));
}

export function textureList() {
  return (texListP ??= api.resList('Res/textures.res').then(l => l.map(e => e.name.replace(/\.mmp$/i, '').toLowerCase())));
}

// Monsters + NPCs with the model/texture of their race, and race lookup by model name.
export function units() {
  return (unitsP ??= (async () => {
    const [S, T] = await Promise.all([schema(), texts()]);
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
    const byName = new Map(prototypes.map(p => [p.name.toLowerCase(), p]));
    for (const r of d.tables.find(x => x.id === 4).records) { const n = val(r, 4, 0), m = byName.get(n.toLowerCase()); prototypes.push({ ...m, name: n, kind: 'НПС' }); }
    for (const p of prototypes) p.title = T.title('unit', p.name);
    return {
      prototypes: prototypes.filter(u => u.name).sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name)),
      raceByModel: new Map(raceList.filter(r => r.model).map(r => [r.model.toLowerCase(), r])),
      byName: new Map(prototypes.map(p => [p.name.toLowerCase(), p])),
    };
  })());
}

// ---- database records: name, icon, 3D model ----
// [text categories, field with the key] per "<db>:<table id>"
const TITLE = {
  'Items:1': [['material'], 0], 'Items:2': [['instr', 'weapon'], 0], 'Items:3': [['instr', 'armor'], 0], 'Items:4': [['qitem'], 0],
  'Items:5': [['questitem'], 0], 'Items:6': [['litem'], 0], 'Units:3': [['unit'], 0], 'Units:4': [['unit'], 0],
  'Spells:1': [['spell'], 1], 'Spells:2': [['modifier'], 1], 'Spells:3': [['spell'], 1], 'Spells:4': [['spell'], 1], 'Spells:5': [['spell'], 1],
  'Perks:1': [['perk'], 1], 'Perks:2': [['perk'], 1], 'Quests:1': [['quest'], 0], 'Quests:2': [['briefing'], 0],
};
const WEAPON = { axe: 'ax', sword: 'sw', dagger: 'dg', spear: 'sp', hammer: 'hm', bow: 'bw', crossbow: 'cb' };
const ARMOR = { shirt: 'sh', pants: 'pt', boots: 'bt', gloves: 'gl', helm: 'hl', plate: 'pl', leggings: 'lg' };
const pad = (n, w) => String(n).padStart(w, '0');

// val(fieldId) -> text of the record's field. Returns { title, icon?, model? } where
// model = { name, fig: true for single-FIG item models, texture?, complection? }.
export async function recordInfo(db, tableId, val) {
  const [T, tex] = await Promise.all([texts(), textureList()]);
  const rule = TITLE[`${db.name}:${tableId}`];
  const out = { title: rule ? T.title(rule[0], val(rule[1])) || (rule[1] ? T.title(rule[0], val(0)) : null) : null };
  const firstTex = prefix => tex.find(t => t.startsWith(prefix));
  const tti = val(5), item = (model, texture, icon) => Object.assign(out, { model: { name: model, fig: true, texture }, icon });
  const key = `${db.name}:${tableId}`;
  if (key === 'Items:2' && WEAPON[val(1)]) { const c = WEAPON[val(1)]; item(`initwe${c}${tti}weapon`, `${c}_${pad(tti, 2)}.0`); }
  else if (key === 'Items:3' && ARMOR[val(1)]) { const c = ARMOR[val(1)]; item(`initar${c}${tti}armor`, firstTex(`${c}_${pad(tti, 2)}.`)); }
  else if (key === 'Items:1') { const t = 'material' + pad(val(3), 4); item(`initlimt${val(3)}item`, t, t); }
  else if (key === 'Items:4') { const t = firstTex('qitem' + pad(tti, 3)); item(`initqi${tti}item`, t, t); }
  else if (key === 'Items:5') { const t = firstTex('quitem' + pad(tti, 3) + (val(6) > 0 ? val(6) : '0')) || firstTex('quitem' + pad(tti, 3)); item(`initqu${tti}item`, t, t); }
  else if (key === 'Items:6') { const t = firstTex('litem' + pad(tti, 3)); item(`initlitr${tti}item`, t, t); }
  else if (key === 'Spells:1') out.icon = firstTex('spell' + pad(val(18), 4));
  else if (key === 'Units:3' || key === 'Units:4') { const p = (await units()).byName.get(val(0).toLowerCase()); if (p?.model) out.model = { name: p.model, texture: p.texture, complection: p.complection }; }
  else if (key === 'Units:2' && val(30)) out.model = { name: val(30), texture: val(31).split(/[;,]/)[0].trim() };
  if (out.icon && !tex.includes(out.icon)) out.icon = null;
  return out;
}

// ---- zones (map.txt blocks from zones.js parseWorld) ----
// Game zones and bases have names in texts.res; a transition is named by the zones it connects.
export async function zoneTitles(blocks) {
  const T = await texts(), names = new Map();
  for (const b of blocks) { const t = T.title('zone', b.id); if (t) names.set(b.id, t); }
  const named = new Map(names); // only real zones, so transitions never chain other transitions' ids
  for (const b of blocks) {
    if (names.has(b.id)) continue;
    const ends = [...new Set([...b.text.matchAll(/^#exit\s+\d+\s*\r?\n\s*(\S+)/gmi)].map(m => named.get(m[1])).filter(Boolean))];
    names.set(b.id, ends.length ? ends.join(' → ') : b.id);
  }
  return names;
}
