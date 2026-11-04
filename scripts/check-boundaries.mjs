// 邊界檢查：把「新增模組不准改核心」這類架構規則變成機器檢查。
//   node scripts/check-boundaries.mjs
//
// 規則：
//  1. src/core 不可 import 模組、渲染層或 three，也不可直接用瀏覽器 API（document/window/localStorage），
//     這樣核心才能在 Node 裡完整測試；瀏覽器的能力一律由 services 注入。
//  2. src/render*（畫面層）不可 import src/modules，畫面只讀核心的資料。
//  3. src/modules/<A> 只能 import：自己、src/core、以及「在 catalog.json 宣告為 requires 或 optional」的模組 B，
//     而且只能 import B 的 index.js（不可深入 B 的內部檔案）。模組不可 import 渲染層、three 或 src 以外的檔案。
//  4. 核心與模組都不可直接使用瀏覽器 API（document、window、localStorage、fetch、requestAnimationFrame……），
//     一律由 services 注入，這樣才能在 Node 裡完整測試，也才能換平台。
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = /\.(m?js)$/;
const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
const BROWSER_API = /(?<![.\w$])(?:(?:document|window|globalThis|navigator|location|localStorage|sessionStorage|indexedDB|caches)\s*[.[]|(?:fetch|requestAnimationFrame|cancelAnimationFrame|alert|confirm|prompt|importScripts)\s*\(|new\s+(?:XMLHttpRequest|WebSocket|Worker|Image|Audio|AudioContext|EventSource|BroadcastChannel)\b|(?:localStorage|sessionStorage|indexedDB)\b)/;
const browserHit = (text) => stripStrings(stripComments(text)).match(BROWSER_API)?.[0]?.trim();

async function walk(dir) {
  const out = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (JS.test(e.name)) out.push(p);
  }
  return out;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
// 去掉字串內容（避免「請不要用 window」這類中文說明被誤判），保留引號本身
const stripStrings = (s) => s.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (m) => m[0] + m[0]);

export async function checkBoundaries(root, catalog = null) {
  const errors = [];
  const src = join(root, 'src');
  const rel = (p) => relative(root, p).split(sep).join('/');
  const cat = new Map((catalog?.modules || []).map((m) => [m.id, m]));
  const E = (file, msg) => errors.push(`[${rel(file)}] ${msg}`);

  const specsOf = (text) => [...stripComments(text).matchAll(IMPORT)].map((m) => m[1]);
  const isThree = (s) => s === 'three' || s.startsWith('three/');

  // 1. 核心
  for (const f of await walk(join(src, 'core'))) {
    const text = await readFile(f, 'utf8');
    for (const s of specsOf(text)) {
      if (isThree(s)) E(f, `核心不可使用 three（${s}）。畫面相關的東西屬於渲染層。`);
      else if (s.startsWith('.')) {
        const target = resolve(dirname(f), s);
        const r = relative(src, target).split(sep);
        if (r[0] === 'modules') E(f, `核心不可 import 模組（${s}）。核心不能認識任何具體模組。`);
        if (r[0]?.startsWith('render')) E(f, `核心不可 import 渲染層（${s}）。`);
        if (r[0] === '..') E(f, `核心不可 import src 以外的檔案（${s}）。`);
      }
    }
    const hit = browserHit(text);
    if (hit) E(f, `核心不可直接使用瀏覽器 API（${hit}）。請改由 services 注入。`);
  }

  // 2. 渲染層
  const top = await readdir(src, { withFileTypes: true }).catch(() => []);
  for (const e of top) {
    if (!e.name.startsWith('render')) continue;
    const files = e.isDirectory() ? await walk(join(src, e.name)) : [join(src, e.name)];
    for (const f of files.filter((x) => JS.test(x))) {
      for (const s of specsOf(await readFile(f, 'utf8'))) {
        if (!s.startsWith('.')) continue;
        if (relative(src, resolve(dirname(f), s)).split(sep)[0] === 'modules') E(f, `渲染層不可 import 模組（${s}）。畫面只讀核心的資料。`);
      }
    }
  }

  // 3. 模組
  const modRoot = join(src, 'modules');
  let dirs = [];
  try { dirs = (await readdir(modRoot, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('_')); } catch { /* 沒有模組 */ }
  for (const d of dirs) {
    const id = d.name;
    const allowed = new Set([...(cat.get(id)?.requires || []), ...(cat.get(id)?.optional || [])]);
    if (catalog && !cat.has(id)) errors.push(`[src/modules/${id}] 這個模組沒有登記在 src/modules/catalog.json，請先登記（含 requires、optional、needsData）。`);
    for (const f of await walk(join(modRoot, id))) {
      const text = await readFile(f, 'utf8');
      const hit = browserHit(text);
      if (hit) E(f, `模組不可直接使用瀏覽器 API（${hit}）。請改用 ctx.services 提供的服務，模組才能在 Node 測試。`);
      for (const s of specsOf(text)) {
        if (isThree(s)) { E(f, `模組不可使用 three（${s}）。畫面由渲染層負責。`); continue; }
        if (!s.startsWith('.')) continue;
        const target = resolve(dirname(f), s);
        const r = relative(src, target).split(sep);
        if (r[0]?.startsWith('render')) E(f, `模組不可 import 渲染層（${s}）。`);
        if (r[0] === 'modules' && r[1] && r[1] !== id) {
          if (catalog && !allowed.has(r[1])) E(f, `模組「${id}」使用了「${r[1]}」，但沒有在 catalog.json 把它宣告為 requires 或 optional。`);
          const last = r.slice(2).join('/');
          if (last !== 'index.js' && last !== 'index.mjs' && last !== '') E(f, `模組「${id}」深入引用了「${r[1]}」的內部檔案（${s}）。只能引用它的 index.js，其他模組要透過 ctx.getModule 取得公開 api。`);
        }
        if (r[0] === '..') E(f, `模組不可引用 src 以外的檔案（${s}）。資料請放在世界包，透過 ctx.data 取得。`);
        else if (r[0] !== 'core' && r[0] !== 'modules' && !r[0]?.startsWith('render')) E(f, `模組只能引用 core 與其他已宣告的模組，不可引用 src/${r[0]}（${s}）。`);
      }
    }
  }
  return { errors };
}

// 直接執行時的命令列入口
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = JSON.parse(await readFile(join(root, 'src/modules/catalog.json'), 'utf8'));
  const { errors } = await checkBoundaries(root, catalog);
  if (errors.length) {
    console.log(`✘ 邊界檢查：${errors.length} 個問題`);
    for (const e of errors) console.log('   ✘ ' + e);
    process.exit(1);
  }
  console.log('✔ 邊界檢查通過（核心沒有依賴模組或畫面；模組只用了已宣告的依賴）');
}
