// minigames 模組（規劃中）的世界包資料規格：games.json（小遊戲）。目前只檢查每筆有 name，細節等模組實作時補上。
export default {
  module: 'minigames',
  files: { games: 'list' },
  validate(data, { W, arr, isStr }) {
    for (const x of arr(data.games)) if (x?.id && !isStr(x.name)) W('games.json', `小遊戲「${x.id}」缺少 name`);
  },
};
