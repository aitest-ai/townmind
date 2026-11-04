// 競速：起跑、倒數、跑完比賽與名次、居民對手只能用受限指令、時間挑戰的紀錄可重播驗證、幽靈、撞岸轉圈、存讀檔。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices, validatePack } from '../src/core/index.js';
import racing from '../src/modules/racing/index.js';
import residents from '../src/modules/residents/index.js';
import { createPolicy } from '../src/shell/policy.js';
import { replay } from '../src/modules/racing/sim.js';
import { readPackDir, readCatalog, readSchemas, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
const T = island.tracks[0];

function boot(enabled = ['racing', 'residents']) {
  const services = createCoreServices(island);
  const policy = createPolicy();
  let steer = () => ({ x: 0, y: 0 });
  services.policy = policy;
  services.input = { vector: () => steer(), cameraAngle: () => 0 };
  const e = new Engine({ data: island, services, seed: 1 });
  e.register(racing).register(residents);
  e.start({ enabled });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: T.start.x + 1, y: T.start.y });
  const fb = [], runs = [], ev = [];
  e.events.on('racing:feedback', (x) => fb.push(x));
  e.events.on('core:commandRun', (x) => runs.push(x));
  e.events.on('racing:finished', (x) => ev.push(x));
  const api = e._apis.get('racing');
  // 自動駕駛：朝下一個檢查點全速前進（測試用的「玩家」）
  const autopilot = (throttle = 1) => () => {
    const st = api.state(); if (!st || st.countdown > 0) return { x: 0, y: 0 };
    const p = st.racers[0], cps = [...T.checkpoints, T.start], c = cps[p.next] ?? T.start;
    const dx = c.x - p.x, dy = c.y - p.y, l = Math.hypot(dx, dy) || 1;
    return { x: (dx / l) * throttle, y: (dy / l) * throttle };
  };
  const run = (maxSec = 120) => { for (let i = 0; i < maxSec * 30 && api.racing(); i++) e.update(1 / 30); };
  return { e, s: services, policy, fb, runs, ev, api, setSteer: (f) => { steer = f; }, autopilot, run };
}

test('起跑：要在起跑門旁邊；比賽中外殼暫停一般走路；倒數 3 秒', () => {
  const { e, s, policy, api, fb } = boot();
  s.entities.move('player', 5, 13);
  assert.equal(e.runCommand('racing.start', { track: T.id, mode: 'race' }).reason, '走到起跑門旁邊才能開始');
  s.entities.move('player', T.start.x + 1, T.start.y);
  assert.equal(e.runCommand('racing.start', { track: T.id, mode: 'race' }).ok, true);
  assert.equal(policy.get('playerMovement', true), false);
  assert.equal(api.state().racers.length, 3, '玩家＋兩位居民');
  assert.equal(api.state().countdown, 3);
  assert.match(fb[0].text, /和阿福、大木比賽/);
  for (let i = 0; i < 95; i++) e.update(1 / 30);
  assert.deepEqual(fb.slice(1).map((x) => x.text).filter((t) => ['3', '2', '1', '出發！'].includes(t)), ['3', '2', '1', '出發！']);
});

test('跑完比賽：有名次與時間；居民放回自由行動、外殼恢復走路；發 racing:finished', () => {
  const { e, s, policy, ev, fb, setSteer, autopilot, run, api } = boot();
  setSteer(autopilot());
  e.runCommand('racing.start', { track: T.id, mode: 'race' });
  run();
  assert.equal(api.racing(), false);
  assert.equal(ev.length, 1);
  assert.ok(ev[0].place >= 1 && ev[0].place <= 3);
  assert.ok(ev[0].time > 12 && ev[0].time < 90, `時間合理（兩圈）：${ev[0].time}`);
  assert.match(fb.find((x) => x.kind === 'complete').text, /第 \d 名！用了 [\d.]+ 秒/);
  assert.equal(policy.get('playerMovement', true), true);
  assert.equal(s.entities.byKind('checkpoint').length, 0);
});

