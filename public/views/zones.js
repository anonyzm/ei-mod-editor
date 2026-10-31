// World structure: texts.res/map.txt lists every zone (#zone id allod type), its files, global-map
// position and exits. Here: browse islands/zones, edit zone blocks, create a new zone wired into the world.
import { api, h, guard, toast, dirty } from '/app.js';
import { readRes } from '/formats/res.js';
import { cp1251 } from '/formats/bytes.js';
import { readMob, writeMob, getScript, setScript, listObjects, getField, OBJ } from '/formats/mob.js';
import { readMpr, writeMpr, newMpr } from '/formats/mpr.js';
import { AIGRAPH_ID, readAiGraph, writeAiGraph, buildAiGraph, modelBox } from '/formats/aigraph.js';
import { loadModelData } from '/lib/eiscene.js';

const TYPE = { game: ['⛰', 'игровая зона'], brief: ['⌂', 'база / брифинг'], edge: ['↔', 'переход'] };
const ISLAND = { gipat: 'Гипат', ingos: 'Ингос', suslanger: 'Суслангер' };

// map.txt -> { head, blocks: [{ id, allod, type, text }] }; text is kept verbatim for lossless saves.
export function parseWorld(text) {
  const parts = text.split(/(?=^#zone\s)/m);
  const head = parts[0].startsWith('#zone') ? '' : parts.shift();
  return { head, blocks: parts.map(t => { const [, id, allod, type] = t.match(/^#zone\s+(\S+)\s+(\S+)\s+(\S+)/) || []; return { id, allod, type, text: t }; }) };
}
const worldText = w => w.head + w.blocks.map(b => b.text).join('');
const directive = (text, name) => { const m = text.match(new RegExp(`^#${name}\\s*\\r?\\n([^#\\r\\n][^\\r\\n]*)`, 'mi')); return m?.[1].trim(); };
const exitsOf = text => [...text.matchAll(/^#exit\s+(\d+)\s*\r?\n\s*(\S+)\s+(\S+)/gmi)].map(m => ({ n: +m[1], to: m[2], entrance: +m[3] }));

export async function mount(root) {
  const st = { world: null, sel: null, changed: false };
  const list = h('div.body'), right = h('div.body'), canvas = h('canvas', { style: { width: '100%', height: '100%', display: 'block', cursor: 'pointer' } });
  const saveBtn = h('button.primary', { disabled: true, onclick: save }, 'Сохранить в игру');
  root.append(h('div.work', { style: { gridTemplateColumns: '280px minmax(0,1fr) 420px' } },
    h('div.side', h('div.head', h('h3', 'Острова и зоны'), h('button', { onclick: wizard }, '+ Новая зона')), list),
    h('div.center', h('div.toolbar', h('span.hint', 'Глобальная карта: точки — зоны, линии — переходы. Позиции берутся из #position.'), h('span.sp'), saveBtn), h('div.viewport', canvas)),
    h('div.side.right', h('div.head', h('h3', 'Зона')), right),
  ));
  const textsEntries = readRes(await api.file('Res/texts.res'));
  st.world = parseWorld(cp1251.decode(textsEntries.find(e => e.name.toLowerCase() === 'map.txt').data));
  const byId = () => new Map(st.world.blocks.map(b => [b.id, b]));

  function renderList() {
    const groups = {};
    for (const b of st.world.blocks) (groups[b.allod] ??= []).push(b);
    list.replaceChildren(h('ul.list', Object.entries(groups).map(([al, bs]) => [h('li.group', ISLAND[al] || al),
      bs.map(b => h('li', { className: b === st.sel ? 'sel' : '', title: TYPE[b.type]?.[1], onclick: () => select(b) }, (TYPE[b.type]?.[0] || '?') + ' ' + b.id,
        h('small', directive(b.text, 'res')?.split(/\s+/)[0] || '')))])));
  }
  function select(b) { st.sel = b; renderList(); renderRight(); draw(); }

  function renderRight() {
    const b = st.sel;
    if (!b) return right.replaceChildren(h('div.empty', 'Выберите зону слева или на карте.'), h('p.muted', 'Типы: ⛰ игровая зона (карта), ⌂ база/брифинг, ↔ переход между зонами (путь на глобальной карте).'));
    const res = directive(b.text, 'res')?.split(/\s+/);
    const exits = exitsOf(b.text), ids = byId();
    right.replaceChildren(h('div.form',
      h('h4', `${TYPE[b.type]?.[1] || b.type}: ${b.id}`),
      res ? h('div.row', h('a', { href: `#map/${res[1]}.mob/${res[0]}.mpr`, style: { flex: 'none' } }, h('button.primary', 'Открыть карту зоны'))) : null,
      exits.length ? h('div.f', h('label', 'Переходы'), h('ul.list', exits.map(x => h('li', { onclick: () => ids.get(x.to) && select(ids.get(x.to)) }, `Выход ${x.n} → ${x.to}`, h('small', `вход №${x.entrance}`))))) : null,
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
      if (b.type !== 'edge' || sel) { ctx.fillStyle = sel ? '#d9a441' : '#c9c5bb'; ctx.fillText(b.id, x + rad + 3, y + 4); }
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
      await api.resUpdate('Res/texts.res', [{ name: 'map.txt', data: cp1251.encode(worldText(st.world)) }]);
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
      field('tpl', 'Взять текстуры земли и настройки из зоны', h('select', games.map(b => h('option', { value: b.id }, b.id + ' — ' + directive(b.text, 'res'))))),
      field('relief', 'Рельеф', h('select', h('option', { value: 'flat' }, 'Ровная земля нужного размера'), h('option', { value: 'copy' }, 'Копия рельефа зоны-образца'))),
      h('div.row', field('sx', 'Ширина (секторов по 32 м)', h('input', { type: 'number', value: 6, min: 2, max: 16 })), field('sy', 'Высота (секторов)', h('input', { type: 'number', value: 6, min: 2, max: 16 }))),
      field('link', 'Соединить переходом с зоной', h('select', h('option', { value: '' }, '— не соединять —'), games.map(b => h('option', { value: b.id }, b.id)))),
      h('label', h('input', { type: 'checkbox', checked: true, onchange: e => { f.open = e.target.checked; } }), ' Сразу открыть переход (добавить GSSetVar в скрипт соседней зоны)'),
      h('p.muted', 'Будут созданы файлы карты, скопированы текстуры земли и миникарты, добавлены записи в map.txt. Всё можно откатить кнопкой «Вернуть оригиналы» на главной.'),
      h('div.row', h('button.primary', { onclick: () => create().then(ok => ok && dlg.close()) }, 'Создать'), h('button', { onclick: () => dlg.close() }, 'Отмена'))));
    f.open = true;
    document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove());

    async function create() {
      const id = f.id.value.trim(), file = f.file.value.trim().toLowerCase(), tplBlock = st.world.blocks.find(b => b.id === f.tpl.value);
      if (!/^[a-z0-9_]+$/i.test(id) || !/^[a-z0-9_]+$/.test(file)) { toast('Используйте только латиницу, цифры и _', 'err'); return false; }
      if (byId().has(id)) { toast('Зона с таким идентификатором уже есть', 'err'); return false; }
      if (info.maps.some(m => m.toLowerCase() === file + '.mpr' || m.toLowerCase() === file + '.mob')) { toast('Файлы с таким именем уже есть в Maps', 'err'); return false; }
      const [tplMpr, tplMob] = directive(tplBlock.text, 'res').split(/\s+/);
      return !!await guard(async () => {
        // landscape
        const src = readMpr(await api.file(`Maps/${tplMpr}.mpr`));
        let map;
        if (f.relief.value === 'copy') { map = src; map.name = file; for (let i = 0; i < map.sx * map.sy; i++) map.dirty.add(i); }
        else { map = newMpr(file, +f.sx.value, +f.sy.value, { textures: src.textures, maxZ: src.maxZ }); map.materials = src.materials; map.tileTypes = src.tileTypes; map.animTiles = src.animTiles; }
        await api.saveFile(`Maps/${file}.mpr`, writeMpr(map));
        // textures: terrain atlases + minimap + objectives map
        const texList = await api.resList('Res/textures.res');
        const has = n => texList.find(t => t.name.toLowerCase() === n.toLowerCase());
        const put = [];
        for (let i = 0; i < src.textures; i++) { const n = `${tplMpr}${String(i).padStart(3, '0')}.mmp`; if (has(n)) put.push({ name: `${file}${String(i).padStart(3, '0')}.mmp`, data: await api.resEntry('Res/textures.res', n) }); }
        const [miniTpl, questTpl] = (tplBlock.text.match(/^#maps\s*\r?\n[^\r\n]*\r?\n\s*(\S+)\s+(\S+)/m) || []).slice(1);
        if (miniTpl && has(miniTpl + '.mmp')) put.push({ name: `${file}map.mmp`, data: await api.resEntry('Res/textures.res', miniTpl + '.mmp') });
        if (questTpl && has(questTpl + '.mmp')) put.push({ name: `${file}quest.mmp`, data: await api.resEntry('Res/textures.res', questTpl + '.mmp') });
        await api.resUpdate('Res/textures.res', put);
        // objects: template mob without its objects, with a minimal script
        const mob = readMob(await api.file(`Maps/${tplMob}.mob`));
        const rootChunk = mob.chunks.find(c => c.id === 0xa000);
        // AI path graph: a copied relief keeps the template's graph, rebuilt where its objects stood;
        // a new flat landscape gets a graph built from scratch.
        const tplGraph = mob.chunks.find(c => c.id === AIGRAPH_ID);
        let graph;
        if (f.relief.value === 'copy' && tplGraph) {
          const base = readAiGraph(tplGraph.data), marked = new Set();
          for (const o of listObjects(mob).filter(o => o.kind !== 0xbbbb0000)) {
            const data = await loadModelData(getField(o.node, OBJ.model) || ''), box = data && modelBox(data), p = getField(o.node, OBJ.pos);
            const r = box ? Math.hypot(box.hx, box.hy) + Math.hypot(box.cx, box.cy) + 2 : 3;
            for (let y = Math.floor((p[1] - r) / 4); y <= Math.floor((p[1] + r) / 4); y++) for (let x = Math.floor((p[0] - r) / 4); x <= Math.floor((p[0] + r) / 4); x++) marked.add(y * base.W + x);
          }
          graph = buildAiGraph(map, [], { base, dirty: (x, y) => marked.has(y * base.W + x) });
        } else graph = buildAiGraph(map, []);
        const objs = rootChunk.children.find(c => c.id === 0xb000); if (objs) objs.children = [];
        rootChunk.children = rootChunk.children.filter(c => c.id !== 0x1e00 && c.id !== 0xe000); // editor metadata of the old map
        mob.chunks = [...mob.chunks.filter(c => c.id !== AIGRAPH_ID), { id: AIGRAPH_ID, data: writeAiGraph(graph) }];
        setScript(mob, 'GlobalVars (\r\n  NULL : object\r\n)\r\n\r\nWorldScript\r\n(\r\n  Sleep( 1 )\r\n)\r\n');
        await api.saveFile(`Maps/${file}.mob`, writeMob(mob));
        // world graph
        const cx = (map.W - 1) / 2, cy = (map.H - 1) / 2;
        const tplPos = directive(tplBlock.text, 'position') || '0 0 0';
        let block = `################################################\r\n\r\n## ${f.title.value}\r\n#zone ${id} ${f.allod.value} game\r\n#res\r\n${file} ${file}\r\n#maps\r\n${map.sx} ${map.sy}\r\n${file}map ${file}quest\r\n#position\r\n${tplPos.split(/\s+/).map((v, i) => (+v + (i < 2 ? 0.08 : 0)).toFixed(3)).join(' ')}\r\n\r\n`;
        const link = f.link.value && byId().get(f.link.value);
        if (link) {
          const edge = `${link.id}_${id}`, n = Math.max(0, ...exitsOf(link.text).map(x => x.n)) + 1;
          block += `## from ${link.id}\r\n#exit 1\r\n${edge} 2\r\n#deploy\r\n${cx - 5} ${cy - 5} ${cx + 5} ${cy + 5}\r\n#view\r\n0\r\n\r\n`;
          link.text = link.text.replace(/\s*$/, '') + `\r\n\r\n## to ${id}\r\n#exit ${n}\r\n${edge} 1\r\n#deploy\r\n10 10 20 20\r\n#view\r\n0\r\n\r\n`;
          st.world.blocks.push({ id, allod: f.allod.value, type: 'game', text: block });
          st.world.blocks.push({ id: edge, allod: f.allod.value, type: 'edge', text: `################################################\r\n\r\n#zone ${edge} ${f.allod.value} edge\r\n#position\r\n${tplPos}\r\n\r\n#exit 1\r\n${link.id} ${n}\r\n\r\n#exit 2\r\n${id} 1\r\n\r\n` });
          if (f.open) {
            const [, linkMob] = directive(link.text, 'res').split(/\s+/);
            const lm = readMob(await api.file(`Maps/${linkMob}.mob`));
            const s = getScript(lm) || '';
            setScript(lm, s.replace(/WorldScript\s*\(/, m => `${m}\r\n  GSSetVar( 0, "z.${id}", 2 )\r\n  GSSetVar( 0, "z.${edge}", 2 )`));
            await api.saveFile(`Maps/${linkMob}.mob`, writeMob(lm));
          }
        } else st.world.blocks.push({ id, allod: f.allod.value, type: 'game', text: block });
        await api.resUpdate('Res/texts.res', [{ name: 'map.txt', data: cp1251.encode(worldText(st.world)) }]);
        select(byId().get(id));
        toast(`Зона ${id} создана. Откройте её карту, расставьте объекты и поправьте прямоугольники #deploy (где появится отряд).`);
        return true;
      });
    }
  }
  return () => ro.disconnect();
}
