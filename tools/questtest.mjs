// Node can't import the browser view (it imports /app.js), so copy the pure parsers out of it.
import fs from 'fs';
import { fileURLToPath } from 'url';
import { readRes } from '../src/formats/res.js';
import { cp1251 } from '../src/formats/bytes.js';
const src = fs.readFileSync('public/views/quests.js', 'utf8');
const pure = src.slice(src.indexOf('export function parseQuest'), src.indexOf('export async function mount'));
const mod = await import('data:text/javascript,' + encodeURIComponent(pure));
let q = 0, qok = 0, b = 0, bok = 0; const bad = [];
const norm = t => t.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd()).filter(Boolean).join('\n');
for (const e of readRes(fs.readFileSync(fileURLToPath(new URL('../../Evil Islands/', import.meta.url)) + 'Res/texts.res'))) {
  const t = cp1251.decode(e.data);
  if (/^quest /i.test(e.name)) { q++; const back = mod.questToText(mod.parseQuest(t)); if (JSON.stringify(mod.parseQuest(back)) === JSON.stringify(mod.parseQuest(t))) qok++; else bad.push(e.name); }
  if (/^briefing /i.test(e.name)) { b++; const p = mod.parseBriefing(t); const back = mod.briefingToText(p); const p2 = mod.parseBriefing(back); if (JSON.stringify(p2.items.map(i => i.text ?? i.line)) === JSON.stringify(p.items.map(i => i.text ?? i.line)) && norm(back).replace(/#phrase (\S+)\s+\d+/g, '#phrase $1') === norm(t).replace(/#phrase (\S+)\s+\d*/g, '#phrase $1')) bok++; else bad.push(e.name); }
}
console.log({ quests: q, questsOk: qok, briefings: b, briefingsOk: bok, bad: bad.slice(0, 8) });
