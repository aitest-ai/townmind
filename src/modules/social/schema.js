// 好感度與送禮（social）的世界包資料規格：social.json（選填，沒有就用預設文字）
// {
//   "levels": [{ "points": 0, "name": "點頭之交" }, { "points": 20, "name": "朋友", "flag": "選填：升到這級時解鎖的旗標（{id} 會換成居民 id）" }],
//   "requestItems": ["wood", "apple"],              // 居民小請求可能要的東西（另外也會從居民喜歡的東西挑）
//   "text": { "request": ["{name}想要 {qty} 個{item}，可以幫忙嗎？"], "thanks": [...], "liked": [...], "normal": [...] }
// }
export default {
  module: 'social',
  files: { social: 'object' },
  validate(data, { E, arr, isInt, needItem }) {
    const f = 'social.json', s = data.social && typeof data.social === 'object' ? data.social : {};
    let last = -1;
    for (const lv of arr(s.levels)) {
      if (!isInt(lv?.points) || typeof lv?.name !== 'string') { E(f, 'levels 每一筆要有整數 points 與文字 name'); continue; }
      if (lv.points <= last) E(f, `好感度等級「${lv.name}」的 points 要比前一級大`);
      last = lv.points;
    }
    for (const it of arr(s.requestItems)) needItem(f, 'requestItems ', it);
  },
};
