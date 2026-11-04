# 模組

- `catalog.json`：所有模組的目錄與路線圖（機器可讀）。新增模組一定要先在這裡登記。
- `_template/`：新模組的樣板與規則說明。
- 每個模組一個資料夾：`src/modules/<id>/index.js`（default export 模組定義）。

完整契約見根目錄的 `ARCHITECTURE.md`。

## 目前狀態
| 模組 | 狀態 | 內容 |
| --- | --- | --- |
| residents | prototype | 居民、規則腦（各模組提出建議＋興趣加權）、公告、角色卡、家、散步、打招呼 |
| crowd | prototype | 原型小鎮的群體小人（`?pack=prototype-town`） |
| actions | implemented | 裝備工具、有持續時間的動作（進度條）、成敗結果 |
| quests | implemented | 任務、任務鏈、完成條件、獎勵、解鎖旗標、繁榮度（全部由 quests.json 定義） |
| gathering | implemented | 砍樹、摘果、敲石頭、撿貝殼，會再生 |
| crafting | implemented | 配方、工作台、解鎖 |
| building | implemented | 家具網格擺放、旋轉、收回背包 |
| farming | implemented | 播種、澆水、依天數長大、季節、下雨自動澆水、收成 |
| capture | implemented | 釣魚、捕蟲、拍照、圖鑑（兒童安全呈現） |
| economy | implemented | 錢包、商店買賣、商品解鎖 |
| weather-seasons | implemented | 每天天氣、預報、換季提醒 |
| social | implemented | 好感度、送禮、居民小請求（規則與範本） |
| racing | implemented | 滑板車第一版、居民對手（受限指令）、時間挑戰與幽靈 |
| classroom | implemented | 課堂時間、老師控制台、安全限制 |
| quests-diary | prototype | 居民日記 |
| minigames、events | planned | 小遊戲集、節慶與賽季（可以沿用 racing 的計分與紀錄方式） |
| combat、multiplayer | deferred | 暫不開發 |

每個玩法模組都會在關鍵時刻發出 `<模組id>:feedback` 回饋事件（見 ARCHITECTURE.md 9.0），並附世界包範例資料與測試。
新增模組的範例請看 `gathering/`：只新增資料夾、改 catalog 的狀態，沒有動到 `src/core`。
