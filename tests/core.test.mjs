import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, EventBus, CommandRegistry, FrameworkError, parseOverrides, resolveEnabled, validatePack } from '../src/core/index.js';
import { checkBoundaries } from '../scripts/check-boundaries.mjs';
import { readPackDir, readCatalog, listPackDirs, readSchemas } from '../scripts/pack-io.mjs';

const mod = (id, extra = {}) => ({ id, version: '1.0.0', ...extra });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('EventBus：on/once/off，單一處理函式出錯不影響其他', () => {
  const errs = [];
  const bus = new EventBus((n, e) => errs.push(n));
  const got = [];
  bus.on('a:x', () => { throw new Error('壞掉'); });
  bus.on('a:x', (p) => got.push(p));
  bus.once('a:y', (p) => got.push(p));
  bus.emit('a:x', 1); bus.emit('a:y', 2); bus.emit('a:y', 3);
  assert.deepEqual(got, [1, 2]);
  assert.deepEqual(errs, ['a:x']);
  const off = bus.on('a:z', () => got.push('z'));
  off(); bus.emit('a:z');
  assert.equal(got.includes('z'), false);
});

test('Engine.resolve：依賴順序、缺依賴、衝突、循環、未知模組', () => {
  const e = new Engine();
  e.register(mod('a')).register(mod('b', { requires: ['a'] })).register(mod('c', { requires: ['b'], optional: ['d'] })).register(mod('d'));
  assert.deepEqual(e.resolve(['c', 'b', 'a']).order, ['a', 'b', 'c']);
  assert.deepEqual(e.resolve(['c', 'b', 'a', 'd']).order.indexOf('d') < e.resolve(['c', 'b', 'a', 'd']).order.indexOf('c'), true);
  assert.equal(code(() => e.resolve(['b'])), 'MISSING_DEP');
  assert.equal(code(() => e.resolve(['zzz'])), 'UNKNOWN_MODULE');
  assert.deepEqual(e.resolve(['a', 'zzz'], { skipUnknown: true }).skipped, ['zzz']);

  const e2 = new Engine();
  e2.register(mod('x', { conflicts: ['y'] })).register(mod('y'));
  assert.equal(code(() => e2.resolve(['x', 'y'])), 'CONFLICT');

  const e3 = new Engine();
  e3.register(mod('p', { requires: ['q'] })).register(mod('q', { requires: ['p'] }));
  assert.equal(code(() => e3.resolve(['p', 'q'])), 'CYCLE');
});

test('Engine.register：id 不合法與重複', () => {
  const e = new Engine();
  assert.equal(code(() => e.register({ id: 'Bad Id', version: '1' })), 'BAD_MODULE');
  e.register(mod('ok'));
  assert.equal(code(() => e.register(mod('ok'))), 'DUP_MODULE');
});

test('命名空間：emit 只能發自己的事件，且須宣告', () => {
  const e = new Engine();
  let err = [];
  e.register(mod('m', {
    emits: ['m:ok'],
    init(ctx) {
      err.push(code(() => ctx.emit('other:x')));
      err.push(code(() => ctx.emit('m:undeclared')));
      ctx.emit('m:ok', 1);
    },
  }));
  const seen = [];
  e.events.on('m:ok', (p) => seen.push(p));
  e.start({ enabled: ['m'] });
  assert.deepEqual(err, ['EVENT_NAMESPACE', 'EVENT_UNDECLARED']);
  assert.deepEqual(seen, [1]);
});

test('getModule：只能取已宣告依賴；optional 未啟用為 null；api 可用', () => {
  const e = new Engine();
  let r = {};
  e.register(mod('base', { init: () => ({ api: { hi: () => 'hi' } }) }));
  e.register(mod('top', {
    requires: ['base'], optional: ['ghost'],
    init(ctx) {
      r.base = ctx.getModule('base').hi();
      r.ghost = ctx.getModule('ghost');
      r.bad = code(() => ctx.getModule('nope'));
    },
  }));
  e.register(mod('ghost'));
  e.start({ enabled: ['base', 'top'] });
  assert.equal(r.base, 'hi');
  assert.equal(r.ghost, null);
  assert.equal(r.bad, 'UNDECLARED_DEP');
});

