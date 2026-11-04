// WP1：居民日記（玩的時候記錄、離線時補寫、不呼叫 AI、可重現）與存檔升級。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices } from '../src/core/index.js';
import diary from '../src/modules/quests-diary/index.js';
import residents from '../src/modules/residents/index.js';
import gathering from '../src/modules/gathering/index.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));

function boot(enabled = ['residents', 'gathering', 'quests-diary'], { seed = 5 } = {}) {
  const services = createCoreServices(island);
  const banners = [];
  services.notify = (t, lv) => { if (lv === 'banner') banners.push(t); };
  const e = new Engine({ data: island, services, seed });
  e.register(residents).register(gathering).register(diary);
  e.start({ enabled, cascade: true });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 16, y: 13 });
  services.inventory.add('player', 'axe', 1);
  const fetchCalls = [];
  return { e, s: services, banners, api: () => e._apis.get('quests-diary'), fetchCalls };
}

test('玩的時候：今天發生的事，隔天變成一則日記', () => {
  const { e, s, api } = boot();
  const oak = s.entities.all().find((x) => x.ref === 'oak');
  s.entities.move('player', oak.x + 1, oak.y);
  e.runCommand('gathering.harvest', { target: oak.id });
  const laoju = s.entities.get('resident.laoju');
  s.entities.move('player', laoju.x + 1, laoju.y);
  e.runCommand('residents.greet', { who: 'laoju' });
  s.time.advance(720); // 過完一天（一天 720 秒）
  const [d] = api().entries();
  assert.equal(d.day, 1);
  assert.equal(d.offline, false);
  assert.match(d.lines.join(''), /採集了 1 次，收穫有木頭 3 個/);
  assert.match(d.lines.join(''), /跟老橘打招呼/);
});

test('離線補算：每一天一則、最後一則有想念你的話、畫面提醒；同一份存檔結果完全一樣', () => {
  const a = boot();
  const save = a.e.serializeAll();
  const run = () => {
    const b = boot();
    b.e.deserializeAll(save);
    b.s.time.skipDays(3);
    b.e.catchUp({ days: 3, elapsedMs: 3 * 720_000 });
    return b;
  };
  const b1 = run(), b2 = run();
  const e1 = b1.api().entries();
  assert.equal(e1.length, 3);
  assert.deepEqual(e1.map((x) => x.day), [1, 2, 3]);
  assert.ok(e1.every((x) => x.offline && x.lines.length >= 2));
  assert.deepEqual(e1, b2.api().entries(), '同一份存檔、同樣天數，日記一樣');
  assert.match(b1.banners[0], /你離開的這段時間（3 天）/);
  assert.equal(b1.api().unread(), 3);
  // 和整個存檔比較也一致（除了存檔時間）
  const strip = (x) => JSON.stringify(x.e.serializeAll().modules);
  assert.equal(strip(b1), strip(b2));
});

test('離線最多補 7 天；沒有離開就不寫', () => {
  const b = boot();
  b.s.time.skipDays(30);
  b.e.catchUp({ days: 30 });
  assert.equal(b.api().entries().length, 7);
  const c = boot();
  c.e.catchUp({ days: 0 });
  assert.equal(c.api().entries().length, 0);
});

test('關掉採集：離線日記不會寫到採集；居民模組也關掉時改由「小島」寫', () => {
  const words = /樹枝|漿果|摘/;
  const on = boot();
  on.s.time.skipDays(7); on.e.catchUp({ days: 7 });
  assert.ok(on.api().entries().some((x) => words.test(x.lines.join(''))), '開著採集時，七天裡應該有寫到採集');
  const off = boot(['residents', 'quests-diary']);
  off.s.time.skipDays(7); off.e.catchUp({ days: 7 });
  assert.equal(off.api().entries().some((x) => words.test(x.lines.join(''))), false);
  const alone = boot(['quests-diary']);
  alone.s.time.skipDays(2); alone.e.catchUp({ days: 2 });
  assert.ok(alone.api().entries().every((x) => x.writer === '小島'));
});

test('不呼叫 AI：補算期間沒有任何網路請求，也沒有以 AI 身分執行指令', () => {
  const b = boot();
  const runs = [];
  b.e.events.on('core:commandRun', (x) => runs.push(x));
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => { fetched++; throw new Error('不應該連網'); };
  try { b.s.time.skipDays(5); b.e.catchUp({ days: 5 }); } finally { globalThis.fetch = realFetch; }
  assert.equal(fetched, 0);
  assert.equal(runs.filter((x) => x.source === 'ai').length, 0);
});

test('存讀檔：日記與未讀數保留；看過了會清掉未讀', () => {
  const a = boot();
  a.s.time.skipDays(2); a.e.catchUp({ days: 2 });
  const b = boot();
  b.e.deserializeAll(a.e.serializeAll());
  assert.equal(b.api().entries().length, 2);
  assert.equal(b.api().unread(), 2);
  b.e.runCommand('quests-diary.markRead');
  assert.equal(b.api().unread(), 0);
  assert.match(JSON.stringify(b.e.renderPanel('quests-diary.diary')), /你不在的時候/);
});

test('存檔版本升級：舊格式（format 1、沒有 meta）的存檔仍讀得進來', () => {
  const a = boot();
  a.s.time.skipDays(1); a.e.catchUp({ days: 1 });
  const blob = a.e.serializeAll();
  const old = { format: 1, modules: blob.modules };
  const b = boot();
  const rep = b.e.deserializeAll(old);
  assert.deepEqual(rep.failed, []);
  assert.equal(b.api().entries().length, 1);
});
