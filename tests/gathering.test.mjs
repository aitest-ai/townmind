// PR6：採集模組（第一個新模組，證明不需要修改 src/core）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices } from '../src/core/index.js';
import gathering from '../src/modules/gathering/index.js';
import residents from '../src/modules/residents/index.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));

function boot(enabled = ['residents', 'gathering']) {
  const services = createCoreServices(island);
  const logs = [];
  services.notify = (t) => logs.push(t);
  const e = new Engine({ data: island, services, seed: 2 });
  e.register(residents).register(gathering);
  e.start({ enabled, cascade: true });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: island.island.spawn.x, y: island.island.spawn.y });
  for (const s of island.pack.startingInventory) services.inventory.add('player', s.item, s.qty);
  return { e, s: services, logs };
}
const find = (s, ref) => s.entities.all().find((x) => x.owner === 'gathering' && x.ref === ref);
const goTo = (s, ent, id = 'player') => s.entities.move(id, ent.x + 1, ent.y);

test('世界包的放置物變成可採集的實體', () => {
  const { s } = boot();
  const ents = s.entities.all().filter((x) => x.owner === 'gathering');
  const placed = island.island.placements.filter((p) => p.type === 'species').length;
  assert.equal(ents.length, placed);
  assert.deepEqual([...new Set(ents.map((x) => x.kind))].sort(), ['bush', 'forage', 'rock', 'tree']);
});

test('玩家採集：要走近、要工具、收穫進背包、採過要等再生', () => {
  const { e, s, logs } = boot();
  const oak = find(s, 'oak');
  let list = e.interactionsFor(oak.id);
  assert.equal(list[0].label, '砍樹（橡樹）');
  assert.equal(list[0].reason, '走近一點才能採集');
  goTo(s, oak);
  assert.equal(e.interactionsFor(oak.id)[0].ok, true);
  const r = e.runCommand('gathering.harvest', { target: oak.id });
  assert.equal(r.ok, true);
  assert.equal(s.inventory.count('player', 'wood'), 3);
  assert.match(logs.at(-1), /你砍了橡樹，得到 木頭 ×3/);
  const again = e.runCommand('gathering.harvest', { target: oak.id });
  assert.match(again.reason, /還沒長回來（第 6 天會恢復）/);
  // 再生：oak 的 regrowDays 是 5
  s.time.skipDays(4, { offline: false });
  assert.equal(s.entities.get(oak.id).state.depleted, true);
  s.time.skipDays(1, { offline: false });
  assert.equal(s.entities.get(oak.id).state.depleted, false);
});

test('沒有斧頭不能砍樹，但可以撿貝殼；背包滿了會說明', () => {
  const { e, s } = boot();
  s.inventory.remove('player', 'axe', 1);
  const oak = find(s, 'oak'); goTo(s, oak);
  assert.equal(e.runCommand('gathering.harvest', { target: oak.id }).reason, '需要斧頭');
  const shell = find(s, 'shell'); goTo(s, shell);
  assert.equal(e.runCommand('gathering.harvest', { target: shell.id }).ok, true);
  assert.equal(s.inventory.count('player', 'shell'), 1);
  // 塞滿背包（20 格）
  const fillers = ['stone', 'plank', 'berry', 'apple', 'wheat', 'carrot', 'carp', 'beetle', 'butterfly', 'rabbit_photo', 'fence', 'chair', 'table', 'wood'];
  for (const it of fillers) s.inventory.add('player', it, 99 * 3);
  const rock = find(s, 'boulder'); goTo(s, rock);
  s.inventory.add('player', 'stone', 999);
  assert.equal(e.runCommand('gathering.harvest', { target: rock.id }).reason, '背包滿了，先整理一下吧');
});

test('居民也會採集：規則腦看到身邊能採的東西，就以 AI 身分執行', () => {
  const { e, s, logs } = boot();
  const bush = find(s, 'berry_bush');
  const runs = [];
  e.events.on('core:commandRun', (x) => runs.push(x));
  s.time.pause();
  goTo(s, bush, 'resident.afu');
  const afu = e._apis.get('residents').get('afu');
  afu.walkTo = null; afu.pauseUntil = 1e9; // 不要散步走開
  for (let i = 0; i < 300 && !s.inventory.count('afu', 'berry'); i++) e.update(0.1);
  assert.equal(s.inventory.count('afu', 'berry'), 3);
  const ai = runs.find((x) => x.id === 'gathering.harvest');
  assert.deepEqual([ai.source, ai.actor, ai.ok], ['ai', 'afu', true]);
  assert.ok(logs.some((t) => /阿福摘了漿果叢/.test(t)));
  // 居民沒有斧頭：不會去砍樹
  const oak = find(s, 'oak');
  assert.equal(e.commands.run('gathering.harvest', { target: oak.id }, { source: 'ai', actor: 'damu' }).ok, false);
});

test('AI 行動清單與提示詞：有開採集才出現；choices 只列身邊能採的', () => {
  const { e, s } = boot();
  const bush = find(s, 'berry_bush');
  goTo(s, bush, 'resident.afu');
  const acts = e.commands.describeForAI({ actor: 'afu' });
  const h = acts.find((a) => a.id === 'gathering.harvest');
  assert.ok(h.params.target.choices.includes(bush.id));
  assert.match(e._apis.get('residents').promptFor('afu').user, /身邊可以採：漿果叢/);
  const off = boot(['residents']);
  assert.equal(off.e.commands.describeForAI({ actor: 'afu' }).some((a) => a.id.startsWith('gathering.')), false);
  assert.doesNotMatch(off.e._apis.get('residents').promptFor('afu').user, /採集/);
});

test('?mods=gathering=off：實體、互動、面板消失；存檔資料保留，再開回來一樣', () => {
  const on = boot();
  const oak = find(on.s, 'oak'); goTo(on.s, oak);
  on.e.runCommand('gathering.harvest', { target: oak.id });
  const save = on.e.serializeAll();
  assert.deepEqual(save.modules.gathering.data.depleted.map((x) => x.ref), ['oak']);

  const off = boot(['residents']);
  off.e.deserializeAll(save);
  assert.equal(off.s.entities.all().filter((x) => x.owner === 'gathering').length, 0);
  assert.equal(off.e.listPanels().some((p) => p.owner === 'gathering'), false);
  assert.deepEqual(off.e.serializeAll().modules.gathering, save.modules.gathering);

  const back = boot();
  back.e.deserializeAll(off.e.serializeAll());
  assert.equal(back.s.entities.get(oak.id).state.depleted, true);
  assert.equal(back.s.inventory.count('player', 'wood'), 3);
});

test('離線補算：離開幾天回來，採過的東西長回來了', () => {
  const a = boot();
  const bush = find(a.s, 'berry_bush'); goTo(a.s, bush);
  a.e.runCommand('gathering.harvest', { target: bush.id });
  const save = a.e.serializeAll();
  const b = boot();
  b.e.deserializeAll(save);
  assert.equal(b.s.entities.get(bush.id).state.depleted, true);
  b.s.time.skipDays(2); // 外殼讀檔後會這樣補算（漿果叢 2 天再生）
  b.e.catchUp({ days: 2 });
  assert.equal(b.s.entities.get(bush.id).state.depleted, false);
});
