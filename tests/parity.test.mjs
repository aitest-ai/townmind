// PR4（WP0a）：遷移後的 crowd／residents 模組和舊原型（legacy/）逐步比對；?mods=crowd=off 的行為；存讀檔。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as legacyWorld from '../legacy/world.js';
import { mockDecide } from '../legacy/brain.js';
import { DEFAULT_NPCS } from '../legacy/npcs.js';
import { Engine, createCoreServices, validatePack } from '../src/core/index.js';
import crowd, { crowdAdvice } from '../src/modules/crowd/index.js';
import residents from '../src/modules/residents/index.js';
import { validateDecision } from '../src/modules/residents/prompt.js';
import { readPackDir, readCatalog, readSchemas, ROOT } from '../scripts/pack-io.mjs';
import { join } from 'node:path';

const town = await readPackDir(join(ROOT, 'data/worldpacks/prototype-town'));

function boot(enabled, { data = town, seed = 1 } = {}) {
  const services = createCoreServices(data);
  const logs = [];
  services.notify = (t) => logs.push(t);
  const e = new Engine({ data, services, seed });
  e.register(residents).register(crowd);
  const cfg = Object.fromEntries(Object.entries(data.pack.modules).map(([k, v]) => [k, v.config]));
  e.start({ enabled, config: cfg, cascade: true });
  return { e, services, logs };
}

test('prototype-town 世界包通過驗證', async () => {
  const r = validatePack(town, await readCatalog(), await readSchemas());
  assert.deepEqual(r.errors, []);
});

test('小人模擬：同樣的步驟與派工，和舊原型的數值完全一致', () => {
  const legacy = legacyWorld.createWorld(7, 24);
  const { e } = boot(['crowd']);
  const w = e._apis.get('crowd').world();
  const plan = { 100: ['gather_wood', 6], 400: ['build', 5], 900: ['rest', 3], 1500: ['gather_food', 4] };
  for (let i = 0; i < 2400; i++) { // 2400 步 × 0.05 秒 = 2 分鐘
    if (plan[i]) {
      legacyWorld.assignWorkers(legacy, ...plan[i]);
      assert.equal(e.runCommand('crowd.assign', { task: plan[i][0], count: plan[i][1] }).ok, true);
    }
    legacyWorld.stepWorld(legacy, 0.05);
    e.update(0.05);
  }
  assert.deepEqual(legacyWorld.snapshot(w), legacyWorld.snapshot(legacy));
  assert.deepEqual(w.workers.map((k) => [k.task, k.state, +k.x.toFixed(6), +k.y.toFixed(6)]), legacy.workers.map((k) => [k.task, k.state, +k.x.toFixed(6), +k.y.toFixed(6)]));
  assert.ok(legacy.houses.length >= 1, '兩分鐘內至少蓋好一間房子（確認比對有意義）');
});

test('規則腦：同樣的狀態，建議的派工和舊原型 mockDecide 一樣', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 400; i++) {
    const snap = {
      time: Math.floor(rnd() * 600), food: Math.floor(rnd() * 80), wood: Math.floor(rnd() * 30), mood: Math.floor(rnd() * 100),
      houses: 3, maxHouses: 10, siteProgress: rnd() < 0.7 ? 2 : null, siteNeed: 10,
      workers: { idle: Math.floor(rnd() * 8), gather_food: Math.floor(rnd() * 8), gather_wood: Math.floor(rnd() * 8), build: Math.floor(rnd() * 8), rest: Math.floor(rnd() * 8) },
    };
    const memory = rnd() < 0.3 ? [{ t: snap.time - 10, kind: 'announce', text: ['大家來蓋房子', '好餓喔', '休息一下吧', '多砍點木頭'][i % 4] }] : [];
    for (const npc of DEFAULT_NPCS) {
      const old = mockDecide(npc, snap, memory);
      const now = crowdAdvice(snap, npc.card.bias, memory);
      if (old.action.type === 'wait') assert.equal(now, null);
      else assert.deepEqual([now.task, now.count, now.say], [old.action.task, old.action.count, old.say]);
    }
  }
});

test('居民用規則腦派工：只透過 AI 身分執行，事件紀錄寫出誰派了誰', () => {
  const { e, logs } = boot(['residents', 'crowd']);
  const seen = [];
  e.events.on('core:commandRun', (x) => seen.push(x));
  for (let i = 0; i < 400; i++) e.update(0.05); // 20 秒
  const ai = seen.filter((x) => x.source === 'ai');
  assert.ok(ai.length >= 1, `居民應該至少派工一次，實際 ${ai.length}`);
  assert.ok(ai.every((x) => x.id === 'crowd.assign' && x.ok));
  assert.ok(logs.some((t) => /派了 \d+ 人去/.test(t)), logs.join('\n'));
  const say = e.services.entities.get('resident.afu').state.say;
  assert.ok(say.length > 0);
});

