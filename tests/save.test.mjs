// PR1b：存檔 meta、版本太新時保留、catchUp、種子亂數、核心服務切片、連帶關閉、目錄一致性、邊界收緊。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/core/index.js';
import { createRng } from '../src/core/rng.js';
import { checkBoundaries } from '../scripts/check-boundaries.mjs';
import { checkCatalog } from '../scripts/check-catalog.mjs';
import { readCatalog } from '../scripts/pack-io.mjs';

const mod = (id, extra = {}) => ({ id, version: '1.0.0', ...extra });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const pack = (id = 'island-default') => ({ pack: { id, version: '0.1.0', audience: 'children' } });

function counterModule(id, version = 1, state = { n: 0 }) {
  return mod(id, { init(ctx) { ctx.registerSaveSlice({ key: id, version, serialize: () => ({ n: state.n }), deserialize: (d) => { state.n = d.n; } }); } });
}

test('存檔 meta：世界包、存檔時間、種子、啟用模組', () => {
  const e = new Engine({ data: pack(), seed: 42, now: () => 1000 });
  e.register(counterModule('farm'));
  e.start({ enabled: ['farm'] });
  const blob = e.serializeAll({ gameDay: 3 });
  assert.equal(blob.format, 2);
  assert.deepEqual(blob.meta, { packId: 'island-default', packVersion: '0.1.0', savedAt: 1000, seed: 42, modules: ['farm'], gameDay: 3 });
  // 舊格式（format 1，沒有 meta）仍讀得懂
  const e2 = new Engine({ data: pack() });
  const st = { n: 0 };
  e2.register(counterModule('farm', 1, st));
  e2.start({ enabled: ['farm'] });
  e2.deserializeAll({ format: 1, modules: { farm: { v: 1, data: { n: 7 } } } });
  assert.equal(st.n, 7);
});

test('存檔來自別的世界包：預設拒絕並白話說明；允許後才載入', () => {
  const e = new Engine({ data: pack('other-pack') });
  const st = { n: 0 };
  e.register(counterModule('farm', 1, st));
  e.start({ enabled: ['farm'] });
  const blob = { format: 2, meta: { packId: 'island-default' }, modules: { farm: { v: 1, data: { n: 5 } } } };
  assert.equal(code(() => e.deserializeAll(blob)), 'PACK_MISMATCH');
  assert.equal(st.n, 0);
  e.deserializeAll(blob, { allowPackMismatch: true });
  assert.equal(st.n, 5);
  assert.equal(code(() => e.deserializeAll({ format: 9, modules: {} })), 'SAVE_TOO_NEW');
});

test('切片版本比程式新：不載入、原封保留、回報', () => {
  const st = { n: 1 };
  const e = new Engine({ data: pack() });
  e.register(counterModule('farm', 1, st));
  e.start({ enabled: ['farm'] });
  const blob = { format: 2, meta: {}, modules: { farm: { v: 3, data: { n: 99, newField: true } } } };
  const rep = e.deserializeAll(blob);
  assert.equal(st.n, 1);
  assert.equal(rep.tooNew[0].key, 'farm');
  assert.match(rep.tooNew[0].message, /比這個版本的程式新/);
  assert.deepEqual(e.serializeAll().modules.farm, blob.modules.farm);
});

test('種子亂數：可重現、每個模組各自一條、狀態隨存檔保存', () => {
  const a = createRng(7), b = createRng(7);
  const seqA = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(seqA, Array.from({ length: 5 }, () => b.next()));
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, () => createRng(8).next()));

  const draws = {};
  const mk = () => {
    const e = new Engine({ seed: 123 });
    for (const id of ['m1', 'm2']) e.register(mod(id, { init(ctx) { draws[id] = () => ctx.rng.int(1, 1000); } }));
    e.start({ enabled: ['m1', 'm2'] });
    return e;
  };
  const e1 = mk();
  const first = [draws.m1(), draws.m1(), draws.m2()];
  assert.notEqual(first[0], first[2]); // 不同模組不同序列（極小機率相同）
  const save = e1.serializeAll();
  const next1 = [draws.m1(), draws.m2()];
  const e2 = mk();
  e2.deserializeAll(save);
  assert.deepEqual([draws.m1(), draws.m2()], next1); // 讀檔後接著同一條亂數
  // 同種子新開一局：序列一樣
  mk();
  assert.deepEqual([draws.m1(), draws.m1(), draws.m2()], first);
});

test('catchUp：依順序呼叫、帶亂數、一個模組出錯不影響其他', () => {
  const e = new Engine({ onError() {}, now: () => 5000 });
  const got = [];
  e.register(mod('a', { catchUp(ctx, info) { got.push(['a', info.days, typeof ctx.rng.next()]); } }));
  e.register(mod('b', { requires: ['a'], catchUp() { throw new Error('壞'); } }));
  e.register(mod('c', { catchUp(ctx, info) { got.push(['c', info.days]); } }));
  e.start({ enabled: ['c', 'b', 'a'] });
  e.deserializeAll({ format: 2, meta: { savedAt: 2000 }, modules: {} });
  assert.equal(e.elapsedSinceSave(), 3000);
  const r = e.catchUp({ elapsedMs: 3000, days: 2 });
  assert.deepEqual(got, [['c', 2], ['a', 2, 'number']]);
  assert.deepEqual(r.failed.map((x) => x.module), ['b']);
});

