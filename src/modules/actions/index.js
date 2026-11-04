// 行動與工具（actions）：裝備工具、有持續時間的動作、成敗結果。其他模組透過 api 使用（optional: ['actions']）。
//
//   api.start(actor, {
//     label: '砍樹', seconds: 1.2,            // 動作要多久（遊戲秒數），會依工具的 toolSpeed 變快
//     tool: 'axe',                            // 選填：需要的工具；有的話自動裝備，沒有就不能開始
//     successChance: 1,                       // 選填：成功機率（0～1），用種子亂數決定，可重現
//     at: { x, y },                           // 選填：在哪裡做（回饋事件用）
//     cancelIfMoved: true,                    // 走開就中斷（預設 true）
//     onDone(outcome) {}                      // outcome = { ok: true|false, cancelled?: true }
//   }) → { ok, reason }
//   api.busy(actor) / api.progress(actor) / api.cancel(actor) / api.equipped(actor) / api.equip(actor, item)
//
// 「失敗」只代表這次沒成功（例如魚跑掉了），不扣東西、沒有懲罰。
// 回饋事件：actions:feedback（開始、完成、失敗、中斷）；actions:completed 給其他模組（例如任務）計數。
const posOf = (entities, actor) => entities.get(actor === 'player' ? 'player' : `resident.${actor}`);

