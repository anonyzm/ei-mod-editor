// Dump RES entries as text (or raw files with HEX=1). Usage: node tools/dump.mjs <file.res> <entry> [entry...]
import fs from 'fs'; import {readRes} from '../src/formats/res.js';
const [f, ...names] = process.argv.slice(2); const e = readRes(fs.readFileSync(f));
for (const n of names) { const x = e.find(y=>y.name.toLowerCase()===n.toLowerCase()); if(!x){console.log('NO',n);continue;}
  if (process.env.HEX) { fs.writeFileSync(n.replace(/[\\ ]/g,'_'), x.data); console.log('saved',n,x.data.length); }
  else console.log('==',n,'\n'+new TextDecoder('windows-1251').decode(x.data)); }
