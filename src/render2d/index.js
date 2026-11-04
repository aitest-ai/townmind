// 2D 俯視圖（島嶼版）：只讀世界包的地圖與核心的實體表，不改任何遊戲狀態，也不 import 任何模組。
// 實體怎麼畫：先看實體的 art（或世界包 art.json 裡 ref 對應的 preset），再看 kind，最後用預設的小圓點。
// 介面：{ name, render(frameDt), toWorld(clientX, clientY), resize(), dispose() }

const DEFAULT_TILE = { '~': '#7cc8ea', s: '#f1e0ad', '.': '#a6d57e' };
const NAME_COLOR = { 水: '#7cc8ea', 沙地: '#f1e0ad', 草地: '#a6d57e' };
const FONT = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif";

// preset → 畫法（單位：格。cx, cy 是格子中心的像素座標，t 是一格的像素）
const PRESETS = {
  tree_pine(g, cx, cy, t, e) {
    g.fillStyle = 'rgba(0,0,0,.15)'; ellipse(g, cx, cy + t * 0.3, t * 0.4, t * 0.15);
    g.fillStyle = '#6b4a2b'; g.fillRect(cx - t * 0.07, cy, t * 0.14, t * 0.3);
    g.fillStyle = e.state?.depleted ? '#9bbf8c' : '#3f8f45';
    tri(g, cx, cy - t * 0.55, t * 0.42, t * 0.75);
  },
  tree_round(g, cx, cy, t, e) {
    g.fillStyle = 'rgba(0,0,0,.15)'; ellipse(g, cx, cy + t * 0.3, t * 0.4, t * 0.15);
    g.fillStyle = '#6b4a2b'; g.fillRect(cx - t * 0.07, cy, t * 0.14, t * 0.3);
    g.fillStyle = e.state?.depleted ? '#a9c79a' : '#58b35a'; circle(g, cx, cy - t * 0.2, t * 0.38);
    if (!e.state?.depleted) { g.fillStyle = '#e0452f'; for (const [dx, dy] of [[-0.15, -0.25], [0.14, -0.1], [0.02, -0.38]]) circle(g, cx + dx * t, cy + dy * t, t * 0.07); }
  },
  bush_berry(g, cx, cy, t, e) {
    g.fillStyle = e.state?.depleted ? '#9cbf93' : '#4a9a4a'; circle(g, cx, cy, t * 0.33);
    if (!e.state?.depleted) { g.fillStyle = '#c73a5a'; for (const [dx, dy] of [[-0.12, -0.08], [0.12, 0.02], [0, 0.14]]) circle(g, cx + dx * t, cy + dy * t, t * 0.06); }
  },
  rock(g, cx, cy, t, e) {
    g.fillStyle = e.state?.depleted ? '#c9c9c4' : '#9a9a94'; ellipse(g, cx, cy + t * 0.05, t * 0.36, t * 0.26);
    g.fillStyle = 'rgba(255,255,255,.35)'; ellipse(g, cx - t * 0.1, cy - t * 0.05, t * 0.1, t * 0.06);
  },
  shell(g, cx, cy, t, e) {
    if (e.state?.depleted) return;
    g.fillStyle = '#f7c6c0'; ellipse(g, cx, cy, t * 0.16, t * 0.12);
    g.strokeStyle = '#d98b82'; g.lineWidth = Math.max(1, t * 0.03); g.beginPath(); g.moveTo(cx, cy - t * 0.1); g.lineTo(cx, cy + t * 0.1); g.stroke();
  },
  home(g, cx, cy, t, e) {
    g.fillStyle = '#efe0b8'; g.fillRect(cx - t * 0.38, cy - t * 0.1, t * 0.76, t * 0.48);
    g.fillStyle = e.state?.roof || '#c0583a'; tri(g, cx, cy - t * 0.5, t * 0.48, t * 0.42);
    g.fillStyle = '#6b4a2b'; g.fillRect(cx - t * 0.08, cy + t * 0.12, t * 0.16, t * 0.26);
  },
  station(g, cx, cy, t) {
    g.fillStyle = '#a0784a'; g.fillRect(cx - t * 0.36, cy - t * 0.14, t * 0.72, t * 0.3);
    g.fillStyle = '#7a5a34'; g.fillRect(cx - t * 0.32, cy + t * 0.16, t * 0.08, t * 0.2); g.fillRect(cx + t * 0.24, cy + t * 0.16, t * 0.08, t * 0.2);
  },
  plot(g, cx, cy, t) {
    g.fillStyle = '#8a6440'; g.fillRect(cx - t * 0.45, cy - t * 0.45, t * 0.9, t * 0.9);
    g.strokeStyle = '#6f4e30'; g.lineWidth = Math.max(1, t * 0.03);
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(cx - t * 0.4, cy + i * t * 0.25); g.lineTo(cx + t * 0.4, cy + i * t * 0.25); g.stroke(); }
  },
};
const KIND_PRESET = { tree: 'tree_pine', bush: 'bush_berry', rock: 'rock', forage: 'shell', home: 'home', station: 'station', plot: 'plot' };

