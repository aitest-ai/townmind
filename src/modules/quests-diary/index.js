// 小請求與居民日記（quests-diary）：目前先做「居民日記」，小請求之後再加。
//
// 日記怎麼來（完全不呼叫 AI）：
//   - 玩的時候：聽各模組的事件（採集、打招呼、蓋房子、下課……），每天結束時由一位居民寫成一則日記
//   - 離開的時候：外殼讀檔後呼叫 catchUp({ days })，這裡用種子亂數＋世界包的文字模板，替每一天寫一則
//     同一份存檔、同樣的天數，寫出來的日記一定一樣（可重現）
//   - 居民「離線時做了什麼」只從「已啟用模組開放給居民的行動」挑（describeCommandsForAI），
//     所以關掉採集，日記就不會再寫到採集
// 模板在世界包 text.json 的 diary（沒有時用這裡的預設）。{name} 換成居民名字，{catch} 換成口頭禪。
const KEEP_DAYS = 30;
const catchUps = new WeakMap(); // ctx → 離線補算的處理函式（catchUp 拿得到 ctx，拿不到 init 的變數）
const DEFAULT_TEXT = {
  activity: {
    residents: ['{name}在家門口曬太陽，跟路過的小鳥打招呼。', '{name}沿著海邊散步，撿到一顆圓圓的石頭。', '{name}整理了家裡，說：「{catch}」'],
    gathering: ['{name}去森林裡撿了好多樹枝和果子。', '{name}在灌木叢摘了一籃漿果，分給大家吃。'],
    crowd: ['{name}和小幫手們一起搬木頭，大家都很賣力。', '{name}看著新房子的工地，覺得小鎮越來越熱鬧。'],
  },
  weather: ['今天天氣很好，海風涼涼的。', '下了一場小雨，空氣聞起來香香的。', '天空好藍，雲像棉花糖一樣。', '傍晚的夕陽把海面照成橘色的。'],
  missYou: ['大家都在等你回來喔！', '希望你下次來的時候，再一起玩。', '小島一切平安，放心喔。'],
};

