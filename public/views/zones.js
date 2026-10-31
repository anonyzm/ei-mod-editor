// World structure: texts.res/map.txt lists every zone (#zone id allod type), its files, global-map
// position and exits. Here: browse islands/zones, edit zone blocks, create a new zone wired into the world.
import { api, h, guard, toast, dirty } from '/app.js';
import { parseWorld, worldText, directive, exitsOf, ISLAND, loadWorld, saveWorld, createZone } from '/shared/world.js';
import { loadModelData } from '/lib/eiscene.js';
import { zoneTitles } from '/lib/gamedb.js';

export { parseWorld };
const TYPE = { game: ['⛰', 'игровая зона'], brief: ['⌂', 'база / брифинг'], edge: ['↔', 'переход'] };
export async function mount(root) {
  const st = { world: null, sel: null, changed: false };
  const list = h('div.body'), right = h('div.body'), canvas = h('canvas', { style: { width: '100%', height: '100%', display: 'block', cursor: 'pointer' } });
  const saveBtn = h('button.primary', { disabled: true, onclick: save }, 'Сохранить в игру');
  root.append(h('div.work', { style: { gridTemplateColumns: '280px minmax(0,1fr) 420px' } },
    h('div.side', h('div.head', h('h3', 'Острова и зоны'), h('button', { onclick: wizard }, '+ Новая зона')), list),
    h('div.center', h('div.toolbar', h('span.hint', 'Глобальная карта: точки — зоны, линии — переходы. Позиции берутся из #position.'), h('span.sp'), saveBtn), h('div.viewport', canvas)),
    h('div.side.right', h('div.head', h('h3', 'Зона')), right),
  ));
  const io = { ...api, loadModelData };
  st.world = await loadWorld(io);
  const byId = () => new Map(st.world.blocks.map(b => [b.id, b]));
  // In-game names (texts.res); transitions are named "From → To". ids go small and grey underneath.
  let names = await zoneTitles(st.world.blocks);
  const title = id => names.get(id) || id;
  const idLine = b => [b.id, directive(b.text, 'res')?.split(/\s+/)[0]].filter(Boolean).join(' · ');

  function renderList() {
    const groups = {};
    for (const b of st.world.blocks) (groups[b.allod] ??= []).push(b);
    list.replaceChildren(h('ul.list', Object.entries(groups).map(([al, bs]) => [h('li.group', ISLAND[al] || al),
      bs.map(b => h('li', { className: b === st.sel ? 'sel' : '', title: TYPE[b.type]?.[1], onclick: () => select(b) }, (TYPE[b.type]?.[0] || '?') + ' ' + title(b.id),
        h('small.sub', idLine(b))))])));
  }
  function select(b) { st.sel = b; renderList(); renderRight(); draw(); }

  function renderRight() {
    const b = st.sel;
    if (!b) return right.replaceChildren(h('div.empty', 'Выберите зону слева или на карте.'), h('p.muted', 'Типы: ⛰ игровая зона (карта), ⌂ база/брифинг, ↔ переход между зонами (путь на глобальной карте).'));
    const res = directive(b.text, 'res')?.split(/\s+/);
    const exits = exitsOf(b.text), ids = byId();
    right.replaceChildren(h('div.form',
      h('h4', title(b.id), h('small.sub', `${TYPE[b.type]?.[1] || b.type} · ${idLine(b)}`)),
      res ? h('div.row', h('a', { href: `#map/${res[1]}.mob/${res[0]}.mpr`, style: { flex: 'none' } }, h('button.primary', 'Открыть карту зоны'))) : null,
      exits.length ? h('div.f', h('label', 'Переходы'), h('ul.list', exits.map(x => h('li', { onclick: () => ids.get(x.to) && select(ids.get(x.to)) }, `Выход ${x.n} → ${title(x.to)}`, h('small.sub', `${x.to} · вход №${x.entrance}`))))) : null,
      h('div.f', h('label', 'Описание зоны (формат map.txt)'), h('textarea.code', { rows: 26, value: b.text.replace(/\r\n/g, '\n'), oninput: e => { b.text = e.target.value.replace(/\n/g, '\r\n'); mark(); } })),
      h('details', h('summary.muted', 'Справка по командам'), h('pre.code.muted', { style: { whiteSpace: 'pre-wrap' } }, st.world.head.split(/\r?\n/).filter(l => l.startsWith('##')).slice(0, 34).join('\n'))),
    ));
  }
  function mark() { st.changed = true; saveBtn.disabled = false; dirty.add('zones'); }

  // ---- global map drawing ----
  const pts = new Map();
  function draw() {
    const r = canvas.getBoundingClientRect(), W = canvas.width = r.width * devicePixelRatio, H = canvas.height = r.height * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#20242b'; ctx.fillRect(0, 0, W, H);
    // one island at a time; positions are 3D points on the globe, so project onto the two axes with most spread
    const island = st.sel?.allod || st.world.blocks.find(b => b.allod)?.allod;
    const pos = new Map();
    for (const b of st.world.blocks) { const p = directive(b.text, 'position')?.split(/\s+/).map(Number); if (b.allod === island && p?.length === 3 && p.every(Number.isFinite)) pos.set(b.id, p); }
    if (!pos.size) return;
    const vals = [...pos.values()], spread = [0, 1, 2].map(i => { const v = vals.map(p => p[i]); return Math.max(...v) - Math.min(...v); });
    const [ax, ay] = [0, 1, 2].sort((a, b) => spread[b] - spread[a]);
    for (const [k, p] of pos) pos.set(k, [p[ax], p[ay]]);
    ctx.fillStyle = '#c9c5bb'; ctx.font = `${14 * devicePixelRatio}px Segoe UI`; ctx.fillText(ISLAND[island] || island, 12 * devicePixelRatio, 22 * devicePixelRatio);
    const xs = [...pos.values()].map(p => p[0]), ys = [...pos.values()].map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], pad = 40 * devicePixelRatio;
    const sx = (W - 2 * pad) / Math.max(1e-6, x1 - x0), sy = (H - 2 * pad) / Math.max(1e-6, y1 - y0), s = Math.min(sx, sy);
    const P = p => [pad + (p[0] - x0) * s, H - pad - (p[1] - y0) * s];
    pts.clear();
    ctx.lineWidth = 1.5 * devicePixelRatio; ctx.strokeStyle = '#5b6372';
    for (const b of st.world.blocks) for (const x of exitsOf(b.text)) if (pos.has(b.id) && pos.has(x.to)) { const [a, c] = [P(pos.get(b.id)), P(pos.get(x.to))]; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...c); ctx.stroke(); }
    ctx.font = `${12 * devicePixelRatio}px Segoe UI`;
    for (const b of st.world.blocks) {
      if (!pos.has(b.id)) continue;
      const [x, y] = P(pos.get(b.id)), sel = b === st.sel, rad = (b.type === 'game' ? 7 : b.type === 'brief' ? 6 : 3) * devicePixelRatio;
      pts.set(b.id, [x, y]);
      ctx.fillStyle = sel ? '#d9a441' : b.type === 'game' ? '#7fb069' : b.type === 'brief' ? '#6fa3d9' : '#8a8f99';
      ctx.beginPath(); ctx.arc(x, y, sel ? rad + 3 : rad, 0, 7); ctx.fill();
      if (b.type !== 'edge' || sel) { ctx.fillStyle = sel ? '#d9a441' : '#c9c5bb'; ctx.fillText(title(b.id), x + rad + 3, y + 4); }
    }
  }
  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * devicePixelRatio, y = (e.clientY - r.top) * devicePixelRatio;
    let best = null, bd = 1e9;
    for (const [id, [px, py]] of pts) { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = id; } }
    if (best && bd < 20 * devicePixelRatio) select(byId().get(best));
  });
  const ro = new ResizeObserver(draw); ro.observe(canvas);
  renderList(); renderRight();

  async function save() {
    await guard(async () => {
      await saveWorld(io, st.world);
      st.changed = false; saveBtn.disabled = true; dirty.delete('zones');
    }, 'Карта мира сохранена');
  }

  // ---- new zone wizard ----
  async function wizard() {
    if (st.changed) return toast('Сначала сохраните изменения карты мира', 'err');
    const info = await api.info();
    const games = st.world.blocks.filter(b => b.type === 'game' && directive(b.text, 'res'));
    const f = {};
    const field = (k, label, el) => { f[k] = el; return h('div.f', h('label', label), el); };
    const dlg = h('dialog', { style: { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '8px', width: '560px' } });
    dlg.append(h('h3', { style: { marginTop: 0 } }, 'Новая зона'), h('div.form',
      field('id', 'Идентификатор зоны (латиница, например gz22g)', h('input', { value: 'gz22g' })),
      field('file', 'Имя файлов карты (латиница, будет Maps/<имя>.mpr и .mob)', h('input', { value: 'myzone1' })),
      field('title', 'Название (комментарий)', h('input', { value: 'Моя новая зона' })),
      field('allod', 'Остров', h('select', Object.entries(ISLAND).map(([k, v]) => h('option', { value: k }, v)))),
      field('tpl', 'Взять текстуры земли и настройки из зоны', h('select', games.map(b => h('option', { value: b.id }, `${title(b.id)} (${idLine(b)})`)))),
      field('relief', 'Рельеф', h('select', h('option', { value: 'flat' }, 'Ровная земля нужного размера'), h('option', { value: 'copy' }, 'Копия рельефа зоны-образца'))),
      h('div.row', field('sx', 'Ширина (секторов по 32 м)', h('input', { type: 'number', value: 6, min: 2, max: 16 })), field('sy', 'Высота (секторов)', h('input', { type: 'number', value: 6, min: 2, max: 16 }))),
      field('link', 'Соединить переходом с зоной', h('select', h('option', { value: '' }, '— не соединять —'), games.map(b => h('option', { value: b.id }, `${title(b.id)} (${b.id})`)))),
      h('label', h('input', { type: 'checkbox', checked: true, onchange: e => { f.open = e.target.checked; } }), ' Сразу открыть переход (добавить GSSetVar в скрипт соседней зоны)'),
      h('p.muted', 'Будут созданы файлы карты, скопированы текстуры земли и миникарты, добавлены записи в map.txt. Всё можно откатить кнопкой «Вернуть оригиналы» на главной.'),
      h('div.row', h('button.primary', { onclick: () => create().then(ok => ok && dlg.close()) }, 'Создать'), h('button', { onclick: () => dlg.close() }, 'Отмена'))));
    f.open = true;
    document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove());

    async function create() {
      return !!await guard(async () => {
        const { id } = await createZone(io, st.world, { id: f.id.value.trim(), file: f.file.value.trim(), title: f.title.value, allod: f.allod.value, tpl: f.tpl.value,
          relief: f.relief.value, sx: +f.sx.value, sy: +f.sy.value, link: f.link.value, open: f.open });
        names = await zoneTitles(st.world.blocks);
        select(byId().get(id));
        toast(`Зона ${id} создана. Откройте её карту, расставьте объекты и поправьте прямоугольники #deploy (где появится отряд).`);
        return true;
      });
    }
  }
  return () => ro.disconnect();
}
