// 尋路：在格子地圖上用 A* 找路（八方向，不切角），再把路徑拉直（看得到就直接走過去）。
// 純函式，不依賴瀏覽器，可在 Node 測試。
// blocked(tx, ty)：這一格能不能走（地形或擋路的東西）。

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export function findPath({ w, h, blocked }, from, to, { maxNodes = 4000 } = {}) {
  const sx = Math.round(from.x), sy = Math.round(from.y);
  let gx = Math.round(to.x), gy = Math.round(to.y);
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const free = (x, y) => inside(x, y) && !blocked(x, y);
  if (!inside(sx, sy)) return null;
  // 目標走不到（水裡、樹上）：改找離目標最近、可以走的格子
  if (!free(gx, gy)) {
    const near = nearestFree({ w, h, blocked }, gx, gy, { from: { x: sx, y: sy } });
    if (!near) return null;
    gx = near.x; gy = near.y;
  }
  const key = (x, y) => y * w + x;
  const g = new Map([[key(sx, sy), 0]]);
  const came = new Map();
  const open = [[Math.hypot(gx - sx, gy - sy), sx, sy]];
  const closed = new Set();
  let n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, x, y] = open.splice(bi, 1)[0];
    const k = key(x, y);
    if (closed.has(k)) continue;
    closed.add(k);
    if (x === gx && y === gy) {
      const cells = [{ x, y }];
      let c = k;
      while (came.has(c)) { c = came.get(c); cells.push({ x: c % w, y: Math.floor(c / w) }); }
      cells.reverse();
      return { cells, goal: { x: gx, y: gy }, adjusted: gx !== Math.round(to.x) || gy !== Math.round(to.y) };
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!free(nx, ny)) continue;
      if (dx && dy && (!free(x + dx, y) || !free(x, y + dy))) continue; // 不切角，避免卡在牆角
      const nk = key(nx, ny), ng = g.get(k) + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng); came.set(nk, k);
        open.push([ng + Math.hypot(gx - nx, gy - ny), nx, ny]);
      }
    }
  }
  return null; // 走不到（例如被水隔開的小島）
}

// 離 (x, y) 最近、可以走的格子；同樣近時選離 from 比較近的
export function nearestFree({ w, h, blocked }, x, y, { from = null, maxR = 12 } = {}) {
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h || blocked(cx, cy)) continue;
      const d = Math.hypot(dx, dy) + (from ? Math.hypot(cx - from.x, cy - from.y) * 0.01 : 0);
      if (d < bd) { bd = d; best = { x: cx, y: cy }; }
    }
    if (best) return best;
  }
  return null;
}

// 把格子路徑拉直：從目前的點，盡量直接走到「看得到」的最遠點（中間每一點都可以走）
export function smoothPath(points, canWalkLine) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && !canWalkLine(points[i], points[j])) j--;
    out.push(points[j]);
    i = j;
  }
  return out;
}
