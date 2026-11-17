// Phase H: texts, acks, quests.qdb, base NPCs, ferry, zone scripts (gz2mg, gz3mg, bz1mg)
import { call } from './ei.mjs';
import * as G from './geo.mjs';
import { QUESTS, SAYS, PERS, UNITS, QITEMS, BRIEFINGS, QDB } from './story.mjs';
import fs from 'node:fs';
const { cp1251 } = await import('file:///C:/GOG%20Games/EI_edit/Editor/src/formats/bytes.js');
const log = (...a) => console.log(...a.map(x => typeof x === 'string' ? x : JSON.stringify(x).slice(0, 220)));
const only = process.argv[2];
const ids = JSON.parse(fs.readFileSync('unit_ids.json', 'utf8'));
const uid = n => ids['gz2mg:' + n] ?? ids['gz3mg:' + n] ?? (() => { throw new Error('no unit ' + n); })();
async function objId(mob, name) { const r = await call('map_objects', { mob, query: name, limit: 50 }); const o = r.objects.find(x => x.name === name); if (!o) throw new Error(`no object ${name} in ${mob}`); return o; }

// ---------- texts ----------
if (!only || only === 'texts') {
  const entries = [];
  for (const [k, q] of Object.entries(QUESTS)) entries.push({ name: 'quest ' + k, text: q.text });
  for (const [k, [, t]] of Object.entries(BRIEFINGS)) entries.push({ name: 'briefing ' + k, text: t });
  for (const [k, t] of Object.entries(PERS)) entries.push({ name: 'pers ' + k, text: t });
  for (const [k, t] of Object.entries(UNITS)) entries.push({ name: 'UNIT ' + k, text: t + '\n' });
  for (const [k, t] of Object.entries(QITEMS)) entries.push({ name: 'QUESTITEM ' + k, text: t + '\n' });
  for (const [k, [, t]] of Object.entries(SAYS)) { if (cp1251.encode(t).length > 126) throw new Error('say too long ' + k); entries.push({ name: 'say ' + k, text: t }); }
  log(await call('texts_set', { entries }));
}
// ---------- acks: speech bubbles ----------
if (!only || only === 'acks') {
  const seg = (tag, bytes) => [tag, bytes.length * 2, ...bytes];
  const str = s => [...cp1251.encode(s), 0];
  const phrase = (id, text) => { const b = [...seg(1, str('Acks\\Headman\\Scenario\\1.wav')), ...seg(2, [100, 0, 0, 0]), ...seg(3, str(text)), ...seg(4, str(id))]; return cp1251.decode(Uint8Array.from(b.slice(0, -1))); };
  const protoOf = { Olgerd: 'Human Gipath NPC Warlord F5', LizardElder: 'DragonkinJunF11', Prisoner: 'Human Gipath Villager F1' };
  const bySpeaker = {}; for (const [id, [who, t]] of Object.entries(SAYS)) (bySpeaker[who] ||= []).push([id, t]);
  const have = (await call('db_records', { file: 'acks.db', table: 1, limit: 500 })).records.map(r => r[1]);
  for (const [who, list] of Object.entries(bySpeaker)) for (const rec of [who, protoOf[who]]) {
    if (!have.includes(rec)) log(await call('db_record_add', { file: 'acks.db', table: 1, from: 'Fisher', name: rec }));
    const cur = await call('db_record_get', { file: 'acks.db', table: 1, record: rec });
    const n = cur.fields.find(f => f.name === 'Scenario').sub.length;
    const fields = {}; list.forEach(([id, t], k) => { fields['Scenario.field1#' + Math.min(k, Math.max(n, k))] = phrase(id, t); });
    // write one by one so that appending (#n == count) works
    for (const [k, v] of Object.entries(fields)) log(await call('db_record_set', { file: 'acks.db', table: 1, record: rec, fields: { [k]: v } }));
  }
}
// ---------- quests.qdb ----------
const hexList = names => names.map(n => { const b = cp1251.encode(n); return [1, (b.length + 1) * 2, ...b, 0]; }).flat().map(x => x.toString(16).padStart(2, '0')).join(' ');
const strList = names => cp1251.decode(Uint8Array.from(names.map(n => { const b = cp1251.encode(n); return [1, (b.length + 1) * 2, ...b, 0]; }).flat().slice(0, -1)));
async function setList(table, rec, field, names) {
  const r = await call('db_record_get', { file: 'quests.qdb', table, record: rec }); const f = r.fields.find(x => x.name === field);
  if (!names.length && !f.text) return;
  return call('db_record_set', { file: 'quests.qdb', table, record: rec, fields: { [field]: f.type === 'Hex' ? hexList(names) : strList(names) } });
}
if (!only || only === 'qdb') {
  const t1 = (await call('db_records', { file: 'quests.qdb', table: 1, limit: 500 })).records.map(r => r[1]);
  let rn = 120;
  for (const [k, q] of Object.entries(QUESTS)) {
    if (!t1.includes(k)) await call('db_record_add', { file: 'quests.qdb', table: 1, from: 'qgz1mg1', name: k });
    log(await call('db_record_set', { file: 'quests.qdb', table: 1, record: k, fields: { Experience: String(q.exp), Money: String(q.money), Comment: q.title, 'Record Number': String(rn++) } }));
  }
  const t2 = (await call('db_records', { file: 'quests.qdb', table: 2, limit: 500 })).records.map(r => r[1]);
  for (const [k, d] of Object.entries(QDB)) {
    if (!t2.includes(k)) await call('db_record_add', { file: 'quests.qdb', table: 2, from: 'og0', name: k });
    await call('db_record_set', { file: 'quests.qdb', table: 2, record: k, fields: { Money: String(d.money || 0) } });
    await setList(2, k, 'Give Quests 1', d.g1 || []); await setList(2, k, 'Give Quests 2', d.g2 || []); await setList(2, k, 'Take Items', d.take || []);
    const r = await call('db_record_get', { file: 'quests.qdb', table: 2, record: k });
    log(k, r.fields.filter(f => /Give Quests|Take|Money/.test(f.name)).map(f => f.name + '=' + JSON.stringify(f.text)).join(' '));
  }
}
// ---------- base NPCs in Огнёвка ----------
if (!only || only === 'base') {
  const units = await call('map_objects', { mob: 'bz1mg', kind: 'unit', limit: 100 });
  const add = [['Bram', 'Human Gipath NPC Warlord F5', [58.5, 49.5], 10, { weapons: ['long sword.iron'], armors: ['gipat highest helm.thick', 'gipat highest leggins.thick', 'gipat brigand shirt.tiger hide', 'gipat brigand gloves.tiger hide'] }],
    ['Rovena', 'Human Gipath NPC Witch M1', [44.5, 63.5], 270, {}], ['Goran', 'Human Gipath NPC Master F1', [76.5, 67], 100, {}]];
  for (const [name, unit, pos, yaw, extra] of add) if (!units.objects.some(o => o.name === name)) log(await call('map_object_add', { mob: 'bz1mg', unit, fields: { name, pos, yaw, briefing: 1, player: 2, ...extra } }));
  const gg = units.objects.find(o => o.name === 'GateGuard'); if (gg && gg.id < 1e9) log(await call('map_object_set', { mob: 'bz1mg', id: gg.id, fields: { briefing: 1 } }));
  for (const o of (await call('map_objects', { mob: 'bz1mg', kind: 'unit', limit: 100 })).objects) { const g = await call('map_object_get', { mob: 'bz1mg', id: o.id }); if ((g.patrols?.[0]?.points || []).length === 0 && /Bram|Rovena|Goran/.test(o.name)) await call('map_patrol_set', { mob: 'bz1mg', id: o.id, points: [{ pos: o.pos.slice(0, 2), wait: 3600 }] }); }
  let s = await call('map_script_get', { mob: 'bz1mg' });
  if (!s.includes('VTriger#0#9300')) {
    s = s.replace('DeclareScript #OnBriefingComplete', 'DeclareScript VTriger#0#9300 (  this : object )\nDeclareScript #OnBriefingComplete')
      .replace('\nScript #OnBriefingComplete', `\nScript VTriger#0#9300\n(\n  if\n  (\n  )\n  then\n  (\n    KillScript(  ) \n${['bram.c1', 'rovena.h1', 'woodcutter.tw1', 'goran.s1', 'headman.hf1', 'gateguard.gg1'].map(v => `    GSSetVarMax( 0, "b.${v}", 1 ) `).join('\n')}\n  )\n)\n\nScript #OnBriefingComplete`)
      .replace(/(WorldScript\s*\(\s*Sleep\( 2 \)\s*)/, '$1\n  VTriger#0#9300( NULL ) ');
    log(await call('map_script_set', { mob: 'bz1mg', script: s }));
  }
}
// ---------- ferry rafts (lizards' crossing at the southern backwater) ----------
const tF = (() => { let b = 0, d = 1e9; for (let t = 0; t <= 1; t += 0.002) { const p = G.polyAt(G.RIVER, t); if (Math.abs(p[1] - 66) < d) { d = Math.abs(p[1] - 66); b = t; } } return b; })();
function sideP(t, d, s) { const [x, y, a] = G.polyAt(G.RIVER, t); let nx = Math.sin(a), ny = -Math.cos(a); if (G.riverSide(x + nx * 3, y + ny * 3) !== s) { nx = -nx; ny = -ny; } return [+(x + nx * d).toFixed(1), +(y + ny * d).toFixed(1), Math.atan2(ny, nx) * 180 / Math.PI]; }
const WR = sideP(tF, 8.6, -1), ER = sideP(tF, 8.6, 1), WA = sideP(tF, 14, -1), EA = sideP(tF, 14, 1);
if (!only || only === 'ferry') {
  const have = await call('map_objects', { mob: 'gz2mg', query: 'RaftW', limit: 5 });
  if (!have.total) {
    const it = [];
    for (const [r, tag] of [[WR, 'W'], [ER, 'E']]) { for (let k = -1.5; k <= 1.5; k += 1) it.push({ object: 'Log01', fields: { pos: [r[0] + k * Math.cos((r[2] + 90) * Math.PI / 180), r[1] + k * Math.sin((r[2] + 90) * Math.PI / 180)], yaw: r[2], name: k === -1.5 ? 'Raft' + tag : undefined } });
      it.push({ object: 'OrcBridge00', fields: { pos: [r[0], r[1]], yaw: r[2] + 90 } }); it.push({ object: 'Palka+Cherep', fields: { pos: [r[0] + (tag === 'W' ? -4 : 4), r[1] + 2], yaw: 0 } }); }
    for (const x of it) if (!x.fields.name) delete x.fields.name;
    log(await call('map_object_add', { mob: 'gz2mg', items: it }));
    const fm = await call('map_objects', { mob: 'gz2mg', kind: 'unit', query: 'Ferryman' }); if (!fm.total) {
    const f = await call('map_object_add', { mob: 'gz2mg', unit: 'DragonkinGreenF3', fields: { name: 'Ferryman', pos: [WA[0], WA[1]], yaw: 0, player: 2 } }); log(f);
    await call('map_patrol_set', { mob: 'gz2mg', id: f.id ?? f.ids?.[0], points: [{ pos: [WA[0], WA[1]], wait: 300 }, { pos: [WR[0] - 2, WR[1] + 2], wait: 120 }] }); }
  }
  log('ferry', WR, ER, WA, EA);
}
// ---------- zone scripts ----------
const S = { decl: [], scripts: [], world: [], globals: new Set(['NULL : object', 'i : object', 'VSS#i#val : object', 'Heroes : group']) };
let N = 9300;
function trig(conds, acts, name = `VCheck#0#${N++}`, param = 'this') { S.decl.push(`DeclareScript ${name} (  this : object )`); S.scripts.push(`Script ${name}\n(\n  if\n  (\n${conds.map(c => '    ' + c + ' ').join('\n')}\n  )\n  then\n  (\n    KillScript(  ) \n${acts.map(a => '    ' + a + ' ').join('\n')}\n  )\n)\n`); return name; }
const once = (conds, acts) => { const n = trig(conds, acts); S.world.push(`${n}( NULL )`); return n; };
// repeating: check -> do -> sleep -> check
function loop(conds, acts, sleep, perHero = false) { const c = `VCheck#0#${N++}`, d = `VTriger#0#${N++}`; trig(conds, [`${d}( this )`], c); trig([], [...acts, `Sleep( ${sleep} )`, `${c}( this )`], d); if (perHero) S.world.push(`For( VSS#i#val, Heroes ) \n  (\n    ${c}( VSS#i#val ) \n  )`); else S.world.push(`${c}( NULL )`); }
const V = v => `GSGetVar( 0, "${v}" )`, eq = (v, n) => `IsEqual( ${V(v)} , ${n} )`, set = (v, n) => `GSSetVarMax( 0, "${v}", ${n} )`, Q = (n, s) => `q.gz2mg.qgz2mg${n}${s ? '.' + s : ''}`;
const near = (x, y, r) => `Any( i, Heroes, IsLess( DistanceUnitPoint( i, ${x}, ${y} ) , ${r} )  )`;
const nearU = (u, r) => `Any( i, Heroes, IsLess( DistanceUnitUnit( i, ${u} ) , ${r} )  )`;
const say = (id) => `SendStringEvent( 0, "say ${id} ${SAYS[id][0]}" )`;
const obj = (name, id) => { S.globals.add(`${name} : object`); S.world.unshift(`${name} = GetObjectByID( "${id}" )`); };
const done = (n, sub) => [set(Q(n, sub), 2)];
function buildScript(header) {
  const g = [...S.globals];
  return `GlobalVars (\n  ${g.join(',\n  ')}\n)\n\n${S.decl.join('\n')}\nDeclareScript #OnBriefingComplete (  nPlayer : float,  szComplete : string )\n\n${S.scripts.join('\n')}\nScript #OnBriefingComplete\n(\n  if\n  (\n  )\n  then\n  (\n    KillScript(  ) \n  )\n)\n\nWorldScript\n(\n  Sleep( 2 ) \n${S.world.map(w => '  ' + w + ' ').join('\n')}\n)\n`;
}
const reset = () => { S.decl = []; S.scripts = []; S.world = []; S.globals = new Set(['NULL : object', 'i : object', 'VSS#i#val : object', 'Heroes : group']); };
// --- shared quest checkers (both game zones) ---
function sharedCheckers() {
  once([eq(Q(2, 2), 1), eq('gz2mg.queen', 1)], [...done(2, 2), set(Q(2, 3), 1)]);
  once([eq(Q(7, 1), 1), eq('gz3mg.trolls', 1)], [...done(7, 1), set(Q(7, 2), 1), 'GiveQuestItem( 0, "TrollFang" )', 'QuestComplete( 0, "qgz2mg7" )', set('b.woodcutter.tw2', 1)]);
}
if (!only || only === 'script') {
  // ===== gz2mg =====
  reset();
  for (const n of ['Olgerd', 'LizardElder', 'Prisoner', 'HerbGhost', 'FireLizard', 'Warchief', 'OrcShaman', 'GraveKeeper', 'Zart', 'FireEl1', 'FireEl2', 'FireEl3', 'FireEl4', 'MEl1', 'MEl2', 'HArcher1', 'HArcher2', 'HArcher3', 'HArcher4', 'HArcher5', 'HArcher6', 'LizardWarrior1', 'LizardWarrior2', 'LizardWarrior3', 'LizardWarrior4', 'OArcher1', 'OArcher2', 'OArcher3', 'OArcher4', 'OArcher5', 'OArcher6', 'OArcher7', 'Range1', 'Range2', 'Range3', 'Range4', 'Spar1', 'Spar2', 'Spar3', 'Spar4', 'Drummer', 'Wounded1', 'Wounded2']) obj(n, uid(n));
  for (const n of ['PrisonCage', 'CageLever', 'MithrilChest']) obj(n, (await objId('gz2mg', n)).id);
  const cr = []; for (const n of ['Crystal1', 'Crystal2', 'Crystal3', 'Crystal4', 'ZartCrystalL']) { const o = await objId('gz2mg', n); cr.push([o.pos[0], o.pos[1], +(G.height(o.pos[0], o.pos[1]) + 3).toFixed(2)]); }
  // zone entry: open edges, make the Огнёвка briefings available (old saves get them from here)
  once([], [set('z.gz2mg', 2), 'GSSetVar( 0, "z.gz1mg_gz2mg", 0 )', set('z.gz3mg', 1), 'GSSetVar( 0, "z.gz2mg_gz3mg", 0 )', 'GSSetVar( 0, "z.gz2mg_gz3mg_exit", 0 )', ...['bram.c1', 'rovena.h1', 'woodcutter.tw1', 'goran.s1', 'headman.hf1', 'gateguard.gg1'].map(v => set('b.' + v, 1)), 'PlayMusic( 0, "Nature" )']);
  // Q1: meet Olgerd
  once([eq(Q(1), 1), nearU('Olgerd', 7)], [say('gz2mg1'), 'GiveQuestItem( 0, "OlgerdLetter" )', ...done(1, 1), set(Q(1, 2), 1), 'QuestComplete( 0, "qgz2mg1" )', set('b.bram.c2', 1)]);
  // Q2: lizard elder -> queen (cave) -> east bank
  once([eq(Q(2), 1), nearU('LizardElder', 6)], [say('gz2mg2'), ...done(2, 1), set(Q(2, 2), 1)]);
  once([eq(Q(2, 3), 1), near(294, 40, 26)], [...done(2, 3), set(Q(2), 2), 'QuestComplete( 0, "qgz2mg2" )', set('b.bram.c3', 1)]);
  sharedCheckers();
  // Q3: cemetery arch -> keeper; reaching the arch also proves the crossing -> the lizards' ferry works
  once([near(291, 121, 9)], [set('gz2mg.ferry', 1)]);
  once([eq(Q(3, 1), 1), near(291, 124, 10)], [...done(3, 1), set(Q(3, 2), 1)]);
  once(['IsDead( GraveKeeper )'], [set('gz2mg.keeper', 1)]);
  once([eq(Q(3, 2), 1), eq('gz2mg.keeper', 1)], [...done(3, 2), set(Q(3), 2), 'QuestComplete( 0, "qgz2mg3" )', set('b.bram.c4', 1), set('gz2mg.ferry', 1)]);
  once([eq('gz2mg.ferry', 1), nearU('LizardElder', 7)], [say('gz2mg3')]);
  // ferry both ways while standing on a raft
  loop([eq('gz2mg.ferry', 1), near(WR[0], WR[1], 2.4)], ['For( VSS#i#val, Heroes ) \n    (\n      SetCP( VSS#i#val, Add( ' + (EA[0] - 1) + ', Random( 3 )  ) , Add( ' + (EA[1] - 1) + ', Random( 3 )  ) , 0 ) \n    )'], 40);
  loop([eq('gz2mg.ferry', 1), near(ER[0], ER[1], 2.4)], ['For( VSS#i#val, Heroes ) \n    (\n      SetCP( VSS#i#val, Add( ' + (WA[0] - 1) + ', Random( 3 )  ) , Add( ' + (WA[1] - 1) + ', Random( 3 )  ) , 0 ) \n    )'], 40);
  // Q4: warchief + shaman (amulet)
  once(['IsDead( Warchief )'], [set('gz2mg.chief', 1)]);
  once(['IsDead( OrcShaman )'], [set('gz2mg.shaman', 1)]);
  once([eq(Q(4, 1), 1), eq('gz2mg.chief', 1)], done(4, 1));
  once([eq(Q(4, 2), 1), eq('gz2mg.shaman', 1)], [...done(4, 2), 'GiveQuestItem( 0, "FireAmulet" )']);
  once([eq(Q(4, 1), 2), eq(Q(4, 2), 2)], [set(Q(4, 3), 1), 'QuestComplete( 0, "qgz2mg4" )', set('b.bram.c5', 1)]);
  // Q5: summit -> Zart; his death puts out every fire spirit he summoned
  once([eq(Q(5, 1), 1), near(G.SUMMIT.x, G.SUMMIT.y, 15)], [...done(5, 1), set(Q(5, 2), 1)]);
  once(['IsDead( Zart )'], [set('gz2mg.zart', 1), ...['FireEl1', 'FireEl2', 'FireEl3', 'FireEl4', 'MEl1', 'MEl2'].flatMap((e, k) => [`CreateParticleSource( ${20001 + k}, GetX( ${e} ) , GetY( ${e} ) , GetZ( ${e} ) , 0.8, "Fireblast" ) `, `InflictDamage( ${e}, 3000 ) `]), 'Sleep( 40 ) ', ...[0, 1, 2, 3, 4, 5].map(k => `DeleteParticleSource( ${20001 + k} ) `)]);
  once([eq(Q(5, 1), 1), eq('gz2mg.zart', 1)], [...done(5, 1), set(Q(5, 2), 1)]);
  once([eq(Q(5, 2), 1), eq('gz2mg.zart', 1)], [...done(5, 2), set(Q(5, 3), 1), 'GiveQuestItem( 0, "ZartJournal" )', 'QuestComplete( 0, "qgz2mg5" )', set('b.bram.c6', 1)]);
  once([eq('gz2mg.zart', 1), nearU('Olgerd', 7)], [say('gz2mg5')]);
  // S1 witch ring
  once([eq(Q(6, 1), 1), near(G.RING.x, G.RING.y, 13)], [...done(6, 1), set(Q(6, 2), 1)]);
  once(['IsDead( HerbGhost )'], [set('gz2mg.ghost', 1)]);
  once([eq(Q(6, 1), 1), eq('gz2mg.ghost', 1)], [...done(6, 1), set(Q(6, 2), 1)]);
  once([eq(Q(6, 2), 1), eq('gz2mg.ghost', 1)], [...done(6, 2), set(Q(6, 3), 1), 'GiveQuestItem( 0, "HerbBag" )', 'QuestComplete( 0, "qgz2mg6" )', set('b.rovena.h2', 1)]);
  // S3 mithril chest (the metal is always the finder's)
  once(['IsEqual( GetLeverState( MithrilChest ) , 1 )'], ['GiveItem( 0, "material.mithrill" )', 'GiveItem( 0, "material.mithrill" )', set('gz2mg.mithril', 1)]);
  once([eq(Q(8, 1), 1), eq('gz2mg.mithril', 1)], [...done(8, 1), set(Q(8, 2), 1), 'QuestComplete( 0, "qgz2mg8" )', set('b.goran.s2', 1)]);
  // S4 fire lizard
  once(['IsDead( FireLizard )'], [set('gz2mg.firelizard', 1)]);
  once([eq(Q(9, 1), 1), eq('gz2mg.firelizard', 1)], [...done(9, 1), set(Q(9, 2), 1), 'GiveQuestItem( 0, "FireScale" )', 'QuestComplete( 0, "qgz2mg9" )', set('b.headman.hf2', 1)]);
  // S5 prisoner: the lever opens the cage, Ян runs to the lizards' raft and is gone
  once(['IsEqual( GetLeverState( CageLever ) , 1 )', 'IsAlive( Prisoner )'], ['SwitchLeverState( PrisonCage, 1 )', 'Sleep( 10 )', say('gz2mg4'), 'Sleep( 30 )', 'Run( Prisoner )', `MoveToPoint( Prisoner, ${ER[0]}, ${ER[1] + 3} )`, set('gz2mg.freed', 1), 'Sleep( 400 )', 'RemoveUnitFromServer( Prisoner )']);
  once([eq(Q(10, 1), 1), eq('gz2mg.freed', 1)], [...done(10, 1), set(Q(10, 2), 1), 'QuestComplete( 0, "qgz2mg10" )', set('b.gateguard.gg2', 1)]);
  // ---- the river battle: fire from the spirits, arrows and acid from the west bank ----
  const WT = [], ET = []; for (const y of [196, 188, 180, 172, 164]) { let b = 0, d = 1e9; for (let t = 0; t <= 1; t += 0.002) { const p = G.polyAt(G.RIVER, t); if (Math.abs(p[1] - y) < d) { d = Math.abs(p[1] - y); b = t; } } WT.push(sideP(b, 9.8, -1)); ET.push(sideP(b, 10, 1)); }
  // fire spirits throw fireball{e0;e0}: two Cut Effect runes take its 7 to 0 (both games build it) — the west bank must hold, not die
  ['FireEl1', 'FireEl2', 'FireEl3', 'FireEl4'].forEach((e, k) => { const t = WT[(k + 1) % WT.length]; loop([`IsAlive( ${e} )`, `Not( ${eq('gz2mg.zart', 1)} )`], [`CastSpellPoint( "fireball{e0;e0}", GetX( ${e} ) , GetY( ${e} ) , Add( ${(t[0] - 2).toFixed(1)}, Random( 4 )  ) , Add( ${(t[1] - 2).toFixed(1)}, Random( 4 )  )  )`], 70 + k * 17); });
  [['HArcher2', 'arrow'], ['HArcher4', 'arrow'], ['LizardWarrior3', 'acid_ray']].forEach(([u, sp], k) => { const t = ET[(k * 2) % ET.length]; loop([`IsAlive( ${u} )`], [`CastSpellPoint( "${sp}", GetX( ${u} ) , GetY( ${u} ) , Add( ${(t[0] - 2).toFixed(1)}, Random( 4 )  ) , Add( ${(t[1] - 2).toFixed(1)}, Random( 4 )  )  )`], 55 + k * 20); });
  // aimed shots across the river: a visible missile at the target and real damage; when it falls the shooter takes the next one
  const lanes = [['FireEl1', ['HArcher1', 'HArcher6'], 'fireball{e0;e0}', 0, 560], ['FireEl2', ['HArcher3', 'LizardWarrior1'], 'fireball{e0;e0}', 0, 640], ['FireEl3', ['LizardWarrior2', 'LizardWarrior4'], 'fireball{e0;e0}', 0, 600], ['FireEl4', ['HArcher5', 'HArcher4'], 'fireball{e0;e0}', 0, 720],
    ['HArcher2', ['OArcher2', 'OArcher5'], 'arrow', 20, 380], ['HArcher4', ['OArcher4', 'OArcher7'], 'arrow', 20, 430], ['HArcher6', ['OArcher3', 'OArcher1'], 'arrow', 20, 470], ['LizardWarrior3', ['OArcher6', 'FireEl3'], 'acid_ray', 22, 520]];
  for (const [src, targets, sp, dmg, every] of lanes) targets.forEach((dst, k) => {
    const before = targets.slice(0, k).map(t => `IsDead( ${t} )`);
    loop([`IsAlive( ${src} )`, `IsAlive( ${dst} )`, ...before, `Not( ${eq('gz2mg.zart', 1)} )`], [`Sleep( Add( ${every}, Random( 240 )  ) )`, `CastSpellUnit( "${sp}", GetX( ${src} ) , GetY( ${src} ) , ${dst} )`, ...(dmg ? ['Sleep( 12 )', `InflictDamage( ${dst}, ${dmg} )`] : [])], 10);
  });
  // ---- camp life: archery practice, sparring, the war drum; stops when heroes come close ----
  const calm = u => `Not( ${nearU(u, 22)} )`;
  ['Range1', 'Range2', 'Range3', 'Range4'].forEach((u, k) => loop([`IsAlive( ${u} )`, calm(u)], [`PlayAnimation( ${u}, "uattack02" )`], 50 + k * 6));
  for (const [a, b] of [['Spar1', 'Spar2'], ['Spar3', 'Spar4']]) loop([`IsAlive( ${a} )`, `IsAlive( ${b} )`, calm(a)], [`PlayAnimation( ${a}, "uattack04" )`, `PlayAnimation( ${b}, "uattack05" )`, 'Sleep( 24 )', `PlayAnimation( ${a}, "uattack05" )`, `PlayAnimation( ${b}, "uattack04" )`], 26);
  loop(['IsAlive( Drummer )', calm('Drummer')], ['PlayAnimation( Drummer, "uattack01" )'], 22);
  for (const w of ['Wounded1', 'Wounded2']) loop([`IsAlive( ${w} )`], [`PlayAnimation( ${w}, "crest" )`], 240);
  // ---- lightning crystals on the golem path and at the summit ----
  cr.forEach(([x, y, z], k) => loop([`IsLess( DistanceUnitPoint( this, ${x.toFixed(1)}, ${y.toFixed(1)} ) , ${k === 4 ? 9 : 7.5} )`, 'IsAlive( this )', ...(k === 4 ? ['IsAlive( Zart )'] : [])],
    [`CreateLightning( GetObjectID( this ) , ${x.toFixed(1)}, ${y.toFixed(1)}, ${z}, GetX( this ) , GetY( this ) , GetZ( this ) , 4 )`, `InflictDamage( this, ${k === 4 ? 30 : 22} )`, 'Sleep( 15 )', 'DeleteLightning( GetObjectID( this )  )'], 85 + k * 8, true));
  const s2 = buildScript(); fs.writeFileSync('gz2mg_script.txt', s2);
  log(await call('map_script_set', { mob: 'gz2mg', script: s2 }));
  // ===== gz3mg =====
  reset();
  for (const n of ['PanzerQueen', 'OldTroll', 'YoungTroll1', 'YoungTroll2']) obj(n, uid(n));
  obj('TrollChest', (await objId('gz3mg', 'TrollChest')).id);
  once([], [set('z.gz3mg', 2), 'GSSetVar( 0, "z.gz2mg_gz3mg", 0 )', 'GSSetVar( 0, "z.gz2mg_gz3mg_exit", 0 )', 'PlayMusic( 0, "Dungeon" )']);
  once(['IsDead( PanzerQueen )'], [set('gz2mg.queen', 1)]);
  once(['IsDead( OldTroll )', 'IsDead( YoungTroll1 )', 'IsDead( YoungTroll2 )'], [set('gz3mg.trolls', 1)]);
  once(['IsEqual( GetLeverState( TrollChest ) , 1 )'], ['GiveMoney( 0, 450 )']);
  sharedCheckers();
  const s3 = buildScript(); fs.writeFileSync('gz3mg_script.txt', s3);
  log(await call('map_script_set', { mob: 'gz3mg', script: s3 }));
}
