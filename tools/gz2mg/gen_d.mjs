// Phase D: database records (custom units, quest items), red lizard skin
import { call } from './ei.mjs';
import fs from 'node:fs';
const { decodePng, encodePng } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/png.js');
const log = (...a) => console.log(...a.map(x => typeof x === 'string' ? x : JSON.stringify(x).slice(0, 300)));
async function addRec(file, table, from, name, fields) {
  const have = await call('db_records', { file, table, query: name });
  if (!have.records.some(r => String(r[1]).toLowerCase() === name.toLowerCase())) log(await call('db_record_add', { file, table, from, name }));
  if (fields) log(await call('db_record_set', { file, table, record: name, fields }));
}
// --- creatures ---
await addRec('units.udb', 3, 'Human Hadagan Fire Mage M14', 'Hadagan Magister Zart', { 'Stats Health': '420', 'Stats Mana': '320', 'Base Level': '18', 'Stats Exp': '1500', 'Skills Elemental': '95, 95, 95', 'Stats Absorbtion': '24' });
await addRec('units.udb', 3, 'DragonkinOrcishF9', 'DragonkinFireF14', { 'Stats Health': '320', 'Stats Mana': '80', 'Base Level': '14', 'Stats Exp': '450', 'Stats To Hit': '92', 'Stats Danage Nub': '26', 'Stats Damage Max': '34', 'Stats Absorbtion': '22', 'Graphics Data Complection Z': '0.95', 'Skills Elemental': '60, 60, 60' });
await addRec('units.udb', 3, 'TrollGreenF10', 'TrollGreenOldF13', { 'Stats Health': '260', 'Base Level': '13', 'Stats Exp': '380', 'Stats Danage Nub': '24', 'Stats Damage Max': '30', 'Graphics Data Complection Z': '1' });
await addRec('units.udb', 3, 'UndeadF15', 'UndeadKeeperF16', { 'Stats Health': '330', 'Base Level': '16', 'Stats Exp': '600' });
// --- quest items (copies keep the original pictures) ---
const QI = [['herbbag', 'thiefsack', 101], ['trollfang', 'lizardclaw00', 102], ['firescale', 'dragonshell00', 103], ['fireamulet', 'dragonamulet', 104], ['zartjournal', 'journal00', 105], ['olgerdletter', 'note', 106]];
for (const [n, from, id] of QI) await addRec('items.idb', 5, from, n, { ScriptID: String(id) });
// --- red skin for the fire lizard: LizardMan00 (blue) with red/blue swapped and warmed ---
const src = process.cwd() + '/LizardMan00.png';
await call('texture_export', { name: 'LizardMan00.mmp', save_to: src });
const im = decodePng(fs.readFileSync(src)), o = new Uint8Array(im.rgba.length);
for (let i = 0; i < o.length; i += 4) { const r = im.rgba[i], g = im.rgba[i + 1], b = im.rgba[i + 2]; o[i] = Math.min(255, b * 1.25 + 18); o[i + 1] = Math.min(255, g * 0.55 + b * 0.18); o[i + 2] = Math.min(255, r * 0.45); o[i + 3] = im.rgba[i + 3]; }
fs.writeFileSync('LizardManFire.png', encodePng(im.width, im.height, o));
log(await call('texture_import', { name: 'LizardManFire.mmp', png_path: process.cwd() + '/LizardManFire.png' }));
