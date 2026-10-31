// Model viewer: every figure in figures.res with textures, morph (complection) and animations.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { api, h, guard, toast, dirty } from '/app.js';
import { readAnimations, writeModel, readModel } from '/formats/fig.js';
import { objToParts } from '/formats/obj.js';
import { encodeMmpArgb8 } from '/formats/mmp.js';
import { buildModel, poseModel, mmpToTexture, forgetCached } from '/lib/eiscene.js';
import { units } from '/lib/gamedb.js';

const PREFIX = { un: 'Существа', st: 'Строения и объекты', in: 'Предметы', ef: 'Эффекты', sp: 'Заклинания', na: 'Природа' };

export async function mount(root, [nameArg]) {
  const all = (await api.resList('Res/figures.res')).map(e => e.name.toLowerCase());
  const models = all.filter(n => n.endsWith('.mod')).map(n => n.slice(0, -4)).sort();
  const anims = new Set(all.filter(n => n.endsWith('.anm')).map(n => n.slice(0, -4)));
  const textures = (await api.resList('Res/textures.res')).map(e => e.name.replace(/\.mmp$/i, ''));
  const st = { name: nameArg || 'unmoog1', filter: '', tex: null, cx: [0.5, 0.5, 0.5], anim: null, frame: 0, playing: true, model: null, anims: [] };

  const list = h('div.body'), right = h('div.body'), vp = h('div.viewport');
  root.append(h('div.work',
    h('div.side', h('div.head', h('input.search', { placeholder: 'Поиск модели… (unmo — монстры, st — объекты)', oninput: e => { st.filter = e.target.value.toLowerCase(); renderList(); } })), list),
    h('div.center', h('div.toolbar', h('button.primary', { onclick: importDialog }, '⤒ Импорт модели (OBJ)'), h('span.sp'), h('span.hint', 'ЛКМ — вращать, ПКМ — сдвигать, колесо — масштаб')), vp),
    h('div.side.right', h('div.head', h('h3', 'Модель')), right)));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  vp.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2d33);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444033, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, -3, 4); scene.add(sun);
  const grid = new THREE.GridHelper(10, 20, 0x555555, 0x3a3a3a); grid.rotateX(Math.PI / 2); scene.add(grid);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  const ro = new ResizeObserver(() => { const r = vp.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); });
  ro.observe(vp);
  let last = performance.now(), acc = 0;
  renderer.setAnimationLoop(t => {
    const dt = (t - last) / 1000; last = t;
    if (st.model && st.anim && st.playing) {
      acc += dt;
      const frames = Math.max(...[...st.anim.tracks.values()].map(x => x.rot.length));
      if (acc > 1 / 15) { acc = 0; st.frame = (st.frame + 1) % Math.max(1, frames); poseModel(st.model, st.anim, st.frame); }
    }
    controls.update(); renderer.render(scene, camera);
  });

  function renderList() {
    const items = models.filter(m => !st.filter || m.includes(st.filter) || modelTitle.get(m)?.toLowerCase().includes(st.filter));
    const groups = {};
    for (const m of items) (groups[PREFIX[m.slice(0, 2)] || 'Прочее'] ??= []).push(m);
    list.replaceChildren(h('ul.list', Object.entries(groups).map(([g, ms]) => [h('li.group', `${g} (${ms.length})`),
      ms.slice(0, 400).map(m => h('li', { className: m === st.name ? 'sel' : '', onclick: () => load(m) }, modelTitle.get(m) || m, h('small.sub', [modelTitle.has(m) ? m : null, anims.has(m) ? '▶ анимации' : null].filter(Boolean).join(' · ') || null)))])));
  }

  async function load(name) {
    if (st.pending && !confirm('Импортированная модель не сохранена. Отменить импорт?')) return;
    st.pending = null; dirty.delete('models');
    st.name = name; st.anim = null; st.frame = 0;
    history.replaceState(null, '', '#models/' + name);
    renderList();
    if (!st.tex || !st.tex.toLowerCase().startsWith(name.slice(0, 6))) st.tex = guessTexture(name);
    await rebuild(true);
    st.anims = anims.has(name) ? await guard(async () => readAnimations(await api.resEntry('Res/figures.res', name + '.anm'))) || [] : [];
    renderRight();
  }
  const { raceByModel, prototypes } = await units();
  // creature models get the in-game name of the first creature that uses them
  const modelTitle = new Map();
  for (const p of prototypes) if (p.model && p.title && !modelTitle.has(p.model.toLowerCase())) modelTitle.set(p.model.toLowerCase(), p.title);
  function guessTexture(name) {
    const race = raceByModel.get(name);
    if (race?.textures.length) return race.textures[0];
    const base = name.replace(/\d+$/, '');
    return textures.find(t => t.toLowerCase() === name) || textures.find(t => t.toLowerCase().startsWith(name)) || textures.find(t => t.toLowerCase().startsWith(base)) || null;
  }
  async function rebuild(frame) {
    if (st.model) scene.remove(st.model);
    st.model = await buildModel(st.name, { texture: st.tex, complection: st.cx, data: st.pending?.data, map: st.pending?.map });
    if (!st.model) { toast('Не удалось загрузить модель ' + st.name, 'err'); return; }
    scene.add(st.model);
    if (st.anim) poseModel(st.model, st.anim, st.frame);
    if (frame) {
      const box = new THREE.Box3().setFromObject(st.model), c = box.getCenter(new THREE.Vector3()), r = Math.max(0.5, box.getSize(new THREE.Vector3()).length());
      controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(r * 0.6, -r * 1.2, r * 0.5));
    }
  }

  // ---- OBJ import: convert, preview from the bytes that will be written, then save ----
  function importDialog() {
    const f = {};
    const field = (k, label, el) => { f[k] = el; return h('div.f', h('label', label), el); };
    const dlg = h('dialog', { style: { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '8px', width: '520px' } });
    dlg.append(h('h3', { style: { marginTop: 0 } }, 'Импорт модели из OBJ'), h('div.form',
      field('obj', 'Модель (.obj — экспорт из Blender, 3ds Max и др.)', h('input', { type: 'file', accept: '.obj', onchange: e => { const n = e.target.files[0]?.name.replace(/\.obj$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, ''); if (n && !f.name.value) f.name.value = 'my' + n.slice(0, 14); } })),
      field('img', 'Текстура (PNG/JPG, необязательно)', h('input', { type: 'file', accept: 'image/*' })),
      field('name', 'Имя модели в игре (латиница и цифры, без пробелов)', h('input', { placeholder: 'myhouse1' })),
      field('scale', 'Масштаб (1 = единицы файла считаются метрами)', h('input', { type: 'number', value: 1, step: 0.1, min: 0.001 })),
      h('label', f.yUp = h('input', { type: 'checkbox', checked: true }), ' Ось Y — вверх (так экспортирует Blender по умолчанию)'),
      h('label', f.ground = h('input', { type: 'checkbox', checked: true }), ' Поставить модель низом на землю'),
      h('p.muted', 'Каждый объект (o/g) в OBJ станет отдельной частью модели. Модель статичная: анимации не импортируются.'),
      h('div.row', h('button.primary', { onclick: () => preview().then(ok => ok && dlg.close()) }, 'Предпросмотр'), h('button', { onclick: () => dlg.close() }, 'Отмена'))));
    document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove());

    async function preview() {
      const file = f.obj.files[0], name = f.name.value.trim().toLowerCase(), scale = +f.scale.value;
      if (!file) { toast('Выберите OBJ-файл', 'err'); return false; }
      if (!/^[a-z][a-z0-9_]{1,23}$/.test(name)) { toast('Имя: латиница, цифры и _, начинается с буквы, до 24 символов', 'err'); return false; }
      if (!(scale > 0)) { toast('Масштаб должен быть больше нуля', 'err'); return false; }
      return !!await guard(async () => {
        const parts = objToParts(await file.text(), { scale, yUp: f.yUp.checked, toGround: f.ground.checked });
        const { mod, bon } = writeModel(name, parts);
        let mmp = null;
        if (f.img.files[0]) {
          const bmp = await createImageBitmap(f.img.files[0]);
          const pow2 = v => 2 ** Math.min(9, Math.max(3, Math.floor(Math.log2(v)))); // game textures are 8..512 px powers of two
          const c = h('canvas', { width: pow2(bmp.width), height: pow2(bmp.height) }), ctx = c.getContext('2d');
          ctx.drawImage(bmp, 0, 0, c.width, c.height);
          mmp = encodeMmpArgb8(c.width, c.height, ctx.getImageData(0, 0, c.width, c.height).data);
        }
        st.pending = { name, mod, bon, mmp, data: readModel(mod, bon, name), map: mmp ? mmpToTexture(mmp) : null };
        st.name = name; st.anim = null; st.anims = []; st.tex = mmp ? name : null;
        dirty.add('models');
        await rebuild(true); renderList(); renderRight();
        return true;
      });
    }
  }

  async function savePending() {
    const p = st.pending;
    if (models.includes(p.name) && !confirm(`Модель «${p.name}» уже есть в игре. Заменить её?`)) return;
    await guard(async () => {
      await api.resUpdate('Res/figures.res', [{ name: p.name + '.mod', data: p.mod }, { name: p.name + '.bon', data: p.bon }]);
      if (p.mmp) await api.resUpdate('Res/textures.res', [{ name: p.name + '.mmp', data: p.mmp }]);
      forgetCached(p.name);
      if (!models.includes(p.name)) { models.push(p.name); models.sort(); }
      if (p.mmp && !textures.includes(p.name)) textures.push(p.name);
      st.pending = null; dirty.delete('models');
      await load(p.name);
    }, `Модель «${p.name}» добавлена в игру`);
  }

  function pendingPanel() {
    const p = st.pending, parts = p.data.parts;
    const tris = parts.reduce((a, x) => a + x.fig.indices.length / 3, 0);
    const size = new THREE.Box3().setFromObject(st.model).getSize(new THREE.Vector3());
    return h('div.form',
      h('h4', 'Импорт: ' + p.name),
      h('p.muted', `Частей: ${parts.length}, треугольников: ${tris}. Размер: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} м (для сравнения: клетка земли — 1 м, человек — около 1.8 м).`),
      p.mmp ? h('p.muted', `Текстура будет сохранена как ${p.name}.mmp`) : h('p.muted', 'Без текстуры: в игре модель будет без картинки. Её можно добавить позже в разделе «Текстуры».'),
      h('div.row', h('button.primary', { onclick: savePending }, 'Сохранить в игру'), h('button', { onclick: () => { st.pending = null; dirty.delete('models'); load(models[0]); } }, 'Отмена')),
      h('h4', 'Как поставить на карту'),
      h('p.muted', `В разделе «Карты» выберите любой объект, нажмите «Копия» и впишите Модель = ${p.name}${p.mmp ? `, Текстура = ${p.name}` : ''}.`));
  }

  function renderRight() {
    if (st.pending) return right.replaceChildren(pendingPanel());
    const parts = st.model?.userData.model.parts || [];
    const texSel = h('input', { value: st.tex || '', list: 'texlist', onchange: e => { st.tex = e.target.value || null; rebuild(); } });
    const slider = (i, label) => h('div.f', h('label', label), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.cx[i], oninput: e => { st.cx[i] = +e.target.value; rebuild(); } }));
    right.replaceChildren(h('div.form',
      h('h4', st.name),
      h('div.f', h('label', 'Текстура (из textures.res)'), texSel, h('datalist#texlist', textures.filter(t => t.toLowerCase().startsWith(st.name.slice(0, 4))).map(t => h('option', { value: t })))),
      h('h4', 'Телосложение'), slider(0, 'Сила'), slider(1, 'Ловкость'), slider(2, 'Рост'),
      st.anims.length ? [h('h4', 'Анимации'), h('div.row', h('button', { onclick: () => { st.playing = !st.playing; renderRight(); } }, st.playing ? '⏸ Пауза' : '▶ Играть'),
        h('button', { onclick: () => { st.anim = null; rebuild(); renderRight(); } }, 'Исходная поза')),
      h('ul.list', st.anims.map(a => h('li', { className: a === st.anim ? 'sel' : '', onclick: () => { st.anim = a; st.frame = 0; st.playing = true; renderRight(); } }, a.name, h('small', [...a.tracks.values()][0]?.rot.length + ' кадр.'))))] : h('p.muted', 'У модели нет анимаций.'),
      h('h4', `Части (${parts.length})`),
      h('ul.list', parts.map(p => h('li', p.name, h('small', p.parent ? '← ' + p.parent : 'корень')))),
      h('h4', 'Как использовать'),
      h('p.muted', 'Имя модели указывается в поле «Модель» объекта на карте, текстура — в поле «Текстура». Для существ модель берётся из расы в базе данных (Расы и модели → Mask Name).'),
    ));
  }
  renderList();
  await load(st.name);
  return () => { ro.disconnect(); renderer.setAnimationLoop(null); renderer.dispose(); };
}
