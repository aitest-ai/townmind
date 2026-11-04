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
      if (r.seconds !== undefined && (typeof r.seconds !== 'number' || r.seconds < 0 || r.seconds > 60)) E(f, `配方「${r.id}」的 seconds 要是 0～60 的數字`);
      if (r.unlock !== undefined && !isStr(r.unlock)) E(f, `配方「${r.id}」的 unlock 要是旗標名稱（文字）`);
      if (r.station && !island.placements.some((p) => p?.type === 'station' && p.ref === r.station)) E(f, `配方「${r.id}」要用「${r.station}」，但地圖上沒有放這種工作台`, '請在 island.json 的 placements 加一個 { "type": "station", "ref": "' + r.station + '" }。');
    }
    island.placements.forEach((p, i) => {
      if (p?.type === 'station' && !isStr(p.ref)) E('island.json', `placements 第 ${i + 1} 筆的 station 缺少 ref`);
    });
  },
};
