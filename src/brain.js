// 居民的「大腦」：規則腦（免費、離線）與 AI 腦（走 /api/decide）共用同一個輸出格式。
// 不管誰決策，結果一律先過 validate，AI 再怎麼胡說也只能從允許清單裡選。
import { TASKS, TASK_LABEL } from './world.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function validate(raw) {
  try {
    const say = String(raw?.say ?? '').slice(0, 60);
    const a = raw?.action ?? {};
    if (a.type === 'assign' && TASKS.includes(a.task)) {
      const count = clamp(Math.round(Number(a.count) || 1), 1, 10);
      return { say, action: { type: 'assign', task: a.task, count } };
    }
    return { say, action: { type: 'wait' } };
  } catch {
    return { say: '', action: { type: 'wait' } };
  }
}

const KEYWORDS = {
  gather_food: /糧|食|餓|吃|飯|菜/,
  gather_wood: /木|柴|砍|材/,
  build: /蓋|房|屋|建/,
  rest: /休|慶|累|玩|開心|放鬆|歇/,
};

export function mockDecide(npc, snap, memory = []) {
  const b = npc.card.bias;
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

  const ranked = TASKS.map((t) => ({ t, u: urgency[t], score: (urgency[t] + 0.05) * b[t] }))
    .sort((x, y) => y.score - x.score);

  for (const { t, u, score } of ranked) {
    if (score < 0.12) break;
    const count = want(u) - c[t];
    if (count <= 0) continue;
    return {
      say: sayFor(t, snap, count),
      action: { type: 'assign', task: t, count },
    };
  }
  return { say: npc.card.catchphrase || '目前一切平穩。', action: { type: 'wait' } };
}

function sayFor(task, snap, count) {
  switch (task) {
    case 'gather_food': return `糧食剩 ${snap.food}，派 ${count} 人去採集！`;
    case 'gather_wood': return `木材剩 ${snap.wood}，派 ${count} 人去砍柴。`;
    case 'build': return `材料夠了，派 ${count} 人去蓋房子！`;
    case 'rest': return snap.mood < 60
      ? `大家心情只剩 ${snap.mood}，讓 ${count} 人休息吧。`
      : `大家辛苦了，讓 ${count} 人歇一歇。`;
    default: return TASK_LABEL[task];
  }
}

export async function llmDecide(npc, snap, memory = []) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch('/api/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ npc: { name: npc.name, role: npc.role, card: npc.card }, snapshot: snap, memory: memory.slice(-6) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return validate(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
