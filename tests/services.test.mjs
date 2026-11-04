// PR2：核心服務（時間、實體、背包）、實體互動宣告、宣告式面板、registerAIContext。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, createCoreServices, createTime, createEntities, createInventory } from '../src/core/index.js';

const mod = (id, extra = {}) => ({ id, version: '1.0.0', ...extra });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const ITEMS = [{ id: 'wood', name: '木頭', stack: 10 }, { id: 'axe', name: '斧頭', stack: 1 }];

test('時間：課堂倍率、換日事件、季節、暫停、存讀檔', () => {
  const t = createTime({ dayLengthSec: 60, startMinute: 0, seasonDays: 2 });
  const days = [];
  const e = new Engine({ services: { time: t } });
  e.events.on('core:dayStarted', (x) => days.push(x));
  assert.equal(t.advance(30), 30);
  assert.equal(Math.round(t.minuteOfDay), 720);
  t.setTimeScale(2);
  t.advance(15); // 30 遊戲秒 → 跨日
  assert.equal(t.day, 2);
  assert.deepEqual(days.map((d) => d.day), [2]);
  t.skipDays(1);
  assert.equal(t.season, 'summer'); // 每 2 天一季，第 3 天是夏天
  assert.equal(days[1].offline, true);
  t.pause();
  assert.equal(t.advance(10), 0);
  assert.match(t.clockText(), /第 3 天　夏天　00:00/);
  const blob = e.serializeAll();
  const t2 = createTime({ dayLengthSec: 60 });
  const e2 = new Engine({ services: { time: t2 } });
  e2.deserializeAll(blob);
  assert.equal(t2.day, 3);
  // 真實時鐘模式
  let now = new Date(2026, 10, 4, 23, 59).getTime();
  const tr = createTime({ mode: 'real', now: () => now });
  assert.equal(tr.hour, 23);
  now += 2 * 60 * 1000;
  tr.advance(1);
  assert.equal(tr.day, 2);
});

test('實體：新增、查詢、附近、更新、移除擁有者；只存 core 的實體', () => {
  const ents = createEntities();
  const p = ents.add({ id: 'player', kind: 'player', owner: 'core', x: 1, y: 1 });
  const a = ents.add({ kind: 'tree', owner: 'gathering', ref: 'oak', x: 2, y: 1 });
  ents.add({ kind: 'tree', owner: 'gathering', ref: 'oak', x: 9, y: 9 });
  assert.equal(a.id, 'tree#1');
  assert.equal(code(() => ents.add({ id: 'player', kind: 'x', owner: 'core' })), undefined); // 一般 Error，不是 FrameworkError
  assert.throws(() => ents.add({ id: 'player', kind: 'x', owner: 'core' }));
  assert.deepEqual(ents.near(1, 1, 2).map((e) => e.id), ['player', 'tree#1']);
  assert.deepEqual(ents.near(1, 1, 2, { kind: 'tree' }).map((e) => e.id), ['tree#1']);
  const v = ents.version;
  ents.move('player', 3, 3);
  assert.equal(ents.version, v); // 移動不算結構變動
  ents.update('tree#1', { state: { left: 2 } });
  assert.equal(ents.get('tree#1').state.left, 2);
  assert.ok(ents.version > v);
  assert.deepEqual(ents.saveSlice.serialize().map((e) => e.id), ['player']);
  // 模組關掉：它的實體從地圖消失
  const e = new Engine({ services: { entities: ents } });
  e.register(mod('gathering'));
  e.start({ enabled: ['gathering'] });
  e.dispose();
  assert.deepEqual(ents.all().map((x) => x.id), ['player']);
  assert.equal(p.x, 3);
});

test('背包：疊加與格數上限、滿了少放、一次拿多樣、事件、存讀檔保留未知物品', () => {
  const inv = createInventory({ items: ITEMS, slots: 2 });
  const changes = [];
  const e = new Engine({ services: { inventory: inv } });
  e.events.on('core:inventoryChanged', (x) => changes.push(x.delta));
  assert.equal(inv.add('player', 'wood', 15), 15); // 2 格
  assert.equal(inv.add('player', 'wood', 9), 5);   // 只剩 5 個空位
  assert.equal(inv.add('player', 'axe', 1), 0);    // 沒格子了
  assert.equal(inv.add('player', 'ghost', 1), 0);  // 不存在的物品
  assert.equal(inv.remove('player', 'wood', 99), false);
  assert.equal(inv.removeAll('player', [{ item: 'wood', qty: 3 }, { item: 'axe', qty: 1 }]), false);
  assert.equal(inv.count('player', 'wood'), 20);
  assert.equal(inv.removeAll('player', [{ item: 'wood', qty: 20 }]), true);
  assert.deepEqual(changes, [15, 5, -20]);
  inv.add('afu', 'axe', 1);
  const blob = e.serializeAll();
  blob.modules['core.inventory'].data.afu.removed_item = 3;
  const inv2 = createInventory({ items: ITEMS });
  new Engine({ services: { inventory: inv2 } }).deserializeAll(blob);
  assert.equal(inv2.count('afu', 'axe'), 1);
  assert.equal(inv2.saveSlice.serialize().afu.removed_item, 3);
});

