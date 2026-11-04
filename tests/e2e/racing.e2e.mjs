// 競速瀏覽器實測：走到起跑門 → 參加比賽 → 倒數 → 跑完兩圈（測試用自動駕駛）→ 名次；時間挑戰有幽靈。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));

// 測試用的自動駕駛：把外殼的輸入換成「朝下一個檢查點」
const AUTOPILOT = () => {
  const t = window.__tm, api = t.engine._apis.get('racing'), T = t.data.tracks[0];
  t.services.input.vector = () => {
    const st = api.state(); if (!st || st.countdown > 0) return { x: 0, y: 0 };
    const p = st.racers[0], cps = [...T.checkpoints, T.start], c = cps[p.next] ?? T.start;
    const dx = c.x - p.x, dy = c.y - p.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };
  t.services.input.cameraAngle = () => 0;
};

test('參加比賽 → 跑完 → 名次', async () => {
  const page = await env.newPage('/?new=1&seed=2');
  await env.waitRunning(page);
  await page.evaluate(() => { const T = window.__tm.data.tracks[0]; window.__tm.services.entities.move('player', T.start.x + 1, T.start.y); });
  await page.waitForSelector('#hud button:has-text("參加比賽：小島環島賽")');
  await page.evaluate(AUTOPILOT);
  await page.click('#hud button:has-text("參加比賽：小島環島賽")');
  await page.waitForSelector('[data-panel="racing.hud"]:has-text("倒數")');
  await page.waitForFunction(() => window.__tm.engine._apis.get('racing').state()?.racers[0].next >= 2, null, { timeout: 60000 });
  await page.screenshot({ path: join(SHOTS, 'pr20-race-3d.png') });
  await page.waitForFunction(() => !window.__tm.engine._apis.get('racing').racing(), null, { timeout: 180000 });
  const fb = await page.evaluate(() => window.__tm.feedback.filter((f) => f.module === 'racing').map((f) => f.text));
  assert.ok(fb.some((t) => /第 \d 名！用了/.test(t)), fb.join(' / '));
  await page.screenshot({ path: join(SHOTS, 'pr20-race-finish.png') });
  assert.deepEqual(benign(page.errors), []);
});

test('時間挑戰兩次：第二次有幽靈（2D）', async () => {
  const page = await env.newPage('/?new=1&seed=2&view=2d');
  await env.waitRunning(page);
  await page.evaluate(AUTOPILOT);
  for (let round = 0; round < 2; round++) {
    await page.evaluate(() => { const t = window.__tm, T = t.data.tracks[0]; t.services.entities.move('player', T.start.x + 1, T.start.y); t.engine.runCommand('racing.start', { track: T.id, mode: 'time' }); });
    if (round === 1) {
      await page.waitForFunction(() => window.__tm.engine._apis.get('racing').state()?.racers[0].next >= 2, null, { timeout: 60000 });
      assert.ok(await page.evaluate(() => !!window.__tm.services.entities.get('race.ghost')));
      await page.screenshot({ path: join(SHOTS, 'pr20-ghost-2d.png') });
    }
    await page.waitForFunction(() => !window.__tm.engine._apis.get('racing').racing(), null, { timeout: 180000 });
  }
  assert.ok(await page.evaluate(() => window.__tm.engine._apis.get('racing').record('island_loop').time > 0));
});
