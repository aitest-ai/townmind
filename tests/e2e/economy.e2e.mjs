// 經濟瀏覽器實測：走到商店、賣木頭、買種子。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const S = '[data-panel="economy.shop"]';

test('在雜貨店賣木頭、買種子', async () => {
  const page = await env.newPage('/?new=1&seed=6');
  await env.waitRunning(page);
  await page.evaluate(() => { const t = window.__tm; t.services.inventory.add('player', 'wood', 5); t.player.setTarget(19, 19.2); });
  await page.waitForFunction(() => !window.__tm.player.moving, null, { timeout: 15000 });
  await page.waitForSelector(`${S}:has-text("歡迎光臨")`);
  await page.click(`${S} button:has-text("賣木頭")`);
  await page.waitForSelector('#feedback .fb:has-text("得到 5 貝幣")');
  await page.click(`${S} button:has-text("買小麥種子")`);
  await page.waitForSelector(`${S}:has-text("47")`);
  await page.screenshot({ path: join(SHOTS, 'pr17-shop.png') });
  assert.deepEqual(benign(page.errors), []);
});
