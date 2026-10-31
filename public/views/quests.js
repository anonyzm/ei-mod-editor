// Quests and dialogs: quest texts with sub-objectives, briefing dialogs (who says what, camera),
// for the campaign (texts.res) and for multiplayer quest packs (Maps/*.mq with quest.reg rewards).
import { api, h, guard, toast, dirty } from '/app.js';
import { readRes } from '/formats/res.js';
import { cp1251 } from '/formats/bytes.js';
import { readReg, writeReg, regToText, textToReg } from '/formats/reg.js';

// ---- text formats ----
export function parseQuest(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const q = { title: lines[0] || '', desc: [], subs: [] };
  let cur = null;
  for (const l of lines.slice(1)) {
    const m = l.match(/^#subobj\s+(\d+)/i);
    if (m) { cur = { n: +m[1], title: null, desc: [] }; q.subs.push(cur); continue; }
    if (!cur) q.desc.push(l); else if (cur.title === null) cur.title = l; else cur.desc.push(l);
  }
  const trim = a => a.join('\n').replace(/\n+$/, '');
  return { title: q.title, desc: trim(q.desc), subs: q.subs.map(s => ({ n: s.n, title: s.title || '', desc: trim(s.desc) })) };
}
export function questToText(q) {
  return [q.title, q.desc, ...q.subs.flatMap(s => [`#subobj  ${s.n}`, s.title, s.desc])].filter(x => x !== '').join('\r\n').replace(/\n/g, '\r\n').replace(/\r\r/g, '\r') + '\r\n';
}
export function parseBriefing(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const b = { title: lines[0] || '', items: [] };
  for (const l of lines.slice(1)) {
    const m = l.match(/^#phrase\s+(\S+)\s*(\d*)/i);
    if (m) { b.items.push({ kind: 'phrase', who: m[1], n: m[2], text: '' }); continue; }
    if (l.startsWith('#')) { b.items.push({ kind: 'cmd', line: l }); continue; }
    const last = b.items.at(-1);
    if (last?.kind === 'phrase') last.text += (last.text ? '\n' : '') + l; else if (l.trim()) b.items.push({ kind: 'note', line: l });
  }
  for (const it of b.items) if (it.kind === 'phrase') it.text = it.text.replace(/\n+$/, '');
  return b;
}
export function briefingToText(b) {
  let n = 0;
  const out = [b.title];
  for (const it of b.items) {
    if (it.kind === 'phrase') { n++; out.push(`#phrase ${it.who}  ${n}`, it.text); } else out.push(it.line);
  }
  return out.join('\n').replace(/\n/g, '\r\n') + '\r\n';
}

export async function mount(root, [srcArg]) {
  const info = await api.info();
  const mqs = info.maps.filter(f => /\.mq$/i.test(f)).sort();
  const st = { src: srcArg || 'campaign', entries: [], sel: null, put: new Map(), tab: 'quest', filter: '', reg: null };
  const isCampaign = st.src === 'campaign';
  const file = isCampaign ? 'Res/texts.res' : 'Maps/' + st.src;

  const list = h('div.body'), main = h('div.body', { style: { padding: '14px 18px' } }), right = h('div.body');
  const saveBtn = h('button.primary', { disabled: true, onclick: save }, 'Сохранить в игру');
  const tabs = h('div.tabs', h('button.on', { onclick: e => setTab(e, 'quest') }, 'Квесты'), h('button', { onclick: e => setTab(e, 'briefing') }, 'Диалоги'));
  root.append(h('div.work', { style: { gridTemplateColumns: '300px minmax(0,1fr) 340px' } },
    h('div.side',
      h('div.head', h('select', { style: { width: '100%' }, onchange: e => location.hash = 'quests/' + e.target.value },
        h('option', { value: 'campaign', selected: isCampaign }, 'Кампания (texts.res)'),
        h('optgroup', { label: 'Сетевые квесты (.mq)' }, mqs.map(m => h('option', { value: m, selected: m === st.src }, m))))),
      tabs,
      h('div.head', h('input.search', { placeholder: 'Поиск…', oninput: e => { st.filter = e.target.value.toLowerCase(); renderList(); } }), h('button', { onclick: addNew }, '+ Создать')),
      list),
    h('div.center', h('div.toolbar', h('span.hint', 'Квест: название, описание и подзадачи. Диалог: кто что говорит и куда смотрит камера.'), h('span.sp'), saveBtn), main),
    h('div.side.right', h('div.head', h('h3', isCampaign ? 'Подсказки' : 'Награды и настройки (quest.reg)')), right),
  ));
  function setTab(e, t) { for (const b of tabs.children) b.classList.toggle('on', b === e.target); st.tab = t; st.sel = null; renderList(); renderMain(); }

  st.entries = readRes(await api.file(file)).map(e => ({ name: e.name, data: e.data, text: /\.reg$/i.test(e.name) ? null : cp1251.decode(e.data) }));
  const regEntry = st.entries.find(e => /quest\.reg$/i.test(e.name));
  if (regEntry) st.reg = regToText(readReg(regEntry.data));
  const kindOf = e => e.name.split(' ')[0].toLowerCase();
  renderList(); renderMain(); renderRight();

  function renderList() {
    const items = st.entries.filter(e => kindOf(e) === st.tab && (!st.filter || e.name.toLowerCase().includes(st.filter) || e.text?.toLowerCase().includes(st.filter)));
    list.replaceChildren(h('ul.list', items.map(e => h('li', { className: e === st.sel ? 'sel' : '', title: e.name, onclick: () => { st.sel = e; renderList(); renderMain(); } },
      (e.text || '').split(/\r?\n/)[0] || e.name, h('small', e.name.replace(/^\S+\s/, ''))))));
  }
  function changed(e, text) { e.text = text; st.put.set(e.name, e); saveBtn.disabled = false; dirty.add('quests'); }

  function renderMain() {
    const e = st.sel;
    if (!e) return main.replaceChildren(h('div.empty', st.tab === 'quest' ? 'Выберите квест слева или создайте новый.' : 'Выберите диалог слева.'));
    if (st.tab === 'quest') return main.replaceChildren(questForm(e));
    main.replaceChildren(briefingForm(e));
  }

  function questForm(e) {
    const q = parseQuest(e.text);
    const upd = () => changed(e, questToText(q));
    const subList = h('div.form');
    const drawSubs = () => subList.replaceChildren(...q.subs.map((s, i) => h('div.phrase',
      h('div.who', h('b', `Подзадача ${s.n}`), h('span.sp', { style: { flex: 1 } }), h('button.danger', { onclick: () => { q.subs.splice(i, 1); upd(); drawSubs(); } }, '✕')),
      h('input', { value: s.title, placeholder: 'Название подзадачи', oninput: ev => { s.title = ev.target.value; upd(); } }),
      h('textarea', { rows: 2, value: s.desc, placeholder: 'Описание', oninput: ev => { s.desc = ev.target.value; upd(); } }))));
    drawSubs();
    const id = e.name.replace(/^quest\s+/i, '');
    return h('div.form', { style: { maxWidth: '760px' } },
      h('h2', { style: { margin: 0 } }, 'Квест ', h('code', id)),
      h('div.f', h('label', 'Название (в журнале)'), h('input', { value: q.title, oninput: ev => { q.title = ev.target.value; upd(); } })),
      h('div.f', h('label', 'Описание'), h('textarea', { rows: 5, value: q.desc, oninput: ev => { q.desc = ev.target.value; upd(); } })),
      h('h4', 'Подзадачи'), subList,
      h('button', { onclick: () => { q.subs.push({ n: Math.max(0, ...q.subs.map(s => s.n)) + 1, title: '', desc: '' }); upd(); drawSubs(); } }, '+ Подзадача'),
      h('h4', 'Как запустить квест из скрипта карты'),
      h('pre.code.muted', `QStart( "${id}" )\nQObjKillUnit( ... )   // цели — по номерам подзадач\nQFinish(  )`));
  }

  function briefingForm(e) {
    const b = parseBriefing(e.text);
    const upd = () => changed(e, briefingToText(b));
    const actors = () => [...new Set(['Hero', ...b.items.filter(i => i.kind === 'cmd' && /^#show\s/i.test(i.line)).map(i => i.line.split(/\s+/)[1]), ...b.items.filter(i => i.kind === 'phrase').map(i => i.who)])];
    const box = h('div.form');
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= b.items.length) return; [b.items[i], b.items[j]] = [b.items[j], b.items[i]]; upd(); draw(); };
    const draw = () => box.replaceChildren(...b.items.map((it, i) => {
      const ctl = h('span', { style: { display: 'flex', gap: '4px', marginLeft: 'auto' } }, h('button', { title: 'Выше', onclick: () => move(i, -1) }, '↑'), h('button', { title: 'Ниже', onclick: () => move(i, 1) }, '↓'), h('button.danger', { onclick: () => { b.items.splice(i, 1); upd(); draw(); } }, '✕'));
      if (it.kind === 'phrase') return h('div.phrase',
        h('div.who', h('select', { onchange: ev => { it.who = ev.target.value; upd(); } }, actors().map(a => h('option', { value: a, selected: a === it.who }, a === 'Hero' ? 'Герой (Hero)' : a))), ctl),
        h('textarea', { rows: 3, value: it.text, oninput: ev => { it.text = ev.target.value; upd(); } }));
      return h('div.phrase', { style: { background: 'var(--panel2)' } }, h('div.who', h('input', { value: it.line, style: { flex: 1 }, title: '#show Имя — показать персонажа, #hide Имя — убрать, #CAMERA N — ракурс камеры', oninput: ev => { it.line = ev.target.value; upd(); } }), ctl));
    }));
    draw();
    return h('div.form', { style: { maxWidth: '760px' } },
      h('h2', { style: { margin: 0 } }, 'Диалог ', h('code', e.name.replace(/^briefing\s+/i, ''))),
      h('div.f', h('label', 'Заголовок'), h('input', { value: b.title, oninput: ev => { b.title = ev.target.value; upd(); } })),
      box,
      h('div.row',
        h('button', { onclick: () => { b.items.push({ kind: 'phrase', who: actors()[1] || 'Hero', text: '' }); upd(); draw(); } }, '+ Реплика'),
        h('button', { onclick: () => { b.items.push({ kind: 'cmd', line: '#CAMERA 1' }); upd(); draw(); } }, '+ Камера'),
        h('button', { onclick: () => { const n = prompt('Имя персонажа на карте (имя объекта в .mob):'); if (n) { b.items.unshift({ kind: 'cmd', line: '#show ' + n }); upd(); draw(); } } }, '+ Персонаж')),
      h('p.muted', 'Имена персонажей — это имена существ на карте. Hero — главный герой.'));
  }

  function renderRight() {
    if (!st.reg) return right.replaceChildren(h('div.form',
      h('p.muted', 'Награды кампании (деньги, опыт, выдаваемые предметы и квесты) хранятся в базе данных:'),
      h('a', { href: '#database' }, '→ Предметы, существа, магия → Мир → Квесты / Брифинги'),
      h('p.muted', 'Квест запускается из скрипта карты командой QStart("имя"). Скрипт карты редактируется в разделе «Карты» на вкладке «Скрипт карты».')));
    right.replaceChildren(h('div.form',
      h('p.muted', '[quest] — опыт и деньги за квест; [briefing receive/reject/complete] — какой диалог показать и что выдать. Формат: ключ=значение, :i — целое, :f — дробное, [] — список.'),
      h('textarea.code', { rows: 28, value: st.reg, oninput: e => { st.reg = e.target.value; saveBtn.disabled = false; dirty.add('quests'); st.regChanged = true; } })));
  }

  function addNew() {
    if (st.tab === 'quest') {
      const id = prompt('Внутреннее имя квеста латиницей, например: myquest1');
      if (!id) return;
      const name = 'quest ' + id;
      if (st.entries.some(e => e.name.toLowerCase() === name)) return toast('Такой квест уже есть', 'err');
      const e = { name, text: '' };
      st.entries.push(e); changed(e, questToText({ title: 'Новый квест', desc: 'Описание квеста', subs: [{ n: 1, title: 'Первая цель', desc: 'Что нужно сделать' }] }));
      st.sel = e;
    } else {
      const id = prompt('Имя диалога, например: myquest_1');
      if (!id) return;
      const e = { name: 'briefing ' + id, text: '' };
      st.entries.push(e); changed(e, briefingToText({ title: 'Новый диалог', items: [{ kind: 'cmd', line: '#show Hero' }, { kind: 'phrase', who: 'Hero', text: 'Привет!' }] }));
      st.sel = e;
    }
    renderList(); renderMain();
  }

  async function save() {
    await guard(async () => {
      const put = [...st.put.values()].map(e => ({ name: e.name, data: cp1251.encode(e.text) }));
      if (st.regChanged && regEntry) put.push({ name: regEntry.name, data: writeReg(textToReg(st.reg)) });
      await api.resUpdate(file, put);
      st.put.clear(); st.regChanged = false; saveBtn.disabled = true; dirty.delete('quests');
    }, 'Квесты и диалоги сохранены');
  }
}
