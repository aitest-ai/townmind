// 好感度與送禮：打招呼、送禮（喜歡的東西更多、一天一次）、小請求（範本、過期沒懲罰）、升級解鎖、不接 AI。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices } from '../src/core/index.js';
import social from '../src/modules/social/index.js';
import residents from '../src/modules/residents/index.js';
import quests from '../src/modules/quests/index.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
function boot({ enabled = ['social', 'residents', 'quests'], config = {}, seed = 2 } = {}) {
  const services = createCoreServices(island);
  const e = new Engine({ data: island, services, seed });
  e.register(social).register(residents).register(quests);
  e.start({ enabled, config: { social: config }, cascade: true });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 16, y: 13 });
  services.time.pause();
  const fb = [];
  e.events.on('social:feedback', (x) => fb.push(x));
  e.update(0);
  const goTo = (who) => { const r = services.entities.get(`resident.${who}`); services.entities.move('player', r.x + 1, r.y); };
  return { e, s: services, fb, api: e._apis.get('social'), goTo };
}

test('送禮：喜歡的東西 +10、一般 +4；一天一次；居民用範本回應（頭上的氣泡）', () => {
  const { e, s, api, fb, goTo } = boot({ config: { requestChance: 0 } });
  s.inventory.add('player', 'apple', 2); s.inventory.add('player', 'wood', 1);
  goTo('laoju');
  assert.equal(e.runCommand('social.gift', { who: 'laoju', item: 'apple' }).result.liked, true);
  assert.equal(api.points('laoju'), 10);
  assert.match(s.entities.get('resident.laoju').state.say, /蘋果/);
  assert.match(fb.at(-1).text, /老橘超喜歡/);
  assert.match(e.runCommand('social.gift', { who: 'laoju', item: 'wood' }).reason, /今天已經收過禮物了/);
  goTo('afu');
  e.runCommand('social.gift', { who: 'afu', item: 'wood' });
  assert.equal(api.points('afu'), 4);
  s.inventory.add('player', 'axe', 1);
  goTo('damu');
  assert.equal(e.runCommand('social.gift', { who: 'damu', item: 'axe' }).reason, '工具不能送人喔');
});

test('打招呼：每天第一次 +2', () => {
  const { e, s, api, goTo } = boot({ config: { requestChance: 0 } });
  goTo('ashi');
  e.runCommand('residents.greet', { who: 'ashi' }); e.runCommand('residents.greet', { who: 'ashi' });
  assert.equal(api.points('ashi'), 2);
  s.time.skipDays(1, { offline: false });
  e.runCommand('residents.greet', { who: 'ashi' });
  assert.equal(api.points('ashi'), 4);
});

test('升級：到「朋友」發回饋；到「好朋友」用任務旗標解鎖（friend.<id>）', () => {
  const { e, s, api, fb, goTo } = boot({ config: { requestChance: 0 } });
  goTo('laoju');
  for (let d = 0; d < 5; d++) { s.inventory.add('player', 'apple', 1); e.runCommand('social.gift', { who: 'laoju', item: 'apple' }); s.time.skipDays(1, { offline: false }); }
  assert.equal(api.levelName('laoju'), '好朋友');
  assert.ok(fb.some((x) => x.kind === 'unlock' && /變成「朋友」/.test(x.text)));
  assert.equal(e._apis.get('quests').hasFlag('friend.laoju'), true);
});

test('小請求：用範本提出、交東西完成 +8、兩天沒完成就安靜消失（不扣好感度）；同時最多 2 個', () => {
  const { e, s, api, fb, goTo } = boot({ config: { requestChance: 1 } });
  const reqs = api.requests();
  assert.equal(reqs.length, 2);
  assert.ok(fb.some((x) => x.kind === 'progress' && /可以幫忙嗎|就太好了/.test(x.text)));
  const r = reqs[0];
  goTo(r.who);
  assert.match(e.runCommand('social.fulfill', { who: r.who }).reason, /還需要/);
  s.inventory.add('player', r.item, r.qty);
  assert.equal(e.runCommand('social.fulfill', { who: r.who }).ok, true);
  assert.equal(api.points(r.who), 8);
  assert.equal(fb.filter((x) => x.kind === 'complete').length, 1);
  const before = api.points(reqs[1].who);
  s.time.skipDays(2, { offline: false });
  assert.equal(api.points(reqs[1].who), before, '沒完成也不扣');
  assert.ok(!api.requests().some((x) => x.who === reqs[1].who && x.day === reqs[1].day), '舊的請求消失了');
});

test('不接 AI：所有對話都來自範本（沒有網路請求）', () => {
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = () => { n++; throw new Error('不應連網'); };
  try {
    const { e, s, goTo } = boot({ config: { requestChance: 1 } });
    s.inventory.add('player', 'apple', 1); goTo('laoju');
    e.runCommand('social.gift', { who: 'laoju', item: 'apple' });
    s.time.skipDays(3, { offline: false });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(n, 0);
});

test('需要居民模組：關掉居民時好感度也一起關掉並說明；存檔保留', () => {
  const a = boot({ config: { requestChance: 0 } });
  a.s.inventory.add('player', 'apple', 1); a.goTo('laoju');
  a.e.runCommand('social.gift', { who: 'laoju', item: 'apple' });
  const save = a.e.serializeAll();
  const services = createCoreServices(island);
  const e = new Engine({ data: island, services, labels: { residents: '居民', social: '好感度' } });
  e.register(social).register(residents).register(quests);
  const r = e.start({ enabled: ['social', 'quests'], cascade: true });
  assert.match(r.notices[0].message, /因為「居民」沒有開啟，「好感度」也一起關掉了/);
  e.deserializeAll(save);
  assert.deepEqual(e.serializeAll().modules.social, save.modules.social);
});
