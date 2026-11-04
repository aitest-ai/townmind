// 本機開發用的靜態伺服器（不需安裝任何套件）：node scripts/serve.mjs [port]
// 部署到 Vercel 時不需要它，Vercel 直接提供靜態檔案。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon' };

export function startServer(port = 8123) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (p.startsWith('..')) { res.writeHead(403).end(); return; }
      let file = join(ROOT, p || 'index.html');
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('找不到檔案');
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8123;
  await startServer(port);
  console.log(`開發伺服器：http://localhost:${port}/（舊版原型：/legacy.html）`);
}
