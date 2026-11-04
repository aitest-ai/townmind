// 佈置：網格擺放、旋轉、收納、擋路、存讀檔、主線任務。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices } from '../src/core/index.js';
import building from '../src/modules/building/index.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
function boot(enabled = ['building']) {
  const services = createCoreServices(island);
  const e = new Engine({ data: island, services, seed: 1 });
  e.register(building);
  e.start({ enabled });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 18, y: 15 });
  services.inventory.add('player', 'chair', 2);
  services.inventory.add('player', 'table', 1);
  const fb = [];
  e.events.on('building:feedback', (x) => fb.push(x));
  return { e, s: services, fb };
}

test('擺放：對齊格子、要在身邊、不能放水裡、不能疊在別的東西上、不能放在腳下', () => {
  const { e, s, fb } = boot();
  assert.equal(e.runCommand('building.place', { item: 'chair', x: 19, y: 15 }).ok, true);
  const chair = s.entities.byKind('furniture')[0];
  assert.deepEqual([chair.x, chair.y, chair.ref, chair.state.rot], [19, 15, 'chair', 0]);
  assert.equal(s.inventory.count('player', 'chair'), 1);
  assert.match(fb.at(-1).text, /放好了：椅子/);
  assert.equal(e.runCommand('building.place', { item: 'chair', x: 19, y: 15 }).reason, '那一格已經有東西了');
  assert.equal(e.runCommand('building.place', { item: 'chair', x: 18, y: 15 }).reason, '不能放在自己腳下');
  assert.equal(e.runCommand('building.place', { item: 'chair', x: 25, y: 15 }).reason, '要走近一點才能放');
  s.entities.move('player', 3, 13); // 第 13 行最左邊兩格是海
  assert.match(e.runCommand('building.place', { item: 'chair', x: 1, y: 13 }).reason, /不能放東西/);
  assert.equal(e.runCommand('building.place', { item: 'wood', x: 4, y: 13 }).reason, '這個東西不能擺放');
});

test('放在旁邊：自動找身邊的空格；旋轉一圈回到原來的方向；收起來回到背包', () => {
  const { e, s } = boot();
  assert.equal(e.runCommand('building.placeNear', { item: 'table' }).ok, true);
  const t = s.entities.byKind('furniture')[0];
  assert.ok(Math.hypot(t.x - 18, t.y - 15) <= 1.5);
  const labels = e.interactionsFor(t.id).map((x) => x.label);
  assert.deepEqual(labels, ['旋轉桌子', '收起桌子']);
  for (let i = 1; i <= 4; i++) assert.equal(e.runCommand('building.rotate', { target: t.id }).result, i % 4);
  assert.equal(e.runCommand('building.pickup', { target: t.id }).ok, true);
  assert.equal(s.inventory.count('player', 'table'), 1);
  assert.equal(s.entities.byKind('furniture').length, 0);
});

test('家具會擋路（solid）', () => {
  const { e } = boot();
  assert.equal(e.entityKind('furniture').solid, true);
});

test('存讀檔：位置與方向保留；關掉佈置時家具從地圖上消失、資料保留', () => {
  const a = boot();
  a.e.runCommand('building.place', { item: 'chair', x: 19, y: 16, rot: 2 });
  const save = a.e.serializeAll();
  const off = boot([]);
  off.e.deserializeAll(save);
  assert.equal(off.s.entities.byKind('furniture').length, 0);
  const b = boot();
  b.e.deserializeAll(off.e.serializeAll());
  const c = b.s.entities.byKind('furniture')[0];
  assert.deepEqual([c.x, c.y, c.state.rot], [19, 16, 2]);
});
