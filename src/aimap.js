// Passability as game.exe computes it, via tools/aimap (Go): New EI's port of the game's fine AI grid
// (CAIMap, 0.5 m cells) and graph builder, read from ../New EI. Built with `go build` once per process,
// so fixes in New EI reach the editor on restart; an existing aimap.exe is used when Go is missing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HERE, GAME } from './game.js';

const run = promisify(execFile);
const DIR = path.join(HERE, 'tools', 'aimap'), EXE = path.join(DIR, 'aimap.exe');
let built;
const build = () => (built ??= run('go', ['build', '-o', EXE, '.'], { cwd: DIR, windowsHide: true }).catch(e => {
  if (!fs.existsSync(EXE)) { built = null; throw new Error('Не собран tools/aimap (нужен Go и папка New EI рядом с Editor): ' + (e.stderr || e.message)); }
}));

// mpr, mob: Uint8Array of the current (maybe unsaved) files -> raw helper output (formats/aigraph.js readGrid).
export async function aimapRaw(mpr, mob, { graph = false } = {}) {
  await build();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-aimap-')), inp = path.join(tmp, 'in.bin'), out = path.join(tmp, 'out.bin');
  try {
    const len = Buffer.alloc(4); len.writeUInt32LE(mpr.length);
    fs.writeFileSync(inp, Buffer.concat([len, mpr, mob]));
    await run(EXE, ['-game', GAME, '-in', inp, '-out', out, ...(graph ? ['-graph'] : [])], { windowsHide: true, maxBuffer: 1 << 20 })
      .catch(e => { throw new Error('aimap: ' + (e.stderr || e.message).trim()); });
    return fs.readFileSync(out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
