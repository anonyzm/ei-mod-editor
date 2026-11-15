// Schools of magic for New EI: a school is its number (spells.sdb field 19 SubTypeCode of its spells), the hero skill
// that grows it (perks.pdb table 1) and the perk group that adds to it (perks.pdb table 2: <perk>1, <perk>2, <perk>3).
// The original's eight are in New EI/ei/schools.ini (mirrored below); a mod's in Config/newschools.ini of the game
// folder. A new school gets its own skill and perks: records copied to the END of perks.pdb (the game counts perk
// groups by record number). Shared by mcp.js and the browser's database view; DOM-free.
import { fieldView, textToField } from '../formats/db.js';
import { parseSpellDo } from './newspells.js';

export const NEWSCHOOLS = 'Config/newschools.ini';
// code → [n, skill, perk] — a mirror of New EI/ei/schools.ini (game.exe 0x527EB0)
export const GAME_SCHOOLS = {
  fire: [0, 'elemental', 'fire'], lightning: [1, 'elemental', 'lightning'], acid: [2, 'elemental', 'acid'],
  illusion: [3, 'sense', 'illusion'], divination: [4, 'sense', 'illusion'], enchantments: [5, 'astral', 'enchantments'],
  healing: [6, 'astral', 'enchantments'], domination: [7, 'astral', 'enchantments'],
};
export const PERK_LEVELS = ['Specialist', 'Expert', 'Master'];

// the INI format is the one of newspells.ini
export const parseSchools = text => parseSpellDo(text);

export function formatSchools(all) {
  return ['; New EI: школы магии мода. Школы игры описаны так же в New EI/ei/schools.ini.',
    '; [код школы] n = номер (поле SubTypeCode заклинаний), skill = навык героя (perks.pdb, таблица 1), perk = группа перков (<perk>1…3, таблица 2).',
    ...Object.entries(all).flatMap(([code, d]) => ['', `[${code}]`, ...['n', 'skill', 'perk'].filter(k => d[k] !== undefined && d[k] !== '').map(k => `${k} = ${d[k]}`)])].join('\r\n') + '\r\n';
}

// allSchools merges the original's with a mod's: [{code, n, skill, perk, mod}] by number.
export function allSchools(mod = {}) {
  const out = new Map(Object.entries(GAME_SCHOOLS).map(([code, [n, skill, perk]]) => [code, { code, n, skill, perk, mod: false }]));
  for (const [code, d] of Object.entries(mod)) out.set(code, { ...(out.get(code) || { code }), ...d, n: +(d.n ?? out.get(code)?.n), mod: true });
  return [...out.values()].sort((a, b) => a.n - b.n);
}

// perks.pdb access on a parsed database file {db, data} (src/formats/db.js), by field name
function tables(perks) {
  const t1 = perks.data.tables.find(t => t.id === 1), t2 = perks.data.tables.find(t => t.id === 2);
  if (!t1 || !t2) throw new Error('perks.pdb: нет таблиц навыков и перков');
  return { t1, t2 };
}
function field(perks, t, rec, name) {
  const node = rec.children.find(c => perks.db.headers[t.id]?.[c.id]?.[0]?.name === name);
  if (!node?.data) throw new Error(`perks.pdb: нет поля ${name}`);
  const type = () => fieldView(perks.db.types[t.id][node.id], node.data).type;
  return { get: () => fieldView(perks.db.types[t.id][node.id], node.data).text, set: v => { node.data = textToField(type(), String(v), node.data); } };
}
const codeOf = (perks, t, r) => field(perks, t, r, 'Code').get().toLowerCase();

