// 天氣與季節：每天天氣（依季節、可重現）、預報、換季提醒、下雨讓田自動澆水、關掉天氣季節照樣運作。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices, validatePack } from '../src/core/index.js';
import weather from '../src/modules/weather-seasons/index.js';
import farming from '../src/modules/farming/index.js';
import { readPackDir, readCatalog, readSchemas, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
function boot(enabled = ['weather-seasons', 'farming'], seed = 3, data = island) {
  const services = createCoreServices(data);
  const e = new Engine({ data, services, seed });
  e.register(weather).register(farming);
  e.start({ enabled, config: { farming: { offlineGrowth: false } } });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 20, y: 15 });
  const events = [], fb = [];
  e.events.on('weather-seasons:weatherChanged', (x) => events.push(x));
  e.events.on('weather-seasons:feedback', (x) => fb.push(x));
  e.update(0);
  return { e, s: services, events, fb, api: e._apis.get('weather-seasons') };
}

test('第一天就有天氣與明天預報；面板顯示', () => {
  const { e, events, api } = boot();
  assert.equal(events.length, 1);
  assert.ok(api.current() && api.tomorrow());
  assert.match(JSON.stringify(e.renderPanel('weather-seasons.today')), /今天（春天）.*明天/);
});

test('可重現：同一個種子，30 天的天氣一模一樣；預報就是隔天的天氣', () => {
  const run = () => { const b = boot(); for (let i = 0; i < 30; i++) b.s.time.skipDays(1, { offline: false }); return b.events.map((x) => x.weather); };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  const c = boot();
  for (let i = 0; i < 10; i++) { const f = c.api.tomorrow(); c.s.time.skipDays(1, { offline: false }); assert.equal(c.api.current(), f); }
});

test('依季節：冬天會下雪、夏天不會；換季時發提醒', () => {
  const b = boot(['weather-seasons'], 7);
  const seen = {};
  for (let i = 0; i < 28 * 3; i++) { b.s.time.skipDays(1, { offline: false }); (seen[b.s.time.season] ||= new Set()).add(b.api.current()); }
  assert.ok(seen.winter.has('snow'));
  assert.equal(seen.summer.has('snow'), false);
  assert.ok(b.fb.some((x) => x.kind === 'unlock' && /夏天到了/.test(x.text)));
});

test('下雨：田自動澆水（耕作只聽事件）', () => {
  const b = boot();
  const p = b.s.entities.byKind('plot')[0];
  b.s.inventory.add('player', 'wheat_seed', 1);
  b.s.entities.move('player', p.x, p.y + 1);
  b.e.runCommand('farming.plant', { plot: p.id, seed: 'wheat_seed' });
  // 一直過日子直到某天下雨
  for (let i = 0; i < 40 && b.api.current() !== 'rain'; i++) b.s.time.skipDays(1, { offline: false });
  assert.equal(b.api.current(), 'rain');
  assert.equal(b.s.entities.get(p.id).state.wateredDay, b.s.time.day);
  assert.match(b.fb.filter((x) => /下雨/.test(x.text)).at(-1).text, /田會自己喝水/);
});

test('關掉天氣：季節照樣運作，耕作照樣看季節', () => {
  const b = boot(['farming']);
  b.s.time.skipDays(7, { offline: false });
  assert.equal(b.s.time.season, 'summer');
  const p = b.s.entities.byKind('plot')[0];
  b.s.inventory.add('player', 'carrot_seed', 1);
  b.s.entities.move('player', p.x, p.y + 1);
  assert.match(b.e.runCommand('farming.plant', { plot: p.id, seed: 'carrot_seed' }).reason, /不適合在夏天種/);
});

test('存讀檔：今天與明天的天氣保留；讀檔時安靜地通知其他模組', () => {
  const a = boot();
  a.s.time.skipDays(3, { offline: false });
  const b = boot();
  b.e.deserializeAll(a.e.serializeAll());
  assert.equal(b.api.current(), a.api.current());
  assert.equal(b.api.tomorrow(), a.api.tomorrow());
  assert.equal(b.events.at(-1).offline, true);
});

test('資料檢查：沒定義的天氣、錯的季節名稱', async () => {
  const bad = { ...island, weather: { types: { sunny: { name: '晴天' } }, seasons: { spring: { storm: 2 }, monsoon: { sunny: 1 } } } };
  const msgs = validatePack(bad, await readCatalog(), await readSchemas()).errors.map((x) => x.message).join('\n');
  assert.match(msgs, /沒定義的天氣「storm」/);
  assert.match(msgs, /季節「monsoon」不合法/);
});
