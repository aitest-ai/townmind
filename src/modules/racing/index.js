// 競速（racing）：第一版——滑板車、世界包定義的賽道、居民當對手、時間挑戰與幽靈重播。無失敗、無傷害。
//
// 怎麼玩：走到起跑門旁邊，選「參加比賽」（和居民比）或「時間挑戰」（和自己的最佳紀錄＝幽靈比）。
//   倒數 3 秒 → 用搖桿或方向鍵控制方向（推多少就多快）→ 依序通過檢查點 → 回到起跑門。
//   撞到岸邊只會可愛地轉圈圈，不會受傷。比賽中外殼暫停一般走路（policy.playerMovement）。
// 公平：
//   - 物理在 sim.js（固定時間步長、沒有亂數），玩家和居民用同一套
//   - 居民對手只能透過受限指令 racing.drive { throttle: 0~100, line: inside|center|outside }（aiCallable），
//     不能改位置、速度或檢查點；以 AI 身分執行，核心會擋掉其他指令
//   - 玩家的輸入每一步都錄下來；時間挑戰的紀錄會用錄下的輸入重跑一次驗證，同樣的輸入一定得到同樣的成績
// 回饋事件 racing:feedback；racing:started／checkpoint／finished 給任務計數。
import { STEP, createRacer, step, replay, quant } from './sim.js';

const COUNTDOWN = 3;
const STYLES = { steady: { throttle: 80, line: 'inside' }, bold: { throttle: 100, line: 'outside' }, calm: { throttle: 70, line: 'center' } };

