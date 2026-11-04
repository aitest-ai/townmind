// 捕捉（capture）：釣魚、捕蟲、拍照，以及圖鑑。呈現方式由世界包決定，兒童版只允許不呈現傷害的方式。
//
// 資料：species.json 的 animal／fish／bug：capture.methods [{ tool, presentation }]、capture.reward、seasons（選填）
//       island.json 的 regions[].spawns [{ ref, weight }]：牠們會在哪個區域出現（魚會出現在區域裡靠岸的水面）
// 呈現方式：
//   collect       收集：拿到 reward 的物品，生物從地圖上消失（隔天會再出現）
//   catch_release 抓到後放回去：不拿東西、記進圖鑑，生物跑到附近別的地方
//   photo         拍照：拿到 reward 的物品（照片），生物留在原地
//   （implied、hunt 只有一般版世界包可以用，兒童版的資料檢查會擋下來；這裡一律當作「收集」，文字也保持中性）
// 失敗只代表「跑掉了」：不扣東西，可以再試。
// 選用：actions（開著時釣魚、捕蟲要花一點時間，走開會中斷，成功機率在動作結束時決定）
// 回饋事件 capture:feedback；capture:caught／discovered 給任務計數。
const KINDS = ['animal', 'fish', 'bug'];
const VERB = { collect: '抓', catch_release: '抓', photo: '拍', implied: '抓', hunt: '抓' };

