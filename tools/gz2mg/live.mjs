// 2026-11-17 «живые карты»: fixes + new NPCs, ambient life and in-zone quests for gz1mg «Лавовое озеро» and gz2mg «Огненный рубеж».
// Everything goes through the editor's MCP tools (ei.mjs). Re-runnable: units/objects are skipped by name, script blocks
// (triggers 9500+/9600+, globals L_*) are replaced. gen_h.mjs `script` rebuilds gz2mg's script from scratch → rerun `node live.mjs script` after it.
// node live.mjs [fix|db|texts|acks|world|script]   (no arg = all)
import fs from 'node:fs';
import { call } from './ei.mjs';
const { cp1251 } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/formats/bytes.js');
const { decodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const only = process.argv[2], on = p => !only || only === p;
const log = (...a) => console.log(...a.map(x => typeof x === 'string' ? x : JSON.stringify(x).slice(0, 260)));

// ---------- open AI cells (class 3: humans and orcs), 1 px = 0.5 m ----------
async function grid(mob) {
  const im = decodePng((await call('terrain_passability', { mpr: mob, class: 3 })).img), W = im.width, H = im.height;
  const cell = (cx, cy) => cx >= 0 && cy >= 0 && cx < W && cy < H && !(im.rgba[(cy * W + cx) * 4] > 180 && im.rgba[(cy * W + cx) * 4 + 1] < 90);
  const open = (x, y, m = 0) => { const cx = Math.round(x * 2), cy = Math.round((H / 2 - y) * 2); for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) if (!cell(cx + dx, cy + dy)) return false; return true; };
  // nearest spot with ~1 m of free room around
  const snap = (x, y, max = 8) => { for (const m of [2, 1, 0]) for (let r = 0; r <= max; r += 0.5) for (let a = 0; a < 16; a++) { const px = x + r * Math.cos(a * Math.PI / 8), py = y + r * Math.sin(a * Math.PI / 8); if (open(px, py, m)) return [+px.toFixed(1), +py.toFixed(1)]; } throw new Error(`no open spot near ${x},${y} in ${mob}`); };
  return { open, snap };
}
const units = async mob => (await call('map_objects', { mob, kind: 'unit', limit: 1000 })).objects;
const byName = async (mob, name) => (await call('map_objects', { mob, query: name, limit: 50 })).objects.find(o => o.name === name);

