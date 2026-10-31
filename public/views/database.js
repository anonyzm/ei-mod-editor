// Database editor: items, weapons, armor, materials, monsters, NPCs, spells, perks, levers, quests.
import { api, h, guard, toast, dirty } from '/app.js';
import { readRes } from '/formats/res.js';
import { dbForFile, readDatabase, writeDatabase, fieldView, textToField } from '/formats/db.js';
import { schema, recordInfo } from '/lib/gamedb.js';
import { buildModel, loadFigModel, textureDataUrl, createPreview } from '/lib/eiscene.js';

// Friendly names, in the order users look for things.
const TABLES = [
  ['Предметы', [['items.idb', 2, 'Оружие'], ['items.idb', 3, 'Доспехи и одежда'], ['items.idb', 1, 'Материалы'], ['items.idb', 4, 'Зелья и свитки'], ['items.idb', 5, 'Квестовые предметы'], ['items.idb', 6, 'Трофеи (лут)']]],
  ['Существа', [['units.udb', 3, 'Монстры'], ['units.udb', 4, 'НПС (персонажи)'], ['units.udb', 2, 'Расы и модели'], ['units.udb', 1, 'Зоны попадания']]],
  ['Магия', [['spells.sdb', 1, 'Заклинания'], ['spells.sdb', 2, 'Модификаторы заклинаний'], ['spells.sdb', 3, 'Шаблоны заклинаний'], ['spells.sdb', 4, 'Шаблоны для доспехов'], ['spells.sdb', 5, 'Шаблоны для оружия']]],
  ['Персонаж', [['perks.pdb', 1, 'Навыки'], ['perks.pdb', 2, 'Умения (перки)']]],
  ['Мир', [['levers.ldb', 1, 'Рычаги, двери, сундуки'], ['quests.qdb', 1, 'Квесты (награды)'], ['quests.qdb', 2, 'Брифинги (награды)'], ['prints.db', 1, 'Следы крови'], ['prints.db', 2, 'Следы шагов'], ['prints.db', 3, 'Следы огня'], ['acks.db', 1, 'Реплики: ответы'], ['acks.db', 2, 'Реплики: крики'], ['acks.db', 3, 'Реплики: прочее']]],
];

const RU = {
  Name: 'Имя (внутреннее)', Type: 'Тип', Price: 'Цена', Weight: 'Вес', Size: 'Размер', Mana: 'Мана', Slots: 'Слоты', Durability: 'Прочность',
  Range: 'Дальность', 'D.Min': 'Урон мин.', 'D.Max': 'Урон макс.', Attack: 'Атака', Defence: 'Защита', Level: 'Уровень', Skill: 'Навык',
  Damage: 'Урон', Components: 'Компоненты', 'Dec.': 'Разбирается', 'M.Type': 'Материал', Description: 'Описание', Money: 'Деньги', Exp: 'Опыт',
  Strength: 'Сила', Dexterity: 'Ловкость', Intelligence: 'Интеллект', Health: 'Здоровье', HP: 'Здоровье', Stamina: 'Выносливость',
};
const SOURCES = [['Res/database.res', 'Одиночная игра'], ['Res/databaselmp.res', 'Сетевая игра']];

