// Map editor: 3D terrain (MPR) + placed objects/units/patrols (MOB) + map script.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { api, h, guard, toast, dirty } from '/app.js';
import * as M from '/formats/mob.js';
import { readMpr, writeMpr, updateNormals, markDirty, heightAt } from '/formats/mpr.js';
import { units } from '/lib/gamedb.js';
import { gameCatalog as buildCatalog, setupUnit, setupObject } from '/shared/catalog.js';
import { buildModel, buildTerrain, updateTerrain, retileTerrain, buildWater, loadAtlases, loadModelData } from '/lib/eiscene.js';
import { AIGRAPH_ID, readAiGraph, writeAiGraph, buildAiGraph, modelBox, objectRect } from '/formats/aigraph.js';

const AI_CLASSES = ['летающие', 'мелкие звери', 'гоблины', 'люди и орки', 'класс 4', 'ящеры, скелеты', 'огры, големы', 'тролли, циклопы'];

const KIND_COLOR = { 0xb001: 0xb0a890, 0xbbbb0000: 0xe05050, 0xbbab0000: 0xb070ff, 0xbbac0000: 0x50c0e0, 0xbbbf0000: 0xffa030, 0xaa01: 0xffff80, 0xcc01: 0x80ff80, 0xdd01: 0xff80ff };
const fmt = v => Math.round(v * 100) / 100;

// zone12dm1.mob -> zone12.mpr; z3q1.mob -> zone3obr.mpr (quest mobs live on zone maps).
function guessMpr(mob, mprs) {
  const base = mob.replace(/\.mob$/i, '').toLowerCase();
  const names = mprs.map(m => m.replace(/\.mpr$/i, '').toLowerCase()).sort((a, b) => b.length - a.length);
  const q = base.match(/^z(\d+)q\d+$/);
  const key = q ? 'zone' + q[1] : base;
  return (names.find(n => key === n) || names.find(n => key.startsWith(n)) || names.find(n => n.startsWith(key.replace(/[-_].*$/, ''))) || names.find(n => n.startsWith(key.slice(0, 5)))) + '.mpr';
}

// Templates and the catalog of all placed objects, built once from the game's zone maps.
let catalogP;
function gameCatalog(mobs) {
  if (!catalogP) toast('Собираю каталог объектов со всех карт игры…');
  return (catalogP ??= buildCatalog(api.file, mobs).catch(e => { catalogP = null; throw e; }));
}

