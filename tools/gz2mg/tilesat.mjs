// most common tile codes inside a rectangle of a landscape: node tilesat.mjs zone10 x0 y0 x1 y1
import fs from 'node:fs';
const { readMpr } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/formats/mpr.js');
const [mpr, x0, y0, x1, y1] = process.argv.slice(2);
const map = readMpr(new Uint8Array(fs.readFileSync(`C:/GOG Games/EI_edit/Evil Islands/Maps/${mpr}.mpr`)));
const c = {};
for (let ty = Math.floor(y0 / 2); ty < Math.floor(y1 / 2); ty++) for (let tx = Math.floor(x0 / 2); tx < Math.floor(x1 / 2); tx++) { const t = map.tiles[ty * map.TW + tx] & 0x3fff; c[t] = (c[t] || 0) + 1; }
console.log(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t, n]) => `${t}:${n}(${map.tileTypes[t]})`).join(' '));
