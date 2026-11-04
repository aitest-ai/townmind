// Playwright 冒煙測試共用：啟動本機伺服器與瀏覽器、收集頁面錯誤、截圖。
import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 專案沒有把 playwright 列為相依套件：先找專案內的，找不到再用系統全域安裝的（NODE_PATH）。
const { chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'));

export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');

export async function setup() {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const server = await startServer(port);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await mkdir(SHOTS, { recursive: true });
  const base = `http://localhost:${port}`;
  const newPage = async (path, { width = 1280, height = 860, scale = 1, ...opts } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, ...opts });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    if (path) await page.goto(base + path);
    return page;
  };
  const waitRunning = (page) => page.waitForFunction(() => ['running', 'failed'].includes(window.__tm?.status), null, { timeout: 20000 });
  const close = async () => { await browser.close(); server.close(); };
  return { base, browser, newPage, waitRunning, close };
}
