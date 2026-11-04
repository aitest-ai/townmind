// 遊戲啟動：讀世界包 → 驗證 → 載入已啟用的模組 → 建立引擎與核心服務 → 讀存檔 → 開始主迴圈。
// 任何一步失敗，都在畫面上用白話說明原因與怎麼辦，不只丟到 console。
//
// 網址參數：
//   ?pack=island-default   要開哪個世界包（data/worldpacks/<id>/）
//   ?mods=crowd=on,farming=off   覆寫模組開關
//   ?new=1                 不讀存檔，開新遊戲（不會刪除舊存檔）
//   ?seed=123              指定亂數種子（測試用）
import { Engine, FrameworkError, validatePack, loadPack, parseOverrides, resolveEnabled, createCoreServices } from '../core/index.js';
import { createStorage } from './storage.js';
import { createPanelHost, toast, log, showFatal } from './ui.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const PACK_ID = (params.get('pack') || 'island-default').replace(/[^a-z0-9-]/g, '');
const SAVE_SLOT = `save:${PACK_ID}`;
const AUTOSAVE_SEC = 20;
const MAX_OFFLINE_DAYS = 7;

const debug = { status: 'booting', errors: [] };
window.__tm = debug; // 除錯與自動測試用

const fatalActions = () => [
  { label: '重新整理', primary: true, run: () => location.reload() },
  { label: '開新遊戲（舊存檔保留）', run: () => { const u = new URL(location.href); u.searchParams.set('new', '1'); location.href = u.href; } },
  { label: '打開舊版原型', run: () => { location.href = 'legacy.html'; } },
];

function fail(info) {
  debug.status = 'failed';
  debug.fatal = info;
  $('loading').textContent = '';
  showFatal({ actions: fatalActions(), ...info });
}

// 網頁本身的意外錯誤：顯示白話提示，並記錄下來
window.addEventListener('error', (e) => { debug.errors.push(String(e.message)); toast(`畫面出了一點問題：${e.message}`, 'bad', 8000); });
window.addEventListener('unhandledrejection', (e) => { debug.errors.push(String(e.reason?.message || e.reason)); toast(`畫面出了一點問題：${e.reason?.message || e.reason}`, 'bad', 8000); });

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status === 404 ? '找不到檔案' : `伺服器回應 ${r.status}`);
  try { return await r.json(); } catch { throw new Error('檔案內容不是正確的 JSON（可能少了逗號或括號）'); }
}

