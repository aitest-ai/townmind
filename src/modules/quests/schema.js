// 任務與成長（quests）的世界包資料規格：quests.json
// {
//   "levels": [{ "level": 1, "points": 0, "name": "小小島", "unlocks": ["旗標"] }, ...],   // 小島繁榮度：點數到了就升級
//   "quests": [{
//     "id": "first_wood", "title": "第一份木頭", "description": "…", "line": "main" | "side",
//     "giver": "laoju",                       // 選填：哪位居民給的任務
//     "module": "gathering",                  // 選填：需要哪個模組（沒開時這個任務會被略過，主線照樣往下走）
//     "requires": ["welcome"],                // 選填：先完成哪些任務
//     "requiresFlags": ["旗標"],               // 選填：先解鎖哪些旗標
//     "auto": true,                           // 條件一滿足就自動接取（預設 true）；false 時要玩家按「接受」
//     "autoClaim": false,                     // 完成就自動領獎（預設 false：要按「領取獎勵」，比較有成就感）
//     "conditions": [
//       { "type": "event", "event": "gathering:harvested", "match": { "species": "oak" }, "count": 3, "label": "砍 3 次橡樹" },
//       { "type": "have", "item": "wood", "qty": 5, "consume": true, "label": "交給老橘 5 個木頭" },
//       { "type": "flag", "flag": "workbench_built" },
//       { "type": "quest", "quest": "welcome" },
//       { "type": "level", "level": 2 }
//     ],
//     "rewards": { "items": [{ "item": "apple", "qty": 2 }], "points": 10, "flags": ["recipes.basic"] }
//   }]
// }
const TYPES = ['event', 'have', 'flag', 'quest', 'level'];
export default {
  module: 'quests',
  files: { quests: 'object' },
  validate(data, { E, W, arr, isStr, isInt, ids, needItem, catalog }) {
    const f = 'quests.json';
    const q = data.quests && typeof data.quests === 'object' ? data.quests : {};
    const list = arr(q.quests);
    const qids = new Set();
    list.forEach((x, i) => {
      if (!/^[a-z][a-z0-9_]*$/.test(x?.id || '')) { E(f, `第 ${i + 1} 個任務的 id 不合法：「${x?.id}」`); return; }
      if (qids.has(x.id)) E(f, `任務 id「${x.id}」重複`);
      qids.add(x.id);
    });
    for (const x of list) {
      if (!x?.id) continue;
      if (!isStr(x.title)) E(f, `任務「${x.id}」缺少 title`);
      if (x.module && !catalog.has(x.module)) W(f, `任務「${x.id}」的 module「${x.module}」不是已知的模組`);
      if (x.giver && ids.residents && !ids.residents.has(x.giver)) W(f, `任務「${x.id}」的 giver「${x.giver}」不是居民`);
      for (const r of arr(x.requires)) if (!qids.has(r)) E(f, `任務「${x.id}」的 requires 用到不存在的任務「${r}」`);
      if (!arr(x.conditions).length) E(f, `任務「${x.id}」至少要有一個完成條件`);
      for (const c of arr(x.conditions)) {
        if (!TYPES.includes(c?.type)) { E(f, `任務「${x.id}」的條件 type「${c?.type}」不合法`, `可用：${TYPES.join('、')}`); continue; }
        if (c.type === 'event') {
          if (!/^[a-z][a-z0-9-]*:[a-zA-Z]+$/.test(c.event || '')) E(f, `任務「${x.id}」的事件名稱「${c.event}」格式不對`, '格式：模組id:事件名，例如 gathering:harvested');
          if (c.count !== undefined && (!isInt(c.count) || c.count < 1)) E(f, `任務「${x.id}」的 count 要是 1 以上的整數`);
        }
        if (c.type === 'have') { needItem(f, `任務「${x.id}」的條件`, c.item); if (!isInt(c.qty) || c.qty < 1) E(f, `任務「${x.id}」的 qty 要是 1 以上的整數`); }
        if (c.type === 'quest' && !qids.has(c.quest)) E(f, `任務「${x.id}」的條件用到不存在的任務「${c.quest}」`);
        if (c.type === 'level' && (!isInt(c.level) || c.level < 1)) E(f, `任務「${x.id}」的 level 要是 1 以上的整數`);
        if (c.type === 'flag' && !isStr(c.flag)) E(f, `任務「${x.id}」的 flag 條件缺少 flag`);
      }
      for (const it of arr(x.rewards?.items)) { needItem(f, `任務「${x.id}」的獎勵`, it?.item); if (!isInt(it?.qty) || it.qty < 1) E(f, `任務「${x.id}」的獎勵數量要是 1 以上的整數`); }
      if (x.rewards?.points !== undefined && (!isInt(x.rewards.points) || x.rewards.points < 0)) E(f, `任務「${x.id}」的 points 要是 0 以上的整數`);
    }
    // 任務之間不能循環依賴
    const byId = new Map(list.map((x) => [x.id, x]));
    const seen = new Map();
    const visit = (id, trail) => {
      if (seen.get(id) === 2) return;
      if (seen.get(id) === 1) { E(f, `任務之間循環依賴：${[...trail, id].join(' → ')}`); return; }
      seen.set(id, 1);
      for (const r of arr(byId.get(id)?.requires)) if (byId.has(r)) visit(r, [...trail, id]);
      seen.set(id, 2);
    };
    for (const id of byId.keys()) visit(id, []);
    let last = -1;
    for (const lv of arr(q.levels)) {
      if (!isInt(lv?.level) || !isInt(lv?.points)) { E(f, 'levels 每一筆要有整數 level 與 points'); continue; }
      if (lv.points <= last) E(f, `繁榮度第 ${lv.level} 級的 points 要比前一級大`);
      last = lv.points;
    }
  },
};
