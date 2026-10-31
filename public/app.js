// App shell: navigation, server API, small DOM helpers shared by all views.
export const api = {
  async json(url, opts) { const r = await fetch(url, opts); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; },
  async bytes(url) { const r = await fetch(url); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return new Uint8Array(await r.arrayBuffer()); },
  info: () => api.json('/api/info'),
  file: p => api.bytes('/api/file?path=' + encodeURIComponent(p)),
  saveFile: (p, data) => api.json('/api/file?path=' + encodeURIComponent(p), { method: 'PUT', body: data }),
  resList: p => api.json('/api/res/list?path=' + encodeURIComponent(p)),
  resEntry: (p, name) => api.bytes(`/api/res/entry?path=${encodeURIComponent(p)}&name=${encodeURIComponent(name)}`),
  resUpdate: (p, put = [], remove = []) => api.json('/api/res/update?path=' + encodeURIComponent(p), {
    method: 'POST', body: JSON.stringify({ put: put.map(x => ({ name: x.name, b64: b64(x.data) })), remove }),
  }),
};

function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); }

// h('div.cls#id', {attrs, onclick}, ...children)
export function h(tag, attrs, ...kids) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) m[1] === '.' ? el.classList.add(m[2]) : (el.id = m[2]);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

export function toast(msg, kind = 'ok') {
  const t = h('div.toast.' + kind, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 8000 : 3500);
}

// Run an async action with error reporting; returns its result or undefined.
export async function guard(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { console.error(e); toast(e.message, 'err'); }
}

export function download(name, data, type = 'application/octet-stream') {
  const a = h('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const pickFile = (accept) => new Promise(res => {
  const i = h('input', { type: 'file', accept, onchange: () => res(i.files[0] || null) });
  i.click();
});

// ---- navigation ----
const VIEWS = [
  ['home', 'Главная', '⌂'],
  ['map', 'Карты и ландшафт', '⛰'],
  ['database', 'Предметы, существа, магия', '⚔'],
  ['quests', 'Квесты и диалоги', '✉'],
  ['zones', 'Острова и зоны', '🗺'],
  ['texts', 'Все тексты игры', '✎'],
  ['models', 'Модели и анимации', '♞'],
  ['textures', 'Текстуры', '▦'],
];

const nav = document.getElementById('nav'), view = document.getElementById('view');
let current = null;
for (const [id, title, icon] of VIEWS) nav.append(h('a', { href: '#' + id, 'data-id': id }, h('span.ico', icon), title));

export const dirty = new Set(); // views with unsaved changes
window.addEventListener('beforeunload', e => { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } });

async function route() {
  const [id, ...args] = (location.hash.slice(1) || 'home').split('/');
  if (current?.id === id && current.args === args.join('/')) return;
  if (current && dirty.has(current.id) && !confirm('Есть несохранённые изменения. Уйти без сохранения?')) { location.hash = current.id; return; }
  dirty.delete(current?.id);
  current?.unmount?.();
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.id === id);
  view.replaceChildren(h('div.loading', 'Загрузка…'));
  const mod = await import(`/views/${id}.js`).catch(e => { toast(e.message, 'err'); return null; });
  if (!mod) return;
  view.replaceChildren();
  current = { id, args: args.join('/'), unmount: await guard(() => mod.mount(view, args.map(decodeURIComponent))) };
}
window.addEventListener('hashchange', route);
route();
