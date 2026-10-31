// Local editor server: serves the UI and gives it read/write access to the game folder.
// Every game file is copied to backup/ before its first modification, so originals can be restored.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { readRes, writeRes } from './src/formats/res.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(HERE, 'config.json');
const config = { gameDir: path.resolve(HERE, '..', 'Evil Islands'), port: 8765, ...readJson(CONFIG_FILE) };
const GAME = path.resolve(config.gameDir);
const BACKUP = path.join(HERE, 'backup');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const STATIC = { '/formats/': path.join(HERE, 'src', 'formats'), '/vendor/three/': path.join(HERE, 'node_modules', 'three'), '/data/': path.join(HERE, 'data'), '/': path.join(HERE, 'public') };

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }

// Resolve a game-relative path and refuse anything that escapes the game folder.
function gamePath(rel) {
  if (!rel) throw httpError(400, 'Не указан путь');
  const p = path.resolve(GAME, rel);
  if (p !== GAME && !p.startsWith(GAME + path.sep)) throw httpError(403, 'Путь вне папки игры');
  return p;
}
const httpError = (code, msg) => Object.assign(new Error(msg), { code });

// Files the editor created (not in the original game); "restore" deletes them.
const CREATED = path.join(BACKUP, '_created.json');
const created = () => readJson(CREATED).files || [];

function backupOnce(abs) {
  const rel = path.relative(GAME, abs).replace(/\\/g, '/');
  if (!fs.existsSync(abs)) {
    if (!created().includes(rel)) { fs.mkdirSync(BACKUP, { recursive: true }); fs.writeFileSync(CREATED, JSON.stringify({ files: [...created(), rel] }, null, 1)); }
    return;
  }
  const dst = path.join(BACKUP, path.relative(GAME, abs));
  if (fs.existsSync(dst)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
}

function writeGameFile(abs, data) {
  backupOnce(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp-editor';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs); // atomic replace: a crash never leaves a half-written game file
  resCache.delete(abs);
}

// Parsed RES archives cached by mtime (textures.res etc. are big).
const resCache = new Map();
function loadRes(abs) {
  const st = fs.statSync(abs);
  const c = resCache.get(abs);
  if (c && c.mtime === st.mtimeMs) return c.entries;
  const entries = readRes(fs.readFileSync(abs));
  resCache.set(abs, { mtime: st.mtimeMs, entries });
  return entries;
}

function listBackups() {
  const out = [];
  const walk = d => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else out.push(path.relative(BACKUP, p).replace(/\\/g, '/')); } };
  walk(BACKUP);
  return out.filter(f => f !== '_created.json').concat(created().map(f => f + ' (новый)'));
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const api = {
  'GET /api/info': () => {
    const ls = d => fs.existsSync(path.join(GAME, d)) ? fs.readdirSync(path.join(GAME, d)) : [];
    return { gameDir: GAME, ok: fs.existsSync(path.join(GAME, 'Res', 'database.res')), maps: ls('Maps'), res: ls('Res'), backups: listBackups().length };
  },
  'GET /api/file': ({ q }) => fs.readFileSync(gamePath(q.path)),
  'PUT /api/file': async ({ q, req }) => { writeGameFile(gamePath(q.path), await body(req)); return { ok: true }; },
  'GET /api/res/list': ({ q }) => loadRes(gamePath(q.path)).map(e => ({ name: e.name, size: e.data.length })),
  'GET /api/res/entry': ({ q }) => {
    const e = loadRes(gamePath(q.path)).find(x => x.name.toLowerCase() === String(q.name).toLowerCase());
    if (!e) throw httpError(404, `Нет ${q.name} в ${q.path}`);
    return Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength);
  },
  // Body: JSON {put: [{name, b64}], remove: [name]} — several entries changed in one rewrite.
  'POST /api/res/update': async ({ q, req }) => {
    const abs = gamePath(q.path);
    const { put = [], remove = [] } = JSON.parse((await body(req)).toString('utf8'));
    let entries = fs.existsSync(abs) ? loadRes(abs).slice() : [];
    const del = new Set(remove.map(n => n.toLowerCase()));
    entries = entries.filter(e => !del.has(e.name.toLowerCase()));
    for (const p of put) {
      const data = new Uint8Array(Buffer.from(p.b64, 'base64'));
      const i = entries.findIndex(e => e.name.toLowerCase() === p.name.toLowerCase());
      if (i >= 0) entries[i] = { name: entries[i].name, data }; else entries.push({ name: p.name, data });
    }
    writeGameFile(abs, writeRes(entries));
    return { ok: true, count: entries.length };
  },
  'GET /api/backups': () => listBackups(),
  'POST /api/restore': ({ q }) => {
    const files = q.path ? [q.path] : listBackups().filter(f => !f.endsWith(' (новый)'));
    if (!q.path) {
      for (const rel of created()) { const p = gamePath(rel); if (fs.existsSync(p)) fs.rmSync(p); resCache.delete(p); }
      fs.rmSync(CREATED, { force: true });
    }
    for (const rel of files) {
      const src = path.join(BACKUP, rel), dst = gamePath(rel);
      if (!src.startsWith(BACKUP) || !fs.existsSync(src)) continue;
      fs.copyFileSync(src, dst); resCache.delete(dst);
      fs.rmSync(src);
    }
    return { restored: files.length };
  },
  'POST /api/launch': () => { exec(`start "" "${path.join(GAME, 'game.exe')}"`, { cwd: GAME }); return { ok: true }; },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = Object.fromEntries(url.searchParams);
  try {
    const handler = api[`${req.method} ${url.pathname}`];
    if (handler) {
      const out = await handler({ q, req });
      if (Buffer.isBuffer(out)) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(out); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(out));
    }
    if (req.method !== 'GET') throw httpError(404, 'Нет такого метода');
    const prefix = Object.keys(STATIC).find(p => url.pathname.startsWith(p));
    const root = STATIC[prefix];
    let file = path.resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
    if (!file.startsWith(root)) throw httpError(403, 'Запрещено');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) throw httpError(404, 'Не найдено: ' + url.pathname);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    const code = e.code === 'ENOENT' ? 404 : typeof e.code === 'number' ? e.code : 500;
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(config.port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${config.port}/`;
  console.log(`Редактор Evil Islands запущен: ${url}\nПапка игры: ${GAME}\nНе закрывайте это окно, пока работаете в редакторе.`);
  if (process.argv.includes('--open')) exec(`start "" "${url}"`);
});
