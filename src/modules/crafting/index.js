// 製作（crafting）：用材料依配方做出物品；有些配方要在工作台旁邊做；有些配方要先解鎖。
//
// 資料（世界包）：
//   recipes.json：{ id, name, inputs: [{item, qty}], output: {item, qty}, station?: 'workbench', seconds?: 1.5, unlock?: '旗標' }
//   island.json 的 placements：{ type: 'station', ref: 'workbench', x, y } → 地圖上的工作台
// 選用的模組：
//   actions（開著時製作要花一點時間，走開會中斷；材料在做完時才扣，中斷不會損失）
//   quests（配方的 unlock 旗標由任務獎勵解鎖；沒開任務模組時所有配方都能做）
// 回饋事件 crafting:feedback；crafting:crafted { actor, recipe, item, qty } 給任務計數。
const STATION_NAME = { workbench: '工作台' };

export default {
  id: 'crafting',
  version: '0.1.0',
  requires: [],
  optional: ['actions', 'quests'],
  conflicts: [],
  emits: ['crafting:crafted', 'crafting:feedback'],
  config: { reach: 2.2, defaultSeconds: 1.5, stationNames: {} },

  init(ctx) {
    const { entities, inventory } = ctx.services;
    const recipes = (ctx.data.recipes || []).filter((r) => r?.id);
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const stationName = (ref) => ctx.config.stationNames?.[ref] ?? STATION_NAME[ref] ?? ref;
    const fb = (kind, text, extra = {}) => ctx.emit('crafting:feedback', { kind, text, ...extra });

    // 工作台
    (ctx.data.island?.placements || []).forEach((p, i) => {
      if (p.type !== 'station') return;
      entities.add({ id: `station.${i}`, kind: 'station', owner: 'crafting', ref: p.ref, art: 'station', x: p.x, y: p.y, label: stationName(p.ref) });
    });
    ctx.registerEntityKind('station', {
      label: '工作台', solid: true, radius: 0.45,
      interactions: [{ label: (e) => `用${e.label}做東西`, command: 'crafting.useStation', args: (e) => ({ station: e.id }) }],
    });

    const posOf = (actor) => entities.get(actor === 'player' ? 'player' : `resident.${actor}`);
    const nearStation = (actor, ref) => {
      const p = posOf(actor);
      return !!p && entities.near(p.x, p.y, ctx.config.reach, { kind: 'station', filter: (e) => e.ref === ref }).length > 0;
    };
    const unlocked = (r) => !r.unlock || (ctx.getModule('quests')?.hasFlag(r.unlock) ?? true);
    const missing = (actor, r) => r.inputs.filter((s) => !inventory.has(actor, s.item, s.qty));
    const why = (actor, r) => {
      if (!unlocked(r)) return '這個配方還沒解鎖';
      if (r.station && !nearStation(actor, r.station)) return `要在${stationName(r.station)}旁邊才能做`;
      const m = missing(actor, r);
      if (m.length) return `材料不夠：還差${m.map((s) => `${inventory.itemName(s.item)} ${s.qty - inventory.count(actor, s.item)} 個`).join('、')}`;
      if (inventory.room(actor, r.output.item) < r.output.qty) return '背包滿了，先整理一下吧';
      if (ctx.getModule('actions')?.busy(actor)) return '手上還在忙';
      return true;
    };

    function finish(actor, r) {
      if (why(actor, r) !== true && !ctx.getModule('actions')) return { ok: false };
      if (missing(actor, r).length) { fb('fail', '材料不見了，沒有做成', { actor }); return { ok: false }; }
      inventory.removeAll(actor, r.inputs);
      const n = inventory.add(actor, r.output.item, r.output.qty);
      ctx.emit('crafting:crafted', { actor, recipe: r.id, item: r.output.item, qty: n });
      const p = posOf(actor);
      fb('success', `做好了：${inventory.itemName(r.output.item)} ×${n}`, { actor, at: p ? { x: p.x, y: p.y } : undefined, sound: 'craft' });
      return { ok: true, item: r.output.item, qty: n };
    }

    ctx.registerCommand({
      id: 'crafting.make', label: '製作', description: '用材料依配方做東西',
      params: { recipe: { type: 'ref', of: 'recipes' } },
      canRun: ({ recipe }, call) => why(call.actor, byId.get(recipe)),
      run({ recipe }, call) {
        const r = byId.get(recipe);
        const actions = ctx.getModule('actions');
        if (!actions) return finish(call.actor, r);
        const res = actions.start(call.actor, { label: `做${inventory.itemName(r.output.item)}`, seconds: r.seconds ?? ctx.config.defaultSeconds, onDone: ({ ok }) => { if (ok) finish(call.actor, r); } });
        return res.ok ? { started: true } : { started: false, reason: res.reason };
      },
    });
    let focusStation = null;
    ctx.registerCommand({
      id: 'crafting.useStation', label: '用工作台', params: { station: { type: 'entity', kind: 'station' } },
      run({ station }) {
        focusStation = entities.get(station).ref;
        fb('progress', `在「製作」面板選要做什麼吧！`, { actor: 'player' });
        return true;
      },
    });

    ctx.registerPanel({
      id: 'crafting.recipes', title: '製作', order: 35,
      view(call) {
        const list = recipes.filter(unlocked);
        if (!list.length) return [{ type: 'text', text: '還沒有可以做的東西。' }];
        const sorted = focusStation ? [...list].sort((a, b) => (b.station === focusStation) - (a.station === focusStation)) : list;
        return [
          { type: 'text', text: '材料夠了就能做。有些東西要在工作台旁邊做。' },
          ...sorted.map((r) => ({
            type: 'button', label: `${r.name}（${r.inputs.map((s) => `${inventory.itemName(s.item)}×${s.qty}`).join(' + ')}${r.station ? `，${stationName(r.station)}` : ''}）`,
            command: 'crafting.make', args: { recipe: r.id },
          })),
        ];
      },
    });
    ctx.on('quests:unlocked', (x) => {
      const r = recipes.filter((y) => y.unlock === x.flag);
      if (r.length) fb('unlock', `新配方：${r.map((y) => y.name).join('、')}`, { actor: 'player' });
    });

    ctx.registerSaveSlice({ key: 'crafting', version: 1, serialize: () => ({}), deserialize() {} }); // 目前沒有要存的狀態（保留切片給之後的配方圖鑑）
    return { api: { canMake: (actor, id) => why(actor, byId.get(id)) === true, recipes: () => recipes.map((r) => r.id) } };
  },
};
