import fs from 'fs';
const buf = fs.readFileSync(process.argv[2]); const dv = new DataView(buf.buffer, buf.byteOffset);
const maxDepth = +process.argv[3] || 4; const counts = {};
function walk(off, end, depth, path) {
  while (off + 8 <= end) {
    const id = dv.getUint32(off, true), size = dv.getUint32(off + 4, true);
    if (size < 8 || off + size > end) { console.log(' '.repeat(depth*2)+'?? bad at', off, id.toString(16), size); return false; }
    const key = path + '/' + id.toString(16); counts[key] = (counts[key]||0)+1;
    const body = buf.subarray(off + 8, off + size);
    if (counts[key] <= 2 && depth < maxDepth) {
      let preview = body.length <= 64 ? Buffer.from(body).toString('hex') : '';
      console.log(' '.repeat(depth*2) + id.toString(16) + ' size=' + size + ' ' + preview);
    }
    // try recursing: if body parses as chunks fully, treat as container
    if (size > 16 && looksContainer(off + 8, off + size)) walk(off + 8, off + size, depth + 1, key);
    off += size;
  }
  return true;
}
function looksContainer(off, end) {
  while (off + 8 <= end) { const s = dv.getUint32(off+4, true); const id = dv.getUint32(off,true); if (s < 8 || off + s > end || (id & 0xffff0000) === 0 && id > 0xffff) return false; off += s; }
  return off === end;
}
walk(0, buf.length, 0, '');
console.log(Object.entries(counts).map(([k,v])=>k+' x'+v).join('\n'));
