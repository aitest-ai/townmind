// Node 專用的小工具：從資料夾讀世界包、模組目錄與各模組的資料規格（schema.js）。（核心本身不依賴 Node。）
import { readFile, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPack } from '../src/core/worldpack.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function readSchemas(root = ROOT) {
  const base = join(root, 'src/modules');
  const out = [];
  for (const d of await readdir(base, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    const p = join(base, d.name, 'schema.js');
    try { await access(p); } catch { continue; }
    out.push((await import(pathToFileURL(p).href)).default);
  }
  return out;
}

export const readPackDir = async (dir, schemas = null) =>
  loadPack(async (name) => JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')), { schemas: schemas ?? await readSchemas() });
export const readCatalog = async () => JSON.parse(await readFile(join(ROOT, 'src/modules/catalog.json'), 'utf8'));
export async function listPackDirs() {
  const base = join(ROOT, 'data/worldpacks');
  const names = await readdir(base, { withFileTypes: true });
  return names.filter((d) => d.isDirectory()).map((d) => join(base, d.name));
}
