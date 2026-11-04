// 任務與成長：任務鏈、完成條件、獎勵、解鎖、繁榮度、略過沒開的模組、只加資料就接上主線。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices, validatePack } from '../src/core/index.js';
import quests from '../src/modules/quests/index.js';
import residents from '../src/modules/residents/index.js';
import gathering from '../src/modules/gathering/index.js';
import { readPackDir, readCatalog, readSchemas, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));

function boot({ enabled = ['quests', 'residents', 'gathering'], data = island, extra = [], shellModules = true } = {}) {
  const services = createCoreServices(data);
  let engine;
  if (shellModules) services.modules = { enabled: () => engine.enabledModules() };
  const e = engine = new Engine({ data, services, seed: 1 });
  e.register(quests).register(residents).register(gathering);
  for (const m of extra) e.register(m);
  e.start({ enabled: [...enabled, ...extra.map((m) => m.id)], cascade: true });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 16, y: 13 });
  services.inventory.add('player', 'axe', 1);
  const fb = [];
  e.events.on('quests:feedback', (x) => fb.push(x));
  e.update(0); // 第一個遊戲更新：任務開始判斷
  return { e, s: services, fb, api: e._apis.get('quests') };
}
const greet = (e, s, who = 'laoju') => { const r = s.entities.get(`resident.${who}`); s.entities.move('player', r.x + 1, r.y); return e.runCommand('residents.greet', { who }); };
const harvest = (e, s, ref, n = 0) => { const t = s.entities.all().filter((x) => x.ref === ref)[n]; s.entities.move('player', t.x + 1, t.y); return e.runCommand('gathering.harvest', { target: t.id }); };

test('世界包範例：任務資料通過檢查；一開始主線第一個任務自動接取', () => {
  const { api, fb } = boot();
  assert.equal(api.state('welcome'), 'active');
  assert.equal(api.state('first_harvest'), 'locked');
  assert.match(fb[0].text, /新任務：跟村長打招呼/);
});

test('任務鏈：完成條件 → 領獎（物品、繁榮度）→ 下一個任務自動開放；回饋事件依序發出', () => {
  const { e, s, api, fb } = boot();
  greet(e, s);
  assert.equal(api.state('welcome'), 'ready');
  assert.equal(fb.at(-1).kind, 'complete');
  assert.equal(e.runCommand('quests.claim', { id: 'welcome' }).ok, true);
  assert.equal(s.inventory.count('player', 'apple'), 2);
  assert.equal(api.levelInfo().points, 5);
  assert.equal(api.state('first_harvest'), 'active');
  assert.equal(api.state('meet_everyone'), 'active');
  assert.deepEqual(fb.map((x) => x.kind).slice(0, 4), ['progress', 'complete', 'success', 'progress']);
});

test('事件條件：match 比對欄位；居民做的不算；達到次數就完成', () => {
  const { e, s, api } = boot();
  greet(e, s); e.runCommand('quests.claim', { id: 'welcome' });
  // 居民採集不算
  e.events.emit('gathering:harvested', { actor: 'afu', species: 'berry_bush', items: [] });
  harvest(e, s, 'shell', 0); harvest(e, s, 'shell', 1);
  assert.equal(api.state('first_harvest'), 'active');
  harvest(e, s, 'boulder');
  assert.equal(api.state('first_harvest'), 'ready');
  e.runCommand('quests.claim', { id: 'first_harvest' });
  assert.equal(api.hasFlag('can_craft'), true, '解鎖旗標');
  assert.equal(api.state('collector'), 'active');
  assert.equal(api.state('collector') === 'active' && e.renderPanel('quests.list').some((n) => JSON.stringify(n).includes('撿貝殼')), true);
});

test('交東西的條件：背包夠才完成、領獎時交出去；不夠時按鈕說明原因', () => {
  const { e, s, api } = boot();
  greet(e, s); e.runCommand('quests.claim', { id: 'welcome' });
  for (let i = 0; i < 3; i++) harvest(e, s, 'shell', i);
  e.runCommand('quests.claim', { id: 'first_harvest' });
  assert.equal(api.state('wood_for_laoju'), 'active');
  s.inventory.add('player', 'wood', 6);
  assert.equal(api.state('wood_for_laoju'), 'ready');
  s.inventory.remove('player', 'wood', 1);
  assert.equal(api.state('wood_for_laoju'), 'active', '東西不夠了，回到進行中');
  assert.match(e.runCommand('quests.claim', { id: 'wood_for_laoju' }).reason, /還沒完成/);
  s.inventory.add('player', 'wood', 1);
  e.runCommand('quests.claim', { id: 'wood_for_laoju' });
  assert.equal(s.inventory.count('player', 'wood'), 0);
  assert.equal(s.inventory.count('player', 'plank'), 2);
  assert.equal(api.level(), 2, '繁榮度 25 → 升到 2 級');
  assert.equal(api.hasFlag('level2'), true, '升級時解鎖的旗標');
});

