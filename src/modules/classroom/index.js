// 課堂模式（classroom）：時間倍率、上課計時、教師控制台、課堂用的安全限制。
//
// 不需要修改核心：
//   - 時間：直接用核心的時間服務（setDayLength、setTimeScale、pause、setMode）
//   - 限制：透過外殼提供的 ctx.services.policy 設定（學生能不能調速度、最高倍率、能不能打字、能不能開新遊戲／匯入存檔）
//     模組關掉時，外殼會自動清掉它設定的限制
//   - 上課計時用真實時間（ctx.services.now），遊戲暫停時也照走（外殼暫停時仍以 dt=0 呼叫系統）
// 老師密碼在世界包 pack.json 的 modules.classroom.config.teacherPin（預設 0000，請記得改）。
const MIN = 60 * 1000;

export default {
  id: 'classroom',
  version: '0.1.0',
  requires: [],
  optional: [],
  conflicts: [],
  emits: ['classroom:lessonStarted', 'classroom:lessonWarning', 'classroom:lessonEnded', 'classroom:settingsChanged'],
  config: {
    dayLengthMinutes: 12, teacherPin: '0000', lessonMinutes: 40, warnMinutes: 5,
    autoLockMinutes: 15, maxStudentSpeed: 4, studentTime: true, typing: true, studentSaveControl: true,
  },

  init(ctx) {
    const { time, policy } = ctx.services;
    const notify = (t, lv) => ctx.services.notify?.(t, lv);
    const now = () => ctx.services.now?.() ?? Date.now();
    const cfg = ctx.config;
    const st = {
      dayLengthMinutes: cfg.dayLengthMinutes, studentTime: cfg.studentTime, maxSpeed: cfg.maxStudentSpeed,
      typing: cfg.typing, studentSaveControl: cfg.studentSaveControl, clockMode: 'game',
      lesson: null, // { endsAt, minutes, warned }
    };
    let unlockedUntil = 0, wrong = 0, blockedUntil = 0;

    function apply() {
      time?.setDayLength(st.dayLengthMinutes * 60);
      time?.setMode(st.clockMode);
      policy?.set('classroom', 'playerTimeControl', st.studentTime);
      policy?.set('classroom', 'maxSpeed', st.maxSpeed);
      policy?.set('classroom', 'playerTyping', st.typing);
      policy?.set('classroom', 'typingReason', st.typing ? null : '老師暫時關閉了打字');
      policy?.set('classroom', 'playerSaveControl', st.studentSaveControl);
      if (time && time.timeScale > st.maxSpeed) time.setTimeScale(st.maxSpeed);
    }
    apply();

    const unlocked = () => now() < unlockedUntil;
    const touch = () => { if (unlocked()) unlockedUntil = now() + cfg.autoLockMinutes * MIN; };
    const teacherOnly = () => (unlocked() ? true : '請先輸入老師密碼');
    const changed = (what) => { touch(); apply(); ctx.emit('classroom:settingsChanged', { what }); };
    const left = () => (st.lesson ? Math.max(0, st.lesson.endsAt - now()) : 0);

    // ---------- 上課計時 ----------
    ctx.registerSystem({
      id: 'classroom.lesson', order: 1,
      update() {
        const L = st.lesson;
        if (!L) return;
        const ms = L.endsAt - now();
        if (!L.warned && ms <= cfg.warnMinutes * MIN && ms > 0) {
          L.warned = true;
          notify(`⏰ 還有 ${Math.ceil(ms / MIN)} 分鐘下課，記得把手上的事情做完喔！`, 'banner');
          ctx.emit('classroom:lessonWarning', { msLeft: ms });
        }
        if (ms <= 0) {
          st.lesson = null;
          time?.pause(true);
          notify('🔔 下課囉！今天辛苦了，小島會幫你存好。', 'banner');
          ctx.emit('classroom:lessonEnded', {});
          ctx.services.save?.();
        }
      },
    });

    // ---------- 老師指令（都不開放給 AI） ----------
    const cmd = (id, label, params, run, extra = {}) => ctx.registerCommand({ id: `classroom.${id}`, label, params, available: teacherOnly, run, ...extra });
    ctx.registerCommand({
      id: 'classroom.unlock', label: '解鎖老師控制台', description: '輸入老師密碼',
      params: { pin: { type: 'string', maxLen: 12 } },
      canRun: ({ pin }) => {
        if (now() < blockedUntil) return `密碼錯太多次了，請 ${Math.ceil((blockedUntil - now()) / 1000)} 秒後再試`;
        return String(pin).trim() === String(cfg.teacherPin) ? true : '密碼不對';
      },
      run() { wrong = 0; unlockedUntil = now() + cfg.autoLockMinutes * MIN; notify('🔓 老師控制台已解鎖'); return true; },
    });
    // 密碼錯誤次數：用 core:commandRun 監聽被拒的 unlock
    ctx.on('core:commandRun', (x) => {
      if (x.id === 'classroom.unlock' && !x.ok && x.code === 'REFUSED' && now() >= blockedUntil) {
        wrong++;
        if (wrong >= 5) { wrong = 0; blockedUntil = now() + MIN; }
      }
    });
    cmd('lock', '鎖上控制台', {}, () => { unlockedUntil = 0; notify('🔒 老師控制台已鎖上'); return true; });
    cmd('setSpeed', '設定時間速度', { speed: { type: 'int', min: 0, max: 8, clamp: true } }, ({ speed }) => {
      time?.pause(speed === 0); if (speed > 0) time?.setTimeScale(speed); touch(); return speed;
    });
    cmd('setStudentTime', '學生能否調時間', { allowed: { type: 'bool' } }, ({ allowed }) => { st.studentTime = allowed; changed('studentTime'); return allowed; });
    cmd('setMaxSpeed', '學生最高倍率', { speed: { type: 'int', min: 1, max: 8, clamp: true } }, ({ speed }) => { st.maxSpeed = speed; changed('maxSpeed'); return speed; });
    cmd('setTyping', '學生能否打字', { allowed: { type: 'bool' } }, ({ allowed }) => { st.typing = allowed; changed('typing'); notify(allowed ? '⌨️ 已開放打字' : '⌨️ 已暫時關閉打字'); return allowed; });
    cmd('setSaveControl', '學生能否開新遊戲／匯入', { allowed: { type: 'bool' } }, ({ allowed }) => { st.studentSaveControl = allowed; changed('saveControl'); return allowed; });
    cmd('setDayLength', '一天的長度', { minutes: { type: 'int', min: 2, max: 60, clamp: true } }, ({ minutes }) => { st.dayLengthMinutes = minutes; changed('dayLength'); notify(`🕒 一天的長度改成 ${minutes} 分鐘`); return minutes; });
    cmd('setClockMode', '時鐘模式', { mode: { type: 'enum', values: ['game', 'real'] } }, ({ mode }) => { st.clockMode = mode; changed('clockMode'); return mode; });
    cmd('startLesson', '開始上課計時', { minutes: { type: 'int', min: 1, max: 120, clamp: true } }, ({ minutes }) => {
      st.lesson = { endsAt: now() + minutes * MIN, minutes, warned: minutes <= cfg.warnMinutes };
      time?.pause(false);
      touch();
      notify(`📚 開始上課：${minutes} 分鐘`);
      ctx.emit('classroom:lessonStarted', { minutes });
      return minutes;
    });
    cmd('stopLesson', '停止上課計時', {}, () => { st.lesson = null; touch(); notify('📚 上課計時已停止'); return true; });

    // ---------- 面板 ----------
    ctx.registerPanel({
      id: 'classroom.lesson', title: '上課時間', order: 1,
      view() {
        if (!st.lesson) return [{ type: 'text', text: '目前沒有上課計時。' }];
        const ms = left();
        return [
          { type: 'stat', label: '這節課還剩', value: `${Math.floor(ms / MIN)} 分 ${String(Math.floor((ms % MIN) / 1000)).padStart(2, '0')} 秒` },
          { type: 'bar', label: '', value: ms / (st.lesson.minutes * MIN) },
        ];
      },
    });
    const yesNo = (cmdId, label, on) => ({ type: 'buttons', items: [
      { type: 'button', label: `${label}：開`, command: cmdId, args: { allowed: true }, primary: on },
      { type: 'button', label: `${label}：關`, command: cmdId, args: { allowed: false }, primary: !on },
    ] });
    ctx.registerPanel({
      id: 'classroom.teacher', title: '老師控制台', order: 980,
      view() {
        if (!unlocked()) {
          return [
            { type: 'text', text: '這裡是給老師用的設定。' },
            { type: 'input', name: 'pin', label: '老師密碼', maxLen: 12 },
            { type: 'button', label: '解鎖', command: 'classroom.unlock', argsFrom: { pin: 'pin' } },
          ];
        }
        return [
          { type: 'text', text: `已解鎖（${cfg.autoLockMinutes} 分鐘沒操作會自動鎖上）。` },
          { type: 'input', name: 'lessonMin', label: '上課幾分鐘', maxLen: 3, placeholder: String(cfg.lessonMinutes) },
          { type: 'buttons', items: [
            { type: 'button', label: '開始上課計時', command: 'classroom.startLesson', args: { minutes: cfg.lessonMinutes }, argsFrom: { minutes: 'lessonMin' }, primary: true },
            { type: 'button', label: '停止計時', command: 'classroom.stopLesson' },
          ] },
          { type: 'buttons', items: [0, 1, 2, 4].map((k) => ({ type: 'button', label: k === 0 ? '全班暫停' : `時間 ${k} 倍`, command: 'classroom.setSpeed', args: { speed: k }, primary: k === 0 ? time?.paused : !time?.paused && time?.timeScale === k })) },
          { type: 'input', name: 'dayMin', label: `一天幾分鐘（目前 ${st.dayLengthMinutes}）`, maxLen: 2 },
          { type: 'button', label: '設定一天的長度', command: 'classroom.setDayLength', argsFrom: { minutes: 'dayMin' } },
          { type: 'buttons', items: [
            { type: 'button', label: '遊戲時鐘', command: 'classroom.setClockMode', args: { mode: 'game' }, primary: st.clockMode === 'game' },
            { type: 'button', label: '真實時鐘', command: 'classroom.setClockMode', args: { mode: 'real' }, primary: st.clockMode === 'real' },
          ] },
          yesNo('classroom.setStudentTime', '學生調時間', st.studentTime),
          yesNo('classroom.setTyping', '學生打字', st.typing),
          yesNo('classroom.setSaveControl', '學生開新遊戲／匯入', st.studentSaveControl),
          { type: 'button', label: '鎖上控制台', command: 'classroom.lock' },
        ];
      },
    });

    // ---------- 存檔（解鎖狀態不存：重新整理後一定是鎖上的） ----------
    ctx.registerSaveSlice({
      key: 'classroom', version: 1,
      serialize: () => ({ ...st, lesson: st.lesson ? { ...st.lesson } : null }),
      deserialize(d) {
        for (const k of ['dayLengthMinutes', 'studentTime', 'maxSpeed', 'typing', 'studentSaveControl', 'clockMode']) if (d?.[k] !== undefined) st[k] = d[k];
        st.lesson = d?.lesson && d.lesson.endsAt > now() ? d.lesson : null; // 離開時已經下課：不再提醒
        apply();
      },
    });

    return { api: { isUnlocked: unlocked, settings: () => ({ ...st }), msLeft: left } };
  },
};
