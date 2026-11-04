// 製作瀏覽器實測：製作面板按下去 → 進度條 → 做好；工作台在地圖上。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const C = '[data-panel="crafting.recipes"]';

test('製作木板、在工作台做籬笆', async () => {
  const page = await env.newPage('/?new=1&seed=4');
  await env.waitRunning(page);
  await page.evaluate(() => { window.__tm.services.inventory.add('player', 'wood', 6); }); // 不暫停：時間暫停時動作也會停
  await page.waitForSelector(`${C} button:has-text("木板")`);
  await page.click(`${C} button:has-text("木板")`);
  await page.waitForSelector('#feedback .fb:has-text("做好了：木板 ×1")');
  await page.click(`${C} button:has-text("木板")`);
  await page.waitForSelector('#feedback .fb:has-text("做好了：木板")');
  await page.waitForTimeout(1300);
  await page.waitForSelector(`${C} button:has-text("籬笆"):not([disabled])`);
  await page.click(`${C} button:has-text("籬笆")`);
  await page.waitForFunction(() => window.__tm.services.inventory.count('player', 'fence') === 1, null, { timeout: 15000 });
  await page.screenshot({ path: join(SHOTS, 'pr13-crafting.png') });
  assert.deepEqual(benign(page.errors), []);
});
