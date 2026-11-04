import {
  createWorld, stepWorld, snapshot, assignWorkers, countTasks, addLog,
  TASKS, TASK_LABEL, TASK_COLOR, MAX_HOUSES,
} from './world.js';
import { DEFAULT_NPCS } from './npcs.js';
import { mockDecide, llmDecide } from './brain.js';
import { createRenderer2D } from './render2d.js';

const $ = (id) => document.getElementById(id);

const world = createWorld();
const npcs = DEFAULT_NPCS.map((n, i) => ({
  ...structuredClone(n),
  memory: [], say: '', sayUntil: 0, busy: false, warnAt: -999,
  nextAt: 2 + i * 1.5,
  angle: (i / DEFAULT_NPCS.length) * Math.PI * 2 - Math.PI / 2,
}));
let mode = 'mock', speed = 1;

addLog(world, '小鎮開張了。居民會自己看狀況派人，你可以發公告影響他們。');

// ---------- 畫面視圖（2D / 3D 可切換，兩者吃同一份世界資料） ----------
const view2d = createRenderer2D($('cv'), world, npcs);
let view3d = null, view3dLoading = null, current = '2d';

async function ensure3d() {
  if (view3d) return view3d;
  if (!view3dLoading) {
    view3dLoading = import('./render3d/index.js').then((m) => m.createRenderer3D($('cv3d'), world, npcs));
  }
  view3d = await view3dLoading;
  return view3d;
}

async function setView(name) {
  if (name === '3d') {
    try { await ensure3d(); } catch (e) {
      view3dLoading = null;
      addLog(world, `⚠ 3D 畫面無法啟動（${e.message || e}），已改用 2D。可能是這台裝置不支援 WebGL。`);
      name = '2d';
    }
  }
  current = name;
  $('viewSel').value = name;
  $('cv').style.display = name === '2d' ? 'block' : 'none';
  $('cv3d').style.display = name === '3d' ? 'block' : 'none';
  $('camHelp').style.display = name === '3d' ? 'block' : 'none';
  $('camReset').style.display = name === '3d' ? 'inline-block' : 'none';
}
$('viewSel').onchange = (e) => setView(e.target.value);
$('camReset').onclick = () => view3d && view3d.resetCamera();

// ---------- 居民決策 ----------
function remember(n, kind, text) {
  n.memory.push({ t: world.t, kind, text });
  if (n.memory.length > 8) n.memory.shift();
}

async function decide(n) {
  n.busy = true;
  const snap = snapshot(world);
  let res;
  try {
    res = mode === 'llm' ? await llmDecide(n, snap, n.memory) : mockDecide(n, snap, n.memory);
  } catch (e) {
    if (world.t - n.warnAt > 60) {
      addLog(world, `⚠ ${n.name} 的 AI 腦沒有回應，這次先用規則腦（原因：${e.message || e}）`);
      n.warnAt = world.t;
    }
    res = mockDecide(n, snap, n.memory);
  }
  n.say = res.say;
  n.sayUntil = world.t + 8;
  if (res.action.type === 'assign') {
    const moved = assignWorkers(world, res.action.task, res.action.count);
    if (moved > 0) {
      const text = `${n.name}：${res.say}（調 ${moved} 人 → ${TASK_LABEL[res.action.task]}）`;
      addLog(world, text);
      remember(n, 'action', `我派了 ${moved} 人去${TASK_LABEL[res.action.task]}`);
    }
  }
  n.busy = false;
  n.nextAt = world.t + (mode === 'llm' ? 25 : 7) + Math.random() * 3;
}

function tickNpcs() {
  for (const n of npcs) if (!n.busy && world.t >= n.nextAt) decide(n);
}

// ---------- 玩家介入 ----------
function announce() {
  const text = $('annText').value.trim().slice(0, 40);
  if (!text) { addLog(world, '先輸入一句公告再按「發公告」喔。'); return; }
  addLog(world, `📢 你發布公告：${text}`);
  for (const n of npcs) {
    remember(n, 'announce', text);
    n.nextAt = world.t + 0.5 + Math.random() * 2;
  }
  $('annText').value = '';
}
$('annBtn').onclick = announce;
$('annText').addEventListener('keydown', (e) => { if (e.key === 'Enter') announce(); });
$('dropFood').onclick = () => { world.stock.food += 20; addLog(world, '🎁 天上掉下 20 份糧食'); };
$('dropWood').onclick = () => { world.stock.wood += 10; addLog(world, '🎁 天上掉下 10 份木材'); };
$('speed').onchange = (e) => { speed = Number(e.target.value); };
$('mode').onchange = (e) => {
  mode = e.target.value;
  addLog(world, mode === 'llm' ? '居民改用 AI 腦（若後台沒設定，會自動退回規則腦）' : '居民改用規則腦');
};
$('reset').onclick = () => location.reload();

