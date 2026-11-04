// 目錄一致性檢查：src/modules/catalog.json 與各模組程式裡的宣告必須一致。
//   node scripts/check-catalog.mjs
//
// 規則：
//  1. 有 index.js 的模組：程式裡的 id 要等於資料夾名稱；requires／optional／conflicts 要和 catalog 完全一樣。
//  2. 有 index.js 的模組，catalog 的 status 必須是 implemented 或 prototype（不能還寫 planned）。
//  3. catalog 寫 implemented 的模組一定要有 index.js。
//  4. 有 schema.js 的資料夾，schema 的 module 欄位要等於資料夾名稱；catalog 的 schema: true 要和檔案是否存在一致
//     （瀏覽器靠這個欄位決定要不要載入 schema，避免去抓不存在的檔案）。
import { readdir, readFile, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exists = (p) => access(p).then(() => true, () => false);
const same = (a = [], b = []) => [...a].sort().join(',') === [...b].sort().join(',');

export async function checkCatalog(root, catalog) {
  const errors = [];
  const base = join(root, 'src/modules');
  const cat = new Map((catalog?.modules || []).map((m) => [m.id, m]));
  const dirs = (await readdir(base, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);
  for (const id of dirs) {
    const c = cat.get(id);
    const idx = join(base, id, 'index.js');
    const sch = join(base, id, 'schema.js');
    const hasSch = await exists(sch);
    if (c && !!c.schema !== hasSch) errors.push(`[catalog.json] 「${id}」的 schema 欄位應該是 ${hasSch}（${hasSch ? '有' : '沒有'} src/modules/${id}/schema.js）`);
    if (hasSch) {
      try {
        const s = (await import(pathToFileURL(sch).href)).default;
        if (s?.module !== id) errors.push(`[src/modules/${id}/schema.js] module 欄位是「${s?.module}」，應該是「${id}」`);
      } catch (e) { errors.push(`[src/modules/${id}/schema.js] 無法載入：${e.message}`); }
    }
    if (!(await exists(idx))) continue;
    let def;
    try { def = (await import(pathToFileURL(idx).href)).default; } catch (e) {
      errors.push(`[src/modules/${id}/index.js] 無法在 Node 載入：${e.message}（模組不可直接使用瀏覽器 API）`);
      continue;
    }
    if (def?.id !== id) errors.push(`[src/modules/${id}/index.js] 模組 id 是「${def?.id}」，應該和資料夾名稱「${id}」一樣`);
    if (!c) continue; // 沒登記的模組由邊界檢查回報
    for (const k of ['requires', 'optional', 'conflicts']) {
      if (!same(def?.[k], c[k])) errors.push(`[src/modules/${id}] ${k} 和 catalog.json 不一致：程式寫 [${(def?.[k] || []).join(', ')}]，catalog 寫 [${(c[k] || []).join(', ')}]`);
    }
    if (!['implemented', 'prototype'].includes(c.status)) errors.push(`[src/modules/${id}] 已經有 index.js，catalog.json 的 status 應改成 implemented 或 prototype（目前是 ${c.status}）`);
  }
  for (const [id, c] of cat) {
    if (c.schema && !dirs.includes(id)) errors.push(`[catalog.json] 「${id}」標了 schema: true，但沒有 src/modules/${id}/schema.js`);
    if (c.status === 'implemented' && !(await exists(join(base, id, 'index.js')))) errors.push(`[catalog.json] 「${id}」標成 implemented，但沒有 src/modules/${id}/index.js`);
  }
  return { errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = JSON.parse(await readFile(join(root, 'src/modules/catalog.json'), 'utf8'));
  const { errors } = await checkCatalog(root, catalog);
  if (errors.length) {
    console.log(`✘ 目錄一致性：${errors.length} 個問題`);
    for (const e of errors) console.log('   ✘ ' + e);
    process.exit(1);
  }
  console.log('✔ 目錄一致性通過（catalog.json 與模組程式的宣告一致）');
}
