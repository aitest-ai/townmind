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
所有操作（玩家、介面按鈕、AI）走 `CommandRegistry`。指令名 `模組id.動作`，參數有型別驗證（int/string/enum/bool/ref/entity，可 clamp/truncate），未宣告的參數會被丟掉。
- **呼叫情境 call**：`{ source: 'player'|'ai'|'system', actor, caller }`，指令的 `run(args, call)` 會收到。玩家操作由外殼呼叫 `engine.runCommand()`（actor 為 `player`）。
- **AI 受限執行**：模組用 `ctx.runCommand(id, args, { as: 'ai', actor })`，核心強制只能執行 `aiCallable` 的指令；模組只能降權，不能冒充玩家。
- **此刻能不能做**：`available(call)` 與 `canRun(args, call)` 回傳 `true` 或一句白話原因。不可用的指令不會出現在 AI 清單，介面可用 `commands.check()` / `listFor()` 讓按鈕變灰並顯示原因。
- **entity 參數**：`{ type: 'entity', kind: 'tree' }` 參照此刻地圖上存在的實體（經由 `services.entities.get`）。任何參數都可提供 `choices(call)`，作為給 AI 的候選值。
- **userText**：`{ type: 'string', userText: true }` 代表玩家打的字，會先經過 `services.textFilter`（預設為 `src/core/textfilter.js` 的本機兒童向過濾），不通過就以白話拒絕。
- **core:commandRun**：每次執行（成功或被拒）都會發出，供日記、小請求、重播使用。

`aiCallable: true` 且 available 的指令才開放給 AI；`ctx.describeCommandsForAI({ actor })` 自動產生提示詞中的「允許行動清單」。**關掉一個模組，AI 自動不會再提到它。**

## 5. 存檔
存檔是 `{ format: 2, meta, modules }`。`meta` 含世界包 id／版本、存檔時間、主種子、啟用的模組（外殼可補充遊戲時間等）。
- 每個模組註冊自己的切片（key = 模組 id 或 `id.xxx`，整數 version，只存純 JSON）；核心服務用 `registerCoreSlice`（key 以 `core.` 開頭），或在服務物件上放 `saveSlice` 自動註冊。
- 沒啟用的模組的資料原封不動保留（孤兒保存），之後再啟用還在。
- 某切片載入失敗：保留原始資料、不用預設值覆蓋，並回報。
- **切片版本比程式新**（學生用舊網頁開新存檔）：不載入、原封保留，回報在 `report.tooNew`。整個存檔格式比程式新：`SAVE_TOO_NEW`。
- **存檔屬於別的世界包**：預設拒絕（`PACK_MISMATCH`），外殼問過使用者後可用 `allowPackMismatch` 強制。
- **離線補算**：模組可實作 `catchUp(ctx, { elapsedMs, days })`，外殼讀檔後呼叫 `engine.catchUp()`；不可呼叫 AI，一律用 `ctx.rng`。
- **種子亂數**：`ctx.rng`（next／int／pick／chance）每個模組一條，由主種子衍生，狀態存在 `core.rng`，所以讀檔後結果可重現。
- 預設存 localStorage，要有匯出／匯入。版本升級在 `deserialize(data, savedVersion)` 內處理。

## 5.0 存檔壞掉時（外殼）
- 每次存檔會把上一份轉成備份；上一份如果是壞的就不轉，避免把好的備份蓋掉。這次讀檔出過問題時，整段遊戲都不動備份。
- 存檔讀不出來（內容不完整、屬於別的世界包、格式太新）：畫面上說明原因，讓使用者選「讀取備份（第幾天、何時存的）」「下載壞掉的存檔」「先玩新遊戲」。壞掉的原始內容另存在 `<slot>:broken`。
- 讀備份、匯入、開新遊戲會重新整理頁面；重新整理前不會再自動存檔（否則會蓋掉剛寫好的存檔）。
- 離線補算：外殼依「存檔時間到現在」算出經過幾個遊戲日（最多 7 天），先 `time.skipDays(n)`（每天發 `core:dayStarted`，帶 `offline: true`），再 `engine.catchUp({ days, elapsedMs })`。全程只用種子亂數、不呼叫 AI，所以同一份存檔補算結果一定相同（`tests/diary.test.mjs`）。

