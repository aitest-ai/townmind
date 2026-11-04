// 偏好設定（prefs）：和「存檔」分開保存的設定，開新遊戲、匯入存檔都不會動到它。
// 例如老師密碼：如果放在存檔裡，學生按「開新遊戲」就能把密碼清掉。
// 外殼提供給模組（ctx.services.prefs）；沒有 localStorage 時改用記憶體（重新整理就沒了）。
export function createPrefs(prefix) {
  const key = `${prefix}:prefs`;
  let mem = {};
  let ls = null;
  try { ls = window.localStorage; mem = JSON.parse(ls.getItem(key) || '{}') || {}; } catch { ls = null; }
  const flush = () => { try { ls?.setItem(key, JSON.stringify(mem)); } catch { /* 空間不足：這次只留在記憶體 */ } };
  return {
    get: (k, fallback = null) => (k in mem ? mem[k] : fallback),
    set: (k, v) => { if (v === undefined || v === null) delete mem[k]; else mem[k] = v; flush(); },
  };
}