export default {
  id: 'racing',
  version: '0.1.0',
  requires: [],
  optional: ['residents'],
  conflicts: [],
  emits: ['racing:started', 'racing:checkpoint', 'racing:finished', 'racing:quit', 'racing:feedback'],
  config: { reach: 2.5, aiEvery: 0.4, ghostEvery: 3, maxSeconds: 240 },

  init(ctx) {
    const { entities, time } = ctx.services;
    const isl = ctx.data.island;
    const tracks = (ctx.data.tracks || []).filter((t) => t?.id && t.start && t.checkpoints?.length >= 2);
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const policy = ctx.services.policy;
    const R = ctx.getModule('residents');
    const fb = (kind, text, extra = {}) => ctx.emit('racing:feedback', { kind, text, actor: 'player', ...extra });
    const nameOf = (id) => (id === 'player' ? '你' : R?.get(id)?.name ?? id);
    let records = {}; // trackId → { time, inputs: [[h, t], ...], ghost: [[x, y], ...], start, heading }
    let race = null;

    const walkTile = (x, y) => { const tx = Math.floor(x + 0.5), ty = Math.floor(y + 0.5); return tx >= 0 && ty >= 0 && tx < isl.size.w && ty < isl.size.h && isl.legend[isl.terrain[ty][tx]]?.walkable !== false; };
    const worldFor = (t) => ({
      vehicle: t.vehicle || 'skateboard', laps: t.laps ?? 1,
      checkpoints: [...t.checkpoints, t.start], // 最後回到起跑門
      walkable: walkTile,
      terrainSpeed: (x, y) => { const ch = isl.terrain[Math.floor(y + 0.5)]?.[Math.floor(x + 0.5)]; return t.terrainSpeed?.[ch] ?? 1; },
    });
    const startHeading = (t) => Math.atan2(t.checkpoints[0].y - t.start.y, t.checkpoints[0].x - t.start.x);

    // 起跑門（地圖上）
    for (const t of tracks) entities.add({ id: `race.gate.${t.id}`, kind: 'race_gate', owner: 'racing', art: 'race_gate', ref: t.id, x: t.start.x, y: t.start.y, label: t.name });
    const nearGate = (id) => { const p = entities.get('player'), g = entities.get(`race.gate.${id}`); return p && g && Math.hypot(p.x - g.x, p.y - g.y) <= ctx.config.reach; };
    ctx.registerEntityKind('race_gate', {
      label: '起跑門',
      interactions: [
        { label: (e) => `參加比賽：${e.label}`, command: 'racing.start', args: (e) => ({ track: e.ref, mode: 'race' }) },
        { label: (e) => `時間挑戰：${e.label}`, command: 'racing.start', args: (e) => ({ track: e.ref, mode: 'time' }) },
      ],
    });

    // ---------- 比賽 ----------
    function setupMarkers(t) {
      worldFor(t).checkpoints.forEach((c, i) => entities.add({ id: `race.cp.${i}`, kind: 'checkpoint', owner: 'racing', art: 'checkpoint', x: c.x, y: c.y, state: { index: i, next: i === 0 } }));
    }
    function clearRace() {
      for (const e of entities.byOwner('racing')) if (!e.id.startsWith('race.gate.')) entities.remove(e.id);
      if (race) for (const r of race.racers) if (r.id !== 'player') R?.hold(r.id, false);
      policy?.set('racing', 'playerMovement', null);
      race = null;
    }

    function start(trackId, mode) {
      const t = byId.get(trackId), world = worldFor(t), h0 = startHeading(t);
      const rivals = mode === 'race' && R ? (t.rivals?.length ? t.rivals : (ctx.data.residents || []).slice(0, 2).map((r) => r.id)).filter((id) => R.get(id)) : [];
      // 起跑線上排好：玩家在中間，對手在兩側
      const side = { x: -Math.sin(h0), y: Math.cos(h0) };
      const lane = (i) => ({ x: quant(t.start.x + side.x * (i === 0 ? 0 : i % 2 ? 0.9 : -0.9), 1000), y: quant(t.start.y + side.y * (i === 0 ? 0 : i % 2 ? 0.9 : -0.9), 1000) });
      const racers = ['player', ...rivals].map((id, i) => { const p = lane(i); return createRacer(id, walkTile(p.x, p.y) ? p : t.start, h0); });
      race = { track: t, mode, world, racers, acc: 0, countdown: COUNTDOWN, lastCount: COUNTDOWN + 1, inputs: [], ghost: [], aiAcc: 0, aiPlan: {}, places: [], startPos: { ...racers[0] }, h0 };
      for (const r of racers) entities.move(r.id === 'player' ? 'player' : `resident.${r.id}`, r.x, r.y);
      for (const id of rivals) { R.hold(id, true); race.aiPlan[id] = { throttle: 0, line: 'center' }; }
      policy?.set('racing', 'playerMovement', false);
      setupMarkers(t);
      const rec = records[t.id];
      if (mode === 'time' && rec?.ghost?.length) entities.add({ id: 'race.ghost', kind: 'ghost', owner: 'racing', art: 'ghost', x: rec.ghost[0][0], y: rec.ghost[0][1], label: '最佳紀錄' });
      ctx.emit('racing:started', { actor: 'player', track: t.id, mode, rivals });
      fb('progress', mode === 'race' ? `${t.name}：和${rivals.map(nameOf).join('、') || '自己'}比賽！準備……` : `${t.name}：時間挑戰！${rec ? `最佳紀錄 ${rec.time.toFixed(1)} 秒` : ''}`, { sound: 'ready' });
    }

    // 玩家的輸入：螢幕方向 → 地圖方向（3D 鏡頭轉了也一樣）
    function playerInput() {
      const v = ctx.services.input?.vector?.() ?? { x: 0, y: 0 };
      const a = ctx.services.input?.cameraAngle?.() ?? 0;
      const wx = Math.cos(a) * v.x + Math.sin(a) * v.y, wy = -Math.sin(a) * v.x + Math.cos(a) * v.y;
      const len = Math.min(1, Math.hypot(wx, wy));
      return len < 0.05 ? { heading: race.racers[0].heading, throttle: 0 } : { heading: Math.atan2(wy, wx), throttle: len };
    }
    // 居民對手的輸入：只由 racing.drive 決定的 throttle 與 line，方向由同一套規則算（朝下一個檢查點的內／中／外線）
    function rivalInput(r) {
      const plan = race.aiPlan[r.id];
      const cps = race.world.checkpoints, cp = cps[r.next] ?? cps[0];
      const nxt = cps[(r.next + 1) % cps.length];
      const off = plan.line === 'inside' ? -0.6 : plan.line === 'outside' ? 0.6 : 0;
      const dir = Math.atan2(nxt.y - cp.y, nxt.x - cp.x);
      const tx = cp.x - Math.sin(dir) * off, ty = cp.y + Math.cos(dir) * off;
      return { heading: Math.atan2(ty - r.y, tx - r.x), throttle: plan.throttle / 100 };
    }
    // 居民的「比賽腦」（規則）：依個性選油門和路線，透過受限指令下決定
    const styleOf = (id) => { const keys = Object.keys(STYLES); let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return STYLES[keys[h % keys.length]]; };
    function rivalsThink() {
      for (const r of race.racers) {
        if (r.id === 'player' || r.finished) continue;
        const s = styleOf(r.id);
        const behind = race.racers[0].next + race.racers[0].lap * 99 > r.next + r.lap * 99;
        ctx.runCommand('racing.drive', { throttle: behind ? Math.min(100, s.throttle + 10) : s.throttle, line: s.line }, { as: 'ai', actor: r.id });
      }
    }

    function finishRacer(r) {
      race.places.push(r.id);
      const place = race.places.length;
      if (r.id !== 'player') return;
      const t = race.track;
      const inputs = race.inputs.slice(0, r.ticks);
      const verified = replay(race.world, race.startPos, race.h0, inputs); // 用錄下的輸入重跑一次驗證
      const old = records[t.id];
      const ok = verified !== null && Math.abs(verified - r.time) < 1e-6;
      const isRecord = ok && (!old || r.time < old.time);
      if (isRecord) records[t.id] = { time: r.time, inputs, ghost: race.ghost.slice(), start: { x: race.startPos.x, y: race.startPos.y }, heading: race.h0 };
      ctx.emit('racing:finished', { actor: 'player', track: t.id, mode: race.mode, place, time: r.time, record: isRecord, verified: ok });
      const msg = race.mode === 'race' ? `${place === 1 ? '🥇 第 1 名！' : `第 ${place} 名！`}用了 ${r.time.toFixed(1)} 秒` : `完成！${r.time.toFixed(1)} 秒`;
      fb('complete', msg, { sound: place === 1 ? 'win' : 'finish' });
      if (isRecord) fb('unlock', `新紀錄：${r.time.toFixed(1)} 秒！`, { sound: 'record' });
    }

    function tick() {
      // 倒數
      if (race.countdown > 0) {
        race.countdown = Math.max(0, quant(race.countdown - STEP, 1000));
        const c = Math.ceil(race.countdown);
        if (c < race.lastCount) { race.lastCount = c; fb('progress', c > 0 ? `${c}` : '出發！', { quiet: false, sound: c > 0 ? 'beep' : 'go' }); }
        return;
      }
      race.aiAcc += STEP;
      if (race.aiAcc >= ctx.config.aiEvery) { race.aiAcc = 0; rivalsThink(); }
      for (const r of race.racers) {
        if (r.finished) continue;
        const before = r.next;
        let input;
        if (r.id === 'player') { input = playerInput(); race.inputs.push([Math.round(input.heading * 100), Math.round(input.throttle * 100)]); }
        else input = rivalInput(r);
        const wasSpin = r.spin;
        step(r, r.id === 'player' ? { heading: race.inputs.at(-1)[0] / 100, throttle: race.inputs.at(-1)[1] / 100 } : input, race.world);
        if (r.spin > 0 && !wasSpin && r.id === 'player') fb('fail', '撞到岸邊，轉圈圈～', { sound: 'boing', quiet: false });
        entities.move(r.id === 'player' ? 'player' : `resident.${r.id}`, r.x, r.y);
        if (r.next !== before && r.id === 'player') {
          ctx.emit('racing:checkpoint', { actor: 'player', track: race.track.id, index: before });
          for (const e of entities.byKind('checkpoint')) entities.update(e.id, { state: { next: e.state.index === r.next } });
        }
        if (r.finished) finishRacer(r);
      }
      const p = race.racers[0];
      if (race.mode === 'time' && p.ticks % ctx.config.ghostEvery === 0) race.ghost.push([quant(p.x, 100), quant(p.y, 100)]);
      // 幽靈：照最佳紀錄的位置走
      const g = entities.get('race.ghost'), rec = records[race.track.id];
      if (g && rec) { const i = Math.min(rec.ghost.length - 1, Math.floor(p.ticks / ctx.config.ghostEvery)); entities.move('race.ghost', rec.ghost[i][0], rec.ghost[i][1]); }
      if (p.finished || p.time > ctx.config.maxSeconds) {
        if (!p.finished) fb('progress', '時間到了，下次再挑戰吧！');
        const t = race.track.id;
        clearRace();
        return t;
      }
      return null;
    }

    ctx.registerSystem({
      id: 'racing.tick', order: 30,
      update(dt) {
        if (!race || !(dt > 0)) return;
        race.acc += Math.min(dt, 0.25);
        while (race && race.acc >= STEP) { race.acc -= STEP; tick(); }
      },
    });

    // ---------- 指令 ----------
    ctx.registerCommand({
      id: 'racing.start', label: '開始比賽', params: { track: { type: 'ref', of: 'tracks' }, mode: { type: 'enum', values: ['race', 'time'], default: 'race' } },
      canRun: ({ track }) => (race ? '比賽進行中' : nearGate(track) ? true : '走到起跑門旁邊才能開始'),
      run: ({ track, mode }) => { start(track, mode); return true; },
    });
    ctx.registerCommand({
      id: 'racing.quit', label: '離開比賽', available: () => (race ? true : '現在沒有在比賽'),
      run: () => { const t = race.track.id; clearRace(); ctx.emit('racing:quit', { actor: 'player', track: t }); fb('progress', '離開比賽了，下次再來！'); return true; },
    });
    // 居民對手唯一能用的指令：只能選油門（0~100）和路線，不能改位置、速度或檢查點
    ctx.registerCommand({
      id: 'racing.drive', label: '比賽駕駛', description: '比賽中選擇油門和路線（只有比賽中的對手能用）', aiCallable: true,
      params: { throttle: { type: 'int', min: 0, max: 100, clamp: true }, line: { type: 'enum', values: ['inside', 'center', 'outside'] } },
      available: (call) => (race && race.racers.some((r) => r.id === call.actor && r.id !== 'player') ? true : '只有比賽中的對手能用'),
      run({ throttle, line }, call) { race.aiPlan[call.actor] = { throttle, line }; return true; },
    });

    // ---------- 面板 ----------
    ctx.registerPanel({
      id: 'racing.hud', title: '比賽中', order: 2, placement: 'hud',
      view() {
        if (!race) return [];
        const p = race.racers[0], n = race.world.checkpoints.length;
        const rank = race.racers.filter((r) => r.lap * 99 + r.next > p.lap * 99 + p.next || (r.finished && !p.finished)).length + 1;
        return [
          { type: 'text', text: race.countdown > 0 ? `倒數 ${Math.ceil(race.countdown)}…` : `檢查點 ${p.next}/${n}${race.world.laps > 1 ? `　第 ${p.lap + 1}/${race.world.laps} 圈` : ''}　${p.time.toFixed(1)} 秒${race.mode === 'race' && race.racers.length > 1 ? `　第 ${rank} 名` : ''}` },
          { type: 'button', label: '離開比賽', command: 'racing.quit' },
        ];
      },
    });
    ctx.registerPanel({
      id: 'racing.tracks', title: '競速', order: 60,
      view() {
        return [
          { type: 'text', text: '走到起跑門旁邊就能開始。用搖桿或方向鍵控制方向，推越多越快；撞到岸邊會轉圈圈，不會受傷。' },
          ...tracks.map((t) => ({ type: 'buttons', items: [
            { type: 'button', label: `參加比賽：${t.name}`, command: 'racing.start', args: { track: t.id, mode: 'race' } },
            { type: 'button', label: `時間挑戰${records[t.id] ? `（最佳 ${records[t.id].time.toFixed(1)} 秒）` : ''}`, command: 'racing.start', args: { track: t.id, mode: 'time' } },
          ] })),
        ];
      },
    });

    ctx.registerSaveSlice({
      key: 'racing', version: 1,
      serialize: () => ({ records: JSON.parse(JSON.stringify(records)) }), // 進行中的比賽不存（讀檔時重新開始比較好玩）
      deserialize(d) {
        records = {};
        for (const [id, r] of Object.entries(d?.records || {})) if (byId.has(id) && Number.isFinite(r?.time)) records[id] = r;
      },
    });
    return { api: {
      racing: () => !!race,
      state: () => (race ? { mode: race.mode, countdown: race.countdown, racers: race.racers.map((r) => ({ ...r })) } : null),
      record: (id) => (records[id] ? { ...records[id] } : null),
      replay: (id, inputs) => { const t = byId.get(id); const rec = records[id]; return replay(worldFor(t), rec?.start ?? t.start, rec?.heading ?? startHeading(t), inputs); },
      _step: tick, // 測試用：手動推進一步
    } };
  },
};
