// PR4（WP0a）瀏覽器實測：原型小鎮搬進框架後，和 legacy.html 並排截圖比對；crowd=off 時小人消失。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));

async function runFor(page, sec) { await page.waitForTimeout(sec * 1000); }

test('原型小鎮（框架版）3D：24 個小人、5 位居民、倉庫；居民會派工', async () => {
  const page = await env.newPage('/?pack=prototype-town&new=1&seed=7');
  await env.waitRunning(page);
  assert.equal(await page.evaluate(() => window.__tm.status), 'running');
  assert.equal(await page.evaluate(() => window.__tm.view), '3d');
  await page.evaluate(() => window.__tm.services.time.setTimeScale(4));
  await runFor(page, 6);
  const s = await page.evaluate(() => {
    const ents = window.__tm.services.entities.all();
    const objs = window.__tm.views['3d'].debug.objs;
    return {
      workers: ents.filter((e) => e.kind === 'crowd.worker').length,
      residents: ents.filter((e) => e.kind === 'resident').length,
      depot: !!ents.find((e) => e.kind === 'crowd.depot'),
      drawn: objs.size, total: ents.length,
      saying: ents.filter((e) => e.kind === 'resident' && e.state.say).length,
    };
  });
  assert.equal(s.workers, 24);
  assert.equal(s.residents, 5);
  assert.ok(s.depot);
  assert.equal(s.drawn, s.total, '每個實體都有畫出來');
  assert.ok(s.saying >= 1, '至少一位居民說了話');
  assert.match(await page.textContent('#log'), /派了 \d+ 人去|空投|房子/);
  await page.screenshot({ path: join(SHOTS, 'pr4-framework-3d.png') });
  assert.deepEqual(benign(page.errors), []);
});

test('同一個小鎮的舊版原型截圖（並排比對用）', async () => {
  const page = await env.newPage('/legacy.html');
  await page.waitForFunction(() => window.__town?.view3d, null, { timeout: 60000 });
  await page.selectOption('#speed', '4').catch(() => {});
  await runFor(page, 6);
  await page.screenshot({ path: join(SHOTS, 'pr4-legacy-3d.png') });
});

test('原型小鎮（框架版）2D，以及面板操作：空投、發公告', async () => {
  const page = await env.newPage('/?pack=prototype-town&new=1&seed=7&view=2d');
  await env.waitRunning(page);
  await page.click('[data-panel="crowd.town"] button:has-text("空投 20 糧食")');
  await page.fill('[data-panel="residents.list"] input', '大家來蓋房子吧');
  await page.click('[data-panel="residents.list"] button:has-text("發公告")');
  await runFor(page, 2);
  const log = await page.textContent('#log');
  assert.match(log, /天上掉下 20 份糧食/);
  assert.match(log, /你發布公告：大家來蓋房子吧/);
  // 不適合的公告：畫面上說明原因
  await page.fill('[data-panel="residents.list"] input', '笨蛋');
  await page.click('[data-panel="residents.list"] button:has-text("發公告")');
  await page.waitForSelector('.toast:has-text("不適合")');
  await page.screenshot({ path: join(SHOTS, 'pr4-framework-2d.png') });
  assert.deepEqual(benign(page.errors), []);
});

test('?mods=crowd=off：小人、倉庫、小鎮面板全部消失，居民仍在', async () => {
  const page = await env.newPage('/?pack=prototype-town&new=1&mods=crowd=off');
  await env.waitRunning(page);
  await runFor(page, 1);
  const s = await page.evaluate(() => ({
    crowd: window.__tm.services.entities.all().filter((e) => e.owner === 'crowd').length,
    residents: window.__tm.services.entities.byKind('resident').length,
    ai: window.__tm.engine.commands.describeForAI({ actor: 'afu' }).map((c) => c.id),
    prompt: window.__tm.engine._apis.get('residents').promptFor('afu').user,
  }));
  assert.equal(s.crowd, 0);
  assert.equal(s.residents, 5);
  assert.deepEqual(s.ai, []);
  assert.doesNotMatch(s.prompt, /派|小人|crowd/);
  assert.equal(await page.$('[data-panel="crowd.town"]'), null);
  await page.screenshot({ path: join(SHOTS, 'pr4-crowd-off.png') });
});

test('存讀檔：重新整理後小鎮狀態接續', async () => {
  const page = await env.newPage('/?pack=prototype-town&new=1&seed=5&view=2d');
  await env.waitRunning(page);
  await page.evaluate(() => window.__tm.services.time.setTimeScale(8));
  await runFor(page, 3);
  const before = await page.evaluate(() => { window.__tm.services.time.pause(); window.__tm.saveNow(); return window.__tm.engine._apis.get('crowd').snapshot(); });
  await page.goto(env.base + '/?pack=prototype-town&view=2d');
  await env.waitRunning(page);
  const after = await page.evaluate(() => window.__tm.engine._apis.get('crowd').snapshot());
  assert.equal(after.houses, before.houses);
  assert.ok(Math.abs(after.food - before.food) <= 1);
  assert.ok(Math.abs(after.time - before.time) <= 1);
});
