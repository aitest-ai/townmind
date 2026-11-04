// 經濟（economy）的世界包資料規格：shop.json 與商店的位置（island placements 的 shop）。
// {
//   "name": "小島雜貨店",
//   "currency": "貝幣",                     // 錢的名字
//   "startCoins": 50,                       // 開新遊戲時有多少錢
//   "sellRate": 0.5,                        // 賣東西拿回物品 value 的幾成
//   "buy": [{ "item": "wheat_seed", "price": 8, "unlock": "旗標（選填）" }]
// }
export default {
  module: 'economy',
  files: { shop: 'object' },
  placementTypes: ['shop'],
  validate(data, { E, W, arr, isInt, needItem, island }) {
    const f = 'shop.json', s = data.shop && typeof data.shop === 'object' ? data.shop : {};
    if (s.sellRate !== undefined && (typeof s.sellRate !== 'number' || s.sellRate < 0 || s.sellRate > 1)) E(f, 'sellRate 要是 0～1 的數字');
    if (s.startCoins !== undefined && (!isInt(s.startCoins) || s.startCoins < 0)) E(f, 'startCoins 要是 0 以上的整數');
    const seen = new Set();
    for (const b of arr(s.buy)) {
      needItem(f, '商店的商品', b?.item);
      if (seen.has(b?.item)) W(f, `商品「${b?.item}」重複`);
      seen.add(b?.item);
      if (b?.price !== undefined && (!isInt(b.price) || b.price < 1)) E(f, `商品「${b.item}」的 price 要是 1 以上的整數`);
    }
    if (arr(s.buy).length && !island.placements.some((p) => p?.type === 'shop')) W('island.json', '有商品但地圖上沒有商店（placements 的 shop），玩家會買不到東西');
  },
};
