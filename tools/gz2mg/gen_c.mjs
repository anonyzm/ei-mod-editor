// Phase C: map.txt blocks (exits, deploy/remove), globe patches, zone titles
import { call } from './ei.mjs';
const set = (id, text) => call('zone_set', { id, text });
const ex = (n, to, dep, rem, view, note) => `## ${note}\n#exit ${n}\n${to}\n#deploy\n${dep}\n#remove\n${rem}\n#view\n${view}\n#passtime\n1\n\n`;

let g1 = await call('zone_get', { id: 'gz1mg' });
g1 = g1.replace(/## to gz2mg\r?\n#exit 3[\s\S]*$/, '') .replace(/\s*$/, '\n\n')
  + ex(3, 'gz1mg_gz2mg 1', '234 166 240 172', '248 170 256 182', 135, 'to gz2mg «Огненный рубеж»: the grassy slope in the north-east corner, above the lava lake');
console.log(await set('gz1mg', g1));

console.log(await set('gz2mg', `#zone gz2mg gipat game
#res
gz2mg gz2mg
#maps
10 8
gz2mgmap gz2mgquest
#position
0 0 0
#weather
none
#sky
normal

` + ex(1, 'gz1mg_gz2mg 2', '10 50 16 58', '0 47 4 61', 270, 'from Лавовое озеро: the forest road on the west edge')
  + ex(2, 'gz2mg_gz3mg 1', '107 70 117 75', '109.5 79 114.5 83.5', 180, 'to Панцирные норы: the old mine mouth (MineEntrance00) in the south foot of the western massif, facing the swamp')
  + ex(3, 'gz2mg_gz3mg_exit 1', '284 35 292 43', '299 38 303.5 44', 90, 'to Панцирные норы (east end): the mine mouth in the closed south-east pocket; the golem path starts here')
  + '################################################\n'));

console.log(await set('gz3mg', `#zone gz3mg gipat game
#res
gz3mg gz3mg
#maps
6 5
gz3mgmap gz3mgquest
#position
0 0 0
#weather
none
#sky
cave

` + ex(1, 'gz2mg_gz3mg 2', '10 108 16 116', '0 106 3 118', 270, 'west tunnel: back to the swamp side of Огненный рубеж (gz2mg exit 2)')
  + ex(2, 'gz2mg_gz3mg_exit 2', '170 25 177 32', '189 22 192 34', 90, 'east tunnel: out into the south-east pocket of Огненный рубеж (gz2mg exit 3)')
  + '################################################\n'));

console.log(await set('gz1mg_gz2mg', `#zone gz1mg_gz2mg gipat edge
## Лавовое озеро (NE corner) <-> Огненный рубеж (west edge)
#position
0 0 0

#exit 1
gz1mg 3

#exit 2
gz2mg 1

################################################
`));
console.log(await set('gz2mg_gz3mg', `#zone gz2mg_gz3mg gipat edge
## Огненный рубеж (massif mine mouth) <-> Панцирные норы (west tunnel)
#position
0 0 0

#exit 1
gz2mg 2

#exit 2
gz3mg 1

################################################
`));
console.log(await set('gz2mg_gz3mg_exit', `#zone gz2mg_gz3mg_exit gipat edge
## Огненный рубеж (south-east pocket) <-> Панцирные норы (east tunnel), like gz4g_gz10g_exit
#position
0 0 0

#exit 1
gz2mg 3

#exit 2
gz3mg 2

################################################
`));
console.log(await call('globe_zone', { zone: 'gz2mg', x: 2.05, y: 0.55, w: 1.1, h: 0.8 }));
console.log(await call('globe_zone', { zone: 'gz3mg', x: 2.15, y: -0.13, w: 0.7, h: 0.38 }));
console.log(await call('texts_set', { entries: [
  { name: 'zone gz2mg', text: 'Огненный рубеж\nДолину рассекает река. На западном берегу — лес и болото, где люди из Огнёвки и ящеры держат оборону. Восточный берег выжжен дотла: там стоят орки и огненные духи, а над всем этим, на северо-восточной горе, кто-то жжёт по ночам странные огни. Мост через реку разрушен.' },
  { name: 'zone gz3mg', text: 'Панцирные норы\nСтарая выработка первых поселенцев, давно занятая панцирниками. Говорят, по ней можно пройти под горой и под рекой на восточный берег. В дальнем зале обосновались тролли.' },
] }));
const z = await call('zones_list', { allod: 'gipat' });
console.log(z.filter(x => /mg/.test(x.id)).map(x => x.id + ' ' + x.exits.join(',')).join('\n'));
