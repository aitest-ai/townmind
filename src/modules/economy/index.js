// 經濟（economy）：錢包、商店買賣。要站在商店旁邊才能買賣。
// 資料：shop.json（商品、價格、解鎖）、island.json 的 placements { type: 'shop' }。物品的 value 決定賣出價格（× sellRate）。
// 選用：quests（商品的 unlock 旗標）。工具不能賣（避免小朋友不小心賣掉吃飯的傢伙）。
// 回饋事件 economy:feedback；economy:sold／bought 給任務計數。
export default {
  id: 'economy',
  version: '0.1.0',
  requires: [],
  optional: ['quests'],
  conflicts: [],
  emits: ['economy:sold', 'economy:bought', 'economy:feedback'],
  config: { reach: 2.4 },

  init(ctx) {
    const { entities, inventory } = ctx.services;
    const shop = ctx.data.shop && typeof ctx.data.shop === 'object' ? ctx.data.shop : {};
    const items = new Map((ctx.data.items || []).map((x) => [x.id, x]));
    const money = shop.currency || '貝幣';
    const rate = shop.sellRate ?? 0.5;
    const fb = (kind, text, extra = {}) => ctx.emit('economy:feedback', { kind, text, ...extra });
    let wallet = { player: shop.startCoins ?? 50 };
    const coins = (a) => wallet[a] ?? 0;

    (ctx.data.island?.placements || []).forEach((p, i) => {
      if (p.type === 'shop') entities.add({ id: `shop.${i}`, kind: 'shop', owner: 'economy', art: 'shop', x: p.x, y: p.y, label: shop.name || '商店' });
    });
    const posOf = (a) => entities.get(a === 'player' ? 'player' : `resident.${a}`);
    const atShop = (a) => { const p = posOf(a); return !!p && entities.near(p.x, p.y, ctx.config.reach, { kind: 'shop' }).length > 0; };
    const unlocked = (b) => !b.unlock || (ctx.getModule('quests')?.hasFlag(b.unlock) ?? true);
    const goods = () => (shop.buy || []).filter((b) => items.has(b.item) && unlocked(b));
    const priceOf = (item) => { const b = (shop.buy || []).find((x) => x.item === item); return b?.price ?? items.get(item)?.value ?? 0; };
    const sellPrice = (item) => { const v = items.get(item)?.value ?? 0; return v > 0 ? Math.max(1, Math.floor(v * rate)) : 0; };
    const sellable = (item) => items.has(item) && items.get(item).category !== 'tool' && sellPrice(item) > 0;

    ctx.registerCommand({
      id: 'economy.sell', label: '賣東西', params: { item: { type: 'ref', of: 'items' }, qty: { type: 'int', min: 1, max: 99, default: 1 } },
      canRun: ({ item, qty }, call) => {
        if (!atShop(call.actor)) return '要在商店旁邊才能賣東西';
        if (!sellable(item)) return items.get(item)?.category === 'tool' ? '工具不能賣喔' : '這個東西不能賣';
        return inventory.has(call.actor, item, qty) ? true : `背包裡的${inventory.itemName(item)}不夠`;
      },
      run({ item, qty }, call) {
        inventory.remove(call.actor, item, qty);
        const got = sellPrice(item) * qty;
        wallet[call.actor] = coins(call.actor) + got;
        ctx.emit('economy:sold', { actor: call.actor, item, qty, coins: got });
        fb('success', `賣了${inventory.itemName(item)} ×${qty}，得到 ${got} ${money}`, { actor: call.actor, sound: 'coin' });
        return got;
      },
    });
    ctx.registerCommand({
      id: 'economy.buy', label: '買東西', params: { item: { type: 'ref', of: 'items' }, qty: { type: 'int', min: 1, max: 99, default: 1 } },
      canRun: ({ item, qty }, call) => {
        if (!atShop(call.actor)) return '要在商店旁邊才能買東西';
        const b = (shop.buy || []).find((x) => x.item === item);
        if (!b) return '商店沒有賣這個';
        if (!unlocked(b)) return '這個商品還沒上架';
        if (coins(call.actor) < priceOf(item) * qty) return `${money}不夠：要 ${priceOf(item) * qty}，你有 ${coins(call.actor)}`;
        return inventory.room(call.actor, item) >= qty ? true : '背包滿了，先整理一下吧';
      },
      run({ item, qty }, call) {
        const cost = priceOf(item) * qty;
        wallet[call.actor] = coins(call.actor) - cost;
        inventory.add(call.actor, item, qty);
        ctx.emit('economy:bought', { actor: call.actor, item, qty, coins: cost });
        fb('success', `買了${inventory.itemName(item)} ×${qty}（${cost} ${money}）`, { actor: call.actor, sound: 'coin' });
        return cost;
      },
    });
    ctx.registerEntityKind('shop', { label: '商店', solid: true, radius: 0.5, interactions: [{ label: (e) => `逛逛${e.label}`, command: 'economy.browse', args: {} }] });
    ctx.registerCommand({ id: 'economy.browse', label: '逛商店', run: () => { fb('progress', '在「商店」面板選要買或賣的東西吧！', { actor: 'player' }); return true; } });

    ctx.registerPanel({
      id: 'economy.shop', title: shop.name || '商店', order: 55,
      view() {
        const here = atShop('player');
        const bag = inventory.list('player').filter((s) => sellable(s.item));
        return [
          { type: 'stat', label: `我的${money}`, value: coins('player') },
          { type: 'text', text: here ? '歡迎光臨！' : '走到商店旁邊才能買賣。' },
          ...(goods().length ? [{ type: 'buttons', items: goods().map((b) => ({ type: 'button', label: `買${inventory.itemName(b.item)}（${priceOf(b.item)}）`, command: 'economy.buy', args: { item: b.item, qty: 1 } })) }] : []),
          ...(bag.length ? [{ type: 'buttons', items: bag.slice(0, 8).map((s) => ({ type: 'button', label: `賣${s.name}（+${sellPrice(s.item)}）`, command: 'economy.sell', args: { item: s.item, qty: 1 } })) }] : []),
        ];
      },
    });
    ctx.on('quests:unlocked', (x) => {
      const g = (shop.buy || []).filter((b) => b.unlock === x.flag);
      if (g.length) fb('unlock', `商店上架了：${g.map((b) => inventory.itemName(b.item)).join('、')}`, { actor: 'player' });
    });

    ctx.registerSaveSlice({
      key: 'economy', version: 1,
      serialize: () => ({ wallet: { ...wallet } }),
      deserialize(d) { wallet = {}; for (const [a, n] of Object.entries(d?.wallet || {})) if (Number.isInteger(n) && n >= 0) wallet[a] = n; },
    });
    return { api: { coins, currency: () => money, sellPrice, priceOf } };
  },
};
