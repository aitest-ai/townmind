// PR5（WP0b）瀏覽器實測：島嶼地圖成為預設、玩家移動（鍵盤、點地面）、不能走進水裡、
// 走近居民出現「打招呼」、存讀檔後位置接續、平板畫面。新的基準截圖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const pos = (page) => page.evaluate(() => { const p = window.__tm.services.entities.get('player'); return { x: p.x, y: p.y }; });

test('島嶼 3D：地形、居民與他們的家、玩家；鏡頭跟著玩家', async () => {
  const page = await env.newPage('/?new=1&seed=11');
  await env.waitRunning(page);
  assert.equal(await page.evaluate(() => window.__tm.view), '3d');
  const s = await page.evaluate(() => ({
    residents: window.__tm.services.entities.byKind('resident').length,
    homes: window.__tm.services.entities.byKind('home').length,
    drawn: window.__tm.views['3d'].debug.objs.size, total: window.__tm.services.entities.all().length,
  }));
  assert.deepEqual([s.residents, s.homes], [5, 5]);
  assert.equal(s.drawn, s.total);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SHOTS, 'pr5-island-3d.png') });
  assert.deepEqual(benign(page.errors), []);
});

test('鍵盤移動；撞到水會停在岸邊', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  const a = await pos(page);
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight');
  const b = await pos(page);
  assert.ok(b.x > a.x + 1, `應該往右走了，${a.x} → ${b.x}`);
  assert.ok(Math.abs(b.y - a.y) < 0.01);
  // 一直往上走：島的北邊是海，最後會停在岸上
  await page.keyboard.down('KeyW'); await page.waitForTimeout(4000); await page.keyboard.up('KeyW');
  const c = await pos(page);
  const ok = await page.evaluate(({ x, y }) => window.__tm.player.free(x, y), c);
  assert.ok(ok, '玩家停在可走的地上');
  assert.ok(c.y < b.y - 3, '有往北走一段');
  assert.ok(c.y > 1, '沒有走進最北邊的海裡');
});

test('點地面走過去（平板觸控）', async () => {
  const page = await env.newPage('/?new=1&view=2d', { width: 820, height: 1180, hasTouch: true, isMobile: true });
  await env.waitRunning(page);
  const target = await page.evaluate(() => {
    const c = document.getElementById('view2d').getBoundingClientRect();
    // 找出格子 (20,15) 在畫面上的位置：反推 toWorld
    const v = window.__tm.views['2d'];
    for (let px = c.left; px < c.right; px += 2) for (let py = c.top; py < c.bottom; py += 2) {
      const w = v.toWorld(px, py);
      if (Math.abs(w.x - 20) < 0.1 && Math.abs(w.y - 15) < 0.1) return { px, py };
    }
    return null;
  });
  assert.ok(target);
  await page.touchscreen.tap(target.px, target.py);
  // 無頭瀏覽器模擬手機時幀率很低，所以等「走到」而不是等固定秒數
  await page.waitForFunction(() => !window.__tm.player.moving, null, { timeout: 15000 });
  const p = await pos(page);
  assert.ok(Math.hypot(p.x - 20, p.y - 15) < 0.3, `走到點的位置附近，實際 (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  await page.screenshot({ path: join(SHOTS, 'pr5-island-tablet-2d.png') });
});

test('走近居民出現「打招呼」按鈕；太遠時指令會說明原因；空白鍵也可以', async () => {
  const page = await env.newPage('/?new=1&seed=4');
  await env.waitRunning(page);
  // 太遠：直接下指令會被擋
  const far = await page.evaluate(() => window.__tm.engine.runCommand('residents.greet', { who: 'afu' }));
  assert.equal(far.ok, false);
  assert.equal(far.reason, '走近一點才能打招呼');
  // 走到老橘身邊（暫停時間，讓他不要散步走開）
  await page.evaluate(() => {
    window.__tm.services.time.pause();
    const r = window.__tm.services.entities.get('resident.laoju');
    window.__tm.services.entities.move('player', r.x + 1, r.y + 0.2);
  });
  await page.waitForSelector('#hud button:has-text("和老橘打招呼")');
  await page.screenshot({ path: join(SHOTS, 'pr5-greet-button.png') });
  await page.click('#hud button:has-text("和老橘打招呼")');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#log'), /💬 老橘：/);
  const say = await page.evaluate(() => window.__tm.services.entities.get('resident.laoju').state.say);
  assert.ok(say.length > 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'pr5-greet.png') });
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  assert.equal((await page.textContent('#log')).match(/💬 老橘：/g).length, 2);
  assert.deepEqual(benign(page.errors), []);
});

test('存讀檔：玩家位置接續', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.evaluate(() => { window.__tm.services.entities.move('player', 20, 12); window.__tm.saveNow(); });
  await page.goto(env.base + '/?view=2d');
  await env.waitRunning(page);
  assert.deepEqual(await pos(page), { x: 20, y: 12 });
});

test('2D 島嶼基準截圖', async () => {
  const page = await env.newPage('/?new=1&seed=11&view=2d');
  await env.waitRunning(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, 'pr5-island-2d.png') });
});
