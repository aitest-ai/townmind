// racing 模組（規劃中）的世界包資料規格：tracks.json（賽道）。目前只檢查每筆有 name，細節等模組實作時補上。
export default {
  module: 'racing',
  files: { tracks: 'list' },
  validate(data, { W, arr, isStr }) {
    for (const x of arr(data.tracks)) if (x?.id && !isStr(x.name)) W('tracks.json', `賽道「${x.id}」缺少 name`);
  },
};
