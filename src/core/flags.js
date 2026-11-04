// 功能開關：決定「這次執行要啟用哪些模組」。
// 來源有兩個：世界包的 pack.json（預設值），以及執行時的覆寫（例如網址 ?mods=farming=off,capture=on）。
// 覆寫優先。覆寫可以啟用世界包沒列出的模組（config 用預設）。

export function parseOverrides(str = '') {
  const out = {};
  for (const part of String(str || '').split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (!k) continue;
    out[k] = !['off', '0', 'false', 'no'].includes((v ?? 'on').toLowerCase());
  }
  return out;
}

export function resolveEnabled(packModules = {}, overrides = {}) {
  const on = new Map();
  const config = {};
  for (const [id, m] of Object.entries(packModules || {})) {
    on.set(id, !!m?.enabled);
    config[id] = m?.config ?? {};
  }
  for (const [id, v] of Object.entries(overrides || {})) {
    on.set(id, !!v);
    if (!(id in config)) config[id] = {};
  }
  return { enabled: [...on].filter(([, v]) => v).map(([id]) => id), config };
}
