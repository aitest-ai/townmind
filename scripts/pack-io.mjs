// Node 專用的小工具：從資料夾讀世界包與模組目錄。（核心本身不依賴 Node。）
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../src/core/worldpack.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const readPackDir = (dir) => loadPack(async (name) => JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')));
export const readCatalog = async () => JSON.parse(await readFile(join(ROOT, 'src/modules/catalog.json'), 'utf8'));
export async function listPackDirs() {
  const base = join(ROOT, 'data/worldpacks');
  const names = await readdir(base, { withFileTypes: true });
  return names.filter((d) => d.isDirectory()).map((d) => join(base, d.name));
}