// ---------- story ----------
const QUESTS = {
  gz1mg: {
    qgz1mg4: { exp: 600, money: 150, title: 'Соль лавы', text: `Соль лавы
Алхимик Фенн разбил лагерь на юго-восточном берегу Лавового озера. Он хочет понять, отчего озеро год от года всё горячее, и для опытов ему нужна лавовая соль.
#subobj  1
Собрать соль у южной фумаролы
Огонь бьёт из земли на южном берегу озера, среди костей.
#subobj  2
Собрать соль у восточной фумаролы
Вторая фумарола — у восточного края озера.
#subobj  3
Собрать соль у северной фумаролы
Третья — на северном берегу, недалеко от логова дракона.
#subobj  4
Отнести соль Фенну` },
    qgz1mg5: { exp: 3000, money: 500, title: 'Драконья доля', text: `Драконья доля
Пастух Радим месяц прячется в камнях у северо-западного берега Лавового озера. Дракон сожрал его стадо, и Радим отдаст все сбережения тому, кто убьёт тварь.
#subobj  1
Убить дракона
Дракон лежит на северном берегу озера.
#subobj  2
Вернуться к Радиму` },
    qgz1mg6: { exp: 900, money: 100, title: 'Шёпот камня', text: `Шёпот камня
Червелицые паломники молятся каменному дракону Джун к югу от Лавового озера. Их жрец говорит, что камень помнит огонь и может заговорить, но его голос глушат плакальщицы с южного болота.
#subobj  1
Упокоить двух плакальщиц
Призраки воют над болотом у южного края карты, к востоку от Огнёвки.
#subobj  2
Вернуться к каменному дракону` },
  },
  gz2mg: {
    qgz2mg11: { exp: 1000, money: 200, title: 'Болотный корень', text: `Болотный корень
Раненые лучники кордона горят в лихорадке. Лекарка говорит, что жар снимает болотный корень, а растёт он только у ящеров.
#subobj  1
Найти травницу ящеров
Деревня ящеров стоит на островке посреди болота, к югу от лагеря.
#subobj  2
Упокоить двух плакальщиц
Призраки воют над топью и пугают кладки ящеров.
#subobj  3
Вернуться к травнице
#subobj  4
Отнести корень лекарке` },
    qgz2mg12: { exp: 1500, money: 300, title: 'Барабан войны', text: `Барабан войны
В развалинах хутора на восточном берегу прячется орк-изгой Грыш. Он ушёл от орды, когда шаманка сожгла духов предков. Грыш говорит, что орду ведёт барабан войны.
#subobj  1
Убить барабанщицу
Она бьёт в барабан у большой хижины вождя, посреди орочьего лагеря.
#subobj  2
Вернуться к Грышу` },
    qgz2mg13: { exp: 700, money: 150, title: 'Обоз со стрелами', text: `Обоз со стрелами
У лучников Ольгерда кончаются стрелы. Обоз из Огнёвки не дошёл до кордона: он пропал в лесу к северу от лагеря, где охотятся волки.
#subobj  1
Найти ящик со стрелами
Разбитая телега лежит в северном лесу на западном берегу.
#subobj  2
Отнести стрелы мастеру` },
    qgz2mg14: { exp: 500, money: 100, title: 'Беглянка', text: `Беглянка
У свинопаса Берна, что живёт у развилки дорог в западном лесу, сбежала лучшая свинья Хавронья. Она прибилась к диким кабанам.
#subobj  1
Найти Хавронью
Кабаны держатся на холме к юго-западу от развилки. Свинья пойдёт за тем, кто подойдёт к ней вплотную.
#subobj  2
Привести свинью к Берну` },
  },
};
// speech bubbles: id → [unit map name, text ≤126 bytes]
const SAYS = {
  gz1mg10: ['Fenn', 'Не опрокинь котёл! Мне нужна лавовая соль с трёх фумарол у берега. Сам не дойду: там кости ходят.'],
  gz1mg11: ['Fenn', 'Три щепоти! Теперь узнаю, отчего озеро греется год от года. Держи за труды. И не пей из моего котла.'],
  gz1mg12: ['Radim', 'Тсс! Видишь тварь на северном берегу? Сожрала моё стадо. Убьёшь дракона — отдам всё, что скопил.'],
  gz1mg13: ['Radim', 'Сдох?! Сам видел, а не верю. Держи, тут всё до монеты. Пойду искать, не уцелела ли хоть одна овца.'],
  gz1mg14: ['Radim', 'Так это ты завалил дракона? А я месяц в камнях сижу, караулю... Возьми хоть это, от души.'],
  gz1mg15: ['Pilgrim3', 'Ссс... Камень помнит огонь. Плакальщицы с южного болота глушат его голос. Упокой их — и он заговорит.'],
  gz1mg16: ['Pilgrim3', 'Слушай! Камень говорит: врата на горе за рекой не мертвы. Им нужен огонь. Берегись того, кто их кормит.'],
  gz1mg17: ['Peddler', 'Соль, нитки, ножи! Нет? Ну, бывай. За озером зарево по ночам, так что я дальше Огнёвки ни ногой.'],
  gz2mg10: ['Healer', 'Раненые горят в лихорадке. Нужен болотный корень, он растёт у ящеров. Спроси их травницу на островке.'],
  gz2mg11: ['Ssaya', 'Корень? Ссс... Две плакальщицы воют над топью, пугают кладки. Упокой обеих — выкопаю лучший корень.'],
  gz2mg12: ['Ssaya', 'Тихо над топью. Кладки целы. Вот корень, человек. Вари недолго, иначе будет яд.'],
  gz2mg13: ['Healer', 'Он самый! К утру жар спадёт. Спасибо тебе от всего кордона. Возьми, это из нашей казны.'],
  gz2mg14: ['Fletcher', 'Стрел осталось на два дня! Обоз из Огнёвки пропал в северном лесу, там волки. Найди ящик со стрелами!'],
  gz2mg15: ['Fletcher', 'Целый ящик! Теперь продержимся. Ольгерд велел платить за такое не скупясь, держи.'],
  gz2mg16: ['Grysh', 'Не бей! Грыш ушёл от орды: шаманка сожгла духов предков. Убей ту, что бьёт в барабан войны!'],
  gz2mg17: ['Grysh', 'Барабан молчит. Грыш слышит предков! Возьми, Грыш снял это с мёртвых. Тебе нужнее.'],
  gz2mg18: ['Bern', 'Беда, путник! Моя Хавронья сбежала к диким кабанам, на холм к юго-западу. Приведи её, а?'],
  gz2mg19: ['Bern', 'Хавронья! Живая! Ну, спасибо тебе. Вот, возьми, чем богат.'],
  gz2mg20: ['Bern', 'Эх, Хавронья... Не уберегли. Ступай, чего уж теперь.'],
  gz2mg21: ['Bern', 'Слыхал, тролли в норах передохли? Хоть свиней таскать перестанут. Не твоя ли работа?'],
};
const PROTO = { Fenn: 'AlchemistFenn', Radim: 'HunterRadim', Pilgrim3: 'OctopusHadaganM14', Peddler: 'PeddlerTish', Healer: 'Human Gipath Villager F1 Female', Ssaya: 'DragonkinGreenF3', Fletcher: 'Human Gipath Villager F1', Grysh: 'OrcMaleF5', Bern: 'SwineherdBern' };
const NEWUNITS = { AlchemistFenn: ['Human Gipath NPC Buerocrat F1', 'Алхимик Фенн'], HunterRadim: ['Human Gipath Villager F1', 'Пастух Радим'], PeddlerTish: ['Human Gipath Runner Male F1', 'Коробейник Тиш'], SwineherdBern: ['Human Gipath Villager F1', 'Свинопас Берн'] };
const QITEMS = { arrowbundle: ['thiefsack', 107, 'Ящик стрел\nТяжёлая связка стрел с гусиным пером из разбитого обоза.'], swamproot: ['herbbag', 108, 'Болотный корень\nУзловатый чёрный корень, пахнет тиной. Снимает жар, если варить недолго.'], lavasalt: ['firescale', 109, 'Лавовая соль\nЖёлтые кристаллы с края фумаролы. Ещё тёплые.'] };
const CLOTHES = { armors: ['gipat brigand shirt.tiger hide', 'gipat brigand pants.tiger hide', 'gipat brigand boots.tiger hide'] };

