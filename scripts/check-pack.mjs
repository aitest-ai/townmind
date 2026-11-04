// 檢查世界包：node scripts/check-pack.mjs [世界包資料夾]
// 有錯誤時結束碼為 1。訊息是白話中文，說明哪個檔案、哪一筆、怎麼修。
import { basename } from 'node:path';
import { validatePack } from '../src/core/worldpack.js';
import { readPackDir, readCatalog, listPackDirs } from './pack-io.mjs';

const dirs = process.argv[2] ? [process.argv[2]] : await listPackDirs();
const catalog = await readCatalog();
let failed = false;

for (const dir of dirs) {
  let result;
  try {
    result = validatePack(await readPackDir(dir), catalog);
  } catch (e) {
    console.log(`✘ ${basename(dir)}：${e.message}`);
    failed = true;
    continue;
  }
  const { errors, warnings } = result;
  console.log(`${errors.length ? '✘' : '✔'} ${basename(dir)}：${errors.length} 個錯誤、${warnings.length} 個提醒`);
  for (const e of errors) console.log(`   ✘ [${e.file}] ${e.message}${e.hint ? `\n       → ${e.hint}` : ''}`);
  for (const w of warnings) console.log(`   ⚠ [${w.file}] ${w.message}${w.hint ? `\n       → ${w.hint}` : ''}`);
  if (errors.length) failed = true;
}
process.exit(failed ? 1 : 0);
