// 耕作：播種、澆水、依天數長大、季節、下雨自動澆水（只聽事件）、離線補算、收成、居民幫忙、主線任務。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices } from '../src/core/index.js';
import farming from '../src/modules/farming/index.js';
import residents from '../src/modules/residents/index.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
function boot(enabled = ['farming'], { time = {}, config = {} } = {}) {
  const services = createCoreServices(island, { time });
  const e = new Engine({ data: island, services, seed: 1 });
  e.register(farming).register(residents);
  e.start({ enabled, config: { farming: config } });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 20, y: 15 });
  services.inventory.add('player', 'wheat_seed', 3);
  services.inventory.add('player', 'carrot_seed', 2);
  const fb = [];
  e.events.on('farming:feedback', (x) => fb.push(x));
  return { e, s: services, fb, plot: () => services.entities.byKind('plot')[0] };
}
const newDay = (s) => s.time.skipDays(1, { offline: false });

test('田出現在地圖上；互動依狀態變化', () => {
  const { e, s, plot } = boot();
  assert.equal(s.entities.byKind('plot').length, 6);
  const p = plot();
  s.entities.move('player', p.x, p.y + 1);
  assert.deepEqual(e.interactionsFor(p.id).map((x) => x.label), ['種小麥種子', '種紅蘿蔔種子']);
  e.runCommand('farming.plant', { plot: p.id, seed: 'wheat_seed' });
  assert.deepEqual(e.interactionsFor(p.id).map((x) => x.label), ['澆水']);
});

test('長大：前一天有澆水才長大一天；小麥要 5 天（1+2+2）；成熟後收成', () => {
  const { e, s, plot, fb } = boot();
  const p = plot(); s.entities.move('player', p.x, p.y + 1);
  e.runCommand('farming.plant', { plot: p.id, seed: 'wheat_seed' });
  assert.equal(e.runCommand('farming.harvest', { plot: p.id }).reason, '還沒成熟，再等幾天');
  newDay(s); // 沒澆水：不長
  assert.deepEqual([s.entities.get(p.id).state.stage, s.entities.get(p.id).state.days], [0, 0]);
  for (let d = 0; d < 5; d++) {
    assert.equal(e.runCommand('farming.water', { plot: p.id }).ok, true);
    assert.equal(e.runCommand('farming.water', { plot: p.id }).reason, '今天已經澆過水了');
    newDay(s);
  }
  assert.equal(s.entities.get(p.id).state.ready, true);
  assert.match(fb.at(-1).text, /成熟了/);
  assert.deepEqual(e.interactionsFor(p.id).map((x) => x.label), ['收成小麥']);
  assert.equal(e.runCommand('farming.harvest', { plot: p.id }).ok, true);
  assert.equal(s.inventory.count('player', 'wheat'), 2);
  assert.equal(s.entities.get(p.id).state.crop, null);
  assert.equal(fb.at(-1).kind, 'complete');
});

test('季節：紅蘿蔔夏天不能種，會說明哪些季節可以；不會因為換季枯死', () => {
  const { e, s, plot } = boot(['farming'], { time: { startSeason: 'summer' } });
  const p = plot(); s.entities.move('player', p.x, p.y + 1);
  assert.equal(e.runCommand('farming.plant', { plot: p.id, seed: 'carrot_seed' }).reason, '紅蘿蔔不適合在夏天種，春、秋天才可以');
  assert.equal(e.runCommand('farming.plant', { plot: p.id, seed: 'wheat_seed' }).ok, true);
  s.time.skipDays(14, { offline: false }); // 換到秋天、冬天
  assert.equal(s.entities.get(p.id).state.crop, 'wheat', '作物還在，沒有枯死');
});

test('下雨：所有田自動澆好水；不管下雨事件比換日早到或晚到都一樣', () => {
  for (const order of ['rainFirst', 'dayFirst']) {
    const { e, s, plot } = boot();
    const p = plot(); s.entities.move('player', p.x, p.y + 1);
    e.runCommand('farming.plant', { plot: p.id, seed: 'wheat_seed' });
    const rain = () => e.events.emit('weather-seasons:weatherChanged', { weather: 'rain', day: s.time.day });
    // 今天下雨 → 明天開始時長大一天
    if (order === 'rainFirst') { rain(); newDay(s); }            // 第 1 天下雨 → 第 2 天開始長大
    else {                                                         // 換日處理後才收到當天的下雨事件
      e.events.on('core:dayStarted', function once(x) { if (x.day === 2) rain(); });
      newDay(s); newDay(s);                                        // 第 2 天下雨 → 第 3 天開始長大
    }
    assert.equal(s.entities.get(p.id).state.stage, 1, order);
  }
});

test('離線補算：預設當作有人幫忙澆水；可以在世界包關掉', () => {
  const a = boot();
  const p = a.plot(); a.s.entities.move('player', p.x, p.y + 1);
  a.e.runCommand('farming.plant', { plot: p.id, seed: 'wheat_seed' });
  a.s.time.skipDays(5); // offline: true
  assert.equal(a.s.entities.get(p.id).state.ready, true);
  const b = boot(['farming'], { config: { offlineGrowth: false } });
  const q = b.plot(); b.s.entities.move('player', q.x, q.y + 1);
  b.e.runCommand('farming.plant', { plot: q.id, seed: 'wheat_seed' });
  b.s.time.skipDays(5);
  assert.equal(b.s.entities.get(q.id).state.stage, 0);
});

test('居民會幫忙澆水（規則腦建議、以 AI 身分執行）', () => {
  const { e, s, plot } = boot(['farming', 'residents']);
  const p = plot(); s.entities.move('player', p.x, p.y + 1);
  e.runCommand('farming.plant', { plot: p.id, seed: 'wheat_seed' });
  s.entities.move('resident.afu', p.x + 1, p.y);
  const afu = e._apis.get('residents').get('afu'); afu.walkTo = null; afu.pauseUntil = 1e9;
  const runs = [];
  e.events.on('core:commandRun', (x) => runs.push(x));
  for (let i = 0; i < 200 && !runs.some((r) => r.id === 'farming.water'); i++) e.update(0.1);
  const w = runs.find((r) => r.id === 'farming.water');
  assert.deepEqual([w.source, w.actor, w.ok], ['ai', 'afu', true]);
});

test('存讀檔與關掉模組：田的狀態保留', () => {
  const a = boot();
  const p = a.plot(); a.s.entities.move('player', p.x, p.y + 1);
  a.e.runCommand('farming.plant', { plot: p.id, seed: 'carrot_seed' });
  const save = a.e.serializeAll();
  const off = boot([]);
  off.e.deserializeAll(save);
  assert.equal(off.s.entities.byKind('plot').length, 0);
  const b = boot();
  b.e.deserializeAll(off.e.serializeAll());
  assert.equal(b.s.entities.get(p.id).state.crop, 'carrot');
});
