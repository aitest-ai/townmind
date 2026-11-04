// 行動與工具（actions）的世界包資料規格：工具物品可以有 toolSpeed（動作快慢倍率，預設 1）。
export default {
  module: 'actions',
  validate(data, { E, items }) {
    for (const it of items) {
      if (it?.toolSpeed === undefined) continue;
      if (it.category !== 'tool') E('items.json', `物品「${it.id}」不是工具，不能設定 toolSpeed`);
      else if (typeof it.toolSpeed !== 'number' || it.toolSpeed < 0.2 || it.toolSpeed > 5) E('items.json', `工具「${it.id}」的 toolSpeed 要是 0.2～5 的數字`);
    }
  },
};
