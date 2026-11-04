// 玩家移動（手感）：鍵盤、觸控搖桿（可以只推一點點，走慢一點）、點地面尋路走過去。
//   - 地形碰撞：不能走進 walkable: false 的格子（水）
//   - 擋路的東西：模組在 registerEntityKind 宣告 solid: true（例如樹、石頭、房子），玩家會被擋住並沿著邊緣滑開
//   - 撞牆時沿牆滑行；斜著撞到牆角時會自動往旁邊擠一點，不會卡住
//   - 加速與減速是平滑的；點地面時用 A* 繞過水池和房子
// 只改核心實體表裡 id 為 player 的實體位置。用真實時間移動，所以時間暫停時仍可以走動。
import { findPath, smoothPath } from './pathfind.js';

const SPEED = 3.4;       // 每秒幾格（全速）
const RADIUS = 0.3;      // 玩家的半徑（格）
const ACCEL = 14;        // 越大越快達到目標速度（1/秒）
const ARRIVE = 0.12;     // 離路徑點多近算到了

export function createPlayerController({ entities, island, id = 'player', solidRadius = () => 0 }) {
  const W = island.size.w, H = island.size.h;
  const tileWalkable = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H && island.legend[island.terrain[ty][tx]]?.walkable !== false;
  const walkableAt = (x, y) => tileWalkable(Math.floor(x + 0.5), Math.floor(y + 0.5));
  const solidsNear = (x, y, r = 1.6) => entities.near(x, y, r, { filter: (e) => e.id !== id && solidRadius(e) > 0 });
  // 地形：玩家身體四個角都要在可走的地上
  const terrainFree = (x, y) => walkableAt(x - RADIUS, y - RADIUS) && walkableAt(x + RADIUS, y - RADIUS) && walkableAt(x - RADIUS, y + RADIUS) && walkableAt(x + RADIUS, y + RADIUS);
  const entityFree = (x, y) => solidsNear(x, y).every((e) => Math.hypot(e.x - x, e.y - y) >= RADIUS + solidRadius(e) - 1e-6);
  const free = (x, y) => terrainFree(x, y) && entityFree(x, y);

  // 尋路用的格子：地形不能走、或有擋路的東西
  const blockedTile = (tx, ty) => {
    if (!tileWalkable(tx, ty)) return true;
    return entities.near(tx, ty, 0.55, { filter: (e) => e.id !== id && solidRadius(e) > 0 }).length > 0;
  };
  const lineFree = (a, b) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / 0.2));
    for (let i = 0; i <= n; i++) { const k = i / n; if (!free(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)) return false; }
    return true;
  };

  let dir = { x: 0, y: 0 };   // 鍵盤或搖桿的方向（長度 0～1）
  let path = null;            // 尋路的路徑點 [{x,y}, ...]
  const vel = { x: 0, y: 0 };

  // 往 (dx, dy) 走一步：完整走不過就沿牆滑（只走 x 或只走 y），再不行就往旁邊擠一點（牆角）
  function stepMove(p, dx, dy) {
    const tries = [[dx, dy], [dx, 0], [0, dy]];
    const len = Math.hypot(dx, dy);
    // 撞到圓形的東西（樹、石頭）：沿著切線滑開（正面撞上時切線是 0，就會停住）
    for (const e of solidsNear(p.x, p.y, RADIUS + solidRadius({ kind: '' }) + 1.2)) {
      const r = RADIUS + solidRadius(e), ex = p.x - e.x, ey = p.y - e.y, d = Math.hypot(ex, ey);
      if (d > r + len + 0.02 || d === 0) continue;
      const nx = ex / d, ny = ey / d, dot = dx * nx + dy * ny;
      if (dot >= 0) continue;
      let tx = dx - dot * nx, ty = dy - dot * ny;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-6) continue;
      tx = (tx / tl) * len; ty = (ty / tl) * len; // 保持速度，繞著走
      // 順便把人推回圓外一點，避免黏在邊上
      const push = Math.max(0, r - d + 0.001);
      tries.push([tx + nx * push, ty + ny * push]);
    }
    if (len > 0) {
      const nx = -dy / len, ny = dx / len; // 垂直方向
      for (const s of [0.35, -0.35]) tries.push([dx + nx * len * s, dy + ny * len * s]);
    }
    let best = null, bestGain = 1e-4;
    for (const [tx, ty] of tries) {
      const x = p.x + tx, y = p.y + ty;
      if (!free(x, y)) continue;
      const gain = (tx * dx + ty * dy) / (len || 1); // 朝想去的方向前進了多少
      if (gain > bestGain) { bestGain = gain; best = { x, y }; }
    }
    return best;
  }

  const api = {
    walkableAt, free, blockedTile,
    get path() { return path ? path.map((q) => ({ ...q })) : null; },
    get target() { return path ? path[path.length - 1] : null; },
    get velocity() { return { ...vel }; },
    get moving() { return !!path || Math.hypot(dir.x, dir.y) > 0.05 || Math.hypot(vel.x, vel.y) > 0.05; },
    setDirection(dx, dy) {
      const l = Math.hypot(dx, dy);
      dir = l > 1 ? { x: dx / l, y: dy / l } : { x: dx, y: dy };
      if (l > 0.05) path = null; // 手動操作時取消尋路
    },
    // 點地面：用 A* 找路；目標走不到時走到最近能到的地方。回傳 true 表示有路可走。
    setTarget(x, y) {
      const p = entities.get(id);
      if (!p) return false;
      const res = findPath({ w: W, h: H, blocked: blockedTile }, p, { x, y });
      if (!res) { path = null; return false; }
      const goal = res.adjusted ? res.goal : (free(x, y) ? { x, y } : res.goal);
      const pts = [{ x: p.x, y: p.y }, ...res.cells.slice(1, -1), goal];
      path = smoothPath(pts, lineFree).slice(1);
      if (!path.length) path = null;
      return !!path;
    },
    stop() { path = null; dir = { x: 0, y: 0 }; vel.x = vel.y = 0; },
    update(dt) {
      const p = entities.get(id);
      if (!p || !(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      // 想去的方向
      let want = { x: dir.x * SPEED, y: dir.y * SPEED };
      if (path) {
        let wp = path[0], d = Math.hypot(wp.x - p.x, wp.y - p.y);
        while (d < ARRIVE && path.length > 1) { path.shift(); wp = path[0]; d = Math.hypot(wp.x - p.x, wp.y - p.y); }
        if (d < ARRIVE && path.length === 1) { path = null; want = { x: 0, y: 0 }; }
        else {
          const last = path.length === 1;
          const sp = last ? Math.min(SPEED, d * 6) : SPEED; // 接近終點慢慢停下
          want = { x: ((wp.x - p.x) / d) * sp, y: ((wp.y - p.y) / d) * sp };
        }
      }
      // 平滑加速／減速（跟幀率無關）
      const k = 1 - Math.exp(-ACCEL * dt);
      vel.x += (want.x - vel.x) * k; vel.y += (want.y - vel.y) * k;
      if (Math.hypot(vel.x, vel.y) < 0.02 && !path && !Math.hypot(dir.x, dir.y)) { vel.x = vel.y = 0; return; }
      const next = stepMove(p, vel.x * dt, vel.y * dt);
      if (!next) {
        vel.x *= 0.3; vel.y *= 0.3;
        if (path) { // 尋路時被擋住（例如居民走過來）：重新找一次路
          const goal = path[path.length - 1];
          if (!api.setTarget(goal.x, goal.y)) path = null;
        }
        return;
      }
      entities.move(id, next.x, next.y);
    },
  };
  return api;
}
