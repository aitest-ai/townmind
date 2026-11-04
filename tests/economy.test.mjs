// 經濟：錢包、在商店旁邊買賣、價格、工具不能賣、商品解鎖、存讀檔、主線任務資料。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices, validatePack } from '../src/core/index.js';
import economy from '../src/modules/economy/index.js';
import quests from '../src/modules/quests/index.js';
import { readPackDir, readCatalog, readSchemas, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
function boot(enabled = ['economy', 'quests']) {
  const services = createCoreServices(island);
  const e = new Engine({ data: island, services, seed: 1 });
  e.register(economy).register(quests);
  e.start({ enabled });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 19, y: 19 });
  services.inventory.add('player', 'axe', 1);
  services.inventory.add('player', 'wood', 10);
  const fb = [];
  e.events.on('economy:feedback', (x) => fb.push(x));
  return { e, s: services, fb, api: e._apis.get('economy') };
}

test('一開始有 50 貝幣；商店在地圖上', () => {
  const { s, api } = boot();
  assert.equal(api.coins('player'), 50);
  assert.equal(s.entities.byKind('shop')[0].label, '小島雜貨店');
});

test('賣東西：價格是 value 的一半；工具不能賣；不在商店旁邊不能賣', () => {
  const { e, s, api, fb } = boot();
  assert.equal(e.runCommand('economy.sell', { item: 'wood', qty: 4 }).result, 20);
  assert.equal(api.coins('player'), 70);
  assert.equal(s.inventory.count('player', 'wood'), 6);
  assert.match(fb.at(-1).text, /賣了木頭 ×4，得到 20 貝幣/);
  assert.equal(e.runCommand('economy.sell', { item: 'axe' }).reason, '工具不能賣喔');
  s.entities.move('player', 10, 13);
  assert.equal(e.runCommand('economy.sell', { item: 'wood' }).reason, '要在商店旁邊才能賣東西');
});

test('買東西：錢夠才能買、說明差多少；還沒上架的商品要先解鎖', () => {
  const { e, s, api, fb } = boot();
  assert.equal(e.runCommand('economy.buy', { item: 'wheat_seed', qty: 2 }).result, 16);
  assert.equal(s.inventory.count('player', 'wheat_seed'), 2);
  assert.equal(api.coins('player'), 34);
  assert.equal(e.runCommand('economy.buy', { item: 'chair' }).reason, '這個商品還沒上架');
  e._apis.get('quests').setFlag('level2');
  assert.match(fb.at(-1).text, /商店上架了：椅子/);
  assert.equal(e.runCommand('economy.buy', { item: 'chair' }).reason, '貝幣不夠：要 80，你有 34');
  assert.equal(e.runCommand('economy.buy', { item: 'apple' }).reason, '商店沒有賣這個');
});

test('沒開任務模組：所有商品都上架', () => {
  const { e, api } = boot(['economy']);
  assert.equal(e.runCommand('economy.buy', { item: 'plank' }).ok, true);
  assert.equal(api.coins('player'), 30);
});

test('存讀檔與關掉模組：錢包保留', () => {
  const a = boot();
  a.e.runCommand('economy.sell', { item: 'wood', qty: 2 });
  const off = boot(['quests']);
  off.e.deserializeAll(a.e.serializeAll());
  assert.equal(off.s.entities.byKind('shop').length, 0);
  const b = boot();
  b.e.deserializeAll(off.e.serializeAll());
  assert.equal(b.api.coins('player'), 60);
});

test('資料檢查：價格、賣出比例、不存在的商品', async () => {
  const bad = { ...island, shop: { sellRate: 2, buy: [{ item: 'gold', price: 0 }] } };
  const msgs = validatePack(bad, await readCatalog(), await readSchemas()).errors.map((x) => x.message).join('\n');
  assert.match(msgs, /sellRate 要是 0～1/);
  assert.match(msgs, /不存在的物品「gold」/);
  assert.match(msgs, /price 要是 1 以上/);
});
