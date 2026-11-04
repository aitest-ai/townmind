// 世界包：把「世界觀」做成資料。換專案 = 換一包資料 + 勾選要開哪些模組，不改程式。
//
// 一個世界包是一個資料夾（data/worldpacks/<id>/），內含：
//   pack.json      基本資料、受眾（children/general）、要啟用的模組與設定、起始背包
//   items.json     物品（材料、食物、種子、工具、家具、收藏品）
//   species.json   物種（樹、灌木、作物、岩石、採集物、動物、魚、蟲）
//   recipes.json   製作配方
//   residents.json 居民角色卡（個性、目標、口頭禪、興趣、喜歡的東西）
//   island.json    島嶼：文字地圖、放置的東西、區域
//   art.json       （選填）id → 美術來源（程式生成 或 GLB）
//   text.json      （選填）介面與對話文字
//
// validatePack 回傳 { errors, warnings }。每一則都有 file、message、hint，
// 設計給「不看程式碼的人」直接讀：說清楚哪個檔案、哪一筆、怎麼修。
// 這個檔案不依賴瀏覽器或 Node，載入檔案由呼叫端提供 readJson。

export const PACK_FILES = ['pack', 'items', 'species', 'recipes', 'residents', 'island', 'art', 'text', 'tracks', 'games', 'events'];
const OPTIONAL_FILES = new Set(['art', 'text', 'tracks', 'games', 'events']); // tracks/games/events 供競賽類模組使用，沒有該模組時可以不存在
const EXTRA_LISTS = ['tracks', 'games', 'events'];

