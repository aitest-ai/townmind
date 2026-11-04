// 實體表：地圖上「有位置的東西」（玩家、居民、樹、田、家具……）。渲染層只讀它，不改它。
//
// 實體：{ id, kind, owner, ref?, x, y, state, art?, label? }
//   kind  ：種類（由模組 registerEntityKind 定義行為與互動）
//   owner ：建立它的模組 id（核心建立的是 'core'，例如玩家）
//   ref   ：對應世界包資料的 id（例如物種 'oak'、居民 'afu'），渲染層用它查 art.json
//   x, y  ：格子座標（可以有小數），1 = 一格
//   state ：純資料（例如 { stage: 2 }），模組自己定義
// 存檔：只有 owner 為 'core' 的實體由這裡存；其他實體由擁有的模組放在自己的存檔切片
// （所以模組關掉時，它的實體從地圖上消失，但資料隨模組切片保留）。
// version 每次變動都會 +1，渲染層可以用它判斷要不要重建。

export function createEntities() {
  const map = new Map();
  const seq = new Map();
  let version = 0;
  const bump = () => { version++; };

  const api = {
    get version() { return version; },
    add(e) {
      if (!e?.kind || !e.owner) throw new Error('實體需要 kind 與 owner');
      let id = e.id;
      if (!id) { const n = (seq.get(e.kind) || 0) + 1; seq.set(e.kind, n); id = `${e.kind}#${n}`; }
      if (map.has(id)) throw new Error(`實體 id「${id}」重複`);
      const ent = { label: null, ref: null, art: null, ...e, id, x: Number(e.x) || 0, y: Number(e.y) || 0, state: { ...(e.state || {}) } };
      map.set(id, ent);
      bump();
      return ent;
    },
    get: (id) => map.get(id) ?? null,
    has: (id) => map.has(id),
    remove(id) { const ok = map.delete(id); if (ok) bump(); return ok; },
    // 部分更新：x、y、label、art 直接覆蓋；state 合併
    update(id, patch = {}) {
      const e = map.get(id);
      if (!e) return null;
      const { state, ...rest } = patch;
      Object.assign(e, rest, { id: e.id, kind: e.kind, owner: e.owner });
      if (state) e.state = { ...e.state, ...state };
      bump();
      return e;
    },
    // 只移動、不算「結構變動」（不 bump version），避免渲染層每幀重建
    move(id, x, y) { const e = map.get(id); if (e) { e.x = x; e.y = y; } return e ?? null; },
    all: () => [...map.values()],
    byKind: (kind) => [...map.values()].filter((e) => e.kind === kind),
    byOwner: (owner) => [...map.values()].filter((e) => e.owner === owner),
    near(x, y, r, { kind = null, filter = null } = {}) {
      const kinds = kind === null ? null : [].concat(kind);
      return [...map.values()]
        .filter((e) => (!kinds || kinds.includes(e.kind)) && (!filter || filter(e)))
        .map((e) => ({ e, d: Math.hypot(e.x - x, e.y - y) }))
        .filter(({ d }) => d <= r)
        .sort((a, b) => a.d - b.d)
        .map(({ e }) => e);
    },
    removeOwner(owner) {
      let n = 0;
      for (const [id, e] of map) if (e.owner === owner) { map.delete(id); n++; }
      if (n) bump();
      return n;
    },
    onModuleDisposed(id) { api.removeOwner(id); },
    // 給模組存檔用：把自己的實體轉成純資料／從純資料還原
    snapshot: (owner) => api.byOwner(owner).map((e) => JSON.parse(JSON.stringify(e))),
    restore(owner, list) {
      api.removeOwner(owner);
      for (const e of Array.isArray(list) ? list : []) if (e?.kind) api.add({ ...e, owner });
    },
    saveSlice: {
      version: 1,
      serialize: () => api.snapshot('core'),
      deserialize: (list) => {
        for (const e of Array.isArray(list) ? list : []) {
          if (!e?.id) continue;
          if (map.has(e.id)) api.update(e.id, { x: e.x, y: e.y, state: e.state });
          else api.add({ ...e, owner: 'core' });
        }
      },
    },
  };
  return api;
}
