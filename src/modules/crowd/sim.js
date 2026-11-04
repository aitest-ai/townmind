// 群體小人的模擬（從 legacy/world.js 原樣移植，數值與行為保持一致，tests/parity.test.mjs 會逐步比對）。
// 完全不用 AI，規則驅動。座標單位是原型的「世界單位」（800×520），由 index.js 換算成格子座標。
// 與原型唯一的差別：亂數狀態存在 w.seed（純數字），可以存檔還原。

export const TASKS = ['gather_food', 'gather_wood', 'build', 'rest'];
export const TASK_LABEL = {
  gather_food: '採集糧食',
  gather_wood: '砍木材',
  build: '蓋房子',
  rest: '休息',
  idle: '待命',
};
export const TASK_COLOR = {
  gather_food: '#e0a030',
  gather_wood: '#8a5a2b',
  build: '#4a7fd0',
  rest: '#5fb85f',
  idle: '#9a9a9a',
};

export const MAX_HOUSES = 10;
const SPEED = 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 和原型相同的線性同餘亂數，但狀態放在 w.seed，讓存檔後結果可重現
function attachRng(w) {
  w.rand = () => ((w.seed = (w.seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  return w;
}

export function addLog(w, text) {
  w.log.push({ t: w.t, text });
  if (w.log.length > 60) w.log.shift();
  w.logSeq = (w.logSeq || 0) + 1;
}

export function createWorld(seed = 7, workerCount = 24) {
  const base = { x: 400, y: 260 };
  const w = attachRng({
    t: 0, width: 800, height: 520, base,
    stock: { food: 30, wood: 12 },
    mood: 70, houses: [], site: null, siteTimer: 0,
    res: [], workers: [], seed: seed >>> 0, log: [], logSeq: 0,
  });
  const rand = w.rand;
  for (const [type, n] of [['food', 5], ['wood', 5]]) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = 120 + rand() * 130;
      w.res.push({
        id: `${type}${i}`, type,
        x: clamp(base.x + Math.cos(a) * d * 1.4, 40, 760),
        y: clamp(base.y + Math.sin(a) * d * 0.9, 40, 480),
        left: 50, max: 50,
      });
    }
  }
  spawnSite(w);
  for (let i = 0; i < workerCount; i++) {
    const task = i < 5 ? 'gather_food' : i < 10 ? 'gather_wood' : i < 13 ? 'build' : 'idle';
    w.workers.push({
      id: i, task, state: 'idle', target: null, timer: 0, carry: 0, spot: null, wait: 0,
      x: base.x + (rand() - 0.5) * 60, y: base.y + (rand() - 0.5) * 60,
    });
  }
  return w;
}

// 新工地：選在倉庫外圍的「村落帶」，避開資源點、既有房子與倉庫，避免擠成一團。
function spawnSite(w) {
  if (w.houses.length >= MAX_HOUSES) return;
  const far = (x, y, list, min) => list.every((o) => Math.hypot(o.x - x, o.y - y) >= min);
  let x = 0, y = 0;
  for (let i = 0; i < 40; i++) {
    const a = w.rand() * Math.PI * 2, d = 100 + w.rand() * 100;
    x = clamp(w.base.x + Math.cos(a) * d * 1.4, 60, 740);
    y = clamp(w.base.y + Math.sin(a) * d * 0.85, 60, 460);
    if (Math.hypot(x - w.base.x, y - w.base.y) >= 95 && far(x, y, w.res, 45) && far(x, y, w.houses, 50)) break;
  }
  w.site = { x, y, progress: 0, need: 10 };
}

export function countTasks(w) {
  const c = { idle: 0, gather_food: 0, gather_wood: 0, build: 0, rest: 0 };
  for (const k of w.workers) c[k.task]++;
  return c;
}

export function snapshot(w) {
  return {
    time: Math.round(w.t),
    food: Math.round(w.stock.food),
    wood: Math.round(w.stock.wood),
    mood: Math.round(w.mood),
    houses: w.houses.length,
    maxHouses: MAX_HOUSES,
    siteProgress: w.site ? w.site.progress : null,
    siteNeed: w.site ? w.site.need : null,
    workers: countTasks(w),
  };
}

function setTask(wk, task) {
  wk.task = task; wk.state = 'idle'; wk.carry = 0; wk.target = null; wk.spot = null; wk.wait = 0;
}

// 居民下指令：優先調待命的人，其次從人數最多的任務抽人。回傳實際調動人數。
export function assignWorkers(w, task, count) {
  if (!TASKS.includes(task)) return 0;
  const counts = countTasks(w);
  const cands = w.workers
    .filter((k) => k.task !== task)
    .sort((a, b) => (a.task === 'idle' ? -1000 : -counts[a.task]) - (b.task === 'idle' ? -1000 : -counts[b.task]));
  const picked = cands.slice(0, count);
  picked.forEach((k) => setTask(k, task));
  return picked.length;
}

function moveTo(wk, tx, ty, dt, speed = SPEED) {
  const dx = tx - wk.x, dy = ty - wk.y, d = Math.hypot(dx, dy);
  if (d < 1.5) return true;
  const s = speed * dt;
  if (s >= d) { wk.x = tx; wk.y = ty; return true; }
  wk.x += (dx / d) * s; wk.y += (dy / d) * s;
  return false;
}

function wander(wk, w, dt, rx, ry) {
  if (!wk.spot) {
    wk.spot = { x: w.base.x + (w.rand() - 0.5) * rx, y: w.base.y + (w.rand() - 0.5) * ry };
    wk.wait = 0;
  }
  if (moveTo(wk, wk.spot.x, wk.spot.y, dt, 25)) {
    wk.wait += dt;
    if (wk.wait > 2 + w.rand() * 3) wk.spot = null;
  }
}

function nearestResource(w, wk, type) {
  let best = null, bd = Infinity;
  for (const r of w.res) {
    if (r.type !== type || r.left < 1) continue;
    const d = Math.hypot(r.x - wk.x, r.y - wk.y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

function finishSite(w) {
  w.houses.push({ x: w.site.x, y: w.site.y });
  w.mood = clamp(w.mood + 1.5, 0, 100);
  addLog(w, `🏠 第 ${w.houses.length} 間房子蓋好了`);
  w.site = null;
  w.siteTimer = 4;
}

function stepWorker(wk, w, dt) {
  switch (wk.task) {
    case 'gather_food':
    case 'gather_wood': {
      const type = wk.task === 'gather_food' ? 'food' : 'wood';
      if (wk.state === 'idle') {
        const r = nearestResource(w, wk, type);
        if (r) { wk.target = r; wk.state = 'go'; } else wander(wk, w, dt, 160, 120);
      } else if (wk.state === 'go') {
        if (moveTo(wk, wk.target.x, wk.target.y, dt)) { wk.state = 'work'; wk.timer = 1.5; }
      } else if (wk.state === 'work') {
        wk.timer -= dt;
        if (wk.timer <= 0) {
          if (wk.target.left >= 1) { wk.target.left -= 1; wk.carry = 1; wk.state = 'return'; }
          else wk.state = 'idle';
        }
      } else if (wk.state === 'return') {
        if (moveTo(wk, w.base.x, w.base.y, dt)) { w.stock[type] += wk.carry; wk.carry = 0; wk.state = 'idle'; }
      }
      break;
    }
    case 'build': {
      if (!w.site && wk.state !== 'idle' && wk.state !== 'wait') {
        if (wk.carry) { w.stock.wood += wk.carry; wk.carry = 0; }
        wk.state = 'idle';
      }
      if (wk.state === 'idle') {
        if (w.site) wk.state = 'fetch'; else wander(wk, w, dt, 160, 120);
      } else if (wk.state === 'fetch') {
        if (moveTo(wk, w.base.x, w.base.y, dt)) {
          if (w.stock.wood >= 1) { w.stock.wood -= 1; wk.carry = 1; wk.state = 'deliver'; }
          else { wk.state = 'wait'; wk.timer = 1.5; }
        }
      } else if (wk.state === 'wait') {
        wk.timer -= dt;
        if (wk.timer <= 0) wk.state = 'idle';
      } else if (wk.state === 'deliver') {
        if (moveTo(wk, w.site.x, w.site.y, dt)) {
          w.site.progress += 1; wk.carry = 0; wk.state = 'idle';
          if (w.site.progress >= w.site.need) finishSite(w);
        }
      }
      break;
    }
    case 'rest':
      wander(wk, w, dt, 80, 60);
      break;
    default:
      wander(wk, w, dt, 160, 120);
  }
}

export function stepWorld(w, dt) {
  w.t += dt;
  for (const r of w.res) r.left = Math.min(r.max, r.left + 0.04 * dt);
  if (!w.site && w.houses.length < MAX_HOUSES) {
    w.siteTimer -= dt;
    if (w.siteTimer <= 0) spawnSite(w);
  }
  let resting = 0;
  for (const k of w.workers) {
    stepWorker(k, w, dt);
    if (k.task === 'rest') resting++;
  }
  w.stock.food = Math.max(0, w.stock.food - w.workers.length * 0.03 * dt);
  let dm = resting * 0.025 - w.workers.length * 0.006 + w.houses.length * 0.004;
  if (w.stock.food <= 0) dm -= 0.2;
  w.mood = clamp(w.mood + dm * dt, 0, 100);
}

// 存檔：轉成純資料（工人的 target 是資源的參照，改存資源 id）
export function serializeWorld(w) {
  const { rand, ...rest } = w;
  return JSON.parse(JSON.stringify({ ...rest, workers: w.workers.map((k) => ({ ...k, target: k.target?.id ?? null })) }));
}

export function deserializeWorld(d) {
  const w = attachRng(JSON.parse(JSON.stringify(d)));
  const byId = new Map(w.res.map((r) => [r.id, r]));
  for (const k of w.workers) k.target = k.target ? byId.get(k.target) ?? null : null;
  return w;
}
