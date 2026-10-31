// Texture browser: preview any MMP, export to PNG, replace with your own PNG/JPG.
import { api, h, guard, pickFile, download } from '/app.js';
import { decodeMmp, mmpInfo, encodeMmpArgb8 } from '/formats/mmp.js';

const SOURCES = [['Res/textures.res', 'Текстуры мира и моделей'], ['Res/redress.res', 'Одежда на персонажах'], ['Res/menus.res', 'Меню']];
const PAGE = 120;

export async function mount(root, [srcArg]) {
  const st = { src: SOURCES.some(s => s[0] === srcArg) ? srcArg : SOURCES[0][0], list: [], filter: '', page: 0, sel: null };
  const grid = h('div.thumbs'), right = h('div.body'), pager = h('span.hint');
  root.append(h('div.work', { style: { gridTemplateColumns: 'minmax(0,1fr) 380px' } },
    h('div.center',
      h('div.toolbar',
        h('select', { onchange: e => location.hash = 'textures/' + e.target.value }, SOURCES.map(([v, t]) => h('option', { value: v, selected: v === st.src }, t))),
        h('input.search', { style: { width: '260px' }, placeholder: 'Поиск по имени… (zone1 — земля зоны 1)', oninput: e => { st.filter = e.target.value.toLowerCase(); st.page = 0; render(); } }),
        h('button', { onclick: () => { st.page = Math.max(0, st.page - 1); render(); } }, '←'), pager, h('button', { onclick: () => { st.page++; render(); } }, '→')),
      h('div.scroll', grid)),
    h('div.side.right', h('div.head', h('h3', 'Текстура')), right)));

  st.list = (await api.resList(st.src)).filter(e => /\.mmp$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  render(); renderRight();

  function render() {
    const items = st.list.filter(e => !st.filter || e.name.toLowerCase().includes(st.filter));
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    pager.textContent = `стр. ${st.page + 1} из ${pages} · ${items.length} шт.`;
    grid.replaceChildren(...items.slice(st.page * PAGE, (st.page + 1) * PAGE).map(e => {
      const c = h('canvas', { width: 96, height: 96 });
      const fig = h('figure', { className: e === st.sel ? 'sel' : '', title: e.name, onclick: () => { st.sel = e; for (const f of grid.children) f.classList.toggle('sel', f === fig); renderRight(); } }, c, h('figcaption', e.name));
      thumb(e.name, c);
      return fig;
    }));
  }
  async function thumb(name, canvas) {
    try {
      const img = decodeMmp(await api.resEntry(st.src, name));
      const tmp = h('canvas', { width: img.width, height: img.height });
      tmp.getContext('2d').putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
      const ctx = canvas.getContext('2d'), s = Math.min(96 / img.width, 96 / img.height);
      ctx.drawImage(tmp, (96 - img.width * s) / 2, (96 - img.height * s) / 2, img.width * s, img.height * s);
    } catch { /* unreadable texture: leave the tile empty */ }
  }

  async function renderRight() {
    const e = st.sel;
    if (!e) return right.replaceChildren(h('div.empty', 'Выберите текстуру.'), h('p.muted', 'Земля зоны — это атласы <зона>000…007 (8×8 тайлов по 64 пикселя). Текстуры моделей и объектов — по имени из поля «Текстура» на карте.'));
    const u8 = await api.resEntry(st.src, e.name), info = mmpInfo(u8), img = decodeMmp(u8);
    const c = h('canvas', { width: img.width, height: img.height, style: { width: '100%', imageRendering: 'pixelated', background: 'repeating-conic-gradient(#2a2a2a 0 25%, #333 0 50%) 0 0/16px 16px' } });
    c.getContext('2d').putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
    right.replaceChildren(h('div.form', h('h4', e.name), c,
      h('p.muted', `${info.width}×${info.height}, формат ${info.formatName}`),
      h('div.row',
        h('button', { onclick: () => c.toBlob(b => download(e.name.replace(/\.mmp$/i, '.png'), b)) }, '⤓ Сохранить PNG'),
        h('button.primary', { onclick: () => replace(e, info) }, '⤒ Заменить своей')),
      h('p.muted', 'Новая картинка сохраняется без сжатия (ARGB 8888) и масштабируется под исходный размер, чтобы не сломать модели и тайлы.')));
  }

  async function replace(e, info) {
    const file = await pickFile('image/*');
    if (!file) return;
    await guard(async () => {
      const bmp = await createImageBitmap(file);
      const c = h('canvas', { width: info.width, height: info.height }), ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0, info.width, info.height);
      const rgba = ctx.getImageData(0, 0, info.width, info.height).data;
      await api.resUpdate(st.src, [{ name: e.name, data: encodeMmpArgb8(info.width, info.height, rgba) }]);
      render(); renderRight();
    }, 'Текстура заменена. В игре изменения видны после перезапуска.');
  }
}
