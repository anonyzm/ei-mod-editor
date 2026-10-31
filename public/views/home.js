import { api, h, guard } from '/app.js';

export async function mount(root) {
  const info = await api.info();
  const backups = await api.json('/api/backups');
  root.append(h('div.page',
    h('h1', 'Редактор модов «Проклятых Земель»'),
    h('p.lead', info.ok ? `Папка игры: ${info.gameDir}` : `⚠ Не найдена игра в ${info.gameDir}. Укажите путь в Editor/config.json: {"gameDir": "..."}`),
    h('div.cards',
      card('#map', 'Карты и ландшафт', '3D-карта зоны: двигайте, добавляйте и удаляйте существ, предметы, рычаги; меняйте маршруты патрулей, рельеф и текстуры земли, скрипт карты.'),
      card('#database', 'Предметы, существа, магия', 'Оружие, доспехи, одежда, материалы, зелья, монстры, НПС, заклинания, навыки. Дублируйте и создавайте новые.'),
      card('#quests', 'Квесты и диалоги', 'Тексты заданий, подзадачи, брифинги-диалоги с репликами персонажей, награды.'),
      card('#zones', 'Острова и зоны', 'Глобальная карта: зоны, переходы между ними, создание новой зоны или целого острова.'),
      card('#texts', 'Все тексты игры', 'Названия и описания всего в игре, поиск по тексту.'),
      card('#models', 'Модели и анимации', 'Просмотр моделей с текстурами, проигрывание анимаций, сборка частей.'),
      card('#textures', 'Текстуры', 'Просмотр, экспорт в PNG и замена текстур своими.'),
    ),
    h('h3', { style: { marginTop: '28px' } }, 'Безопасность'),
    h('p.muted', 'Перед первым изменением любого файла игры редактор сохраняет его оригинал в папку Editor/backup. ',
      backups.length ? `Сейчас изменено файлов: ${backups.length}.` : 'Пока ни один файл игры не изменён.'),
    backups.length ? h('ul.muted', backups.map(b => h('li', b))) : null,
    h('div', { style: { display: 'flex', gap: '8px' } },
      h('button.primary', { onclick: () => guard(() => api.json('/api/launch', { method: 'POST' }), 'Игра запускается…') }, '▶ Запустить игру'),
      backups.length ? h('button.danger', {
        onclick: async () => {
          if (!confirm('Вернуть ВСЕ изменённые файлы игры к оригиналу? Ваши правки будут потеряны.')) return;
          await guard(() => api.json('/api/restore', { method: 'POST' }), 'Оригинальные файлы восстановлены');
          location.reload();
        },
      }, '↺ Вернуть оригиналы') : null,
    ),
    h('h3', { style: { marginTop: '28px' } }, 'Как это устроено'),
    h('p.muted', 'Изменения сохраняются прямо в файлы игры — просто нажмите «Сохранить» и запустите игру. Для одиночной кампании используются файлы Res/database.res и Res/texts.res, для сетевой — databaselmp.res и textslmp.res.'),
  ));
}

const card = (href, title, text) => h('a.card', { href }, h('b', title), h('span', text));