export default {
  id: 'capture',
  version: '0.1.0',
  requires: [],
  optional: ['actions'],
  conflicts: [],
  emits: ['capture:caught', 'capture:missed', 'capture:discovered', 'capture:feedback'],
  config: {
    reach: 2.4, perRegion: 2,
    seconds: { fish: 2.0, bug: 1.0, animal: 1.0, photo: 0.6 },
    chance: { fish: 0.75, bug: 0.8, animal: 0.8, photo: 1 },
  },

  init(ctx) {
    const { entities, inventory, time } = ctx.services;
    const isl = ctx.data.island;
    const species = new Map((ctx.data.species || []).filter((s) => KINDS.includes(s.kind)).map((s) => [s.id, s]));
    const fb = (kind, text, extra = {}) => ctx.emit('capture:feedback', { kind, text, ...extra });
    const walk = (x, y) => x >= 0 && y >= 0 && x < isl.size.w && y < isl.size.h && isl.legend[isl.terrain[y][x]]?.walkable !== false;
    const inSeason = (s) => !s.seasons?.length || s.seasons.includes(time?.season ?? 'spring');
    let dex = {}; // species → { first: 天數, count, methods: [] }
    let seq = 0;

    // ---------- 生成 ----------
    // 魚：區域裡「水、而且旁邊就是岸」的格子；其他：區域裡可以走的格子
    const cells = (rg, fish) => {
      const out = [];
      for (let y = rg.rect.y; y < rg.rect.y + rg.rect.h; y++) for (let x = rg.rect.x; x < rg.rect.x + rg.rect.w; x++) {
        if (fish) { if (!walk(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walk(x + dx, y + dy))) out.push({ x, y }); }
        else if (walk(x, y)) out.push({ x, y });
      }
      return out;
    };
    const occupied = (x, y) => entities.near(x, y, 0.6).length > 0;
    function spawnIn(rg) {
      const pool = (rg.spawns || []).filter((sp) => species.has(sp.ref) && inSeason(species.get(sp.ref)));
      if (!pool.length) return null;
      const total = pool.reduce((n, sp) => n + (sp.weight ?? 1), 0);
      let k = ctx.rng.next() * total, pick = pool[0];
      for (const sp of pool) { k -= sp.weight ?? 1; if (k <= 0) { pick = sp; break; } }
      const s = species.get(pick.ref);
      const free = cells(rg, s.kind === 'fish').filter((c) => !occupied(c.x, c.y));
      if (!free.length) return null;
      const c = free[Math.floor(ctx.rng.next() * free.length)];
      return entities.add({ id: `critter.${++seq}`, kind: 'critter', owner: 'capture', ref: s.id, x: c.x, y: c.y, label: s.name, state: { region: rg.id, home: { ...c }, kind: s.kind } });
    }
    const critters = () => entities.byOwner('capture');
    function refill() {
      for (const rg of isl.regions || []) {
        const have = critters().filter((e) => e.state.region === rg.id).length;
        for (let i = have; i < ctx.config.perRegion; i++) spawnIn(rg);
      }
    }
    refill();
    ctx.on('core:dayStarted', () => refill());

    // 蟲和小動物在原地附近慢慢晃（生活感）；魚不動
    ctx.registerSystem({
      id: 'capture.wander', order: 60,
      update(dt) {
        if (!(dt > 0)) return;
        for (const e of critters()) {
          if (e.state.kind === 'fish') continue;
          const h = e.state.home, t = time?.elapsed ?? 0;
          const ph = Number(e.id.split('.')[1] || 0) * 1.7 % 6.28; // 每隻的節奏不一樣
          const nx = h.x + Math.cos(t * 0.6 + ph) * 0.35, ny = h.y + Math.sin(t * 0.8 + ph) * 0.25;
          entities.move(e.id, nx, ny);
        }
      },
    });

    // ---------- 捕捉 ----------
    const posOf = (actor) => entities.get(actor === 'player' ? 'player' : `resident.${actor}`);
    const near = (actor, e) => { const p = posOf(actor); return !!p && Math.hypot(p.x - e.x, p.y - e.y) <= ctx.config.reach; };
    const methodOf = (s, tool) => s.capture.methods.find((m) => m.tool === tool);
    const children = ctx.data.pack?.audience === 'children';
    const SAFE = ['collect', 'catch_release', 'photo'];

    function resolve(actor, target, m, ok) {
      const e = entities.get(target);
      if (!e) return;
      const s = species.get(e.ref);
      const at = { x: e.x, y: e.y };
      if (!ok) {
        ctx.emit('capture:missed', { actor, species: s.id });
        fb('fail', s.kind === 'fish' ? `${s.name}溜走了，再試一次！` : `${s.name}跑掉了，再試一次！`, { actor, at, entity: target, sound: 'miss' });
        if (s.kind !== 'fish') { const c = cells(isl.regions.find((r) => r.id === e.state.region), false); const n = c[Math.floor(ctx.rng.next() * c.length)]; if (n) entities.update(target, { x: n.x, y: n.y, state: { home: n } }); }
        return;
      }
      const pres = children && !SAFE.includes(m.presentation) ? 'catch_release' : m.presentation; // 雙重保險：兒童版一律安全呈現
      const got = [];
      if (pres !== 'catch_release') for (const r of s.capture.reward || []) { const n = inventory.add(actor, r.item, r.qty); if (n) got.push(`${inventory.itemName(r.item)} ×${n}`); }
      let text;
      if (pres === 'photo') text = `拍到了${s.name}的照片！${got.length ? `（${got.join('、')}）` : ''}`;
      else if (pres === 'catch_release') {
        text = `抓到${s.name}了！看一看、摸一摸，再輕輕放牠回去。`;
        const c = cells(isl.regions.find((r) => r.id === e.state.region), s.kind === 'fish');
        const n = c[Math.floor(ctx.rng.next() * c.length)];
        if (n) entities.update(target, { x: n.x, y: n.y, state: { home: n } });
      } else {
        text = `${s.kind === 'fish' ? '釣' : '抓'}到了${s.name}！${got.length ? `（${got.join('、')}）` : ''}`;
        entities.remove(target);
      }
      const first = !dex[s.id];
      dex[s.id] ||= { first: time?.day ?? 1, count: 0, methods: [] };
      dex[s.id].count++;
      if (!dex[s.id].methods.includes(pres)) dex[s.id].methods.push(pres);
      ctx.emit('capture:caught', { actor, species: s.id, kind: s.kind, presentation: pres, tool: m.tool });
      fb('success', text, { actor, at, sound: s.kind === 'fish' ? 'splash' : 'catch' });
      if (first) {
        ctx.emit('capture:discovered', { actor, species: s.id });
        fb('unlock', `圖鑑新發現：${s.name}！（${Object.keys(dex).length}/${species.size}）`, { actor, sound: 'discover' });
      }
    }

    ctx.registerCommand({
      id: 'capture.catch', label: '捕捉', description: '用工具釣魚、捕蟲或拍照',
      params: { target: { type: 'entity', kind: 'critter' }, tool: { type: 'ref', of: 'items' } },
      canRun: ({ target, tool }, call) => {
        const e = entities.get(target), s = species.get(e.ref), m = methodOf(s, tool);
        if (!m) return `不能用${inventory.itemName(tool)}對${s.name}這樣做`;
        if (!inventory.has(call.actor, tool)) return `需要${inventory.itemName(tool)}`;
        if (!near(call.actor, e)) return '走近一點';
        if (ctx.getModule('actions')?.busy(call.actor)) return '手上還在忙';
        if (m.presentation !== 'catch_release' && (s.capture.reward || []).some((r) => inventory.room(call.actor, r.item) <= 0)) return '背包滿了，先整理一下吧';
        return true;
      },
      run({ target, tool }, call) {
        const e = entities.get(target), s = species.get(e.ref), m = methodOf(s, tool);
        const key = m.presentation === 'photo' ? 'photo' : s.kind;
        const chance = ctx.config.chance[key] ?? 1;
        const actions = ctx.getModule('actions');
        if (!actions) { resolve(call.actor, target, m, chance >= 1 || ctx.rng.next() < chance); return { done: true }; }
        const label = m.presentation === 'photo' ? `拍${s.name}` : s.kind === 'fish' ? '釣魚' : `抓${s.name}`;
        const r = actions.start(call.actor, { label, seconds: ctx.config.seconds[key] ?? 1, tool, successChance: chance, at: { x: e.x, y: e.y },
          failText: s.kind === 'fish' ? `${s.name}溜走了，再試一次！` : `${s.name}跑掉了，再試一次！`,
          onDone: ({ ok, cancelled }) => { if (!cancelled && ok) resolve(call.actor, target, m, true); else if (!cancelled) ctx.emit('capture:missed', { actor: call.actor, species: s.id }); } });
        return r.ok ? { started: true } : { started: false, reason: r.reason };
      },
    });

    // 互動：每種捕捉方式一個按鈕，例如「用捕蟲網抓甲蟲」「用相機拍兔子」
    const tools = [...new Set([...species.values()].flatMap((s) => s.capture.methods.map((m) => m.tool)))];
    ctx.registerEntityKind('critter', {
      label: '生物',
      interactions: tools.map((tool) => ({
        label: (e) => { const s = species.get(e.ref), m = methodOf(s, tool); return s.kind === 'fish' && m?.presentation !== 'photo' ? `用${inventory.itemName(tool)}釣${s.name}` : `用${inventory.itemName(tool)}${VERB[m?.presentation] ?? '抓'}${s.name}`; },
        command: 'capture.catch', args: (e) => ({ target: e.id, tool }),
        when: (e) => !!methodOf(species.get(e.ref), tool),
      })),
    });

    // ---------- 圖鑑 ----------
    ctx.registerPanel({
      id: 'capture.dex', title: '圖鑑', order: 50,
      view() {
        const all = [...species.values()];
        return [
          { type: 'bar', label: `已發現 ${Object.keys(dex).length} / ${all.length} 種`, value: all.length ? Object.keys(dex).length / all.length : 0 },
          { type: 'list', items: all.map((s) => dex[s.id]
            ? { label: `✅ ${s.name}`, detail: `第 ${dex[s.id].first} 天發現，遇到 ${dex[s.id].count} 次` }
            : { label: '❔ ？？？', detail: `${({ fish: '水裡', bug: '草叢裡', animal: '草地上' })[s.kind]}的生物` }) },
        ];
      },
    });
    ctx.registerAIContext(() => (Object.keys(dex).length ? [`玩家的圖鑑已經發現 ${Object.keys(dex).length} 種生物`] : []));

    ctx.registerSaveSlice({
      key: 'capture', version: 1,
      serialize: () => ({ dex, seq, critters: critters().map((e) => ({ id: e.id, ref: e.ref, region: e.state.region, home: e.state.home })) }),
      deserialize(d) {
        dex = d?.dex && typeof d.dex === 'object' ? JSON.parse(JSON.stringify(d.dex)) : {};
        seq = Number(d?.seq) || seq;
        entities.removeOwner('capture');
        for (const c of d?.critters || []) {
          const s = species.get(c.ref);
          if (!s || !c.home) continue;
          entities.add({ id: c.id, kind: 'critter', owner: 'capture', ref: s.id, x: c.home.x, y: c.home.y, label: s.name, state: { region: c.region, home: c.home, kind: s.kind } });
        }
        refill();
      },
    });
    return { api: { dex: () => JSON.parse(JSON.stringify(dex)), discovered: () => Object.keys(dex).length } };
  },
};
