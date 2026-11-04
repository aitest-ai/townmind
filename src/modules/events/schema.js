// events 模組（規劃中）的世界包資料規格：events.json（節慶活動）。目前只檢查每筆有 name，細節等模組實作時補上。
export default {
  module: 'events',
  files: { events: 'list' },
  validate(data, { W, arr, isStr }) {
    for (const x of arr(data.events)) if (x?.id && !isStr(x.name)) W('events.json', `節慶活動「${x.id}」缺少 name`);
  },
};
