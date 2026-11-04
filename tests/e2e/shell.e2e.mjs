// PR3 冒煙測試：外殼啟動、白話錯誤、網址開關、存讀檔、舊版原型仍可執行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());

test('外殼啟動：沒有錯誤、顯示世界包標題、時間會走、有存檔面板', async () => {
  const page = await env.newPage('/?new=1&seed=7');
  await env.waitRunning(page);
  assert.equal(await page.evaluate(() => window.__tm.status), 'running');
  assert.equal(await page.textContent('#title'), '小島日常');
  const t0 = await page.evaluate(() => window.__tm.services.time.elapsed);
  await page.waitForTimeout(600);
  assert.ok(await page.evaluate(() => window.__tm.services.time.elapsed) > t0);
  assert.match(await page.textContent('[data-panel="shell.bag"]'), /斧頭 × 1/);
  // 玩家畫面不顯示「還在製作中」這類管理資訊；存檔與功能模組收在設定選單
  await page.waitForTimeout(300);
  assert.doesNotMatch(await page.innerText('body'), /製作中|沒有做好/); // innerText 只看畫面上看得到的字
  assert.equal(await page.isVisible('[data-panel="shell.save"]'), false);
  await page.click('#settingsBtn');
  assert.ok(await page.isVisible('[data-panel="shell.save"]'));
  assert.match(await page.textContent('[data-panel="shell.modules"]'), /競速/);
  await page.screenshot({ path: join(SHOTS, 'pr10-settings.png') });
  await page.click('#settingsClose');
  // 網址開一個還沒做好的功能：提示只出現在設定選單，玩家畫面看不到
  await page.goto(env.base + '/?new=1&view=2d&mods=minigames=on');
  await env.waitRunning(page);
  await page.waitForTimeout(300);
  assert.doesNotMatch(await page.innerText('body'), /製作中|沒有做好/);
  await page.click('#settingsBtn');
  assert.match(await page.textContent('[data-panel="shell.modules"]'), /還沒有做好.*小遊戲|minigames/s);
  await page.screenshot({ path: join(SHOTS, 'pr3-shell.png') });
  assert.deepEqual(page.errors, []);
});

test('平板直式畫面也能用', async () => {
  const page = await env.newPage('/?new=1', { width: 820, height: 1180 });
  await env.waitRunning(page);
  await page.screenshot({ path: join(SHOTS, 'pr3-shell-tablet.png') });
  assert.deepEqual(page.errors, []);
});

test('世界包壞掉：畫面上用白話說明，不是白畫面', async () => {
  const page = await env.newPage();
  await page.route('**/data/worldpacks/island-default/items.json', (r) => r.fulfill({ contentType: 'application/json', body: '[{"id":"wood","name":"木頭","category":"weird","stack":1}]' }));
  await page.goto(env.base + '/');
  await env.waitRunning(page);
  assert.equal(await page.evaluate(() => window.__tm.status), 'failed');
  const text = await page.textContent('#fatal');
  assert.match(text, /世界包「island-default」有 \d+ 個問題/);
  assert.match(text, /category「weird」不合法/);
  assert.match(text, /怎麼辦/);
  await page.screenshot({ path: join(SHOTS, 'pr3-fatal.png') });
});

test('存檔後重新整理：時間與背包接續；壞存檔會白話提示並改開新遊戲', async () => {
  const page = await env.newPage('/?new=1&seed=3');
  await env.waitRunning(page);
  await page.evaluate(() => { const t = window.__tm.services; t.time.skipDays(2); t.inventory.add('player', 'wood', 5); window.__tm.saveNow(); });
  await page.goto(env.base + '/');
  await env.waitRunning(page);
  const snap = await page.evaluate(() => window.__tm.snapshot());
  assert.equal(snap.day, 3);
  assert.ok(snap.bag.some((s) => s.item === 'wood' && s.qty === 5));
  assert.equal(await page.evaluate(() => window.__tm.isNew), false);
  // 弄壞存檔（關掉頁面時會自動存檔，所以在新分頁載入前才寫入壞資料）
  const ctx = page.context();
  await page.close();
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => { if (!sessionStorage.getItem('done')) { sessionStorage.setItem('done', '1'); localStorage.setItem('townmind:save:island-default', '{"format":2,"modu'); } });
  await test2(p2);
});

async function test2(page) {
  await page.goto(env.base + '/');
  await env.waitRunning(page);
  assert.match(await page.textContent('#log'), /存檔壞掉了/);
  assert.equal(await page.evaluate(() => localStorage.getItem('townmind:save:island-default:broken')), '{"format":2,"modu');
  await page.screenshot({ path: join(SHOTS, 'pr3-broken-save.png') });
}

test('網址可開啟世界包沒開的功能；未知功能白話略過', async () => {
  const page = await env.newPage('/?new=1&mods=nosuch=on');
  await env.waitRunning(page);
  await page.click('#settingsBtn');
  assert.match(await page.textContent('[data-panel="shell.modules"]'), /「nosuch」不是已知的功能/);
});

test('舊版原型 legacy.html 仍可執行（3D、小人、居民）', async () => {
  const page = await env.newPage('/legacy.html');
  await page.waitForFunction(() => window.__town?.view3d, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => ({ view: window.__town.view, workers: window.__town.world.workers.length, t: window.__town.world.t }));
  assert.equal(s.view, '3d');
  assert.equal(s.workers, 24);
  assert.ok(s.t > 0);
  await page.screenshot({ path: join(SHOTS, 'pr3-legacy.png') });
  assert.deepEqual(page.errors.filter((e) => !/WebGL|GPU stall|swiftshader/i.test(e)), []);
});

test('用網址關掉世界包有開的模組（例如 crafting）：遊戲照樣啟動（回歸測試）', async () => {
  const page = await env.newPage('/?new=1&view=2d&mods=crafting=off,farming=off,economy=off');
  await env.waitRunning(page);
  assert.equal(await page.evaluate(() => window.__tm.status), 'running');
  assert.equal(await page.evaluate(() => window.__tm.engine.enabledModules().includes('crafting')), false);
});