test('核心服務切片：services 帶 saveSlice 會自動存讀；dispose 後仍保留', () => {
  const time = { day: 1, saveSlice: { version: 1, serialize: () => ({ day: time.day }), deserialize: (d) => { time.day = d.day; } } };
  const e = new Engine({ services: { time } });
  e.start({ enabled: [] });
  time.day = 9;
  const blob = e.serializeAll();
  assert.deepEqual(blob.modules['core.time'], { v: 1, data: { day: 9 } });
  e.dispose();
  time.day = 1;
  e.deserializeAll(blob);
  assert.equal(time.day, 9);
  assert.equal(code(() => e.registerCoreSlice({ key: 'time', version: 1, serialize() {}, deserialize() {} })), 'SLICE_NAMESPACE');
});

test('連帶關閉：缺依賴時把依賴它的模組也關掉，並用白話說明', () => {
  const e = new Engine({ labels: { residents: '居民', social: '好感度', gifts: '送禮' } });
  e.register(mod('residents')).register(mod('social', { requires: ['residents'] })).register(mod('gifts', { requires: ['social'] })).register(mod('farm'));
  assert.equal(code(() => e.resolve(['social', 'farm'])), 'MISSING_DEP'); // 沒開 cascade 照舊報錯
  const r = e.start({ enabled: ['social', 'gifts', 'farm'], cascade: true });
  assert.deepEqual(r.started, ['farm']);
  assert.deepEqual(r.notices.map((n) => n.message), [
    '因為「居民」沒有開啟，「好感度」也一起關掉了。',
    '因為「好感度」沒有開啟，「送禮」也一起關掉了。',
  ]);
});

test('世界包資料與模組設定唯讀', () => {
  const e = new Engine({ data: { items: [{ id: 'wood' }] } });
  let err = null;
  e.register(mod('a', { config: { n: 1 }, init(ctx) {
    try { ctx.data.items[0].id = 'x'; } catch (x) { err = x; }
    assert.throws(() => { ctx.config.n = 2; });
  } }));
  e.start({ enabled: ['a'] });
  assert.ok(err instanceof TypeError);
});

test('目錄一致性：目前專案通過；宣告不一致、狀態不符都會被抓到', async () => {
  const root = join(import.meta.dirname, '..');
  assert.deepEqual((await checkCatalog(root, await readCatalog())).errors, []);
  const tmp = await mkdtemp(join(tmpdir(), 'cat-'));
  try {
    const w = async (p, s) => { await mkdir(join(tmp, p, '..'), { recursive: true }); await writeFile(join(tmp, p), s); };
    await w('src/modules/farming/index.js', "export default { id: 'farming', version: '1', requires: ['gathering'], optional: [] };");
    await w('src/modules/fishing/index.js', "export default { id: 'fishy', version: '1' };");
    await w('src/modules/farming/schema.js', "export default { module: 'farm' };");
    const cat = { modules: [
      { id: 'farming', status: 'planned', requires: [], optional: [] },
      { id: 'fishing', status: 'implemented' },
      { id: 'ghost', status: 'implemented' },
    ] };
    const all = (await checkCatalog(tmp, cat)).errors.join('\n');
    assert.match(all, /requires 和 catalog\.json 不一致/);
    assert.match(all, /status 應改成 implemented/);
    assert.match(all, /模組 id 是「fishy」/);
    assert.match(all, /「ghost」標成 implemented，但沒有/);
    assert.match(all, /module 欄位是「farm」/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('邊界收緊：模組不可用瀏覽器 API、不可引用 src 以外；字串與註解不誤判', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'bnd2-'));
  try {
    const w = async (p, s) => { await mkdir(join(tmp, p, '..'), { recursive: true }); await writeFile(join(tmp, p), s); };
    await w('src/modules/a/index.js', "const r = await fetch('/api'); export default {};");
    await w('src/modules/b/index.js', "import n from '../../../data/npcs.js'; requestAnimationFrame(() => 1); export default {};");
    await w('src/modules/c/index.js', "// 不要用 window.x\nconst s = '請不要用 document.title'; const o = { location: 1 }; o.location.x; export default {};");
    await w('src/core/x.js', "export const t = () => globalThis.setTimeout;");
    const cat = { modules: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const errs = (await checkBoundaries(tmp, cat)).errors;
    const all = errs.join('\n');
    assert.match(all, /\[src\/modules\/a\/index\.js\] 模組不可直接使用瀏覽器 API（fetch\s*\(/);
    assert.match(all, /\[src\/modules\/b\/index\.js\] 模組不可引用 src 以外的檔案/);
    assert.match(all, /\[src\/modules\/b\/index\.js\] 模組不可直接使用瀏覽器 API（requestAnimationFrame/);
    assert.match(all, /\[src\/core\/x\.js\] 核心不可直接使用瀏覽器 API（globalThis/);
    assert.equal(errs.some((x) => x.includes('modules/c/')), false, all);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
