# 模組

- `catalog.json`：所有模組的目錄與路線圖（機器可讀）。新增模組一定要先在這裡登記。
- `_template/`：新模組的樣板與規則說明。
- 每個模組一個資料夾：`src/modules/<id>/index.js`（default export 模組定義）。

完整契約見根目錄的 `ARCHITECTURE.md`。

## 目前狀態
| 模組 | 狀態 | 備註 |
| --- | --- | --- |
| residents | prototype | 居民、規則腦（建議＋興趣加權）、公告、角色卡、家、散步、打招呼 |
| crowd | prototype | 原型小鎮的群體小人（`?pack=prototype-town`） |
| gathering | implemented | 砍樹、摘果、敲石頭、撿貝殼，會再生；第一個「不改核心」的新模組 |
| 其他 | planned | 見 catalog.json |

新增模組的範例請看 `gathering/`：只新增這個資料夾、改 catalog 的狀態，沒有動到 `src/core`、外殼或渲染層。
