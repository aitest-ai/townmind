// 好感度與送禮（social）：和居民的好感度、送禮、居民的小請求。只用規則與範本，不接 AI。
//
// 好感度：每天第一次打招呼 +2；送禮 +4（居民喜歡的東西 +10）；完成小請求 +8。每位居民每天只收一次禮物。
// 小請求：每天早上，每位居民有機會提出一個小請求（要幾個某樣東西），兩天內完成都可以，沒完成也沒關係（不會扣好感度）。
// 升級：好感度到某一級時發 social:levelUp；social.json 的等級可以設定 flag，會用任務模組的旗標解鎖東西（例如居民教你新配方）。
// 回饋事件 social:feedback；social:gifted／requestPosted／requestDone／levelUp 給任務計數。
const DEFAULT_LEVELS = [
  { points: 0, name: '點頭之交' }, { points: 20, name: '朋友' }, { points: 50, name: '好朋友' }, { points: 100, name: '好麻吉' }, { points: 180, name: '最好的朋友' },
];
const DEFAULT_TEXT = {
  request: ['{name}想要 {qty} 個{item}，可以幫忙嗎？', '{name}說：「如果有 {qty} 個{item}就太好了！」'],
  thanks: ['謝謝你！{name}好開心！', '{name}笑得好燦爛：「你真是好朋友！」'],
  liked: ['哇！這是我最喜歡的{item}！', '{item}！你怎麼知道我喜歡這個？'],
  normal: ['謝謝你送我{item}！', '是{item}耶，謝謝！'],
  tooMuch: ['今天已經收過禮物了，明天再送吧！'],
};

