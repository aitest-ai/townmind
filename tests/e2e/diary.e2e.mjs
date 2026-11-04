// WP1 瀏覽器實測：離開再回來看到日記；存檔壞掉時畫面說明並能從備份還原；過完一天寫日記。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, SHOTS } from './helpers.mjs';

const env = await setup();
test.after(() => env.close());
const benign = (errs) => errs.filter((e) => !/WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i.test(e));
const KEY = 'townmind:save:island-default';

test('離開三天回來：畫面提醒、日記面板有三則「你不在的時候」', async () => {
  const page = await env.newPage('/?new=1&view=2d&seed=8');
  await env.waitRunning(page);
  await page.evaluate(() => window.__tm.saveNow());
  const ctx = page.context();
  await page.close();
  const p2 = await ctx.newPage();
  // 把存檔時間往前調三天（一天 12 分鐘）：模擬離開了 36 分鐘
  await p2.addInitScript((key) => {
    if (sessionStorage.getItem('shifted')) return;
    sessionStorage.setItem('shifted', '1');
    const b = JSON.parse(localStorage.getItem(key));
    b.meta.savedAt -= 3 * 12 * 60_000 + 5000;
    localStorage.setItem(key, JSON.stringify(b));
  }, KEY);
  p2.errors = []; p2.on('pageerror', (e) => p2.errors.push(e.message));
  await p2.goto(env.base + '/?view=2d');
  await env.waitRunning(p2);
  await p2.waitForSelector('#banner:has-text("你離開的這段時間（3 天）")');
  await p2.screenshot({ path: join(SHOTS, 'pr8-welcome-back.png') });
  await p2.click('#banner');
  const panel = await p2.textContent('[data-panel="quests-diary.diary"]');
  assert.equal((panel.match(/你不在的時候/g) || []).length, 3);
  assert.match(panel, /有 3 則新日記/);
  assert.equal(await p2.evaluate(() => window.__tm.services.time.day), 4);
  await p2.locator('[data-panel="quests-diary.diary"]').scrollIntoViewIfNeeded();
  await p2.screenshot({ path: join(SHOTS, 'pr8-diary-panel.png') });
  await p2.click('[data-panel="quests-diary.diary"] button:has-text("看過了")');
  await p2.waitForTimeout(300);
  assert.doesNotMatch(await p2.textContent('[data-panel="quests-diary.diary"]'), /新日記/);
  assert.deepEqual(benign(p2.errors), []);
});

test('存檔壞掉：畫面說明原因，「讀取備份」還原到上一份存檔', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.evaluate(() => { window.__tm.services.time.skipDays(4); window.__tm.services.inventory.add('player', 'wood', 7); window.__tm.saveNow(); window.__tm.saveNow(); });
  const ctx = page.context();
  await page.close();
  const p2 = await ctx.newPage();
  await p2.addInitScript((key) => { if (!sessionStorage.getItem('b')) { sessionStorage.setItem('b', '1'); localStorage.setItem(key, '{"format":2,"meta":{"pa'); } }, KEY);
  await p2.goto(env.base + '/?view=2d');
  await env.waitRunning(p2);
  await p2.waitForSelector('#fatal:has-text("存檔讀不出來")');
  assert.match(await p2.textContent('#fatal'), /讀取備份（第 5 天/);
  await p2.screenshot({ path: join(SHOTS, 'pr8-recovery-dialog.png') });
  await p2.click('#fatal button:has-text("讀取備份")');
  await p2.waitForFunction(() => window.__tm?.status === 'running' && !window.__tm.recovery, null, { timeout: 20000 });
  const s = await p2.evaluate(() => ({ day: window.__tm.services.time.day, wood: window.__tm.services.inventory.count('player', 'wood') }));
  assert.deepEqual(s, { day: 5, wood: 7 });
});

test('存檔壞掉、選「先玩新遊戲」：好的備份不會被自動存檔蓋掉', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.evaluate(() => { window.__tm.services.time.skipDays(2); window.__tm.saveNow(); window.__tm.saveNow(); });
  const ctx = page.context();
  await page.close();
  const p2 = await ctx.newPage();
  await p2.addInitScript((key) => { if (!sessionStorage.getItem('c')) { sessionStorage.setItem('c', '1'); localStorage.setItem(key, 'oops'); } }, KEY);
  await p2.goto(env.base + '/?view=2d');
  await env.waitRunning(p2);
  await p2.click('#fatal button:has-text("先玩新遊戲")');
  await p2.evaluate(() => { window.__tm.saveNow(); window.__tm.saveNow(); });
  const backupDay = await p2.evaluate((key) => JSON.parse(localStorage.getItem(`${key}:backup`)).meta.gameDay, KEY);
  assert.equal(backupDay, 3);
});

test('玩的時候過完一天：隔天看到昨天的日記', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.evaluate(() => {
    const t = window.__tm; const oak = t.services.entities.all().find((e) => e.ref === 'oak');
    t.services.entities.move('player', oak.x + 1, oak.y);
    t.engine.runCommand('gathering.harvest', { target: oak.id });
  });
  // 開了「行動與工具」：砍樹要花一點時間，等砍完再過一天
  await page.waitForFunction(() => window.__tm.services.entities.all().some((e) => e.ref === 'oak' && e.state.depleted), null, { timeout: 15000 });
  await page.evaluate(() => { window.__tm.services.time.advance(720); window.__tm.engine.update(0.01); });
  await page.waitForTimeout(400);
  assert.match(await page.textContent('[data-panel="quests-diary.diary"]'), /第 1 天・老橘.*採集了 1 次/s);
});

test('「開新遊戲」真的會開新遊戲，舊存檔留在備份（回歸測試：離開前的自動存檔不可以蓋掉）', async () => {
  const page = await env.newPage('/?new=1&view=2d');
  await env.waitRunning(page);
  await page.evaluate(() => { window.__tm.services.time.skipDays(6); window.__tm.saveNow(); });
  page.on('dialog', (d) => d.accept());
  await page.click('#settingsBtn');
  await page.click('[data-panel="shell.save"] button:has-text("開新遊戲")');
  await page.waitForFunction(() => window.__tm?.status === 'running' && window.__tm.isNew === true && window.__tm.services.time.day === 1, null, { timeout: 20000 });
  const backupDay = await page.evaluate((key) => JSON.parse(localStorage.getItem(`${key}:backup`)).meta.gameDay, KEY);
  assert.equal(backupDay, 7);
});
