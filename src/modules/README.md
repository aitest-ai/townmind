# 模組

- `catalog.json`：所有模組的目錄與路線圖（機器可讀）。新增模組一定要先在這裡登記。
- `_template/`：新模組的樣板與規則說明。
- 每個模組一個資料夾：`src/modules/<id>/index.js`（default export 模組定義）。

完整契約見根目錄的 `ARCHITECTURE.md`。

## 目前狀態
| 模組 | 狀態 | 備註 |
| --- | --- | --- |
| residents | planned | 原型在 `legacy/brain.js`、`legacy/prompt.js`，WP0 遷移中 |
| crowd | planned | 原型在 `legacy/world.js`，WP0 遷移中 |
| 其他 | planned | 見 catalog.json |

沒有「implemented」的模組，是因為第一批模組（含遷移）就是 WP0 的工作。
