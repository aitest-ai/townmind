# 架構

## 1. 三層分離
1. **世界模擬層**（無 AI、無畫面）：實體、時間、背包、各模組的規則。可在 Node 裡完整測試。
2. **AI 決策層**：規則腦（無金鑰也能跑）與 LLM 腦（`/api/decide`）。輸出一律經 `validate()`／指令驗證，AI 只能做「已啟用模組開放給 AI 的指令」。
3. **渲染層**（2D、3D）：只讀世界資料、不修改遊戲狀態、不 import 任何模組。

核心（`src/core`）不認識任何具體模組，也不碰瀏覽器 API 與 three.js；瀏覽器能力一律由 `services` 注入。

## 2. 核心 + 模組 + 世界包
- **核心**：Engine（生命週期、依賴解析、系統排程、存檔、錯誤隔離）、EventBus、CommandRegistry、旗標、世界包載入與驗證。
- **模組**：`src/modules/<id>/index.js`，每個功能一個。目錄在 `src/modules/catalog.json`。
- **世界包**：`data/worldpacks/<id>/*.json`，描述一個世界的所有資料與要啟用哪些模組。

## 3. 模組契約
```js
export default {
  id: 'farming', version: '0.1.0',
  requires: [], optional: ['weather-seasons'], conflicts: [],
  emits: ['farming:cropHarvested'],     // 宣告後強制只能發這些
  config: { /* 預設設定，世界包可覆蓋 */ },
  init(ctx) { /* ... */ return { api: { /* 給其他模組的公開介面 */ } }; },
  dispose(ctx) {},
};
```
`ctx` 提供：`on/emit`（emit 只能用 `模組id:` 開頭）、`getModule(id)`（只能取 requires/optional 宣告過的；optional 未啟用回傳 `null`）、
`registerSystem`、`registerCommand`、`registerSaveSlice`、`registerPanel`、`registerEntityKind`、`runCommand`、`config`、`data`、`services`、`log`。
範例見 `src/modules/_template/index.js`。

啟動順序：被依賴的先 init；缺依賴、衝突、循環、未知模組都會得到白話中文錯誤。`init` 失敗會把已啟動的模組收乾淨。
系統（system）連續出錯 3 次只停用該系統並發出 `core:moduleError`，不拖垮整個遊戲。

## 4. 指令與 AI
所有操作（玩家、介面按鈕、AI）走 `CommandRegistry`。指令名 `模組id.動作`，參數有型別驗證（int/string/enum/bool/ref，可 clamp/truncate），未宣告的參數會被丟掉。
`aiCallable: true` 的指令才開放給 AI；`describeForAI()` 自動產生提示詞中的「允許行動清單」。**關掉一個模組，AI 自動不會再提到它。**

## 5. 存檔
每個模組註冊自己的切片（key = 模組 id 或 `id.xxx`，整數 version，只存純 JSON）。
- 沒啟用的模組的資料原封不動保留（孤兒保存），之後再啟用還在。
- 某切片載入失敗：保留原始資料、不用預設值覆蓋，並回報。
- 預設存 localStorage，要有匯出／匯入。版本升級在 `deserialize(data, savedVersion)` 內處理。

## 6. 世界包
`pack`（受眾、模組開關與設定、起始背包）、`items`、`species`、`recipes`、`residents`、`island`（ASCII 地圖、放置物、區域）、`art`、`text`。
`npm run check` 驗證：id 格式與唯一、參照完整、地圖尺寸與出生點、模組依賴與所需資料、角色卡字數限制，以及**兒童版安全規則**（捕捉只允許 `catch_release`／`collect`／`photo`）。
功能開關：`pack.json` 的 `modules` 為預設，網址可覆寫，如 `?mods=farming=off,capture=on`。

## 7. 邊界規則（`scripts/check-boundaries.mjs`，CI 執行）
1. core 不 import 模組／渲染層／three，不用 document/window/localStorage。
2. 渲染層不 import 模組。
3. 模組只能 import core，以及 catalog 宣告為 requires/optional 的其他模組的 `index.js`；不 import 渲染層／three。
4. 每個模組都要先登記在 catalog。
5. **新增一個模組不應修改 `src/core`。** 若需要，代表核心介面不夠，請另開 PR 說明。

## 8. 核心服務（由 WP0 補齊，以 services 注入）
- `entities`：實體表（id、kind、位置、狀態），渲染層讀它；`registerEntityKind` 定義行為。
- `time`：遊戲時間與天數，含課堂倍率（`timeScale`）。
- `inventory`：背包與物品操作。
- `storage`：存檔後端（localStorage／記憶體），可替換。
- `input`、`camera`、`uiShell`：輸入、鏡頭、面板容器（面板由模組註冊，外殼決定擺放）。
介面細節由 Code 在 WP0 依實作需要定案，但請保持「核心不依賴瀏覽器」。

## 9. 遷移計畫（原型 → 框架）
- `residents` 模組：`src/brain.js`、`src/prompt.js`、`data/npcs.js` → 讀世界包 residents；提示詞的行動清單改用 `describeForAI()`；`api/decide.js` 保留。
- `crowd` 模組：`src/world.js` 的小人與工地邏輯。
- 渲染層（`render2d`、`render3d`）改讀核心實體，不再讀 `world.js` 內部。
- `data/npcs.js` 由世界包取代。遷移期間原型須持續可執行。

## 10. 留給實作者判斷的事
實體資料結構、services 的細節 API、UI 外殼樣式、群體小人的效能方案（instancing／VAT）、LLM 批次生成的 prompt 設計、地圖編輯方式。覺得契約不合理，請先提出意見。
