// 競速的物理（純函式、固定時間步長、沒有亂數）：同樣的輸入 → 同樣的結果。玩家和居民對手用的是同一套。
// 座標單位是格子。heading 是弧度（0 = 往右，π/2 = 往下）。
export const STEP = 1 / 30;            // 固定時間步長（秒）
export const VEHICLES = {
  skateboard: { maxSpeed: 4.5, accel: 2.4, turnRate: 3.6, brake: 2.0 }, // 每秒 4.5 格：小朋友控制得來
};
const CP_RADIUS = 1.5;
const SPIN_SECONDS = 0.7;              // 撞到岸邊：可愛地轉圈圈，不受傷

export function createRacer(id, start, heading = 0) {
  return { id, x: start.x, y: start.y, heading, speed: 0, next: 0, lap: 0, finished: false, time: 0, spin: 0, ticks: 0 };
}

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
// 量化：讓輸入（與存檔裡的紀錄）完全可以重現
export const quant = (v, n = 100) => Math.round(v * n) / n;

// 往前一步。input = { heading, throttle(0~1) }。world = { walkable(x, y), terrainSpeed(x, y), checkpoints, laps, vehicle }
export function step(r, input, world) {
  if (r.finished) return r;
  const v = VEHICLES[world.vehicle] ?? VEHICLES.skateboard;
  const dt = STEP;
  r.ticks += 1;
  r.time = quant(r.ticks * dt, 1000);
  if (r.spin > 0) {
    r.spin = Math.max(0, quant(r.spin - dt, 1000));
    r.speed = quant(r.speed * 0.85, 1000);
    r.heading = quant(wrap(r.heading + 9 * dt), 1000);
    return r;
  }
  const want = quant(input?.heading ?? r.heading, 100), thr = Math.max(0, Math.min(1, quant(input?.throttle ?? 0, 100)));
  const turn = Math.max(-v.turnRate * dt, Math.min(v.turnRate * dt, wrap(want - r.heading)));
  r.heading = quant(wrap(r.heading + turn), 1000);
  const target = v.maxSpeed * thr * world.terrainSpeed(r.x, r.y);
  const k = target > r.speed ? v.accel : v.brake;
  r.speed = quant(r.speed + (target - r.speed) * Math.min(1, k * dt), 1000);
  const nx = quant(r.x + Math.cos(r.heading) * r.speed * dt, 1000), ny = quant(r.y + Math.sin(r.heading) * r.speed * dt, 1000);
  if (!world.walkable(nx, ny)) { // 撞到岸邊：停住、轉圈圈、往回彈一點
    r.spin = SPIN_SECONDS;
    r.speed = 0;
    return r;
  }
  r.x = nx; r.y = ny;
  const cp = world.checkpoints[r.next];
  if (cp && Math.hypot(cp.x - r.x, cp.y - r.y) < CP_RADIUS) {
    r.next += 1;
    if (r.next >= world.checkpoints.length) { r.next = 0; r.lap += 1; if (r.lap >= world.laps) r.finished = true; }
  }
  return r;
}

// 用錄下來的輸入重跑一次（驗證成績、算幽靈）：回傳完成時間（秒），跑不完回傳 null
export function replay(world, start, heading, inputs, maxTicks = 30 * 300) {
  const r = createRacer('replay', start, heading);
  for (let i = 0; i < maxTicks && !r.finished; i++) step(r, inputs[i] ? { heading: inputs[i][0] / 100, throttle: inputs[i][1] / 100 } : { throttle: 0 }, world);
  return r.finished ? r.time : null;
}