test('指令：命名空間、AI 清單、停用模組的指令消失、AI 不能呼叫非 aiCallable', () => {
  const e = new Engine({ data: { residents: [{ id: 'mimi' }] } });
  e.register(mod('a', {
    init(ctx) {
      assert.equal(code(() => ctx.registerCommand({ id: 'wrong.x', run() {} })), 'COMMAND_NAMESPACE');
      ctx.registerCommand({ id: 'a.open', aiCallable: true, params: { n: { type: 'int', min: 1, max: 5 } }, run: ({ n }) => n });
      ctx.registerCommand({ id: 'a.secret', run: () => 'x' });
    },
  }));
  e.register(mod('b', { init(ctx) { ctx.registerCommand({ id: 'b.open', aiCallable: true, run: () => 'b' }); } }));
  e.start({ enabled: ['a', 'b'] });
  assert.deepEqual(e.commands.describeForAI().map((c) => c.id).sort(), ['a.open', 'b.open']);
  assert.equal(e.commands.run('a.secret', {}, { source: 'ai' }).ok, false);
  assert.equal(e.commands.run('a.secret', {}, { source: 'player' }).ok, true);
  e.dispose();
  e.start({ enabled: ['a'] });
  assert.deepEqual(e.commands.describeForAI().map((c) => c.id), ['a.open']);
  assert.equal(e.commands.run('b.open').ok, false);
});

