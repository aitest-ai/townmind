// 世界包：把「世界觀」做成資料。換專案 = 換一包資料 + 勾選要開哪些模組，不改程式。
//
// 一個世界包是一個資料夾（data/worldpacks/<id>/）。核心只認識這幾個檔案：
//   pack.json      基本資料、受眾（children/general）、要啟用的模組與設定、起始背包
//   items.json     物品
//   species.json   物種（樹、作物、魚……；kind 由各模組的 schema 宣告）
//   island.json    島嶼：文字地圖、放置的東西、區域
//   art.json       （選填）id → 美術來源（程式生成 或 GLB）
//   text.json      （選填）介面與對話文字
// 其他資料檔（recipes、residents、tracks……）屬於各模組，由模組資料夾裡的 schema.js 宣告與檢查。
// 所以新增一個模組、帶來新的資料檔，不需要修改這個檔案。
//
// 模組 schema（src/modules/<id>/schema.js，default export，純資料＋純函式，不依賴瀏覽器）：
//   {
//     module: 'farming',
//     files: { recipes: 'list' },        // 這個模組擁有的資料檔：'list'（[...]）或 'object'（{...}），都是選填檔
//     speciesKinds: ['crop'],            // 這個模組使用的物種 kind
//     placementTypes: ['plot'],          // island.json placements 可用的 type
//     validate(data, api) {}             // 模組自己的資料檢查，api 見下方 makeApi
//   }
//
// validatePack 回傳 { errors, warnings, summary }。每一則都有 file、message、hint，
// 設計給「不看程式碼的人」直接讀：說清楚哪個檔案、哪一筆、怎麼修。
// 這個檔案不依賴瀏覽器或 Node，載入檔案由呼叫端提供 readJson。

export const CORE_FILES = ['pack', 'items', 'species', 'island', 'art', 'text'];
const REQUIRED_FILES = new Set(['pack', 'items', 'species', 'island']);
const CORE_LISTS = ['items', 'species'];
export const PACK_FILES = CORE_FILES; // 舊名稱，保留相容

const ITEM_CATEGORIES = ['material', 'food', 'seed', 'tool', 'furniture', 'collectible'];
// 兒童安全政策（跨模組）：任何資料裡出現的 presentation 欄位，兒童版只允許這幾種。
export const SAFE_PRESENTATIONS = ['catch_release', 'collect', 'photo'];
const DATA_ID = /^[a-z][a-z0-9_]*$/;
const MODULE_ID = /^[a-z][a-z0-9-]*$/;

const isInt = (n) => Number.isInteger(n);
const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
const arr = (x) => (Array.isArray(x) ? x : []);

// 收集所有 schema 宣告的資料檔：{ 檔名: 'list' | 'object' }
export function schemaFiles(schemas = []) {
  const out = {};
  for (const s of schemas) for (const [name, type] of Object.entries(s?.files || {})) out[name] = type === 'object' ? 'object' : 'list';
  return out;
}

// 讀世界包。readJson(name) 讀不到時要丟錯。模組的資料檔都是選填，讀不到就用空值。
export async function loadPack(readJson, { schemas = [] } = {}) {
  const data = {};
  const extra = schemaFiles(schemas);
  for (const name of CORE_FILES) {
    try {
      data[name] = await readJson(name);
    } catch (e) {
      if (REQUIRED_FILES.has(name)) throw new Error(`讀不到世界包檔案「${name}.json」：${e.message}`);
      data[name] = {};
    }
  }
  for (const [name, type] of Object.entries(extra)) {
    if (name in data) continue;
    try { data[name] = await readJson(name); } catch { data[name] = type === 'list' ? [] : {}; }
  }
  return data;
}

