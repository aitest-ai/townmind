// 佈置瀏覽器實測：放家具、旋轉、收起來；2D／3D 都畫得出來。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const B = '[data-panel="building.decorate"]';

test('放椅子、桌子、籬笆 → 旋轉 → 收起來', async () => {
  const page = await env.newPage('/?new=1&seed=4');
  await env.waitRunning(page);
  await page.evaluate(() => {
    const t = window.__tm; t.services.time.pause();
    t.services.entities.move('player', 19, 16);
    for (const it of ['chair', 'table', 'fence', 'fence']) t.services.inventory.add('player', it, 1);
  });
  for (const name of ['椅子', '桌子', '籬笆', '籬笆']) {
    await page.click(`${B} button:has-text("放${name}")`);
    await page.waitForTimeout(150);
  }
  const n = await page.evaluate(() => window.__tm.services.entities.byKind('furniture').length);
  assert.equal(n, 4);
  await page.waitForSelector('#hud button:has-text("旋轉")');
  await page.click('#hud button:has-text("旋轉")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, 'pr14-decorate-3d.png') });
  await page.selectOption('[data-panel="shell.status"] select >> nth=1', '2d');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'pr14-decorate-2d.png') });
  await page.click('#hud button:has-text("收起")');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__tm.services.entities.byKind('furniture').length), 3);
  assert.deepEqual(benign(page.errors), []);
});