export default {
  id: 'social',
  version: '0.1.0',
  requires: ['residents'],
  optional: ['quests'],
  conflicts: [],
  emits: ['social:gifted', 'social:requestPosted', 'social:requestDone', 'social:requestExpired', 'social:levelUp', 'social:feedback'],
  config: { reach: 2.2, greetPoints: 2, giftPoints: 4, likedPoints: 10, requestPoints: 8, requestChance: 0.35, requestDays: 2, maxRequests: 2 },

  init(ctx) {
    const { inventory, entities, time } = ctx.services;
    const R = ctx.getModule('residents');
    const data = ctx.data.social && typeof ctx.data.social === 'object' ? ctx.data.social : {};
    const levels = data.levels?.length ? data.levels : DEFAULT_LEVELS;
    const text = { ...DEFAULT_TEXT, ...(data.text || {}) };
    const items = new Map((ctx.data.items || []).map((x) => [x.id, x]));
    const residents = (ctx.data.residents || []).map((r) => r.id);
    const cfg = ctx.config;
    const fb = (kind, txt, extra = {}) => ctx.emit('social:feedback', { kind, text: txt, actor: 'player', ...extra });
    const today = () => time?.day ?? 1;
    const fill = (tpl, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), tpl);
    const nameOf = (id) => R.get(id)?.name ?? id;
    const at = (id) => { const e = entities.get(`resident.${id}`); return e ? { x: e.x, y: e.y } : undefined; };

    let st = { points: {}, greetedDay: {}, giftDay: {}, requests: [] }; // requests: [{ who, item, qty, day }]
    const pts = (id) => st.points[id] ?? 0;
    const levelOf = (p) => { let i = 0; levels.forEach((l, k) => { if (p >= l.points) i = k; }); return i; };

    function addPoints(id, n, why) {
      const before = levelOf(pts(id));
      st.points[id] = pts(id) + n;
      const after = levelOf(pts(id));
      if (after > before) {
        const lv = levels[after];
        ctx.emit('social:levelUp', { who: id, level: after, name: lv.name });
        fb('unlock', `你和${nameOf(id)}變成「${lv.name}」了！`, { who: id, at: at(id), sound: 'friend' });
        if (lv.flag) ctx.getModule('quests')?.setFlag(lv.flag.replaceAll('{id}', id));
      } else if (why) fb('success', `${why}（${nameOf(id)}的好感度 +${n}）`, { who: id, at: at(id), quiet: true });
    }

    // ---------- 打招呼 ----------
    ctx.on('residents:greeted', ({ who }) => {
      if (st.greetedDay[who] === today()) return;
      st.greetedDay[who] = today();
      addPoints(who, cfg.greetPoints, '打招呼');
    });

    // ---------- 送禮 ----------
    const posOf = () => entities.get('player');
    const near = (who) => { const p = posOf(), e = entities.get(`resident.${who}`); return p && e && Math.hypot(p.x - e.x, p.y - e.y) <= cfg.reach; };
    const giftable = (item) => items.has(item) && items.get(item).category !== 'tool';
    const likes = (who) => (ctx.data.residents || []).find((r) => r.id === who)?.likes ?? [];
    ctx.registerCommand({
      id: 'social.gift', label: '送禮', description: '送一樣東西給身邊的居民',
      params: { who: { type: 'ref', of: 'residents' }, item: { type: 'ref', of: 'items' } },
      canRun: ({ who, item }, call) => {
        if (!near(who)) return '走近一點才能送禮';
        if (!giftable(item)) return '工具不能送人喔';
        if (!inventory.has(call.actor, item)) return `背包裡沒有${inventory.itemName(item)}`;
        if (st.giftDay[who] === today()) return `${nameOf(who)}今天已經收過禮物了，明天再送吧`;
        return true;
      },
      run({ who, item }, call) {
        inventory.remove(call.actor, item, 1);
        st.giftDay[who] = today();
        const liked = likes(who).includes(item);
        const line = fill(ctx.rng.pick(liked ? text.liked : text.normal), { item: inventory.itemName(item), name: nameOf(who) });
        R.say(who, line);
        ctx.emit('social:gifted', { actor: call.actor, who, item, liked });
        fb('success', liked ? `${nameOf(who)}超喜歡！❤️` : `${nameOf(who)}收下了禮物`, { who, at: at(who), sound: liked ? 'love' : 'gift' });
        addPoints(who, liked ? cfg.likedPoints : cfg.giftPoints);
        return { liked };
      },
    });

    // ---------- 小請求 ----------
    const reqOf = (who) => st.requests.find((r) => r.who === who);
    function postRequests(day) {
      // 過期的請求：安靜地拿掉（沒有懲罰）
      for (const r of [...st.requests]) if (day - r.day >= cfg.requestDays) { st.requests = st.requests.filter((x) => x !== r); ctx.emit('social:requestExpired', { who: r.who }); }
      const pool = (who) => [...new Set([...likes(who), ...(data.requestItems || ['wood', 'apple', 'berry', 'stone', 'shell'])])].filter((it) => items.has(it) && giftable(it));
      for (const who of residents) {
        if (st.requests.length >= cfg.maxRequests) break;
        if (reqOf(who) || !ctx.rng.chance(cfg.requestChance)) continue;
        const choices = pool(who);
        if (!choices.length) continue;
        const item = ctx.rng.pick(choices), qty = ctx.rng.int(1, 3);
        st.requests.push({ who, item, qty, day });
        const line = fill(ctx.rng.pick(text.request), { name: nameOf(who), qty, item: inventory.itemName(item) });
        ctx.emit('social:requestPosted', { who, item, qty });
        fb('progress', line, { who, at: at(who) });
      }
    }
    let first = true;
    ctx.registerSystem({ id: 'social.first', order: 0, update() { if (first) { first = false; if (!st.requests.length) postRequests(today()); } } });
    ctx.on('core:dayStarted', (x) => { first = false; postRequests(x.day); });

    ctx.registerCommand({
      id: 'social.fulfill', label: '完成小請求', params: { who: { type: 'ref', of: 'residents' } },
      canRun: ({ who }, call) => {
        const r = reqOf(who);
        if (!r) return `${nameOf(who)}現在沒有請求`;
        if (!near(who)) return '走近一點';
        return inventory.has(call.actor, r.item, r.qty) ? true : `還需要 ${r.qty - inventory.count(call.actor, r.item)} 個${inventory.itemName(r.item)}`;
      },
      run({ who }, call) {
        const r = reqOf(who);
        inventory.remove(call.actor, r.item, r.qty);
        st.requests = st.requests.filter((x) => x !== r);
        R.say(who, fill(ctx.rng.pick(text.thanks), { name: nameOf(who) }));
        ctx.emit('social:requestDone', { actor: call.actor, who, item: r.item, qty: r.qty });
        fb('complete', `完成了${nameOf(who)}的小請求！`, { who, at: at(who), sound: 'reward' });
        addPoints(who, cfg.requestPoints);
        return true;
      },
    });
    // 居民身上的互動：有請求時出現「交給○○ N 個△△」

    // ---------- 面板 ----------
    ctx.registerPanel({
      id: 'social.friends', title: '好朋友', order: 22,
      view() {
        const p = posOf();
        const nearby = residents.filter((id) => near(id));
        const gifts = inventory.list('player').filter((s) => giftable(s.item));
        const out = [{ type: 'list', items: residents.map((id) => {
          const lv = levels[levelOf(pts(id))], next = levels[levelOf(pts(id)) + 1];
          const r = reqOf(id);
          return { label: `${nameOf(id)}：${lv.name}${next ? `（${pts(id)}/${next.points}）` : ''}`, detail: r ? `📝 想要 ${r.qty} 個${inventory.itemName(r.item)}` : '' };
        }) }];
        if (!p || !nearby.length) { out.push({ type: 'text', text: '走到居民身邊，就可以送禮或完成小請求。' }); return out; }
        const who = nearby[0];
        const r = reqOf(who);
        if (r) out.push({ type: 'button', label: `交給${nameOf(who)} ${r.qty} 個${inventory.itemName(r.item)}`, command: 'social.fulfill', args: { who }, primary: true });
        if (gifts.length) out.push({ type: 'buttons', items: gifts.slice(0, 8).map((s) => ({ type: 'button', label: `送${nameOf(who)}${s.name}${likes(who).includes(s.item) ? ' ❤️' : ''}`, command: 'social.gift', args: { who, item: s.item } })) });
        return out;
      },
    });
    ctx.registerAIContext(() => st.requests.length ? [`居民的小請求：${st.requests.map((r) => `${nameOf(r.who)}想要 ${r.qty} 個${inventory.itemName(r.item)}`).join('；')}`] : []);

    ctx.registerSaveSlice({
      key: 'social', version: 1,
      serialize: () => JSON.parse(JSON.stringify(st)),
      deserialize(d) {
        st = { points: { ...(d?.points || {}) }, greetedDay: { ...(d?.greetedDay || {}) }, giftDay: { ...(d?.giftDay || {}) }, requests: Array.isArray(d?.requests) ? d.requests.filter((r) => items.has(r.item)) : [] };
        first = false;
      },
    });
    return { api: { points: pts, level: (id) => levelOf(pts(id)), levelName: (id) => levels[levelOf(pts(id))].name, requests: () => st.requests.map((r) => ({ ...r })) } };
  },
};
