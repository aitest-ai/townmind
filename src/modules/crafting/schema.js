// 製作模組的世界包資料規格：recipes.json（配方）與工作台（station）。
export default {
  module: 'crafting',
  files: { recipes: 'list' },
  placementTypes: ['station'],
  validate(data, { E, arr, isStr, isInt, needItem, checkStacks, island }) {
    const f = 'recipes.json';
    for (const r of arr(data.recipes)) {
      if (!r?.id) continue;
      if (!isStr(r.name)) E(f, `配方「${r.id}」缺少 name`);
      checkStacks(f, `配方「${r.id}」的 inputs（材料）`, r.inputs);
      if (!r.output) E(f, `配方「${r.id}」缺少 output`);
      else { needItem(f, `配方「${r.id}」的 output`, r.output.item); if (!isInt(r.output.qty) || r.output.qty < 1) E(f, `配方「${r.id}」output 數量必須是 1 以上的整數`); }
    }
    island.placements.forEach((p, i) => {
      if (p?.type === 'station' && !isStr(p.ref)) E('island.json', `placements 第 ${i + 1} 筆的 station 缺少 ref`);
    });
  },
};
