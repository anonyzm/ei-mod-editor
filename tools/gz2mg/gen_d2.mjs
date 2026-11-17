// red fire troll: unit record + red skin
import { call } from './ei.mjs';
import fs from 'node:fs';
const { decodePng, encodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const have = await call('db_records', { file: 'units.udb', table: 3, query: 'TrollRedF14' });
if (!have.total) console.log(JSON.stringify(await call('db_record_add', { file: 'units.udb', table: 3, from: 'TrollBlueF12', name: 'TrollRedF14' })));
console.log(JSON.stringify(await call('db_record_set', { file: 'units.udb', table: 3, record: 'TrollRedF14', fields: { 'Stats Health': '320', 'Stats Mana': '140', 'Base Level': '14', 'Stats Exp': '520', 'Skills Elemental': '65, 65, 65', 'Graphics Data Complection Z': '0.9' } })));
await call('texture_export', { name: 'Troll00.mmp', save_to: process.cwd() + '/Troll00.png' });
const im = decodePng(fs.readFileSync('Troll00.png')), o = new Uint8Array(im.rgba.length);
for (let i = 0; i < o.length; i += 4) { const r = im.rgba[i], g = im.rgba[i + 1], b = im.rgba[i + 2], l = (r + g + b) / 3; o[i] = Math.min(255, l * 1.05 + 8); o[i + 1] = Math.min(255, l * 0.38); o[i + 2] = Math.min(255, l * 0.3); o[i + 3] = im.rgba[i + 3]; }
fs.writeFileSync('TrollRed00.png', encodePng(im.width, im.height, o));
console.log(JSON.stringify(await call('texture_import', { name: 'TrollRed00.mmp', png_path: process.cwd() + '/TrollRed00.png' })));
console.log(JSON.stringify(await call('texts_set', { entries: [{ name: 'UNIT TrollRedF14', text: 'Огненный тролль\n' }] })));
