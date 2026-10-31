// Local editor server: serves the UI and gives it read/write access to the game folder.
// Game file access, backups and restore live in src/game.js (shared with mcp.js).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { HERE, config, GAME, gamePath, httpError, writeGameFile, loadRes, resEntry, resUpdate, listBackups, restore } from './src/game.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const STATIC = { '/formats/': path.join(HERE, 'src', 'formats'), '/shared/': path.join(HERE, 'src', 'shared'), '/vendor/three/': path.join(HERE, 'node_modules', 'three'), '/data/': path.join(HERE, 'data'), '/': path.join(HERE, 'public') };

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
  'GET /api/res/entry': ({ q }) => { const d = resEntry(q.path, q.name); return Buffer.from(d.buffer, d.byteOffset, d.byteLength); },
  // Body: JSON {put: [{name, b64}], remove: [name]} — several entries changed in one rewrite.
  'POST /api/res/update': async ({ q, req }) => {
    const { put = [], remove = [] } = JSON.parse((await body(req)).toString('utf8'));
    return { ok: true, count: resUpdate(q.path, put.map(p => ({ name: p.name, data: new Uint8Array(Buffer.from(p.b64, 'base64')) })), remove) };
  },
  'GET /api/backups': () => listBackups(),
  'POST /api/restore': ({ q }) => ({ restored: restore(q.path) }),
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
