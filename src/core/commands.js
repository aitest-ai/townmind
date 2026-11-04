// 指令系統：玩家操作、介面按鈕、AI 居民的決策，全部走同一個入口。
//
// 關鍵設計：AI 能做的事 = 「已啟用模組裡標了 aiCallable、而且此刻 available 的指令」。
// 提示詞裡的「允許行動清單」由 describeForAI() 自動產生，所以關掉一個模組，
// AI 就自動不會再提到它，不需要改提示詞，也不會呼叫到不存在的功能。
//
// 指令定義：
//   { id: 'gathering.harvest',          // 必須以「模組id.」開頭
//     label: '採集',                    // 選填：給介面與 AI 看的短名稱
//     description: '採集身邊的樹或石頭',
//     aiCallable: true,                 // 是否開放給 AI（預設 false）
//     params: {                         // 參數驗證，AI 亂填也只能在這個範圍內
//       target: { type: 'entity', kind: ['tree', 'rock'] },
//       count:  { type: 'int', min: 1, max: 10, clamp: true },   // clamp：超出範圍夾回，否則拒絕
//       note:   { type: 'string', maxLen: 40, userText: true },  // userText：玩家打的字，會先過內容過濾
//     },
//     available(call) { return true },  // 選填：此刻能不能做（例如沒有斧頭）。回傳 true，或一句白話原因
//     canRun(args, call) { return true },// 選填：這組參數能不能做（例如那棵樹還沒長回來）
//     run(args, call) { ... } }
//
// call（呼叫情境）：{ source: 'player' | 'ai' | 'system', actor: 'player' | 居民id | null, caller: 模組id | null }
//
// 參數型別：
//   int（min、max、clamp）/ string（maxLen、truncate、userText）/ enum（values、labels）/ bool
//   ref（of: 世界包清單名稱，例如 'items'、'species'）
//   entity（kind: 種類或種類清單，owner: 選填）→ 參照「此刻地圖上存在的」實體
// 任一參數都可加 choices(call) → 候選值清單，提供給 AI（避免 AI 亂猜 id）。
import { FrameworkError } from './errors.js';

const TYPES = new Set(['int', 'string', 'enum', 'bool', 'ref', 'entity']);
const SOURCES = new Set(['player', 'ai', 'system']);
const MAX_CHOICES = 12;

const reasonOf = (v, fallback) => (v === true || v === undefined ? null : typeof v === 'string' && v ? v : fallback);

export class CommandRegistry {
  // hasRef(of, id)：世界包資料查詢；getEntity(id)：實體查詢；
  // textFilter(text, { audience })：回傳 { ok, text, reason }；onRun(info)：每次執行後呼叫（引擎用來發 core:commandRun）
  constructor({ hasRef = () => true, getEntity = () => null, textFilter = null, audience = 'general', onRun = null } = {}) {
    this._cmds = new Map();
    this.hasRef = hasRef;
    this.getEntity = getEntity;
    this.textFilter = textFilter;
    this.audience = audience;
    this.onRun = onRun;
  }

  register(def, owner) {
    if (!def?.id || typeof def.run !== 'function') {
      throw new FrameworkError('BAD_COMMAND', '指令必須有 id 與 run 函式', '檢查 registerCommand 傳入的物件。');
    }
    if (!def.id.startsWith(`${owner}.`)) {
      throw new FrameworkError('COMMAND_NAMESPACE', `模組「${owner}」的指令名稱必須以「${owner}.」開頭，收到「${def.id}」`, `改成「${owner}.xxx」。`);
    }
    if (this._cmds.has(def.id)) {
      throw new FrameworkError('DUP_COMMAND', `指令「${def.id}」重複註冊`, '指令名稱在整個專案裡必須唯一。');
    }
    for (const fn of ['available', 'canRun']) {
      if (def[fn] !== undefined && typeof def[fn] !== 'function') {
        throw new FrameworkError('BAD_COMMAND', `指令「${def.id}」的 ${fn} 必須是 function`);
      }
    }
    for (const [name, p] of Object.entries(def.params || {})) {
      if (!TYPES.has(p?.type)) {
        throw new FrameworkError('BAD_PARAM', `指令「${def.id}」的參數「${name}」型別不明：${p?.type}`, `可用型別：${[...TYPES].join('、')}`);
      }
      if (p.type === 'enum' && !Array.isArray(p.values)) {
        throw new FrameworkError('BAD_PARAM', `指令「${def.id}」的 enum 參數「${name}」缺少 values`);
      }
      if (p.userText && p.type !== 'string') {
        throw new FrameworkError('BAD_PARAM', `指令「${def.id}」的參數「${name}」標了 userText，但型別不是 string`);
      }
      if (p.choices !== undefined && typeof p.choices !== 'function') {
        throw new FrameworkError('BAD_PARAM', `指令「${def.id}」的參數「${name}」的 choices 必須是 function`);
      }
    }
    this._cmds.set(def.id, { ...def, owner, aiCallable: !!def.aiCallable });
  }

