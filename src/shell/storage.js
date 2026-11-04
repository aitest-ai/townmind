// 存檔後端（瀏覽器）：localStorage，失敗時（例如無痕模式、空間不足）自動改用記憶體，並回報原因。
// 每次存檔會把上一份保留成「備份」；讀到壞掉的存檔時，原始內容另存一份，不會被蓋掉。

export function createStorage(prefix = 'townmind') {
  const mem = new Map();
  let ls = null;
  try { ls = window.localStorage; ls.setItem(`${prefix}:probe`, '1'); ls.removeItem(`${prefix}:probe`); } catch { ls = null; }
  const get = (k) => (ls ? ls.getItem(k) : mem.get(k) ?? null);
  const set = (k, v) => { if (ls) ls.setItem(k, v); else mem.set(k, v); };
  const del = (k) => { if (ls) ls.removeItem(k); else mem.delete(k); };
  const key = (slot) => `${prefix}:${slot}`;

  return {
    persistent: !!ls,
    // 回傳 { status: 'empty' | 'ok' | 'broken', blob?, error? }
    load(slot) {
      const raw = get(key(slot));
      if (raw == null) return { status: 'empty' };
      try { return { status: 'ok', blob: JSON.parse(raw) }; } catch (e) {
        try { set(key(`${slot}:broken`), raw); } catch { /* 空間不足就算了 */ }
        return { status: 'broken', error: '存檔內容不是完整的資料（可能存到一半被中斷）' };
      }
    },
    loadBackup(slot) { return this.load(`${slot}:backup`); },
    // rotate：把上一份存成備份。上一份如果是壞的（不是完整 JSON）就不轉，避免把好的備份蓋掉。
    save(slot, blob, { rotate = true } = {}) {
      const text = JSON.stringify(blob);
      try {
        const prev = get(key(slot));
        let prevOk = false;
        if (prev != null) { try { JSON.parse(prev); prevOk = true; } catch { /* 壞的 */ } }
        if (rotate && prevOk) set(key(`${slot}:backup`), prev);
        set(key(slot), text);
        return { ok: true, bytes: text.length };
      } catch (e) {
        return { ok: false, error: '瀏覽器的儲存空間不夠或被關閉了，這次沒存到。可以先用「匯出存檔」下載備份。' };
      }
    },
    remove(slot) { del(key(slot)); },
    raw(slot) { return get(key(slot)); },
    exportText(text, filename) {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    // 匯出：下載一個 .json 檔
    exportFile(blob, filename) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 1)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    // 匯入：讓使用者選一個檔案，回傳解析後的物件
    importFile() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json';
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) { reject(new Error('沒有選擇檔案')); return; }
          try { resolve(JSON.parse(await f.text())); } catch { reject(new Error('這個檔案不是存檔（看不懂內容）')); }
        };
        input.click();
      });
    },
  };
}
