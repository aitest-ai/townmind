// 捕捉：生成位置、收集／抓了放回／拍照三種呈現、失敗只是跑掉、兒童安全、圖鑑、每天補回、存讀檔。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices } from '../src/core/index.js';
import capture from '../src/modules/capture/index.js';
import actions from '../src/modules/actions/index.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function boot({ enabled = ['capture'], data = island, config = {} } = {}) {
  const services = createCoreServices(data);
  const e = new Engine({ data, services, seed: 5 });
  e.register(capture).register(actions);
  e.start({ enabled, config: { capture: config } });
  services.entities.add({ id: 'player', kind: 'player', owner: 'core', x: 16, y: 13 });
  for (const t of ['net', 'rod', 'camera']) services.inventory.add('player', t, 1);
  const fb = [];
  e.events.on('capture:feedback', (x) => fb.push(x));
  e.events.on('actions:feedback', (x) => fb.push(x));
  return { e, s: services, fb };
}
const of = (s, ref) => s.entities.byOwner('capture').filter((x) => x.ref === ref);
const walk = (x, y) => island.island.legend[island.island.terrain[y]?.[x]]?.walkable !== false;
const besideFish = (s, f) => { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (walk(f.x + dx, f.y + dy)) { s.entities.move('player', f.x + dx, f.y + dy); return; } };

test('生成：每個區域 2 隻；魚在靠岸的水面、其他在陸地上', () => {
  const { s } = boot();
  const all = s.entities.byOwner('capture');
  assert.equal(all.length, 6); // forest、pond、meadow 各 2（farmland 沒有生物）
  for (const c of all) {
    const w = walk(c.x, c.y);
    if (c.state.kind === 'fish') assert.equal(w, false, '魚在水裡');
    else assert.equal(w, true, `${c.ref} 在陸地上`);
  }
});

test('收集：用網子抓甲蟲 → 拿到甲蟲、生物消失、圖鑑新發現', () => {
  const { e, s, fb } = boot({ config: { chance: { bug: 1, fish: 1, animal: 1, photo: 1 } } });
  const b = of(s, 'beetle')[0];
  s.entities.move('player', b.state.home.x, b.state.home.y + 1);
  assert.equal(e.interactionsFor(b.id)[0].label, '用捕蟲網抓甲蟲');
  assert.equal(e.runCommand('capture.catch', { target: b.id, tool: 'net' }).ok, true);
  assert.equal(s.inventory.count('player', 'beetle'), 1);
  assert.equal(s.entities.get(b.id), null);
  assert.deepEqual(fb.map((x) => x.kind), ['success', 'unlock']);
  assert.match(fb[1].text, /圖鑑新發現：甲蟲！（1\/4）/);
});

test('拍照：兔子留在原地、拿到照片；抓了放回：不拿東西、兔子跑到別處，圖鑑都會記錄', () => {
  const data = clone(island);
  data.island.regions.find((r) => r.id === 'meadow').spawns = [{ ref: 'rabbit', weight: 1 }];
  const { e, s, fb } = boot({ data, config: { chance: { bug: 1, fish: 1, animal: 1, photo: 1 } } });
  const r = of(s, 'rabbit')[0];
  s.entities.move('player', r.state.home.x, r.state.home.y + 1);
  assert.deepEqual(e.interactionsFor(r.id).map((x) => x.label).sort(), ['用捕蟲網抓兔子', '用相機拍兔子'].sort());
  e.runCommand('capture.catch', { target: r.id, tool: 'camera' });
  assert.equal(s.inventory.count('player', 'rabbit_photo'), 1);
  assert.ok(s.entities.get(r.id), '拍照後兔子還在');
  assert.match(fb[0].text, /拍到了兔子的照片/);
  const before = { ...s.entities.get(r.id).state.home };
  e.runCommand('capture.catch', { target: r.id, tool: 'net' });
  assert.equal(s.inventory.count('player', 'rabbit_photo'), 1, '抓了放回不拿東西');
  assert.match(fb.at(-1).text, /輕輕放牠回去/);
  assert.ok(s.entities.get(r.id), '兔子沒有消失');
  assert.notDeepEqual(s.entities.get(r.id).state.home, before);
  assert.deepEqual(e._apis.get('capture').dex().rabbit.methods.sort(), ['catch_release', 'photo']);
});

