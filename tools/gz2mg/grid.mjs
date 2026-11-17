// node grid.mjs out.png a.png b.png c.png d.png  -> 2x2 mosaic at half size
import fs from 'node:fs';
const { decodePng, encodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const [out, ...f] = process.argv.slice(2); const ims = f.map(p => decodePng(fs.readFileSync(p)));
const w = ims[0].width >> 1, h = ims[0].height >> 1, cols = 2, rows = Math.ceil(ims.length / 2), o = new Uint8Array(w * cols * h * rows * 4);
ims.forEach((im, k) => { const ox = (k % 2) * w, oy = Math.floor(k / 2) * h; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y * 2) * im.width + x * 2) * 4, d = ((oy + y) * w * cols + ox + x) * 4; o.set(im.rgba.subarray(s, s + 4), d); } });
fs.writeFileSync(out, encodePng(w * cols, h * rows, o));
