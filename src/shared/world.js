// World structure (texts.res/map.txt) and the new-zone wizard, shared by the browser UI and mcp.js.
// `io` gives file access: { file(rel), saveFile(rel, u8), resList(rel) -> [{name}], resEntry(rel, name),
// resUpdate(rel, put[{name, data}], remove[]), loadModelData(name) -> readModel() result or null }.
import { readRes } from '../formats/res.js';
import { cp1251 } from '../formats/bytes.js';
import { readMob, writeMob, getScript, setScript, listObjects, getField, OBJ } from '../formats/mob.js';
import { readMpr, writeMpr, newMpr } from '../formats/mpr.js';
import { AIGRAPH_ID, readAiGraph, writeAiGraph, buildAiGraph, modelBox } from '../formats/aigraph.js';

export const ISLAND = { gipat: 'Гипат', ingos: 'Ингос', suslanger: 'Суслангер' };

// map.txt -> { head, blocks: [{ id, allod, type, text }] }; text is kept verbatim for lossless saves.
export function parseWorld(text) {
  const parts = text.split(/(?=^#zone\s)/m);
  const head = parts[0].startsWith('#zone') ? '' : parts.shift();
  return { head, blocks: parts.map(t => { const [, id, allod, type] = t.match(/^#zone\s+(\S+)\s+(\S+)\s+(\S+)/) || []; return { id, allod, type, text: t }; }) };
}
export const worldText = w => w.head + w.blocks.map(b => b.text).join('');
export const directive = (text, name) => { const m = text.match(new RegExp(`^#${name}\\s*\\r?\\n([^#\\r\\n][^\\r\\n]*)`, 'mi')); return m?.[1].trim(); };
// Adds a one-shot trigger Script with these statements and starts it at the end of WorldScript.
// Original maps set variables only inside such Scripts and begin WorldScript with Sleep; a GSSetVar
// straight in WorldScript stopped the whole zone script in game (no triggers, exits stayed closed).
export function addTrigger(script, name, statements) {
  const w = script.lastIndexOf('WorldScript'), end = script.lastIndexOf(')');
  if (w < 0 || end < w) throw new Error('В скрипте карты нет WorldScript');
  const body = statements.map(s => `    ${s} \r\n`).join('');
  return script.slice(0, w) + `DeclareScript ${name} (  this : object )\r\n\r\nScript ${name}\r\n(\r\n  if\r\n  (\r\n  )\r\n  then\r\n  (\r\n    KillScript(  ) \r\n${body}  )\r\n)\r\n\r\n`
    + script.slice(w, end).replace(/\s*$/, '') + `\r\n  ${name}( NULL ) \r\n` + script.slice(end);
}
export const exitsOf = text =>[...text.matchAll(/^#exit\s+(\d+)\s*\r?\n\s*(\S+)\s+(\S+)/gmi)].map(m => ({ n: +m[1], to: m[2], entrance: +m[3] }));

export async function loadWorld(io) {
  return parseWorld(cp1251.decode(readRes(await io.file('Res/texts.res')).find(e => e.name.toLowerCase() === 'map.txt').data));
}
export const saveWorld = (io, world) => io.resUpdate('Res/texts.res', [{ name: 'map.txt', data: cp1251.encode(worldText(world)) }]);

// opts: { id, file, title, allod, tpl (template zone id), relief: 'flat'|'copy', sx, sy, link (zone id or ''), open }
// Writes Maps/<file>.mpr/.mob, terrain atlases + minimaps into textures.res, and map.txt blocks.
export async function createZone(io, world, opts) {
  const { id, title = id, allod, relief = 'flat', sx = 6, sy = 6, open = true } = opts;
  const file = String(opts.file || '').toLowerCase();
  const byId = new Map(world.blocks.map(b => [b.id, b]));
  const tplBlock = byId.get(opts.tpl);
  if (!/^[a-z0-9_]+$/i.test(id || '') || !/^[a-z0-9_]+$/.test(file)) throw new Error('Используйте только латиницу, цифры и _');
  if (byId.has(id)) throw new Error('Зона с таким идентификатором уже есть');
  if (!tplBlock || !directive(tplBlock.text, 'res')) throw new Error('Зона-образец не найдена или у неё нет #res: ' + opts.tpl);
  if (!ISLAND[allod]) throw new Error('Остров: ' + Object.keys(ISLAND).join(', '));
  if (!(sx >= 2 && sx <= 16 && sy >= 2 && sy <= 16)) throw new Error('Размер — от 2 до 16 секторов');
  const link = opts.link ? byId.get(opts.link) : null;
  if (opts.link && !link) throw new Error('Нет зоны для перехода: ' + opts.link);
  if (await io.file(`Maps/${file}.mpr`).then(() => true, () => false) || await io.file(`Maps/${file}.mob`).then(() => true, () => false)) throw new Error('Файлы с таким именем уже есть в Maps');
  const [tplMpr, tplMob] = directive(tplBlock.text, 'res').split(/\s+/);

  // landscape
  const src = readMpr(await io.file(`Maps/${tplMpr}.mpr`));
  let map;
  if (relief === 'copy') { map = src; map.name = file; for (let i = 0; i < map.sx * map.sy; i++) map.dirty.add(i); }
  else { map = newMpr(file, sx, sy, { textures: src.textures, maxZ: src.maxZ }); map.materials = src.materials; map.tileTypes = src.tileTypes; map.animTiles = src.animTiles; }
  await io.saveFile(`Maps/${file}.mpr`, writeMpr(map));
  // textures: terrain atlases + minimap + objectives map
  const texList = await io.resList('Res/textures.res');
  const has = n => texList.find(t => t.name.toLowerCase() === n.toLowerCase());
  const put = [];
  for (let i = 0; i < src.textures; i++) { const n = `${tplMpr}${String(i).padStart(3, '0')}.mmp`; if (has(n)) put.push({ name: `${file}${String(i).padStart(3, '0')}.mmp`, data: await io.resEntry('Res/textures.res', n) }); }
  const [miniTpl, questTpl] = (tplBlock.text.match(/^#maps\s*\r?\n[^\r\n]*\r?\n\s*(\S+)\s+(\S+)/m) || []).slice(1);
  if (miniTpl && has(miniTpl + '.mmp')) put.push({ name: `${file}map.mmp`, data: await io.resEntry('Res/textures.res', miniTpl + '.mmp') });
  if (questTpl && has(questTpl + '.mmp')) put.push({ name: `${file}quest.mmp`, data: await io.resEntry('Res/textures.res', questTpl + '.mmp') });
  await io.resUpdate('Res/textures.res', put);
  // objects: template mob without its objects, with a minimal script
  const mob = readMob(await io.file(`Maps/${tplMob}.mob`));
  const rootChunk = mob.chunks.find(c => c.id === 0xa000);
  // AI path graph: a copied relief keeps the template's graph, rebuilt where its objects stood;
  // a new flat landscape gets a graph built from scratch.
  const tplGraph = mob.chunks.find(c => c.id === AIGRAPH_ID);
  let graph;
  if (relief === 'copy' && tplGraph) {
    const base = readAiGraph(tplGraph.data), marked = new Set();
    for (const o of listObjects(mob).filter(o => o.kind !== 0xbbbb0000)) {
      const data = await io.loadModelData(getField(o.node, OBJ.model) || ''), box = data && modelBox(data), p = getField(o.node, OBJ.pos);
      const r = box ? Math.hypot(box.hx, box.hy) + Math.hypot(box.cx, box.cy) + 2 : 3;
      for (let y = Math.floor((p[1] - r) / 4); y <= Math.floor((p[1] + r) / 4); y++) for (let x = Math.floor((p[0] - r) / 4); x <= Math.floor((p[0] + r) / 4); x++) marked.add(y * base.W + x);
    }
    graph = buildAiGraph(map, [], { base, dirty: (x, y) => marked.has(y * base.W + x) });
  } else graph = buildAiGraph(map, []);
  const objs = rootChunk.children.find(c => c.id === 0xb000); if (objs) objs.children = [];
  rootChunk.children = rootChunk.children.filter(c => c.id !== 0x1e00 && c.id !== 0xe000); // editor metadata of the old map
  mob.chunks = [...mob.chunks.filter(c => c.id !== AIGRAPH_ID), { id: AIGRAPH_ID, data: writeAiGraph(graph) }];
  // the zone marks itself visited and keeps the way back open
  setScript(mob, addTrigger(`GlobalVars (\r\n  NULL : object\r\n)\r\n\r\nWorldScript\r\n(\r\n  Sleep( 1 ) \r\n)\r\n`, 'VTriger#0#9000',
    [`GSSetVarMax( 0, "z.${id}", 2 )`, ...link ? [`GSSetVar( 0, "z.${link.id}_${id}", 0 )`] : []]));
  await io.saveFile(`Maps/${file}.mob`, writeMob(mob));
  // world graph
  const cx = (map.W - 1) / 2, cy = (map.H - 1) / 2;
  const tplPos = directive(tplBlock.text, 'position') || '0 0 0';
  let block = `################################################\r\n\r\n## ${title}\r\n#zone ${id} ${allod} game\r\n#res\r\n${file} ${file}\r\n#maps\r\n${map.sx} ${map.sy}\r\n${file}map ${file}quest\r\n#position\r\n${tplPos.split(/\s+/).map((v, i) => (+v + (i < 2 ? 0.08 : 0)).toFixed(3)).join(' ')}\r\n\r\n`;
  if (link) {
    const edge = `${link.id}_${id}`, n = Math.max(0, ...exitsOf(link.text).map(x => x.n)) + 1;
    block += `## from ${link.id}\r\n#exit 1\r\n${edge} 2\r\n#deploy\r\n${cx - 5} ${cy - 5} ${cx + 5} ${cy + 5}\r\n#view\r\n0\r\n\r\n`;
    link.text = link.text.replace(/\s*$/, '') + `\r\n\r\n## to ${id}\r\n#exit ${n}\r\n${edge} 1\r\n#deploy\r\n10 10 20 20\r\n#view\r\n0\r\n\r\n`;
    world.blocks.push({ id, allod, type: 'game', text: block });
    world.blocks.push({ id: edge, allod, type: 'edge', text: `################################################\r\n\r\n#zone ${edge} ${allod} edge\r\n#position\r\n${tplPos}\r\n\r\n#exit 1\r\n${link.id} ${n}\r\n\r\n#exit 2\r\n${id} 1\r\n\r\n` });
    if (open) {
      const [, linkMob] = directive(link.text, 'res').split(/\s+/);
      const lm = readMob(await io.file(`Maps/${linkMob}.mob`));
      const s = getScript(lm) || '';
      // edge z.a_b: the exit works unless it is exactly 1 (game.exe 0x636f10: 0 or unset = open, 1 = closed);
      // zone z.x is 1 available, 2 visited
      setScript(lm, addTrigger(s, `VTriger#0#${id}`, [`GSSetVarMax( 0, "z.${id}", 1 )`, `GSSetVar( 0, "z.${edge}", 0 )`]));
      await io.saveFile(`Maps/${linkMob}.mob`, writeMob(lm));
    }
  } else world.blocks.push({ id, allod, type: 'game', text: block });
  await saveWorld(io, world);
  return { id, file, mpr: `Maps/${file}.mpr`, mob: `Maps/${file}.mob`, sx: map.sx, sy: map.sy };
}
