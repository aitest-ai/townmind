// 天氣瀏覽器實測：右側有今天與明天的天氣；過一天天氣跟著變、回饋提示出現。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));

test('天氣面板與每日回饋', async () => {
  const page = await env.newPage('/?new=1&view=2d&seed=9');
  await env.waitRunning(page);
  await page.waitForSelector('[data-panel="weather-seasons.today"]:has-text("今天（春天）")');
  const tomorrow = await page.evaluate(() => window.__tm.engine._apis.get('weather-seasons').tomorrow());
  await page.evaluate(() => window.__tm.services.time.skipDays(1, { offline: false }));
  assert.equal(await page.evaluate(() => window.__tm.engine._apis.get('weather-seasons').current()), tomorrow);
  await page.waitForSelector('#feedback .fb:has-text("今天")');
  await page.screenshot({ path: join(SHOTS, 'pr18-weather.png') });
  assert.deepEqual(benign(page.errors), []);
});