test('公平：居民對手只透過 racing.drive（AI 身分、受限參數）；AI 不能開始比賽；比賽外不能用 drive', () => {
  const { e, runs, setSteer, autopilot, run } = boot();
  assert.equal(e.commands.run('racing.drive', { throttle: 100, line: 'inside' }, { source: 'ai', actor: 'afu' }).reason, '只有比賽中的對手能用');
  setSteer(autopilot());
  e.runCommand('racing.start', { track: T.id, mode: 'race' });
  for (let i = 0; i < 30 * 8; i++) e.update(1 / 30);
  const acts = e.commands.describeForAI({ actor: 'afu' }).map((a) => a.id);
  assert.deepEqual(acts, ['racing.drive']);
  assert.equal(e.commands.run('racing.start', { track: T.id }, { source: 'ai', actor: 'afu' }).code, 'NOT_AI');
  assert.equal(e.commands.run('racing.drive', { throttle: 999, line: 'inside' }, { source: 'ai', actor: 'afu' }).ok, true, '超過範圍會被夾回 100');
  run();
  const ai = runs.filter((r) => r.source === 'ai' && r.ok);
  assert.ok(ai.length > 5);
  assert.ok(ai.every((r) => r.id === 'racing.drive' && r.args.throttle <= 100));
});

test('時間挑戰：紀錄用錄下的輸入重跑驗證；同樣輸入一定同樣成績；跑更快會刷新紀錄；有幽靈', () => {
  const { e, s, ev, fb, setSteer, autopilot, run, api } = boot();
  setSteer(autopilot(0.8));
  e.runCommand('racing.start', { track: T.id, mode: 'time' });
  run();
  const rec = api.record(T.id);
  assert.ok(rec && ev[0].verified && ev[0].record);
  assert.equal(api.replay(T.id, rec.inputs), rec.time);
  assert.equal(api.replay(T.id, rec.inputs), rec.time, '再重播一次也一樣');
  // 第二次：全速，應該更快 → 新紀錄；比賽中有幽靈
  setSteer(autopilot(1));
  s.entities.move('player', T.start.x + 1, T.start.y);
  e.runCommand('racing.start', { track: T.id, mode: 'time' });
  e.update(1 / 30);
  assert.ok(s.entities.get('race.ghost'), '有幽靈');
  run();
  assert.ok(ev[1].time < ev[0].time, `${ev[1].time} < ${ev[0].time}`);
  assert.equal(ev[1].record, true);
  assert.ok(fb.some((x) => x.kind === 'unlock' && /新紀錄/.test(x.text)));
});

test('撞到岸邊只會轉圈圈（沒有傷害），可以繼續跑', () => {
  const { e, fb, setSteer, api } = boot();
  setSteer(() => ({ x: 0, y: 1 })); // 一直往南：衝向海
  e.runCommand('racing.start', { track: T.id, mode: 'time' });
  for (let i = 0; i < 30 * 8; i++) e.update(1 / 30);
  assert.ok(fb.some((x) => x.kind === 'fail' && /轉圈圈/.test(x.text)));
  assert.equal(api.racing(), true, '比賽繼續');
  assert.equal(e.runCommand('racing.quit').ok, true);
});

test('存讀檔：最佳紀錄保留；進行中的比賽不存', () => {
  const a = boot();
  a.setSteer(a.autopilot());
  a.e.runCommand('racing.start', { track: T.id, mode: 'time' });
  a.run();
  const b = boot();
  b.e.deserializeAll(a.e.serializeAll());
  assert.equal(b.api.record(T.id).time, a.api.record(T.id).time);
  assert.equal(b.api.replay(T.id, b.api.record(T.id).inputs), b.api.record(T.id).time);
});

test('物理是純函式：同樣輸入同樣結果', () => {
  const world = { vehicle: 'skateboard', laps: 1, checkpoints: [{ x: 20, y: 13 }, { x: 16, y: 13 }], walkable: () => true, terrainSpeed: () => 1 };
  const inputs = Array.from({ length: 400 }, (_, i) => [i < 120 ? 0 : 314, 100]);
  assert.equal(replay(world, { x: 16, y: 13 }, 0, inputs), replay(world, { x: 16, y: 13 }, 0, inputs));
});

test('資料檢查：檢查點在水裡會被抓到', async () => {
  const bad = { ...island, tracks: [{ ...T, checkpoints: [{ x: 0, y: 0 }, { x: 16, y: 13 }] }] };
  const msgs = validatePack(bad, await readCatalog(), await readSchemas()).errors.map((x) => x.message).join('\n');
  assert.match(msgs, /第 1 個檢查點 \(0,0\) 不在能走的格子上/);
});
