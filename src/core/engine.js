// 引擎：模組的生命週期、依賴解析、系統排程、存檔切片、錯誤隔離。
// 核心不認識任何具體模組（耕作、捕捉……），只認識這份「模組契約」。
//
// 模組定義（default export 一個物件）：
//   {
//     id: 'farming',                      // 小寫英數與連字號
//     version: '0.1.0',
//     requires: ['gathering'],            // 必須同時啟用，否則啟動失敗並說明
//     optional: ['weather-seasons'],      // 有啟用就先初始化它；沒啟用時 ctx.getModule 回傳 null
//     conflicts: [],
//     emits: ['farming:cropHarvested'],   // 選填：宣告會發的事件，宣告了就強制只能發這些
//     config: { ...預設設定 },            // 世界包的 modules.farming.config 會覆蓋
//     init(ctx) { ...; return { api: {...} }; },   // api 是給其他模組用的公開介面（選填）
//     dispose(ctx) {},                    // 選填
//   }
//
// init 裡可以用的 ctx（只能透過它與引擎互動）：
//   ctx.id / ctx.config / ctx.data（世界包資料）/ ctx.services（時間、背包等，由外部注入）
//   ctx.on(name, fn) / ctx.emit(name, payload)          事件（emit 只能用自己的命名空間）
//   ctx.getModule(id)                                   取得「已宣告依賴」的模組的公開 api
//   ctx.registerSystem({ id, order, update(dt) })       每個遊戲更新呼叫，order 小的先跑
//   ctx.registerCommand(def)                            見 commands.js
//   ctx.registerSaveSlice({ key, version, serialize, deserialize })
//   ctx.registerPanel({ id, title, order, mount(el) })  介面面板（由 UI 外殼決定怎麼放）
//   ctx.registerEntityKind(kind, handler)               實體種類的行為
//   ctx.runCommand(id, args)                            呼叫指令（沒啟用的模組會回傳 ok:false，不會丟錯）
//   ctx.log(...)
import { EventBus } from './events.js';
import { CommandRegistry } from './commands.js';
import { FrameworkError } from './errors.js';

const MODULE_ID = /^[a-z][a-z0-9-]*$/;
const MAX_SYSTEM_ERRORS = 3;

export class Engine {
  constructor({ data = {}, services = {}, onError = null, log = null } = {}) {
    this.data = data;
    this.services = services;
    this.onError = onError;
    this._log = log;
    this.events = new EventBus((name, e) => this._report('core', `事件「${name}」的處理函式出錯：${e.message}`, e));
    this.commands = new CommandRegistry({ hasRef: (of, id) => this._hasRef(of, id) });
    this._defs = new Map();
    this._started = [];
    this._apis = new Map();
    this._ctxs = new Map();
    this._systems = [];
    this._slices = new Map();
    this._panels = [];
    this._kinds = new Map();
    this._unsubs = new Map();
    this._seq = 0;
    this._orphans = {};
    this._preserve = new Set();
  }

  // ---------- 註冊與解析 ----------
  register(def) {
    if (!def || !MODULE_ID.test(def.id || '')) {
      throw new FrameworkError('BAD_MODULE', `模組 id 不合法：「${def?.id}」`, '只能用小寫英文、數字與連字號，且以英文字母開頭。');
    }
    if (typeof def.version !== 'string') {
      throw new FrameworkError('BAD_MODULE', `模組「${def.id}」缺少 version`, '請填 "0.1.0" 這類版本字串。');
    }
    if (this._defs.has(def.id)) {
      throw new FrameworkError('DUP_MODULE', `模組「${def.id}」重複註冊`, '每個模組 id 只能註冊一次。');
    }
    this._defs.set(def.id, def);
    return this;
  }

  hasModule(id) { return this._defs.has(id); }