// ---------- fix: units standing in closed cells, twins on one spot, a duplicate name ----------
if (on('fix')) for (const mob of ['gz1mg', 'gz2mg']) {
  const G = await grid(mob); let moved = 0;
  const seen = new Set();
  for (const u of await units(mob)) {
    const key = u.pos.slice(0, 2).map(v => v.toFixed(1)).join(), twin = seen.has(key); seen.add(key);
    if (/Toad|Wisp|Banshee|Bat|Ghost|^Dragon$|Prisoner/.test(u.name)) continue; // fliers, swamp dwellers, the caged one
    if (G.open(u.pos[0], u.pos[1]) && !twin) continue;
    const [x, y] = G.snap(u.pos[0] + (twin ? 1.5 : 0), u.pos[1], 10), g = await call('map_object_get', { mob, id: u.id });
    await call('map_object_set', { mob, id: u.id, fields: { pos: [x, y] } });
    const edit = (g.patrols?.[0]?.points || []).map((p, index) => ({ index, pos: [x, y], d: Math.hypot(p.pos[0] - u.pos[0], p.pos[1] - u.pos[1]) })).filter(e => e.d < 0.8).map(({ index, pos }) => ({ index, pos }));
    if (edit.length) await call('map_patrol_set', { mob, id: u.id, edit });
    moved++;
  }
  log(mob, 'units moved out of closed cells / off twins:', moved);
  if (mob === 'gz2mg') { const c = (await units(mob)).find(u => u.name === 'Cook' && /Orc/.test(u.prototype)); if (c) log(await call('map_object_set', { mob, id: c.id, fields: { name: 'OrcCook' } })); }
}

// ---------- database: named NPCs, quest items, quest records ----------
async function addRec(file, table, from, name, fields) {
  const have = await call('db_records', { file, table, query: name });
  if (!have.records.some(r => String(r[1]).toLowerCase() === name.toLowerCase())) await call('db_record_add', { file, table, from, name });
  if (fields) await call('db_record_set', { file, table, record: name, fields });
}
if (on('db')) {
  for (const [n, [from]] of Object.entries(NEWUNITS)) await addRec('units.udb', 3, from, n);
  for (const [n, [from, id]] of Object.entries(QITEMS)) await addRec('items.idb', 5, from, n, { ScriptID: String(id) });
  let rn = 130;
  for (const [zone, qs] of Object.entries(QUESTS)) for (const [k, q] of Object.entries(qs))
    await addRec('quests.qdb', 1, zone === 'gz1mg' ? 'qgz1mg1' : 'qgz2mg10', k, { Experience: String(q.exp), Money: String(q.money), Comment: q.title, 'Record Number': String(rn++) });
  log('db ok');
}
if (on('texts')) {
  const entries = [];
  for (const qs of Object.values(QUESTS)) for (const [k, q] of Object.entries(qs)) entries.push({ name: 'quest ' + k, text: q.text });
  for (const [k, [, t]] of Object.entries(NEWUNITS)) entries.push({ name: 'UNIT ' + k, text: t + '\n' });
  for (const [k, [, , t]] of Object.entries(QITEMS)) entries.push({ name: 'QUESTITEM ' + k, text: t + '\n' });
  for (const [k, [, t]] of Object.entries(SAYS)) { if (cp1251.encode(t).length > 126) throw new Error(`say ${k} is ${cp1251.encode(t).length} bytes`); entries.push({ name: 'say ' + k, text: t }); }
  log(await call('texts_set', { entries }));
}
// ---------- acks: bubbles (record under the unit's map name and under its prototype) ----------
if (on('acks')) {
  const seg = (tag, bytes) => [tag, bytes.length * 2, ...bytes], str = s => [...cp1251.encode(s), 0];
  const phrase = (id, text) => cp1251.decode(Uint8Array.from([...seg(1, str('Acks\\Headman\\Scenario\\1.wav')), ...seg(2, [100, 0, 0, 0]), ...seg(3, str(text)), ...seg(4, str(id))].slice(0, -1)));
  const have = new Set((await call('db_records', { file: 'acks.db', table: 1, limit: 500 })).records.map(r => r[1]));
  for (const [id, [who, t]] of Object.entries(SAYS)) for (const rec of [who, PROTO[who]]) {
    const fresh = !have.has(rec); if (fresh) { await call('db_record_add', { file: 'acks.db', table: 1, from: 'Fisher', name: rec }); have.add(rec); }
    const sub = (await call('db_record_get', { file: 'acks.db', table: 1, record: rec })).fields.find(f => f.name === 'Scenario').sub;
    let k = sub.findIndex(s => String(s.text).endsWith(id));
    if (k < 0) k = fresh ? 0 : sub.length; // a fresh copy carries the sample's phrase in slot 0
    await call('db_record_set', { file: 'acks.db', table: 1, record: rec, fields: { ['Scenario.field1#' + k]: phrase(id, t) } });
  }
  log('acks ok');
}