test('指令參數驗證：clamp、拒絕、enum、ref、string、丟掉多餘參數', () => {
  const reg = new CommandRegistry({ hasRef: (of, id) => of === 'residents' && id === 'mimi' });
  reg.register({
    id: 't.go',
    params: {
      n: { type: 'int', min: 1, max: 5, clamp: true },
      m: { type: 'int', min: 1, max: 5 },
      k: { type: 'enum', values: ['a', 'b'] },
      who: { type: 'ref', of: 'residents' },
      s: { type: 'string', maxLen: 3, truncate: true },
      opt: { type: 'bool', optional: true },
    },
    run: (a) => a,
  }, 't');
  const ok = reg.run('t.go', { n: 99, m: 3, k: 'a', who: 'mimi', s: 'abcdef', evil: 1 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result, { n: 5, m: 3, k: 'a', who: 'mimi', s: 'abc' });
  const base = { n: 1, m: 3, k: 'a', who: 'mimi', s: 'x' };
  assert.equal(reg.run('t.go', { ...base, m: 99 }).ok, false);
  assert.equal(reg.run('t.go', { ...base, k: 'z' }).ok, false);
  assert.equal(reg.run('t.go', { ...base, who: 'nobody' }).ok, false);
  assert.equal(reg.run('t.go', { ...base, m: undefined }).ok, false);
  assert.equal(reg.run('t.go', { ...base, m: 'abc' }).ok, false);
});

test('指令執行出錯不會丟出例外', () => {
  const reg = new CommandRegistry();
  reg.register({ id: 't.boom', run() { throw new Error('爆'); } }, 't');
  const r = reg.run('t.boom');
  assert.equal(r.ok, false);
  assert.match(r.error, /爆/);
});

test('系統：依 order 執行；連續出錯 3 次後只停用該系統，其他照常', () => {
  const e = new Engine({ onError() {} });
  const log = [];
  let bad = 0;
  e.register(mod('s', {
    init(ctx) {
      ctx.registerSystem({ id: 's.late', order: 200, update: () => log.push('late') });
      ctx.registerSystem({ id: 's.bad', order: 50, update: () => { bad++; throw new Error('壞'); } });
      ctx.registerSystem({ id: 's.early', order: 10, update: () => log.push('early') });
    },
  }));
  const errors = [];
  e.events.on('core:moduleError', (x) => errors.push(x));
  e.start({ enabled: ['s'] });
  e.update(1);
  assert.deepEqual(log, ['early', 'late']);
  for (let i = 0; i < 5; i++) e.update(1);
  assert.equal(bad, 3);
  assert.equal(log.filter((x) => x === 'late').length, 6);
  assert.equal(errors.length, 3);
  assert.equal(errors[2].disabled, true);
});

function makeSaveEngine(ids, state, opts = {}) {
  const e = new Engine();
  const defs = {
    farm: mod('farm', { init(ctx) { ctx.registerSaveSlice({ key: 'farm', version: 2, serialize: () => ({ crops: state.crops }), deserialize: (d) => { if (opts.failFarm) throw new Error('壞存檔'); state.crops = d.crops; } }); } }),
    fish: mod('fish', { init(ctx) { ctx.registerSaveSlice({ key: 'fish', version: 1, serialize: () => ({ caught: state.caught }), deserialize: (d) => { state.caught = d.caught; } }); } }),
  };
  for (const d of Object.values(defs)) e.register(d);
  e.start({ enabled: ids });
  return e;
}

test('存檔：來回一致、停用模組的資料原封保留、載入失敗的切片不被覆蓋', () => {
  const s1 = { crops: [1, 2], caught: ['鯉魚'] };
  const blob = makeSaveEngine(['farm', 'fish'], s1).serializeAll();
  assert.equal(blob.format, 1);
  assert.equal(blob.modules.farm.v, 2);

  // 只啟用 farm 載入：fish 變孤兒，再存檔時仍在
  const s2 = { crops: [] };
  const e2 = makeSaveEngine(['farm'], s2);
  const rep = e2.deserializeAll(blob);
  assert.deepEqual(rep.orphaned, ['fish']);
  assert.deepEqual(s2.crops, [1, 2]);
  const blob2 = e2.serializeAll();
  assert.deepEqual(blob2.modules.fish, blob.modules.fish);

  // 再啟用 fish：資料還在
  const s3 = {};
  makeSaveEngine(['farm', 'fish'], s3).deserializeAll(blob2);
  assert.deepEqual(s3.caught, ['鯉魚']);

  // 載入失敗：保留原資料
  const s4 = { crops: ['預設'] };
  const e4 = makeSaveEngine(['farm'], s4, { failFarm: true });
  const rep4 = e4.deserializeAll(blob);
  assert.equal(rep4.failed.length, 1);
  assert.deepEqual(e4.serializeAll().modules.farm, blob.modules.farm);

  assert.equal(code(() => e4.deserializeAll({ nope: 1 })), 'BAD_SAVE');
});

test('存檔：切片名稱空間與非 JSON 資料', () => {
  const e = new Engine();
  let c;
  e.register(mod('z', {
    init(ctx) {
      c = code(() => ctx.registerSaveSlice({ key: 'other', version: 1, serialize() {}, deserialize() {} }));
      ctx.registerSaveSlice({ key: 'z.sub', version: 1, serialize: () => { const o = {}; o.self = o; return o; }, deserialize() {} });
    },
  }));
  e.start({ enabled: ['z'] });
  assert.equal(c, 'SLICE_NAMESPACE');
  assert.equal(code(() => e.serializeAll()), 'SAVE_NOT_JSON');
});

test('dispose：移除系統、指令、事件監聽、面板；init 失敗會復原', () => {
  const e = new Engine();
  let hits = 0;
  e.register(mod('a', {
    init(ctx) {
      ctx.registerSystem({ update: () => hits++ });
      ctx.registerCommand({ id: 'a.x', run() {} });
      ctx.registerPanel({ id: 'p', title: 'P' });
      ctx.on('q:e', () => hits++);
    },
  }));
  e.start({ enabled: ['a'] });
  e.dispose();
  e.update(1); e.events.emit('q:e');
  assert.equal(hits, 0);
  assert.equal(e.commands.get('a.x'), null);
  assert.equal(e.listPanels().length, 0);

  const e2 = new Engine();
  let disposed = false;
  e2.register(mod('good', { dispose() { disposed = true; } }));
  e2.register(mod('bad', { requires: ['good'], init() { throw new Error('init 壞了'); } }));
  assert.equal(code(() => e2.start({ enabled: ['good', 'bad'] })), 'MODULE_INIT_FAILED');
  assert.equal(disposed, true);
  assert.equal(e2.enabledModules().length, 0);
});

test('旗標：parseOverrides / resolveEnabled', () => {
  assert.deepEqual(parseOverrides('farming=off,capture=on,x'), { farming: false, capture: true, x: true });
  assert.deepEqual(parseOverrides(''), {});
  const r = resolveEnabled({ a: { enabled: true, config: { n: 1 } }, b: { enabled: true }, c: { enabled: false } }, { b: false, c: true, d: true });
  assert.deepEqual(r.enabled.sort(), ['a', 'c', 'd']);
  assert.deepEqual(r.config.a, { n: 1 });
});

// ---------- 世界包 ----------
const clone = (x) => JSON.parse(JSON.stringify(x));
let basePack, catalog, schemas;
test('世界包：範例通過驗證', async () => {
  catalog = await readCatalog();
  schemas = await readSchemas();
  const dirs = await listPackDirs();
  assert.ok(dirs.length >= 1);
  for (const d of dirs) {
    const r = validatePack(await readPackDir(d), catalog, schemas);
    assert.deepEqual(r.errors, [], d);
  }
  basePack = await readPackDir(dirs[0]);
});

const hasErr = (data, re) => validatePack(data, catalog, schemas).errors.some((e) => re.test(e.message));

test('世界包：能抓到壞參照', () => {
  const d = clone(basePack);
  d.recipes[0].inputs ? (d.recipes[0].inputs[0].item = 'no_such_item') : (d.recipes[0].ingredients[0].item = 'no_such_item');
  assert.ok(hasErr(d, /no_such_item/));
});

test('世界包：兒童版不允許 hunt 呈現', () => {
  const d = clone(basePack);
  const sp = d.species.find((s) => s.capture);
  sp.capture.methods[0].presentation = 'hunt';
  assert.ok(hasErr(d, /hunt|兒童|安全/));
});

test('世界包：地圖列長度不一致', () => {
  const d = clone(basePack);
  d.island.terrain[3] = d.island.terrain[3].slice(1);
  assert.ok(hasErr(d, /長度|寬/));
});

test('世界包：缺模組依賴', () => {
  const d = clone(basePack);
  d.pack.modules.residents.enabled = false;
  d.pack.modules.social = { enabled: true, config: {} };
  assert.ok(hasErr(d, /residents/));
});

test('世界包：啟用的模組缺必要資料', () => {
  const d = clone(basePack);
  d.recipes = [];
  d.pack.modules.crafting = { enabled: true, config: {} };
  assert.ok(hasErr(d, /recipes|配方/));
});

test('世界包：啟用競速模組卻沒有賽道資料', () => {
  const d = clone(basePack);
  d.pack.modules.racing = { enabled: true, config: {} };
  assert.ok(hasErr(d, /tracks|racing/));
  d.tracks = [{ id: 'beach_loop' }];
  assert.equal(hasErr(d, /需要「tracks」/), false);
});

// ---------- 邊界檢查 ----------
test('邊界檢查：目前的專案通過；違規範例被抓到', async () => {
  const root = join(import.meta.dirname, '..');
  assert.deepEqual((await checkBoundaries(root, await readCatalog())).errors, []);

  const tmp = await mkdtemp(join(tmpdir(), 'bnd-'));
  try {
    const w = async (p, s) => { await mkdir(join(tmp, p, '..'), { recursive: true }); await writeFile(join(tmp, p), s); };
    await w('src/core/bad.js', "import x from '../modules/farming/index.js'; import * as T from 'three'; document.title='x';");
    await w('src/render3d/r.js', "import f from '../modules/farming/index.js';");
    await w('src/modules/farming/index.js', "import g from '../gathering/inner.js'; import h from '../../render3d/r.js';");
    await w('src/modules/gathering/index.js', "export default {};");
    await w('src/modules/unlisted/index.js', "export default {};");
    const cat = { modules: [{ id: 'farming', requires: [], optional: [] }, { id: 'gathering' }] };
    const { errors } = await checkBoundaries(tmp, cat);
    const all = errors.join('\n');
    assert.match(all, /核心不可 import 模組/);
    assert.match(all, /核心不可使用 three/);
    assert.match(all, /瀏覽器 API/);
    assert.match(all, /渲染層不可 import 模組/);
    assert.match(all, /沒有在 catalog\.json 把它宣告/);
    assert.match(all, /深入引用/);
    assert.match(all, /模組不可 import 渲染層/);
    assert.match(all, /沒有登記/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
