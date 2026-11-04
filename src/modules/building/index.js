// 佈置（building）：把家具放到島上（對齊格子）、旋轉、收回背包。
//
// 資料：items.json 裡 category 為 furniture 的物品都可以擺；art.json 指定外觀（preset），渲染層依 state.rot 旋轉。
// 規則：要放在可以走的地上、那一格不能已經有東西、要在玩家身邊（reach 格以內）。家具會擋路。
// 回饋事件 building:feedback；building:placed / rotated / pickedUp 給任務計數。
// 「蓋房子」之後再加（需要更大的格子佔用與施工流程）。
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

export default {
  id: 'building',
  version: '0.1.0',
  requires: [],
  optional: [],
  conflicts: [],
  emits: ['building:placed', 'building:rotated', 'building:pickedUp', 'building:feedback'],
  config: { reach: 2.5, maxPlaced: 200 },

  init(ctx) {
    const { entities, inventory } = ctx.services;
    const isl = ctx.data.island;
    const items = new Map((ctx.data.items || []).map((x) => [x.id, x]));
    const isFurniture = (id) => items.get(id)?.category === 'furniture';
    const fb = (kind, text, extra = {}) => ctx.emit('building:feedback', { kind, text, ...extra });
    let seq = 0;

    const walkable = (x, y) => x >= 0 && y >= 0 && x < isl.size.w && y < isl.size.h && isl.legend[isl.terrain[y][x]]?.walkable !== false;
    const occupied = (x, y) => entities.near(x, y, 0.5, { filter: (e) => !['player', 'marker'].includes(e.kind) && e.owner !== 'shell' }).length > 0;
    const posOf = (actor) => entities.get(actor === 'player' ? 'player' : `resident.${actor}`);
    const playerOn = (x, y) => { const p = entities.get('player'); return p && Math.hypot(p.x - x, p.y - y) < 0.75; };
    const spotWhy = (actor, x, y) => {
      if (!walkable(x, y)) return '那裡不能放東西（水裡或地圖外）';
      if (occupied(x, y)) return '那一格已經有東西了';
      if (playerOn(x, y)) return '不能放在自己腳下';
      const p = posOf(actor);
      if (!p || Math.hypot(p.x - x, p.y - y) > ctx.config.reach) return '要走近一點才能放';
      return true;
    };
    // 玩家身邊最近的空格（「放在旁邊」用）
    const spotNear = (actor) => {
      const p = posOf(actor);
      if (!p) return null;
      const cx = Math.round(p.x), cy = Math.round(p.y);
      for (const [dx, dy] of DIRS) if (spotWhy(actor, cx + dx, cy + dy) === true) return { x: cx + dx, y: cy + dy };
      return null;
    };
    const placed = () => entities.byOwner('building');

    function place(actor, item, x, y, rot = 0) {
      inventory.remove(actor, item, 1);
      const e = entities.add({ id: `furniture.${++seq}`, kind: 'furniture', owner: 'building', ref: item, x, y, label: inventory.itemName(item), state: { rot: ((rot % 4) + 4) % 4 } });
      ctx.emit('building:placed', { actor, item, x, y, id: e.id });
      fb('success', `放好了：${e.label}`, { actor, at: { x, y }, entity: e.id, sound: 'place' });
      return e.id;
    }

    ctx.registerCommand({
      id: 'building.place', label: '擺放', description: '把家具放在指定的格子',
      params: { item: { type: 'ref', of: 'items' }, x: { type: 'int', min: 0, max: 999 }, y: { type: 'int', min: 0, max: 999 }, rot: { type: 'int', min: 0, max: 3, default: 0 } },
      canRun: ({ item, x, y }, call) => {
        if (!isFurniture(item)) return '這個東西不能擺放';
        if (!inventory.has(call.actor, item)) return `背包裡沒有${inventory.itemName(item)}`;
        if (placed().length >= ctx.config.maxPlaced) return '島上已經擺太多東西了';
        return spotWhy(call.actor, x, y);
      },
      run: ({ item, x, y, rot }, call) => place(call.actor, item, x, y, rot),
    });
    ctx.registerCommand({
      id: 'building.placeNear', label: '放在旁邊', description: '把家具放在身邊最近的空格',
      params: { item: { type: 'ref', of: 'items' } },
      canRun: ({ item }, call) => {
        if (!isFurniture(item)) return '這個東西不能擺放';
        if (!inventory.has(call.actor, item)) return `背包裡沒有${inventory.itemName(item)}`;
        return spotNear(call.actor) ? true : '身邊沒有空位，換個地方試試';
      },
      run: ({ item }, call) => { const s = spotNear(call.actor); return place(call.actor, item, s.x, s.y, 0); },
    });
    const near = (actor, e) => { const p = posOf(actor); return !!p && Math.hypot(p.x - e.x, p.y - e.y) <= ctx.config.reach; };
    ctx.registerCommand({
      id: 'building.rotate', label: '旋轉', params: { target: { type: 'entity', kind: 'furniture' } },
      canRun: ({ target }, call) => (near(call.actor, entities.get(target)) ? true : '走近一點才能轉'),
      run({ target }, call) {
        const e = entities.get(target);
        entities.update(target, { state: { rot: ((e.state.rot ?? 0) + 1) % 4 } });
        ctx.emit('building:rotated', { actor: call.actor, id: target });
        fb('success', `轉了一下${e.label}`, { actor: call.actor, at: { x: e.x, y: e.y }, entity: target, quiet: true, sound: 'rotate' });
        return entities.get(target).state.rot;
      },
    });
    ctx.registerCommand({
      id: 'building.pickup', label: '收起來', params: { target: { type: 'entity', kind: 'furniture' } },
      canRun: ({ target }, call) => {
        const e = entities.get(target);
        if (!near(call.actor, e)) return '走近一點才能收';
        return inventory.room(call.actor, e.ref) > 0 ? true : '背包滿了，收不下';
      },
      run({ target }, call) {
        const e = entities.get(target);
        inventory.add(call.actor, e.ref, 1);
        entities.remove(target);
        ctx.emit('building:pickedUp', { actor: call.actor, item: e.ref, id: target });
        fb('success', `收回背包：${e.label}`, { actor: call.actor, at: { x: e.x, y: e.y }, sound: 'pickup' });
        return true;
      },
    });
    ctx.registerEntityKind('furniture', {
      label: '家具', solid: true, radius: 0.4,
      interactions: [
        { label: (e) => `旋轉${e.label}`, command: 'building.rotate', args: (e) => ({ target: e.id }) },
        { label: (e) => `收起${e.label}`, command: 'building.pickup', args: (e) => ({ target: e.id }) },
      ],
    });

    ctx.registerPanel({
      id: 'building.decorate', title: '佈置', order: 40,
      view() {
        const list = inventory.list('player').filter((s) => isFurniture(s.item));
        return [
          { type: 'text', text: list.length ? '選一件家具，放在你旁邊。走近家具可以旋轉或收起來。' : '背包裡沒有家具。可以用「製作」做椅子、桌子、籬笆。' },
          ...(list.length ? [{ type: 'buttons', items: list.map((s) => ({ type: 'button', label: `放${s.name}（${s.qty}）`, command: 'building.placeNear', args: { item: s.item } })) }] : []),
          { type: 'stat', label: '島上擺了', value: `${placed().length} 件` },
        ];
      },
    });
    ctx.registerAIContext(() => (placed().length ? [`島上擺了 ${placed().length} 件家具`] : []));

    ctx.registerSaveSlice({
      key: 'building', version: 1,
      serialize: () => ({ seq, placed: placed().map((e) => ({ id: e.id, item: e.ref, x: e.x, y: e.y, rot: e.state.rot ?? 0 })) }),
      deserialize(d) {
        entities.removeOwner('building');
        seq = Number(d?.seq) || 0;
        for (const p of d?.placed || []) {
          if (!isFurniture(p.item)) continue; // 世界包已經沒有這件家具：略過（資料仍在原始存檔）
          entities.add({ id: p.id, kind: 'furniture', owner: 'building', ref: p.item, x: p.x, y: p.y, label: inventory.itemName(p.item), state: { rot: p.rot ?? 0 } });
        }
      },
    });
    return { api: { placed: () => placed().map((e) => ({ id: e.id, item: e.ref, x: e.x, y: e.y, rot: e.state.rot })) } };
  },
};
