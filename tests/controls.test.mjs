// WP2：尋路、碰撞滑行、擋路的東西、平滑加減速（外殼的 player.js／pathfind.js，純 JS，在 Node 測試）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createEntities } from '../src/core/index.js';
import { createPlayerController } from '../src/shell/player.js';
import { findPath, smoothPath, nearestFree } from '../src/shell/pathfind.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const { island } = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
const walk = (x, y) => island.legend[island.terrain[y]?.[x]]?.walkable !== false && x >= 0 && y >= 0 && x < island.size.w && y < island.size.h;
const grid = { w: island.size.w, h: island.size.h, blocked: (x, y) => !walk(x, y) };

function world(x = 16, y = 13, solids = []) {
  const ents = createEntities();
  ents.add({ id: 'player', kind: 'player', owner: 'core', x, y });
  for (const [sx, sy, r = 0.42] of solids) ents.add({ kind: 'rock', owner: 't', x: sx, y: sy, state: { r } });
  const pc = createPlayerController({ entities: ents, island, solidRadius: (e) => (e.kind === 'rock' ? e.state.r : 0) });
  const run = (sec, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) pc.update(dt); };
  return { ents, pc, run, p: () => ents.get('player') };
}

test('A*：繞過島上的水池；每一格都能走；不切角', () => {
  const r = findPath(grid, { x: 18, y: 8 }, { x: 27, y: 9 });
  assert.ok(r, '應該找得到路');
  assert.ok(r.cells.every((c) => walk(c.x, c.y)));
  assert.ok(r.cells.length > 10, `要繞路，實際 ${r.cells.length} 格`);
  for (let i = 1; i < r.cells.length; i++) {
    const a = r.cells[i - 1], b = r.cells[i];
    if (a.x !== b.x && a.y !== b.y) assert.ok(walk(b.x, a.y) && walk(a.x, b.y), '斜走時兩邊都要能走');
  }
});

test('A*：點到海裡 → 走到最近的岸邊；完全到不了（被水隔開）→ 沒有路', () => {
  const r = findPath(grid, { x: 16, y: 13 }, { x: 16, y: 23 });
  assert.equal(r.adjusted, true);
  assert.ok(walk(r.goal.x, r.goal.y));
  assert.ok(r.goal.y >= 19 && r.goal.y <= 20, `岸邊在 y=19~20，實際 ${r.goal.y}`);
  const islandGrid = { w: 5, h: 1, blocked: (x) => x === 2 };
  assert.equal(findPath(islandGrid, { x: 0, y: 0 }, { x: 4, y: 0 }), null);
  assert.deepEqual(nearestFree(islandGrid, 2, 0, { from: { x: 4, y: 0 } }), { x: 3, y: 0 });
});

test('拉直路徑：看得到就直接走', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 1 }];
  assert.deepEqual(smoothPath(pts, () => true), [{ x: 0, y: 0 }, { x: 3, y: 1 }]);
  assert.equal(smoothPath(pts, () => false).length, 4);
});

test('加速與減速是平滑的', () => {
  const w = world();
  w.pc.setDirection(1, 0);
  w.pc.update(1 / 60);
  const v1 = w.pc.velocity.x;
  assert.ok(v1 > 0 && v1 < 1, `第一幀還沒到全速，實際 ${v1}`);
  w.run(0.5);
  assert.ok(w.pc.velocity.x > 3.2, '半秒內接近全速');
  w.pc.setDirection(0, 0);
  const x0 = w.p().x;
  w.run(0.5);
  const slid = w.p().x - x0;
  assert.ok(slid > 0.05 && slid < 0.5, `放開後滑一小段就停，實際 ${slid}`);
  assert.equal(w.pc.moving, false);
});

test('搖桿只推一點點：走得比較慢', () => {
  const a = world(), b = world();
  a.pc.setDirection(1, 0); b.pc.setDirection(0.4, 0);
  a.run(1); b.run(1);
  assert.ok(b.p().x - 16 < (a.p().x - 16) * 0.5);
});

test('斜著撞岸邊：沿著岸邊滑行，不會卡住不動', () => {
  const w = world(16, 4);   // 北岸附近
  w.pc.setDirection(0.7, -0.7);
  w.run(2);
  assert.ok(w.pc.free(w.p().x, w.p().y));
  assert.ok(w.p().x > 17, `應該往右滑了，實際 x=${w.p().x}`);
});

test('擋路的東西：正面撞上會停在外面；偏一點會沿著邊緣滑過去', () => {
  const w = world(14, 13, [[17, 13]]);
  w.pc.setDirection(1, 0);
  w.run(2);
  assert.ok(w.p().x <= 17 - 0.72 + 0.01, `被石頭擋住，實際 x=${w.p().x}`);
  const w2 = world(14, 13.25, [[17, 13]]);
  w2.pc.setDirection(1, 0);
  w2.run(3);
  assert.ok(w2.p().x > 18, `偏一點時會滑過去，實際 x=${w2.p().x}`);
});

test('點地面：繞過水池走到對面；繞過擋路的石頭；點在石頭上 → 走到旁邊', () => {
  const w = world(18, 8);
  assert.equal(w.pc.setTarget(27, 9), true);
  for (let i = 0; i < 60 * 12 && w.pc.moving; i++) w.pc.update(1 / 60);
  assert.ok(Math.hypot(w.p().x - 27, w.p().y - 9) < 0.2, `走到了對面，實際 (${w.p().x.toFixed(2)}, ${w.p().y.toFixed(2)})`);

  const w2 = world(14, 13, [[16, 13], [16, 12], [16, 14]]);
  assert.equal(w2.pc.setTarget(18, 13), true);
  for (let i = 0; i < 60 * 8 && w2.pc.moving; i++) w2.pc.update(1 / 60);
  assert.ok(Math.hypot(w2.p().x - 18, w2.p().y - 13) < 0.2, '繞過石牆');

  const w3 = world(14, 13, [[18, 13]]);
  w3.pc.setTarget(18, 13);
  for (let i = 0; i < 60 * 8 && w3.pc.moving; i++) w3.pc.update(1 / 60);
  const d = Math.hypot(w3.p().x - 18, w3.p().y - 13);
  assert.ok(d >= 0.72 - 0.01 && d < 1.6, `停在石頭旁邊，距離 ${d}`);
});

test('目標到不了：回傳 false，不會亂走', () => {
  const ents = createEntities();
  ents.add({ id: 'player', kind: 'player', owner: 'core', x: 1, y: 1 });
  const tiny = { size: { w: 5, h: 3 }, legend: { '.': { walkable: true }, '~': { walkable: false } }, terrain: ['.....', '..~..', '.....'] };
  const walled = { ...tiny, terrain: ['..~..', '..~..', '..~..'] };
  const pc = createPlayerController({ entities: ents, island: walled });
  assert.equal(pc.setTarget(4, 1), false); // 目標本身能走，但被水牆隔開 → 沒有路（外殼會顯示「那裡走不過去喔」）
  for (let i = 0; i < 300; i++) pc.update(1 / 60);
  assert.deepEqual([ents.get('player').x, ents.get('player').y], [1, 1], '不會亂走');
  void tiny;
});
