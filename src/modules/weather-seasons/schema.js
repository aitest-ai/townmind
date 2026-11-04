// 天氣與季節（weather-seasons）的世界包資料規格：weather.json（選填，沒有就用預設）
// {
//   "types": { "sunny": { "name": "晴天", "icon": "☀️" }, "rain": { "name": "下雨", "icon": "🌧️", "waters": true } },
//   "seasons": { "spring": { "sunny": 5, "cloudy": 3, "rain": 2 }, "winter": { "sunny": 3, "snow": 3 } }   // 權重
// }
// waters: true 的天氣會讓田自動澆水（事件裡 weather 會是 'rain'，耕作模組只聽這個）。
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export default {
  module: 'weather-seasons',
  files: { weather: 'object' },
  validate(data, { E }) {
    const f = 'weather.json', w = data.weather && typeof data.weather === 'object' ? data.weather : {};
    const types = w.types || {};
    for (const [id, t] of Object.entries(types)) if (!/^[a-z][a-z0-9_]*$/.test(id) || typeof t?.name !== 'string') E(f, `天氣「${id}」的 id 或 name 不合法`);
    for (const [season, table] of Object.entries(w.seasons || {})) {
      if (!SEASONS.includes(season)) { E(f, `季節「${season}」不合法`, `可用：${SEASONS.join('、')}`); continue; }
      for (const [id, n] of Object.entries(table || {})) {
        if (Object.keys(types).length && !(id in types)) E(f, `${season} 用到沒定義的天氣「${id}」`);
        if (typeof n !== 'number' || n < 0) E(f, `${season} 的「${id}」權重要是 0 以上的數字`);
      }
    }
  },
};