test('createCoreServices：從世界包建立一組服務', () => {
  const s = createCoreServices({ items: ITEMS, pack: { time: { dayLengthSec: 120 }, inventorySlots: 5 } });
  assert.equal(s.time.dayLengthSec, 120);
  assert.equal(s.inventory.slots, 5);
  assert.equal(s.textFilter('你好').ok, true);
});

function gatherWorld() {
  const services = createCoreServices({ items: ITEMS });
  const e = new Engine({ services });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 0, y: 0 });
  e.register(mod('g', {
    init(ctx) {
      const { entities, inventory } = ctx.services;
      entities.add({ id: 't1', kind: 'tree', owner: 'g', x: 1, y: 0, state: { left: 1 } });
      ctx.registerCommand({
        id: 'g.chop', label: '砍樹',
        params: { target: { type: 'entity', kind: 'tree' } },
        available: (call) => (inventory.has(call.actor, 'axe') ? true : '需要斧頭'),
        canRun: ({ target }) => (entities.get(target).state.left > 0 ? true : '這棵樹還沒長回來'),
        run: ({ target }, call) => { entities.update(target, { state: { left: 0 } }); inventory.add(call.actor, 'wood', 3); },
      });
      ctx.registerEntityKind('tree', { label: '樹', interactions: [{ label: '砍樹', command: 'g.chop', args: (ent) => ({ target: ent.id }) }, { label: '拍照', command: 'camera.shoot', args: {} }] });
      ctx.registerPanel({ id: 'g.panel', title: '採集', view: (call) => [
        { type: 'stat', label: '木頭', value: inventory.count(call.actor, 'wood') },
        { type: 'button', label: '砍樹', command: 'g.chop', args: { target: 't1' } },
      ] });
      ctx.registerPanel({ id: 'g.broken', title: '壞掉', view: () => { throw new Error('畫不出來'); } });
      ctx.registerAIContext(() => [`樹還剩 ${entities.get('t1').state.left} 棵可以砍`]);
    },
  }));
  return { e, services };
}

test('實體互動：依可用性標記，模組沒開的互動不出現', () => {
  const { e, services } = gatherWorld();
  e.start({ enabled: ['g'] });
  let list = e.interactionsFor('t1');
  assert.deepEqual(list.map((x) => [x.label, x.ok, x.reason]), [['砍樹', false, '需要斧頭']]); // 拍照指令不存在 → 不出現
  services.inventory.add('player', 'axe', 1);
  list = e.interactionsFor('t1');
  assert.equal(list[0].ok, true);
  assert.equal(e.runCommand(list[0].command, list[0].args).ok, true);
  assert.equal(e.interactionsFor('t1')[0].reason, '這棵樹還沒長回來');
  assert.deepEqual(e.interactionsFor('ghost'), []);
});

test('宣告式面板：按鈕帶 enabled／reason；出錯的面板只顯示白話錯誤；模組關掉面板消失', () => {
  const { e, services } = gatherWorld();
  const errs = [];
  e.events.on('core:moduleError', (x) => errs.push(x.message));
  e.start({ enabled: ['g'] });
  assert.deepEqual(e.listPanels().map((p) => [p.id, p.placement]), [['g.panel', 'side'], ['g.broken', 'side']]);
  let nodes = e.renderPanel('g.panel');
  assert.deepEqual(nodes[0], { type: 'stat', label: '木頭', value: 0 });
  assert.equal(nodes[1].enabled, false);
  assert.equal(nodes[1].reason, '需要斧頭');
  services.inventory.add('player', 'axe', 1);
  assert.equal(e.renderPanel('g.panel')[1].enabled, true);
  const broken = e.renderPanel('g.broken');
  assert.equal(broken[0].type, 'error');
  assert.match(broken[0].text, /暫時無法顯示/);
  assert.ok(errs.some((m) => /畫不出來/.test(m)));
  e.dispose();
  assert.equal(e.listPanels().length, 0);
  assert.equal(e.renderPanel('g.panel')[0].text, '這個面板目前沒有開啟。');
});

test('registerAIContext：只收集已啟用模組；出錯不影響其他；長度有上限', () => {
  const { e } = gatherWorld();
  e.register(mod('noisy', { init(ctx) {
    ctx.registerAIContext(() => 'x'.repeat(500));
    ctx.registerAIContext(() => { throw new Error('壞'); });
  } }));
  e.register(mod('reader', { init(ctx) { ctx.registerAIContext(() => null); } }));
  e.start({ enabled: ['g', 'noisy', 'reader'] });
  const ctxList = e.collectAIContext({ actor: 'afu' });
  assert.deepEqual(ctxList.map((c) => c.module), ['g', 'noisy']);
  assert.equal(ctxList[0].lines[0], '樹還剩 1 棵可以砍');
  assert.equal(ctxList[1].lines[0].length, 200);
  e.dispose();
  e.start({ enabled: ['noisy'] });
  assert.deepEqual(e.collectAIContext().map((c) => c.module), ['noisy']);
});

test('服務只能發 core: 事件', () => {
  const bad = { bind(core) { this.core = core; } };
  new Engine({ services: { bad } });
  assert.equal(code(() => bad.core.emit('farming:x')), 'EVENT_NAMESPACE');
});
