# TownMind：可反覆使用的「島嶼」遊戲框架

一個資料驅動、模組化的小島生活遊戲底板（動物森友會式：採集、耕作、製作、建造、捕捉、和有個性的 AI 居民相處）。
**做完整套功能，之後每個專案只選要開的模組、換一包世界資料，不用改核心程式。**

## 現在有什麼
| 部分 | 狀態 |
| --- | --- |
| 新版外殼：讀世界包、白話錯誤畫面、宣告式面板、存檔／匯出／匯入 | 可執行（`npm run dev`，開 http://localhost:8123） |
| 舊版原型：2D／3D 小鎮、5 位居民、群體小人（`legacy/`） | 保留比對用：http://localhost:8123/legacy.html |
| `src/core`：模組引擎、指令、事件、存檔切片、旗標、世界包驗證、核心服務 | 完成並有測試，已接上新版外殼 |
| `data/worldpacks/island-default`：32×24 島嶼範例世界包 | 通過驗證 |
| 其餘模組（採集、製作、建造、耕作、捕捉…） | 規劃中，見 `src/modules/catalog.json` |

## 指令
```
npm run dev     # 本機開發伺服器（無需建置、無需安裝套件）
npm test        # 單元測試
npm run check   # 世界包驗證 + 架構邊界檢查 + 目錄一致性
npm run smoke   # 瀏覽器冒煙測試（需要 Playwright；截圖存到 docs/screenshots/）
```
需要 Node 22。網址參數：`?pack=世界包id`、`?mods=crowd=on,farming=off`、`?new=1`（開新遊戲，舊存檔保留）。沒有 API 金鑰也能玩（居民用規則腦）；金鑰只放環境變數，見 `api/decide.js`。

## 文件導覽
- `ARCHITECTURE.md`：分層、模組契約、指令與 AI、存檔、世界包、邊界規則、遷移計畫。**動手前先讀。**
- `GAMEPLAY.md`：玩法方向、工作包 WP0–WP9、驗收標準、建議順序。
- `HANDOFF_PROMPT.md`：交給雲端 Claude Code 的完整指令。
- `ASSET_REQUEST.md`：給 Blender→GLB 資產流程的角色需求（選用）。
- `docs/PROTOTYPE_NOTES.md`：原型階段的歷史紀錄。
- `src/modules/README.md`、`src/modules/_template/`：新增模組的樣板。
