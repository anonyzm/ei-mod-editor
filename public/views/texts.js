// All game texts (texts.res / textslmp.res): names and descriptions of everything, quests, briefings, tips.
import { api, h, guard, toast, dirty } from '/app.js';
import { readRes } from '/formats/res.js';
import { cp1251 } from '/formats/bytes.js';

const SOURCES = [['Res/texts.res', 'Одиночная игра'], ['Res/textslmp.res', 'Сетевая игра']];
const GROUPS = {
  armor: 'Доспехи', weapon: 'Оружие', unit: 'Существа', quest: 'Квесты', briefing: 'Брифинги (диалоги)', string: 'Строки интерфейса',
  tip: 'Подсказки', tutor: 'Обучение', tutorial: 'Обучение', instr: 'Инструкции', perk: 'Умения', spell: 'Заклинания', modifier: 'Модификаторы',
  material: 'Материалы', matshort: 'Материалы (кратко)', questitem: 'Квестовые предметы', qitem: 'Расходуемые', litem: 'Трофеи', pers: 'Персонажи',
  zone: 'Зоны', say: 'Реплики', allod: 'Аллоды', camphelp: 'Справка', 'map.txt': 'Карта мира',
};

export async function mount(root, [srcArg]) {
  const st = { src: SOURCES.some(s => s[0] === srcArg) ? srcArg : SOURCES[0][0], entries: [], group: '', filter: '', sel: null, put: new Map(), remove: new Set() };
  const left = h('div.body'), list = h('div.body'), editor = h('div.body');
  const saveBtn = h('button.primary', { disabled: true, onclick: save }, 'Сохранить в игру');
  const search = h('input.search', { placeholder: 'Поиск по имени и тексту…', oninput: e => { st.filter = e.target.value.toLowerCase(); renderList(); } });
  root.append(h('div.work', { style: { gridTemplateColumns: '220px 320px minmax(0,1fr)' } },
    h('div.side', h('div.head', h('h3', 'Разделы'), h('select', { onchange: e => location.hash = 'texts/' + e.target.value }, SOURCES.map(([v, t]) => h('option', { value: v, selected: v === st.src }, t)))), left),
    h('div.side', h('div.head', search, h('button', { onclick: addEntry }, '+ Новый текст')), list),
    h('div.center', h('div.toolbar', h('span.hint', 'Тексты в кодировке Windows-1251. Строки с # — служебные команды игры.'), h('span.sp'), saveBtn), editor),
  ));

  st.entries = readRes(await api.file(st.src)).map(e => ({ name: e.name, text: cp1251.decode(e.data) }));
  const groupOf = e => e.name.split(' ')[0].toLowerCase();
  renderGroups(); renderList(); renderEditor();

  function renderGroups() {
    const counts = {};
    for (const e of st.entries) counts[groupOf(e)] = (counts[groupOf(e)] || 0) + 1;
    left.replaceChildren(h('ul.list', h('li', { className: st.group ? '' : 'sel', onclick: () => { st.group = ''; renderGroups(); renderList(); } }, 'Все', h('small', st.entries.length)),
      Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([g, n]) => h('li', { className: st.group === g ? 'sel' : '', onclick: () => { st.group = g; renderGroups(); renderList(); } }, GROUPS[g] || g, h('small', n)))));
  }
  function renderList() {
    const items = st.entries.filter(e => (!st.group || groupOf(e) === st.group) && (!st.filter || e.name.toLowerCase().includes(st.filter) || e.text.toLowerCase().includes(st.filter)));
    list.replaceChildren(h('ul.list', items.slice(0, 800).map(e => h('li', { className: e === st.sel ? 'sel' : '', title: e.name, onclick: () => { st.sel = e; renderList(); renderEditor(); } },
      e.text.split('\n')[0].slice(0, 60) || e.name, h('small', e.name)))), items.length > 800 ? h('div.muted', `…и ещё ${items.length - 800}`) : null);
  }
  function renderEditor() {
    const e = st.sel;
    if (!e) return editor.replaceChildren(h('div.empty', 'Выберите текст слева. Первая строка обычно — название, дальше — описание.'));
    editor.replaceChildren(h('div.form',
      h('div.f', h('label', 'Ключ (имя записи)'), h('input', { value: e.name, onchange: ev => { st.remove.add(e.name); st.put.delete(e.name); e.name = ev.target.value; changed(e); renderList(); } })),
      h('div.f', h('label', 'Текст'), h('textarea.code', { rows: 24, value: e.text.replace(/\r\n/g, '\n'), style: { whiteSpace: 'pre-wrap' }, oninput: ev => { e.text = ev.target.value.replace(/\n/g, '\r\n'); changed(e); } })),
      h('div.row', h('button.danger', { onclick: () => { if (!confirm(`Удалить текст «${e.name}»?`)) return; st.entries.splice(st.entries.indexOf(e), 1); st.remove.add(e.name); st.put.delete(e.name); st.sel = null; mark(); renderGroups(); renderList(); renderEditor(); } }, '✕ Удалить'), h('span')),
    ));
  }
  function changed(e) { st.put.set(e.name, e); st.remove.delete(e.name); mark(); }
  function mark() { saveBtn.disabled = false; dirty.add('texts'); }
  function addEntry() {
    const name = prompt('Ключ нового текста, например: "quest myquest" или "string my_label"');
    if (!name) return;
    if (st.entries.some(e => e.name.toLowerCase() === name.toLowerCase())) return toast('Такой ключ уже есть', 'err');
    const e = { name, text: 'Название\r\nОписание' };
    st.entries.push(e); st.sel = e; changed(e); renderGroups(); renderList(); renderEditor();
  }
  async function save() {
    await guard(async () => {
      await api.resUpdate(st.src, [...st.put.values()].map(e => ({ name: e.name, data: cp1251.encode(e.text) })), [...st.remove]);
      st.put.clear(); st.remove.clear(); saveBtn.disabled = true; dirty.delete('texts');
    }, 'Тексты сохранены');
  }
}
