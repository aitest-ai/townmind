// 競速（racing）的世界包資料規格：tracks.json
// [{
//   "id": "beach_loop", "name": "沙灘環島賽", "vehicle": "skateboard", "laps": 1,
//   "start": { "x": 18, "y": 19 },                         // 起跑門（地圖上的格子，要能走）
//   "checkpoints": [{ "x": 26, "y": 15 }, ...],            // 依序通過的檢查點（要能走），最後回到起跑門算一圈
//   "terrainSpeed": { "s": 0.8 },                          // 選填：地形符號 → 速度倍率（沙地慢一點）
//   "rivals": ["afu", "damu"]                              // 選填：哪些居民來比賽（預設前兩位）
// }]
export default {
  module: 'racing',
  files: { tracks: 'list' },
  validate(data, { E, W, arr, isStr, isInt, island, ids }) {
    const f = 'tracks.json';
    const walk = (p) => island.inBounds(p?.x, p?.y) && island.tileAt(p.x, p.y)?.walkable !== false;
    for (const t of arr(data.tracks)) {
      if (!t?.id) continue;
      if (!isStr(t.name)) W(f, `賽道「${t.id}」缺少 name`);
      if (t.laps !== undefined && (!isInt(t.laps) || t.laps < 1 || t.laps > 5)) E(f, `賽道「${t.id}」的 laps 要是 1～5`);
      if (!walk(t.start)) E(f, `賽道「${t.id}」的起跑門 start 要在能走的格子上`);
      if (arr(t.checkpoints).length < 2) E(f, `賽道「${t.id}」至少要有 2 個檢查點`);
      arr(t.checkpoints).forEach((c, i) => { if (!walk(c)) E(f, `賽道「${t.id}」第 ${i + 1} 個檢查點 (${c?.x},${c?.y}) 不在能走的格子上`); });
      for (const r of arr(t.rivals)) if (ids.residents && !ids.residents.has(r)) W(f, `賽道「${t.id}」的對手「${r}」不是居民`);
      for (const [ch, k] of Object.entries(t.terrainSpeed || {})) if (typeof k !== 'number' || k < 0.2 || k > 2) E(f, `賽道「${t.id}」地形「${ch}」的速度倍率要是 0.2～2`);
    }
  },
};
