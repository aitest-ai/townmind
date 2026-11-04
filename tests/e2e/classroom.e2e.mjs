// 課堂模式瀏覽器實測：解鎖老師控制台、關掉打字與調速度、上課倒數、下課大訊息。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const T = '[data-panel="classroom.teacher"]';
// 老師控制台收在「設定」選單裡：先打開設定
const ready = async (page) => { await env.waitRunning(page); await page.click('#settingsBtn'); };

// 第一次使用：設定老師密碼（沒有預設密碼）
async function setPin(page, pin = '2468') {
  await page.fill(`${T} input >> nth=0`, pin);
  await page.fill(`${T} input >> nth=1`, pin);
  await page.click(`${T} button:has-text("設定老師密碼")`);
  await page.waitForSelector(`${T} button:has-text("開始上課計時")`);
}

test('第一次使用：要老師自己設定密碼；0000 不行；設定後重新整理要用新密碼解鎖', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await ready(page);
  assert.match(await page.textContent(T), /第一次使用/);
  await page.locator(T).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'pr9-teacher-first-pin.png') });
  await page.fill(`${T} input >> nth=0`, '0000');
  await page.fill(`${T} input >> nth=1`, '0000');
  await page.click(`${T} button:has-text("設定老師密碼")`);
  await page.waitForSelector('.toast:has-text("太容易被猜到")');
  await setPin(page, '2468');
  await page.goto(env.base + '/?view=2d');
  await ready(page);
  await page.fill(`${T} input`, '2468');
  await page.click(`${T} button:has-text("解鎖")`);
  await page.waitForSelector(`${T} button:has-text("開始上課計時")`);
  // 開新遊戲：密碼還在（和存檔分開）
  await page.goto(env.base + '/?new=1&view=2d');
  await ready(page);
  assert.doesNotMatch(await page.textContent(T), /第一次使用/);
});

test('老師控制台：密碼錯誤說明原因；解鎖後關打字、鎖速度；學生畫面跟著變', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await ready(page);
  assert.ok(await page.isVisible('[data-panel="shell.status"] select >> nth=0'), '一開始學生可以調速度');
  await setPin(page, '2468');
  await page.click(`${T} button:has-text("鎖上控制台")`);
  await page.fill(`${T} input`, '1357');
  await page.click(`${T} button:has-text("解鎖")`);
  await page.waitForSelector('.toast:has-text("密碼不對")');
  await page.fill(`${T} input`, '2468');
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
  // 學生試著發公告（老師先關掉設定選單）
  await page.click('#settingsClose');
  await page.fill('[data-panel="residents.list"] input', '大家好');
  await page.click('[data-panel="residents.list"] button:has-text("發公告")');
  await page.waitForSelector('.toast:has-text("老師暫時關閉了打字")');
  assert.deepEqual(benign(page.errors), []);
});

test('上課倒數：學生看得到剩幾分鐘；快到時提醒；下課時大訊息、全班暫停', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await ready(page);
  await setPin(page, '2468');
  await page.fill(`${T} input >> nth=0`, '8');
  await page.click(`${T} button:has-text("開始上課計時")`);
  await page.click('#settingsClose');
  await page.waitForTimeout(500);
  assert.match(await page.textContent('[data-panel="classroom.lesson"]'), /這節課還剩\s*[78] 分 \d\d 秒/); // 只檢查分鐘：機器忙的時候秒數會差一點
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
  await ready(page);
  assert.equal(await page.$(T), null);
  assert.equal(await page.$('[data-panel="classroom.lesson"]'), null);
  assert.ok(await page.isVisible('[data-panel="shell.status"] select >> nth=0'));
});
