// 耕作模組的世界包資料規格：作物（生長階段、種子、收成、季節）與田地（plot）。
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export default {
  module: 'farming',
  speciesKinds: ['crop'],
  placementTypes: ['plot'],
  validate(data, { E, species, ids, itemById, checkStacks, isInt, arr }) {
    const f = 'species.json';
    for (const s of species) {
      if (s?.kind !== 'crop') continue;
      if (!Array.isArray(s.stages) || s.stages.length < 2) E(f, `作物「${s.id}」的 stages（生長階段）至少要有 2 個`);
      else s.stages.forEach((st, i) => { if (!isInt(st?.days) || st.days < 1) E(f, `作物「${s.id}」第 ${i + 1} 個生長階段的 days 必須是 1 以上的整數`); });
      checkStacks(f, `作物「${s.id}」的 harvest（收成）`, s.harvest);
      if (!ids.items.has(s.seed)) E(f, `作物「${s.id}」的 seed（種子）「${s.seed}」不存在`, '請在 items.json 新增一個 category 為 seed 的物品。');
      else if (itemById.get(s.seed).category !== 'seed') E(f, `作物「${s.id}」的 seed「${s.seed}」必須是 category 為 seed 的物品`);
      for (const se of arr(s.seasons)) if (!SEASONS.includes(se)) E(f, `作物「${s.id}」的季節「${se}」不合法`, `可用：${SEASONS.join('、')}`);
    }
  },
};