export async function mount(root, [srcArg]) {
  const S = await schema();
  const st = { src: SOURCES.some(s => s[0] === srcArg) ? srcArg : SOURCES[0][0], files: new Map(), changed: new Set(), table: null, rec: null, filter: '', infos: new Map() };

  const left = h('div.body'), tbl = h('div.scroll'), right = h('div.body'), head = h('div.rec-head'), previewBox = h('div.preview');
  const preview = createPreview(previewBox);
  const search = h('input.search', { placeholder: 'Поиск по имени…', oninput: e => { st.filter = e.target.value.toLowerCase(); renderRecords(); } });
  const saveBtn = h('button.primary', { disabled: true, onclick: save }, 'Сохранить в игру');
  const srcSel = h('select', { onchange: e => { if (st.changed.size && !confirm('Несохранённые изменения пропадут. Продолжить?')) { e.target.value = st.src; return; } location.hash = 'database/' + e.target.value; } },
    SOURCES.map(([v, t]) => h('option', { value: v, selected: v === st.src }, t)));
  root.append(h('div.work',
    h('div.side', h('div.head', h('h3', 'Таблицы'), srcSel), left),
    h('div.center', h('div.toolbar', search, h('button', { onclick: () => recordAction('dup') }, '⧉ Дублировать'), h('button.danger', { onclick: () => recordAction('del') }, '✕ Удалить'), h('span.sp'), saveBtn), tbl),
    h('div.side.right', h('div.head', h('h3', 'Свойства записи')), head, right),
  ));

  const entries = readRes(await api.file(st.src));
  for (const e of entries) {
    const db = dbForFile(S, e.name);
    if (db && !e.name.endsWith('.adb')) st.files.set(e.name.toLowerCase(), { name: e.name, db, data: readDatabase(e.data, db) });
  }
  renderTables();

  function markChanged() { st.changed.add(st.table.file); saveBtn.disabled = false; dirty.add('database'); }

  function renderTables() {
    left.replaceChildren(h('ul.list', TABLES.flatMap(([group, items]) => [
      h('li.group', group),
      ...items.map(([file, bid, title]) => {
        const f = st.files.get(file), t = f?.data.tables.find(x => x.id === bid);
        if (!t) return null;
        return h('li', { className: st.table?.t === t ? 'sel' : '', onclick: () => { st.table = { file, t, db: f.db }; st.rec = null; renderTables(); renderRecords(); renderRecord(); loadInfos(); } }, title, h('small', t.records.length));
      }),
    ])));
  }

  const fieldNode = (rec, id) => rec.children?.find(c => c.id === id);
  const headerOf = (bid, fid, i = 0) => st.table.db.headers[bid]?.[fid]?.[i];
  const typeOf = (bid, fid) => st.table.db.types[bid]?.[fid];
  const recName = rec => { const f = rec.children?.find(c => c.data && /^(Fixed)?String$/.test(typeOf(st.table.t.id, c.id) || '')); return f ? fieldView('String', f.data).text : '(без имени)'; };

  // In-game name, icon and model of every record of the open table (from texts.res / figures.res).
  const valOf = (t, r) => f => { const n = fieldNode(r, f); return n?.data ? fieldView(st.table.db.types[t.id]?.[f], n.data).text : ''; };
  async function loadInfos() {
    const tb = st.table;
    for (const r of tb.t.records) st.infos.set(r, await recordInfo(tb.db, tb.t.id, valOf(tb.t, r)));
    if (st.table === tb) { renderRecords(); renderRecord(); }
  }
  const iconImg = name => { const img = h('img.icon', { alt: '' }); if (name) textureDataUrl(name).then(u => { if (u) img.src = u; }); else img.style.visibility = 'hidden'; return img; };

  function renderRecords() {
    if (!st.table) { tbl.replaceChildren(h('div.empty', 'Выберите таблицу слева')); return; }
    const { t } = st.table;
    // first 6 simple columns after the in-game name
    const cols = (t.records[0]?.children || []).filter(c => c.data).slice(0, 6).map(c => c.id);
    const hasIcons = t.records.some(r => st.infos.get(r)?.icon);
    const rows = t.records.map((r, i) => ({ r, i, name: recName(r), info: st.infos.get(r) || {} }))
      .filter(x => !st.filter || x.name.toLowerCase().includes(st.filter) || x.info.title?.toLowerCase().includes(st.filter));
    tbl.replaceChildren(h('table.grid',
      h('thead', h('tr', h('th', '#'), h('th', 'Название в игре'), cols.map(id => h('th', { title: headerOf(t.id, id)?.desc || '' }, RU[headerOf(t.id, id)?.name] || headerOf(t.id, id)?.name || `Поле ${id}`)))),
      h('tbody', rows.map(({ r, i, name, info }) => h('tr', { className: r === st.rec ? 'sel' : '', onclick: () => { st.rec = r; renderRecords(); renderRecord(); } },
        h('td.muted', i + 1),
        h('td', h('div.named', hasIcons ? iconImg(info.icon) : null, h('span', info.title || name, info.title ? h('small.sub', name) : null))),
        cols.map(id => { const f = fieldNode(r, id); return h('td', f?.data ? fieldView(typeOf(t.id, id), f.data).text : ''); })))),
    ));
  }

  let shown = null;
  async function renderHead() {
    const rec = st.rec, info = rec && st.infos.get(rec);
    if (!rec) return head.replaceChildren();
    head.replaceChildren(h('div.rec-title', info?.icon ? iconImg(info.icon) : null, h('div', h('b', info?.title || recName(rec)), info?.title ? h('small.sub', recName(rec)) : null)),
      ...(info?.model ? [previewBox] : []));
    const key = info?.model && JSON.stringify(info.model);
    if (!key || key === shown) return;
    shown = key;
    const m = info.model, data = m.fig ? await loadFigModel(m.name) : undefined;
    const obj = (m.fig && !data) ? null : await buildModel(m.name, { data, texture: m.texture, complection: m.complection || undefined });
    if (shown === key) preview.show(obj);
  }

  function fieldInput(bid, node, onSet) {
    const type = typeOf(bid, node.id), v = fieldView(type, node.data);
    const headers = st.table.db.headers[bid]?.[node.id] || [];
    if (v.type.startsWith('BitList') && headers.filter(Boolean).length > 1) {
      return h('div.row', { style: { flexWrap: 'wrap' } }, [...v.text].map((b, i) => headers[i] ? h('label', h('input', { type: 'checkbox', checked: b === '1', onchange: e => {
        const bits = [...fieldView(type, node.data).text]; bits[i] = e.target.checked ? '1' : '0'; onSet(type, bits.join(''));
      } }), ' ', headers[i].name) : null));
    }
    const long = v.text.length > 40 || /List/.test(v.type);
    const el = h(long ? 'textarea' : 'input', { value: v.text, rows: long ? 2 : undefined, title: v.type, onchange: e => onSet(v.type, e.target.value) });
    return el;
  }

  function renderRecord() {
    const rec = st.rec;
    renderHead();
    if (!rec) { right.replaceChildren(h('div.empty', 'Выберите запись в таблице')); return; }
    const bid = st.table.t.id;
    const set = (node) => (type, text) => {
      try { node.data = textToField(type, text, node.data); markChanged(); recordInfo(st.table.db, bid, valOf(st.table.t, rec)).then(i => { st.infos.set(rec, i); renderRecords(); renderHead(); }); }
      catch (e) { toast('Неверное значение: ' + e.message, 'err'); }
    };
    right.replaceChildren(h('div.form', rec.children.map(node => {
      const hd = headerOf(bid, node.id), name = hd?.name || `Поле ${node.id}`;
      const label = h('label', RU[name] || name, RU[name] ? h('small', ` (${name})`) : null, hd?.desc ? h('small', ' — ' + hd.desc) : null);
      if (node.children) {
        const sub = +(typeOf(bid, node.id)?.match(/\((\d+)\)/)?.[1] || 0);
        return h('div.f', label, h('div.form', { style: { paddingLeft: '10px', borderLeft: '2px solid var(--line)' } }, node.children.map(c => c.data
          ? h('div.f', h('label', st.table.db.headers[sub]?.[c.id]?.[0]?.name || `Под-поле ${c.id}`), (() => { const t = typeOf(sub, c.id), v = fieldView(t, c.data); return h('input', { value: v.text, onchange: e => { c.data = textToField(v.type, e.target.value, c.data); markChanged(); } }); })())
          : h('div.muted', `Вложенный блок ${c.id}`))));
      }
      return h('div.f', label, fieldInput(bid, node, set(node)));
    })));
  }

  function recordAction(kind) {
    if (!st.rec) return toast('Сначала выберите запись', 'err');
    const list = st.table.t.records, i = list.indexOf(st.rec);
    if (kind === 'del') {
      if (!confirm(`Удалить «${st.infos.get(st.rec)?.title || recName(st.rec)}»? Если она используется на картах или в других таблицах, игра может упасть.`)) return;
      list.splice(i, 1); st.rec = list[Math.min(i, list.length - 1)] || null;
    } else {
      const copy = structuredClone(st.rec);
      const nameNode = copy.children.find(c => c.data && /^String$/.test(typeOf(st.table.t.id, c.id) || ''));
      if (nameNode) nameNode.data = textToField('String', fieldView('String', nameNode.data).text + ' copy');
      list.splice(i + 1, 0, copy); st.rec = copy; st.infos.set(copy, st.infos.get(list[i]));
      toast('Создана копия. Переименуйте её в поле «Имя» — имя должно быть уникальным.');
    }
    markChanged(); renderTables(); renderRecords(); renderRecord();
  }

  async function save() {
    const put = [...st.changed].map(k => { const f = st.files.get(k); return { name: f.name, data: writeDatabase(f.data) }; });
    await guard(async () => {
      await api.resUpdate(st.src, put);
      st.changed.clear(); saveBtn.disabled = true; dirty.delete('database');
    }, 'База сохранена. Запустите игру, чтобы увидеть изменения.');
  }

  renderRecords(); renderRecord();
  return () => preview.dispose();
}
