// 群體幫手（crowd）：大量無名小人，依指令搬運、採集、蓋房子。玩家不直接指揮，居民（AI 或規則腦）用 crowd.assign 派工。
// 模擬本身在 sim.js（從原型原樣移植）；這個檔案負責接上框架：
//   - 把小人、資源點、房子、工地、倉庫放進核心實體表（渲染層只讀實體）
//   - 指令 crowd.assign（開放給 AI）、crowd.drop（玩家空投）
//   - 給居民規則腦的「建議」（advisor）：從原型的 mockDecide 移植，依居民的偏好（residents.json 的 crowd.bias）打分
//   - 面板、AI 現況、存檔
import { createWorld, stepWorld, snapshot, assignWorkers, countTasks, TASKS, TASK_LABEL, TASK_COLOR, MAX_HOUSES, serializeWorld, deserializeWorld } from './sim.js';

const UNIT = 25; // 原型的 25 個世界單位 = 1 格
const KEYWORDS = {
  gather_food: /糧|食|餓|吃|飯|菜/,
  gather_wood: /木|柴|砍|材/,
  build: /蓋|房|屋|建/,
  rest: /休|慶|累|玩|開心|放鬆|歇/,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CARRY = { gather_food: 'food', gather_wood: 'wood', build: 'plank' };

// 原型 mockDecide 的打分方式（數值完全相同），回傳最想做的一件事，或 null
export function crowdAdvice(snap, bias = {}, memory = []) {
  const b = { gather_food: 1, gather_wood: 1, build: 1, rest: 1, ...bias };
  const c = snap.workers;
  const recent = memory.filter((m) => m.kind === 'announce' && snap.time - m.t < 45);
  const boost = (task) => (recent.some((m) => KEYWORDS[task].test(m.text)) ? 0.8 : 0);
  const urgency = {
    gather_food: clamp((40 - snap.food) / 40, 0, 1) + (c.gather_food < 5 ? 0.3 : 0) + boost('gather_food'),
    gather_wood: (snap.wood < 10 ? (10 - snap.wood) / 10 : 0) + (c.gather_wood < 3 ? 0.2 : 0) + boost('gather_wood'),
    build: snap.siteProgress !== null && snap.wood >= 4 && c.build < 6 ? 0.5 + boost('build') : boost('build') * 0.5,
    rest: clamp((60 - snap.mood) / 60, 0, 1) * 1.2 + boost('rest'),
  };
  const want = (u) => clamp(Math.round(2 + u * 8), 2, 10);
  const ranked = TASKS.map((t) => ({ t, u: urgency[t], score: (urgency[t] + 0.05) * b[t] })).sort((x, y) => y.score - x.score);
  for (const { t, u, score } of ranked) {
    if (score < 0.12) break;
    const count = want(u) - c[t];
    if (count <= 0) continue;
    return { task: t, count, score, say: sayFor(t, snap, count) };
  }
  return null;
}

function sayFor(task, snap, count) {
  switch (task) {
    case 'gather_food': return `糧食剩 ${snap.food}，派 ${count} 人去採集！`;
    case 'gather_wood': return `木材剩 ${snap.wood}，派 ${count} 人去砍柴。`;
    case 'build': return `材料夠了，派 ${count} 人去蓋房子！`;
    case 'rest': return snap.mood < 60 ? `大家心情只剩 ${snap.mood}，讓 ${count} 人休息吧。` : `大家辛苦了，讓 ${count} 人歇一歇。`;
    default: return TASK_LABEL[task];
  }
}

export default {
  id: 'crowd',
  version: '0.2.0',
  requires: [],
  optional: ['residents'],
  conflicts: [],
  emits: ['crowd:assigned', 'crowd:houseBuilt'],
  config: { workers: 24, seed: 7, origin: null },

  init(ctx) {
    const { entities } = ctx.services;
    const notify = (text) => ctx.services.notify?.(text);
    let w = createWorld(ctx.config.seed, ctx.config.workers);
    // 原型的倉庫位置對應到地圖的哪一格（預設：地圖中央）
    const isl = ctx.data.island || { size: { w: 32, h: 21 } };
    const origin = ctx.config.origin || { x: isl.size.w / 2, y: isl.size.h / 2 };
    const tx = (x) => origin.x + (x - w.base.x) / UNIT - 0.5;
    const ty = (y) => origin.y + (y - w.base.y) / UNIT - 0.5;

    // ---------- 實體同步 ----------
    let houseCount = -1;
    const workerAnim = (k) => {
      if (k.state === 'work') return k.task === 'gather_food' ? 'Pick' : 'Work';
      return null; // 走動或站著：交給渲染層依速度判斷（站著時用 idleAnim）
    };
    function rebuild() {
      entities.removeOwner('crowd');
      entities.add({ id: 'crowd.depot', kind: 'crowd.depot', owner: 'crowd', art: 'depot', x: tx(w.base.x), y: ty(w.base.y), label: '倉庫', state: { food: 0, wood: 0 } });
      for (const r of w.res) entities.add({ id: `crowd.res.${r.id}`, kind: 'crowd.resource', owner: 'crowd', art: r.type === 'wood' ? 'tree' : 'bush', x: tx(r.x), y: ty(r.y), state: { type: r.type, left: r.left, max: r.max } });
      w.houses.forEach((h, i) => entities.add({ id: `crowd.house.${i}`, kind: 'crowd.house', owner: 'crowd', art: 'house', x: tx(h.x), y: ty(h.y), state: { index: i } }));
      for (const k of w.workers) entities.add({ id: `crowd.w.${k.id}`, kind: 'crowd.worker', owner: 'crowd', art: 'worker', x: tx(k.x), y: ty(k.y), state: { index: k.id } });
      houseCount = w.houses.length;
      sync();
    }
    function sync() {
      if (w.houses.length !== houseCount) {
        for (let i = houseCount; i < w.houses.length; i++) entities.add({ id: `crowd.house.${i}`, kind: 'crowd.house', owner: 'crowd', art: 'house', x: tx(w.houses[i].x), y: ty(w.houses[i].y), state: { index: i } });
        houseCount = w.houses.length;
      }
      const depot = entities.get('crowd.depot');
      if (depot) { depot.state.food = w.stock.food; depot.state.wood = w.stock.wood; }
      for (const r of w.res) { const e = entities.get(`crowd.res.${r.id}`); if (e) e.state.left = r.left; }
      const site = entities.get('crowd.site');
      if (w.site) {
        if (!site) entities.add({ id: 'crowd.site', kind: 'crowd.site', owner: 'crowd', art: 'site', x: tx(w.site.x), y: ty(w.site.y), state: { progress: w.site.progress, need: w.site.need } });
        else { entities.move('crowd.site', tx(w.site.x), ty(w.site.y)); site.state.progress = w.site.progress; site.state.need = w.site.need; }
      } else if (site) entities.remove('crowd.site');
      for (const k of w.workers) {
        const e = entities.get(`crowd.w.${k.id}`);
        if (!e) continue;
        entities.move(e.id, tx(k.x), ty(k.y));
        e.state.task = k.task;
        e.state.tint = TASK_COLOR[k.task];
        e.state.carry = k.carry > 0 ? CARRY[k.task] ?? null : null;
        e.state.anim = workerAnim(k);
        e.state.idleAnim = k.task === 'rest' ? 'Rest' : 'Idle';
      }
    }
    rebuild();

    ctx.registerSystem({
      id: 'crowd.sim', order: 50,
      update(dt) {
        let rem = dt;
        const before = w.houses.length;
        while (rem > 0) { const s = Math.min(rem, 1 / 20); stepWorld(w, s); rem -= s; }
        if (w.houses.length > before) {
          ctx.emit('crowd:houseBuilt', { houses: w.houses.length });
          notify(`🏠 第 ${w.houses.length} 間房子蓋好了`);
        }
        sync();
      },
    });

    // ---------- 指令 ----------
    ctx.registerCommand({
      id: 'crowd.assign', label: '派人做事', description: '派幾位小人去做某件事（會從待命或人最多的工作抽人）',
      aiCallable: true,
      params: {
        task: { type: 'enum', values: TASKS, labels: TASKS.map((t) => TASK_LABEL[t]) },
        count: { type: 'int', min: 1, max: 10, clamp: true },
      },
      run({ task, count }, call) {
        const moved = assignWorkers(w, task, count);
        if (moved > 0) ctx.emit('crowd:assigned', { task, moved, actor: call.actor });
        sync();
        return { moved, label: TASK_LABEL[task] };
      },
    });
    ctx.registerCommand({
      id: 'crowd.drop', label: '空投物資', description: '從天上丟下糧食或木材（玩家專用）',
      params: { kind: { type: 'enum', values: ['food', 'wood'] } },
      run({ kind }) {
        const n = kind === 'food' ? 20 : 10;
        w.stock[kind] += n;
        notify(`🎁 天上掉下 ${n} 份${kind === 'food' ? '糧食' : '木材'}`);
        sync();
        return n;
      },
    });

    // ---------- 給居民規則腦的建議 ----------
    const residents = ctx.getModule('residents');
    residents?.registerAdvisor({
      module: 'crowd',
      // memory：居民的近期記憶，每則有 age（幾秒前）；換算成小鎮時間給原型的打分方式用
      suggest(resident, memory) {
        const snap = snapshot(w);
        const a = crowdAdvice(snap, resident.crowd?.bias, memory.map((m) => ({ ...m, t: snap.time - (m.age ?? 0) })));
        if (!a) return [];
        return [{ command: 'crowd.assign', args: { task: a.task, count: a.count }, score: a.score, say: a.say,
          remember: (r) => (r?.moved > 0 ? `我派了 ${r.moved} 人去${TASK_LABEL[a.task]}` : null) }];
      },
    });

    // ---------- 面板與 AI 現況 ----------
    ctx.registerPanel({
      id: 'crowd.town', title: '小鎮狀態', order: 10,
      view() {
        const s = snapshot(w);
        const c = countTasks(w);
        return [
          { type: 'stat', label: '糧食', value: s.food },
          { type: 'stat', label: '木材', value: s.wood },
          { type: 'stat', label: '房子', value: `${s.houses} / ${MAX_HOUSES}` },
          { type: 'bar', label: `心情 ${s.mood}`, value: s.mood / 100 },
          { type: 'list', items: [...TASKS, 'idle'].map((t) => ({ label: `${TASK_LABEL[t]}：${c[t]} 人` })) },
          { type: 'buttons', items: [
            { type: 'button', label: '空投 20 糧食', command: 'crowd.drop', args: { kind: 'food' } },
            { type: 'button', label: '空投 10 木材', command: 'crowd.drop', args: { kind: 'wood' } },
          ] },
        ];
      },
    });
    ctx.registerAIContext(() => {
      const s = snapshot(w);
      return [`小鎮：糧食 ${s.food}、木材 ${s.wood}、心情 ${s.mood}、房子 ${s.houses}/${s.maxHouses}`,
        `小人分工：${Object.entries(s.workers).map(([k, v]) => `${TASK_LABEL[k]} ${v}`).join('、')}`];
    });

    // ---------- 存檔 ----------
    ctx.registerSaveSlice({
      key: 'crowd', version: 1,
      serialize: () => serializeWorld(w),
      deserialize: (d) => { w = deserializeWorld(d); rebuild(); },
    });

    return { api: { snapshot: () => snapshot(w), world: () => w } };
  },
};
