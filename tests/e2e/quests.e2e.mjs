// 任務與成長瀏覽器實測：新任務提示 → 打招呼完成 → 領獎 → 下一個任務、繁榮度增加。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const Q = '[data-panel="quests.list"]';

test('主線：跟村長打招呼 → 領獎 → 下一個任務', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.waitForSelector(`${Q}:has-text("跟村長打招呼")`);
  assert.match(await page.textContent(Q), /小島繁榮度 1 級/);
  await page.evaluate(() => window.__tm.services.time.pause());
  await page.waitForSelector('#hud button:has-text("和老橘打招呼")');
  await page.click('#hud button:has-text("和老橘打招呼")');
  await page.waitForSelector(`${Q} button:has-text("領取獎勵：跟村長打招呼")`);
  await page.screenshot({ path: join(SHOTS, 'pr12-quest-ready.png') });
  await page.click(`${Q} button:has-text("領取獎勵")`);
  // 領獎時會一次開放好幾個新任務，畫面上的回饋小字很快被擠掉：改看外殼的回饋紀錄
  await page.waitForFunction(() => window.__tm.feedback.some((f) => f.module === 'quests' && /領到獎勵/.test(f.text)));
  await page.waitForSelector(`${Q}:has-text("小島的第一份收穫")`);
  assert.match(await page.textContent(Q), /（5 \/ 20）/);
  assert.match(await page.textContent('[data-panel="shell.bag"]'), /蘋果 × 2/);
  await page.screenshot({ path: join(SHOTS, 'pr12-quest-next.png') });
  const fbs = await page.evaluate(() => window.__tm.feedback.filter((f) => f.module === 'quests').map((f) => f.kind));
  assert.deepEqual(fbs.slice(0, 3), ['progress', 'complete', 'success']);
  assert.deepEqual(benign(page.errors), []);
});

test('?mods=gathering=off：需要採集的任務被略過，主線跳到下一個', async () => {
  const page = await env.newPage('/?new=1&view=2d&mods=gathering=off');
  await env.waitRunning(page);
  await page.evaluate(() => { window.__tm.services.time.pause(); });
  await page.waitForSelector('#hud button:has-text("和老橘打招呼")');
  await page.click('#hud button:has-text("和老橘打招呼")');
  await page.click(`${Q} button:has-text("領取獎勵")`);
  await page.waitForSelector(`${Q}:has-text("幫村長準備木頭")`);
  assert.doesNotMatch(await page.textContent(Q), /第一份收穫/);
});