// ---------- world: objects, NPCs, ambient life ----------
const P = {}; // snapped key points, used by the scripts
async function world() {
  for (const mob of ['gz1mg', 'gz2mg']) {
    let G = await grid(mob);
    const have = new Set((await call('map_objects', { mob, limit: 6000 })).objects.map(o => o.name));
    const S = (k, x, y) => (P[k] = G.snap(x, y));
    const objs = [], add = (object, x, y, yaw = 0, extra = {}) => { if (G.open(x, y)) objs.push({ object, fields: { pos: [x, y], yaw, ...extra } }); };
    const fire = (name, x, y) => { if (!have.has(name)) objs.push({ copy_of: 198, from_mob: 'gz2mg', fields: { name, pos: [x, y] } }); };
    const crew = []; // [unit, name, pos, yaw, player, extra, route]
    const redo = [], U = (unit, name, pos, o = {}) => { if (!have.has(name)) crew.push([unit, name, pos, o]); else if (o.route) redo.push([name, o.route]); };
    const calm = route => ({ cyclic: route.length > 2, points: route.map(p => ({ ...p, wait: Math.round(Math.min(p.wait, 60 + p.wait / 5)) })) });
    if (mob === 'gz1mg') {
      for (const [id, name] of [[1791, 'Wailer1'], [1792, 'Wailer2']]) if (!have.has(name)) await call('map_object_set', { mob, id, fields: { name } });
      for (const k of ['v1', 'v2', 'v3']) { const o = await byName(mob, 'Vent_' + k); if (o) P[k] = o.pos.slice(0, 2); } // the fires stay where they were lit
      const F = S('fenn', 184, 122), R = S('radim', 98, 184);
      [['v1', 160, 141], ['v2', 197, 165], ['v3', 129, 178]].forEach(([k, x, y]) => { const v = P[k] || S(k, x, y); if (!have.has('Vent_' + k)) { fire('Vent_' + k, v[0], v[1]); for (const a of [0, 2.1, 4.2]) add(a ? 'SingleStone00' : 'SingleStone01', v[0] + 1.6 * Math.cos(a), v[1] + 1.6 * Math.sin(a), a * 57); } });
      if (!have.has('FennFire')) { add('Tent00_Old', F[0] - 4.5, F[1] + 3, 200); add('WitchKettle00', F[0] + 2.5, F[1] + 1); fire('FennFire', F[0] + 2.5, F[1] + 0.8); add('Barrel00', F[0] - 2, F[1] - 3); add('Box00', F[0] - 3.2, F[1] - 2.2, 30); add('Sack00', F[0] - 1, F[1] + 3.5); }
      if (!have.has('Radim')) { add('StoneSet01', R[0] + 4.5, R[1] - 1, 80); add('SingleStone01', R[0] + 3, R[1] + 3, 10); add('Skin 01', R[0] - 2.5, R[1] + 1.5, 90); }
      U('AlchemistFenn', 'Fenn', F, { yaw: 60, player: 2, ...CLOTHES, route: [{ pos: F, wait: 400 }, { pos: [F[0] + 1.5, F[1] + 2.2], wait: 250 }] });
      U('HunterRadim', 'Radim', R, { yaw: -90, player: 2, ...CLOTHES, weapons: ['stone spear.rock'] });
      // the peddler walks the road between the village gate and the way to Gipat's middle lands
      const road = [[90, 16], [118, 26], [150, 38], [186, 34], [222, 24]].map(([x, y]) => G.snap(x, y, 12));
      U('PeddlerTish', 'Peddler', road[0], { player: 2, ...CLOTHES, route: [...road, ...road.slice(1, -1).reverse()].map((pos, k) => ({ pos, wait: k % 4 ? 20 : 300 })) });
      // Огнёвка behind the palisade: people, pigs, a dog
      const v = (x, y) => G.snap(x, y, 5);
      U('Human Gipath Villager F1 Female', 'WellWoman', v(47, 12), { player: 2, route: [{ pos: v(47, 12), wait: 300 }, { pos: v(58, 16), wait: 400 }, { pos: v(42, 17), wait: 200 }] });
      U('Human Gipath Villager F1', 'Villager1', v(34, 12), { player: 2, route: [{ pos: v(34, 12), wait: 250 }, { pos: v(52, 9), wait: 250 }, { pos: v(64, 15), wait: 300 }] });
      U('DogGreyF6', 'VillageDog', v(52, 14), { player: 2, route: [[52, 14], [66, 16], [40, 17], [30, 12]].map(([x, y]) => ({ pos: v(x, y), wait: 60 })) });
      [[36, 12], [38, 15], [33, 15]].forEach(([x, y], k) => U('PigF0', 'Pig' + (k + 1), v(x, y), { player: 7, route: [{ pos: v(x, y), wait: 200 }, { pos: v(x + 3, y - 2), wait: 300 }] }));
      // woodcutters among the stumps, cows on the cleared land, deer in the eastern forest
      [[150, 17, 160, 14], [144, 14, 118, 16]].forEach(([x, y, x2, y2], k) => U('Human Gipath Villager F1', 'Lumberjack' + (k + 1), G.snap(x, y), { player: 2, ...CLOTHES, route: [{ pos: G.snap(x, y), wait: 500 }, { pos: G.snap(x2, y2), wait: 500 }] }));
      [[100, 28], [104, 31]].forEach(([x, y], k) => U('CowF0', 'Cow' + (k + 1), G.snap(x, y), { player: 7, route: [{ pos: G.snap(x, y), wait: 600 }, { pos: G.snap(x + 6, y + 3), wait: 600 }] }));
      [[236, 100], [239, 102], [234, 104]].forEach(([x, y], k) => U('DeerF0', 'Deer' + (k + 1), G.snap(x, y), { player: 7, route: [{ pos: G.snap(x, y), wait: 300 }, { pos: G.snap(x + 8, y - 12), wait: 300 }, { pos: G.snap(x - 10, y - 20), wait: 300 }] }));
      [[212, 60], [130, 60], [60, 120]].forEach(([x, y], k) => U('HareF0', 'Hare' + (k + 1), G.snap(x, y), { player: 7, route: [{ pos: G.snap(x, y), wait: 100 }, { pos: G.snap(x + 7, y + 5), wait: 100 }] }));
    } else {
      const B = S('bern', 60, 105), Gr = S('grysh', 150, 203), Cr = S('crate', 66, 232), Sy = S('ssaya', 123, 49), Pg = S('piggy', 33, 86); P.pen = G.snap(B[0] + 3, B[1] - 3);
      if (!have.has('ArrowCrate')) { objs.push({ copy_of: 402, fields: { name: 'ArrowCrate', pos: Cr, yaw: 40 } }); add('Van01', Cr[0] - 3.5, Cr[1] + 1.5, 70); add('Van_L_B_whell', Cr[0] - 1, Cr[1] + 3.5, 20); add('FakeBox00', Cr[0] + 2.5, Cr[1] + 1.5, 15); add('Sack00', Cr[0] + 1.5, Cr[1] - 2.5); }
      if (!have.has('Bern')) { add('FarmTub00', B[0] + 4, B[1] - 4.5); add('Basket00', B[0] - 2, B[1] + 2); add('Tent00_Old', B[0] - 5, B[1] - 3, 110); }
      if (!have.has('GryshFire')) { fire('GryshFire', Gr[0] + 2, Gr[1] - 1.5); add('Skin 00', Gr[0] - 2.5, Gr[1] + 1, 0); add('cherep', Gr[0] + 3, Gr[1] + 2.5); }
      U('SwineherdBern', 'Bern', B, { yaw: 180, player: 7, ...CLOTHES, route: [{ pos: B, wait: 400 }, { pos: P.pen, wait: 300 }] });
      [[2, -4], [5, -2], [4, -6]].forEach(([dx, dy], k) => U('PigF0', 'BernPig' + (k + 1), G.snap(B[0] + dx, B[1] + dy, 5), { player: 7, route: [{ pos: G.snap(B[0] + dx, B[1] + dy, 5), wait: 250 }, { pos: G.snap(B[0] + dx + 2, B[1] + dy + 2, 5), wait: 350 }] }));
      U('PigF0', 'Piggy', Pg, { player: 7 });
      U('OrcMaleF5', 'Grysh', Gr, { yaw: 200, player: 7 });
      U('DragonkinGreenF3', 'Ssaya', Sy, { yaw: 30, player: 2, route: [{ pos: Sy, wait: 500 }, { pos: G.snap(Sy[0] - 4, Sy[1] + 4, 5), wait: 300 }] });
      // lizard children run around the islet, fishers stand at the water; a dog guards the cordon
      [[126, 56], [131, 48]].forEach(([x, y], k) => U('DragonkinGreenF3', 'LizardKid' + (k + 1), G.snap(x, y, 5), { player: 2, complection: [0.1, 0.5, 0.05], run: 1, route: [[x, y], [x + 6, y - 5], [x - 5, y - 6], [x - 4, y + 4]].map(([a, b]) => ({ pos: G.snap(a, b, 5), wait: 25 })) }));
      [[118, 62, 60], [139, 56, -40]].forEach(([x, y, yaw], k) => U('DragonkinGreenF3', 'LizardFisher' + (k + 1), G.snap(x, y, 6), { player: 2, yaw, route: [{ pos: G.snap(x, y, 6), wait: 1500 }, { pos: G.snap(128, 55, 5), wait: 200 }] }));
      U('DogGreyF6', 'CampDog', G.snap(54, 186), { player: 2, route: [[54, 186], [62, 180], [66, 196], [46, 190], [40, 176]].map(([x, y]) => ({ pos: G.snap(x, y), wait: 90 })) });
    }
    if (objs.length) log(mob, 'objects', await call('map_object_add', { mob, items: objs }));
    for (const [unit, name, pos, o] of crew) {
      const { route, run, ...fields } = o;
      const r = await call('map_object_add', { mob, unit, fields: { name, pos, ...fields } }), id = r.id ?? r.ids?.[0];
      if (route) await call('map_patrol_set', { mob, id, ...calm(route) });
    }
    // New EI finds a bubble's speaker by the hashed name id (like base NPCs)
    for (const who of new Set(Object.entries(SAYS).filter(([k]) => k.startsWith(mob)).map(([, [w]]) => w))) { const o = await byName(mob, who); if (o.id < 1e9) await call('map_object_set', { mob, id: o.id, fields: { briefing: 1 } }); }
    for (const [name, route] of redo) await call('map_patrol_set', { mob, id: (await byName(mob, name)).id, ...calm(route) });
    log(mob, 'units added:', crew.map(c => c[1]).join(', ') || 'none');
  }
}
if (on('world') || on('script')) { await world(); (await import('node:fs')).writeFileSync('live_points.json', JSON.stringify(P)); } // (idempotent; the script needs the snapped points)