  unregisterOwner(owner) {
    for (const [id, c] of this._cmds) if (c.owner === owner) this._cmds.delete(id);
  }

  get(id) { return this._cmds.get(id) || null; }

  list({ aiCallable = null } = {}) {
    return [...this._cmds.values()].filter((c) => aiCallable === null || c.aiCallable === aiCallable);
  }

  // 此刻能不能做（不看參數）。回傳 { ok, reason }。
  availability(defOrId, call = {}) {
    const def = typeof defOrId === 'string' ? this._cmds.get(defOrId) : defOrId;
    if (!def) return { ok: false, reason: '這個功能目前沒有開啟' };
    if (!def.available) return { ok: true, reason: null };
    try {
      const reason = reasonOf(def.available(normCall(call)), '現在不能做這件事');
      return { ok: !reason, reason };
    } catch (e) {
      return { ok: false, reason: `檢查時出錯：${e.message}` };
    }
  }

  // 給某個呼叫者看的指令清單（介面用）：含是否可用與原因。
  listFor(call = {}) {
    const c = normCall(call);
    return this.list({ aiCallable: c.source === 'ai' ? true : null })
      .map((def) => ({ def, ...this.availability(def, c) }));
  }

  // 給提示詞組裝器用：只含 AI 可呼叫、此刻可用的指令，以及參數的合法範圍。
  describeForAI(call = {}) {
    const c = normCall({ source: 'ai', ...call });
    return this.list({ aiCallable: true })
      .filter((def) => this.availability(def, c).ok)
      .map((def) => ({
        id: def.id,
        ...(def.label ? { label: def.label } : {}),
        description: def.description || '',
        params: Object.fromEntries(Object.entries(def.params || {}).map(([k, p]) => [k, describeParam(p, c)])),
      }));
  }

  validateArgs(def, args = {}, call = {}) {
    const fail = (error, reason = error) => ({ ok: false, code: 'BAD_ARGS', error: `指令「${def.id}」${error}`, reason });
    const clean = {};
    for (const [name, p] of Object.entries(def.params || {})) {
      let v = args?.[name];
      if (v === undefined || v === null) {
        if (p.default !== undefined) { clean[name] = p.default; continue; }
        if (p.optional) continue;
        return fail(`缺少參數「${name}」`);
      }
      switch (p.type) {
        case 'int': {
          let n = Number(v);
          if (typeof v === 'boolean' || v === '' || !Number.isFinite(n)) return fail(`的參數「${name}」不是數字`);
          n = Math.round(n);
          if (p.min !== undefined && n < p.min) { if (p.clamp) n = p.min; else return fail(`的參數「${name}」不能小於 ${p.min}`); }
          if (p.max !== undefined && n > p.max) { if (p.clamp) n = p.max; else return fail(`的參數「${name}」不能大於 ${p.max}`); }
          clean[name] = n; break;
        }
        case 'string': {
          if (typeof v !== 'string') return fail(`的參數「${name}」必須是文字`);
          v = v.replace(/[\u0000-\u001f\u007f]/g, ' ');
          if (p.maxLen && v.length > p.maxLen) { if (p.truncate) v = v.slice(0, p.maxLen); else return fail(`的參數「${name}」太長（上限 ${p.maxLen} 字）`, `字太多了，最多 ${p.maxLen} 個字`); }
          if (p.userText) {
            const f = this._filter(v);
            if (!f.ok) return { ok: false, code: 'TEXT_REJECTED', error: `指令「${def.id}」的參數「${name}」沒有通過內容檢查：${f.reason}`, reason: f.reason };
            v = f.text;
          }
          clean[name] = v; break;
        }
        case 'enum':
          if (!p.values.includes(v)) return fail(`的參數「${name}」必須是 ${p.values.join('、')} 其中之一`);
          clean[name] = v; break;
        case 'bool':
          if (typeof v !== 'boolean') return fail(`的參數「${name}」必須是 true 或 false`);
          clean[name] = v; break;
        case 'ref':
          if (typeof v !== 'string' || !this.hasRef(p.of, v)) return fail(`的參數「${name}」找不到對應的 ${p.of}：${v}`, '找不到這個東西');
          clean[name] = v; break;
        case 'entity': {
          const ent = typeof v === 'string' ? this.getEntity(v) : null;
          if (!ent) return fail(`的參數「${name}」找不到實體：${v}`, '那個東西已經不在了');
          const kinds = p.kind === undefined ? null : [].concat(p.kind);
          if (kinds && !kinds.includes(ent.kind)) return fail(`的參數「${name}」必須是 ${kinds.join('、')}，收到 ${ent.kind}`, '不能對這個東西這樣做');
          if (p.owner && ent.owner !== p.owner) return fail(`的參數「${name}」不屬於模組 ${p.owner}`, '不能對這個東西這樣做');
          clean[name] = v; break;
        }
        default: break;
      }
    }
    return { ok: true, args: clean }; // 沒宣告的參數一律丟掉
  }