test('釣魚要花時間（開著行動模組）；失敗只是溜走，不扣東西', () => {
  const { e, s, fb } = boot({ enabled: ['capture', 'actions'], config: { chance: { fish: 0, bug: 1, animal: 1, photo: 1 } } });
  const f = of(s, 'carp')[0];
  besideFish(s, f);
  assert.match(e.interactionsFor(f.id)[0].label, /用釣竿釣鯉魚/);
  assert.deepEqual(e.runCommand('capture.catch', { target: f.id, tool: 'rod' }).result, { started: true });
  e.update(2.1);
  assert.equal(s.inventory.count('player', 'carp'), 0);
  assert.equal(s.inventory.count('player', 'rod'), 1);
  assert.match(fb.at(-1).text, /鯉魚溜走了，再試一次/);
  assert.ok(s.entities.get(f.id), '魚還在，可以再試');
});

test('兒童安全：就算資料沒有經過檢查、寫了 hunt，兒童版執行時也只會「抓了放回」；一般版當作收集', () => {
  for (const audience of ['children', 'general']) {
    const data = clone(island);
    data.pack.audience = audience;
    data.species.find((x) => x.id === 'beetle').capture.methods[0].presentation = 'hunt';
    const { e, s, fb } = boot({ data, config: { chance: { bug: 1, fish: 1, animal: 1, photo: 1 } } });
    const b = of(s, 'beetle')[0];
    s.entities.move('player', b.state.home.x, b.state.home.y + 1);
    e.runCommand('capture.catch', { target: b.id, tool: 'net' });
    if (audience === 'children') { assert.equal(s.inventory.count('player', 'beetle'), 0); assert.match(fb[0].text, /放牠回去/); }
    else assert.equal(s.inventory.count('player', 'beetle'), 1);
    assert.doesNotMatch(fb.map((x) => x.text).join(''), /殺|死|獵/);
  }
});

test('工具與距離：沒有工具、太遠都會說明；方式不對（相機不能拍魚以外沒有的方式）會拒絕', () => {
  const { e, s } = boot();
  const b = of(s, 'beetle')[0];
  s.entities.move('player', 30, 20);
  assert.equal(e.runCommand('capture.catch', { target: b.id, tool: 'net' }).reason, '走近一點');
  s.inventory.remove('player', 'net', 1);
  s.entities.move('player', b.state.home.x, b.state.home.y + 1);
  assert.equal(e.runCommand('capture.catch', { target: b.id, tool: 'net' }).reason, '需要捕蟲網');
  assert.equal(e.runCommand('capture.catch', { target: b.id, tool: 'rod' }).reason, '不能用釣竿對甲蟲這樣做');
});

test('每天補回生物；圖鑑面板；存讀檔', () => {
  const { e, s } = boot({ config: { chance: { bug: 1, fish: 1, animal: 1, photo: 1 } } });
  const b = of(s, 'beetle')[0];
  s.entities.move('player', b.state.home.x, b.state.home.y + 1);
  e.runCommand('capture.catch', { target: b.id, tool: 'net' });
  const n = s.entities.byOwner('capture').length;
  s.time.skipDays(1, { offline: false });
  assert.equal(s.entities.byOwner('capture').length, n + 1);
  assert.match(JSON.stringify(e.renderPanel('capture.dex')), /已發現 1 \/ 4 種.*✅ 甲蟲/);
  const b2 = boot();
  b2.e.deserializeAll(e.serializeAll());
  assert.equal(b2.e._apis.get('capture').discovered(), 1);
  assert.equal(b2.s.entities.byOwner('capture').length, s.entities.byOwner('capture').length);
});
