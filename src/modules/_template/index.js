// 模組樣板：新增模組時複製這個資料夾，改名成 src/modules/<模組id>/，並先到 catalog.json 登記。
// 底線開頭的資料夾（_template）不會被當成模組，也不會被邊界檢查。
//
// 開發規則（會被 scripts/check-boundaries.mjs 與 CI 檢查）：
//  - 只能 import ../../core/、以及 catalog.json 宣告過的其他模組的 index.js。
//  - 不可 import three 或渲染層；要讓東西出現在畫面上，註冊實體種類與美術 id，由渲染層去畫。
//  - 事件名稱必須是「模組id:事件名」；指令名稱必須是「模組id.指令名」；存檔欄位 key 必須是模組 id 或以「模組id.」開頭。
//  - 新增一個模組不應該需要修改 src/core。如果需要，先停下來：這代表核心的介面不夠好，請另開 PR 改核心並說明原因。
export default {
  id: 'example',
  version: '0.1.0',
  requires: [],
  optional: [],
  emits: ['example:somethingHappened'],
  config: { greeting: '你好' },

  init(ctx) {
    let counter = 0;

    ctx.registerSystem({
      id: 'example.tick',
      order: 100,
      update(dt) { counter += dt; },
    });

    // 開放給 AI 的指令：參數範圍就是 AI 能做的上限
    ctx.registerCommand({
      id: 'example.sayHello',
      description: '對某位居民打招呼',
      aiCallable: true,
      params: { who: { type: 'ref', of: 'residents' } },
      run({ who }) {
        ctx.emit('example:somethingHappened', { who });
        return `${ctx.config.greeting}，${who}`;
      },
    });

    // 存檔切片：只存「純資料」。未啟用時，這份資料會被原封不動保留。
    ctx.registerSaveSlice({
      key: 'example',
      version: 1,
      serialize: () => ({ counter }),
      deserialize: (data, savedVersion) => { counter = data?.counter ?? 0; }, // savedVersion 舊時在這裡做升級
    });

    return { api: { getCounter: () => counter } }; // 給其他模組用的公開介面（選填）
  },
};
