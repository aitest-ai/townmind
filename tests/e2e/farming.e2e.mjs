// 耕作瀏覽器實測：走到田邊播種、澆水、過幾天成熟、收成；畫面上看得到作物長大。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));

test('播種 → 澆水 → 長大 → 收成', async () => {
  const page = await env.newPage('/?new=1&seed=4');
  await env.waitRunning(page);
  await page.evaluate(() => { const t = window.__tm; t.services.time.pause(); t.services.entities.move('player', 20, 15.2); });
  await page.waitForSelector('#hud button:has-text("種小麥種子")');
  await page.click('#hud button:has-text("種小麥種子")');
  await page.waitForSelector('#hud button:has-text("澆水")');
  await page.click('#hud button:has-text("澆水")');
  await page.waitForSelector('#feedback .fb:has-text("澆好水了")');
  // 在其他田也種下，然後每天澆水、過 5 天
  await page.evaluate(() => {
    const t = window.__tm, plots = t.services.entities.byKind('plot');
    for (const p of plots.slice(1, 4)) { t.services.entities.move('player', p.x, p.y + 1); t.engine.runCommand('farming.plant', { plot: p.id, seed: 'wheat_seed' }); }
    t.services.entities.move('player', 20, 15.2);
    t.services.time.skipDays(2, { offline: false });
    for (const p of plots.slice(0, 4)) { t.services.entities.move('player', p.x, p.y + 1); t.engine.runCommand('farming.water', { plot: p.id }); }
    t.services.entities.move('player', 20, 15.2);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, 'pr15-farming-growing.png') });
  await page.evaluate(() => {
    const t = window.__tm, plots = t.services.entities.byKind('plot').slice(0, 4);
    for (let d = 0; d < 4; d++) {
      t.services.time.skipDays(1, { offline: false });
      for (const p of plots) { t.services.entities.move('player', p.x, p.y + 1); t.engine.runCommand('farming.water', { plot: p.id }); }
    }
    t.services.time.skipDays(1, { offline: false });
    const p0 = t.services.entities.byKind('plot')[0];
    t.services.entities.move('player', p0.x, p0.y + 1.1);
  });
  await page.waitForSelector('#hud button:has-text("收成小麥")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'pr15-farming-ready.png') });
  await page.click('#hud button:has-text("收成小麥")');
  await page.waitForSelector('#feedback .fb:has-text("收成了")');
  assert.match(await page.textContent('[data-panel="shell.bag"]'), /小麥 × 2/);
  assert.deepEqual(benign(page.errors), []);
});
