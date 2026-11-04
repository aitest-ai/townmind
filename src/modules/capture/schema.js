// 捕捉模組的世界包資料規格：動物、魚、蟲的捕捉方式與獎勵，以及 island.json 區域裡的出沒設定。
// 兒童安全（presentation 只能是放生／收集／拍照）是核心的跨模組政策，這裡只檢查值是否認得。
const KINDS = ['animal', 'fish', 'bug'];
const ALL_PRESENTATIONS = ['catch_release', 'collect', 'photo', 'implied', 'hunt'];
export default {
  module: 'capture',
  speciesKinds: KINDS,
  validate(data, { E, W, species, ids, itemById, speciesById, checkStacks, island }) {
    const f = 'species.json';
    for (const s of species) {
      if (!KINDS.includes(s?.kind)) continue;
      const methods = s.capture?.methods;
      if (!Array.isArray(methods) || methods.length === 0) { E(f, `「${s.id}」需要 capture.methods（捕捉方式）`, '格式：{ "tool": "net", "presentation": "collect" }'); continue; }
      for (const m of methods) {
        if (!ids.items.has(m?.tool)) E(f, `「${s.id}」的捕捉工具「${m?.tool}」不存在`);
        else if (itemById.get(m.tool).category !== 'tool') E(f, `「${s.id}」的捕捉工具「${m.tool}」必須是 category 為 tool 的物品`);
        if (!ALL_PRESENTATIONS.includes(m?.presentation)) E(f, `「${s.id}」的呈現方式「${m?.presentation}」不合法`, `可用：${ALL_PRESENTATIONS.join('、')}`);
      }
      if (s.capture?.reward !== undefined) checkStacks(f, `「${s.id}」的 capture.reward`, s.capture.reward);
    }
    for (const rg of island.regions) {
      for (const sp of rg?.spawns || []) {
        if (!ids.species.has(sp?.ref)) E('island.json', `區域「${rg.id}」的 spawns 用到不存在的物種「${sp?.ref}」`);
        else if (!KINDS.includes(speciesById.get(sp.ref).kind)) W('island.json', `區域「${rg.id}」的 spawns「${sp.ref}」不是動物、魚或蟲，會被忽略`);
      }
    }
  },
};