  // 只檢查、不執行：介面可以用它決定按鈕要不要變灰。
  check(id, args = {}, call = {}) {
    const c = normCall(call);
    const def = this._cmds.get(id);
    if (!def) return { ok: false, code: 'NOT_FOUND', error: `找不到指令「${id}」（對應的模組可能沒有啟用）`, reason: '這個功能目前沒有開啟' };
    if (c.source === 'ai' && !def.aiCallable) return { ok: false, code: 'NOT_AI', error: `指令「${id}」不開放給 AI 使用`, reason: '居民不能做這件事' };
    const av = this.availability(def, c);
    if (!av.ok) return { ok: false, code: 'UNAVAILABLE', error: `指令「${id}」現在不能用：${av.reason}`, reason: av.reason };
    const v = this.validateArgs(def, args, c);
    if (!v.ok) return v;
    if (def.canRun) {
      let reason;
      try { reason = reasonOf(def.canRun(v.args, c), '現在不能這樣做'); } catch (e) { reason = `檢查時出錯：${e.message}`; }
      if (reason) return { ok: false, code: 'REFUSED', error: `指令「${id}」不能執行：${reason}`, reason };
    }
    return { ok: true, def, args: v.args, call: c };
  }

  // 執行。call.source：'player' | 'ai' | 'system'。AI 只能呼叫 aiCallable 的指令。
  run(id, args = {}, call = {}) {
    const chk = this.check(id, args, call);
    let out;
    if (!chk.ok) out = chk;
    else {
      try {
        out = { ok: true, result: chk.def.run(chk.args, chk.call) };
      } catch (e) {
        out = { ok: false, code: 'FAILED', error: `指令「${id}」執行失敗：${e.message}`, reason: '做到一半出了點問題' };
      }
    }
    const c = normCall(call);
    try {
      this.onRun?.({ id, owner: this._cmds.get(id)?.owner ?? null, source: c.source, actor: c.actor, caller: c.caller, args: chk.args ?? null, ok: out.ok, ...(out.ok ? {} : { code: out.code, reason: out.reason }) });
    } catch { /* 監聽端出錯不影響指令結果 */ }
    return out;
  }

  _filter(text) {
    if (!this.textFilter) return { ok: true, text };
    try {
      const r = this.textFilter(text, { audience: this.audience });
      if (!r || typeof r.ok !== 'boolean') return { ok: false, reason: '內容檢查沒有回應，先不送出' };
      return r.ok ? { ok: true, text: typeof r.text === 'string' ? r.text : text } : { ok: false, reason: r.reason || '這句話不太適合，換個說法吧' };
    } catch {
      return { ok: false, reason: '內容檢查出錯，先不送出' };
    }
  }
}

export function normCall(call = {}) {
  const source = SOURCES.has(call.source) ? call.source : 'player';
  return { source, actor: call.actor ?? (source === 'player' ? 'player' : null), caller: call.caller ?? null };
}

function describeParam(p, call) {
  const out = { type: p.type };
  if (p.values) out.values = p.values;
  if (p.labels) out.labels = p.labels;
  if (p.min !== undefined) out.min = p.min;
  if (p.max !== undefined) out.max = p.max;
  if (p.of) out.of = p.of;
  if (p.kind !== undefined) out.kind = p.kind;
  if (p.maxLen) out.maxLen = p.maxLen;
  if (p.optional || p.default !== undefined) out.optional = true;
  if (p.choices) {
    try {
      const list = p.choices(call);
      if (Array.isArray(list)) out.choices = list.slice(0, MAX_CHOICES);
    } catch { out.choices = []; }
  }
  return out;
}
