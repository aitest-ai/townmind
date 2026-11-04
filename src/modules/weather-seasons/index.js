// 天氣與季節（weather-seasons）：每天的天氣（依季節的權重、種子亂數，可重現）、明天的預報、換季提醒。
// 季節本身來自核心的時間服務；這個模組只負責「天氣」與提醒，所以關掉它，季節照樣運作（例如耕作照樣看季節）。
// 事件：weather-seasons:weatherChanged { weather, name, day, season, waters }（下雨時 weather 為 'rain'，耕作會自動澆水）、
//       weather-seasons:seasonChanged { season }；回饋事件 weather-seasons:feedback。
// 天氣的畫面效果（雨滴、陰天）之後再做：畫面只要訂閱 weatherChanged 即可，不必改這個模組。
const DEFAULT = {
  types: {
    sunny: { name: '晴天', icon: '☀️' }, cloudy: { name: '多雲', icon: '⛅' },
    rain: { name: '下雨', icon: '🌧️', waters: true }, snow: { name: '下雪', icon: '❄️' },
  },
  seasons: {
    spring: { sunny: 5, cloudy: 3, rain: 3 }, summer: { sunny: 7, cloudy: 2, rain: 2 },
    autumn: { sunny: 5, cloudy: 4, rain: 2 }, winter: { sunny: 3, cloudy: 4, snow: 3 },
  },
};
const SEASON_NAME = { spring: '春天', summer: '夏天', autumn: '秋天', winter: '冬天' };

export default {
  id: 'weather-seasons',
  version: '0.1.0',
  requires: [],
  optional: [],
  conflicts: [],
  emits: ['weather-seasons:weatherChanged', 'weather-seasons:seasonChanged', 'weather-seasons:feedback'],
  config: {},

  init(ctx) {
    const { time } = ctx.services;
    const w = ctx.data.weather && typeof ctx.data.weather === 'object' ? ctx.data.weather : {};
    const types = Object.keys(w.types || {}).length ? w.types : DEFAULT.types;
    const tables = { ...DEFAULT.seasons, ...(w.seasons || {}) };
    const fb = (kind, text, extra = {}) => ctx.emit('weather-seasons:feedback', { kind, text, actor: 'player', ...extra });
    const seasonOf = (day) => {
      // 和核心時間服務相同的算法：每 seasonDays 天換一季（從現在的季節往回推）
      const per = time?.seasonDays ?? 7;
      const order = ['spring', 'summer', 'autumn', 'winter'];
      const now = order.indexOf(time?.season ?? 'spring'), d0 = time?.day ?? 1;
      const idx = (now + Math.floor((day - 1) / per) - Math.floor((d0 - 1) / per)) % 4;
      return order[(idx + 4) % 4];
    };
    const roll = (season) => {
      const table = Object.entries(tables[season] || {}).filter(([id, n]) => n > 0 && types[id]);
      if (!table.length) return Object.keys(types)[0];
      const total = table.reduce((s, [, n]) => s + n, 0);
      let k = ctx.rng.next() * total;
      for (const [id, n] of table) { k -= n; if (k <= 0) return id; }
      return table[table.length - 1][0];
    };
    let st = { today: null, tomorrow: null, day: 0, season: null };

    function announce(offline) {
      const t = types[st.today];
      const payload = { weather: st.today, name: t.name, icon: t.icon ?? '', day: st.day, season: st.season, waters: !!t.waters, offline: !!offline };
      ctx.emit('weather-seasons:weatherChanged', payload);
      if (!offline) fb('progress', `今天${t.name}${t.icon ? ` ${t.icon}` : ''}${t.waters ? '，田會自己喝水' : ''}`, { quiet: false, weather: st.today, sound: st.today });
    }
    function newDay(day, offline) {
      const season = time?.season ?? 'spring';
      const changed = st.season && st.season !== season;
      st.today = st.tomorrow ?? roll(season);
      st.tomorrow = roll(seasonOf(day + 1));
      st.day = day; st.season = season;
      if (changed) {
        ctx.emit('weather-seasons:seasonChanged', { season, day });
        if (!offline) fb('unlock', `${SEASON_NAME[season]}到了！`, { season });
      }
      announce(offline);
    }

    // 第一天：在第一個遊戲更新時決定（其他模組都啟動、也都訂閱好了）
    let first = true;
    ctx.registerSystem({ id: 'weather.first', order: 0, update() { if (first) { first = false; if (!st.today) newDay(time?.day ?? 1, false); } } });
    ctx.on('core:dayStarted', (x) => { first = false; newDay(x.day, x.offline); });

    ctx.registerPanel({
      id: 'weather-seasons.today', title: '天氣', order: 2,
      view() {
        if (!st.today) return [];
        const t = types[st.today], n = types[st.tomorrow];
        return [
          { type: 'stat', label: `今天（${SEASON_NAME[time?.season ?? 'spring']}）`, value: `${t.icon ?? ''} ${t.name}` },
          ...(n ? [{ type: 'stat', label: '明天', value: `${n.icon ?? ''} ${n.name}` }] : []),
        ];
      },
    });
    ctx.registerAIContext(() => (st.today ? [`今天的天氣：${types[st.today].name}，季節：${SEASON_NAME[time?.season ?? 'spring']}${time?.isNight ? '，現在是晚上' : ''}`] : []));

    ctx.registerSaveSlice({
      key: 'weather-seasons', version: 1,
      serialize: () => ({ ...st }),
      deserialize(d) {
        st = { today: types[d?.today] ? d.today : null, tomorrow: types[d?.tomorrow] ? d.tomorrow : null, day: Number(d?.day) || 0, season: d?.season ?? null };
        if (st.today) { first = false; announce(true); } // 讀檔後告訴其他模組今天的天氣（不吵玩家）
      },
    });
    return { api: { current: () => st.today, tomorrow: () => st.tomorrow, isRaining: () => !!types[st.today]?.waters, types: () => ({ ...types }) } };
  },
};
