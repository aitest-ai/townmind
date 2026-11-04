// 指令系統：玩家操作、介面按鈕、AI 居民的決策，全部走同一個入口。
//
// 關鍵設計：AI 能做的事 = 「已啟用模組裡標了 aiCallable 的指令」。
// 提示詞裡的「允許行動清單」由 describeForAI() 自動產生，所以關掉一個模組，
// AI 就自動不會再提到它，不需要改提示詞，也不會呼叫到不存在的功能。
//
// 指令定義：
//   { id: 'crowd.assign',            // 必須以「模組id.」開頭
//     description: '派小人去做事',
//     aiCallable: true,              // 是否開放給 AI（預設 false）
//     params: {                      // 參數驗證，AI 亂填也只能在這個範圍內
//       task:  { type: 'enum', values: ['gather', 'build', 'rest'] },
//       count: { type: 'int', min: 1, max: 10, clamp: true },   // clamp：超出範圍夾回，否則拒絕
//     },
//     run(args, ctx) { ... } }
// 參數型別：int / string（maxLen、truncate）/ enum（values）/ bool / ref（of: 'items'|'species'|'recipes'|'residents'）
import { FrameworkError } from './errors.js';

const TYPES = new Set(['int', 'string', 'enum', 'bool', 'ref']);

export class CommandRegistry {
  constructor({ hasRef = () => true } = {}) {
    this._cmds = new Map();
    this.hasRef = hasRef;
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
    for (const [name, p] of Object.entries(def.params || {})) {
      if (!TYPES.has(p?.type)) {
        throw new FrameworkError('BAD_PARAM', `指令「${def.id}」的參數「${name}」型別不明：${p?.type}`, `可用型別：${[...TYPES].join('、')}`);
      }
      if (p.type === 'enum' && !Array.isArray(p.values)) {
        throw new FrameworkError('BAD_PARAM', `指令「${def.id}」的 enum 參數「${name}」缺少 values`);
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

  // 給提示詞組裝器用：只含 AI 可呼叫的指令，以及參數的合法範圍。
  describeForAI() {
    return this.list({ aiCallable: true }).map((c) => ({
      id: c.id,
      description: c.description || '',
      params: Object.fromEntries(Object.entries(c.params || {}).map(([k, p]) => [k, {
        type: p.type,
        ...(p.values ? { values: p.values } : {}),
        ...(p.min !== undefined ? { min: p.min } : {}),
        ...(p.max !== undefined ? { max: p.max } : {}),
        ...(p.of ? { of: p.of } : {}),
        ...(p.maxLen ? { maxLen: p.maxLen } : {}),
      }])),
    }));
  }

  validateArgs(def, args = {}) {
    const fail = (error) => ({ ok: false, error: `指令「${def.id}」${error}` });
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
          if (!Number.isFinite(n)) return fail(`的參數「${name}」不是數字`);
          n = Math.round(n);
          if (p.min !== undefined && n < p.min) { if (p.clamp) n = p.min; else return fail(`的參數「${name}」不能小於 ${p.min}`); }
          if (p.max !== undefined && n > p.max) { if (p.clamp) n = p.max; else return fail(`的參數「${name}」不能大於 ${p.max}`); }
          clean[name] = n; break;
        }
        case 'string': {
          if (typeof v !== 'string') return fail(`的參數「${name}」必須是文字`);
          if (p.maxLen && v.length > p.maxLen) { if (p.truncate) v = v.slice(0, p.maxLen); else return fail(`的參數「${name}」太長（上限 ${p.maxLen} 字）`); }
          clean[name] = v.replace(/[\u0000-\u001f]/g, ' '); break;
        }
        case 'enum':
          if (!p.values.includes(v)) return fail(`的參數「${name}」必須是 ${p.values.join('、')} 其中之一`);
          clean[name] = v; break;
        case 'bool':
          if (typeof v !== 'boolean') return fail(`的參數「${name}」必須是 true 或 false`);
          clean[name] = v; break;
        case 'ref':
          if (typeof v !== 'string' || !this.hasRef(p.of, v)) return fail(`的參數「${name}」找不到對應的 ${p.of}：${v}`);
          clean[name] = v; break;
        default: break;
      }
    }
    return { ok: true, args: clean }; // 沒宣告的參數一律丟掉
  }

  // source：'player' | 'ai' | 'system'。AI 只能呼叫 aiCallable 的指令。
  run(id, args = {}, { source = 'player', ctx = null } = {}) {
    const def = this._cmds.get(id);
    if (!def) return { ok: false, error: `找不到指令「${id}」（對應的模組可能沒有啟用）` };
    if (source === 'ai' && !def.aiCallable) return { ok: false, error: `指令「${id}」不開放給 AI 使用` };
    const v = this.validateArgs(def, args);
    if (!v.ok) return v;
    try {
      return { ok: true, result: def.run(v.args, ctx) };
    } catch (e) {
      return { ok: false, error: `指令「${id}」執行失敗：${e.message}` };
    }
  }
}
