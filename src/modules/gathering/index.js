// 採集（gathering）：砍樹、摘果子、敲石頭、撿貝殼；採過的東西過幾天會再長回來。
//
// 這個模組只用核心提供的介面，證明「新增一個模組不需要修改 src/core」：
//   - 世界包 island.json 的 species 放置 → 建立實體（kind = 物種的 kind，例如 tree、rock）
//   - registerEntityKind 宣告互動 → 外殼自動出現「砍樹」「撿起來」按鈕
//   - gathering.harvest 指令（aiCallable）：玩家與居民都用同一個指令；要站在旁邊、背包要有空間、有時要工具
//   - 居民的規則腦建議（optional: residents）：身邊有能採的東西就去採，依居民的 interests.gathering 加權
//   - core:dayStarted → 再生；離線補算時核心也會發 dayStarted（offline: true），所以不需要另外處理
//   - 面板、AI 現況、存檔（只存「誰被採過、哪天長回來」）
const KINDS = ['tree', 'bush', 'rock', 'forage'];
const VERB = { tree: '砍樹', bush: '摘果子', rock: '敲石頭', forage: '撿起來' };
const DONE = { tree: '砍了', bush: '摘了', rock: '敲了', forage: '撿到' };

export default {
  id: 'gathering',
  version: '0.1.0',
  requires: [],
  optional: ['residents', 'actions'],
  conflicts: [],
  emits: ['gathering:harvested', 'gathering:regrown', 'gathering:feedback'],
  // seconds：開了「行動與工具」時，採集要花多久（物種可以用 actionSeconds 自己指定）
  config: { reach: 2.2, toolsByKind: { tree: 'axe' }, seconds: { tree: 1.4, rock: 1.4, bush: 0.8, forage: 0.5 } },

  init(ctx) {
    const { entities, inventory, time } = ctx.services;
    const notify = (text) => ctx.services.notify?.(text);
    const species = new Map((ctx.data.species || []).filter((s) => KINDS.includes(s.kind)).map((s) => [s.id, s]));
    const hasItem = (id) => (ctx.data.items || []).some((x) => x.id === id);
    const nameOf = (actor) => (actor === 'player' ? '你' : ctx.getModule('residents')?.get(actor)?.name ?? actor);
    const today = () => time?.day ?? 1;

    // 工具：物種可以自己指定 tool；否則看 config.toolsByKind；世界包沒有這個物品時就不需要工具
    const toolFor = (sp) => {
      const t = sp.tool ?? ctx.config.toolsByKind?.[sp.kind] ?? null;
      return t && hasItem(t) ? t : null;
    };

    // ---------- 實體 ----------
    const ids = [];
    (ctx.data.island?.placements || []).forEach((p, i) => {
      if (p.type !== 'species' || !species.has(p.ref)) return;
      const sp = species.get(p.ref);
      const id = `gather.${i}`;
      entities.add({ id, kind: sp.kind, owner: 'gathering', ref: sp.id, x: p.x, y: p.y, label: sp.name, state: { depleted: false, regrowDay: null } });
      ids.push(id);
    });

    const posOf = (actor) => entities.get(actor === 'player' ? 'player' : `resident.${actor}`);
    const distTo = (actor, ent) => { const p = posOf(actor); return p ? Math.hypot(p.x - ent.x, p.y - ent.y) : Infinity; };
    const roomFor = (actor, sp) => sp.yield.some((s) => inventory.room(actor, s.item) > 0);

    // ---------- 指令 ----------
    ctx.registerCommand({
      id: 'gathering.harvest', label: '採集', description: '採集身邊的樹、灌木、石頭或撿拾物，收穫放進背包',
      aiCallable: true,
      params: { target: { type: 'entity', kind: KINDS, owner: 'gathering', choices: (call) => nearbyReady(call.actor).map((e) => e.id) } },
      canRun({ target }, call) {
        const ent = entities.get(target), sp = species.get(ent.ref);
        if (ent.state.depleted) return `${sp.name}還沒長回來（第 ${ent.state.regrowDay} 天會恢復）`;
        if (distTo(call.actor, ent) > ctx.config.reach) return '走近一點才能採集';
        const tool = toolFor(sp);
        if (tool && !inventory.has(call.actor, tool)) return `需要${inventory.itemName(tool)}`;
        if (!roomFor(call.actor, sp)) return '背包滿了，先整理一下吧';
        if (ctx.getModule('actions')?.busy(call.actor)) return '手上還在忙';
        return true;
      },
      // 有「行動與工具」：變成要花一點時間的動作（走開會中斷）；沒有：馬上採到
      run({ target }, call) {
        const actions = ctx.getModule('actions');
        const ent = entities.get(target), sp = species.get(ent.ref);
        if (!actions) return giveYield(target, call.actor);
        const r = actions.start(call.actor, {
          label: species.get(ent.ref)?.actionLabel ?? VERB[sp.kind], seconds: sp.actionSeconds ?? ctx.config.seconds?.[sp.kind] ?? 1,
          tool: toolFor(sp), at: { x: ent.x, y: ent.y },
          onDone: ({ ok }) => { if (ok && !entities.get(target)?.state.depleted) giveYield(target, call.actor); },
        });
        return r.ok ? { started: true } : { started: false, reason: r.reason };
      },
    });

    function giveYield(target, actor) {
      const call = { actor };
      {
        const ent = entities.get(target), sp = species.get(ent.ref);
        const got = [];
        for (const s of sp.yield) {
          const n = inventory.add(call.actor, s.item, s.qty);
          if (n > 0) got.push({ item: s.item, qty: n });
        }
        const regrowDay = today() + (sp.regrowDays ?? 1);
        entities.update(target, { state: { depleted: true, regrowDay } });
        const text = got.map((g) => `${inventory.itemName(g.item)} ×${g.qty}`).join('、');
        notify(`${sp.kind === 'tree' ? '🪓' : sp.kind === 'rock' ? '⛏️' : '🧺'} ${nameOf(call.actor)}${DONE[sp.kind]}${sp.name}，得到 ${text}`);
        ctx.emit('gathering:harvested', { actor: call.actor, species: sp.id, items: got, target });
        ctx.emit('gathering:feedback', { kind: 'success', text: `得到 ${text}`, actor: call.actor, at: { x: ent.x, y: ent.y }, entity: target, sound: sp.kind === 'tree' ? 'chop' : 'pick', quiet: call.actor !== 'player' });
        return { items: got, regrowDay };
      }
    }

    for (const kind of KINDS) {
      ctx.registerEntityKind(kind, {
        label: kind,
        // 樹、灌木、石頭會擋路（玩家會繞過去）；地上的貝殼不擋
        solid: kind !== 'forage', radius: kind === 'bush' ? 0.36 : 0.42,
        interactions: [{ label: (e) => `${species.get(e.ref)?.actionLabel ?? VERB[kind]}（${e.label}）`, command: 'gathering.harvest', args: (e) => ({ target: e.id }) }],
      });
    }

    // ---------- 再生 ----------
    ctx.on('core:dayStarted', ({ day }) => {
      let n = 0;
      for (const id of ids) {
        const e = entities.get(id);
        if (e?.state.depleted && e.state.regrowDay <= day) { entities.update(id, { state: { depleted: false, regrowDay: null } }); n++; }
      }
      if (n) ctx.emit('gathering:regrown', { day, count: n });
    });

    // ---------- 給居民的建議 ----------
    function nearbyReady(actor) {
      const p = posOf(actor);
      if (!p) return [];
      return entities.near(p.x, p.y, ctx.config.reach, { kind: KINDS, filter: (e) => e.owner === 'gathering' && !e.state.depleted });
    }
    ctx.getModule('residents')?.registerAdvisor({
      module: 'gathering',
      suggest(resident) {
        const e = nearbyReady(resident.id).find((x) => {
          const sp = species.get(x.ref), tool = toolFor(sp);
          return roomFor(resident.id, sp) && (!tool || inventory.has(resident.id, tool));
        });
        if (!e) return [];
        return [{ command: 'gathering.harvest', args: { target: e.id }, score: 0.4, say: `${e.label}可以採了，我來${VERB[e.kind]}！` }];
      },
    });

    // ---------- 面板與 AI 現況 ----------
    const summary = () => {
      const by = new Map();
      for (const id of ids) {
        const e = entities.get(id); if (!e) continue;
        const r = by.get(e.ref) || { name: e.label, ready: 0, total: 0 };
        r.total++; if (!e.state.depleted) r.ready++;
        by.set(e.ref, r);
      }
      return [...by.values()];
    };
    ctx.registerPanel({
      id: 'gathering.status', title: '採集', order: 30,
      view() {
        return [
          { type: 'text', text: '走到樹、灌木、石頭或貝殼旁邊，按畫面下方的按鈕就能採集。採過的東西過幾天會長回來。' },
          { type: 'list', items: summary().map((r) => ({ label: `${r.name}：可以採 ${r.ready}／${r.total}` })) },
        ];
      },
    });
    ctx.registerAIContext((call) => {
      const near = call.actor ? nearbyReady(call.actor) : [];
      const s = summary().map((r) => `${r.name} ${r.ready}/${r.total}`).join('、');
      return [`島上可以採集的東西：${s}`, ...(near.length ? [`身邊可以採：${near.map((e) => e.label).join('、')}`] : [])];
    });

    // ---------- 存檔：只存被採過的 ----------
    ctx.registerSaveSlice({
      key: 'gathering', version: 1,
      serialize: () => ({ depleted: ids.map((id) => entities.get(id)).filter((e) => e?.state.depleted).map((e) => ({ id: e.id, ref: e.ref, regrowDay: e.state.regrowDay })) }),
      deserialize(d) {
        for (const id of ids) entities.update(id, { state: { depleted: false, regrowDay: null } });
        for (const x of d?.depleted || []) {
          const e = entities.get(x.id);
          if (e && e.ref === x.ref) entities.update(x.id, { state: { depleted: true, regrowDay: x.regrowDay } }); // 地圖改過、對不上的就略過
        }
      },
    });

    return { api: { summary } };
  },
};