  // 回傳啟動順序（被依賴的先啟動）。錯誤訊息都是白話中文並附提示。
  resolve(enabledIds, { skipUnknown = false } = {}) {
    const skipped = [];
    const ids = [];
    for (const id of enabledIds) {
      if (this._defs.has(id)) { if (!ids.includes(id)) ids.push(id); }
      else if (skipUnknown) skipped.push(id);
      else {
        throw new FrameworkError('UNKNOWN_MODULE', `模組「${id}」沒有註冊`, '可能是還沒實作，或名稱拼錯了。若只是還沒實作，啟動時可用 skipUnknown 略過。');
      }
    }
    const on = new Set(ids);
    for (const id of ids) {
      const d = this._defs.get(id);
      for (const r of d.requires || []) {
        if (!on.has(r)) throw new FrameworkError('MISSING_DEP', `模組「${id}」需要先啟用「${r}」，但「${r}」沒有啟用`, `請啟用「${r}」，或是把「${id}」也關掉。`);
      }
      for (const c of d.conflicts || []) {
        if (on.has(c)) throw new FrameworkError('CONFLICT', `模組「${id}」與「${c}」不能同時啟用`, '請二選一。');
      }
    }
    const deps = new Map(ids.map((id) => {
      const d = this._defs.get(id);
      return [id, [...(d.requires || []), ...(d.optional || []).filter((o) => on.has(o))]];
    }));
    const order = [], done = new Set(), visiting = new Set();
    const visit = (id, trail) => {
      if (done.has(id)) return;
      if (visiting.has(id)) {
        const cyc = [...trail.slice(trail.indexOf(id)), id];
        throw new FrameworkError('CYCLE', `模組之間循環依賴：${cyc.join(' → ')}`, '請拆掉其中一個依賴，或把共用的部分抽到核心。');
      }
      visiting.add(id);
      for (const d of deps.get(id)) visit(d, [...trail, id]);
      visiting.delete(id);
      done.add(id);
      order.push(id);
    };
    for (const id of ids) visit(id, []);
    return { order, skipped };
  }

  // ---------- 啟動與關閉 ----------
  start({ enabled = [], config = {}, skipUnknown = false } = {}) {
    if (this._started.length) throw new FrameworkError('ALREADY_STARTED', '引擎已經啟動', '請先呼叫 dispose()。');
    const { order, skipped } = this.resolve(enabled, { skipUnknown });
    let current = null;
    try {
      for (const id of order) {
        current = id;
        const def = this._defs.get(id);
        const ctx = this._makeCtx(def, { ...(def.config || {}), ...(config[id] || {}) });
        this._ctxs.set(id, ctx);
        this._started.push(id); // 先記下來，初始化失敗時才能一併收乾淨
        const res = def.init?.(ctx);
        if (res && res.api) this._apis.set(id, res.api);
      }
    } catch (e) {
      this.dispose();
      if (e instanceof FrameworkError) throw e;
      throw new FrameworkError('MODULE_INIT_FAILED', `模組「${current}」啟動失敗：${e.message}`, '其他已啟動的模組已經收乾淨。請看這個模組的 init。');
    }
    this.events.emit('core:started', { modules: [...this._started], skipped });
    return { started: [...this._started], skipped };
  }

  dispose() {
    for (const id of [...this._started].reverse()) {
      try { this._defs.get(id).dispose?.(this._ctxs.get(id)); } catch (e) { this._report(id, `關閉時出錯：${e.message}`, e); }
      for (const off of this._unsubs.get(id) || []) { try { off(); } catch { /* 忽略 */ } }
      this.commands.unregisterOwner(id);
    }
    this._systems = []; // 所有已啟動的模組都關閉了，它們註冊的東西一併清掉
    this._panels = [];
    this._kinds.clear();
    this._slices.clear();
    this._unsubs.clear();
    this._apis.clear();
    this._ctxs.clear();
    this._started = [];
  }

  isEnabled(id) { return this._started.includes(id); }
  enabledModules() { return [...this._started]; }

  // ---------- 每幀更新 ----------
  update(dt) {
    for (const s of this._systems) {
      if (s.disabled) continue;
      try {
        s.update(dt);
        s.errors = 0;
      } catch (e) {
        s.errors++;
        if (s.errors >= MAX_SYSTEM_ERRORS) s.disabled = true;
        this._report(s.owner, `系統「${s.id}」出錯${s.disabled ? '，連續失敗太多次，已暫時停用這個系統' : ''}：${e.message}`, e, { system: s.id, disabled: s.disabled });
      }
    }
  }

  // ---------- 存檔 ----------
  serializeAll() {
    const modules = {};
    for (const key of [...this._slices.keys()].sort()) {
      if (this._preserve.has(key)) { modules[key] = this._orphans[key]; continue; } // 載入失敗的切片：保留原始資料，不用預設值蓋掉
      const s = this._slices.get(key);
      modules[key] = { v: s.version, data: s.serialize() };
    }
    for (const [key, entry] of Object.entries(this._orphans)) if (!(key in modules)) modules[key] = entry; // 沒啟用的模組：資料原封不動保留
    try {
      return JSON.parse(JSON.stringify({ format: 1, modules }));
    } catch (e) {
      throw new FrameworkError('SAVE_NOT_JSON', `存檔資料無法轉成 JSON：${e.message}`, '切片的 serialize() 只能回傳純資料（不可有函式、循環參照）。');
    }
  }

