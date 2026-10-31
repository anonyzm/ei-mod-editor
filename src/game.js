// Game folder access for Node (server.js and mcp.js): safe paths, backups before the first write,
// atomic writes, cached RES archives. Every game file is copied to backup/ before its first
// modification; files the editor creates are listed in backup/_created.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRes, writeRes } from './formats/res.js';

export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
export const config = { gameDir: path.resolve(HERE, '..', 'Evil Islands'), port: 8765, ...readJson(path.join(HERE, 'config.json')) };
if (process.env.EI_GAME_DIR) config.gameDir = process.env.EI_GAME_DIR; // tests run on a copy of the game
if (process.env.PORT) config.port = +process.env.PORT; // a second server next to the user's one
export const GAME = path.resolve(config.gameDir);
export const BACKUP = process.env.EI_BACKUP_DIR ? path.resolve(process.env.EI_BACKUP_DIR) : path.join(HERE, 'backup');

export const httpError = (code, msg) => Object.assign(new Error(msg), { code });

// Resolve a game-relative path and refuse anything that escapes the game folder.
export function gamePath(rel) {
  if (!rel) throw httpError(400, 'Не указан путь');
  const p = path.resolve(GAME, rel);
  if (p !== GAME && !p.startsWith(GAME + path.sep)) throw httpError(403, 'Путь вне папки игры');
  return p;
}

const CREATED = path.join(BACKUP, '_created.json');
const created = () => readJson(CREATED).files || [];

function backupOnce(abs) {
  const rel = path.relative(GAME, abs).replace(/\\/g, '/');
  if (created().includes(rel)) return; // our own file: restore deletes it, there is no original to keep
  if (!fs.existsSync(abs)) { fs.mkdirSync(BACKUP, { recursive: true }); fs.writeFileSync(CREATED, JSON.stringify({ files: [...created(), rel] }, null, 1)); return; }
  const dst = path.join(BACKUP, path.relative(GAME, abs));
  if (fs.existsSync(dst)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
}

export function writeGameFile(abs, data) {
  backupOnce(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp-editor';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs); // atomic replace: a crash never leaves a half-written game file
  resCache.delete(abs);
}

// Parsed RES archives cached by mtime (textures.res etc. are big).
const resCache = new Map();
export function loadRes(abs) {
  const st = fs.statSync(abs);
  const c = resCache.get(abs);
  if (c && c.mtime === st.mtimeMs) return c.entries;
  const entries = readRes(fs.readFileSync(abs));
  resCache.set(abs, { mtime: st.mtimeMs, entries });
  return entries;
}

export function resEntry(rel, name) {
  const e = loadRes(gamePath(rel)).find(x => x.name.toLowerCase() === String(name).toLowerCase());
  if (!e) throw httpError(404, `Нет ${name} в ${rel}`);
  return e.data;
}

// put: [{name, data: Uint8Array}], remove: [name] — several entries changed in one rewrite.
export function resUpdate(rel, put = [], remove = []) {
  const abs = gamePath(rel);
  let entries = fs.existsSync(abs) ? loadRes(abs).slice() : [];
  const del = new Set(remove.map(n => n.toLowerCase()));
  entries = entries.filter(e => !del.has(e.name.toLowerCase()));
  for (const p of put) {
    const i = entries.findIndex(e => e.name.toLowerCase() === p.name.toLowerCase());
    if (i >= 0) entries[i] = { name: entries[i].name, data: p.data }; else entries.push({ name: p.name, data: p.data });
  }
  writeGameFile(abs, writeRes(entries));
  return entries.length;
}

export const readGameFile = rel => new Uint8Array(fs.readFileSync(gamePath(rel)));
export const saveGameFile = (rel, data) => writeGameFile(gamePath(rel), data);
export const listDir = d => fs.existsSync(path.join(GAME, d)) ? fs.readdirSync(path.join(GAME, d)) : [];

export function listBackups() {
  const out = [];
  const walk = d => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else out.push(path.relative(BACKUP, p).replace(/\\/g, '/')); } };
  walk(BACKUP);
  const c = created();
  // a "backup" of a created file is a stale copy left by older versions, not an original
  return out.filter(f => f !== '_created.json' && !c.includes(f)).concat(c.map(f => f + ' (новый)'));
}

// One file (rel) or everything: originals copied back, created files deleted.
export function restore(rel) {
  const files = rel ? [rel] : listBackups().filter(f => !f.endsWith(' (новый)'));
  if (!rel) {
    for (const c of created()) { const p = gamePath(c); if (fs.existsSync(p)) fs.rmSync(p); resCache.delete(p); fs.rmSync(path.join(BACKUP, c), { force: true }); }
    fs.rmSync(CREATED, { force: true });
  }
  for (const f of files) {
    const src = path.join(BACKUP, f), dst = gamePath(f);
    if (!src.startsWith(BACKUP) || !fs.existsSync(src)) continue;
    fs.copyFileSync(src, dst); resCache.delete(dst);
    fs.rmSync(src);
  }
  return files.length;
}