export default {
  id: 'quests-diary',
  version: '0.1.0',
  requires: [],
  optional: ['residents'],
  conflicts: [],
  emits: ['quests-diary:written'],
  config: { maxOfflineDays: 7 },

  init(ctx) {
    const { time } = ctx.services;
    const notify = (t, lv) => ctx.services.notify?.(t, lv);
    const text = {
      activity: { ...DEFAULT_TEXT.activity, ...(ctx.data.text?.diary?.activity || {}) },
      weather: ctx.data.text?.diary?.weather?.length ? ctx.data.text.diary.weather : DEFAULT_TEXT.weather,
      missYou: ctx.data.text?.diary?.missYou?.length ? ctx.data.text.diary.missYou : DEFAULT_TEXT.missYou,
    };
    // 居民模組沒開時，日記由「小島」自己寫
    const people = () => { const R = ctx.getModule('residents'); return R ? (ctx.data.residents || []).map((r) => R.get(r.id)).filter(Boolean) : []; };
    let entries = [];       // [{ day, writer, lines, offline }]
    let today = emptyDay(); // 今天發生的事（玩的時候累積）
    let unread = 0;

    function emptyDay() { return { harvest: 0, items: {}, greeted: [], houses: 0, lesson: false }; }
    const fill = (tpl, r) => tpl.replaceAll('{name}', r.name).replaceAll('{catch}', r.card?.catchphrase || '今天也好好過');
    const nameOf = (actor) => (actor === 'player' ? '你' : people().find((r) => r.id === actor)?.name ?? actor);

    function push(entry) {
      entries.push(entry);
      if (entries.length > KEEP_DAYS) entries = entries.slice(-KEEP_DAYS);
      unread++;
      ctx.emit('quests-diary:written', entry);
    }

    // 寫日記的人：輪流（第幾天 → 第幾位），沒有居民時用「小島」
    const writerFor = (day) => { const ps = people(); return ps.length ? ps[(day - 1) % ps.length] : { name: '小島', card: {} }; };

    // 居民離線時可以做的事：只看「已啟用、開放給這位居民」的行動屬於哪些模組
    function activitiesFor(r) {
      const mods = new Set(['residents']);
      if (r.id) for (const c of ctx.describeCommandsForAI({ actor: r.id })) mods.add(c.id.split('.')[0]);
      // 依興趣挑：興趣高的模組比較常出現
      const pool = [];
      for (const m of mods) for (const tpl of text.activity[m] || []) pool.push({ tpl, w: (r.interests?.[m] ?? 1) + 0.2 });
      return pool;
    }
    function pickWeighted(pool) {
      const total = pool.reduce((n, x) => n + x.w, 0);
      let k = ctx.rng.next() * total;
      for (const x of pool) { k -= x.w; if (k <= 0) return x.tpl; }
      return pool[pool.length - 1]?.tpl;
    }

    // 玩的時候：把今天發生的事寫成日記
    function writeLiveDay(day) {
      const w = writerFor(day);
      const lines = [];
      const d = today;
      if (d.harvest) {
        const items = Object.entries(d.items).map(([k, n]) => `${ctx.services.inventory?.itemName(k) ?? k} ${n} 個`).join('、');
        lines.push(`今天大家採集了 ${d.harvest} 次，收穫有${items}。`);
      }
      if (d.greeted.length) lines.push(`你來跟${[...new Set(d.greeted)].join('、')}打招呼，${w.name}覺得好開心。`);
      if (d.houses) lines.push(`小鎮又多了 ${d.houses} 間房子！`);
      if (d.lesson) lines.push('今天的課上完了，大家辛苦了。');
      if (!lines.length) lines.push(fill(ctx.rng.pick(text.weather) + '{name}慢慢地過了一天。', w));
      push({ day, writer: w.name, lines, offline: false });
      today = emptyDay();
    }

    // 離線的那幾天：每天一則
    function writeOfflineDay(day) {
      const w = writerFor(day);
      const lines = [ctx.rng.pick(text.weather)];
      const others = people().filter((r) => r.id !== w.id);
      for (const r of [w, ...others.slice(0, 1 + Math.floor(ctx.rng.next() * 2))]) {
        const pool = activitiesFor(r);
        if (pool.length) lines.push(fill(pickWeighted(pool), r));
      }
      push({ day, writer: w.name, lines, offline: true });
    }

    // ---------- 聽事件（不需要宣告依賴，模組關掉時就自然沒有事件） ----------
    ctx.on('gathering:harvested', (x) => {
      today.harvest++;
      for (const g of x.items || []) today.items[g.item] = (today.items[g.item] || 0) + g.qty;
    });
    ctx.on('residents:greeted', (x) => { const r = people().find((p) => p.id === x.who); if (r) today.greeted.push(r.name); });
    ctx.on('crowd:houseBuilt', () => { today.houses++; });
    ctx.on('classroom:lessonEnded', () => { today.lesson = true; });
    ctx.on('core:dayStarted', (x) => {
      if (x.offline) return; // 離線的天數由 catchUp 一次寫
      writeLiveDay(x.day - 1);
    });

    // ---------- 面板、指令、存檔 ----------
    ctx.registerPanel({
      id: 'quests-diary.diary', title: '居民日記', order: 25,
      view() {
        const recent = entries.slice(-5).reverse();
        if (!recent.length) return [{ type: 'text', text: '還沒有日記。過完一天，居民就會寫下島上發生的事。' }];
        return [
          ...(unread ? [{ type: 'text', text: `📔 有 ${unread} 則新日記` }] : []),
          { type: 'list', items: recent.map((e) => ({ label: `第 ${e.day} 天・${e.writer}${e.offline ? '（你不在的時候）' : ''}`, detail: e.lines.join(' ') })) },
          ...(unread ? [{ type: 'button', label: '看過了', command: 'quests-diary.markRead' }] : []),
        ];
      },
    });
    ctx.registerCommand({ id: 'quests-diary.markRead', label: '看過了', run: () => { unread = 0; return true; } });
    ctx.registerSaveSlice({
      key: 'quests-diary', version: 1,
      serialize: () => ({ entries, today, unread }),
      deserialize(d) {
        entries = Array.isArray(d?.entries) ? d.entries.slice(-KEEP_DAYS) : [];
        today = d?.today && typeof d.today === 'object' ? { ...emptyDay(), ...d.today } : emptyDay();
        unread = Number(d?.unread) || 0;
      },
    });

    // ---------- 離線補算：外殼先 time.skipDays(days)，再呼叫 engine.catchUp({ days }) ----------
    let lastCatchUp = null;
    catchUps.set(ctx, (info) => {
      const days = Math.max(0, Math.min(ctx.config.maxOfflineDays, Math.floor(info?.days ?? 0)));
      if (!days) return [];
      const endDay = time?.day ?? days + 1; // 回來的那一天
      const written = [];
      for (let i = days; i >= 1; i--) { writeOfflineDay(endDay - i); written.push(entries[entries.length - 1]); }
      written[written.length - 1].lines.push(ctx.rng.pick(text.missYou));
      lastCatchUp = { days, entries: written };
      notify(`📔 你離開的這段時間（${days} 天），居民寫了 ${days} 則日記，看看「居民日記」吧！`, 'banner');
      return written;
    });

    return { api: { entries: () => entries.map((e) => ({ ...e, lines: [...e.lines] })), lastCatchUp: () => lastCatchUp, unread: () => unread } };
  },

  catchUp(ctx, info) { catchUps.get(ctx)?.(info); },
};
