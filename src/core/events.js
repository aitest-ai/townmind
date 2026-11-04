// 事件匯流排。事件名稱慣例是「模組id:事件名」，例如 farming:cropHarvested；
// 引擎自己發的事件以 core: 開頭。模組只能發自己命名空間的事件（由 Engine 的 ctx.emit 強制），
// 但可以監聽任何事件，這是模組之間鬆耦合溝通的主要方式。
export class EventBus {
  constructor(onError = null) {
    this._h = new Map();
    this.onError = onError;
  }

  on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('事件處理函式必須是 function');
    if (!this._h.has(name)) this._h.set(name, new Set());
    this._h.get(name).add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => { off(); fn(payload); });
    return off;
  }

  off(name, fn) {
    this._h.get(name)?.delete(fn);
  }

  // 一個處理函式出錯不會影響其他處理函式；錯誤交給 onError 回報。
  emit(name, payload) {
    const set = this._h.get(name);
    if (!set) return 0;
    let ok = 0;
    for (const fn of [...set]) {
      try { fn(payload); ok++; } catch (e) { this.onError?.(name, e); }
    }
    return ok;
  }

  clear() { this._h.clear(); }
}