function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function ellipse(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
function tri(g, x, top, hw, h) { g.beginPath(); g.moveTo(x, top); g.lineTo(x + hw, top + h); g.lineTo(x - hw, top + h); g.closePath(); g.fill(); }

export function createRenderer2D(canvas, { data, services }) {
  const g = canvas.getContext('2d');
  const isl = data.island;
  const W = isl.size.w, H = isl.size.h;
  const art = data.art || {};
  let t = 20, ox = 0, oy = 0, dpr = 1, terrain = null, sized = '';

  function resize() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const key = `${cw}x${ch}x${dpr}`;
    if (key === sized || !cw || !ch) return;
    sized = key;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    t = Math.min(canvas.width / W, canvas.height / H);
    ox = (canvas.width - t * W) / 2; oy = (canvas.height - t * H) / 2;
    terrain = document.createElement('canvas');
    terrain.width = canvas.width; terrain.height = canvas.height;
    const tg = terrain.getContext('2d');
    tg.fillStyle = DEFAULT_TILE['~']; tg.fillRect(0, 0, terrain.width, terrain.height);
    for (let y = 0; y < H; y++) {
      const row = isl.terrain[y];
      for (let x = 0; x < W; x++) {
        const ch2 = row[x], lg = isl.legend[ch2] || {};
        tg.fillStyle = lg.color || NAME_COLOR[lg.name] || DEFAULT_TILE[ch2] || '#cccccc';
        tg.fillRect(Math.floor(ox + x * t), Math.floor(oy + y * t), Math.ceil(t) + 1, Math.ceil(t) + 1);
      }
    }
  }

  const presetOf = (e) => e.art || art[e.ref]?.preset || KIND_PRESET[e.kind] || null;

  function label(text, x, y, { color = '#222', bg = 'rgba(255,255,255,.85)' } = {}) {
    g.font = `${Math.max(11, t * 0.42)}px ${FONT}`;
    const w = g.measureText(text).width + 10, h = Math.max(14, t * 0.55);
    g.fillStyle = bg; g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 1);
  }

  function drawEntity(e) {
    const cx = ox + (e.x + 0.5) * t, cy = oy + (e.y + 0.5) * t;
    if (e.kind === 'player') {
      g.fillStyle = 'rgba(0,0,0,.18)'; ellipse(g, cx, cy + t * 0.3, t * 0.3, t * 0.12);
      g.fillStyle = '#3f78c9'; circle(g, cx, cy, t * 0.32);
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, t * 0.08); g.beginPath(); g.arc(cx, cy, t * 0.32, 0, Math.PI * 2); g.stroke();
      label('你', cx, cy - t * 0.75, { color: '#fff', bg: 'rgba(63,120,201,.9)' });
      return;
    }
    if (e.kind === 'resident') {
      g.fillStyle = 'rgba(0,0,0,.18)'; ellipse(g, cx, cy + t * 0.3, t * 0.3, t * 0.12);
      g.fillStyle = e.state?.color || '#888'; circle(g, cx, cy, t * 0.32);
      label(e.label || e.ref || '居民', cx, cy + t * 0.7);
      if (e.state?.say) label(e.state.say.length > 18 ? `${e.state.say.slice(0, 18)}…` : e.state.say, cx, cy - t * 0.85);
      return;
    }
    const p = PRESETS[presetOf(e)];
    if (p) p(g, cx, cy, t, e);
    else { g.fillStyle = '#777'; circle(g, cx, cy, t * 0.15); }
  }

  function render() {
    resize();
    if (!terrain) return;
    g.drawImage(terrain, 0, 0);
    const list = services.entities.all().slice().sort((a, b) => a.y - b.y || (a.kind === 'player') - (b.kind === 'player'));
    for (const e of list) { try { drawEntity(e); } catch { /* 單一實體畫壞不影響其他 */ } }
  }

  // 螢幕座標 → 格子座標（點地圖移動用）
  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const px = (clientX - r.left) * dpr, py = (clientY - r.top) * dpr;
    return { x: (px - ox) / t - 0.5, y: (py - oy) / t - 0.5 };
  }

  return { name: '2d', render, toWorld, resize, dispose() {} };
}
