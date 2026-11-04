// 任務與成長（quests）：任務、任務鏈、完成條件、獎勵、解鎖、小島繁榮度。全部由世界包 quests.json 定義（格式見 schema.js）。
//
// 新玩法怎麼接上主線（只加資料，不改程式）：
//   在 quests.json 加一個任務，條件寫成「數某個事件」，例如 { "type": "event", "event": "farming:harvested", "count": 3 }。
//   這個模組會自動訂閱條件裡出現的事件名稱；事件的欄位用 match 比對（例如 { "crop": "wheat" }）。
//   事件裡有 actor 欄位時，只算玩家做的（居民做的不算）。
// 解鎖：獎勵裡的 flags 會變成「旗標」，其他模組可以問 api.hasFlag('recipes.chair')（例如配方、商店商品只在解鎖後出現）。
// 任務需要的模組沒開時（module 欄位，或條件事件所屬的模組）：任務會被略過（不顯示、不給獎勵），後面的任務照樣解鎖，主線不會卡住。
// 回饋事件 quests:feedback：接到任務、進度、任務完成、領獎、升級、解鎖。
export default {
  id: 'quests',
  version: '0.1.0',
  requires: [],
  optional: [],
  conflicts: [],
  emits: ['quests:accepted', 'quests:ready', 'quests:completed', 'quests:levelUp', 'quests:unlocked', 'quests:feedback'],
  config: {},

  init(ctx) {
    const { inventory } = ctx.services;
    const data = ctx.data.quests && typeof ctx.data.quests === 'object' ? ctx.data.quests : {};
    const defs = (data.quests || []).filter((q) => q?.id);
    const byId = new Map(defs.map((q) => [q.id, q]));
    const levels = [...(data.levels || [])].sort((a, b) => a.points - b.points);
    const fb = (kind, text, extra = {}) => ctx.emit('quests:feedback', { kind, text, actor: 'player', ...extra });

    // 狀態：locked（還沒解鎖）→ active（進行中）→ ready（完成，等領獎）→ done；skipped（需要的模組沒開）
    let st = { quests: {}, flags: [], points: 0 };
    const q = (id) => (st.quests[id] ||= { state: 'locked', counts: {} });
    const flags = () => new Set(st.flags);
    const level = () => { let lv = levels[0]?.level ?? 1; for (const l of levels) if (st.points >= l.points) lv = l.level; return lv; };
    const levelInfo = () => {
      const lv = level(), cur = levels.find((l) => l.level === lv), next = levels.find((l) => l.points > st.points);
      return { level: lv, name: cur?.name ?? '', points: st.points, next: next?.points ?? null };
    };

    // 這個任務需要的模組有沒有開（外殼提供 services.modules；在 Node 測試沒有時當作都有開）
    const enabledMods = () => { try { return new Set(ctx.services.modules?.enabled?.() ?? []); } catch { return new Set(); } };
    const needsMods = (def) => {
      const m = new Set(def.module ? [def.module] : []);
      for (const c of def.conditions || []) if (c.type === 'event') m.add(c.event.split(':')[0]);
      return [...m];
    };
    const modsOk = (def) => {
      if (!ctx.services.modules) return true;
      const on = enabledMods();
      return needsMods(def).every((m) => m === 'core' || on.has(m));
    };

    // ---------- 條件 ----------
    const condProgress = (def, i, c) => {
      const s = q(def.id);
      switch (c.type) {
        case 'event': return { have: Math.min(s.counts[i] || 0, c.count ?? 1), need: c.count ?? 1 };
        case 'have': return { have: Math.min(inventory.count('player', c.item), c.qty), need: c.qty };
        case 'flag': return { have: flags().has(c.flag) ? 1 : 0, need: 1 };
        case 'quest': return { have: ['done', 'skipped'].includes(q(c.quest).state) ? 1 : 0, need: 1 };
        case 'level': return { have: Math.min(level(), c.level), need: c.level };
        default: return { have: 0, need: 1 };
      }
    };
    const condLabel = (c) => c.label || ({
      event: `完成「${c.event}」${c.count ?? 1} 次`,
      have: `準備 ${inventory.itemName(c.item)} ${c.qty} 個`,
      flag: `解鎖「${c.flag}」`,
      quest: `完成任務「${byId.get(c.quest)?.title ?? c.quest}」`,
      level: `小島繁榮度達到 ${c.level} 級`,
    })[c.type];
    const allMet = (def) => (def.conditions || []).every((c, i) => { const p = condProgress(def, i, c); return p.have >= p.need; });

    // ---------- 狀態推進 ----------
    function unlockable(def) {
      return (def.requires || []).every((r) => ['done', 'skipped'].includes(q(r).state))
        && (def.requiresFlags || []).every((f) => flags().has(f));
    }
    function accept(def, quiet = false) {
      q(def.id).state = 'active';
      q(def.id).counts = {};
      ctx.emit('quests:accepted', { id: def.id });
      if (!quiet) fb('progress', `新任務：${def.title}`, { quest: def.id });
    }
    function refresh() {
      let changed = true, guard = 0;
      while (changed && guard++ < 50) {
        changed = false;
        for (const def of defs) {
          const s = q(def.id);
          if (s.state === 'locked' && unlockable(def)) {
            if (!modsOk(def)) { s.state = 'skipped'; changed = true; continue; }
            if (def.auto !== false) { accept(def); changed = true; } else { s.state = 'available'; changed = true; }
          }
          if (s.state === 'active' && allMet(def)) {
            s.state = 'ready';
            ctx.emit('quests:ready', { id: def.id });
            fb('complete', `任務完成：${def.title}${def.autoClaim ? '' : '（去領獎勵吧！）'}`, { quest: def.id });
            if (def.autoClaim) claim(def);
            changed = true;
          }
          if (s.state === 'ready' && !allMet(def) && !def.autoClaim) { s.state = 'active'; changed = true; } // 例如把要交的東西用掉了
        }
      }
    }
    function addFlag(f) {
      if (st.flags.includes(f)) return;
      st.flags.push(f);
      ctx.emit('quests:unlocked', { flag: f });
      fb('unlock', `解鎖了新東西！`, { flag: f, quiet: true });
    }
    let claiming = false; // 領獎時發的物品會觸發背包事件：等領完獎、說完「領到獎勵」再判斷下一個任務
    function claim(def) {
      claiming = true;
      try { claimInner(def); } finally { claiming = false; }
      refresh();
    }
    function claimInner(def) {
      const s = q(def.id);
      for (const [i, c] of (def.conditions || []).entries()) if (c.type === 'have' && c.consume) inventory.remove('player', c.item, c.qty);
      s.state = 'done';
      const r = def.rewards || {};
      const got = [];
      for (const it of r.items || []) { const n = inventory.add('player', it.item, it.qty); if (n) got.push(`${inventory.itemName(it.item)} ×${n}`); }
      const before = level();
      st.points += r.points || 0;
      for (const f of r.flags || []) addFlag(f);
      ctx.emit('quests:completed', { id: def.id, rewards: r });
      fb('success', `領到獎勵：${[...got, r.points ? `繁榮度 +${r.points}` : null].filter(Boolean).join('、') || '大家的感謝'}`, { quest: def.id, sound: 'reward' });
      const after = level();
      if (after > before) {
        for (const l of levels) if (l.level > before && l.level <= after) for (const f of l.unlocks || []) addFlag(f);
        ctx.emit('quests:levelUp', { level: after });
        fb('unlock', `小島繁榮度升到 ${after} 級：${levels.find((l) => l.level === after)?.name ?? ''}！`, { sound: 'levelup' });
      }
    }

    // ---------- 自動訂閱條件裡的事件 ----------
    const matches = (c, payload) => {
      if (payload && 'actor' in payload && payload.actor !== 'player') return false; // 只算玩家做的
      return Object.entries(c.match || {}).every(([k, v]) => payload?.[k] === v);
    };
    const eventNames = new Set(defs.flatMap((d) => (d.conditions || []).filter((c) => c.type === 'event').map((c) => c.event)));
    for (const name of eventNames) {
      ctx.on(name, (payload) => {
        let hit = false;
        for (const def of defs) {
          const s = q(def.id);
          if (s.state !== 'active') continue;
          (def.conditions || []).forEach((c, i) => {
            if (c.type !== 'event' || c.event !== name || !matches(c, payload)) return;
            const need = c.count ?? 1;
            if ((s.counts[i] || 0) >= need) return;
            s.counts[i] = (s.counts[i] || 0) + 1;
            hit = true;
            if (s.counts[i] < need) fb('progress', `${def.title}：${condLabel(c)}（${s.counts[i]}/${need}）`, { quest: def.id, quiet: true });
          });
        }
        if (hit) refresh();
      });
    }
    ctx.on('core:inventoryChanged', (x) => { if (!first && !claiming && x.owner === 'player') refresh(); });

    // ---------- 指令 ----------
    const qid = { type: 'string', maxLen: 40 };
    ctx.registerCommand({
      id: 'quests.accept', label: '接受任務', params: { id: qid },
      canRun: ({ id }) => (q(id).state === 'available' ? true : '現在不能接這個任務'),
      run({ id }) { accept(byId.get(id)); refresh(); return true; },
    });
    ctx.registerCommand({
      id: 'quests.claim', label: '領取獎勵', params: { id: qid },
      canRun: ({ id }) => (q(id).state === 'ready' ? (allMet(byId.get(id)) ? true : '條件還沒有全部完成') : '這個任務還沒完成'),
      run({ id }) { claim(byId.get(id)); return true; },
    });

    // ---------- 面板 ----------
    ctx.registerPanel({
      id: 'quests.list', title: '任務', order: 5,
      view() {
        const info = levelInfo();
        const out = [{ type: 'bar', label: `小島繁榮度 ${info.level} 級 ${info.name}（${info.points}${info.next ? ` / ${info.next}` : ''}）`, value: info.next ? info.points / info.next : 1 }];
        const shown = defs.filter((d) => ['active', 'ready', 'available'].includes(q(d.id).state));
        shown.sort((a, b) => (a.line === 'main' ? -1 : 0) - (b.line === 'main' ? -1 : 0));
        if (!shown.length) out.push({ type: 'text', text: '目前沒有任務。到處走走，和居民聊聊吧！' });
        for (const d of shown.slice(0, 4)) {
          const s = q(d.id);
          out.push({ type: 'list', items: [
            { label: `${d.line === 'main' ? '⭐ ' : ''}${d.title}`, detail: d.description || '' },
            ...(d.conditions || []).map((c, i) => { const p = condProgress(d, i, c); return { label: `${p.have >= p.need ? '✅' : '⬜'} ${condLabel(c)}（${p.have}/${p.need}）` }; }),
          ] });
          if (s.state === 'ready') out.push({ type: 'button', label: `領取獎勵：${d.title}`, command: 'quests.claim', args: { id: d.id }, primary: true });
          if (s.state === 'available') out.push({ type: 'button', label: `接受任務：${d.title}`, command: 'quests.accept', args: { id: d.id } });
        }
        return out;
      },
    });
    ctx.registerAIContext(() => {
      const act = defs.filter((d) => q(d.id).state === 'active').map((d) => d.title);
      return act.length ? [`玩家正在進行的任務：${act.join('、')}`] : [];
    });

    // ---------- 存檔 ----------
    ctx.registerSaveSlice({
      key: 'quests', version: 1,
      serialize: () => JSON.parse(JSON.stringify(st)),
      deserialize(d) {
        st = { quests: {}, flags: Array.isArray(d?.flags) ? [...d.flags] : [], points: Number(d?.points) || 0 };
        for (const [id, s] of Object.entries(d?.quests || {})) st.quests[id] = { state: s.state || 'locked', counts: { ...(s.counts || {}) } };
        // 之前因為模組沒開而略過的任務：模組現在開了，就重新開放
        for (const def of defs) if (q(def.id).state === 'skipped' && modsOk(def)) q(def.id).state = 'locked';
        first = false;
        refresh();
      },
    });

    // 第一次判斷放在第一個遊戲更新：那時所有模組都啟動完了（才知道哪些模組有開），
    // 外殼也已經訂閱了回饋事件（玩家才看得到「新任務」）
    let first = true;
    ctx.registerSystem({ id: 'quests.first', order: 0, update() { if (first) { first = false; refresh(); } } });

    return { api: {
      hasFlag: (f) => flags().has(f),
      flags: () => [...st.flags],
      setFlag: (f) => { addFlag(f); refresh(); },
      level, levelInfo,
      state: (id) => q(id).state,
      active: () => defs.filter((d) => q(d.id).state === 'active').map((d) => d.id),
    } };
  },
};