## 5.1 模組開關的連帶關閉
外殼以 `start({ cascade: true })` 啟動：某模組缺了依賴（例如網址 `?mods=residents=off`），依賴它的模組也一起關掉，並在 `notices` 裡用白話說明（「因為『居民』沒有開啟，『好感度』也一起關掉了。」），遊戲照常啟動。
世界包驗證（`npm run check`）仍把 pack.json 裡的缺依賴當成錯誤，因為那是寫資料的人該修的。

## 6. 世界包
核心只認識 `pack`（受眾、模組開關與設定、起始背包）、`items`、`species`、`island`（ASCII 地圖、放置物、區域）、`art`、`text`，並只做通用檢查：
id 格式與唯一、參照完整、地圖尺寸與出生點、模組依賴與所需資料，以及**兒童版安全政策**（任何資料裡的 `presentation` 只允許 `catch_release`／`collect`／`photo`）。

其他一切屬於模組：每個模組資料夾可附 `schema.js`，宣告它擁有的資料檔（例如 crafting 的 `recipes`、racing 的 `tracks`）、使用的物種 kind、放置物 type，以及自己的資料檢查。
`npm run check` 會收集所有 schema 一起檢查。**新增模組帶來新資料，不需要修改核心。**（規劃中的模組也先附 schema，作為它的資料契約。）
功能開關：`pack.json` 的 `modules` 為預設，網址可覆寫，如 `?mods=farming=off,capture=on`。

## 7. 邊界規則（`npm run check`，CI 執行）
1. core 不 import 模組／渲染層／three。
2. 渲染層不 import 模組。
3. 模組只能 import core，以及 catalog 宣告為 requires/optional 的其他模組的 `index.js`；不 import 渲染層／three／src 以外的檔案。
4. **core 與模組都不可直接用瀏覽器 API**（document、window、globalThis、localStorage、fetch、requestAnimationFrame、WebSocket……），一律由 services 注入，才能在 Node 完整測試。
5. 每個模組都要先登記在 catalog；`scripts/check-catalog.mjs` 檢查模組程式的 id、requires／optional／conflicts 與 catalog 完全一致，有 index.js 的模組 status 不可再是 planned。
6. **新增一個模組不應修改 `src/core`。** 若需要，代表核心介面不夠，請另開 PR 說明。
7. 世界包資料與模組 config 在執行時是唯讀的（deep freeze）；要改的狀態由模組自己保存。

## 8. 核心服務（`src/core/services/`，以 services 注入，不依賴瀏覽器）
`createCoreServices(packData)` 一次建好下列服務；外殼可替換任何一個。服務若帶 `saveSlice` 會自動存成 `core.<名稱>`，若有 `bind(core)` 可發 `core:` 事件。
- `time`：遊戲時鐘（`day`、`minuteOfDay`、`season`、`isNight`、`clockText()`）。`advance(真實秒數)` 回傳遊戲秒數交給 `engine.update`。課堂模式＝把 `dayLengthSec` 調短，另有 `timeScale`、`pause()`、真實時鐘模式。換日發 `core:dayStarted`；`skipDays(n)` 供離線補算（事件帶 `offline: true`）。
- `entities`：實體表 `{ id, kind, owner, ref, x, y, state }`，座標單位是「格」。渲染層只讀它。`move()` 不增加 `version`（避免每幀重建），結構變動才增加。模組關掉時，它擁有的實體自動從地圖移除；資料由模組自己的存檔切片保存（`snapshot(owner)`／`restore(owner, list)`）。只有 owner 為 `core` 的實體（例如玩家）由服務本身存檔。
- `inventory`：每個擁有者一個背包，依 `items.json` 的 `stack` 疊加、`slots` 限制格數；`add` 滿了會少放而不丟錯；`removeAll` 全部夠才拿。發 `core:inventoryChanged`。
- `textFilter`：玩家輸入過濾（`src/core/textfilter.js`）。
- 瀏覽器相關（`storage`、`input`、`camera`、`uiShell`）放在 `src/shell/`，不在核心。

## 8.1 實體互動、宣告式面板、AI 現況
- **實體互動**：`ctx.registerEntityKind('tree', { label: '樹', interactions: [{ label: '砍樹', command: 'gathering.harvest', args: (e) => ({ target: e.id }) }] })`。
  `engine.interactionsFor(entityId)` 回傳 `[{ label, command, args, ok, reason }]`；指令所屬模組沒開時，該互動直接不出現。外殼的「互動」按鈕只靠這個，新模組不需要改外殼。