const ITEM_CATEGORIES = ['material', 'food', 'seed', 'tool', 'furniture', 'collectible'];
const SPECIES_KINDS = ['tree', 'bush', 'crop', 'rock', 'forage', 'animal', 'fish', 'bug'];
const GATHER_KINDS = ['tree', 'bush', 'rock', 'forage'];
const CAPTURE_KINDS = ['animal', 'fish', 'bug'];
const SAFE_PRESENTATIONS = ['catch_release', 'collect', 'photo']; // 兒童版只允許這幾種呈現
const ALL_PRESENTATIONS = [...SAFE_PRESENTATIONS, 'implied', 'hunt'];
const PLACEMENT_TYPES = ['species', 'station', 'home', 'plot'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const DATA_ID = /^[a-z][a-z0-9_]*$/;
const MODULE_ID = /^[a-z][a-z0-9-]*$/;

export async function loadPack(readJson) {
  const data = {};
  for (const name of PACK_FILES) {
    try {
      data[name] = await readJson(name);
    } catch (e) {
      if (!OPTIONAL_FILES.has(name)) throw new Error(`讀不到世界包檔案「${name}.json」：${e.message}`);
      data[name] = {};
    }
  }
  return data;
}

const isInt = (n) => Number.isInteger(n);
const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
const arr = (x) => (Array.isArray(x) ? x : []);

export function validatePack(data, catalog) {
  const errors = [], warnings = [];
  const E = (file, message, hint = '') => errors.push({ level: 'error', file, message, hint });
  const W = (file, message, hint = '') => warnings.push({ level: 'warning', file, message, hint });

  const pack = data.pack || {};
  for (const [file, v] of [['items', data.items], ['species', data.species], ['recipes', data.recipes], ['residents', data.residents]]) {
    if (!Array.isArray(v)) E(`${file}.json`, `${file}.json 最外層必須是清單（[ ... ]）`, '請檢查檔案開頭與結尾的中括號。');
  }
  const items = arr(data.items), species = arr(data.species), recipes = arr(data.recipes), residents = arr(data.residents);
  const children = pack.audience === 'children';

  // 收集 id，檢查唯一與格式
  const collect = (list, file, label) => {
    const ids = new Set();
    list.forEach((x, i) => {
      if (!x || !DATA_ID.test(x.id || '')) { E(file, `${label}第 ${i + 1} 筆的 id 不合法：「${x?.id}」`, 'id 只能用小寫英文、數字與底線，且以英文字母開頭。'); return; }
      if (ids.has(x.id)) E(file, `${label} id「${x.id}」重複`, 'id 必須唯一。');
      ids.add(x.id);
    });
    return ids;
  };
  const itemIds = collect(items, 'items.json', '物品');
  const speciesIds = collect(species, 'species.json', '物種');
  const recipeIds = collect(recipes, 'recipes.json', '配方');
  const residentIds = collect(residents, 'residents.json', '居民');
  const itemById = new Map(items.map((x) => [x.id, x]));
  const speciesById = new Map(species.map((x) => [x.id, x]));

  const needItem = (file, where, id) => {
    if (!itemIds.has(id)) E(file, `${where}用到不存在的物品「${id}」`, '請到 items.json 新增，或改成已有的物品 id。');
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
  const cat = new Map(arr(catalog?.modules).map((m) => [m.id, m]));
  const enabled = Object.entries(mods).filter(([, m]) => m?.enabled).map(([id]) => id);
  const hasData = (need) => {
    const [file, kinds] = need.split(':');
    const list = { items, species, recipes, residents }[file] ?? (EXTRA_LISTS.includes(file) ? arr(data[file]) : null);
    if (!list) return true;
    if (!kinds) return list.length > 0;
    const set = kinds.split('|');
    return list.some((x) => set.includes(x.kind));
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
    if (!isStr(x.name)) E('items.json', `物品「${x.id}」缺少 name`);
    if (!ITEM_CATEGORIES.includes(x.category)) E('items.json', `物品「${x.id}」的 category「${x.category}」不合法`, `可用：${ITEM_CATEGORIES.join('、')}`);
    if (!isInt(x.stack) || x.stack < 1) E('items.json', `物品「${x.id}」的 stack（可疊加數量）必須是 1 以上的整數`);
    if (x.value !== undefined && (!isInt(x.value) || x.value < 0)) E('items.json', `物品「${x.id}」的 value 必須是 0 以上的整數`);
  });

  // ---- species ----
  species.forEach((s) => {
    const f = 'species.json';
    if (!isStr(s.name)) E(f, `物種「${s.id}」缺少 name`);
    if (!SPECIES_KINDS.includes(s.kind)) { E(f, `物種「${s.id}」的 kind「${s.kind}」不合法`, `可用：${SPECIES_KINDS.join('、')}`); return; }
    if (GATHER_KINDS.includes(s.kind)) {
      checkStacks(f, `物種「${s.id}」的 yield（採集收穫）`, s.yield);
      if (s.regrowDays !== undefined && (!isInt(s.regrowDays) || s.regrowDays < 1)) E(f, `物種「${s.id}」的 regrowDays 必須是 1 以上的整數`);
    }
    if (s.kind === 'crop') {
      if (!Array.isArray(s.stages) || s.stages.length < 2) E(f, `作物「${s.id}」的 stages（生長階段）至少要有 2 個`);
      else s.stages.forEach((st, i) => { if (!isInt(st?.days) || st.days < 1) E(f, `作物「${s.id}」第 ${i + 1} 個生長階段的 days 必須是 1 以上的整數`); });
      checkStacks(f, `作物「${s.id}」的 harvest（收成）`, s.harvest);
      if (!itemIds.has(s.seed)) E(f, `作物「${s.id}」的 seed（種子）「${s.seed}」不存在`, '請在 items.json 新增一個 category 為 seed 的物品。');
      else if (itemById.get(s.seed).category !== 'seed') E(f, `作物「${s.id}」的 seed「${s.seed}」必須是 category 為 seed 的物品`);
      for (const se of arr(s.seasons)) if (!SEASONS.includes(se)) E(f, `作物「${s.id}」的季節「${se}」不合法`, `可用：${SEASONS.join('、')}`);
    }
    if (CAPTURE_KINDS.includes(s.kind)) {
      const methods = s.capture?.methods;
      if (!Array.isArray(methods) || methods.length === 0) E(f, `「${s.id}」需要 capture.methods（捕捉方式）`, '格式：{ "tool": "net", "presentation": "collect" }');
      else {
        methods.forEach((m) => {
          if (!itemIds.has(m?.tool)) E(f, `「${s.id}」的捕捉工具「${m?.tool}」不存在`);
          else if (itemById.get(m.tool).category !== 'tool') E(f, `「${s.id}」的捕捉工具「${m.tool}」必須是 category 為 tool 的物品`);
          if (!ALL_PRESENTATIONS.includes(m?.presentation)) E(f, `「${s.id}」的呈現方式「${m?.presentation}」不合法`, `可用：${ALL_PRESENTATIONS.join('、')}`);
          else if (children && !SAFE_PRESENTATIONS.includes(m.presentation)) {
            E(f, `兒童版世界包不可使用「${m.presentation}」呈現方式（物種「${s.id}」）`, `兒童版只能用：${SAFE_PRESENTATIONS.join('、')}。若要做一般版，請把 pack.json 的 audience 改成 general。`);
          }
        });
      }
      if (s.capture?.reward !== undefined) checkStacks(f, `「${s.id}」的 capture.reward`, s.capture.reward);
    }
  });

  // ---- recipes ----
  recipes.forEach((r) => {
    const f = 'recipes.json';
    if (!isStr(r.name)) E(f, `配方「${r.id}」缺少 name`);
    checkStacks(f, `配方「${r.id}」的 inputs（材料）`, r.inputs);
    if (!r.output) E(f, `配方「${r.id}」缺少 output`);
    else { needItem(f, `配方「${r.id}」的 output`, r.output.item); if (!isInt(r.output.qty) || r.output.qty < 1) E(f, `配方「${r.id}」output 數量必須是 1 以上的整數`); }
  });

  // ---- residents ----
  const cap = (file, who, field, v, max) => {
    if (!isStr(v)) E(file, `居民「${who}」缺少 card.${field}`);
    else if (v.length > max) E(file, `居民「${who}」的 card.${field} 太長（${v.length} 字，上限 ${max}）`, '這是為了讓使用者自訂的內容不會把提示詞撐爆。');
  };
  residents.forEach((r) => {
    const f = 'residents.json';
    if (!isStr(r.name)) E(f, `居民「${r.id}」缺少 name`);
    if (!isStr(r.role)) E(f, `居民「${r.id}」缺少 role`);
    if (!/^#[0-9a-fA-F]{6}$/.test(r.color || '')) E(f, `居民「${r.id}」的 color 必須是 #RRGGBB`);
    cap(f, r.id, 'personality', r.card?.personality, 120);
    cap(f, r.id, 'goal', r.card?.goal, 120);
    cap(f, r.id, 'catchphrase', r.card?.catchphrase, 30);
    for (const [k, v] of Object.entries(r.interests || {})) {
      if (!cat.has(k)) W(f, `居民「${r.id}」的興趣「${k}」不是已知的模組 id`, '興趣的名稱要對應模組 id（例如 farming、capture），才會影響他的行為。');
      if (typeof v !== 'number' || v < 0 || v > 3) E(f, `居民「${r.id}」的興趣「${k}」必須是 0～3 的數字`);
    }
    for (const it of arr(r.likes)) if (!itemIds.has(it)) W(f, `居民「${r.id}」喜歡的物品「${it}」不存在`);
  });

  // ---- island ----
  const isl = data.island || {};
  const iw = isl.size?.w, ih = isl.size?.h;
  if (!isInt(iw) || !isInt(ih) || iw < 4 || ih < 4) E('island.json', 'size.w 與 size.h 必須是 4 以上的整數');
  else {
    const legend = isl.legend || {};
    const terrain = arr(isl.terrain);
    if (terrain.length !== ih) E('island.json', `terrain 有 ${terrain.length} 行，但 size.h 是 ${ih}`, '文字地圖的行數要和 size.h 一樣。');
    terrain.forEach((row, y) => {
      if (typeof row !== 'string' || row.length !== iw) E('island.json', `terrain 第 ${y + 1} 行長度是 ${row?.length}，但 size.w 是 ${iw}`, '每一行的字數都要和 size.w 一樣。');
      else for (const ch of row) if (!(ch in legend)) { E('island.json', `terrain 第 ${y + 1} 行出現沒定義的符號「${ch}」`, '請到 legend 補上，或改成已定義的符號。'); break; }
    });
    const tileAt = (x, y) => legend[terrain[y]?.[x]];
    const inB = (x, y) => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < iw && y < ih;
    const sp = isl.spawn;
    if (!sp || !inB(sp.x, sp.y)) E('island.json', 'spawn（玩家出生點）缺少或超出地圖');
    else if (tileAt(sp.x, sp.y)?.walkable === false) E('island.json', `spawn（${sp.x},${sp.y}）在不可走的地形上`);

    const seen = new Map();
    const homes = new Set();
    arr(isl.placements).forEach((p, i) => {
      const w = `placements 第 ${i + 1} 筆`;
      if (!PLACEMENT_TYPES.includes(p?.type)) { E('island.json', `${w} 的 type「${p?.type}」不合法`, `可用：${PLACEMENT_TYPES.join('、')}`); return; }
      if (!inB(p.x, p.y)) { E('island.json', `${w}（${p.type}）的座標 (${p.x},${p.y}) 超出地圖`); return; }
      if (tileAt(p.x, p.y)?.walkable === false) E('island.json', `${w}（${p.type}${p.ref ? ' ' + p.ref : ''}）放在不可走的地形上 (${p.x},${p.y})`, '請移到草地或沙地。');
      if (p.type === 'species' && !speciesIds.has(p.ref)) E('island.json', `${w} 用到不存在的物種「${p.ref}」`);
      if (p.type === 'home') { if (!residentIds.has(p.ref)) E('island.json', `${w} 的 home 對應不存在的居民「${p.ref}」`); else homes.add(p.ref); }
      if (p.type === 'station' && !isStr(p.ref)) E('island.json', `${w} 的 station 缺少 ref`);
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) W('island.json', `(${k}) 這格放了不只一個東西：${seen.get(k)} 與 ${p.type}${p.ref ? ' ' + p.ref : ''}`);
      seen.set(k, `${p.type}${p.ref ? ' ' + p.ref : ''}`);
    });
    for (const id of residentIds) if (!homes.has(id)) W('island.json', `居民「${id}」沒有家（缺少 type 為 home 的放置）`);

    const rids = new Set();
    arr(isl.regions).forEach((rg) => {
      if (!isStr(rg?.id)) { E('island.json', 'regions 有一筆缺少 id'); return; }
      if (rids.has(rg.id)) E('island.json', `區域 id「${rg.id}」重複`);
      rids.add(rg.id);
      const r = rg.rect;
      if (!r || !inB(r.x, r.y) || !inB(r.x + r.w - 1, r.y + r.h - 1)) E('island.json', `區域「${rg.id}」的 rect 缺少或超出地圖`);
      for (const s of arr(rg.spawns)) {
        if (!speciesIds.has(s?.ref)) E('island.json', `區域「${rg.id}」的 spawns 用到不存在的物種「${s?.ref}」`);
        else if (!CAPTURE_KINDS.includes(speciesById.get(s.ref).kind)) W('island.json', `區域「${rg.id}」的 spawns「${s.ref}」不是動物、魚或蟲，會被忽略`);
      }
    });
  }

  // ---- art / text ----
  const art = data.art && typeof data.art === 'object' ? data.art : {};
  let missingArt = 0;
  for (const [id, a] of Object.entries(art)) {
    if (id.startsWith('_')) continue; // 底線開頭是註解或範例，不檢查
    if (!['procedural', 'glb'].includes(a?.type)) E('art.json', `「${id}」的 type 必須是 procedural 或 glb`);
    if (a?.type === 'glb' && !isStr(a.url)) E('art.json', `「${id}」是 glb 但缺少 url`);
  }
  for (const id of [...itemIds, ...speciesIds, ...residentIds]) if (!(id in art)) missingArt++;
  if (missingArt) W('art.json', `有 ${missingArt} 個項目沒有指定美術，會用預設外觀`);
  if (!data.text?.ui) W('text.json', '沒有 ui 文字（介面會用預設文案）');

  return {
    errors, warnings,
    summary: { items: items.length, species: species.length, recipes: recipes.length, residents: residents.length, enabledModules: enabled },
  };
}