export default {
  id: 'actions',
  version: '0.1.0',
  requires: [],
  optional: [],
  conflicts: [],
  emits: ['actions:started', 'actions:completed', 'actions:feedback', 'actions:equipped'],
  config: { moveTolerance: 0.4 },

  init(ctx) {
    const { entities, inventory } = ctx.services;
    const items = new Map((ctx.data.items || []).map((x) => [x.id, x]));
    const isTool = (id) => items.get(id)?.category === 'tool';
    const equipped = new Map(); // actor → item id
    const running = new Map();  // actor → { label, total, left, spec, start }
    const fb = (kind, text, extra = {}) => ctx.emit('actions:feedback', { kind, text, ...extra });

    function equip(actor, item) {
      if (!isTool(item)) return { ok: false, reason: '這不是工具' };
      if (!inventory.has(actor, item)) return { ok: false, reason: `背包裡沒有${inventory.itemName(item)}` };
      equipped.set(actor, item);
      ctx.emit('actions:equipped', { actor, item });
      return { ok: true };
    }

    function start(actor, spec = {}) {
      if (running.has(actor)) return { ok: false, reason: `正在${running.get(actor).label}，等一下喔` };
      const seconds = Math.max(0, Number(spec.seconds) || 0);
      if (spec.tool) {
        if (!inventory.has(actor, spec.tool)) return { ok: false, reason: `需要${inventory.itemName(spec.tool)}` };
        if (equipped.get(actor) !== spec.tool) equip(actor, spec.tool);
      }
      const speed = spec.tool ? (items.get(spec.tool)?.toolSpeed ?? 1) : 1;
      const p = posOf(entities, actor);
      const act = { label: spec.label || '做事', total: seconds / speed, left: seconds / speed, spec, start: p ? { x: p.x, y: p.y } : null };
      running.set(actor, act);
      ctx.emit('actions:started', { actor, label: act.label, seconds: act.total, tool: spec.tool ?? null });
      if (act.total <= 0) finish(actor, act);
      return { ok: true };
    }

    function finish(actor, act) {
      running.delete(actor);
      const chance = act.spec.successChance ?? 1;
      const ok = chance >= 1 || ctx.rng.next() < chance;
      ctx.emit('actions:completed', { actor, label: act.label, ok, tool: act.spec.tool ?? null });
      try { act.spec.onDone?.({ ok }); } catch (e) { ctx.log(`動作「${act.label}」完成時出錯：${e.message}`); }
      if (!ok) fb('fail', act.spec.failText || `${act.label}沒有成功，再試一次吧！`, { actor, at: act.spec.at });
    }

    function cancel(actor, why = '動作被打斷了') {
      const act = running.get(actor);
      if (!act) return false;
      running.delete(actor);
      try { act.spec.onDone?.({ ok: false, cancelled: true }); } catch { /* 忽略 */ }
      fb('fail', why, { actor, at: act.spec.at, quiet: actor !== 'player' });
      return true;
    }

    ctx.registerSystem({
      id: 'actions.tick', order: 20,
      update(dt) {
        for (const [actor, act] of [...running]) {
          if (act.spec.cancelIfMoved !== false && act.start) {
            const p = posOf(entities, actor);
            if (p && Math.hypot(p.x - act.start.x, p.y - act.start.y) > ctx.config.moveTolerance) { cancel(actor, `走開了，${act.label}停下來了`); continue; }
          }
          act.left -= dt;
          if (act.left <= 0) finish(actor, act);
        }
      },
    });

    // ---------- 指令 ----------
    const tools = (actor) => inventory.list(actor).filter((s) => isTool(s.item));
    ctx.registerCommand({
      id: 'actions.equip', label: '拿起工具', description: '把背包裡的工具拿在手上',
      params: { item: { type: 'ref', of: 'items' } },
      canRun: ({ item }, call) => { const r = isTool(item) ? (inventory.has(call.actor, item) ? true : `背包裡沒有${inventory.itemName(item)}`) : '這不是工具'; return r; },
      run({ item }, call) { equip(call.actor, item); ctx.emit('actions:feedback', { kind: 'success', text: `拿起了${inventory.itemName(item)}`, actor: call.actor, quiet: true }); return item; },
    });
    ctx.registerCommand({ id: 'actions.unequip', label: '收起工具', run: (_, call) => { equipped.delete(call.actor); return true; } });
    ctx.registerCommand({ id: 'actions.cancel', label: '停下來', available: (call) => (running.has(call.actor) ? true : '現在沒有在做事'), run: (_, call) => cancel(call.actor, '停下來了') });

    // ---------- 面板 ----------
    ctx.registerPanel({
      id: 'actions.progress', title: '正在做', order: 1, placement: 'hud',
      view() {
        const act = running.get('player');
        if (!act) return [];
        return [{ type: 'bar', label: `${act.label}…`, value: act.total ? 1 - act.left / act.total : 1 }, { type: 'button', label: '停下來', command: 'actions.cancel' }];
      },
    });
    ctx.registerPanel({
      id: 'actions.tools', title: '工具', order: 15,
      view() {
        const list = tools('player');
        const eq = equipped.get('player');
        if (!list.length) return [{ type: 'text', text: '背包裡還沒有工具。' }];
        return [
          { type: 'stat', label: '手上拿著', value: eq ? inventory.itemName(eq) : '（空手）' },
          { type: 'buttons', items: list.map((s) => ({ type: 'button', label: s.name, command: 'actions.equip', args: { item: s.item }, primary: s.item === eq })) },
        ];
      },
    });

    // 工具被用掉、送掉時，手上就不再拿著
    ctx.on('core:inventoryChanged', (x) => { if (x.qty <= 0 && equipped.get(x.owner) === x.item) equipped.delete(x.owner); });

    ctx.registerSaveSlice({
      key: 'actions', version: 1,
      serialize: () => ({ equipped: Object.fromEntries(equipped) }),
      deserialize(d) { equipped.clear(); for (const [a, i] of Object.entries(d?.equipped || {})) if (isTool(i)) equipped.set(a, i); },
    });

    return { api: {
      start, cancel, equip,
      busy: (actor) => running.has(actor),
      progress: (actor) => { const a = running.get(actor); return a ? { label: a.label, done: a.total ? 1 - a.left / a.total : 1 } : null; },
      equipped: (actor) => equipped.get(actor) ?? null,
    } };
  },
};
