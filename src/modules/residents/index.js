// AI 居民（residents）：有個性、有記憶、有自己生活的居民。
//
// 決策（規則腦，免費、離線）：
//   其他模組透過 api.registerAdvisor({ module, suggest(resident, memory) }) 提出「這位居民現在可以做什麼」的建議，
//   每則建議是 { command, args, score, say }。居民依「興趣」（residents.json 的 interests[模組id]）加權後挑分數最高的，
//   再用 ctx.runCommand(..., { as: 'ai', actor }) 執行——核心會強制只能做「已啟用模組、aiCallable、此刻 available」的指令。
//   沒有任何建議時，居民就說口頭禪、休息一下。
// LLM 腦：prompt.js 已備好（行動清單＝describeCommandsForAI、現況＝collectAIContext），目前不接 AI。
import { buildPrompt, validateDecision } from './prompt.js';

const MEMORY_MAX = 8;
const CARD_LIMITS = { personality: 120, goal: 120 };

export default {
  id: 'residents',
  version: '0.2.0',
  requires: [],
  optional: ['social', 'quests-diary'],
  conflicts: [],
  emits: ['residents:decided', 'residents:announced'],
  config: { thinkEvery: 7, thinkJitter: 3, sayFor: 8, ring: null },

  init(ctx) {
    const { entities } = ctx.services;
    const notify = (text) => ctx.services.notify?.(text);
    const cfg = ctx.config;
    const advisors = [];
    let clock = 0;

    const homes = new Map((ctx.data.island?.placements || []).filter((p) => p.type === 'home').map((p) => [p.ref, p]));
    const spawn = ctx.data.island?.spawn || { x: 0, y: 0 };
    const list = (ctx.data.residents || []).map((r, i) => ({
      id: r.id, name: r.name, role: r.role, color: r.color, look: r.look || {}, model: r.model || null,
      interests: r.interests || {}, likes: r.likes || [], crowd: r.crowd || null,
      card: { personality: r.card?.personality ?? '', goal: r.card?.goal ?? '', catchphrase: r.card?.catchphrase ?? '' },
      memory: [], say: '', sayUntil: 0, nextAt: 2 + i * 1.5, busy: false,
    }));
    const byId = new Map(list.map((r) => [r.id, r]));

    function placeEntities() {
      entities.removeOwner('residents');
      list.forEach((r, i) => {
        // 站位：config.ring（圍成一圈，原型小鎮用）＞ 家門口 ＞ 出生點附近
        const ring = cfg.ring;
        const ang = (i / list.length) * Math.PI * 2 - Math.PI / 2;
        const h = ring ? { x: ring.x + Math.cos(ang) * ring.rx, y: ring.y + Math.sin(ang) * ring.ry }
          : homes.has(r.id) ? { x: homes.get(r.id).x, y: homes.get(r.id).y + 0.9 }
          : { x: spawn.x + (i % 3) - 1, y: spawn.y + 1 + Math.floor(i / 3) };
        entities.add({ id: `resident.${r.id}`, kind: 'resident', owner: 'residents', ref: r.id, x: h.x, y: h.y, label: r.name,
          state: { color: r.color, role: r.role, look: r.look, model: r.model, say: '', busy: false } });
      });
    }
    function syncEntity(r) {
      const e = entities.get(`resident.${r.id}`);
      if (e) { e.state.say = clock < r.sayUntil ? r.say : ''; e.state.busy = r.busy; }
    }
    placeEntities();

    const remember = (r, kind, text) => {
      r.memory.push({ t: clock, kind, text });
      if (r.memory.length > MEMORY_MAX) r.memory.shift();
    };

    // 規則腦：收集建議 → 依興趣加權 → 執行最好的一個
    function think(r) {
      const memory = r.memory.map((m) => ({ kind: m.kind, text: m.text, age: clock - m.t }));
      const cands = [];
      for (const a of advisors) {
        let got = [];
        try { got = a.suggest(r, memory) || []; } catch (e) { ctx.log(`建議來源「${a.module}」出錯：${e.message}`); }
        for (const c of got) if (c?.command) cands.push({ ...c, module: a.module, weighted: (Number(c.score) || 0) * (r.interests[a.module] ?? 1) });
      }
      cands.sort((x, y) => y.weighted - x.weighted);
      let said = null;
      for (const c of cands) {
        const res = ctx.runCommand(c.command, c.args || {}, { as: 'ai', actor: r.id });
        if (!res.ok) continue; // 被核心擋下（模組沒開、不開放給 AI、參數不對）：換下一個建議
        said = c.say || r.card.catchphrase;
        const mem = c.remember?.(res.result);
        if (mem) { remember(r, 'action', mem); notify(`${r.name}：${said}（${mem.replace(/^我/, '')}）`); }
        ctx.emit('residents:decided', { actor: r.id, command: c.command, args: c.args, say: said });
        break;
      }
      r.say = said ?? (r.card.catchphrase || '今天也好好過。');
      r.sayUntil = clock + cfg.sayFor;
      r.nextAt = clock + cfg.thinkEvery + ctx.rng.next() * cfg.thinkJitter;
    }

    ctx.registerSystem({
      id: 'residents.think', order: 40,
      update(dt) {
        clock += dt;
        for (const r of list) {
          if (!r.busy && clock >= r.nextAt) think(r);
          syncEntity(r);
        }
      },
    });

    // ---------- 玩家指令 ----------
    ctx.registerCommand({
      id: 'residents.announce', label: '發公告', description: '對全島居民說一句話，會影響他們接下來的想法',
      params: { text: { type: 'string', maxLen: 40, truncate: true, userText: true } },
      canRun: ({ text }) => (text.trim() ? true : '先輸入一句公告再按「發公告」喔'),
      run({ text }) {
        for (const r of list) { remember(r, 'announce', text); r.nextAt = clock + 0.5 + ctx.rng.next() * 2; }
        notify(`📢 你發布公告：${text}`);
        ctx.emit('residents:announced', { text });
        return true;
      },
    });
    ctx.registerCommand({
      id: 'residents.editCard', label: '修改角色卡', description: '修改居民的性格或目標',
      params: {
        who: { type: 'ref', of: 'residents' },
        field: { type: 'enum', values: Object.keys(CARD_LIMITS) },
        value: { type: 'string', maxLen: 120, userText: true },
      },
      canRun: ({ value }) => (value.trim() ? true : '內容不能是空的'),
      run({ who, field, value }) {
        byId.get(who).card[field] = value.slice(0, CARD_LIMITS[field]);
        notify(`✏️ ${byId.get(who).name} 的${field === 'goal' ? '目標' : '性格'}改好了`);
        return true;
      },
    });

    // ---------- 面板 ----------
    ctx.registerPanel({
      id: 'residents.list', title: '居民', order: 20,
      view() {
        return [
          { type: 'list', items: list.map((r) => ({ label: `${r.name}（${r.role}）`, detail: r.busy ? '思考中…' : (r.say || '（還沒說話）') })) },
          { type: 'input', name: 'ann', label: '發公告（居民會參考）', maxLen: 40, placeholder: '例如：大家多種一點菜' },
          { type: 'button', label: '發公告', command: 'residents.announce', argsFrom: { text: 'ann' }, primary: true },
        ];
      },
    });
    ctx.registerPanel({
      id: 'residents.card', title: '角色卡', order: 800,
      view() {
        return [
          { type: 'select', name: 'who', label: '居民', options: list.map((r) => ({ value: r.id, label: `${r.name}（${r.role}）` })) },
          { type: 'input', name: 'value', label: '新的性格或目標（最多 120 字）', maxLen: 120 },
          { type: 'buttons', items: [
            { type: 'button', label: '更新性格', command: 'residents.editCard', args: { field: 'personality' }, argsFrom: { who: 'who', value: 'value' } },
            { type: 'button', label: '更新目標', command: 'residents.editCard', args: { field: 'goal' }, argsFrom: { who: 'who', value: 'value' } },
          ] },
          { type: 'list', items: list.map((r) => ({ label: r.name, detail: `性格：${r.card.personality}／目標：${r.card.goal}` })) },
        ];
      },
    });

    // ---------- 存檔 ----------
    ctx.registerSaveSlice({
      key: 'residents', version: 1,
      serialize: () => ({ clock, list: list.map((r) => ({ id: r.id, card: r.card, memory: r.memory, say: r.say, sayUntil: r.sayUntil, nextAt: r.nextAt })) }),
      deserialize: (d) => {
        clock = Number(d?.clock) || 0;
        for (const s of d?.list || []) {
          const r = byId.get(s.id);
          if (!r) continue; // 世界包已經沒有這位居民：略過（資料仍在原始存檔裡）
          Object.assign(r.card, s.card || {});
          r.memory = Array.isArray(s.memory) ? s.memory.slice(-MEMORY_MAX) : [];
          r.say = s.say || ''; r.sayUntil = s.sayUntil || 0; r.nextAt = s.nextAt ?? r.nextAt;
        }
      },
    });

    return {
      api: {
        // 其他模組提出「居民可以做什麼」的建議（規則腦用）
        registerAdvisor(advisor) {
          if (typeof advisor?.suggest !== 'function' || !advisor.module) throw new Error('advisor 需要 module 與 suggest');
          advisors.push(advisor);
        },
        list: () => list.map((r) => ({ id: r.id, name: r.name, role: r.role, say: r.say })),
        get: (id) => byId.get(id) ?? null,
        // 給之後的 LLM 腦：此刻這位居民的提示詞
        promptFor(id) {
          const r = byId.get(id);
          if (!r) return null;
          return buildPrompt({ resident: r, actions: ctx.describeCommandsForAI({ actor: id }), context: ctx.collectAIContext({ actor: id }), memory: r.memory });
        },
        validateDecision,
      },
    };
  },
};
