// 製作：配方、工作台、解鎖（任務旗標）、要花時間的製作（材料做完才扣）、回饋事件、任務接上主線。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices } from '../src/core/index.js';
import crafting from '../src/modules/crafting/index.js';
import actions from '../src/modules/actions/index.js';
import quests from '../src/modules/quests/index.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));

function boot(enabled = ['crafting', 'actions', 'quests']) {
  const services = createCoreServices(island);
  let engine;
  services.modules = { enabled: () => engine.enabledModules() };
  const e = engine = new Engine({ data: island, services, seed: 1 });
  e.register(crafting).register(actions).register(quests);
  e.start({ enabled, cascade: true });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 16, y: 13 });
  const fb = [];
  e.events.on('crafting:feedback', (x) => fb.push(x));
  e.update(0);
  return { e, s: services, fb };
}
const bench = (s) => s.entities.byKind('station')[0];

test('工作台出現在地圖上、會擋路、有互動', () => {
  const { e, s } = boot();
  const b = bench(s);
  assert.deepEqual([b.ref, b.x, b.y, b.label], ['workbench', 15, 14, '工作台']);
  assert.equal(e.entityKind('station').solid, true);
  assert.equal(e.interactionsFor(b.id)[0].label, '用工作台做東西');
});

test('不用工作台的配方：材料夠就能做；要花時間；材料做完才扣，走開中斷不損失', () => {
  const { e, s, fb } = boot();
  assert.match(e.runCommand('crafting.make', { recipe: 'plank' }).reason, /材料不夠：還差木頭 2 個/);
  s.inventory.add('player', 'wood', 4);
  assert.deepEqual(e.runCommand('crafting.make', { recipe: 'plank' }).result, { started: true });
  assert.equal(s.inventory.count('player', 'wood'), 4, '還沒做完，材料還沒扣');
  e.update(1.05);
  assert.deepEqual([s.inventory.count('player', 'wood'), s.inventory.count('player', 'plank')], [2, 1]);
  assert.match(fb.at(-1).text, /做好了：木板 ×1/);
  e.runCommand('crafting.make', { recipe: 'plank' });
  e.update(0.3); s.entities.move('player', 20, 13); e.update(1);
  assert.deepEqual([s.inventory.count('player', 'wood'), s.inventory.count('player', 'plank')], [2, 1], '中斷了，材料沒有損失');
});

test('要工作台的配方：不在旁邊時說明原因；走過去就能做', () => {
  const { e, s } = boot();
  s.inventory.add('player', 'plank', 2);
  s.entities.move('player', 21, 12); // 出生點就在工作台旁邊，先走遠一點
  assert.equal(e.runCommand('crafting.make', { recipe: 'fence' }).reason, '要在工作台旁邊才能做');
  const b = bench(s);
  s.entities.move('player', b.x + 1, b.y);
  assert.equal(e.runCommand('crafting.make', { recipe: 'fence' }).ok, true);
  e.update(2);
  assert.equal(s.inventory.count('player', 'fence'), 1);
});

test('解鎖：椅子配方要任務旗標；解鎖時發回饋事件；面板只列出解鎖的配方', () => {
  const { e, s, fb } = boot();
  s.inventory.add('player', 'plank', 3);
  s.entities.move('player', bench(s).x + 1, bench(s).y);
  assert.equal(e.runCommand('crafting.make', { recipe: 'chair' }).reason, '這個配方還沒解鎖');
  assert.doesNotMatch(JSON.stringify(e.renderPanel('crafting.recipes')), /椅子/);
  e._apis.get('quests').setFlag('recipes.furniture');
  assert.match(fb.at(-1).text, /新配方：椅子、桌子/);
  assert.match(JSON.stringify(e.renderPanel('crafting.recipes')), /椅子/);
  assert.equal(e.runCommand('crafting.make', { recipe: 'chair' }).ok, true);
});

test('沒開任務模組：所有配方都能做；沒開行動模組：馬上做好', () => {
  const { e, s } = boot(['crafting']);
  s.inventory.add('player', 'plank', 3);
  s.entities.move('player', bench(s).x + 1, bench(s).y);
  assert.equal(e.runCommand('crafting.make', { recipe: 'chair' }).ok, true);
  assert.equal(s.inventory.count('player', 'chair'), 1);
});

test('主線任務只靠資料接上：做木板 → 解鎖家具配方 → 做椅子', () => {
  const { e, s } = boot();
  const q = e._apis.get('quests');
  // 跳到「做出第一塊木板」
  for (const id of ['welcome', 'first_harvest', 'wood_for_laoju']) { q.setFlag(`dummy_${id}`); }
  const st = e.serializeAll();
  st.modules.quests.data.quests = { welcome: { state: 'done', counts: {} }, first_harvest: { state: 'done', counts: {} }, wood_for_laoju: { state: 'done', counts: {} } };
  e.deserializeAll(st);
  assert.equal(q.state('first_plank'), 'active');
  s.inventory.add('player', 'wood', 2);
  e.runCommand('crafting.make', { recipe: 'plank' }); e.update(1.1);
  assert.equal(q.state('first_plank'), 'ready');
  e.runCommand('quests.claim', { id: 'first_plank' });
  assert.equal(q.hasFlag('recipes.furniture'), true);
  assert.equal(q.state('first_furniture'), 'active');
});

test('關掉製作：工作台消失、面板消失；存檔裡其他資料不受影響', () => {
  const on = boot();
  const save = on.e.serializeAll();
  const off = boot(['actions', 'quests']);
  off.e.deserializeAll(save);
  assert.equal(off.s.entities.byKind('station').length, 0);
  assert.equal(off.e.listPanels().some((p) => p.owner === 'crafting'), false);
  assert.deepEqual(off.e.serializeAll().modules.crafting, save.modules.crafting);
});
