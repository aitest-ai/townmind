// 行動與工具：裝備工具、有持續時間的動作、成敗結果、走開中斷、回饋事件；採集改用動作。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices } from '../src/core/index.js';
import actions from '../src/modules/actions/index.js';
import gathering from '../src/modules/gathering/index.js';
import residents from '../src/modules/residents/index.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
const withItems = (extra) => ({ ...island, items: [...island.items, ...extra] });

function boot(enabled = ['actions', 'gathering', 'residents'], data = island) {
  const services = createCoreServices(data);
  const e = new Engine({ data, services, seed: 3 });
  e.register(actions).register(gathering).register(residents);
  e.start({ enabled, cascade: true });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 16, y: 13 });
  services.inventory.add('player', 'axe', 1);
  const fb = [];
  for (const id of enabled) e.events.on(`${id}:feedback`, (x) => fb.push({ module: id, ...x }));
  return { e, s: services, fb, api: () => e._apis.get('actions') };
}

test('裝備工具：要有、要是工具；面板顯示手上拿著什麼', () => {
  const { e, s } = boot();
  assert.equal(e.runCommand('actions.equip', { item: 'net' }).reason, '背包裡沒有捕蟲網');
  assert.equal(e.runCommand('actions.equip', { item: 'wood' }).reason, '這不是工具');
  assert.equal(e.runCommand('actions.equip', { item: 'axe' }).ok, true);
  assert.match(JSON.stringify(e.renderPanel('actions.tools')), /手上拿著.*斧頭/);
  s.inventory.remove('player', 'axe', 1);
  assert.equal(e._apis.get('actions').equipped('player'), null, '工具不在背包了，手上也不會拿著');
});

test('有持續時間的動作：時間到才完成；同時只能做一件；進度條在畫面上方', () => {
  const { e, api } = boot();
  let done = null;
  assert.equal(api().start('player', { label: '整理', seconds: 2, onDone: (o) => { done = o; } }).ok, true);
  assert.match(api().start('player', { label: '別的事', seconds: 1 }).reason, /正在整理/);
  e.update(1);
  assert.equal(done, null);
  assert.equal(e.renderPanel('actions.progress')[0].type, 'bar');
  assert.ok(Math.abs(api().progress('player').done - 0.5) < 1e-9);
  e.update(1.01);
  assert.deepEqual(done, { ok: true });
  assert.deepEqual(e.renderPanel('actions.progress'), []);
});

test('工具速度：toolSpeed 2 的工具，動作快一倍', () => {
  const data = withItems([{ id: 'gold_axe', name: '金斧頭', category: 'tool', stack: 1, toolSpeed: 2 }]);
  const { e, s, api } = boot(['actions'], data);
  s.inventory.add('player', 'gold_axe', 1);
  let done = false;
  api().start('player', { label: '砍', seconds: 2, tool: 'gold_axe', onDone: () => { done = true; } });
  assert.equal(api().equipped('player'), 'gold_axe', '開始動作時自動拿起需要的工具');
  e.update(1.01);
  assert.equal(done, true);
});

test('成敗結果：依成功機率、用種子亂數（同一個種子結果一樣）；失敗只是沒成功，發回饋事件', () => {
  const run = () => {
    const { e, api, fb } = boot(['actions']);
    const outs = [];
    for (let i = 0; i < 20; i++) { api().start('player', { label: '釣魚', seconds: 0.1, successChance: 0.5, onDone: (o) => outs.push(o.ok) }); e.update(0.2); }
    return { outs, fb };
  };
  const a = run(), b = run();
  assert.deepEqual(a.outs, b.outs);
  assert.ok(a.outs.includes(true) && a.outs.includes(false));
  assert.equal(a.fb.filter((x) => x.kind === 'fail').length, a.outs.filter((x) => !x).length);
  assert.match(a.fb.find((x) => x.kind === 'fail').text, /釣魚沒有成功，再試一次吧/);
});

test('走開就中斷：onDone 收到 cancelled；回饋事件說明原因', () => {
  const { e, s, api, fb } = boot(['actions']);
  let out = null;
  api().start('player', { label: '砍樹', seconds: 3, onDone: (o) => { out = o; } });
  e.update(0.5);
  s.entities.move('player', 18, 13);
  e.update(0.1);
  assert.deepEqual(out, { ok: false, cancelled: true });
  assert.match(fb.at(-1).text, /走開了，砍樹停下來了/);
});

test('採集改用動作：按下去要等一下才拿到；走開就拿不到；回饋事件有位置', () => {
  const { e, s, fb } = boot();
  const oak = s.entities.all().find((x) => x.ref === 'oak');
  s.entities.move('player', oak.x + 1, oak.y);
  assert.deepEqual(e.runCommand('gathering.harvest', { target: oak.id }).result, { started: true });
  assert.equal(s.inventory.count('player', 'wood'), 0);
  assert.equal(e.runCommand('gathering.harvest', { target: oak.id }).reason, '手上還在忙');
  e.update(1.5);
  assert.equal(s.inventory.count('player', 'wood'), 3);
  const ok = fb.find((x) => x.module === 'gathering');
  assert.deepEqual([ok.kind, ok.at], ['success', { x: oak.x, y: oak.y }]);
  // 走開中斷
  const oak2 = s.entities.all().filter((x) => x.ref === 'oak')[1];
  s.entities.move('player', oak2.x + 1, oak2.y);
  e.runCommand('gathering.harvest', { target: oak2.id });
  e.update(0.3); s.entities.move('player', oak2.x + 2, oak2.y); e.update(2);
  assert.equal(s.inventory.count('player', 'wood'), 3);
  assert.equal(s.entities.get(oak2.id).state.depleted, false);
});

test('關掉「行動與工具」：採集照樣可以玩（馬上拿到）；存檔裡的工具資料保留', () => {
  const on = boot();
  on.e.runCommand('actions.equip', { item: 'axe' });
  const save = on.e.serializeAll();
  const off = boot(['gathering', 'residents']);
  off.e.deserializeAll(save);
  const oak = off.s.entities.all().find((x) => x.ref === 'oak');
  off.s.entities.move('player', oak.x + 1, oak.y);
  assert.equal(off.e.runCommand('gathering.harvest', { target: oak.id }).ok, true);
  assert.equal(off.s.inventory.count('player', 'wood'), 3);
  assert.deepEqual(off.e.serializeAll().modules.actions, save.modules.actions);
  const back = boot();
  back.e.deserializeAll(off.e.serializeAll());
  assert.equal(back.api().equipped('player'), 'axe');
});