// checkSchools throws on what New EI would refuse (ei.readSchools): unknown keys, a skill or perks perks.pdb lacks,
// a number taken twice.
export function checkSchools(all, perks) {
  const { t1, t2 } = tables(perks), skills = t1.records.map(r => codeOf(perks, t1, r)), perkCodes = new Set(t2.records.map(r => codeOf(perks, t2, r)));
  const taken = new Map(Object.entries(GAME_SCHOOLS).map(([c, [n]]) => [n, c]));
  for (const [code, d] of Object.entries(all)) {
    const at = `[${code}]`;
    for (const k of Object.keys(d)) if (!['n', 'skill', 'perk'].includes(k)) throw new Error(`${at}: неизвестный ключ ${k} (n, skill, perk)`);
    const isNew = !(code in GAME_SCHOOLS);
    if (isNew && (d.n === undefined || !d.skill || !d.perk)) throw new Error(`${at}: новой школе нужны n, skill и perk`);
    if (d.n !== undefined && !(/^\d+$/.test(String(d.n)) && +d.n <= 255)) throw new Error(`${at}: n — номер 0…255`);
    if (d.skill !== undefined && !skills.includes(String(d.skill).toLowerCase())) throw new Error(`${at}: нет навыка ${d.skill} в perks.pdb`);
    if (d.perk !== undefined && !perkCodes.has(String(d.perk).toLowerCase() + '1')) throw new Error(`${at}: нет перков ${d.perk}1…3 в perks.pdb`);
    if (d.n !== undefined) {
      const was = taken.get(+d.n);
      if (was && was !== code) throw new Error(`${at}: номер ${d.n} уже у школы ${was}`);
      for (const [n, c] of taken) if (c === code) taken.delete(n);
      taken.set(+d.n, code);
    }
  }
}

// addSchool gives a new school its own skill and perk group in perks.pdb: copies of the skill and the three perks of
// school `from` at the end of their tables, named after `name`. Returns the section for newschools.ini.
export function addSchool(perks, mod, { code, name, from = 'fire' }) {
  code = String(code || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(code)) throw new Error('code — латиница, цифры и _');
  const { t1, t2 } = tables(perks), schools = allSchools(mod);
  if (schools.some(s => s.code === code)) throw new Error(`Школа ${code} уже есть`);
  const src = schools.find(s => s.code === String(from).toLowerCase()) || (() => { throw new Error(`Нет школы ${from}, с которой копировать`); })();
  if (t1.records.some(r => codeOf(perks, t1, r) === code)) throw new Error(`Навык ${code} уже есть в perks.pdb`);
  if (t2.records.some(r => /^\D+/.exec(codeOf(perks, t2, r))?.[0] === code)) throw new Error(`Перки ${code}1…3 уже есть в perks.pdb`);
  if (t2.records.length % 3) throw new Error('perks.pdb: число перков не кратно трём — группы сбиты');
  const skillRec = t1.records.find(r => codeOf(perks, t1, r) === src.skill), perkRecs = [1, 2, 3].map(i => t2.records.find(r => codeOf(perks, t2, r) === src.perk + i));
  if (!skillRec || perkRecs.some(r => !r)) throw new Error(`perks.pdb: нет навыка ${src.skill} или перков ${src.perk}1…3`);
  const Name = name || code.replace(/(^|_)(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());
  const skill = structuredClone(skillRec);
  field(perks, t1, skill, 'Name').set(Name);
  field(perks, t1, skill, 'Code').set(code);
  t1.records.push(skill);
  const skillIndex = t1.records.length - 1;
  perkRecs.forEach((r, i) => {
    const c = structuredClone(r);
    field(perks, t2, c, 'Name').set(`${Name} ${PERK_LEVELS[i]}`);
    field(perks, t2, c, 'Code').set(code + (i + 1));
    field(perks, t2, c, 'Perk').set(i ? code + i : 'none');
    field(perks, t2, c, 'Skill').set(code);
    field(perks, t2, c, 'SkillID').set(skillIndex);
    t2.records.push(c);
  });
  const n = Math.max(...schools.map(s => s.n)) + 1;
  return { section: { n, skill: code, perk: code }, skillIndex, group: t2.records.length / 3 - 1 };
}