export async function mount(root, [mobArg, mprArg]) {
  const info = await api.info();
  const mobs = info.maps.filter(f => /\.mob$/i.test(f)).sort(), mprs = info.maps.filter(f => /\.mpr$/i.test(f)).sort();
  const unitInfo = await units();
  const st = { mobFile: mobArg || 'zone1.mob', mob: null, map: null, objects: [], sel: null, selPt: null, mode: 'select', brush: { tool: 'raise', radius: 4, strength: 0.15, tile: 0, rot: 0 }, mobChanged: false, mprChanged: false, filter: '', kind: 0 };
  st.mprFile = mprArg || guessMpr(st.mobFile, mprs);

  // ---------- layout ----------
  const listEl = h('div.body'), propsEl = h('div.body'), vp = h('div.viewport'), overlay = h('div.overlay');
  const scriptArea = h('textarea.code', { style: { flex: 1, border: 0, borderRadius: 0, resize: 'none' }, spellcheck: false, oninput: () => { st.scriptChanged = true; markMob(); } });
  const scriptPane = h('div.center', { style: { display: 'none', flex: 1 } }, h('div.toolbar', h('span.hint', 'Скрипт карты (язык скриптов ПЗ). Изменения сохраняются вместе с картой.')), scriptArea);
  const saveBtn = h('button.primary', { onclick: save, disabled: true }, 'Сохранить');
  const passBtn = h('button', { title: 'Показать, где могут ходить существа (зелёный — везде, оранжевый — частично, красный — нигде)', onclick: () => togglePassability() }, '◍ Проходимость');
  const passSel = h('select', { title: 'Класс существ', style: { display: 'none' }, onchange: () => showPassability() }, AI_CLASSES.map((t, k) => h('option', { value: k, selected: k === 3 }, `${k}: ${t}`)));
  const modeBtns = {};
  const modeBtn = (id, label, title) => (modeBtns[id] = h('button', { title, onclick: () => setMode(id) }, label));
  const tabs = h('div.tabs', h('button.on', { onclick: e => showTab(e, 0) }, '3D-вид'), h('button', { onclick: e => showTab(e, 1) }, 'Скрипт карты'));
  const mobSel = h('select', { style: { width: '100%' }, onchange: e => go(e.target.value, guessMpr(e.target.value, mprs)) }, mobs.map(m => h('option', { value: m, selected: m === st.mobFile }, m)));
  const mprSel = h('select', { style: { width: '100%' }, title: 'Ландшафт, на котором стоят объекты', onchange: e => go(st.mobFile, e.target.value) }, mprs.map(m => h('option', { value: m, selected: m.toLowerCase() === st.mprFile.toLowerCase() }, m)));
  const search = h('input.search', { placeholder: 'Поиск объектов…', oninput: e => { st.filter = e.target.value.toLowerCase(); renderList(); } });
  const kindSel = h('select', { onchange: e => { st.kind = +e.target.value; renderList(); } }, h('option', { value: 0 }, 'Все типы'), Object.entries(M.KINDS).map(([k, v]) => h('option', { value: k }, v)));

  root.append(h('div.work',
    h('div.side',
      h('div.head', h('div.f', { style: { width: '100%', display: 'grid', gap: '4px' } }, h('label', 'Файл объектов (.mob)'), mobSel, h('label', 'Ландшафт (.mpr)'), mprSel)),
      h('div.head', search, kindSel, h('button', { onclick: addCreature, title: 'Добавить существо из базы данных' }, '+ Существо'), h('button', { onclick: addObject, title: 'Добавить постройку, дерево, камень… из каталога всех карт' }, '+ Объект'), h('button', { onclick: duplicate, title: 'Копия выбранного (Ctrl+D)' }, '⧉ Копия')),
      listEl),
    h('div.center',
      h('div.toolbar',
        modeBtn('select', '↖ Двигать', 'Выбор и перемещение объектов (W — двигать, E — вращать)'),
        modeBtn('sculpt', '⛰ Рельеф', 'Поднять/опустить/сгладить землю'),
        modeBtn('paint', '▦ Текстуры земли', 'Рисовать тайлами земли'),
        passBtn, passSel,
        h('span.sp'), h('span.hint', 'ЛКМ — выбрать/тащить карту, ПКМ — вращать, колесо — масштаб'), saveBtn),
      tabs, vp, scriptPane),
    h('div.side.right', h('div.head', h('h3', 'Свойства')), propsEl),
  ));
  vp.append(overlay);

  function showTab(e, i) {
    for (const b of tabs.children) b.classList.toggle('on', b === e.target);
    vp.style.display = i ? 'none' : ''; scriptPane.style.display = i ? 'flex' : 'none';
  }
  function go(mob, mpr) {
    if ((st.mobChanged || st.mprChanged) && !confirm('Есть несохранённые изменения. Открыть другую карту без сохранения?')) { mobSel.value = st.mobFile; return; }
    dirty.delete('map');
    location.hash = `map/${encodeURIComponent(mob)}/${encodeURIComponent(mpr)}`;
  }
  function markMob() { st.mobChanged = true; saveBtn.disabled = false; dirty.add('map'); }
  function markMpr() { st.mprChanged = true; saveBtn.disabled = false; dirty.add('map'); }

  // ---------- three.js scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  vp.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fa8bf);
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x4a4030, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.8); sun.position.set(-1, -0.6, 2); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 5000);
  const controls = new MapControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.49; controls.screenSpacePanning = false;
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSize(0.8);
  gizmo.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });
  scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
  const objRoot = new THREE.Group(), routeRoot = new THREE.Group();
  scene.add(objRoot, routeRoot);
  const brushRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd060, depthTest: false, transparent: true }));
  brushRing.renderOrder = 10; brushRing.visible = false; scene.add(brushRing);
  let terrain = null, water = null, alive = true;

  const resize = () => { const r = vp.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(vp);
  renderer.setAnimationLoop(() => { if (alive) { controls.update(); renderer.render(scene, camera); } });

  // ---------- load ----------
  overlay.textContent = 'Загрузка карты…';
  const [mobU8, mprU8] = await Promise.all([api.file('Maps/' + st.mobFile), api.file('Maps/' + st.mprFile).catch(() => null)]);
  st.mob = M.readMob(mobU8);
  const origScript = M.getScript(st.mob) ?? '';
  scriptArea.value = origScript.replace(/\r\n/g, '\n');
  if (mprU8) {
    st.map = readMpr(mprU8);
    const atlases = await loadAtlases(st.map);
    terrain = buildTerrain(st.map, atlases);
    water = buildWater(st.map, atlases);
    scene.add(terrain, water);
    controls.target.set(st.map.W / 2, st.map.H / 2, 0);
    camera.position.set(st.map.W / 2, st.map.H / 2 - 60, 80);
  } else toast('Ландшафт не найден — показываю только объекты', 'err');
  st.objects = M.listObjects(st.mob).map(o => ({ ...o, group: null }));
  for (const o of st.objects) addObjectMesh(o);
  if (!st.map && st.objects.length) { const p = M.getField(st.objects[0].node, M.OBJ.pos); controls.target.set(p[0], p[1], p[2]); camera.position.set(p[0], p[1] - 40, p[2] + 50); }
  // AI path graph lives in the base zone mob; remember objects to find what changed by save time.
  const graphChunk = st.mob.chunks.find(c => c.id === AIGRAPH_ID);
  const objKey = o => JSON.stringify([M.getField(o.node, M.OBJ.model), M.getField(o.node, M.OBJ.pos), M.getField(o.node, M.OBJ.rot)]);
  const snapshot = new Map(st.objects.filter(o => o.kind !== 0xbbbb0000).map(o => [o.node, { key: objKey(o), model: M.getField(o.node, M.OBJ.model), pos: M.getField(o.node, M.OBJ.pos), rot: M.getField(o.node, M.OBJ.rot) }]));
  const graphDirty = new Set();
  window.eiMap = { st, scene, camera, controls, terrain, water }; // handy from the browser console
  renderList(); renderProps(); setMode('select');
  overlay.textContent = `${st.objects.length} объектов · загружаю модели…`;
  loadModels().then(() => { if (alive) overlay.textContent = `${st.objects.length} объектов`; });

  // ---------- objects ----------
  function addObjectMesh(o) {
    const g = new THREE.Group();
    g.userData.obj = o;
    const marker = new THREE.Mesh(o.kind === 0xbbbb0000 ? new THREE.ConeGeometry(0.5, 1.8, 8).rotateX(Math.PI / 2).translate(0, 0, 0.9) : new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
      new THREE.MeshLambertMaterial({ color: KIND_COLOR[o.kind] || 0xffffff }));
    marker.userData.marker = true;
    g.add(marker);
    o.group = g;
    syncFromNode(o);
    objRoot.add(g);
  }
  function syncFromNode(o) {
    const p = M.getField(o.node, M.OBJ.pos) || [0, 0, 0], q = M.getField(o.node, M.OBJ.rot) || [1, 0, 0, 0];
    // stored Z of objects/units is height above the ground (patrol points are absolute)
    o.group.position.set(p[0], p[1], p[2] + groundZ(p[0], p[1]));
    o.group.quaternion.set(q[1], q[2], q[3], q[0]).normalize();
  }
  function syncToNode(o) {
    const p = o.group.position, q = o.group.quaternion;
    M.setField(o.node, M.OBJ.pos, [p.x, p.y, p.z - groundZ(p.x, p.y)]);
    M.setField(o.node, M.OBJ.rot, [q.w, q.x, q.y, q.z]);
  }
  async function loadModels() {
    const queue = st.objects.filter(o => M.getField(o.node, M.OBJ.model));
    const worker = async () => {
      while (queue.length && alive) {
        const o = queue.shift();
        await replaceModel(o);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
  async function replaceModel(o) {
    const tex = M.getField(o.node, M.OBJ.texture);
    const model = await buildModel(M.getField(o.node, M.OBJ.model), { texture: tex && !/^default/i.test(tex) ? tex : null, complection: M.getField(o.node, M.OBJ.complection) });
    if (!model || !o.group) return;
    for (const c of [...o.group.children]) if (c.userData.marker || c.userData.model) o.group.remove(c);
    model.userData.model = true;
    // unit models have their origin at the hips; the game stands them on their feet
    if (o.kind === 0xbbbb0000) model.position.z = -new THREE.Box3().setFromObject(model).min.z;
    o.group.add(model);
  }

  // ---------- list ----------
  function objLabel(o) { return M.getField(o.node, M.OBJ.name) || M.getField(o.node, M.OBJ.prototype) || '(без имени)'; }
  // In-game name of a creature (texts.res via its prototype); objects have no translated names.
  function gameTitle(o) { return o.kind === 0xbbbb0000 ? unitInfo.byName.get((M.getField(o.node, M.UNIT.unitPrototype) || '').toLowerCase())?.title : null; }
  function renderList() {
    const items = st.objects.filter(o => (!st.kind || o.kind === st.kind) && (!st.filter || objLabel(o).toLowerCase().includes(st.filter) || gameTitle(o)?.toLowerCase().includes(st.filter) || String(M.getField(o.node, M.OBJ.id)).includes(st.filter)));
    listEl.replaceChildren(h('ul.list', items.slice(0, 600).map(o => h('li', { className: o === st.sel ? 'sel' : '', onclick: () => select(o, true) },
      h('span.swatch', { style: { background: '#' + (KIND_COLOR[o.kind] || 0xffffff).toString(16).padStart(6, '0') } }), gameTitle(o) || objLabel(o), gameTitle(o) ? h('small.sub', objLabel(o)) : null))),
    ...(items.length > 600 ? [h('div.muted', `…ещё ${items.length - 600}, уточните поиск`)] : []));
  }

  // ---------- selection & gizmo ----------
  function select(o, focus) {
    st.sel = o; st.selPt = null;
    if (o) { gizmo.attach(o.group); gizmo.setMode('translate'); gizmo.showX = gizmo.showY = gizmo.showZ = true; }
    else gizmo.detach();
    if (o && focus) { const d = camera.position.clone().sub(controls.target); controls.target.copy(o.group.position); camera.position.copy(o.group.position).add(d.setLength(Math.min(d.length(), 40))); }
    renderList(); renderProps(); drawRoutes();
  }
  gizmo.addEventListener('objectChange', () => {
    if (st.selPt) { const p = gizmo.object.position; st.selPt.set([p.x, p.y, p.z]); drawRoutes(true); markMob(); renderPropsSoon(); return; }
    if (st.sel) { if (gizmo.mode === 'rotate') { const e = new THREE.Euler().setFromQuaternion(st.sel.group.quaternion, 'ZYX'); st.sel.group.quaternion.setFromEuler(new THREE.Euler(0, 0, e.z, 'ZYX')); } syncToNode(st.sel); markMob(); renderPropsSoon(); }
  });
  let propsTimer;
  const renderPropsSoon = () => { clearTimeout(propsTimer); propsTimer = setTimeout(renderProps, 150); };

  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  function pick(e, targets) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    return ray.intersectObjects(targets, true)[0];
  }
  let downAt = null, painting = false;
  renderer.domElement.addEventListener('pointerdown', e => {
    downAt = [e.clientX, e.clientY];
    if (e.button === 0 && st.mode !== 'select' && terrain) { painting = true; applyBrush(e); }
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if (st.mode !== 'select' && terrain) {
      const hit = pick(e, [terrain]);
      brushRing.visible = !!hit;
      if (hit) { const r = st.mode === 'paint' ? st.brush.radius * 2 : st.brush.radius; brushRing.position.copy(hit.point).add(new THREE.Vector3(0, 0, 0.2)); brushRing.scale.setScalar(r); }
      if (painting) applyBrush(e);
    }
  });
  window.addEventListener('pointerup', onUp);
  function onUp(e) {
    if (painting) { painting = false; if (st.mode === 'paint') retileTerrain(terrain); }
    if (!downAt || e.target !== renderer.domElement || e.button !== 0 || gizmo.dragging) { downAt = null; return; }
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4;
    downAt = null;
    if (moved || st.mode !== 'select') return;
    if (e.shiftKey && st.sel?.kind === 0xbbbb0000 && terrain) { // Shift+click: new waypoint here, after the selected one
      const g = pick(e, [terrain]);
      if (g) { putWaypoint(st.sel, g.point.x, g.point.y, st.selPt?.label?.startsWith('wp') ? st.selPt.index : undefined); return; }
    }
    const hit = pick(e, [routeRoot, objRoot]);
    let o = hit?.object;
    while (o && !o.userData.obj && !o.userData.point) o = o.parent;
    if (o?.userData.point) { selectPoint(o); return; }
    select(o?.userData.obj || null);
  }

  // ---------- patrol routes ----------
  // Selected creature's route: solid line through the waypoints in order, dashed return from the last
  // point to the first and from the guard point, arrows for the walking direction, "number · wait" labels.
  function routeLabel(text, color) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), font = 'bold 28px system-ui, sans-serif';
    g.font = font; c.width = Math.ceil(g.measureText(text).width) + 16; c.height = 40;
    g.font = font; g.fillStyle = 'rgba(0,0,0,0.72)'; g.beginPath(); g.roundRect(0, 0, c.width, c.height, 8); g.fill();
    g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 8, 21);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    s.scale.set(c.width / 40 * 0.9, 0.9, 1); s.renderOrder = 7; s.center.set(0.5, -0.6);
    s.raycast = () => {}; // labels are not clickable
    return s;
  }
  function clearRoutes() {
    routeRoot.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    routeRoot.clear();
  }
  function drawRoutes(keepGizmo) {
    clearRoutes();
    if (!st.sel || st.sel.kind !== 0xbbbb0000) return;
    const up = v => new THREE.Vector3(...v).add(new THREE.Vector3(0, 0, 0.3));
    const line = (pts, color, dashed) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.6, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false }));
      if (dashed) l.computeLineDistances();
      l.renderOrder = 4; l.raycast = () => {}; routeRoot.add(l);
    };
    const arrow = (a, b, color) => {
      const d = b.clone().sub(a); if (d.length() < 2) return;
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.1, 10), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      m.position.copy(a).add(d.clone().multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.renderOrder = 5; m.raycast = () => {};
      routeRoot.add(m);
    };
    for (const patrol of M.getPatrols(st.sel.node)) {
      const pts = patrol.points.map(p => up(p.pos));
      if (patrol.guard && pts.length) line([up(patrol.guard), pts[0]], 0xff8060, true);
      if (pts.length > 1) {
        line(pts, 0xffe060);
        pts.slice(1).forEach((p, i) => arrow(pts[i], p, 0xffe060));
        if (pts.length > 2) { line([pts.at(-1), pts[0]], 0xffe060, true); arrow(pts.at(-1), pts[0], 0xb0a040); }
      }
      const mk = (pos, color, setter, label, text, index) => {
        const sel = st.selPt?.label === label && st.selPt.patrol.node === patrol.node;
        const m = new THREE.Mesh(new THREE.SphereGeometry(sel ? 0.7 : 0.45, 14, 10), new THREE.MeshBasicMaterial({ color: sel ? 0xffffff : color, depthTest: false }));
        m.renderOrder = 6; m.position.fromArray(pos);
        m.userData.point = { set: setter, label, patrol, index };
        const t = routeLabel(text, sel ? '#ffffff' : '#' + color.toString(16).padStart(6, '0')); t.position.copy(m.position);
        routeRoot.add(m, t);
        if (sel) st.selPt = m.userData.point; // fresh positions for the panel
        if (keepGizmo && sel) gizmo.attach(m);
        return m;
      };
      if (patrol.guard) mk(patrol.guard, 0xff8060, v => M.setField(patrol.node, [0xbbbd0001, 'vec3'], v), 'guard', 'охрана');
      patrol.points.forEach((p, i) => mk(p.pos, 0xffe060, v => M.setWaypoint(p.node, { pos: v }), 'wp' + i,
        `${i + 1} · ${p.wait}${p.param ? ' · p' + fmt(p.param) : ''}${p.flag ? ' · ⚑' : ''}`, i));
    }
  }
  function selectPoint(m) {
    st.selPt = m.userData.point;
    gizmo.setMode('translate');
    drawRoutes(true);
    renderProps();
  }
  function selectPointByLabel(label) {
    let m = null; routeRoot.traverse(o => { if (o.userData.point?.label === label) m = o; });
    if (m) selectPoint(m); else { st.selPt = null; renderProps(); }
  }

  // ---------- modes & brushes ----------
  function setMode(m) {
    st.mode = m;
    for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle('primary', k === m);
    controls.mouseButtons.LEFT = m === 'select' ? THREE.MOUSE.PAN : null;
    brushRing.visible = false;
    if (m !== 'select') gizmo.detach(); else if (st.sel) gizmo.attach(st.sel.group);
    if (m !== 'select' && !terrain) toast('Для этой карты не загружен ландшафт', 'err');
    renderProps();
  }
  function applyBrush(e) {
    const hit = pick(e, [terrain]);
    if (!hit) return;
    const map = st.map, b = st.brush, cx = hit.point.x, cy = hit.point.y;
    if (st.mode === 'sculpt') {
      const R = b.radius, x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(map.W - 1, Math.ceil(cx + R)), y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(map.H - 1, Math.ceil(cy + R));
      const step = b.strength * 65535 / map.maxZ * 0.25, target = map.z[Math.round(cy) * map.W + Math.round(cx)];
      const src = map.z.slice();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / R;
        if (d > 1) continue;
        const w = 0.5 + 0.5 * Math.cos(d * Math.PI), k = y * map.W + x;
        let z = map.z[k];
        if (b.tool === 'raise') z += step * w; else if (b.tool === 'lower') z -= step * w;
        else if (b.tool === 'flatten') z += (target - z) * w * 0.3;
        else { let s = 0, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < map.W && yy < map.H) { s += src[yy * map.W + xx]; n++; } } z += (s / n - z) * w * 0.5; }
        map.z[k] = Math.max(0, Math.min(65535, Math.round(z)));
      }
      updateNormals(map, x0 - 1, y0 - 1, x1 + 1, y1 + 1);
      markGraph(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
      updateTerrain(terrain, x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    } else {
      const R = b.radius, tx = cx / 2, ty = cy / 2;
      for (let y = Math.floor(ty - R); y <= Math.ceil(ty + R); y++) for (let x = Math.floor(tx - R); x <= Math.ceil(tx + R); x++) {
        if (x < 0 || y < 0 || x >= map.TW || y >= map.TH || Math.hypot(x + 0.5 - tx, y + 0.5 - ty) > Math.max(0.6, R)) continue;
        map.tiles[y * map.TW + x] = (b.rot << 14) | b.tile;
      }
      markDirty(map, Math.floor(cx - 2 * R - 2), Math.floor(cy - 2 * R - 2), Math.ceil(cx + 2 * R + 2), Math.ceil(cy + 2 * R + 2));
      updateTerrain(terrain, Math.floor(cx - 2 * R - 2), Math.floor(cy - 2 * R - 2), Math.ceil(cx + 2 * R + 2), Math.ceil(cy + 2 * R + 2));
    }
    markMpr();
  }

  function groundZ(x, y) {
    if (!st.map) return 0;
    const m = st.map, xi = Math.max(0, Math.min(m.W - 2, Math.floor(x))), yi = Math.max(0, Math.min(m.H - 2, Math.floor(y))), fx = x - xi, fy = y - yi;
    const z = (i, j) => heightAt(m, (yi + j) * m.W + xi + i);
    return (z(0, 0) * (1 - fx) + z(1, 0) * fx) * (1 - fy) + (z(0, 1) * (1 - fx) + z(1, 1) * fx) * fy;
  }

  // ---------- properties panel ----------
  function renderProps() {
    if (st.mode === 'sculpt') return propsEl.replaceChildren(sculptPanel());
    if (st.mode === 'paint') return propsEl.replaceChildren(paintPanel());
    if (st.selPt) return propsEl.replaceChildren(pointPanel());
    const o = st.sel;
    if (!o) return propsEl.replaceChildren(h('div.empty', 'Кликните по объекту на карте или в списке слева.'), h('p.muted', 'Горячие клавиши: W — двигать, E — вращать, Delete — удалить, Ctrl+D — копия, F — показать выбранное, G — поставить на землю.'));
    const n = o.node, field = (label, spec, opts = {}) => {
      const v = M.getField(n, spec);
      return h('div.f', h('label', label, opts.hint ? h('small', ' — ' + opts.hint) : null), h('input', { value: v ?? '', type: spec[1] === 'u32' || spec[1] === 'u8' ? 'number' : 'text',
        onchange: e => { M.setField(n, spec, spec[1] === 'str' ? e.target.value : +e.target.value); markMob(); if (opts.reload) replaceModel(o); renderList(); } }));
    };
    const vec = (label, spec, cb) => {
      const v = M.getField(n, spec) || [0, 0, 0];
      return h('div.f', h('label', label), h('div.row', v.slice(0, 3).map((x, i) => h('input', { type: 'number', step: 0.1, value: fmt(x), onchange: e => { v[i] = +e.target.value; M.setField(n, spec, v); markMob(); cb?.(); } }))));
    };
    const q = M.getField(n, M.OBJ.rot) || [1, 0, 0, 0];
    const yaw = Math.round(THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q[1], q[2], q[3], q[0]), 'ZYX').z));
    const isUnit = o.kind === 0xbbbb0000;
    const list = (label, spec) => h('div.f', h('label', label, h('small', ' — через запятую')), h('textarea', { rows: 2, value: (M.getField(n, spec) || []).join(', '),
      onchange: e => { M.setField(n, spec, e.target.value.split(',').map(s => s.trim()).filter(Boolean)); markMob(); } }));
    propsEl.replaceChildren(h('div.form',
      h('h4', gameTitle(o) || objLabel(o), h('small.sub', `${o.kindName} №${M.getField(n, M.OBJ.id)}`)),
      field('Имя на карте', M.OBJ.name, { hint: 'используется в скриптах' }),
      isUnit ? field('Прототип существа (из базы)', M.UNIT.unitPrototype) : null,
      field('Прототип / шаблон', M.OBJ.prototype),
      field('Модель', M.OBJ.model, { reload: true, hint: 'имя в figures.res' }),
      field('Текстура', M.OBJ.texture, { reload: true }),
      vec('Позиция X, Y и высота над землёй', M.OBJ.pos, () => syncFromNode(o)),
      h('div.f', h('label', 'Поворот (градусы)'), h('input', { type: 'number', value: yaw, onchange: e => {
        const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(+e.target.value));
        M.setField(n, M.OBJ.rot, [qq.w, qq.x, qq.y, qq.z]); syncFromNode(o); markMob();
      } })),
      vec('Телосложение (сила, ловкость, рост: 0…1)', M.OBJ.complection, () => replaceModel(o)),
      field('Игрок / сторона', M.OBJ.player, { hint: 'группа дипломатии' }),
      field('Квест (подсветка)', M.QUEST_INFO),
      isUnit ? [h('h4', 'Снаряжение'), list('Оружие', M.UNIT.weapons), list('Доспехи', M.UNIT.armors), list('Заклинания', M.UNIT.spells), list('Расходуемые', M.UNIT.quickItems), list('Квестовые предметы', M.UNIT.questItems)] : null,
      isUnit ? patrolPanel(o) : null,
      h('div.row', { style: { marginTop: '10px' } },
        h('button', { onclick: () => toGround(o) }, '⤓ На землю'),
        h('button', { onclick: duplicate }, '⧉ Копия'),
        h('button.danger', { onclick: removeSelected }, '✕ Удалить')),
    ));
  }
  // ---------- route editing ----------
  const WAIT_HINT = 'ожидание в точке (в оригиналах чаще 30…150, 3600 — стоять долго)';
  function routeChanged(selectLabel) { markMob(); drawRoutes(); if (selectLabel) selectPointByLabel(selectLabel); else renderProps(); }
  function patrolPanel(o) {
    const pt = M.getPatrols(o.node)[0];
    if (!pt?.points.length) return [h('h4', 'Маршрут патруля'), h('p.muted', 'У существа нет маршрута. Shift+клик по земле или кнопка ниже добавят точку.'),
      h('div.row', h('button', { onclick: () => addWaypoint(o) }, '+ Точка маршрута'))];
    return [h('h4', 'Маршрут патруля', h('small.sub', `${pt.points.length} точ.`)),
      h('p.muted', 'Номер — порядок обхода, число — ожидание. Клик по номеру выбирает точку. Shift+клик по земле — новая точка после выбранной (или в конец).'),
      ...pt.points.map((p, i) => {
        const b = { padding: '3px 0', minWidth: 0 };
        return h('div', { style: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 28px 28px 28px', gap: '4px', alignItems: 'center', marginBottom: '4px' } },
          h('button', { title: 'Выбрать и двигать на карте', style: b, onclick: () => selectPointByLabel('wp' + i) }, String(i + 1)),
          h('input', { type: 'number', min: 0, value: p.wait, title: WAIT_HINT, style: { width: '100%', minWidth: 0 }, onchange: e => { M.setWaypoint(p.node, { wait: +e.target.value }); routeChanged(); } }),
          h('button', { title: 'Раньше', style: b, disabled: i === 0, onclick: () => moveWaypoint(pt, i, -1) }, '↑'),
          h('button', { title: 'Позже', style: b, disabled: i === pt.points.length - 1, onclick: () => moveWaypoint(pt, i, 1) }, '↓'),
          h('button.danger', { title: 'Удалить точку', style: b, onclick: () => removeWaypoint(pt, i) }, '✕'));
      }),
      h('div.row', h('button', { onclick: () => addWaypoint(o) }, '+ Точка в конец'),
        h('button.danger', { onclick: () => { if (confirm('Убрать все точки маршрута?')) { for (const p of pt.points) pt.node.children.splice(pt.node.children.indexOf(p.node), 1); routeChanged(); } } }, 'Убрать маршрут'))];
  }
  function pointPanel() {
    const p = st.selPt, back = () => { st.selPt = null; gizmo.attach(st.sel.group); drawRoutes(); renderProps(); };
    const pos = p.label === 'guard' ? p.patrol.guard : p.patrol.points[p.index].pos;
    const xy = h('div.f', h('label', 'Позиция X, Y', h('small', ' — высота берётся с земли')), h('div.row', [0, 1].map(k => h('input', { type: 'number', step: 0.5, value: fmt(pos[k]), onchange: e => {
      const v = pos.slice(); v[k] = +e.target.value; v[2] = groundZ(v[0], v[1]); p.set(v); routeChanged(p.label);
    } }))));
    if (p.label === 'guard') return h('div.form', h('h4', 'Точка охраны'), h('p.muted', 'Место, которое существо охраняет; к нему ведёт пунктир. Тащите стрелки на карте.'), xy, h('button', { onclick: back }, '← К существу'));
    const pt = p.patrol, i = p.index, wp = pt.points[i];
    return h('div.form', h('h4', `Точка маршрута ${i + 1} из ${pt.points.length}`),
      h('p.muted', 'Тащите стрелки на карте, чтобы переместить точку.'), xy,
      h('div.f', h('label', 'Ожидание', h('small', ' — ' + WAIT_HINT)), h('input', { type: 'number', min: 0, value: wp.wait, onchange: e => { M.setWaypoint(wp.node, { wait: +e.target.value }); routeChanged(p.label); } })),
      h('div.f', h('label', 'Параметр bbbe0003', h('small', ' — смысл не изучен; в оригиналах 0, у лучников и элементалей 5 или 30')), h('input', { type: 'number', step: 0.5, value: fmt(wp.param), onchange: e => { M.setWaypoint(wp.node, { param: +e.target.value }); routeChanged(p.label); } })),
      h('div.f', h('label', h('input', { type: 'checkbox', checked: !!wp.flag, onchange: e => { M.setWaypoint(wp.node, { flag: e.target.checked }); routeChanged(p.label); } }), ' Флаг bbbe0004', h('small', ' — в оригиналах только у одиночных точек (свиньи, собаки)'))),
      h('div.row', h('button', { onclick: () => insertWaypoint(pt, i) }, '+ Точка после'),
        h('button', { disabled: i === 0, onclick: () => moveWaypoint(pt, i, -1) }, '↑ Раньше'),
        h('button', { disabled: i === pt.points.length - 1, onclick: () => moveWaypoint(pt, i, 1) }, '↓ Позже')),
      h('div.row', h('button.danger', { onclick: () => removeWaypoint(pt, i) }, '✕ Удалить точку'), h('button', { onclick: back }, '← К существу')));
  }
  function ensurePatrol(o) {
    let pt = M.getPatrols(o.node)[0];
    if (pt) return pt;
    const logic = o.node.children.find(c => c.id === 0xbbbc0000);
    if (!logic) { toast('У существа нет блока поведения — скопируйте патрульного с другой карты', 'err'); return null; }
    const pos = M.getField(o.node, M.OBJ.pos);
    logic.children.push({ id: 0xbbbd0000, children: [{ id: 0xbbbd0001, data: M.codec.vec3.set([pos[0], pos[1], groundZ(pos[0], pos[1])]) }] });
    M.setField(logic, [0xbbbc0003, 'u32'], 2); // behaviour: patrol path
    return M.getPatrols(o.node)[0];
  }
  // New waypoint at (x, y) after point `after` (-1: at the start, undefined: at the end).
  function putWaypoint(o, x, y, after) {
    const pt = ensurePatrol(o); if (!pt) return;
    const node = M.newWaypoint([x, y, groundZ(x, y)], pt.points[after ?? pt.points.length - 1]?.wait ?? 30);
    const ref = pt.points[(after ?? pt.points.length - 1) + 1]?.node;
    if (ref) pt.node.children.splice(pt.node.children.indexOf(ref), 0, node); else pt.node.children.push(node);
    routeChanged('wp' + ((after ?? pt.points.length - 1) + 1));
  }
  function addWaypoint(o) {
    const pt = M.getPatrols(o.node)[0], last = pt?.points.at(-1)?.pos || pt?.guard || M.getField(o.node, M.OBJ.pos);
    putWaypoint(o, last[0] + 4, last[1]);
  }
  function insertWaypoint(pt, i) {
    const a = pt.points[i].pos, b = pt.points[i + 1]?.pos || pt.points[0].pos;
    const [x, y] = pt.points.length > 1 ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : [a[0] + 4, a[1]];
    putWaypoint(st.sel, x, y, i);
  }
  function moveWaypoint(pt, i, d) {
    const a = pt.node.children.indexOf(pt.points[i].node), b = pt.node.children.indexOf(pt.points[i + d].node);
    [pt.node.children[a], pt.node.children[b]] = [pt.node.children[b], pt.node.children[a]];
    routeChanged(st.selPt ? 'wp' + (i + d) : null);
  }
  function removeWaypoint(pt, i) {
    pt.node.children.splice(pt.node.children.indexOf(pt.points[i].node), 1);
    st.selPt = null; gizmo.attach(st.sel.group); routeChanged();
  }
  function sculptPanel() {
    const b = st.brush;
    return h('div.form', h('h4', 'Рельеф'),
      h('div.row', [['raise', 'Поднять'], ['lower', 'Опустить'], ['smooth', 'Сгладить'], ['flatten', 'Выровнять']].map(([k, t]) => h('button', { className: b.tool === k ? 'primary' : '', onclick: () => { b.tool = k; renderProps(); } }, t))),
      slider('Радиус кисти', 1, 20, 1, 'radius'), slider('Сила', 0.02, 1, 0.02, 'strength'),
      h('p.muted', 'Зажмите левую кнопку мыши на земле и водите. Вращать камеру — правой кнопкой.'),
      h('p.muted', `Максимальная высота карты: ${fmt(st.map?.maxZ || 0)}`));
  }
  function slider(label, min, max, step, key) {
    const out = h('span', ' ' + st.brush[key]);
    return h('div.f', h('label', label, out), h('input', { type: 'range', min, max, step, value: st.brush[key], oninput: e => { st.brush[key] = +e.target.value; out.textContent = ' ' + e.target.value; } }));
  }
  function paintPanel() {
    const b = st.brush, wrap = h('div.tiles');
    (terrain?.material || []).forEach((mat, a) => {
      const img = mat.map?.userData.image;
      if (!img) return;
      for (let t = 0; t < 64; t++) {
        const c = h('canvas', { width: 48, height: 48, title: `Текстура ${a}, тайл ${t}`, className: b.tile === ((a << 6) | t) ? 'sel' : '', onclick: () => { b.tile = (a << 6) | t; renderProps(); } });
        const ctx = c.getContext('2d'), id = ctx.createImageData(48, 48);
        // same orientation as on the ground: rows from the bottom, rows flipped (north is up on screen)
        const tx = (t & 7) * 64 + 8, ty = (7 - (t >> 3)) * 64 + 8;
        for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const s = ((ty + y) * img.width + tx + x) * 4; id.data.set(img.rgba.subarray(s, s + 4), (y * 48 + x) * 4); }
        ctx.putImageData(id, 0, 0);
        wrap.append(c);
      }
    });
    return h('div.form', h('h4', 'Текстуры земли'), slider('Радиус кисти (в тайлах)', 0, 8, 1, 'radius'),
      h('div.f', h('label', 'Поворот тайла'), h('div.row', [0, 1, 2, 3].map(r => h('button', { className: b.rot === r ? 'primary' : '', onclick: () => { b.rot = r; renderProps(); } }, r * 90 + '°')))),
      wrap);
  }

  // ---------- edit actions ----------
  function toGround(o) { const p = M.getField(o.node, M.OBJ.pos); M.setField(o.node, M.OBJ.pos, [p[0], p[1], 0]); syncFromNode(o); markMob(); renderProps(); }
  function objectsContainer() {
    const root = st.mob.chunks.find(c => c.id === 0xa000);
    let b = root.children.find(c => c.id === 0xb000);
    if (!b) root.children.push(b = { id: 0xb000, children: [] });
    return b;
  }
  function insertClone(src, mutate) {
    const copy = M.cloneChunk(src.node);
    const id = M.maxObjectId(st.mob) + 1;
    M.setField(copy, M.OBJ.id, id);
    mutate?.(copy, id);
    const parent = src.parent || objectsContainer();
    parent.children.splice(parent.children.indexOf(src.node) + 1, 0, copy);
    const o = { node: copy, kind: src.kind, kindName: src.kindName, parent, group: null };
    st.objects.push(o); addObjectMesh(o); replaceModel(o);
    markMob(); select(o);
    return o;
  }
  function duplicate() {
    if (!st.sel) return toast('Выберите объект', 'err');
    insertClone(st.sel, (c, id) => {
      const p = M.getField(c, M.OBJ.pos); M.setField(c, M.OBJ.pos, [p[0] + 2, p[1] + 2, p[2]]);
      M.setField(c, M.OBJ.name, (M.getField(c, M.OBJ.name) || '').replace(/-\d+$/, '') + '-' + id);
    });
  }
  function removeSelected() {
    const o = st.sel;
    if (!o) return;
    const name = objLabel(o);
    if (!confirm(`Удалить «${name}»? Если на него ссылается скрипт карты, скрипт может перестать работать.`)) return;
    o.parent.children.splice(o.parent.children.indexOf(o.node), 1);
    objRoot.remove(o.group); o.group = null;
    st.objects.splice(st.objects.indexOf(o), 1);
    select(null); markMob();
  }
  // Searchable picker dialog: items [{title, sub, value}] -> onPick(value). `extra` goes under the list.
  function pickDialog(heading, placeholder, items, onPick, extra) {
    const dlg = h('dialog', { style: { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '8px', width: '560px' } });
    const close = () => { dlg.close(); dlg.remove(); };
    const q = h('input.search', { placeholder, oninput: () => fill() });
    const ul = h('ul.list', { style: { maxHeight: '50vh', overflow: 'auto', margin: '8px 0' } });
    const fill = () => { const s = q.value.toLowerCase(); ul.replaceChildren(...items.filter(i => !s || i.title.toLowerCase().includes(s) || i.sub.toLowerCase().includes(s)).slice(0, 400).map(i => h('li', { onclick: () => { close(); onPick(i.value); } }, i.title, h('small.sub', i.sub)))); };
    dlg.append(h('h3', { style: { marginTop: 0 } }, heading), q, ul, extra?.(close) || null, h('div.row', { style: { marginTop: '8px' } }, h('button', { onclick: close }, 'Отмена')));
    document.body.append(dlg); fill(); dlg.showModal(); q.focus();
    dlg.addEventListener('close', () => dlg.remove()); // Esc
  }
  // Template chunk of a kind: the selected/any one on this map, else the first one found in other maps.
  async function templateOf(kind) {
    const here = st.sel?.kind === kind ? st.sel : st.objects.find(o => o.kind === kind);
    if (here) return here;
    const t = (await gameCatalog(mobs)).templates.get(kind);
    return t && { node: t, kind, kindName: M.KINDS[kind], parent: null };
  }
  async function addCreature() {
    const template = await templateOf(0xbbbb0000);
    if (!template) return toast('Не нашлось ни одного существа ни на одной карте игры', 'err');
    pickDialog('Добавить существо', 'Поиск по названию: гоблин, орк, Human…',
      unitInfo.prototypes.map(u => ({ title: u.title || u.name, sub: [u.title ? u.name : null, u.kind, u.model].filter(Boolean).join(' · '), value: u })), place);
    function place(u) {
      const t = controls.target;
      insertClone(template, (c, id) => setupUnit(c, u, id, [t.x, t.y, 0]));
      toast(`Добавлено: ${u.title || u.name}. Оно стоит в центре экрана — передвиньте его.`);
    }
  }
  async function addObject() {
    const template = await templateOf(0xb001);
    if (!template) return toast('Не нашлось ни одного объекта ни на одной карте игры', 'err');
    const { objects } = await gameCatalog(mobs);
    const custom = close => {
      const model = h('input', { placeholder: 'модель (например, своя из OBJ)' }), tex = h('input', { placeholder: 'текстура' });
      return h('div.form', h('label', 'Или своя модель из «Модели и анимации»:'), h('div.row', model, tex,
        h('button', { onclick: () => { if (!model.value.trim()) return; close(); place({ proto: model.value.trim(), model: model.value.trim(), texture: tex.value.trim() || model.value.trim() }); } }, 'Поставить')));
    };
    pickDialog('Добавить объект', 'Поиск: tree, house, bridge, fence…', objects.map(o => ({ title: o.proto, sub: `${o.model} · ${o.texture} · встречается ${o.count} раз`, value: o })), place, custom);
    function place(o) {
      const t = controls.target;
      insertClone(template, (c, id) => setupObject(c, o, id, [t.x, t.y, 0]));
      toast(`Добавлено: ${o.proto}. Объект стоит в центре экрана — передвиньте его.`);
    }
  }

  // ---------- AI path graph ----------
  function markGraph(x0, y0, x1, y1) { // world rect -> nodes (4x4 m) to rebuild
    if (!st.map) return;
    const W = st.map.sx * 8, H = st.map.sy * 8;
    for (let y = Math.max(0, Math.floor(y0 / 4)); y <= Math.min(H - 1, Math.floor(y1 / 4)); y++)
      for (let x = Math.max(0, Math.floor(x0 / 4)); x <= Math.min(W - 1, Math.floor(x1 / 4)); x++) graphDirty.add(y * W + x);
  }
  async function rectOf(model, pos, rot) {
    const data = model && await loadModelData(model), box = data && modelBox(data);
    return box ? objectRect(box, pos, rot || undefined) : null;
  }
  const markRect = r => { const ex = Math.abs(r.c) * r.hx + Math.abs(r.s) * r.hy, ey = Math.abs(r.s) * r.hx + Math.abs(r.c) * r.hy; markGraph(r.x - ex - 2, r.y - ey - 2, r.x + ex + 2, r.y + ey + 2); };
  // Original graph with nodes around changed terrain/objects rebuilt; null when the mob has no graph.
  async function currentGraph() {
    if (!graphChunk || !st.map) return null;
    const statics = st.objects.filter(o => o.kind !== 0xbbbb0000), seen = new Set();
    for (const o of statics) {
      seen.add(o.node);
      const old = snapshot.get(o.node);
      if (old?.key === objKey(o)) continue;
      if (old) { const r = await rectOf(old.model, old.pos, old.rot); if (r) markRect(r); }
      const r = await rectOf(M.getField(o.node, M.OBJ.model), M.getField(o.node, M.OBJ.pos), M.getField(o.node, M.OBJ.rot));
      if (r) markRect(r); else { const p = M.getField(o.node, M.OBJ.pos); markGraph(p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3); }
    }
    for (const [node, old] of snapshot) if (!seen.has(node)) { const r = await rectOf(old.model, old.pos, old.rot); if (r) markRect(r); }
    const base = readAiGraph(graphChunk.data);
    if (!graphDirty.size) return base;
    const rects = (await Promise.all(statics.map(o => rectOf(M.getField(o.node, M.OBJ.model), M.getField(o.node, M.OBJ.pos), M.getField(o.node, M.OBJ.rot))))).filter(Boolean);
    return buildAiGraph(st.map, rects, { base, dirty: (x, y) => graphDirty.has(y * base.W + x) });
  }
  let passPoints = null;
  function togglePassability() {
    const on = !passPoints;
    passBtn.classList.toggle('primary', on); passSel.style.display = on ? '' : 'none';
    if (on) showPassability(); else { scene.remove(passPoints); passPoints = null; }
  }
  async function showPassability() {
    const gr = await guard(currentGraph);
    if (passPoints) scene.remove(passPoints);
    if (!gr) { toast(graphChunk ? 'Нет ландшафта' : 'В этом файле нет графа проходимости — он хранится в основном .mob зоны', 'err'); passBtn.classList.remove('primary'); passSel.style.display = 'none'; passPoints = null; return; }
    const L = gr.layers[+passSel.value], P = [], C = [];
    for (let y = 0; y < gr.H; y++) for (let x = 0; x < gr.W; x++) {
      let open = 0;
      for (let d = 0; d < 8; d++) if (L.cost[(y * gr.W + x) * 8 + d] !== 0xffff) open++;
      const isEdge = x === 0 || y === 0 || x === gr.W - 1 || y === gr.H - 1, full = isEdge ? open >= 3 : open === 8;
      P.push(x * 4 + 2, y * 4 + 2, groundZ(x * 4 + 2, y * 4 + 2) + 0.4);
      C.push(...(full ? [0.3, 0.85, 0.3] : open ? [1, 0.6, 0.1] : [0.9, 0.15, 0.1]));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    passPoints = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.85 }));
    scene.add(passPoints);
  }

  async function save() {
    await guard(async () => {
      if (graphChunk && (st.mobChanged || st.mprChanged)) {
        const gr = await currentGraph();
        if (graphDirty.size) { graphChunk.data = writeAiGraph(gr); st.mobChanged = true; toast(`Проходимость пересчитана для ${graphDirty.size} участков 4×4 м`); }
        graphDirty.clear(); snapshot.clear();
        for (const o of st.objects) if (o.kind !== 0xbbbb0000) snapshot.set(o.node, { key: objKey(o), model: M.getField(o.node, M.OBJ.model), pos: M.getField(o.node, M.OBJ.pos), rot: M.getField(o.node, M.OBJ.rot) });
      } else if (st.mprChanged && !graphChunk) toast('Рельеф изменён, но граф проходимости хранится в основном .mob этой зоны — откройте его и сохраните, чтобы пересчитать.', 'err');
      if (st.mobChanged) {
        // re-encode only when edited, keeping the original line-ending style
        if (st.scriptChanged) M.setScript(st.mob, origScript.includes('\r\n') ? scriptArea.value.replace(/\n/g, '\r\n') : scriptArea.value);
        await api.saveFile('Maps/' + st.mobFile, M.writeMob(st.mob));
        st.mobChanged = st.scriptChanged = false;
      }
      if (st.mprChanged) { await api.saveFile('Maps/' + st.mprFile, writeMpr(st.map)); st.mprChanged = false; }
      saveBtn.disabled = true; dirty.delete('map');
    }, 'Карта сохранена');
  }

  function onKey(e) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === 'Delete' && st.sel && !st.selPt) removeSelected();
    else if ((e.key === 'd' || e.key === 'в') && e.ctrlKey) { e.preventDefault(); duplicate(); }
    else if (e.code === 'KeyW') gizmo.setMode('translate');
    else if (e.code === 'KeyE' && st.sel && !st.selPt) { gizmo.setMode('rotate'); gizmo.showX = gizmo.showY = false; gizmo.showZ = true; }
    else if (e.code === 'KeyF' && st.sel) select(st.sel, true);
    else if (e.code === 'KeyG' && st.sel) toGround(st.sel);
  }
  window.addEventListener('keydown', onKey);

  return () => { alive = false; ro.disconnect(); window.removeEventListener('keydown', onKey); window.removeEventListener('pointerup', onUp); renderer.setAnimationLoop(null); renderer.dispose(); };
}
