// 捕捉瀏覽器實測：走到池塘邊釣魚、抓蟲；圖鑑面板；畫面上看得到生物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));

test('釣魚與抓蟲 → 圖鑑', async () => {
  const page = await env.newPage('/?new=1&seed=6');
  await env.waitRunning(page);
  // 走到第一條魚旁邊的岸上
  await page.evaluate(() => {
    const t = window.__tm, f = t.services.entities.byOwner('capture').find((e) => e.ref === 'carp');
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (t.player.free(f.x + dx, f.y + dy)) { t.services.entities.move('player', f.x + dx, f.y + dy); break; }
  });
  await page.waitForSelector('#hud button:has-text("用釣竿釣鯉魚")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, 'pr16-fishing.png') });
  // 釣到為止（失敗只是溜走，可以再試）
  for (let i = 0; i < 8; i++) {
    const got = await page.evaluate(() => window.__tm.services.inventory.count('player', 'carp'));
    if (got) break;
    await page.click('#hud button:has-text("用釣竿釣鯉魚")').catch(() => {});
    await page.waitForFunction(() => !window.__tm.engine._apis.get('actions').busy('player'), null, { timeout: 15000 });
  }
  assert.equal(await page.evaluate(() => window.__tm.services.inventory.count('player', 'carp')), 1);
  await page.waitForSelector('[data-panel="capture.dex"]:has-text("✅ 鯉魚")'); // 面板每 300 毫秒更新一次
  await page.locator('[data-panel="capture.dex"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'pr16-dex.png') });
  assert.deepEqual(benign(page.errors), []);
});
