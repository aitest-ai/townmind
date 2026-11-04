// 玩家移動：鍵盤（方向鍵、WASD）、點地面走過去（平板），以及地形碰撞（不能走進水裡）。
// 只改核心實體表裡 id 為 player 的實體位置。用真實時間移動，所以時間暫停時仍可以走動。

const SPEED = 3.2;   // 每秒幾格
const RADIUS = 0.3;  // 玩家的半徑（格）

export function createPlayerController({ entities, island, id = 'player' }) {
  const W = island.size.w, H = island.size.h;
  const walkableAt = (x, y) => {
    const tx = Math.floor(x + 0.5), ty = Math.floor(y + 0.5);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    return island.legend[island.terrain[ty][tx]]?.walkable !== false;
  };
  // 玩家身體四個角都要在可走的地上
  const free = (x, y) => walkableAt(x - RADIUS, y - RADIUS) && walkableAt(x + RADIUS, y - RADIUS) && walkableAt(x - RADIUS, y + RADIUS) && walkableAt(x + RADIUS, y + RADIUS);

  let dir = { x: 0, y: 0 }, target = null;
  const api = {
    walkableAt, free,
    setDirection(dx, dy) { dir = { x: dx, y: dy }; if (dx || dy) target = null; },
    // 點地面：目標在水裡時，走到最接近的岸邊（沿直線找最後一個可走點）
    setTarget(x, y) {
      const p = entities.get(id);
      if (!p) return false;
      let tx = x, ty = y;
      if (!free(tx, ty)) {
        const steps = 40;
        let best = null;
        for (let i = 1; i <= steps; i++) {
          const k = i / steps, cx = p.x + (x - p.x) * k, cy = p.y + (y - p.y) * k;
          if (free(cx, cy)) best = { x: cx, y: cy }; else if (best) break;
        }
        if (!best) return false;
        tx = best.x; ty = best.y;
      }
      target = { x: tx, y: ty };
      return true;
    },
    get target() { return target; },
    get moving() { return !!target || !!(dir.x || dir.y); },
    update(dt) {
      const p = entities.get(id);
      if (!p || !(dt > 0)) return;
      let vx = dir.x, vy = dir.y;
      if (!vx && !vy && target) {
        const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
        if (d < 0.05) { target = null; return; }
        vx = dx / d; vy = dy / d;
        if (d < SPEED * dt) { vx *= d / (SPEED * dt); vy *= d / (SPEED * dt); }
      }
      const len = Math.hypot(vx, vy);
      if (!len) return;
      if (len > 1) { vx /= len; vy /= len; }
      const step = SPEED * dt;
      let nx = p.x + vx * step, ny = p.y + vy * step;
      // 分開檢查兩個方向，撞牆時可以沿著岸邊滑動
      if (!free(nx, p.y)) nx = p.x;
      if (!free(nx, ny)) ny = p.y;
      if (nx === p.x && ny === p.y) target = null; // 完全卡住就放棄目標
      entities.move(id, nx, ny);
    },
  };
  return api;
}
