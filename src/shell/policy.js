// 規則（policy）：模組可以設定「外殼要遵守的限制」，例如課堂模式關掉打字、鎖住時間速度。
// 這是外殼提供的服務（ctx.services.policy），不在核心裡。模組關掉時，它設定的規則自動失效。
//
// 目前外殼認得的規則（模組可以設定，外殼會遵守）：
//   playerTimeControl（bool）：學生能不能自己調時間速度／暫停
//   maxSpeed（number）：學生能選的最高時間倍率
//   playerTyping（bool）：玩家能不能打字（公告等 userText 參數）；關掉時一律拒絕並說明
//   typingReason（string）：關掉打字時給學生看的原因
//   playerSaveControl（bool）：學生能不能匯入存檔、讀取備份、開新遊戲
// 同一個規則被多個模組設定時，以「最嚴格」為準（bool 取 false、數字取最小）。

export function createPolicy() {
  const rules = new Map(); // key → Map(owner → value)
  const api = {
    set(owner, key, value) {
      if (!rules.has(key)) rules.set(key, new Map());
      if (value === undefined || value === null) rules.get(key).delete(owner);
      else rules.get(key).set(owner, value);
    },
    get(key, fallback) {
      const vals = [...(rules.get(key)?.values() || [])];
      if (!vals.length) return fallback;
      if (vals.every((v) => typeof v === 'boolean')) return vals.every(Boolean);
      if (vals.every((v) => typeof v === 'number')) return Math.min(...vals);
      return vals[vals.length - 1];
    },
    clear(owner) { for (const m of rules.values()) m.delete(owner); },
    onModuleDisposed(owner) { api.clear(owner); },
  };
  return api;
}
