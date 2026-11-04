// 耕作（farming）：在田裡播種、澆水、收成；作物依天數長大，受季節影響。沒有失敗：作物不會枯死。
//
// 資料：species.json 的 crop（seed 種子、stages 每階段要幾天、harvest 收成、seasons 可以種的季節）；
//       island.json 的 placements { type: 'plot' } 是田。
// 規則：
//   - 每天開始時，「前一天有澆水」的作物會長大一天（用天數記錄，不管下雨事件先到還是後到都一樣）
//   - 季節來自核心的時間服務（不需要天氣模組）；不適合的季節不能種，會說明哪些季節可以
//   - 天氣模組（weather-seasons）開著且下雨時，所有的田自動澆好水（只聽事件，不依賴天氣模組）
//   - 你不在的時候（離線補算），預設當作有人幫忙澆水（config.offlineGrowth），回來時田裡有進度
//   - 居民（例如農夫阿福）站在田旁邊時，規則腦會建議他幫忙澆水
// 回饋事件 farming:feedback；farming:planted／watered／harvested 給任務計數。
export default {
  id: 'farming',
  version: '0.1.0',
  requires: [],
  optional: ['residents'],
  conflicts: [],
  emits: ['farming:planted', 'farming:watered', 'farming:harvested', 'farming:grown', 'farming:feedback'],
  config: { reach: 2.2, respectSeasons: true, offlineGrowth: true, rainEvent: 'weather-seasons:weatherChanged' },

  init(ctx) {
    const { entities, inventory, time } = ctx.services;
    const crops = (ctx.data.species || []).filter((s) => s.kind === 'crop');
    const cropBySeed = new Map(crops.map((c) => [c.seed, c]));
    const cropById = new Map(crops.map((c) => [c.id, c]));
    const SEASON = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
    const fb = (kind, text, extra = {}) => ctx.emit('farming:feedback', { kind, text, ...extra });
    const today = () => time?.day ?? 1;
    const season = () => time?.season ?? 'spring';

    const empty = () => ({ crop: null, stage: 0, days: 0, wateredDay: null, ready: false });
    const ids = [];
    (ctx.data.island?.placements || []).forEach((p, i) => {
      if (p.type !== 'plot') return;
      const id = `plot.${i}`;
      entities.add({ id, kind: 'plot', owner: 'farming', art: 'plot', x: p.x, y: p.y, label: '田', state: empty() });
      ids.push(id);
    });

    const posOf = (actor) => entities.get(actor === 'player' ? 'player' : `resident.${actor}`);
    const near = (actor, e) => { const p = posOf(actor); return !!p && Math.hypot(p.x - e.x, p.y - e.y) <= ctx.config.reach; };
    const st = (id) => entities.get(id).state;
    const seasonOk = (c) => !ctx.config.respectSeasons || !c.seasons?.length || c.seasons.includes(season());
    const watered = (s) => s.wateredDay === today();
    const stageCount = (c) => c.stages.length;

    // ---------- 指令 ----------
    ctx.registerCommand({
      id: 'farming.plant', label: '播種', description: '在田裡種下種子',
      params: { plot: { type: 'entity', kind: 'plot' }, seed: { type: 'ref', of: 'items' } },
      canRun: ({ plot, seed }, call) => {
        const c = cropBySeed.get(seed);
        if (!c) return '這不是種子';
        if (!near(call.actor, entities.get(plot))) return '走近一點才能種';
        if (st(plot).crop) return '這塊田已經種了東西';
        if (!inventory.has(call.actor, seed)) return `背包裡沒有${inventory.itemName(seed)}`;
        if (!seasonOk(c)) return `${c.name}不適合在${SEASON[season()]}天種，${c.seasons.map((x) => SEASON[x]).join('、')}天才可以`;
        return true;
      },
      run({ plot, seed }, call) {
        const c = cropBySeed.get(seed);
        inventory.remove(call.actor, seed, 1);
        entities.update(plot, { state: { ...empty(), crop: c.id } });
        const e = entities.get(plot);
        ctx.emit('farming:planted', { actor: call.actor, crop: c.id, plot });
        fb('success', `種下了${c.name}，記得每天澆水喔！`, { actor: call.actor, at: { x: e.x, y: e.y }, entity: plot, sound: 'plant' });
        return c.id;
      },
    });
    ctx.registerCommand({
      id: 'farming.water', label: '澆水', description: '幫田裡的作物澆水（每天一次）',
      aiCallable: true,
      params: { plot: { type: 'entity', kind: 'plot', choices: (call) => thirsty(call.actor).map((e) => e.id) } },
      canRun: ({ plot }, call) => {
        const s = st(plot);
        if (!near(call.actor, entities.get(plot))) return '走近一點才能澆水';
        if (!s.crop) return '這塊田還沒種東西';
        if (s.ready) return '已經可以收成了';
        if (watered(s)) return '今天已經澆過水了';
        return true;
      },
      run({ plot }, call) {
        entities.update(plot, { state: { wateredDay: today() } });
        const e = entities.get(plot);
        ctx.emit('farming:watered', { actor: call.actor, plot, crop: e.state.crop });
        fb('success', '澆好水了，明天會長大一點', { actor: call.actor, at: { x: e.x, y: e.y }, entity: plot, sound: 'water', quiet: call.actor !== 'player' });
        return true;
      },
    });
    ctx.registerCommand({
      id: 'farming.harvest', label: '收成', description: '收成成熟的作物',
      params: { plot: { type: 'entity', kind: 'plot' } },
      canRun: ({ plot }, call) => {
        const s = st(plot);
        if (!near(call.actor, entities.get(plot))) return '走近一點才能收成';
        if (!s.crop) return '這塊田還沒種東西';
        if (!s.ready) return '還沒成熟，再等幾天';
        const c = cropById.get(s.crop);
        return c.harvest.some((h) => inventory.room(call.actor, h.item) > 0) ? true : '背包滿了，先整理一下吧';
      },
      run({ plot }, call) {
        const s = st(plot), c = cropById.get(s.crop), e = entities.get(plot);
        const got = [];
        for (const h of c.harvest) { const n = inventory.add(call.actor, h.item, h.qty); if (n) got.push({ item: h.item, qty: n }); }
        entities.update(plot, { state: empty() });
        ctx.emit('farming:harvested', { actor: call.actor, crop: c.id, items: got, plot });
        fb('complete', `收成了！${got.map((g) => `${inventory.itemName(g.item)} ×${g.qty}`).join('、')}`, { actor: call.actor, at: { x: e.x, y: e.y }, entity: plot, sound: 'harvest' });
        return got;
      },
    });

    // 田的互動：依狀態出現「種○○」「澆水」「收成」
    ctx.registerEntityKind('plot', {
      label: '田',
      interactions: [
        ...[...cropBySeed.keys()].map((seed) => ({
          label: () => `種${inventory.itemName(seed)}`, command: 'farming.plant', args: (e) => ({ plot: e.id, seed }),
          when: (e, call) => !e.state.crop && inventory.has(call?.actor ?? 'player', seed),
        })),
        { label: '澆水', command: 'farming.water', args: (e) => ({ plot: e.id }), when: (e) => !!e.state.crop && !e.state.ready },
        { label: (e) => `收成${cropById.get(e.state.crop)?.name ?? ''}`, command: 'farming.harvest', args: (e) => ({ plot: e.id }), when: (e) => e.state.ready },
      ],
    });

    // ---------- 長大 ----------
    function growDay(day, { assumeWatered = false } = {}) {
      let grownNow = 0;
      for (const id of ids) {
        const s = st(id);
        if (!s.crop || s.ready) continue;
        if (!(assumeWatered || s.wateredDay === day - 1)) continue; // 前一天有澆水才長大
        const c = cropById.get(s.crop);
        let { stage, days } = s;
        days += 1;
        if (days >= c.stages[stage].days) { stage += 1; days = 0; }
        const ready = stage >= stageCount(c);
        entities.update(id, { state: { stage: Math.min(stage, stageCount(c) - 1), days, ready } });
        if (ready) { grownNow++; ctx.emit('farming:grown', { plot: id, crop: c.id }); }
      }
      if (grownNow) fb('progress', `田裡有 ${grownNow} 塊作物成熟了，可以收成囉！`, { actor: 'player', sound: 'ready' });
    }
    ctx.on('core:dayStarted', (x) => growDay(x.day, { assumeWatered: x.offline && ctx.config.offlineGrowth }));
    // 下雨：所有種了東西的田自動澆好水（天氣模組沒開時不會有這個事件）
    ctx.on(ctx.config.rainEvent, (x) => {
      if (x?.weather !== 'rain') return;
      for (const id of ids) if (st(id).crop && !st(id).ready) entities.update(id, { state: { wateredDay: today() } });
    });

    // ---------- 給居民的建議：身邊有口渴的田就幫忙澆水 ----------
    function thirsty(actor) {
      const p = posOf(actor);
      if (!p) return [];
      return entities.near(p.x, p.y, ctx.config.reach, { kind: 'plot', filter: (e) => e.state.crop && !e.state.ready && !watered(e.state) });
    }
    ctx.getModule('residents')?.registerAdvisor({
      module: 'farming',
      suggest(r) {
        const t = thirsty(r.id)[0];
        return t ? [{ command: 'farming.water', args: { plot: t.id }, score: 0.5, say: '田裡的作物口渴了，我來澆水！' }] : [];
      },
    });

    // ---------- 面板與 AI 現況 ----------
    const summary = () => {
      const r = { empty: 0, growing: 0, thirsty: 0, ready: 0 };
      for (const id of ids) { const s = st(id); if (!s.crop) r.empty++; else if (s.ready) r.ready++; else { r.growing++; if (!watered(s)) r.thirsty++; } }
      return r;
    };
    ctx.registerPanel({
      id: 'farming.fields', title: '田', order: 45,
      view() {
        const r = summary();
        const seeds = [...cropBySeed.entries()].map(([seed, c]) => `${inventory.itemName(seed)}（${c.seasons?.length ? c.seasons.map((x) => SEASON[x]).join('') : '四季'}）×${inventory.count('player', seed)}`);
        return [
          { type: 'text', text: `現在是${SEASON[season()]}天。走到田旁邊就能播種、澆水、收成。` },
          { type: 'list', items: [
            { label: `空的田：${r.empty} 塊` }, { label: `長大中：${r.growing} 塊（今天還沒澆水 ${r.thirsty} 塊）` }, { label: `可以收成：${r.ready} 塊` },
          ] },
          { type: 'text', text: `種子：${seeds.join('、')}` },
        ];
      },
    });
    ctx.registerAIContext(() => { const r = summary(); return (r.growing + r.ready) ? [`田裡：${r.growing} 塊長大中（${r.thirsty} 塊需要澆水）、${r.ready} 塊可以收成`] : []; });

    ctx.registerSaveSlice({
      key: 'farming', version: 1,
      serialize: () => ({ plots: Object.fromEntries(ids.map((id) => [id, { ...st(id) }])) }),
      deserialize(d) {
        for (const id of ids) {
          const s = d?.plots?.[id];
          entities.update(id, { state: s && (!s.crop || cropById.has(s.crop)) ? { ...empty(), ...s } : empty() });
        }
      },
    });
    return { api: { summary, plot: (id) => ({ ...st(id) }) } };
  },
};
