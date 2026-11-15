// Config/newspells.ini of New EI: a mod's spells — new ones and changes to the original's. New EI has no spell in its
// code: the original's are data too (New EI/ei/spells.ini, same keys). One [section] per Code of spells.sdb; the
// rules mirror New EI's ei.applyDefs, so a file written here always loads. Shared by mcp.js and the browser's
// database view; text in and out (cp1251 is the caller's).
export const NEWSPELLS = 'Config/newspells.ini';
export const GAME_SPELLS = 42; // records of the original's spells.sdb; past them a mod's
export const DAMAGE = ['piercing', 'slashing', 'bludgeoning', 'fire', 'acid', 'lightning', 'general'];
// how a spell gets to its targets — the means New EI has (engine/cast.go)
export const CASTS = {
  missile: 'снаряд летит в существо', strike: 'бьёт существо сразу', ball: 'шар летит в точку и взрывается',
  burst: 'вспышка по площади в точке', column: 'колонна: бьёт площадь через полсекунды', wall: 'стена поперёк, бьёт каждые 4 такта',
  cloud: 'облако над площадью, бьёт каждые 4 такта', fire: 'костёр в точке, горит, пока не потушат', teleport: 'переносит заклинателя в точку',
  touch: 'действует на существо сразу', none: 'только звук', off: 'ничего',
};
// statuses New EI can keep on a creature (engine/magic.go) — what `effect` lays
export const STATUSES = {
  prot_fire: 'защита от огня', prot_electro: 'защита от молнии', prot_acid: 'защита от кислоты', eagle_sight: 'орлиный глаз',
  infravision: 'инфравидение', detect_life: 'обнаружение жизни', invisibility: 'невидимость', silence: 'тишина', lichdom: 'личина мертвеца',
  stench: 'вонь', stun: 'оглушение', antimagic: 'антимагия', teleport: 'заморозка телепорта', strength: 'усиление', weak: 'ослабление',
  regeneration: 'регенерация', feeblemind: 'слабоумие', speed: 'ускорение', slow: 'замедление', enlarge: 'увеличение', shrink: 'уменьшение',
};
export const AI = ['bolt', 'ball', 'wall', 'curse', 'shield', 'buff', 'heal', 'none'];
export const DO_KEYS = ['like', 'cast', 'damage', 'heal', 'drain', 'effect', 'effect_power', 'effect_ticks', 'fx', 'blast', 'hit_fx', 'hit_size', 'ai', 'offensive', 'hostile', 'sound'];

export function parseSpellDo(text) {
  const out = {};
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.split(';')[0].trim();
    if (!line) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { cur = out[m[1].trim().toLowerCase()] = {}; continue; }
    const i = line.indexOf('=');
    if (cur && i > 0) cur[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

// checkSpellDo throws on what New EI would refuse; codes are the spells.sdb codes by index, lower case. Sections are
// read in order, so like may name a game spell or a section above.
export function checkSpellDo(all, codes) {
  const fail = msg => { throw new Error(msg); };
  const described = new Set(codes.slice(0, GAME_SPELLS));
  for (const [code, d] of Object.entries(all)) {
    const at = `[${code}]`, idx = codes.indexOf(code);
    if (idx < 0) fail(`${at}: нет заклинания с таким Code в spells.sdb`);
    for (const k of Object.keys(d)) if (!DO_KEYS.includes(k)) fail(`${at}: неизвестный ключ ${k} (${DO_KEYS.join(', ')})`);
    if (d.like !== undefined) {
      const l = String(d.like).toLowerCase();
      if (l === code || !described.has(l)) fail(`${at}: like = ${d.like} — нужно описанное заклинание (игры или выше в файле)`);
    } else if (idx >= GAME_SPELLS && !d.cast) fail(`${at}: новому заклинанию нужен like или cast`);
    if (d.cast !== undefined && !(String(d.cast).toLowerCase() in CASTS)) fail(`${at}: cast — ${Object.keys(CASTS).join(', ')}`);
    if (d.damage !== undefined && !DAMAGE.includes(String(d.damage).toLowerCase())) fail(`${at}: damage — ${DAMAGE.join(', ')}`);
    if (d.effect !== undefined && !(String(d.effect).toLowerCase() in STATUSES)) fail(`${at}: effect — состояние движка: ${Object.keys(STATUSES).join(', ')}`);
    if (d.ai !== undefined && !AI.includes(String(d.ai).toLowerCase())) fail(`${at}: ai — ${AI.join(', ')}`);
    for (const k of ['fx', 'blast', 'hit_fx']) if (d[k] !== undefined && !/^(0x[0-9a-f]+|\d+)$/i.test(String(d[k]))) fail(`${at}: ${k} — номер частиц (0x2011)`);
    for (const k of ['heal', 'drain', 'effect_power', 'effect_ticks', 'hit_size', 'offensive', 'hostile']) if (d[k] !== undefined && !Number.isFinite(+d[k])) fail(`${at}: ${k} должно быть числом`);
    described.add(code);
  }
}

export function formatSpellDo(all) {
  return ['; New EI: заклинания мода — новые и правки заклинаний игры. Заклинания игры описаны так же в New EI/ei/spells.ini.',
    '; [код из spells.sdb]  like = заклинание, с которого начать; cast = как летит (missile strike ball burst column wall cloud fire teleport touch none off).',
    '; Что с каждой целью: damage = piercing|slashing|bludgeoning|fire|acid|lightning|general (сила = Effect), heal = 1, drain = доля урона заклинателю,',
    '; effect = состояние движка (slow, stun, speed…), effect_power, effect_ticks. Ещё: fx, blast, hit_fx, hit_size (частицы), ai, offensive, hostile, sound.',
    ...Object.entries(all).flatMap(([code, d]) => ['', `[${code}]`, ...DO_KEYS.filter(k => d[k] !== undefined && d[k] !== '').map(k => `${k} = ${d[k]}`)])].join('\r\n') + '\r\n';
}

// describeSpellDo is a sentence for people: what the section makes the spell do in New EI.
export function describeSpellDo(d, names = {}) {
  if (!d) return '';
  const n = c => names[String(c).toLowerCase()] || c, parts = [];
  if (d.like) parts.push(`сделано из «${n(d.like)}»`);
  if (d.cast) parts.push(CASTS[d.cast] || d.cast);
  if (d.damage) parts.push(`бьёт уроном ${{ piercing: 'колющим', slashing: 'режущим', bludgeoning: 'дробящим', fire: 'огнём', acid: 'кислотой', lightning: 'молнией', general: 'общим' }[d.damage] || d.damage} силой Effect`);
  if (+d.heal) parts.push('лечит цель на Effect');
  if (+d.drain) parts.push(`отдаёт заклинателю ${Math.round(+d.drain * 100)}% нанесённого урона`);
  if (d.effect) parts.push(`накладывает «${STATUSES[d.effect] || d.effect}»` + (d.effect_power ? ` силой ${d.effect_power}` : '') + (d.effect_ticks ? ` на ${(+d.effect_ticks * 0.055).toFixed(1)} с` : ''));
  if (d.sound) parts.push(`звуки «${n(d.sound)}»`);
  return parts.join(', ') + '.';
}
