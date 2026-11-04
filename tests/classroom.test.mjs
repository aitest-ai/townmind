// 課堂模式：老師密碼、時間倍率、上課計時（真實時間）、安全限制（透過外殼的 policy）、存檔。不改核心。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Engine, createCoreServices, defaultTextFilter } from '../src/core/index.js';
import classroom from '../src/modules/classroom/index.js';
import residents from '../src/modules/residents/index.js';
import { createPolicy } from '../src/shell/policy.js';
import { readPackDir, ROOT } from '../scripts/pack-io.mjs';

const island = await readPackDir(join(ROOT, 'data/worldpacks/island-default'));

function boot(enabled = ['classroom', 'residents'], config = {}) {
  let clock = 1_000_000;
  const policy = createPolicy();
  const banners = [];
  let saves = 0;
  const services = {
    ...createCoreServices(island), policy,
    now: () => clock,
    notify: (t, lv) => { if (lv === 'banner') banners.push(t); },
    save: () => { saves++; return true; },
  };
  // 和外殼一樣：policy 關掉打字時，過濾一律拒絕
  services.textFilter = (t, o) => (policy.get('playerTyping', true) === false ? { ok: false, reason: policy.get('typingReason', '現在不能打字喔') } : defaultTextFilter(t, o));
  const e = new Engine({ data: island, services });
  e.register(classroom).register(residents);
  e.start({ enabled, config: { classroom: { ...island.pack.modules.classroom.config, ...config } } });
  return { e, s: services, policy, banners, saves: () => saves, tick: (ms) => { clock += ms; e.update(0); } };
}

test('世界包設定：一天 12 分鐘；學生最高倍率', () => {
  const { s, policy } = boot();
  assert.equal(s.time.dayLengthSec, 720);
  assert.equal(policy.get('maxSpeed', 99), 4);
  assert.equal(policy.get('playerTimeControl', true), true);
});

test('老師指令要先解鎖；密碼錯太多次會暫停一分鐘；AI 不能用', () => {
  const { e, tick } = boot();
  assert.equal(e.runCommand('classroom.setSpeed', { speed: 2 }).reason, '請先輸入老師密碼');
  for (let i = 0; i < 5; i++) assert.equal(e.runCommand('classroom.unlock', { pin: '9999' }).reason, '密碼不對');
  assert.match(e.runCommand('classroom.unlock', { pin: '0000' }).reason, /密碼錯太多次了/);
  tick(61_000);
  assert.equal(e.runCommand('classroom.unlock', { pin: '0000' }).ok, true);
  assert.equal(e.runCommand('classroom.setSpeed', { speed: 2 }).ok, true);
  assert.equal(e.commands.run('classroom.setSpeed', { speed: 8 }, { source: 'ai', actor: 'afu' }).code, 'NOT_AI');
  assert.equal(e.commands.describeForAI({ actor: 'afu' }).some((c) => c.id.startsWith('classroom.')), false);
  // 15 分鐘沒操作自動鎖上
  tick(16 * 60_000);
  assert.equal(e.runCommand('classroom.lock').reason, '請先輸入老師密碼');
});

test('全班暫停、時間倍率、一天長度、真實時鐘', () => {
  const { e, s } = boot();
  e.runCommand('classroom.unlock', { pin: '0000' });
  e.runCommand('classroom.setSpeed', { speed: 0 });
  assert.equal(s.time.paused, true);
  e.runCommand('classroom.setSpeed', { speed: 4 });
  assert.deepEqual([s.time.paused, s.time.timeScale], [false, 4]);
  e.runCommand('classroom.setDayLength', { minutes: 99 });
  assert.equal(s.time.dayLengthSec, 60 * 60); // 夾在 60 分鐘
  e.runCommand('classroom.setClockMode', { mode: 'real' });
  assert.equal(s.time.mode, 'real');
});

test('上課計時：真實時間、遊戲暫停也照走、5 分鐘前提醒、下課自動暫停並存檔', () => {
  const { e, s, banners, saves, tick } = boot();
  e.runCommand('classroom.unlock', { pin: '0000' });
  assert.equal(e.runCommand('classroom.startLesson', { minutes: '10' }).ok, true); // 輸入框來的字串也可以
  s.time.pause(true); // 遊戲暫停中
  tick(4 * 60_000);
  assert.equal(banners.length, 0);
  assert.match(e.renderPanel('classroom.lesson')[0].value, /^6 分 00 秒/);
  tick(1.5 * 60_000);
  assert.match(banners[0], /還有 5 分鐘下課/);
  s.time.pause(false);
  tick(5 * 60_000);
  assert.match(banners[1], /下課囉/);
  assert.equal(s.time.paused, true);
  assert.equal(saves(), 1);
  assert.equal(e.renderPanel('classroom.lesson')[0].text, '目前沒有上課計時。');
});

test('安全限制：關掉打字時公告被拒並說明；學生不能調時間；關掉模組限制自動解除', () => {
  const { e, policy } = boot();
  assert.equal(e.runCommand('residents.announce', { text: '大家好' }).ok, true);
  e.runCommand('classroom.unlock', { pin: '0000' });
  e.runCommand('classroom.setTyping', { allowed: false });
  e.runCommand('classroom.setStudentTime', { allowed: false });
  e.runCommand('classroom.setSaveControl', { allowed: false });
  const r = e.runCommand('residents.announce', { text: '大家好' });
  assert.equal(r.code, 'TEXT_REJECTED');
  assert.equal(r.reason, '老師暫時關閉了打字');
  assert.equal(policy.get('playerTimeControl', true), false);
  assert.equal(policy.get('playerSaveControl', true), false);
  e.dispose();
  assert.equal(policy.get('playerTyping', true), true);
  assert.equal(policy.get('playerTimeControl', true), true);
});

test('存檔：課堂設定保留、解鎖狀態不保留；離開時已下課就不再提醒', () => {
  const a = boot();
  a.e.runCommand('classroom.unlock', { pin: '0000' });
  a.e.runCommand('classroom.setTyping', { allowed: false });
  a.e.runCommand('classroom.setDayLength', { minutes: 6 });
  a.e.runCommand('classroom.startLesson', { minutes: 1 });
  const save = a.e.serializeAll();
  const b = boot();
  b.e.deserializeAll(save);
  assert.equal(b.policy.get('playerTyping', true), false);
  assert.equal(b.s.time.dayLengthSec, 360);
  assert.equal(b.e.runCommand('classroom.lock').reason, '請先輸入老師密碼');
  assert.ok(b.e._apis.get('classroom').msLeft() > 0);
  const c = boot();
  c.tick(5 * 60_000);
  c.e.deserializeAll(save);
  assert.equal(c.e._apis.get('classroom').msLeft(), 0);
  c.tick(1000);
  assert.equal(c.banners.length, 0);
});

test('沒開課堂模式：沒有任何限制，也沒有老師面板', () => {
  const { e, policy } = boot(['residents']);
  assert.equal(policy.get('playerTyping', true), true);
  assert.equal(e.listPanels().some((p) => p.owner === 'classroom'), false);
});
