// 好感度瀏覽器實測：走到居民身邊送禮（喜歡的東西有愛心）、居民頭上回話、好感度增加。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const F = '[data-panel="social.friends"]';

test('送老橘蘋果（他最喜歡的）', async () => {
  const page = await env.newPage('/?new=1&seed=3');
  await env.waitRunning(page);
  await page.evaluate(() => {
    const t = window.__tm; t.services.time.pause();
    t.services.inventory.add('player', 'apple', 1);
    const r = t.services.entities.get('resident.laoju'); t.services.entities.move('player', r.x + 1, r.y);
  });
  await page.waitForSelector(`${F} button:has-text("送老橘蘋果 ❤️")`);
  await page.click(`${F} button:has-text("送老橘蘋果")`);
  await page.waitForSelector('#feedback .fb:has-text("老橘超喜歡")');
  await page.waitForSelector(`${F}:has-text("老橘：點頭之交（10/20）")`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'pr19-gift.png') });
  assert.deepEqual(benign(page.errors), []);
});