async function boot() {
  // 1. 模組目錄與資料規格
  let catalog;
  try { catalog = await fetchJson('src/modules/catalog.json'); } catch (e) {
    return fail({ message: `讀不到模組目錄 src/modules/catalog.json：${e.message}`, hint: '請確認是用伺服器開啟（npm run dev），而不是直接點兩下 index.html。' });
  }
  const cat = new Map(catalog.modules.map((m) => [m.id, m]));
  const labels = Object.fromEntries(catalog.modules.map((m) => [m.id, m.name || m.id]));
  const schemas = [];
  try {
    await Promise.all(catalog.modules.filter((m) => m.schema).map(async (m) => { schemas.push((await import(`../modules/${m.id}/schema.js`)).default); }));
  } catch (e) {
    return fail({ message: `模組的資料規格（schema.js）載入失敗：${e.message}`, hint: '請在終端機執行 npm run check 找出是哪個模組。' });
  }

  // 2. 世界包（只讀「這次會開的模組」的資料檔，沒開的模組的資料不必下載）
  let data;
  const overrides = parseOverrides(params.get('mods') || '');
  try {
    const packJson = await fetchJson(`data/worldpacks/${PACK_ID}/pack.json`);
    const willEnable = new Set(resolveEnabled(packJson.modules, overrides).enabled);
    data = await loadPack((name) => (name === 'pack' ? packJson : fetchJson(`data/worldpacks/${PACK_ID}/${name}.json`)), { schemas: schemas.filter((s) => willEnable.has(s.module)) });
    for (const f of ['art', 'text']) if (!data[f] || typeof data[f] !== 'object') data[f] = {};
  } catch (e) {
    return fail({ message: `世界包「${PACK_ID}」讀取失敗：${e.message}`, hint: '請檢查網址的 pack= 是否拼對，或資料夾 data/worldpacks/ 裡有沒有這個世界包。' });
  }
  const result = validatePack(data, catalog, schemas);
  if (result.errors.length) {
    return fail({
      message: `世界包「${PACK_ID}」有 ${result.errors.length} 個問題，需要先修好才能玩。`,
      hint: '把下面的問題交給負責資料的人，或在終端機執行 npm run check 看完整說明。',
      details: result.errors.map((e) => `[${e.file}] ${e.message}${e.hint ? `（${e.hint}）` : ''}`),
    });
  }
  for (const w of result.warnings) console.info('[世界包提醒]', w.file, w.message);
  document.title = data.text?.ui?.title || data.pack.name;
  $('title').textContent = data.text?.ui?.title || data.pack.name;
  $('packName').textContent = data.pack.name;

  // 3. 決定要開的模組（世界包預設 + 網址覆寫），載入程式
  const { enabled, config } = resolveEnabled(data.pack.modules, overrides);
  const notices = [];
  const toLoad = [], notYet = [];
  for (const id of enabled) {
    const c = cat.get(id);
    if (!c) notices.push(`網址或世界包裡的「${id}」不是已知的功能，已略過。`);
    else if (c.status === 'planned' || c.status === 'deferred') notYet.push(c.name || id);
    else toLoad.push(id);
  }
  if (notYet.length) notices.push(`有 ${notYet.length} 個功能還在製作中，這次先不開：${notYet.join('、')}。`);
  const defs = [];
  for (const id of toLoad) {
    try { defs.push((await import(`../modules/${id}/index.js`)).default); } catch (e) {
      notices.push(`「${labels[id]}」的程式載入失敗（${e.message}），這次先不開。`);
    }
  }

  // 4. 引擎與核心服務
  const storage = createStorage('townmind');
  const saved = params.get('new') ? { status: 'empty' } : storage.load(SAVE_SLOT);
  const seed = Number(params.get('seed')) || saved.blob?.meta?.seed || (Math.random() * 2 ** 31) >>> 0;
  const services = createCoreServices(data);
  const engine = new Engine({ data, services, seed, labels, log: (...a) => console.info(...a), onError: (info) => { log(`⚠ ${labels[info.module] || info.module}：${info.message}`); } });
  for (const d of defs) engine.register(d);
  let started;
  try {
    started = engine.start({ enabled: defs.map((d) => d.id), config, cascade: true, skipUnknown: true });
  } catch (e) {
    const fe = e instanceof FrameworkError ? e : null;
    return fail({ message: fe ? fe.message : `啟動時出錯：${e.message}`, hint: fe?.hint || '請把這段訊息交給負責程式的人。' });
  }
  for (const n of started.notices) notices.push(n.message);

  // 5. 玩家（核心實體）
  const { entities, inventory, time } = services;
  entities.add({ id: 'player', kind: 'player', owner: 'core', x: data.island.spawn.x, y: data.island.spawn.y, label: '你' });

  // 6. 讀存檔（或開新遊戲）
  let isNew = true;
  if (saved.status === 'broken') {
    notices.push(`存檔壞掉了（${saved.error}），這次先開新遊戲。壞掉的存檔另外保留著，可以用「讀取備份」試試看。`);
  } else if (saved.status === 'ok') {
    try {
      const rep = engine.deserializeAll(saved.blob);
      isNew = false;
      for (const f of rep.failed) notices.push(`存檔裡「${labels[f.key] || f.key}」的資料讀不進來（${f.error}），這部分先用新的開始，原本的資料保留著。`);
      for (const t of rep.tooNew) notices.push(t.message);
      // 離線補算：離開這段時間，小島繼續過日子（上限 7 天，不呼叫 AI）
      const elapsedMs = engine.elapsedSinceSave();
      const days = Math.min(MAX_OFFLINE_DAYS, Math.floor(elapsedMs / (time.dayLengthSec * 1000)));
      if (days > 0) {
        time.skipDays(days);
        engine.catchUp({ elapsedMs, days });
        notices.push(`你離開的這段時間，島上過了 ${days} 天。`);
      }
    } catch (e) {
      const fe = e instanceof FrameworkError ? e : null;
      notices.push(`沒辦法讀取存檔：${fe ? fe.message : e.message}。${fe?.hint || ''}這次先開新遊戲，舊存檔沒有被刪除。`);
    }
  }
  if (isNew) {
    for (const s of data.pack.startingInventory || []) inventory.add('player', s.item, s.qty);
    engine.events.emit('core:newGame', { packId: data.pack.id });
    log('歡迎來到小島！');
  } else log('歡迎回來！');
  for (const n of notices) { log(`ℹ ${n}`); toast(n, 'warn', 8000); }

  // 7. 存檔
  let lastSave = 0;
  const saveNow = (why = '') => {
    let blob;
    try { blob = engine.serializeAll({ gameDay: time.day }); } catch (e) { toast(`這次沒存到：${e.message}`, 'bad'); return false; }
    const r = storage.save(SAVE_SLOT, blob);
    if (!r.ok) { toast(r.error, 'bad', 8000); return false; }
    lastSave = time.elapsed;
    if (why) log(`💾 ${why}`);
    return true;
  };
  addEventListener('pagehide', () => saveNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

  // 8. 畫面
  const { createRenderer2D } = await import('../render2d/index.js');
  const view = createRenderer2D($('view2d'), { data, services });
  $('loading').remove();

  // 9. 面板：外殼自己的面板 + 模組註冊的宣告式面板
  const host = createPanelHost($('panels'));
  const SPEEDS = [{ value: '0', label: '暫停' }, { value: '1', label: '正常' }, { value: '2', label: '2 倍' }, { value: '4', label: '4 倍' }];
  const shellPanels = () => [
    { id: 'shell.status', title: '小島狀態', order: 0, nodes: [
      { type: 'stat', label: '時間', value: time.clockText() },
      { type: 'stat', label: '一天的長度', value: `${Math.round(time.dayLengthSec / 60)} 分鐘` },
      { type: 'select', name: 'speed', label: '時間速度', options: SPEEDS, value: String(time.paused ? 0 : time.timeScale), onChange: 'speed' },
    ] },
    ...engine.listPanels().filter((p) => typeof p.view === 'function').map((p) => ({ id: p.id, title: p.title, order: p.order, nodes: engine.renderPanel(p.id) })),
    { id: 'shell.bag', title: '背包', order: 900, nodes: [
      { type: 'list', items: inventory.list('player').map((s) => ({ label: `${s.name} × ${s.qty}` })), empty: '背包是空的' },
    ] },
    { id: 'shell.save', title: '存檔', order: 950, nodes: [
      { type: 'text', text: storage.persistent ? '每 20 秒與關閉網頁時會自動存檔。' : '⚠ 這個瀏覽器不能長期保存（可能是無痕模式），請記得「匯出存檔」。' },
      { type: 'buttons', items: [
        { type: 'button', label: '立刻存檔', action: 'save', primary: true },
        { type: 'button', label: '匯出存檔', action: 'export' },
        { type: 'button', label: '匯入存檔', action: 'import' },
        { type: 'button', label: '讀取備份', action: 'backup' },
        { type: 'button', label: '開新遊戲', action: 'newgame' },
      ] },
    ] },
    { id: 'shell.modules', title: '這次開啟的功能', order: 990, nodes: [
      { type: 'list', items: engine.enabledModules().map((id) => ({ label: labels[id] || id })), empty: '目前沒有開啟任何功能模組' },
      ...(notices.length ? [{ type: 'list', items: notices.map((n) => ({ label: n })) }] : []),
    ] },
  ].sort((a, b) => a.order - b.order);

  const reloadWith = async (blob) => {
    // 先檢查存檔看得懂，再寫進儲存區重新整理（讓引擎從乾淨狀態讀檔）
    if (!blob || ![1, 2].includes(blob.format)) { toast('這個檔案不是存檔（看不懂內容）', 'bad'); return; }
    if (blob.meta?.packId && blob.meta.packId !== data.pack.id) { toast(`這個存檔屬於另一個世界「${blob.meta.packId}」，目前開的是「${data.pack.id}」。`, 'bad', 8000); return; }
    storage.save(SAVE_SLOT, blob);
    const u = new URL(location.href); u.searchParams.delete('new'); location.href = u.href;
  };
  const shellAction = async (action, values) => {
    switch (action) {
      case 'speed': { const k = Number(values.speed); time.pause(k === 0); if (k > 0) time.setTimeScale(k); break; }
      case 'save': if (saveNow('已存檔')) toast('已存檔'); break;
      case 'export': { saveNow(); storage.exportFile(engine.serializeAll({ gameDay: time.day }), `小島存檔-${data.pack.id}-第${time.day}天.json`); break; }
      case 'import': try { await reloadWith(await storage.importFile()); } catch (e) { toast(e.message, 'bad'); } break;
      case 'backup': {
        const b = storage.loadBackup(SAVE_SLOT);
        if (b.status !== 'ok') { toast('沒有可用的備份', 'warn'); break; }
        await reloadWith(b.blob); break;
      }
      case 'newgame':
        if (confirm('要開新遊戲嗎？目前的存檔會先存成備份，可以用「讀取備份」找回來。')) {
          saveNow(); const cur = storage.load(SAVE_SLOT); if (cur.status === 'ok') storage.save(`${SAVE_SLOT}:backup`, cur.blob);
          storage.remove(SAVE_SLOT); const u = new URL(location.href); u.searchParams.delete('new'); location.href = u.href;
        }
        break;
      default: break;
    }
  };
  const onButton = (panel, node, values) => {
    if (node.action) { shellAction(node.action, values); return; }
    if (!node.command) return;
    const args = { ...(node.args || {}) };
    for (const [k, inputName] of Object.entries(node.argsFrom || {})) args[k] = values[inputName] ?? '';
    const r = engine.runCommand(node.command, args);
    if (!r.ok) toast(r.reason || r.error, 'warn');
    else if (node.argsFrom) for (const inputName of Object.values(node.argsFrom)) values[inputName] = '';
    refreshPanels(true);
  };
  let lastPanels = 0;
  const refreshPanels = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPanels < 300) return;
    lastPanels = now;
    host.update(shellPanels(), { onButton });
    $('clock').textContent = time.clockText();
  };

  // 模組錯誤 → 事件紀錄（白話）；指令被拒 → 不吵，按鈕旁已有原因
  engine.events.on('core:dayStarted', (d) => { if (!d.offline) log(`🌅 第 ${d.day} 天開始了`); });

  // 10. 主迴圈
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    let rem = time.advance(dt);
    while (rem > 0) { const s = Math.min(rem, 0.25); engine.update(s); rem -= s; }
    try { view.render(dt); } catch (e) { debug.errors.push(e.message); }
    refreshPanels();
    if (time.elapsed - lastSave > AUTOSAVE_SEC) saveNow();
    requestAnimationFrame(frame);
  };
  refreshPanels(true);
  requestAnimationFrame(frame);

  Object.assign(debug, {
    status: 'running', engine, services, data, view, storage, notices, saveNow, isNew,
    snapshot: () => ({ day: time.day, minute: Math.round(time.minuteOfDay), modules: engine.enabledModules(), entities: entities.all().length, bag: inventory.list('player') }),
  });
}

boot().catch((e) => fail({ message: `啟動時發生沒有預料到的錯誤：${e.message}`, hint: '請重新整理一次；如果還是一樣，請把這段訊息交給負責程式的人。' }));
