// 採集模組的世界包資料規格：樹、灌木、石頭、撿拾物，以及它們的收穫與再生天數。
export default {
  module: 'gathering',
  speciesKinds: ['tree', 'bush', 'rock', 'forage'],
  validate(data, { E, species, checkStacks, isInt }) {
    for (const s of species) {
      if (!this.speciesKinds.includes(s?.kind)) continue;
      checkStacks('species.json', `物種「${s.id}」的 yield（採集收穫）`, s.yield);
      if (s.regrowDays !== undefined && (!isInt(s.regrowDays) || s.regrowDays < 1)) E('species.json', `物種「${s.id}」的 regrowDays 必須是 1 以上的整數`);
    }
  },
};