export function validatePack(data, catalog, schemas = []) {
  const errors = [], warnings = [];
  const E = (file, message, hint = '') => errors.push({ level: 'error', file, message, hint });
  const W = (file, message, hint = '') => warnings.push({ level: 'warning', file, message, hint });

  const pack = data.pack || {};
  const extra = schemaFiles(schemas);
  const listFiles = [...CORE_LISTS, ...Object.keys(extra).filter((f) => extra[f] === 'list')];
  for (const file of listFiles) {
    if (data[file] !== undefined && !Array.isArray(data[file])) E(`${file}.json`, `${file}.json 最外層必須是清單（[ ... ]）`, '請檢查檔案開頭與結尾的中括號。');
  }
  const items = arr(data.items), species = arr(data.species);
  const children = pack.audience === 'children';
  const cat = new Map(arr(catalog?.modules).map((m) => [m.id, m]));

  // 收集 id，檢查唯一與格式（所有清單檔都一樣）
  const ids = {};
  for (const file of listFiles) {
    const set = new Set();
    arr(data[file]).forEach((x, i) => {
      if (!x || !DATA_ID.test(x.id || '')) { E(`${file}.json`, `第 ${i + 1} 筆的 id 不合法：「${x?.id}」`, 'id 只能用小寫英文、數字與底線，且以英文字母開頭。'); return; }
      if (set.has(x.id)) E(`${file}.json`, `id「${x.id}」重複`, 'id 必須唯一。');
      set.add(x.id);
    });
    ids[file] = set;
  }
  const itemById = new Map(items.map((x) => [x?.id, x]));
  const speciesById = new Map(species.map((x) => [x?.id, x]));

  const needItem = (file, where, id) => {
    if (!ids.items.has(id)) E(file, `${where}用到不存在的物品「${id}」`, '請到 items.json 新增，或改成已有的物品 id。');
  };
  const checkStacks = (file, where, list) => {
    if (!Array.isArray(list) || list.length === 0) { E(file, `${where}必須是至少一筆的清單`, '格式：[{ "item": "wood", "qty": 2 }]'); return; }
    list.forEach((s) => {
      needItem(file, where, s?.item);
      if (!isInt(s?.qty) || s.qty < 1) E(file, `${where}的「${s?.item}」數量必須是 1 以上的整數`, '');
    });
  };

  // ---- pack.json ----
  if (pack.schemaVersion !== 1) E('pack.json', `schemaVersion 必須是 1，目前是 ${pack.schemaVersion}`, '格式版本不符，請對照 ARCHITECTURE.md。');
  if (!MODULE_ID.test(pack.id || '')) E('pack.json', `世界包 id 不合法：「${pack.id}」`, '只能用小寫英文、數字與連字號。');
  if (!isStr(pack.name)) E('pack.json', '缺少 name（世界包名稱）');
  if (!isStr(pack.version)) E('pack.json', '缺少 version');
  if (!['children', 'general'].includes(pack.audience)) E('pack.json', `audience 必須是 children 或 general，目前是「${pack.audience}」`, '兒童版請填 children，會啟用更嚴格的內容檢查。');
  if (!isStr(pack.locale)) W('pack.json', '沒有填 locale（語言），建議填 zh-Hant');
  for (const s of arr(pack.startingInventory)) needItem('pack.json', '起始背包', s?.item);

  const mods = pack.modules && typeof pack.modules === 'object' ? pack.modules : {};
  if (!pack.modules) E('pack.json', '缺少 modules（要啟用哪些模組）');
  const enabled = Object.entries(mods).filter(([, m]) => m?.enabled).map(([id]) => id);
  const hasData = (need) => {
    const [file, kinds] = need.split(':');
    if (!Array.isArray(data[file])) return false;
    const list = data[file];
    if (!kinds) return list.length > 0;
    const set = kinds.split('|');
    return list.some((x) => set.includes(x?.kind));
  };
  for (const id of enabled) {
    const c = cat.get(id);
    if (!c) { E('pack.json', `啟用了不存在的模組「${id}」`, '可能拼錯了。可用的模組見 src/modules/catalog.json。'); continue; }
    if (c.status === 'planned' || c.status === 'deferred') {
      W('pack.json', `模組「${id}」${c.status === 'planned' ? '還在規劃中' : '暫緩開發'}，目前啟用也會被略過`);
    }
    for (const r of c.requires || []) if (!enabled.includes(r)) E('pack.json', `模組「${id}」需要先啟用「${r}」，但「${r}」沒有啟用`, `把 modules.${r}.enabled 改成 true，或把「${id}」關掉。`);
    for (const cf of c.conflicts || []) if (enabled.includes(cf)) E('pack.json', `模組「${id}」與「${cf}」不能同時啟用`, '請二選一。');
    for (const need of c.needsData || []) {
      if (!hasData(need)) E(`${need.split(':')[0]}.json`, `模組「${id}」需要「${need}」的資料，但目前沒有`, `請新增資料，或把模組「${id}」關掉。`);
    }
  }

  // ---- items ----
  items.forEach((x) => {
    if (!x?.id) return;
    if (!isStr(x.name)) E('items.json', `物品「${x.id}」缺少 name`);
    if (!ITEM_CATEGORIES.includes(x.category)) E('items.json', `物品「${x.id}」的 category「${x.category}」不合法`, `可用：${ITEM_CATEGORIES.join('、')}`);
    if (!isInt(x.stack) || x.stack < 1) E('items.json', `物品「${x.id}」的 stack（可疊加數量）必須是 1 以上的整數`);
    if (x.value !== undefined && (!isInt(x.value) || x.value < 0)) E('items.json', `物品「${x.id}」的 value 必須是 0 以上的整數`);
  });

  // ---- species（只檢查通用欄位；kind 必須是某個模組宣告過的）----
  const kindOwner = new Map();
  for (const s of schemas) for (const k of s?.speciesKinds || []) kindOwner.set(k, s.module);
  species.forEach((s) => {
    if (!s?.id) return;
    if (!isStr(s.name)) E('species.json', `物種「${s.id}」缺少 name`);
    if (!kindOwner.has(s.kind)) E('species.json', `物種「${s.id}」的 kind「${s.kind}」沒有任何模組使用`, `可用：${[...kindOwner.keys()].join('、')}`);
  });

  // ---- 兒童安全政策：掃描所有資料裡的 presentation 欄位 ----
  if (children) {
    const scan = (node, file, path) => {
      if (Array.isArray(node)) { node.forEach((x, i) => scan(x, file, `${path}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (k === 'presentation' && typeof v === 'string' && !SAFE_PRESENTATIONS.includes(v)) {
          E(`${file}.json`, `兒童版世界包不可使用「${v}」呈現方式（${path}）`, `兒童版只能用：${SAFE_PRESENTATIONS.join('、')}。若要做一般版，請把 pack.json 的 audience 改成 general。`);
        } else scan(v, file, path ? `${path}.${k}` : k);
      }
    };
    for (const [file, v] of Object.entries(data)) if (file !== 'pack') scan(v, file, '');
  }

  // ---- island ----
  const placementOwner = new Map([['species', 'core']]);
  for (const s of schemas) for (const t of s?.placementTypes || []) placementOwner.set(t, s.module);
  const isl = data.island || {};
  const iw = isl.size?.w, ih = isl.size?.h;
  const legend = isl.legend || {};
  const terrain = arr(isl.terrain);
  const tileAt = (x, y) => legend[terrain[y]?.[x]];
  const inB = (x, y) => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < iw && y < ih;
  if (!isInt(iw) || !isInt(ih) || iw < 4 || ih < 4) E('island.json', 'size.w 與 size.h 必須是 4 以上的整數');
  else {
    if (terrain.length !== ih) E('island.json', `terrain 有 ${terrain.length} 行，但 size.h 是 ${ih}`, '文字地圖的行數要和 size.h 一樣。');
    terrain.forEach((row, y) => {
      if (typeof row !== 'string' || row.length !== iw) E('island.json', `terrain 第 ${y + 1} 行長度是 ${row?.length}，但 size.w 是 ${iw}`, '每一行的字數都要和 size.w 一樣。');
      else for (const ch of row) if (!(ch in legend)) { E('island.json', `terrain 第 ${y + 1} 行出現沒定義的符號「${ch}」`, '請到 legend 補上，或改成已定義的符號。'); break; }
    });
    const sp = isl.spawn;
    if (!sp || !inB(sp.x, sp.y)) E('island.json', 'spawn（玩家出生點）缺少或超出地圖');
    else if (tileAt(sp.x, sp.y)?.walkable === false) E('island.json', `spawn（${sp.x},${sp.y}）在不可走的地形上`);

    const seen = new Map();
    arr(isl.placements).forEach((p, i) => {
      const w = `placements 第 ${i + 1} 筆`;
      if (!placementOwner.has(p?.type)) { E('island.json', `${w} 的 type「${p?.type}」沒有任何模組使用`, `可用：${[...placementOwner.keys()].join('、')}`); return; }
      if (!inB(p.x, p.y)) { E('island.json', `${w}（${p.type}）的座標 (${p.x},${p.y}) 超出地圖`); return; }
      if (tileAt(p.x, p.y)?.walkable === false) E('island.json', `${w}（${p.type}${p.ref ? ' ' + p.ref : ''}）放在不可走的地形上 (${p.x},${p.y})`, '請移到草地或沙地。');
      if (p.type === 'species' && !ids.species.has(p.ref)) E('island.json', `${w} 用到不存在的物種「${p.ref}」`);
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) W('island.json', `(${k}) 這格放了不只一個東西：${seen.get(k)} 與 ${p.type}${p.ref ? ' ' + p.ref : ''}`);
      seen.set(k, `${p.type}${p.ref ? ' ' + p.ref : ''}`);
    });

    const rids = new Set();
    arr(isl.regions).forEach((rg) => {
      if (!isStr(rg?.id)) { E('island.json', 'regions 有一筆缺少 id'); return; }
      if (rids.has(rg.id)) E('island.json', `區域 id「${rg.id}」重複`);
      rids.add(rg.id);
      const r = rg.rect;
      if (!r || !inB(r.x, r.y) || !inB(r.x + r.w - 1, r.y + r.h - 1)) E('island.json', `區域「${rg.id}」的 rect 缺少或超出地圖`);
    });
  }

  // ---- 各模組自己的資料檢查 ----
  const api = {
    E, W, data, pack, children, catalog: cat,
    ids, items, species, itemById, speciesById,
    needItem, checkStacks, isInt, isStr, arr,
    island: { w: iw, h: ih, legend, terrain, tileAt, inBounds: inB, placements: arr(isl.placements), regions: arr(isl.regions) },
  };
  for (const s of schemas) {
    if (typeof s?.validate !== 'function') continue;
    try { s.validate(data, api); } catch (e) { E('（模組檢查）', `模組「${s.module}」的資料檢查本身出錯：${e.message}`, '這是程式問題，不是資料問題，請回報。'); }
  }

  // ---- art / text ----
  const art = data.art && typeof data.art === 'object' ? data.art : {};
  let missingArt = 0;
  for (const [id, a] of Object.entries(art)) {
    if (id.startsWith('_')) continue; // 底線開頭是註解或範例，不檢查
    if (!['procedural', 'glb'].includes(a?.type)) E('art.json', `「${id}」的 type 必須是 procedural 或 glb`);
    if (a?.type === 'glb' && !isStr(a.url)) E('art.json', `「${id}」是 glb 但缺少 url`);
  }
  const artIds = [...ids.items, ...ids.species, ...(ids.residents || [])];
  for (const id of artIds) if (!(id in art)) missingArt++;
  if (missingArt) W('art.json', `有 ${missingArt} 個項目沒有指定美術，會用預設外觀`);
  if (!data.text?.ui) W('text.json', '沒有 ui 文字（介面會用預設文案）');

  return {
    errors, warnings,
    summary: { ...Object.fromEntries(listFiles.map((f) => [f, arr(data[f]).length])), enabledModules: enabled },
  };
}