test('?mods=crowd=off：小人群完全消失、AI 行動清單與提示詞不再提到派人、面板消失、存檔保留', () => {
  const on = boot(['residents', 'crowd']);
  for (let i = 0; i < 100; i++) on.e.update(0.05);
  const save = on.e.serializeAll();
  const promptOn = on.e._apis.get('residents').promptFor('afu');
  assert.match(promptOn.user, /crowd\.assign/);
  assert.match(promptOn.user, /小人分工/);

  const off = boot(['residents']);
  off.e.deserializeAll(save);
  assert.equal(off.services.entities.all().filter((x) => x.owner === 'crowd').length, 0);
  assert.equal(off.e.commands.describeForAI({ actor: 'afu' }).length, 0);
  const p = off.e._apis.get('residents').promptFor('afu');
  assert.doesNotMatch(p.user, /crowd|派|小人/);
  assert.deepEqual(off.e.listPanels().map((x) => x.id).sort(), ['residents.card', 'residents.list']);
  for (let i = 0; i < 400; i++) off.e.update(0.05);
  assert.ok(off.services.entities.get('resident.laoju').state.say); // 沒有事情可派，居民照樣生活（說口頭禪）
  // 存檔裡的小人資料原封不動；再開回來還在
  assert.deepEqual(off.e.serializeAll().modules.crowd, save.modules.crowd);
  const back = boot(['residents', 'crowd']);
  back.e.deserializeAll(off.e.serializeAll());
  assert.deepEqual(legacyWorld.snapshot(back.e._apis.get('crowd').world()), legacyWorld.snapshot(on.e._apis.get('crowd').world()));
});

test('存讀檔後繼續跑：結果和沒中斷一樣（亂數狀態也有存）', () => {
  const a = boot(['residents', 'crowd'], { seed: 9 });
  for (let i = 0; i < 300; i++) a.e.update(0.05);
  const mid = a.e.serializeAll();
  for (let i = 0; i < 300; i++) a.e.update(0.05);
  const b = boot(['residents', 'crowd'], { seed: 9 });
  b.e.deserializeAll(mid);
  for (let i = 0; i < 300; i++) b.e.update(0.05);
  const strip = (blob) => JSON.stringify({ ...blob.modules, 'core.rng': null });
  assert.equal(strip(b.e.serializeAll()), strip(a.e.serializeAll()));
});

test('公告：玩家輸入經過濾、會讓居民提早思考；角色卡可改且有長度限制', () => {
  const { e } = boot(['residents', 'crowd']);
  assert.equal(e.runCommand('residents.announce', { text: '笨蛋快去蓋房子' }).code, 'TEXT_REJECTED');
  assert.equal(e.runCommand('residents.announce', { text: '   ' }).ok, false);
  assert.equal(e.runCommand('residents.announce', { text: '大家來蓋房子吧' }).ok, true);
  assert.equal(e._apis.get('residents').get('xiaogai').memory.at(-1).text, '大家來蓋房子吧');
  assert.equal(e.runCommand('residents.editCard', { who: 'afu', field: 'goal', value: '種出全島最大的南瓜' }).ok, true);
  assert.equal(e._apis.get('residents').get('afu').card.goal, '種出全島最大的南瓜');
  assert.equal(e.runCommand('residents.editCard', { who: 'nobody', field: 'goal', value: 'x' }).ok, false);
  // AI 不能發公告或改角色卡
  assert.equal(e.commands.run('residents.announce', { text: 'hi' }, { source: 'ai', actor: 'afu' }).code, 'NOT_AI');
});

test('LLM 輸出驗證：不在允許清單的指令一律當成「什麼都不做」', () => {
  const actions = [{ id: 'crowd.assign' }];
  assert.deepEqual(validateDecision({ say: '好', action: { command: 'crowd.assign', args: { task: 'rest', count: 3 } } }, actions), { say: '好', command: 'crowd.assign', args: { task: 'rest', count: 3 } });
  assert.equal(validateDecision({ say: 'x', action: { command: 'core.deleteEverything' } }, actions).command, null);
  assert.equal(validateDecision('亂七八糟', actions).command, null);
  assert.equal(validateDecision({ say: 'x'.repeat(200) }, actions).say.length, 60);
});