// ---------- scripts ----------
async function patch(mob, base, build) {
  const S = { decl: [], scripts: [], world: [], globals: [] }; let N = base;
  const trig = (conds, acts, name) => { S.decl.push(`DeclareScript ${name} (  this : object )`); S.scripts.push(`Script ${name}\n(\n  if\n  (\n${conds.map(c => '    ' + c + ' ').join('\n')}\n  )\n  then\n  (\n    KillScript(  ) \n${acts.map(a => '    ' + a + ' ').join('\n')}\n  )\n)\n`); };
  const once = (conds, acts) => { const n = `VCheck#0#${N++}`; trig(conds, acts, n); S.world.push(`${n}( NULL )`); };
  const obj = async name => { const o = await byName(mob, name); if (!o) throw new Error(`no ${name} in ${mob}`); S.globals.push(`L_${name} : object`); S.world.unshift(`L_${name} = GetObjectByID( "${o.id}" )`); return 'L_' + name; };
  await build({ once, obj });
  let s = (await call('map_script_get', { mob })).replace(/\r\n/g, '\n');
  s = s.replace(/^DeclareScript V(Check|Triger)#0#9[5-7]\d\d .*\n/gm, '').replace(/Script V(Check|Triger)#0#9[5-7]\d\d\n\([\s\S]*?\n\)\n\n?/g, '')
    .replace(/^  L_\w+ : object,\n/gm, '').replace(/^  L_\w+ = GetObjectByID\(.*\n/gm, '').replace(/^  VCheck#0#9[5-7]\d\d\( NULL \) *\n/gm, '');
  s = s.replace('GlobalVars (\n', 'GlobalVars (\n' + S.globals.map(g => `  ${g},\n`).join(''))
    .replace('DeclareScript #OnBriefingComplete', S.decl.join('\n') + '\nDeclareScript #OnBriefingComplete')
    .replace('\nScript #OnBriefingComplete', '\n' + S.scripts.join('\n') + '\nScript #OnBriefingComplete');
  const end = s.lastIndexOf('\n)'); s = s.slice(0, end).replace(/\s+$/, ' ') + '\n' + S.world.map(w => `  ${w} `).join('\n') + s.slice(end);
  log(mob, 'script', await call('map_script_set', { mob, script: s }), S.world.length, 'lines');
}
const V = v => `GSGetVar( 0, "${v}" )`, eq = (v, n) => `IsEqual( ${V(v)} , ${n} )`, set = (v, n) => `GSSetVarMax( 0, "${v}", ${n} )`;
const say = id => `SendStringEvent( 0, "say ${id} ${SAYS[id][0]}" )`, HERO = 'GetUnitOfPlayer( 0, 0 )';
const fin = (zone, q) => [set(`q.${zone}.${q}`, 2), `QuestComplete( 0, "${q}" )`];
if (on('script')) {
  await patch('gz1mg', 9500, async ({ once, obj }) => {
    const Q = (n, s) => `q.gz1mg.qgz1mg${n}${s ? '.' + s : ''}`, nearU = (u, r) => `IsLess( DistanceUnitUnit( ${HERO} , ${u} ) , ${r} )`, nearP = ([x, y], r) => `IsLess( DistanceUnitPoint( ${HERO} , ${x}, ${y} ) , ${r} )`;
    const Fenn = await obj('Fenn'), Radim = await obj('Radim'), Dragon = await obj('Dragon'), Pil = await obj('Pilgrim3'), Ped = await obj('Peddler'), W1 = await obj('Wailer1'), W2 = await obj('Wailer2');
    // the alchemist and the three fumaroles
    once([nearU(Fenn, 6)], [say('gz1mg10'), set(Q(4), 1), set(Q(4, 1), 1), set(Q(4, 2), 1), set(Q(4, 3), 1)]);
    ['v1', 'v2', 'v3'].forEach((k, i) => once([eq(Q(4), 1), nearP(P[k], 7)], [set(Q(4, i + 1), 2), 'GiveQuestItem( 0, "LavaSalt" )']));
    once([eq(Q(4, 1), 2), eq(Q(4, 2), 2), eq(Q(4, 3), 2)], [set(Q(4, 4), 1)]);
    once([eq(Q(4, 4), 1), nearU(Fenn, 6)], [say('gz1mg11'), ...[1, 2, 3].map(() => 'EraseQuestItem( 0, 109 )'), set(Q(4, 4), 2), ...fin('gz1mg', 'qgz1mg4')]);
    // the shepherd and the dragon
    once([nearU(Radim, 7), `IsAlive( ${Dragon} )`], [say('gz1mg12'), set(Q(5), 1), set(Q(5, 1), 1)]);
    once([`IsDead( ${Dragon} )`], [set('gz1mg.dragon', 1)]);
    once([eq(Q(5, 1), 1), eq('gz1mg.dragon', 1)], [set(Q(5, 1), 2), set(Q(5, 2), 1)]);
    once([eq(Q(5, 2), 1), nearU(Radim, 7)], [say('gz1mg13'), set(Q(5, 2), 2), ...fin('gz1mg', 'qgz1mg5')]);
    once([eq(Q(5), 0), eq('gz1mg.dragon', 1), nearU(Radim, 7)], [say('gz1mg14'), 'GiveMoney( 0, 300 )']);
    // the pilgrims' stone
    once([nearU(Pil, 7)], [say('gz1mg15'), set(Q(6), 1), set(Q(6, 1), 1)]);
    once([`IsDead( ${W1} )`, `IsDead( ${W2} )`], [set('gz1mg.wailers', 1)]);
    once([eq(Q(6, 1), 1), eq('gz1mg.wailers', 1)], [set(Q(6, 1), 2), set(Q(6, 2), 1)]);
    once([eq(Q(6, 2), 1), nearP([176, 92], 9)], [`CreateLightning( 21001, 176, 92, Add( GetZ( ${HERO} ) , 7 ) , GetX( ${HERO} ) , GetY( ${HERO} ) , Add( GetZ( ${HERO} ) , 1 ) , 4 )`, say('gz1mg16'), set(Q(6, 2), 2), ...fin('gz1mg', 'qgz1mg6'), 'Sleep( 20 )', 'DeleteLightning( 21001 )']);
    once([nearU(Ped, 6)], [say('gz1mg17')]);
    // steam where the lava runs into the river: the game's own "Smoke" particle sources on the bar of cooled lava (nat.mjs)
    const steam = fs.existsSync('pre/gz1mg_steam.json') ? JSON.parse(fs.readFileSync('pre/gz1mg_steam.json', 'utf8')) : [];
    if (steam.length) once([], steam.map(([x, y, z], i) => `CreateParticleSource( ${22001 + i}, ${x}, ${y}, ${z}, ${i % 2 ? 1.6 : 1.1}, "Smoke" )`));
  });
  await patch('gz2mg', 9600, async ({ once, obj }) => {
    const Q = (n, s) => `q.gz2mg.qgz2mg${n}${s ? '.' + s : ''}`, nearU = (u, r) => `Any( i, Heroes, IsLess( DistanceUnitUnit( i, ${u} ) , ${r} )  )`;
    const o = {}; for (const n of ['Healer', 'Ssaya', 'SwampBanshee1', 'SwampBanshee2', 'Fletcher', 'ArrowCrate', 'Grysh', 'Drummer', 'Bern', 'Piggy']) o[n] = await obj(n);
    // the healer's root
    once([nearU(o.Healer, 5)], ['Sleep( 80 )', say('gz2mg10'), set(Q(11), 1), set(Q(11, 1), 1)]);
    once([eq(Q(11, 1), 1), nearU(o.Ssaya, 6)], [say('gz2mg11'), set(Q(11, 1), 2), set(Q(11, 2), 1)]);
    once([`IsDead( ${o.SwampBanshee1} )`, `IsDead( ${o.SwampBanshee2} )`], [set('gz2mg.banshees', 1)]);
    once([eq(Q(11, 2), 1), eq('gz2mg.banshees', 1)], [set(Q(11, 2), 2), set(Q(11, 3), 1)]);
    once([eq(Q(11, 3), 1), nearU(o.Ssaya, 6)], [say('gz2mg12'), 'GiveQuestItem( 0, "SwampRoot" )', set(Q(11, 3), 2), set(Q(11, 4), 1)]);
    once([eq(Q(11, 4), 1), nearU(o.Healer, 5)], [say('gz2mg13'), 'EraseQuestItem( 0, 108 )', set(Q(11, 4), 2), ...fin('gz2mg', 'qgz2mg11')]);
    // the outcast and the war drum
    once([nearU(o.Grysh, 7)], [say('gz2mg16'), set(Q(12), 1), set(Q(12, 1), 1)]);
    once([`IsDead( ${o.Drummer} )`], [set('gz2mg.drum', 1)]);
    once([eq(Q(12, 1), 1), eq('gz2mg.drum', 1)], [set(Q(12, 1), 2), set(Q(12, 2), 1)]);
    once([eq(Q(12, 2), 1), nearU(o.Grysh, 7)], [say('gz2mg17'), set(Q(12, 2), 2), ...fin('gz2mg', 'qgz2mg12')]);
    // the lost arrows
    once([nearU(o.Fletcher, 5)], [say('gz2mg14'), set(Q(13), 1), set(Q(13, 1), 1)]);
    once([`IsEqual( GetLeverState( ${o.ArrowCrate} ) , 1 )`], ['GiveQuestItem( 0, "ArrowBundle" )', set('gz2mg.arrows', 1)]);
    once([eq(Q(13, 1), 1), eq('gz2mg.arrows', 1)], [set(Q(13, 1), 2), set(Q(13, 2), 1)]);
    once([eq(Q(13, 2), 1), nearU(o.Fletcher, 5)], [say('gz2mg15'), 'EraseQuestItem( 0, 107 )', set(Q(13, 2), 2), ...fin('gz2mg', 'qgz2mg13')]);
    // the runaway pig: it follows the hero home
    once([nearU(o.Bern, 6)], [say('gz2mg18'), set(Q(14), 1), set(Q(14, 1), 1)]);
    once([eq(Q(14, 1), 1), `IsAlive( ${o.Piggy} )`, nearU(o.Piggy, 5)], [`Follow( ${o.Piggy}, ${HERO} )`, set(Q(14, 1), 2), set(Q(14, 2), 1)]);
    once([eq(Q(14, 2), 1), `IsAlive( ${o.Piggy} )`, `IsLess( DistanceUnitUnit( ${o.Piggy}, ${o.Bern} ) , 10 )`], [`Guard( ${o.Piggy}, ${P.pen[0]}, ${P.pen[1]}, 4 )`, say('gz2mg19'), set(Q(14, 2), 2), ...fin('gz2mg', 'qgz2mg14')]);
    once([eq(Q(14), 1), `IsDead( ${o.Piggy} )`], [say('gz2mg20'), set(Q(14, 1), 2), set(Q(14, 2), 2), set(Q(14), 2)]);
    once([eq('gz3mg.trolls', 1), nearU(o.Bern, 6)], ['Sleep( 100 )', say('gz2mg21')]);
  });
}
