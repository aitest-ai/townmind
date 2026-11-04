// 課堂模式瀏覽器實測：解鎖老師控制台、關掉打字與調速度、上課倒數、下課大訊息。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const T = '[data-panel="classroom.teacher"]';

test('老師控制台：密碼錯誤說明原因；解鎖後關打字、鎖速度；學生畫面跟著變', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  assert.ok(await page.isVisible('[data-panel="shell.status"] select >> nth=0'), '一開始學生可以調速度');
  await page.fill(`${T} input`, '1234');
  await page.click(`${T} button:has-text("解鎖")`);
  await page.waitForSelector('.toast:has-text("密碼不對")');
  await page.fill(`${T} input`, '0000');
  await page.click(`${T} button:has-text("解鎖")`);
  await page.waitForSelector(`${T} button:has-text("開始上課計時")`);
  await page.click(`${T} button:has-text("學生打字：關")`);
  await page.click(`${T} button:has-text("學生調時間：關")`);
  await page.click(`${T} button:has-text("學生開新遊戲／匯入：關")`);
  await page.waitForTimeout(400);
  assert.match(await page.textContent('[data-panel="shell.status"]'), /老師設定/);
  assert.equal(await page.$('[data-panel="shell.save"] button:has-text("開新遊戲")'), null);
  await page.locator(T).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'pr7-teacher-console.png'), fullPage: true });
  // 學生試著發公告
  await page.fill('[data-panel="residents.list"] input', '大家好');
  await page.click('[data-panel="residents.list"] button:has-text("發公告")');
  await page.waitForSelector('.toast:has-text("老師暫時關閉了打字")');
  assert.deepEqual(benign(page.errors), []);
});

test('上課倒數：學生看得到剩幾分鐘；快到時提醒；下課時大訊息、全班暫停', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.fill(`${T} input`, '0000');
  await page.click(`${T} button:has-text("解鎖")`);
  await page.waitForSelector(`${T} button:has-text("開始上課計時")`);
  await page.fill(`${T} input >> nth=0`, '8');
  await page.click(`${T} button:has-text("開始上課計時")`);
  await page.waitForTimeout(500);
  assert.match(await page.textContent('[data-panel="classroom.lesson"]'), /這節課還剩\s*7 分 5\d 秒|這節課還剩\s*8 分 00 秒/);
  await page.screenshot({ path: join(SHOTS, 'pr7-lesson-countdown.png') });
  await page.evaluate(() => { window.__tm.clockOffset = 3.5 * 60_000; });
  await page.waitForSelector('#banner:has-text("還有 5 分鐘下課")');
  await page.screenshot({ path: join(SHOTS, 'pr7-lesson-warning.png') });
  await page.click('#banner');
  await page.evaluate(() => { window.__tm.clockOffset = 9 * 60_000; });
  await page.waitForSelector('#banner:has-text("下課囉")');
  assert.equal(await page.evaluate(() => window.__tm.services.time.paused), true);
  assert.match(await page.textContent('#log'), /💾 已存檔/);
  await page.screenshot({ path: join(SHOTS, 'pr7-lesson-end.png') });
});

test('?mods=classroom=off：沒有老師面板、沒有限制', async () => {
  const page = await env.newPage('/?new=1&view=2d&mods=classroom=off');
  await env.waitRunning(page);
  assert.equal(await page.$(T), null);
  assert.equal(await page.$('[data-panel="classroom.lesson"]'), null);
  assert.ok(await page.isVisible('[data-panel="shell.status"] select >> nth=0'));
});