test('需要的模組沒開：任務被略過、不給獎勵，後面的任務照樣開放（主線不會卡住）；再開回來會重新開放', () => {
  const off = boot({ enabled: ['quests', 'residents'] });
  greet(off.e, off.s); off.e.runCommand('quests.claim', { id: 'welcome' });
  assert.equal(off.api.state('first_harvest'), 'skipped');
  assert.equal(off.api.hasFlag('can_craft'), false, '略過的任務不給獎勵');
  assert.equal(off.api.state('wood_for_laoju'), 'active', '主線繼續');
  const save = off.e.serializeAll();
  const on = boot();
  on.e.deserializeAll(save);
  assert.equal(on.api.state('first_harvest'), 'active', '採集開回來：任務重新開放');
});

test('接受式任務（auto: false）要按「接受」', () => {
  const data = { ...island, quests: { levels: [], quests: [{ id: 'ask', title: '要不要幫忙', auto: false, conditions: [{ type: 'flag', flag: 'x' }], rewards: { points: 1 } }] } };
  const { e, api } = boot({ data });
  assert.equal(api.state('ask'), 'available');
  assert.match(JSON.stringify(e.renderPanel('quests.list')), /接受任務：要不要幫忙/);
  e.runCommand('quests.accept', { id: 'ask' });
  assert.equal(api.state('ask'), 'active');
  api.setFlag('x');
  assert.equal(api.state('ask'), 'ready');
});

test('新玩法只加資料就接上主線：一個任務模組完全不認識的模組，靠事件名稱就能計數', () => {
  const fishing = { id: 'fishtest', version: '1', emits: ['fishtest:caught'], init(ctx) { ctx.registerCommand({ id: 'fishtest.cast', run: () => ctx.emit('fishtest:caught', { actor: 'player', fish: 'carp' }) }); } };
  const data = { ...island, quests: { levels: [], quests: [
    ...island.quests.quests,
    { id: 'fish_main', line: 'main', title: '第一條魚', requires: ['welcome'], conditions: [{ type: 'event', event: 'fishtest:caught', match: { fish: 'carp' }, count: 2 }], rewards: { points: 3 } },
  ] } };
  const { e, s, api } = boot({ data, extra: [fishing] });
  greet(e, s); e.runCommand('quests.claim', { id: 'welcome' });
  e.runCommand('fishtest.cast'); e.runCommand('fishtest.cast');
  assert.equal(api.state('fish_main'), 'ready');
});

test('存讀檔：進度、旗標、繁榮度都保留', () => {
  const a = boot();
  greet(a.e, a.s); a.e.runCommand('quests.claim', { id: 'welcome' });
  harvest(a.e, a.s, 'shell', 0);
  const b = boot();
  b.e.deserializeAll(a.e.serializeAll());
  assert.equal(b.api.levelInfo().points, 5);
  assert.match(JSON.stringify(b.e.renderPanel('quests.list')), /採集 3 次（1\/3）/);
});

test('資料檢查：循環依賴、事件名稱格式、不存在的物品都會被抓到', async () => {
  const catalog = await readCatalog(), schemas = await readSchemas();
  const bad = { ...island, quests: { levels: [{ level: 1, points: 0 }, { level: 2, points: 0 }], quests: [
    { id: 'a', title: 'A', requires: ['b'], conditions: [{ type: 'event', event: 'Bad Name' }] },
    { id: 'b', title: 'B', requires: ['a'], conditions: [{ type: 'have', item: 'gold', qty: 1 }] },
  ] } };
  const msgs = validatePack(bad, catalog, schemas).errors.map((x) => x.message).join('\n');
  assert.match(msgs, /循環依賴/);
  assert.match(msgs, /事件名稱「Bad Name」格式不對/);
  assert.match(msgs, /不存在的物品「gold」/);
  assert.match(msgs, /points 要比前一級大/);
});
