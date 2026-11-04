// 居民模組的世界包資料規格：residents.json（角色卡）與居民的家（home）。
// 角色卡欄位有長度上限，避免使用者自訂的內容把提示詞撐爆。
const LIMITS = { personality: 120, goal: 120, catchphrase: 30 };
export default {
  module: 'residents',
  files: { residents: 'list' },
  placementTypes: ['home'],
  validate(data, { E, W, arr, isStr, ids, catalog, island }) {
    const f = 'residents.json';
    for (const r of arr(data.residents)) {
      if (!r?.id) continue;
      if (!isStr(r.name)) E(f, `居民「${r.id}」缺少 name`);
      if (!isStr(r.role)) E(f, `居民「${r.id}」缺少 role`);
      if (!/^#[0-9a-fA-F]{6}$/.test(r.color || '')) E(f, `居民「${r.id}」的 color 必須是 #RRGGBB`);
      for (const [field, max] of Object.entries(LIMITS)) {
        const v = r.card?.[field];
        if (!isStr(v)) E(f, `居民「${r.id}」缺少 card.${field}`);
        else if (v.length > max) E(f, `居民「${r.id}」的 card.${field} 太長（${v.length} 字，上限 ${max}）`, '這是為了讓使用者自訂的內容不會把提示詞撐爆。');
      }
      for (const [k, v] of Object.entries(r.interests || {})) {
        if (!catalog.has(k)) W(f, `居民「${r.id}」的興趣「${k}」不是已知的模組 id`, '興趣的名稱要對應模組 id（例如 farming、capture），才會影響他的行為。');
        if (typeof v !== 'number' || v < 0 || v > 3) E(f, `居民「${r.id}」的興趣「${k}」必須是 0～3 的數字`);
      }
      for (const it of arr(r.likes)) if (!ids.items.has(it)) W(f, `居民「${r.id}」喜歡的物品「${it}」不存在`);
    }
    const homes = new Set();
    if (!arr(data.residents).length) return; // 沒有居民資料（例如這次沒開居民模組）時，不檢查家
    island.placements.forEach((p, i) => {
      if (p?.type !== 'home') return;
      if (!ids.residents?.has(p.ref)) E('island.json', `placements 第 ${i + 1} 筆的 home 對應不存在的居民「${p.ref}」`);
      else homes.add(p.ref);
    });
    for (const id of ids.residents || []) if (!homes.has(id)) W('island.json', `居民「${id}」沒有家（缺少 type 為 home 的放置）`);
  },
};
