// WP2 瀏覽器實測：觸控搖桿、3D 轉鏡頭後方向跟著轉、點地面繞過水池、房子擋路、鏡頭阻尼。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const pos = (page) => page.evaluate(() => { const p = window.__tm.services.entities.get('player'); return { x: p.x, y: p.y }; });

test('觸控搖桿：平板上出現在左下角；往右推 → 往右走；放開就停', async () => {
  const page = await env.newPage('/?new=1&seed=2', { width: 1180, height: 820, hasTouch: true, isMobile: true });
  await env.waitRunning(page);
  const stick = await page.$('.joystick');
  assert.ok(stick, '平板（觸控）預設顯示搖桿');
  const box = await stick.boundingBox();
  const a = await pos(page);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 40, cy, { steps: 4 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'pr9-joystick-3d.png') });
  await page.waitForTimeout(800);
  await page.mouse.up();
  const b = await pos(page);
  assert.ok(b.x > a.x + 1, `往右走了，${a.x.toFixed(2)} → ${b.x.toFixed(2)}`);
  await page.waitForTimeout(800);
  const c = await pos(page);
  assert.ok(Math.abs(c.x - b.x) < 0.6, '放開後很快停下來');
  assert.deepEqual(benign(page.errors), []);
});

test('3D 轉了鏡頭：按「上」還是往畫面上方（鏡頭前方）走', async () => {
  const page = await env.newPage('/?new=1&seed=2&joystick=0');
  await env.waitRunning(page);
  // 把鏡頭轉到從東邊看（水平角 90 度）：畫面上方 = 地圖的西邊（x 變小）
  await page.evaluate(() => {
    const { camera, controls } = window.__tm.views['3d'].debug;
    const t = controls.target, d = camera.position.distanceTo(t), h = camera.position.y - t.y;
    const r = Math.sqrt(d * d - h * h);
    camera.position.set(t.x + r, camera.position.y, t.z); controls.update();
  });
  const a = await pos(page);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(700); await page.keyboard.up('ArrowUp');
  const b = await pos(page);
  assert.ok(b.x < a.x - 1, `應該往西（x 變小）走，${a.x.toFixed(2)} → ${b.x.toFixed(2)}`);
  assert.ok(Math.abs(b.y - a.y) < 0.4, `y 幾乎不變，${a.y.toFixed(2)} → ${b.y.toFixed(2)}`);
});

test('點地面：自己繞過水池走到對面；目的地有記號、走到就消失', async () => {
  const page = await env.newPage('/?new=1&view=2d&joystick=0');
  await env.waitRunning(page);
  await page.evaluate(() => { window.__tm.services.entities.move('player', 18, 8); window.__tm.player.stop(); });
  const s = await page.evaluate(() => window.__tm.views['2d'].toScreen(27, 9));
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(250);
  const path = await page.evaluate(() => window.__tm.player.path);
  assert.ok(path && path.length >= 2, `會轉彎繞路（路徑點 ${path?.length}）`);
  assert.ok(await page.evaluate(() => !!window.__tm.services.entities.get('shell.marker')), '有目的地記號');
  await page.screenshot({ path: join(SHOTS, 'pr9-path-around-pond.png') });
  await page.waitForFunction(() => !window.__tm.player.moving, null, { timeout: 15000 });
  const p = await pos(page);
  assert.ok(Math.hypot(p.x - 27, p.y - 9) < 0.3, `走到對面，實際 (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  assert.equal(await page.evaluate(() => !!window.__tm.services.entities.get('shell.marker')), false);
  // 點在海中間：走到最近的岸邊；點在被海隔開又沒有路的地方：說明走不過去
  const sea = await page.evaluate(() => window.__tm.views['2d'].toScreen(30, 1));
  await page.mouse.click(sea.x, sea.y);
  await page.waitForFunction(() => !window.__tm.player.moving, null, { timeout: 15000 });
  assert.ok(await page.evaluate(() => { const p = window.__tm.services.entities.get('player'); return window.__tm.player.free(p.x, p.y); }));
});

test('房子和樹會擋路：一直往前走會被擋在外面', async () => {
  const page = await env.newPage('/?new=1&view=2d&joystick=0');
  await env.waitRunning(page);
  // 出生點 (16,13) 的正北邊是老橘的家 (16,11)
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  const p = await pos(page);
  assert.ok(p.y >= 11 + 0.55 + 0.3 - 0.02, `停在家門外，實際 y=${p.y.toFixed(2)}`);
  // 樹：大木家西邊那排橡樹
  await page.evaluate(() => { window.__tm.services.entities.move('player', 10, 9); window.__tm.player.stop(); });
  await page.keyboard.down('KeyA'); await page.waitForTimeout(1200); await page.keyboard.up('KeyA');
  const q = await pos(page);
  const oak = await page.evaluate(() => window.__tm.services.entities.all().filter((e) => e.ref === 'oak').map((e) => ({ x: e.x, y: e.y })));
  assert.ok(oak.every((t) => Math.hypot(t.x - q.x, t.y - q.y) >= 0.72 - 0.02), '沒有穿過任何一棵樹');
});

test('鏡頭阻尼：跟著走但不會跳；停下來後慢慢對準玩家', async () => {
  const page = await env.newPage('/?new=1&seed=2&joystick=0');
  await env.waitRunning(page);
  await page.waitForTimeout(500);
  const samples = await page.evaluate(async () => {
    const { controls } = window.__tm.views['3d'].debug;
    const out = [];
    const pl = () => window.__tm.services.entities.get('player');
    window.__tm.player.setDirection(1, 0);
    for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 60)); out.push({ t: controls.target.x, p: (pl().x + 0.5 - 16) * 2.5 }); }
    window.__tm.player.setDirection(0, 0);
    await new Promise((r) => setTimeout(r, 1800));
    out.push({ t: controls.target.x, p: (pl().x + 0.5 - 16) * 2.5, settled: true });
    return out;
  });
  const jumps = samples.slice(1).map((s, i) => Math.abs(s.t - samples[i].t));
  assert.ok(Math.max(...jumps) < 3, `鏡頭每 60 毫秒移動不超過 3 單位，最大 ${Math.max(...jumps).toFixed(2)}`);
  assert.ok(samples[15].t > samples[0].t + 1, '鏡頭有跟著走');
  const last = samples.at(-1);
  assert.ok(Math.abs(last.t - last.p) < 0.8, `停下來後對準玩家，差 ${Math.abs(last.t - last.p).toFixed(2)}`);
});
