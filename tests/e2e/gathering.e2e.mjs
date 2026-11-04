// PR6 瀏覽器實測：走到樹旁邊砍樹、背包增加、樹變小；關掉採集後樹與面板消失。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));

test('採集：走近橡樹 → 「砍樹」按鈕 → 得到木頭；採過的樹變小並寫出何時恢復', async () => {
  const page = await env.newPage('/?new=1&seed=3');
  await env.waitRunning(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, 'pr6-island-trees-3d.png') });
  // 走到 (12,10) 那棵橡樹旁邊：用點地面的方式移動（先找到可走的格子）
  await page.evaluate(() => { window.__tm.player.setTarget(13, 11); });
  await page.waitForFunction(() => !window.__tm.player.moving, null, { timeout: 15000 });
  await page.waitForSelector('#hud button:has-text("砍樹")');
  await page.screenshot({ path: join(SHOTS, 'pr6-chop-button.png') });
  await page.click('#hud button:has-text("砍樹")');
  // 開了「行動與工具」：砍樹要花一點時間，畫面上方有進度條
  await page.waitForSelector('[data-panel="actions.progress"] .p-bar');
  await page.screenshot({ path: join(SHOTS, 'pr11-action-progress.png') });
  await page.waitForFunction(() => /你砍了橡樹，得到 木頭 ×3/.test(document.getElementById('log').textContent), null, { timeout: 15000 });
  await page.waitForSelector('#feedback .fb:has-text("得到 木頭 ×3")');
  await page.screenshot({ path: join(SHOTS, 'pr11-feedback.png') });
  assert.match(await page.textContent('[data-panel="shell.bag"]'), /木頭 × 3/);
  assert.match(await page.textContent('[data-panel="gathering.status"]'), /橡樹：可以採 11／12/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'pr6-after-chop.png') });
  assert.deepEqual(benign(page.errors), []);
});

test('2D 畫面也看得到樹、石頭、貝殼', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, 'pr6-island-2d.png') });
});

test('?mods=gathering=off：樹、按鈕、面板都消失；開回來時之前砍過的樹仍是砍過的', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.evaluate(() => {
    const t = window.__tm; const oak = t.services.entities.all().find((e) => e.ref === 'oak');
    t.services.entities.move('player', oak.x + 1, oak.y);
    t.engine.runCommand('gathering.harvest', { target: oak.id });
  });
  await page.waitForFunction(() => window.__tm.services.entities.all().some((e) => e.ref === 'oak' && e.state.depleted), null, { timeout: 15000 });
  await page.evaluate(() => window.__tm.saveNow());
  await page.goto(env.base + '/?view=2d&mods=gathering=off');
  await env.waitRunning(page);
  const off = await page.evaluate(() => window.__tm.services.entities.all().filter((e) => e.owner === 'gathering').length);
  assert.equal(off, 0);
  assert.equal(await page.$('[data-panel="gathering.status"]'), null);
  await page.screenshot({ path: join(SHOTS, 'pr6-gathering-off.png') });
  await page.evaluate(() => window.__tm.saveNow());
  await page.goto(env.base + '/?view=2d');
  await env.waitRunning(page);
  const depleted = await page.evaluate(() => window.__tm.services.entities.all().filter((e) => e.owner === 'gathering' && e.state.depleted).map((e) => e.ref));
  assert.deepEqual(depleted, ['oak']);
});
