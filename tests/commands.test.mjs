// PR1a：指令系統（actor、AI 受限執行、available/canRun、entity 參數、userText 過濾、core:commandRun）
// 與世界包驗證改為各模組 schema。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, CommandRegistry, validatePack, loadPack } from '../src/core/index.js';
import { defaultTextFilter } from '../src/core/textfilter.js';
import { readPackDir, readCatalog, listPackDirs, readSchemas } from '../scripts/pack-io.mjs';

const mod = (id, extra = {}) => ({ id, version: '1.0.0', ...extra });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('指令收到 actor 與 source；玩家入口預設 actor=player', () => {
  const e = new Engine();
  const calls = [];
  e.register(mod('a', { init(ctx) { ctx.registerCommand({ id: 'a.do', aiCallable: true, run: (args, call) => calls.push(call) }); } }));
  e.start({ enabled: ['a'] });
  e.runCommand('a.do');
  assert.deepEqual(calls[0], { source: 'player', actor: 'player', caller: null });
  e.commands.run('a.do', {}, { source: 'ai', actor: 'afu' });
  assert.equal(calls[1].actor, 'afu');
  assert.equal(calls[1].source, 'ai');
});

test('模組以 AI 身分執行：受 aiCallable 限制，不能冒充玩家', () => {
  const e = new Engine();
  let ctxB;
  e.register(mod('a', { init(ctx) {
    ctx.registerCommand({ id: 'a.open', aiCallable: true, run: (_, call) => call });
    ctx.registerCommand({ id: 'a.secret', run: () => 'x' });
  } }));
  e.register(mod('b', { init(ctx) { ctxB = ctx; } }));
  e.start({ enabled: ['a', 'b'] });
  const ok = ctxB.runCommand('a.open', {}, { as: 'ai', actor: 'laoju' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result, { source: 'ai', actor: 'laoju', caller: 'b' });
  const no = ctxB.runCommand('a.secret', {}, { as: 'ai', actor: 'laoju' });
  assert.equal(no.ok, false);
  assert.equal(no.code, 'NOT_AI');
  assert.equal(ctxB.runCommand('a.secret').ok, true); // system 可以
  assert.equal(code(() => ctxB.runCommand('a.open', {}, { as: 'player' })), 'BAD_SOURCE');
  assert.deepEqual(ctxB.describeCommandsForAI({ actor: 'laoju' }).map((c) => c.id), ['a.open']);
});

test('available / canRun：不可用的指令不進 AI 清單，執行時回傳白話原因', () => {
  const reg = new CommandRegistry();
  let hasAxe = false;
  reg.register({
    id: 't.chop', label: '砍樹', aiCallable: true,
    params: { n: { type: 'int', min: 1, max: 9 } },
    available: () => (hasAxe ? true : '需要斧頭'),
    canRun: ({ n }) => (n > 3 ? '一次最多砍 3 棵' : true),
    run: ({ n }) => n,
  }, 't');
  assert.deepEqual(reg.describeForAI(), []);
  const r1 = reg.run('t.chop', { n: 1 });
  assert.equal(r1.code, 'UNAVAILABLE');
  assert.equal(r1.reason, '需要斧頭');
  hasAxe = true;
  assert.equal(reg.describeForAI()[0].label, '砍樹');
  assert.equal(reg.run('t.chop', { n: 5 }).reason, '一次最多砍 3 棵');
  assert.equal(reg.run('t.chop', { n: 2 }).result, 2);
  // available 本身出錯：視為不可用，不丟例外
  reg.register({ id: 't.boom', available() { throw new Error('壞'); }, run() {} }, 't');
  assert.equal(reg.run('t.boom').ok, false);
  // listFor 給介面：含原因
  hasAxe = false;
  const row = reg.listFor({ source: 'player' }).find((x) => x.def.id === 't.chop');
  assert.equal(row.ok, false);
  assert.equal(row.reason, '需要斧頭');
});

test('entity 參數：只接受存在且種類正確的實體；choices 提供候選給 AI', () => {
  const ents = new Map([['tree1', { id: 'tree1', kind: 'tree', owner: 'g' }], ['rock1', { id: 'rock1', kind: 'rock', owner: 'g' }]]);
  const e = new Engine({ services: { entities: { get: (id) => ents.get(id) ?? null } } });
  e.register(mod('g', { init(ctx) {
    ctx.registerCommand({
      id: 'g.chop', aiCallable: true,
      params: { target: { type: 'entity', kind: 'tree', choices: () => [...ents.values()].filter((x) => x.kind === 'tree').map((x) => x.id) } },
      run: ({ target }) => target,
    });
  } }));
  e.start({ enabled: ['g'] });
  assert.equal(e.runCommand('g.chop', { target: 'tree1' }).result, 'tree1');
  assert.equal(e.runCommand('g.chop', { target: 'rock1' }).ok, false);
  assert.equal(e.runCommand('g.chop', { target: 'ghost' }).reason, '那個東西已經不在了');
  assert.deepEqual(e.commands.describeForAI()[0].params.target.choices, ['tree1']);
});

test('userText：玩家輸入先過內容過濾；兒童版擋不適合的字與個資', () => {
  const e = new Engine({ data: { pack: { audience: 'children' } } });
  e.register(mod('n', { init(ctx) { ctx.registerCommand({ id: 'n.say', params: { text: { type: 'string', maxLen: 40, userText: true } }, run: ({ text }) => text }); } }));
  e.start({ enabled: ['n'] });
  assert.equal(e.runCommand('n.say', { text: '  今天去釣魚吧  ' }).result, '今天去釣魚吧');
  const bad = e.runCommand('n.say', { text: '你是笨 蛋' });
  assert.equal(bad.code, 'TEXT_REJECTED');
  assert.match(bad.reason, /不適合/);
  assert.match(e.runCommand('n.say', { text: '打給我 0912-345-678' }).reason, /電話/);
  assert.match(e.runCommand('n.say', { text: '看 https://x.y' }).reason, /網址/);
  // 換成自訂的過濾服務
  const e2 = new Engine({ services: { textFilter: () => ({ ok: false, reason: '老師關閉了打字' }) } });
  e2.register(mod('n', { init(ctx) { ctx.registerCommand({ id: 'n.say', params: { text: { type: 'string', userText: true } }, run: () => 1 }); } }));
  e2.start({ enabled: ['n'] });
  assert.equal(e2.runCommand('n.say', { text: 'hi' }).reason, '老師關閉了打字');
  // userText 只能用在 string
  assert.equal(code(() => new CommandRegistry().register({ id: 'x.y', params: { a: { type: 'int', userText: true } }, run() {} }, 'x')), 'BAD_PARAM');
});

test('預設過濾：不誤擋正常句子', () => {
  for (const ok of ['我抓到一隻蝴蝶', '花死了好可惜', '一起玩水槍', 'skill 很重要', '我有 3 顆蘋果']) {
    assert.equal(defaultTextFilter(ok).ok, true, ok);
  }
  assert.equal(defaultTextFilter('ＦＵＣＫ').ok, false);
});

test('core:commandRun：每次執行（成功或被拒）都會發出', () => {
  const e = new Engine();
  const seen = [];
  e.events.on('core:commandRun', (x) => seen.push(x));
  e.register(mod('a', { init(ctx) { ctx.registerCommand({ id: 'a.x', params: { n: { type: 'int' } }, run: () => 1 }); } }));
  e.start({ enabled: ['a'] });
  e.runCommand('a.x', { n: 2 });
  e.runCommand('a.x', {});
  e.runCommand('zzz.y');
  assert.deepEqual(seen.map((s) => [s.id, s.ok, s.owner]), [['a.x', true, 'a'], ['a.x', false, 'a'], ['zzz.y', false, null]]);
  assert.deepEqual(seen[0].args, { n: 2 });
  assert.equal(seen[1].code, 'BAD_ARGS');
});

// ---------- 世界包 schema ----------
test('世界包：模組 schema 可帶來新資料檔、新物種 kind、新放置 type，不需改核心', async () => {
  const catalog = await readCatalog();
  const schemas = await readSchemas();
  const base = await readPackDir((await listPackDirs())[0], schemas);
  const pets = {
    module: 'pets',
    files: { pets: 'list' },
    speciesKinds: ['pet'],
    placementTypes: ['kennel'],
    validate(data, { E, arr }) { for (const p of arr(data.pets)) if (!p.sound) E('pets.json', `寵物「${p.id}」缺少 sound`); },
  };
  const d = JSON.parse(JSON.stringify(base));
  d.species.push({ id: 'dog', name: '小狗', kind: 'pet' });
  d.island.placements.push({ type: 'kennel', x: 16, y: 12 });
  d.pets = [{ id: 'bobo' }];
  // 沒有 pets schema：kind 與 type 都會被抓到
  const without = validatePack(d, catalog, schemas).errors.map((x) => x.message).join('\n');
  assert.match(without, /kind「pet」沒有任何模組使用/);
  assert.match(without, /type「kennel」沒有任何模組使用/);
  // 加上 schema：只剩模組自己的檢查
  const withPets = validatePack(d, catalog, [...schemas, pets]).errors.map((x) => x.message);
  assert.deepEqual(withPets, ['寵物「bobo」缺少 sound']);
  // loadPack 依 schema 讀新檔案；讀不到時給空清單
  const loaded = await loadPack(async (name) => { if (name === 'pets') throw new Error('沒有'); return base[name] ?? {}; }, { schemas: [...schemas, pets] });
  assert.deepEqual(loaded.pets, []);
});

test('世界包：核心不再寫死 tracks/games/events；兒童安全政策掃描所有資料', async () => {
  const catalog = await readCatalog();
  const base = await readPackDir((await listPackDirs())[0]);
  const { readFile } = await import('node:fs/promises');
  const src = (await readFile(new URL('../src/core/worldpack.js', import.meta.url), 'utf8')).replace(/\/\/.*$/gm, '');
  for (const w of ['tracks', 'games', "'events'", 'recipes', 'crop', 'hunt']) assert.equal(src.includes(w), false, `核心不應出現 ${w}`);
  const d = JSON.parse(JSON.stringify(base));
  d.someModuleData = { deep: [{ presentation: 'hunt' }] };
  assert.ok(validatePack(d, catalog, []).errors.some((x) => /兒童版世界包不可使用「hunt」/.test(x.message)));
});
