// Config/newspells.ini of New EI: what the spells game.exe does not know do (and changes to the game's own). One
// [section] per Code of spells.sdb; the rules mirror New EI's ei.ReadSpellDo, so a file written here always loads.
// Shared by mcp.js and the browser's database view; text in and out (cp1251 is the caller's).
export const NEWSPELLS = 'Config/newspells.ini';
export const GAME_SPELLS = 42; // game.exe knows spells 0…41 by number
export const DAMAGE = ['piercing', 'slashing', 'bludgeoning', 'fire', 'acid', 'lightning', 'general'];
export const DO_KEYS = ['like', 'damage', 'heal', 'drain', 'effect', 'effect_power', 'effect_ticks', 'sound'];

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

// checkSpellDo throws on what New EI would refuse; codes are the spells.sdb codes by index, lower case.
export function checkSpellDo(all, codes) {
  const fail = msg => { throw new Error(msg); };
  for (const [code, d] of Object.entries(all)) {
    const at = `[${code}]`, idx = codes.indexOf(code);
    if (idx < 0) fail(`${at}: нет заклинания с таким Code в spells.sdb`);
    for (const k of Object.keys(d)) if (!DO_KEYS.includes(k)) fail(`${at}: неизвестный ключ ${k} (${DO_KEYS.join(', ')})`);
    if (d.like !== undefined) {
      const l = codes.indexOf(String(d.like).toLowerCase());
      if (l < 0 || l >= GAME_SPELLS || all[codes[l]]) fail(`${at}: like = ${d.like} — нужно заклинание игры (номер 0…41) без своего раздела`);
    } else if (idx >= GAME_SPELLS) fail(`${at}: новому заклинанию нужен like`);
    if (d.damage !== undefined && !DAMAGE.includes(String(d.damage).toLowerCase())) fail(`${at}: damage — ${DAMAGE.join(', ')}`);
    for (const k of ['effect', 'sound']) if (d[k] !== undefined && !codes.includes(String(d[k]).toLowerCase())) fail(`${at}: ${k} = ${d[k]} — нет такого заклинания`);
    for (const k of ['heal', 'drain', 'effect_power', 'effect_ticks']) if (d[k] !== undefined && !Number.isFinite(+d[k])) fail(`${at}: ${k} должно быть числом`);
  }
}

export function formatSpellDo(all) {
  return ['; New EI: что делают заклинания, которых не знает game.exe (и правки заклинаний игры).',
    '; [код из spells.sdb]  like = заклинание игры: как летит и кого задевает. Что происходит с каждой целью:',
    '; damage = piercing|slashing|bludgeoning|fire|acid|lightning|general (сила = Effect), heal = 1, drain = доля урона заклинателю,',
    '; effect = код заклинания, чей эффект ложится на цель (effect_power, effect_ticks; по умолчанию Effect и Duration), sound = чьи звуки.',
    ...Object.entries(all).flatMap(([code, d]) => ['', `[${code}]`, ...DO_KEYS.filter(k => d[k] !== undefined && d[k] !== '').map(k => `${k} = ${d[k]}`)])].join('\r\n') + '\r\n';
}

// describeSpellDo is a sentence for people: what the spell does in New EI.
export function describeSpellDo(d, names = {}) {
  if (!d) return '';
  const n = c => names[String(c).toLowerCase()] || c, parts = [];
  if (d.like) parts.push(`летит и выбирает цели как «${n(d.like)}»`);
  if (d.damage) parts.push(`бьёт уроном ${{ piercing: 'колющим', slashing: 'режущим', bludgeoning: 'дробящим', fire: 'огнём', acid: 'кислотой', lightning: 'молнией', general: 'общим' }[d.damage] || d.damage} силой Effect`);
  if (+d.heal) parts.push('лечит цель на Effect');
  if (+d.drain) parts.push(`отдаёт заклинателю ${Math.round(+d.drain * 100)}% нанесённого урона`);
  if (d.effect) parts.push(`накладывает эффект «${n(d.effect)}»` + (d.effect_power ? ` силой ${d.effect_power}` : '') + (d.effect_ticks ? ` на ${(+d.effect_ticks * 0.055).toFixed(1)} с` : ''));
  if (d.sound) parts.push(`звучит как «${n(d.sound)}»`);
  return parts.join(', ') + '.';
}