- **宣告式面板**：`ctx.registerPanel({ id, title, order, placement: 'side'|'hud', view(call) })`，`view` 回傳節點清單，`engine.renderPanel(id)` 會替按鈕標上 `enabled`／`reason`。節點型別：
  `text { text }`、`stat { label, value }`、`bar { label, value: 0~1 }`、`list { items: [{ label, detail }] }`、`button { label, command, args, argsFrom? }`、`buttons { items }`、`input { name, label, maxLen, placeholder }`、`select { name, label, options: [{ value, label }] }`、`error { text }`。
  `argsFrom: { text: 'inputName' }` 表示按下時把輸入框的值當參數。面板出錯只會顯示白話錯誤，不會拖垮介面。`mount(el)` 仍可用，但只在例外情況使用。
- **AI 現況**：`ctx.registerAIContext((call) => ['田裡有 3 塊熟了'])`；居民模組用 `ctx.collectAIContext({ actor })` 取得 `[{ module, lines }]`（每模組最多 8 句、每句最多 200 字）。關掉模組，它的現況自動不再出現在提示詞裡。

## 9. 遷移計畫（原型 → 框架）
- 舊原型整包移到 `legacy/`（`legacy.html` 開啟），**不再修改**，作為比對基準，WP0 完成後再決定是否刪除。
- 新版外殼：`index.html` → `src/shell/boot.js`（讀世界包、驗證、依 catalog 動態載入模組、連帶關閉、讀存檔與離線補算、主迴圈、自動存檔）。
  外殼只依 catalog 的 `status`（implemented／prototype）與 `schema` 欄位決定要載入什麼，**新增模組不需要改外殼**。
- `residents` 模組：`legacy/brain.js`、`legacy/prompt.js` → 讀世界包 residents；提示詞的行動清單改用 `describeCommandsForAI()`；`api/decide.js` 保留（目前不接 AI，只用規則腦）。
- `crowd` 模組：`legacy/world.js` 的小人與工地邏輯。
- 渲染層（`src/render2d`、`src/render3d`）只讀核心實體與世界包。
- WP0a：原型的小鎮包成 `prototype-town` 世界包＋crowd／residents 模組，和 legacy 截圖比對。WP0b：換成島嶼地圖，用新截圖當基準。

## 9.1 玩家與互動（外殼，`src/shell/player.js`、`input.js`）
- 玩家是核心實體 `player`（owner 為 core，位置隨 `core.entities` 存檔）。鍵盤方向鍵／WASD 或在畫面上點一下（平板）走過去；不能走進 `walkable: false` 的地形，撞到時沿岸邊滑動。移動用真實時間，時間暫停時仍可走動。
- 走近（2.2 格內）有互動的實體，畫面下方出現大按鈕（`engine.interactionsFor`）；不能做時按鈕上直接寫原因。空白鍵／E 執行第一個可用的互動。
- `island.json` 的 `look`：`camera: 'overview'` 看整張地圖（原型小鎮），預設鏡頭跟著玩家；`outside: 'forest'` 外圍畫森林，否則是海；`flowers: false` 不畫小花。

## 9.2 外殼提供給模組的服務（不在核心）
外殼在 `src/shell/boot.js` 建立 Engine 時，除了核心服務，還放入這些服務（模組用 `ctx.services.xxx?.()` 呼叫，沒有外殼時，例如在 Node 測試裡，就不存在）：
- `notify(text, level)`：白話訊息寫進事件紀錄；`level: 'banner'` 顯示在畫面中央，`'toast'` 顯示提示。
- `policy`：模組設定外殼要遵守的限制（`src/shell/policy.js`）：`playerTimeControl`、`maxSpeed`、`playerTyping`、`typingReason`、`playerSaveControl`。多個模組設定時取最嚴格的；模組關掉時自動清掉。
- `now()`：真實時間（毫秒）。
- `save()`：立刻存檔。
遊戲暫停時，外殼仍以 `dt = 0` 每秒呼叫系統幾次，所以「真實時間」的計時（例如上課倒數）不會停。

## 10. 留給實作者判斷的事
實體資料結構、services 的細節 API、UI 外殼樣式、群體小人的效能方案（instancing／VAT）、LLM 批次生成的 prompt 設計、地圖編輯方式。覺得契約不合理，請先提出意見。
