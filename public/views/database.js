// Database editor: items, weapons, armor, materials, monsters, NPCs, spells, perks, levers, quests.
import { api, h, guard, toast, dirty } from '/app.js';
import { readRes } from '/formats/res.js';
import { dbForFile, readDatabase, writeDatabase, fieldView, textToField } from '/formats/db.js';
import { schema } from '/lib/gamedb.js';

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
  const st = { src: SOURCES.some(s => s[0] === srcArg) ? srcArg : SOURCES[0][0], files: new Map(), changed: new Set(), table: null, rec: null, filter: '' };

  const left = h('div.body'), tbl = h('div.scroll'), right = h('div.body');
  const search = h('input.search', { placeholder: 'Поиск по имени…', oninput: e => { st.filter = e.target.value.toLowerCase(); renderRecords(); } });
  const saveBtn = h('button.primary', { disabled: true, onclick: save }, 'Сохранить в игру');
  const srcSel = h('select', { onchange: e => { if (st.changed.size && !confirm('Несохранённые изменения пропадут. Продолжить?')) { e.target.value = st.src; return; } location.hash = 'database/' + e.target.value; } },
    SOURCES.map(([v, t]) => h('option', { value: v, selected: v === st.src }, t)));
  root.append(h('div.work',
    h('div.side', h('div.head', h('h3', 'Таблицы'), srcSel), left),
    h('div.center', h('div.toolbar', search, h('button', { onclick: () => recordAction('dup') }, '⧉ Дублировать'), h('button.danger', { onclick: () => recordAction('del') }, '✕ Удалить'), h('span.sp'), saveBtn), tbl),
    h('div.side.right', h('div.head', h('h3', 'Свойства записи')), right),
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
        return h('li', { className: st.table?.t === t ? 'sel' : '', onclick: () => { st.table = { file, t, db: f.db }; st.rec = null; renderTables(); renderRecords(); renderRecord(); } }, title, h('small', t.records.length));
      }),
    ])));
  }

  const fieldNode = (rec, id) => rec.children?.find(c => c.id === id);
  const headerOf = (bid, fid, i = 0) => st.table.db.headers[bid]?.[fid]?.[i];
  const typeOf = (bid, fid) => st.table.db.types[bid]?.[fid];
  const recName = rec => { const f = rec.children?.find(c => c.data && /^(Fixed)?String$/.test(typeOf(st.table.t.id, c.id) || '')); return f ? fieldView('String', f.data).text : '(без имени)'; };

  function renderRecords() {
    if (!st.table) { tbl.replaceChildren(h('div.empty', 'Выберите таблицу слева')); return; }
    const { t } = st.table;
    // first 7 simple columns
    const cols = (t.records[0]?.children || []).filter(c => c.data).slice(0, 7).map(c => c.id);
    const rows = t.records.map((r, i) => ({ r, i, name: recName(r) })).filter(x => !st.filter || x.name.toLowerCase().includes(st.filter));
    tbl.replaceChildren(h('table.grid',
      h('thead', h('tr', h('th', '#'), cols.map(id => h('th', { title: headerOf(t.id, id)?.desc || '' }, RU[headerOf(t.id, id)?.name] || headerOf(t.id, id)?.name || `Поле ${id}`)))),
      h('tbody', rows.map(({ r, i }) => h('tr', { className: r === st.rec ? 'sel' : '', onclick: () => { st.rec = r; renderRecords(); renderRecord(); } },
        h('td.muted', i + 1), cols.map(id => { const f = fieldNode(r, id); return h('td', f?.data ? fieldView(typeOf(t.id, id), f.data).text : ''); })))),
    ));
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
    if (!rec) { right.replaceChildren(h('div.empty', 'Выберите запись в таблице')); return; }
    const bid = st.table.t.id;
    const set = (node) => (type, text) => {
      try { node.data = textToField(type, text, node.data); markChanged(); renderRecords(); }
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
      if (!confirm(`Удалить «${recName(st.rec)}»? Если она используется на картах или в других таблицах, игра может упасть.`)) return;
      list.splice(i, 1); st.rec = list[Math.min(i, list.length - 1)] || null;
    } else {
      const copy = structuredClone(st.rec);
      const nameNode = copy.children.find(c => c.data && /^String$/.test(typeOf(st.table.t.id, c.id) || ''));
      if (nameNode) nameNode.data = textToField('String', fieldView('String', nameNode.data).text + ' copy');
      list.splice(i + 1, 0, copy); st.rec = copy;
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
}