// ---------- 角色卡編輯 ----------
const cardSel = $('cardSel');
npcs.forEach((n, i) => cardSel.add(new Option(`${n.name}（${n.role}）`, i)));
const SL_LABEL = { gather_food: '愛採糧', gather_wood: '愛砍柴', build: '愛蓋房', rest: '愛休息' };
const slidersBox = $('sliders');
TASKS.forEach((t) => {
  const l = document.createElement('label');
  l.className = 'sl';
  l.innerHTML = `<span>${SL_LABEL[t]}</span><input type="range" min="0.2" max="2.5" step="0.1" data-t="${t}"><b></b>`;
  slidersBox.appendChild(l);
});
function loadCard() {
  const n = npcs[Number(cardSel.value)];
  $('cardPers').value = n.card.personality;
  $('cardGoal').value = n.card.goal;
  slidersBox.querySelectorAll('input').forEach((r) => {
    r.value = n.card.bias[r.dataset.t];
    r.nextElementSibling.textContent = Number(r.value).toFixed(1);
  });
}
cardSel.onchange = loadCard;
$('cardPers').oninput = (e) => { npcs[Number(cardSel.value)].card.personality = e.target.value.slice(0, 120); };
$('cardGoal').oninput = (e) => { npcs[Number(cardSel.value)].card.goal = e.target.value.slice(0, 120); };
slidersBox.querySelectorAll('input').forEach((r) => {
  r.oninput = () => {
    npcs[Number(cardSel.value)].card.bias[r.dataset.t] = Number(r.value);
    r.nextElementSibling.textContent = Number(r.value).toFixed(1);
  };
});
loadCard();

// ---------- 面板 ----------
const legend = $('dots');
for (const k of [...TASKS, 'idle']) {
  const s = document.createElement('span');
  s.innerHTML = `<span class="dot" style="background:${TASK_COLOR[k]}"></span>${TASK_LABEL[k]} <b data-k="${k}">0</b>`;
  legend.appendChild(s);
}

let lastUi = 0, lastLogSeq = -1;
function updatePanels(now) {
  if (now - lastUi < 400) return;
  lastUi = now;
  const s = snapshot(world);
  $('sFood').textContent = s.food;
  $('sWood').textContent = s.wood;
  $('sHouse').textContent = `${s.houses} / ${MAX_HOUSES}`;
  $('sTime').textContent = `${Math.floor(s.time / 60)}分${s.time % 60}秒`;
  $('sMood').textContent = s.mood;
  $('moodBar').style.width = `${s.mood}%`;
  $('moodBar').style.background = s.mood < 30 ? '#d9534f' : s.mood < 55 ? '#e0a030' : '#5fb85f';
  const c = countTasks(world);
  legend.querySelectorAll('b').forEach((b) => { b.textContent = c[b.dataset.k]; });

  const list = $('npcList');
  list.textContent = '';
  for (const n of npcs) {
    const d = document.createElement('div'); d.className = 'res';
    const b = document.createElement('b'); b.textContent = n.name; b.style.color = n.color;
    const r = document.createElement('span'); r.className = 'role'; r.textContent = n.role;
    const sy = document.createElement('div'); sy.className = 'say'; sy.textContent = n.busy ? '思考中…' : (n.say || '（還沒說話）');
    d.append(b, r, sy); list.appendChild(d);
  }
  if (lastLogSeq !== world.logSeq) {
    lastLogSeq = world.logSeq;
    const box = $('log'); box.textContent = '';
    for (const e of world.log.slice(-14).reverse()) {
      const d = document.createElement('div'); d.textContent = `[${Math.floor(e.t)}s] ${e.text}`; box.appendChild(d);
    }
  }
}

// ---------- 主迴圈 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const simTotal = dt * speed;
  let rem = simTotal;
  while (rem > 0) { const s = Math.min(rem, 1 / 20); stepWorld(world, s); rem -= s; }
  tickNpcs();
  const v = current === '3d' && view3d ? view3d : view2d;
  v.render(dt, simTotal, speed);
  updatePanels(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setView('3d'); // 預設 3D；裝置不支援時會自動退回 2D 並在事件紀錄說明

window.__town = { world, npcs, snapshot: () => snapshot(world), setView, get view() { return current; }, get view3d() { return view3d; } }; // 除錯與自動測試用
