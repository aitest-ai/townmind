// 遊戲啟動：讀世界包 → 驗證 → 載入已啟用的模組 → 建立引擎與核心服務 → 讀存檔 → 開始主迴圈。
// 任何一步失敗，都在畫面上用白話說明原因與怎麼辦，不只丟到 console。
//
// 網址參數：
//   ?pack=island-default   要開哪個世界包（data/worldpacks/<id>/）
//   ?mods=crowd=on,farming=off   覆寫模組開關
//   ?new=1                 不讀存檔，開新遊戲（不會刪除舊存檔）
//   ?seed=123              指定亂數種子（測試用）
import { Engine, FrameworkError, validatePack, loadPack, parseOverrides, resolveEnabled, createCoreServices, defaultTextFilter } from '../core/index.js';
import { createStorage } from './storage.js';
import { createPanelHost, toast, log, showFatal, banner, showDialog, floatText } from './ui.js';
import { createPlayerController } from './player.js';
import { attachInput } from './input.js';
import { createPolicy } from './policy.js';
import { createPrefs } from './prefs.js';

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
  const toLoad = [], notYet = [], adminLater = [];
  for (const id of enabled) {
    const c = cat.get(id);
    if (!c) adminLater.push(`網址或世界包裡的「${id}」不是已知的功能，已略過。`);
    else if (c.status === 'planned' || c.status === 'deferred') notYet.push(c.name || id);
    else toLoad.push(id);
  }
  // 管理資訊（例如哪些功能還沒做好）只放在「設定」裡給老師看，不打擾玩家
  const adminNotes = [...adminLater];
  if (notYet.length) adminNotes.push(`有 ${notYet.length} 個功能還沒有做好，這次沒有開啟：${notYet.join('、')}。`);
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
  // 外殼提供給模組的服務（不在核心）：
  //   notify(text, level)：白話訊息 → 事件紀錄；level 'banner' 顯示在畫面中央（例如「下課囉」）
  //   policy：模組設定的限制（見 policy.js）
  //   now()：真實時間（毫秒），課堂計時用；測試時可用 window.__tm.clockOffset 快轉
  //   save()：立刻存檔
  //   prefs：和存檔分開保存的設定（get／set）
  const policy = createPolicy();
  let requestSave = () => false;
  const services = {
    ...createCoreServices(data),
    notify: (text, level = 'info') => { const t = String(text).slice(0, 160); log(t); if (level === 'banner') banner(t); else if (level === 'toast') toast(t); },
    policy,
    prefs: createPrefs(`townmind:${data.pack.id}`), // 和存檔分開的設定（例如老師密碼），開新遊戲不會清掉
    now: () => Date.now() + (debug.clockOffset || 0),
    save: () => requestSave(),
    // 輸入（螢幕方向，長度 0～1）：給要自己控制角色的模組（例如競速時的滑板車）
    input: { vector: () => inputRef?.vector() ?? { x: 0, y: 0 }, cameraAngle: () => (current === '3d' ? (views['3d']?.azimuth?.() ?? 0) : 0) },
  };
  let inputRef = null;
  services.textFilter = (text, opts) => (policy.get('playerTyping', true) === false
    ? { ok: false, reason: policy.get('typingReason', '現在不能打字喔') }
    : defaultTextFilter(text, opts));
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
  let recovery = null; // 存檔讀不出來時，畫面上讓使用者選怎麼辦
  if (saved.status === 'broken') {
    notices.push(`存檔壞掉了（${saved.error}），這次先開新遊戲。壞掉的存檔另外保留著。`);
    recovery = { reason: saved.error, broken: true };
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
      recovery = { reason: fe ? fe.message : e.message, broken: false, keepSave: true };
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
  let leaving = false; // 讀備份／匯入／開新遊戲時要重新整理：離開前不可以再自動存檔，否則會蓋掉剛寫好的存檔
  const saveNow = (why = '') => {
    if (leaving) return false;
    let blob;
    try { blob = engine.serializeAll({ gameDay: time.day }); } catch (e) { toast(`這次沒存到：${e.message}`, 'bad'); return false; }
    const r = storage.save(SAVE_SLOT, blob, { rotate: !recovery }); // 這次讀檔出過問題：整段遊戲都不動備份，保留給使用者還原
    if (!r.ok) { toast(r.error, 'bad', 8000); return false; }
    lastSave = time.elapsed;
    if (why) log(`💾 ${why}`);
    return true;
  };
  requestSave = () => saveNow('已存檔');
  addEventListener('pagehide', () => saveNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

  let refreshPanels = () => {}; // 面板建好之前先是空的
  // 8. 畫面：2D 一定可用；3D 預設開啟，裝置不支援時自動退回 2D 並說明
  const { createRenderer2D } = await import('../render2d/index.js');
  const views = { '2d': createRenderer2D($('view2d'), { data, services }), '3d': null };
  const lowPower = params.get('lowpower') === '1' || (navigator.hardwareConcurrency || 8) <= 4;
  const follow = data.island.look?.camera === 'overview' ? null : 'player';
  let current = '2d';
  const setView = async (name) => {
    if (name === '3d' && !views['3d']) {
      try {
        const { createRenderer3D } = await import('../render3d/index.js');
        views['3d'] = await createRenderer3D($('view3d'), { data, services, lowPower, follow });
      } catch (e) {
        log(`⚠ 3D 畫面無法啟動（${e.message || e}），已改用 2D。可能是這台裝置不支援 WebGL。`);
        name = '2d';
      }
    }
    current = name;
    $('view2d').style.display = name === '2d' ? 'block' : 'none';
    $('view3d').style.display = name === '3d' ? 'block' : 'none';
    refreshPanels(true);
  };
  await setView(params.get('view') === '2d' ? '2d' : '3d');
  $('loading').remove();

  // 9. 面板：外殼自己的面板 + 模組註冊的宣告式面板
  // 面板放哪裡：placement 'side'（右側，預設）、'hud'（畫面上方）、'settings'（設定選單，給老師與管理用）
  const host = createPanelHost($('panels'));
  const settingsHost = createPanelHost($('settingsPanels'));
  const hudHost = createPanelHost($('hudPanels'));
  const SPEEDS = [{ value: '0', label: '暫停' }, { value: '1', label: '正常' }, { value: '2', label: '2 倍' }, { value: '4', label: '4 倍' }, { value: '8', label: '8 倍' }];
  const shellPanels = () => [
    { id: 'shell.status', title: '小島狀態', order: 0, nodes: [
      { type: 'stat', label: '時間', value: time.clockText() },
      { type: 'stat', label: '一天的長度', value: time.mode === 'real' ? '跟著真實時鐘' : `${Math.round(time.dayLengthSec / 60)} 分鐘` },
      ...(policy.get('playerTimeControl', true)
        ? [{ type: 'select', name: 'speed', label: '時間速度', options: SPEEDS.filter((o) => Number(o.value) <= policy.get('maxSpeed', 99)), value: String(time.paused ? 0 : time.timeScale), onChange: 'speed' }]
        : [{ type: 'stat', label: '時間速度', value: time.paused ? '暫停中（老師設定）' : `${time.timeScale} 倍（老師設定）` }]),
      { type: 'select', name: 'view', label: '畫面', options: [{ value: '3d', label: '3D 立體' }, { value: '2d', label: '2D 俯視' }], value: current, onChange: 'view' },
      ...(current === '3d' ? [{ type: 'text', text: '鏡頭：拖曳旋轉、兩指或右鍵平移、滾輪或兩指縮放。' }, { type: 'button', label: '重設鏡頭', action: 'camReset' }] : []),
    ] },
    ...engine.listPanels().filter((p) => typeof p.view === 'function').map((p) => ({ id: p.id, title: p.title, order: p.order, placement: p.placement || 'side', nodes: engine.renderPanel(p.id) })),
    { id: 'shell.bag', title: '背包', order: 900, nodes: [
      { type: 'list', items: inventory.list('player').map((s) => ({ label: `${s.name} × ${s.qty}` })), empty: '背包是空的' },
    ] },
    { id: 'shell.save', title: '存檔', order: 950, placement: 'settings', nodes: [
      { type: 'text', text: storage.persistent ? '每 20 秒與關閉網頁時會自動存檔。' : '⚠ 這個瀏覽器不能長期保存（可能是無痕模式），請記得「匯出存檔」。' },
      { type: 'buttons', items: [
        { type: 'button', label: '立刻存檔', action: 'save', primary: true },
        { type: 'button', label: '匯出存檔', action: 'export' },
        ...(policy.get('playerSaveControl', true) ? [
          { type: 'button', label: '匯入存檔', action: 'import' },
          { type: 'button', label: '讀取備份', action: 'backup' },
          { type: 'button', label: '開新遊戲', action: 'newgame' },
        ] : []),
      ] },
    ] },
    { id: 'shell.modules', title: '功能模組', order: 990, placement: 'settings', nodes: [
      { type: 'text', text: '這次開啟的功能（可在世界包 pack.json 或網址 ?mods=功能=off 開關）：' },
      { type: 'list', items: engine.enabledModules().map((id) => ({ label: labels[id] || id, detail: id })), empty: '目前沒有開啟任何功能模組' },
      ...([...adminNotes, ...notices].length ? [{ type: 'list', items: [...adminNotes, ...notices].map((n) => ({ label: n })) }] : []),
    ] },
  ].sort((a, b) => a.order - b.order);

  const reloadWith = async (blob) => {
    // 先檢查存檔看得懂，再寫進儲存區重新整理（讓引擎從乾淨狀態讀檔）
    if (!blob || ![1, 2].includes(blob.format)) { toast('這個檔案不是存檔（看不懂內容）', 'bad'); return; }
    if (blob.meta?.packId && blob.meta.packId !== data.pack.id) { toast(`這個存檔屬於另一個世界「${blob.meta.packId}」，目前開的是「${data.pack.id}」。`, 'bad', 8000); return; }
    storage.save(SAVE_SLOT, blob, { rotate: !recovery }); // 匯入時目前的存檔變成備份；讀檔出過問題時不動備份
    leaving = true;
    const u = new URL(location.href); u.searchParams.delete('new'); location.href = u.href;
  };
  const shellAction = async (action, values) => {
    switch (action) {
      case 'speed': {
        if (!policy.get('playerTimeControl', true)) { toast('老師已經設定好時間速度了', 'warn'); break; }
        const k = Math.min(Number(values.speed), policy.get('maxSpeed', 99)); time.pause(k === 0); if (k > 0) time.setTimeScale(k); break;
      }
      case 'view': await setView(values.view); break;
      case 'camReset': views['3d']?.resetCamera(); break;
      case 'save': if (saveNow('已存檔')) toast('已存檔'); break;
      case 'export': { saveNow(); storage.exportFile(engine.serializeAll({ gameDay: time.day }), `小島存檔-${data.pack.id}-第${time.day}天.json`); break; }
      case 'import': if (!policy.get('playerSaveControl', true)) break; try { await reloadWith(await storage.importFile()); } catch (e) { toast(e.message, 'bad'); } break;
      case 'backup': {
        const b = storage.loadBackup(SAVE_SLOT);
        if (b.status !== 'ok') { toast('沒有可用的備份', 'warn'); break; }
        await reloadWith(b.blob); break;
      }
      case 'newgame':
        if (policy.get('playerSaveControl', true) && confirm('要開新遊戲嗎？目前的存檔會先存成備份，可以用「讀取備份」找回來。')) {
          saveNow(); const cur = storage.load(SAVE_SLOT); if (cur.status === 'ok') storage.save(`${SAVE_SLOT}:backup`, cur.blob);
          storage.remove(SAVE_SLOT); leaving = true; const u = new URL(location.href); u.searchParams.delete('new'); location.href = u.href;
        }
        break;
      default: break;
    }
  };
  const onButton = (panel, node, values) => {
    if (node.action) { shellAction(node.action, values); return; }
    if (!node.command) return;
    const args = { ...(node.args || {}) };
    for (const [k, inputName] of Object.entries(node.argsFrom || {})) {
      const v = values[inputName];
      if (v !== undefined && v !== '') args[k] = v;          // 輸入框有填才覆蓋
      else if (!(k in args)) args[k] = '';                    // 沒有預設值：交給指令驗證（會說明缺什麼）
    }
    const r = engine.runCommand(node.command, args);
    if (!r.ok) toast(r.reason || r.error, 'warn');
    else if (node.argsFrom) for (const inputName of Object.values(node.argsFrom)) values[inputName] = '';
    refreshPanels(true);
  };
  let lastPanels = 0;
  refreshPanels = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPanels < 300) return;
    lastPanels = now;
    const all = shellPanels();
    host.update(all.filter((p) => !p.placement || p.placement === 'side'), { onButton });
    settingsHost.update(all.filter((p) => p.placement === 'settings'), { onButton });
    hudHost.update(all.filter((p) => p.placement === 'hud' && p.nodes.length), { onButton });
    $('clock').textContent = time.clockText();
  };

  // 回饋事件：每個模組在關鍵時刻發「<模組id>:feedback」（成功、失敗、完成、解鎖、進度）。
  // 外殼目前只顯示一個小提示；之後畫面特效、音效、粒子都訂閱同一個事件即可，不必改模組。
  const feedbackLog = [];
  for (const id of engine.enabledModules()) {
    engine.events.on(`${id}:feedback`, (fb) => {
      feedbackLog.push({ module: id, ...fb });
      if (feedbackLog.length > 100) feedbackLog.shift();
      if (fb?.text && fb.quiet !== true) floatText(fb.text, fb.kind);
    });
  }

  // 模組錯誤 → 事件紀錄（白話）；指令被拒 → 不吵，按鈕旁已有原因
  engine.events.on('core:dayStarted', (d) => { if (!d.offline) log(`🌅 第 ${d.day} 天開始了`); });

  // 9.5 玩家操控與「互動」按鈕（只靠 engine.interactionsFor，新模組不必改這裡）
  // 擋路的東西：模組用 registerEntityKind(kind, { solid: true, radius }) 宣告
  const solidRadius = (e) => { const k = engine.entityKind(e.kind); return k?.solid ? (k.radius ?? 0.42) : 0; };
  const player = createPlayerController({ entities, island: data.island, solidRadius });
  const REACH = 2.2;
  let hudKey = '', hudItems = [];
  const nearbyInteractions = () => {
    const p = entities.get('player');
    if (!p) return [];
    const out = [];
    for (const e of entities.near(p.x, p.y, REACH, { filter: (x) => x.id !== 'player' })) {
      for (const it of engine.interactionsFor(e.id)) out.push({ ...it, entity: e.id });
      if (out.length >= 4) break;
    }
    return out.slice(0, 4);
  };
  const runInteraction = (it) => {
    const r = engine.runCommand(it.command, it.args);
    if (!r.ok) toast(r.reason || r.error, 'warn');
    hudKey = ''; refreshPanels(true);
  };
  const refreshHud = () => {
    hudItems = nearbyInteractions();
    const key = JSON.stringify(hudItems.map((x) => [x.label, x.ok, x.reason]));
    if (key === hudKey) return;
    hudKey = key;
    const hud = $('hud'); hud.textContent = '';
    for (const it of hudItems) {
      const b = document.createElement('button');
      b.className = it.ok ? 'primary big' : 'big';
      b.textContent = it.ok ? it.label : `${it.label}（${it.reason}）`;
      b.onclick = () => runInteraction(it);
      hud.append(b);
    }
  };
  const wantStick = params.get('joystick') === '1' || (params.get('joystick') !== '0' && matchMedia('(pointer: coarse)').matches);
  const input = inputRef = attachInput({
    stage: $('stage'), joystick: wantStick,
    onTap: (x, y) => { const p = views[current].toWorld(x, y); if (p && !player.setTarget(p.x, p.y)) toast('那裡走不過去喔', 'warn', 2500); },
    onInteract: () => { const it = hudItems.find((x) => x.ok); if (it) runInteraction(it); },
  });
  // 螢幕方向 → 地圖方向：3D 鏡頭轉了角度時跟著轉
  let wasSteering = false;
  const steer = () => {
    const v = input.vector();
    const on = Math.hypot(v.x, v.y) > 0.01;
    if (!on && !wasSteering) return;
    wasSteering = on;
    const a = current === '3d' ? (views['3d']?.azimuth?.() ?? 0) : 0;
    player.setDirection(Math.cos(a) * v.x + Math.sin(a) * v.y, -Math.sin(a) * v.x + Math.cos(a) * v.y);
  };

  // 10. 主迴圈
  let last = performance.now(), lastHud = 0, lastIdle = 0;
  const frame = (now) => {
    const raw = Math.min(0.25, (now - last) / 1000); last = now;
    const dt = Math.min(0.1, raw);
    let rem = time.advance(dt);
    if (rem > 0) while (rem > 0) { const s = Math.min(rem, 0.25); engine.update(s); rem -= s; }
    else if (now - lastIdle > 250) { lastIdle = now; engine.update(0); } // 暫停時系統仍收到 dt=0（例如課堂計時要繼續走）
    if (policy.get('playerMovement', true)) steer(); else if (wasSteering) { wasSteering = false; player.stop(); }
    // 玩家用真實經過的時間（平板掉幀時也不會變慢），切成小步避免穿過東西
    if (policy.get('playerMovement', true)) for (let left = raw; left > 1e-4; left -= 1 / 30) player.update(Math.min(left, 1 / 30));
    // 目的地記號：點地面後顯示一個小圈圈，走到就消失（外殼自己的實體，不存檔）
    const tgt = player.target;
    if (tgt) { if (!entities.get('shell.marker')) entities.add({ id: 'shell.marker', kind: 'marker', owner: 'shell', art: 'marker', x: tgt.x, y: tgt.y }); else entities.move('shell.marker', tgt.x, tgt.y); }
    else if (entities.get('shell.marker')) entities.remove('shell.marker');
    if (now - lastHud > 200) { lastHud = now; refreshHud(); }
    try { views[current].render(raw); } catch (e) { debug.errors.push(e.message); } // 畫面用真實經過時間：鏡頭平滑在掉幀時也一樣快
    refreshPanels();
    if (time.elapsed - lastSave > AUTOSAVE_SEC) saveNow();
    requestAnimationFrame(frame);
  };
  refreshPanels(true);
  requestAnimationFrame(frame);

  // 存檔讀不出來：說明原因，讓使用者選「讀備份／下載壞掉的檔／先玩新遊戲」
  if (recovery) {
    if (recovery.keepSave) storage.save(`${SAVE_SLOT}:broken`, saved.blob); // 讀不進來的存檔另外留一份，避免被新遊戲的自動存檔蓋掉
    const b = storage.loadBackup(SAVE_SLOT);
    const bInfo = b.status === 'ok' ? `（第 ${b.blob?.meta?.gameDay ?? '?'} 天，${b.blob?.meta?.savedAt ? new Date(b.blob.meta.savedAt).toLocaleString('zh-TW') : '時間不明'}）` : '';
    showDialog({
      title: '存檔讀不出來',
      message: `原因：${recovery.reason}`,
      hint: b.status === 'ok' ? '可以先試試「讀取備份」，那是再前一次的存檔。' : '沒有可用的備份。可以把壞掉的存檔下載下來交給老師，或先開新遊戲。',
      actions: [
        ...(b.status === 'ok' ? [{ label: `讀取備份${bInfo}`, primary: true, run: () => reloadWith(b.blob) }] : []),
        { label: '下載壞掉的存檔', run: () => storage.exportText(storage.raw(`${SAVE_SLOT}:broken`) ?? '', `壞掉的存檔-${data.pack.id}.json`) },
        { label: '先玩新遊戲', primary: b.status !== 'ok', run: () => {} },
      ],
    });
    debug.recovery = recovery;
  }

  Object.assign(debug, {
    status: 'running', engine, services, data, views, player, input, hud: () => hudItems, feedback: feedbackLog, adminNotes, get view() { return current; }, setView, storage, notices, saveNow, isNew,
    snapshot: () => ({ day: time.day, minute: Math.round(time.minuteOfDay), modules: engine.enabledModules(), entities: entities.all().length, bag: inventory.list('player') }),
  });
}

boot().catch((e) => fail({ message: `啟動時發生沒有預料到的錯誤：${e.message}`, hint: '請重新整理一次；如果還是一樣，請把這段訊息交給負責程式的人。' }));
