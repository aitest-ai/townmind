// 背包：每個擁有者（'player'、居民 id……）一個背包。物品定義來自世界包 items（stack＝每格可疊幾個）。
// 不依賴瀏覽器。數量變動時發 core:inventoryChanged { owner, item, delta, qty }。

export function createInventory({ items = [], slots = 20 } = {}) {
  let emit = () => {};
  const defs = new Map((items || []).map((x) => [x.id, x]));
  const bags = new Map(); // owner → Map(item → qty)
  const bag = (owner) => { if (!bags.has(owner)) bags.set(owner, new Map()); return bags.get(owner); };
  const stackOf = (item) => Math.max(1, defs.get(item)?.stack ?? 99);
  const slotsUsed = (b) => [...b].reduce((n, [item, q]) => n + Math.ceil(q / stackOf(item)), 0);

  const api = {
    slots,
    itemName: (item) => defs.get(item)?.name ?? item,
    item: (item) => defs.get(item) ?? null,
    count: (owner, item) => bag(owner).get(item) ?? 0,
    has: (owner, item, qty = 1) => api.count(owner, item) >= qty,
    list: (owner) => [...bag(owner)].filter(([, q]) => q > 0).map(([item, qty]) => ({ item, qty, name: api.itemName(item) })),
    // 最多還能放幾個
    room(owner, item) {
      if (!defs.has(item)) return 0;
      const b = bag(owner), s = stackOf(item), q = b.get(item) ?? 0;
      const partial = q % s ? s - (q % s) : 0;
      return partial + Math.max(0, slots - slotsUsed(b)) * s;
    },
    // 放進背包，回傳實際放進去的數量（滿了就少放，不會丟錯）
    add(owner, item, qty = 1) {
      if (!defs.has(item) || !(qty > 0)) return 0;
      const n = Math.min(Math.floor(qty), api.room(owner, item));
      if (n <= 0) return 0;
      const b = bag(owner);
      b.set(item, (b.get(item) ?? 0) + n);
      emit('core:inventoryChanged', { owner, item, delta: n, qty: b.get(item) });
      return n;
    },
    // 全部拿得出來才拿，否則什麼都不動並回傳 false
    remove(owner, item, qty = 1) {
      const b = bag(owner), have = b.get(item) ?? 0;
      if (!(qty > 0) || have < qty) return false;
      if (have === qty) b.delete(item); else b.set(item, have - qty);
      emit('core:inventoryChanged', { owner, item, delta: -qty, qty: have - qty });
      return true;
    },
    // 一次拿多樣（製作用）：全部夠才拿
    removeAll(owner, stacks) {
      if (!stacks.every((s) => api.has(owner, s.item, s.qty))) return false;
      for (const s of stacks) api.remove(owner, s.item, s.qty);
      return true;
    },
    clear(owner) { bags.delete(owner); },
    bind(core) { emit = core.emit; },
    saveSlice: {
      version: 1,
      serialize: () => Object.fromEntries([...bags].map(([o, b]) => [o, Object.fromEntries(b)])),
      deserialize: (d) => {
        bags.clear();
        for (const [o, b] of Object.entries(d || {})) {
          const m = new Map();
          for (const [item, q] of Object.entries(b || {})) if (Number.isInteger(q) && q > 0) m.set(item, q); // 世界包已刪除的物品也保留，不丟資料
          bags.set(o, m);
        }
      },
    },
  };
  return api;
}
