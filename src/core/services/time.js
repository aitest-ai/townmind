// 時間服務：遊戲時鐘、天數、季節、日夜，含課堂倍率。不依賴瀏覽器，可在 Node 測試。
//
// 兩種模式：
//   'game'：遊戲時間。一天的長度 = dayLengthSec 秒（真實時間，在倍率 1 時）。課堂模式就是把 dayLengthSec 設短（例如 12 分鐘）。
//   'real'：真實時鐘。遊戲裡的時間等於現實時間（需要 now 函式）。
// 外殼每一幀呼叫 advance(真實秒數) → 回傳這一幀的「遊戲秒數」（= 真實秒數 × timeScale，暫停時為 0），交給 engine.update。
// 換日時發出 core:dayStarted { day, season }。

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_LABEL = { spring: '春天', summer: '夏天', autumn: '秋天', winter: '冬天' };
const DAY_MIN = 24 * 60;

export function createTime({
  mode = 'game', dayLengthSec = 720, startMinute = 7 * 60, timeScale = 1, seasonDays = 7,
  startSeason = 'spring', now = () => Date.now(),
} = {}) {
  let emit = () => {};
  const st = { day: 1, minute: startMinute, elapsed: 0, timeScale, paused: false, mode, dayLengthSec, seasonDays, seasonStart: Math.max(0, SEASONS.indexOf(startSeason)) };
  const syncReal = () => {
    const d = new Date(now());
    st.minute = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  };
  if (mode === 'real') syncReal();

  const api = {
    get day() { return st.day; },
    get minuteOfDay() { return st.minute; },
    get hour() { return Math.floor(st.minute / 60); },
    get elapsed() { return st.elapsed; },               // 累計遊戲秒數
    get timeScale() { return st.timeScale; },
    get paused() { return st.paused; },
    get mode() { return st.mode; },
    get dayLengthSec() { return st.dayLengthSec; },
    get season() { return SEASONS[(st.seasonStart + Math.floor((st.day - 1) / st.seasonDays)) % 4]; },
    get isNight() { return st.minute < 6 * 60 || st.minute >= 19 * 60; },
    get dayFraction() { return st.minute / DAY_MIN; },
    clockText() {
      const h = Math.floor(st.minute / 60), m = Math.floor(st.minute % 60);
      return `第 ${st.day} 天　${SEASON_LABEL[api.season]}　${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },
    setTimeScale(k) { st.timeScale = Math.max(0, Math.min(20, Number(k) || 0)); },
    setDayLength(sec) { st.dayLengthSec = Math.max(30, Number(sec) || 720); },
    setMode(m) { st.mode = m === 'real' ? 'real' : 'game'; if (st.mode === 'real') syncReal(); },
    pause(p = true) { st.paused = !!p; },
    // 回傳這一幀的遊戲秒數
    advance(realDt) {
      if (st.paused || !(realDt > 0)) return 0;
      const dt = realDt * st.timeScale;
      st.elapsed += dt;
      if (st.mode === 'real') {
        const before = st.minute;
        syncReal();
        if (st.minute < before) api._newDay();
      } else {
        st.minute += (dt / st.dayLengthSec) * DAY_MIN;
        while (st.minute >= DAY_MIN) { st.minute -= DAY_MIN; api._newDay(); }
      }
      return dt;
    },
    // 直接跳過 n 天（離線補算、測試用）。每一天都會發 core:dayStarted，帶 offline 旗標。
    skipDays(n, { offline = true } = {}) {
      for (let i = 0; i < n; i++) api._newDay({ offline });
    },
    _newDay(extra = {}) {
      st.day += 1;
      emit('core:dayStarted', { day: st.day, season: api.season, ...extra });
    },
    bind(core) { emit = core.emit; },
    saveSlice: {
      version: 1,
      serialize: () => ({ day: st.day, minute: st.minute, elapsed: st.elapsed }),
      deserialize: (d) => {
        if (Number.isInteger(d?.day) && d.day >= 1) st.day = d.day;
        if (Number.isFinite(d?.minute)) st.minute = Math.max(0, Math.min(DAY_MIN - 0.001, d.minute));
        if (Number.isFinite(d?.elapsed)) st.elapsed = d.elapsed;
      },
    },
  };
  return api;
}