  deserializeAll(blob) {
    if (!blob || blob.format !== 1 || typeof blob.modules !== 'object') {
      throw new FrameworkError('BAD_SAVE', '存檔格式看不懂（可能損毀或太舊）', '請匯入備份，或開始新遊戲。');
    }
    const report = { loaded: [], orphaned: [], failed: [] };
    this._orphans = {};
    this._preserve = new Set();
    for (const [key, entry] of Object.entries(blob.modules)) {
      const slice = this._slices.get(key);
      if (!slice) { this._orphans[key] = entry; report.orphaned.push(key); continue; }
      try {
        slice.deserialize(entry.data, entry.v);
        report.loaded.push(key);
      } catch (e) {
        this._orphans[key] = entry;
        this._preserve.add(key);
        report.failed.push({ key, error: e.message });
      }
    }
    return report;
  }

  // ---------- 查詢 ----------
  listPanels() { return [...this._panels].sort((a, b) => a.order - b.order || a.seq - b.seq); }
  entityKind(kind) { return this._kinds.get(kind)?.handler ?? null; }

  // ---------- 內部 ----------
  _hasRef(of, id) {
    const list = this.data?.[of];
    return Array.isArray(list) && list.some((x) => x?.id === id);
  }

  _report(owner, message, error = null, extra = {}) {
    this._log?.(`[${owner}] ${message}`);
    const info = { module: owner, message, ...extra };
    this.events.emit('core:moduleError', info);
    this.onError?.(info, error);
  }

  _track(owner, off) {
    if (!this._unsubs.has(owner)) this._unsubs.set(owner, []);
    this._unsubs.get(owner).push(off);
  }

  _makeCtx(def, config) {
    const id = def.id;
    const allowed = new Set([...(def.requires || []), ...(def.optional || [])]);
    const owns = (key) => key === id || key.startsWith(`${id}.`);
    return {
      id,
      config,
      data: this.data,
      services: this.services,
      log: (...a) => this._log?.(`[${id}]`, ...a),

      on: (name, fn) => { const off = this.events.on(name, fn); this._track(id, off); return off; },
      emit: (name, payload) => {
        if (!name.startsWith(`${id}:`)) {
          throw new FrameworkError('EVENT_NAMESPACE', `模組「${id}」只能發出以「${id}:」開頭的事件，收到「${name}」`, `改成「${id}:xxx」。`);
        }
        if (def.emits && !def.emits.includes(name)) {
          throw new FrameworkError('EVENT_UNDECLARED', `模組「${id}」沒有宣告事件「${name}」`, '請把它加進模組的 emits 清單。');
        }
        return this.events.emit(name, payload);
      },
      getModule: (other) => {
        if (!allowed.has(other)) {
          throw new FrameworkError('UNDECLARED_DEP', `模組「${id}」想使用「${other}」，但沒有在 requires 或 optional 裡宣告`, '請先宣告依賴，否則關掉那個模組時會出問題。');
        }
        return this._apis.get(other) ?? null; // optional 的模組沒啟用時是 null，呼叫端要處理
      },

      registerSystem: (sys) => {
        if (typeof sys?.update !== 'function') throw new FrameworkError('BAD_SYSTEM', `模組「${id}」的系統缺少 update 函式`);
        this._systems.push({ owner: id, id: sys.id || `${id}#${this._systems.length}`, order: sys.order ?? 100, seq: this._seq++, update: sys.update, errors: 0, disabled: false });
        this._systems.sort((a, b) => a.order - b.order || a.seq - b.seq);
      },
      registerCommand: (cmd) => this.commands.register(cmd, id),
      registerSaveSlice: (slice) => {
        if (!owns(slice?.key || '')) throw new FrameworkError('SLICE_NAMESPACE', `模組「${id}」的存檔欄位必須是「${id}」或以「${id}.」開頭，收到「${slice?.key}」`);
        if (!Number.isInteger(slice.version) || slice.version < 1) throw new FrameworkError('BAD_SLICE', `存檔欄位「${slice.key}」的 version 必須是 1 以上的整數`);
        if (typeof slice.serialize !== 'function' || typeof slice.deserialize !== 'function') throw new FrameworkError('BAD_SLICE', `存檔欄位「${slice.key}」需要 serialize 與 deserialize`);
        if (this._slices.has(slice.key)) throw new FrameworkError('DUP_SLICE', `存檔欄位「${slice.key}」重複註冊`);
        this._slices.set(slice.key, { owner: id, ...slice });
      },
      registerPanel: (panel) => {
        if (!panel?.id) throw new FrameworkError('BAD_PANEL', `模組「${id}」的面板缺少 id`);
        this._panels.push({ owner: id, order: 100, seq: this._seq++, ...panel });
      },
      registerEntityKind: (kind, handler) => {
        if (this._kinds.has(kind)) throw new FrameworkError('DUP_KIND', `實體種類「${kind}」已被模組「${this._kinds.get(kind).owner}」註冊`);
        this._kinds.set(kind, { owner: id, handler });
      },
      runCommand: (cmdId, args) => this.commands.run(cmdId, args, { source: 'system', ctx: this._ctxs.get(id) }),
    };
  }
}
