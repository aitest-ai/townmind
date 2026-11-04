// 3D 視圖（框架版）：只讀世界包的地圖與核心的實體表，不改任何遊戲狀態，也不 import 任何模組。
// 座標：格子 (x, y) → 3D (x, z)，1 格 = 2.5 公尺（與原型相同：原型 25 世界單位 × 0.1），地圖中心為原點。
// 實體怎麼畫：實體的 art ＞ 世界包 art.json[ref].preset ＞ kind 的預設 ＞ 灰色小球。
// 人物動作：state.anim（模組指定，例如 Work、Pick）＞ 依移動速度自動判斷 Walk／Carry ＞ 站著時用 state.idleAnim（預設 Idle）。
// 場景零件（樹、灌木、房子、工地、倉庫、文字貼圖）沿用原型 legacy/render3d/index.js，外觀保持一致。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createProceduralCharacter } from './characters.js';

const TILE = 2.5;
const WORKER_H = 2.6, RESIDENT_H = 3.1;
const FONT = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif";
const SKINS = [0xf1c9a5, 0xe5b48b, 0xd39b72, 0xf6d5b8, 0xc68863];
const HAIRS = [0x2b1f18, 0x3b2a20, 0x5a3b22, 0x1a1a1a, 0x7a5a30];
const PANTS = [0x3d4f73, 0x4a5a40, 0x5a4a3a, 0x3a3a4a];
const hex = (v, d = 0x888888) => (typeof v === 'number' ? v : typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? parseInt(v.slice(1), 16) : d);

const lerpAngle = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};
const std = (hexv, rough = 0.9) => new THREE.MeshStandardMaterial({ color: hexv, roughness: rough, metalness: 0 });

// ---------- 文字貼圖（名牌、氣泡） ----------
function makeTextSprite() {
  const canvas = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  let last = null;
  sprite.userData.set = (text, { bubble = false, color = '#222', size = 28 } = {}) => {
    const key = `${text}|${bubble}|${color}`;
    if (key === last) return;
    last = key;
    const lines = [];
    const per = bubble ? 13 : 20;
    for (let i = 0; i < text.length; i += per) lines.push(text.slice(i, i + per));
    const ctx = canvas.getContext('2d');
    ctx.font = `${size}px ${FONT}`;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 36;
    const lh = size * 1.3, h = Math.ceil(lines.length * lh) + 24;
    canvas.width = w; canvas.height = h;
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (bubble) {
      ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.strokeStyle = '#b9b9b9'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(2, 2, w - 4, h - 4, 14); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath(); ctx.roundRect(2, 2, w - 4, h - 4, 12); ctx.fill();
    }
    ctx.fillStyle = bubble ? color : '#fff';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, 12 + lh * (i + 0.5)));
    tex.dispose(); // 貼圖尺寸改變時要重建，否則 WebGL 會警告
    tex.needsUpdate = true;
    const unit = bubble ? 0.017 : 0.015;
    sprite.userData.base = { w: w * unit, h: h * unit };
    sprite.scale.set(w * unit, h * unit, 1);
  };
  return sprite;
}

// ---------- 場景零件 ----------
function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 7), std(0x6b4a2b));
  trunk.position.y = 1.1; g.add(trunk);
  [[2.3, 2.6, 3.3, 0x3f8f45], [1.8, 2.3, 4.7, 0x4aa04f], [1.25, 2.0, 6.0, 0x58b35a]].forEach(([r, h, y, c]) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), std(c)); cone.position.y = y; g.add(cone);
  });
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function makeBush() {
  const g = new THREE.Group();
  [[0, 0.9, 0, 1.3], [-0.9, 0.7, 0.3, 0.95], [0.9, 0.7, -0.2, 1.0], [0.1, 0.6, 0.9, 0.85]].forEach(([x, y, z, r]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), std(0x4a9a4a)); b.position.set(x, y, z); g.add(b);
  });
  const berry = std(0xd9432f, 0.5);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.95 + (i % 3) * 0.12;
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), berry);
    s.position.set(Math.cos(a) * r, 0.7 + (i % 4) * 0.22, Math.sin(a) * r); g.add(s);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

function makeHouse(i) {
  const g = new THREE.Group();
  const walls = [0xefe0b8, 0xe8d3a3, 0xf2e6c9, 0xdcc9a0][i % 4];
  const roofs = [0xc0583a, 0x4f7cb8, 0x8a5a3b, 0x5e8f4e][i % 4];
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 3.0), std(walls)); body.position.y = 1.1;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 2.9, 1.7, 4), std(roofs)); roof.rotation.y = Math.PI / 4; roof.scale.set(1.0, 1, 0.92); roof.position.y = 3.05;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.1), std(0x6b4a2b)); door.position.set(0, 0.7, 1.52);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.1), std(0x9fd3e6, 0.3)); win.position.set(1.0, 1.35, 1.52);
  g.add(body, roof, door, win);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function makeSite() {
  const g = new THREE.Group();
  const post = std(0x8a6b3c);
  [[-1.8, -1.6], [1.8, -1.6], [-1.8, 1.6], [1.8, 1.6]].forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), post); p.position.set(x, 1.7, z); g.add(p);
  });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1, 3.0), new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.9, transparent: true, opacity: 0.92 }));
  g.add(walls);
  const outline = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.8), new THREE.MeshBasicMaterial({ color: 0x4a7fd0, transparent: true, opacity: 0.25 }));
  outline.rotation.x = -Math.PI / 2; outline.position.y = 0.03; g.add(outline);
  g.userData.walls = walls;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeStockpile() {
  const g = new THREE.Group();
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.12, 28), std(0xd8c7a3, 1)); plaza.position.y = 0.06; plaza.receiveShadow = true; g.add(plaza);
  const logs = [], food = [];
  const logMat = std(0x7a5230), endMat = std(0xc99a62);
  for (let i = 0; i < 12; i++) { // 木材堆：三層金字塔
    const row = i < 5 ? 0 : i < 9 ? 1 : 2, idx = row === 0 ? i : row === 1 ? i - 5 : i - 9;
    const n = row === 0 ? 5 : row === 1 ? 4 : 3;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.5, 8), logMat);
    m.rotation.z = Math.PI / 2;
    m.position.set(-2.6, 0.35 + row * 0.38, 1.1 + (idx - (n - 1) / 2) * 0.46);
    m.castShadow = true; g.add(m); logs.push(m);
  }
  const sack = std(0xe3b04b), leaf = std(0x6bbf59);
  for (let i = 0; i < 10; i++) { // 糧食：籃子堆
    const b = new THREE.Group();
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), sack); s.scale.y = 0.8; b.add(s);
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), leaf); l.position.y = 0.3; b.add(l);
    const row = i < 6 ? 0 : 1, idx = row === 0 ? i : i - 6, n = row === 0 ? 6 : 4;
    b.position.set(2.5 + (row ? 0.1 : 0), 0.4 + row * 0.55, 0.6 + (idx - (n - 1) / 2) * 0.62);
    b.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(b); food.push(b);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), std(0x6b4a2b)); pole.position.set(0, 2, -2.2); pole.castShadow = true; g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ color: 0xe8833a, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(0.75, 3.5, -2.2); g.add(flag);
  g.userData = { logs, food };
  return g;
}

function makeRock() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0, 0), std(0x9a9a94)); m.scale.set(1.2, 0.75, 1); m.position.y = 0.6; m.castShadow = true; g.add(m);
  return g;
}
function makeShell() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0xf7c6c0, 0.5)); m.scale.set(1, 0.5, 0.8); g.add(m);
  return g;
}
function makeRoundTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.4, 7), std(0x6b4a2b)); trunk.position.y = 1.2; g.add(trunk);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(2.0, 12, 10), std(0x58b35a)); crown.position.y = 3.6; g.add(crown);
  const fruit = std(0xe0452f, 0.5);
  const fruits = new THREE.Group();
  for (let i = 0; i < 7; i++) { const a = i * 2.2; const f = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), fruit); f.position.set(Math.cos(a) * 1.7, 3.2 + (i % 3) * 0.5, Math.sin(a) * 1.7); fruits.add(f); }
  g.add(fruits); g.userData.fruits = fruits;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function makePlot() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.92, 0.18, TILE * 0.92), std(0x8a6440, 1)); m.position.y = 0.09; m.receiveShadow = true; g.add(m);
  return g;
}
function makeStation() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 1.1), std(0xa0784a)); top.position.y = 1.0; g.add(top);
  for (const [x, z] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.0, 0.15), std(0x7a5a34)); l.position.set(x, 0.5, z); g.add(l); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
// 家具（佈置模組）
function makeFence() {
  const g = new THREE.Group(), wood = std(0xb08850);
  for (const x of [-1, 0, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.22), wood); p.position.set(x, 0.6, 0); g.add(p); }
  for (const y of [0.45, 0.9]) { const r = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 0.12), wood); r.position.set(0, y, 0); g.add(r); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function makeChair() {
  const g = new THREE.Group(), wood = std(0xc4935a), dark = std(0x8f6236);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 1.0), wood); seat.position.y = 0.7; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.14), dark); back.position.set(0, 1.2, -0.43); g.add(back);
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), dark); l.position.set(x, 0.35, z); g.add(l); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function makeTable() {
  const g = new THREE.Group(), wood = std(0xa97845);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 1.3), wood); top.position.y = 1.0; g.add(top);
  for (const [x, z] of [[-0.8, -0.5], [0.8, -0.5], [-0.8, 0.5], [0.8, 0.5]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), wood); l.position.set(x, 0.5, z); g.add(l); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeUnknown() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), std(0x888888)); m.position.y = 0.4; g.add(m);
  return g;
}

const KIND_PRESET = { tree: 'tree_pine', bush: 'bush_berry', rock: 'rock', forage: 'shell', home: 'home', station: 'station', plot: 'plot' };

// ---------- 主函式 ----------
export async function createRenderer3D(canvas, { data, services, lowPower = false, follow = null }) {
  const { entities, time } = services;
  const isl = data.island;
  const W = isl.size.w, H = isl.size.h;
  const art = data.art || {};
  const look = isl.look || {};
  const wx = (x) => (x + 0.5 - W / 2) * TILE;
  const wz = (y) => (y + 0.5 - H / 2) * TILE;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, lowPower ? 1 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const SKY = 0xcfe8f5;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 95, 230);

  const span = Math.max(W, H) * TILE;
  const camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.5, 400);
  // follow：鏡頭跟著某個實體（通常是玩家），否則看整張地圖
  const followId = follow;
  follow = followId ? { id: followId, last: null, vel: { x: 0, z: 0 } } : null;
  const followEnt = () => (follow ? entities.get(follow.id) : null);
  const fe0 = followEnt();
  const CAM_TARGET = fe0 ? new THREE.Vector3(wx(fe0.x), 0, wz(fe0.y)) : new THREE.Vector3(0, 0, 2);
  const CAM_POS = fe0 ? CAM_TARGET.clone().add(new THREE.Vector3(0, 24, 28)) : new THREE.Vector3(0, span * 0.58, span * 0.7);
  camera.position.copy(CAM_POS);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(CAM_TARGET);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 10; controls.maxDistance = 140;
  controls.screenSpacePanning = false;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x7a9a5a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  const half = span * 0.7;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half * 0.82, bottom: -half * 0.82, near: 1, far: 200 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // ---------- 地形 ----------
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const m4 = new THREE.Matrix4();
  if (look.outside === 'forest') {
    // 原型小鎮：外圈是草地與森林
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), std(0x7fae5f, 1)); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true; scene.add(outer);
    const FOREST = lowPower ? 50 : 90;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.55, 2.4, 6), std(0x6b4a2b), FOREST);
    const crownA = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 3.4, 7), std(0x3a7f40), FOREST);
    const crownB = new THREE.InstancedMesh(new THREE.ConeGeometry(1.9, 3.0, 7), std(0x48994d), FOREST);
    const hx = (W * TILE) / 2 + 3, hz = (H * TILE) / 2 + 3;
    for (let i = 0; i < FOREST; i++) {
      let x, z;
      do { x = (rnd() - 0.5) * 190; z = (rnd() - 0.5) * 150; } while (Math.abs(x) < hx && Math.abs(z) < hz);
      const sc = 0.8 + rnd() * 0.9;
      m4.compose(new THREE.Vector3(x, 1.2 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); trunks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, 3.6 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); crownA.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, 5.6 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); crownB.setMatrixAt(i, m4);
    }
    [trunks, crownA, crownB].forEach((m) => { m.castShadow = true; scene.add(m); });
  } else {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x6cbfe3, roughness: 0.4, metalness: 0 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.35; sea.receiveShadow = true; scene.add(sea);
  }
  // 每種可走的地形一個 InstancedMesh（水格不畫，露出底下的海）
  const DEF = { 草地: 0xa3cf78, 沙地: 0xefdcaa };
  const tilesBy = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = isl.terrain[y][x], lg = isl.legend[ch] || {};
    if (lg.walkable === false) continue;
    if (!tilesBy.has(ch)) tilesBy.set(ch, []);
    tilesBy.get(ch).push([x, y]);
  }
  for (const [ch, list] of tilesBy) {
    const lg = isl.legend[ch] || {};
    const color = hex(lg.color, DEF[lg.name] ?? 0xa3cf78);
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, 0.4, TILE), std(color, 1), list.length);
    list.forEach(([x, y], i) => { m4.makeTranslation(wx(x), -0.2, wz(y)); im.setMatrixAt(i, m4); });
    im.receiveShadow = true; scene.add(im);
  }
  if (look.flowers !== false) {
    const cells = [...tilesBy.values()].flat();
    const FLOWERS = Math.min(lowPower ? 70 : 140, cells.length * 2);
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 5), std(0xffffff, 0.6), FLOWERS);
    const palette = [0xffffff, 0xffd84a, 0xff8fb1, 0xb59cff];
    for (let i = 0; i < FLOWERS; i++) {
      const [cx, cy] = cells[Math.floor(rnd() * cells.length)];
      m4.compose(new THREE.Vector3(wx(cx) + (rnd() - 0.5) * TILE, 0.14, wz(cy) + (rnd() - 0.5) * TILE), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      flowers.setMatrixAt(i, m4); flowers.setColorAt(i, new THREE.Color(palette[i % 4]));
    }
    scene.add(flowers);
  }

  // ---------- 實體 ----------
  const objs = new Map(); // entity id → { o, kind, ch?, label?, bubble?, px, pz, yaw }
  const presetOf = (e) => e.art || art[e.ref]?.preset || KIND_PRESET[e.kind] || e.kind;
  let houseSeq = 0;

  function charFor(e, height, extra = {}) {
    const glb = art[e.ref]?.type === 'glb' ? art[e.ref].url : e.state?.model;
    const ch = createProceduralCharacter({ height, ...extra });
    if (glb) { // 有 GLB 就換掉（載入失敗會留在程式生成角色並警告）
      import('./glb.js').then(({ loadGLBCharacter }) => loadGLBCharacter(glb, { height })).then((g) => {
        const rec = objs.get(e.id); if (!rec) return;
        rec.o.remove(rec.ch.object); rec.o.add(g.object); rec.ch = g;
      }).catch((err) => console.warn(`「${e.label || e.id}」的 GLB 載入失敗，改用程式生成角色：`, err));
    }
    return ch;
  }

  function build(e) {
    const p = presetOf(e);
    const root = new THREE.Group();
    const rec = { o: root, preset: p, px: wx(e.x), pz: wz(e.y), yaw: rnd() * 6.28 };
    switch (p) {
      case 'tree': case 'tree_pine': rec.part = makeTree(); root.rotation.y = rnd() * 6.28; break;
      case 'tree_round': rec.part = makeRoundTree(); root.rotation.y = rnd() * 6.28; break;
      case 'bush': case 'bush_berry': rec.part = makeBush(); root.rotation.y = rnd() * 6.28; break;
      case 'rock': rec.part = makeRock(); root.rotation.y = rnd() * 6.28; break;
      case 'shell': rec.part = makeShell(); break;
      case 'plot': rec.part = makePlot(); break;
      case 'station': rec.part = makeStation(); break;
      case 'fence': rec.part = makeFence(); break;
      case 'chair': rec.part = makeChair(); break;
      case 'table': rec.part = makeTable(); break;
      case 'house': case 'home': {
        const i = e.state?.index ?? houseSeq++;
        rec.part = makeHouse(i);
        root.rotation.y = p === 'house' ? Math.atan2(-wx(e.x), -wz(e.y)) : 0;
        if (p === 'home') { rec.part.scale.setScalar(0.72); rec.part.position.z = -0.4; } // 島上的家佔一格，比原型的房子小一點
        rec.born = clock.t; root.scale.setScalar(p === 'house' ? 0.01 : 1);
        break;
      }
      case 'site': rec.part = makeSite(); rec.prog = 0; break;
      case 'marker': {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; rec.part = ring; rec.pulse = true; break;
      }
      case 'depot': {
        rec.part = makeStockpile();
        rec.label = makeTextSprite(); rec.label.userData.set(e.label || '倉庫'); rec.label.position.set(0, 5.3, -2.2); root.add(rec.label);
        break;
      }
      case 'worker': {
        const id = e.state?.index ?? 0;
        rec.ch = charFor(e, WORKER_H, { skin: SKINS[id % SKINS.length], hair: HAIRS[(id * 3) % HAIRS.length], pants: PANTS[id % PANTS.length], shirt: 0x9a9a9a });
        break;
      }
      case 'resident': {
        rec.ch = charFor(e, RESIDENT_H, { shirt: hex(e.state?.color), skin: hex(e.state?.look?.skin, SKINS[0]), hair: hex(e.state?.look?.hair, HAIRS[0]), accessory: e.state?.look?.accessory ?? null });
        rec.label = makeTextSprite(); rec.label.userData.set(`${e.label}・${e.state?.role ?? ''}`, { size: 26 }); rec.label.position.y = RESIDENT_H + 0.9; root.add(rec.label);
        rec.bubble = makeTextSprite(); rec.bubble.position.y = RESIDENT_H + 2.6; rec.bubble.visible = false; root.add(rec.bubble);
        break;
      }
      case 'player': {
        rec.ch = charFor(e, RESIDENT_H, { shirt: 0x3f78c9, skin: SKINS[0], hair: HAIRS[2] });
        rec.label = makeTextSprite(); rec.label.userData.set('你', { size: 26 }); rec.label.position.y = RESIDENT_H + 0.9; root.add(rec.label);
        break;
      }
      default: rec.part = makeUnknown();
    }
    if (rec.part) root.add(rec.part);
    if (rec.ch) root.add(rec.ch.object);
    root.position.set(rec.px, 0, rec.pz);
    scene.add(root);
    objs.set(e.id, rec);
    return rec;
  }

  let lastVersion = -1;
  function syncSet() {
    if (entities.version === lastVersion) return;
    lastVersion = entities.version;
    const ids = new Set();
    for (const e of entities.all()) { ids.add(e.id); if (!objs.has(e.id)) build(e); }
    for (const [id, rec] of objs) if (!ids.has(id)) { scene.remove(rec.o); objs.delete(id); }
  }

  // ---------- 尺寸 ----------
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.dataset.rw !== `${w}x${h}`) {
      canvas.dataset.rw = `${w}x${h}`;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }

  // ---------- 每幀更新 ----------
  const clock = { t: 0 };
  const tmp = new THREE.Vector3();
  const fit = (sp) => {
    if (!sp || !sp.visible || !sp.userData.base) return;
    sp.getWorldPosition(tmp);
    const k = THREE.MathUtils.clamp(camera.position.distanceTo(tmp) / 45, followId ? 0.75 : 0.4, 1.7); // 跟隨鏡頭比較近，名牌不要縮太小
    sp.scale.set(sp.userData.base.w * k, sp.userData.base.h * k, 1);
  };

  function render(frameDt) {
    resize();
    syncSet();
    clock.t += frameDt;
    const speed = time.paused ? 0 : time.timeScale;
    const simDt = frameDt * speed;
    const animDt = frameDt * Math.min(speed || 1, 3);

    const a = 0.7 + time.elapsed * 0.012; // 太陽緩慢繞行（與原型相同）
    sun.position.set(Math.cos(a) * 38, 55, Math.sin(a) * 30 + 10);
    sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();

    for (const e of entities.all()) {
      const rec = objs.get(e.id);
      if (!rec) continue;
      const px = wx(e.x), pz = wz(e.y), st = e.state || {};
      if (rec.ch) {
        const dx = px - rec.px, dz = pz - rec.pz, dist = Math.hypot(dx, dz);
        const vel = simDt > 0 ? dist / simDt : 0;
        if (dist > 0.003) rec.yaw = lerpAngle(rec.yaw, Math.atan2(dx, dz), Math.min(1, frameDt * 10));
        rec.px = px; rec.pz = pz;
        rec.o.position.set(px, 0, pz);
        if (rec.preset === 'resident') rec.o.rotation.y = Math.atan2(-px, -pz); else rec.o.rotation.y = rec.yaw;
        if (st.tint) rec.ch.setTint(hex(st.tint));
        rec.ch.setCarry(st.carry ?? null);
        const clip = st.anim || (vel > 0.8 ? (st.carry ? 'Carry' : 'Walk') : (st.idleAnim || 'Idle'));
        rec.ch.play(clip); rec.ch.update(animDt);
        if (rec.bubble) {
          if (st.busy) { rec.bubble.visible = true; rec.bubble.userData.set('…', { bubble: true, size: 34 }); }
          else if (st.say) { rec.bubble.visible = true; rec.bubble.userData.set(st.say, { bubble: true }); }
          else rec.bubble.visible = false;
        }
      } else {
        rec.o.position.set(px, 0, pz);
        if (st.rot !== undefined) rec.o.rotation.y = -st.rot * Math.PI / 2; // 家具旋轉（佈置模組）
      }
      // 依狀態調整外觀
      if (st.max && st.left !== undefined && rec.part) rec.part.scale.setScalar(0.3 + 0.7 * (st.left / st.max));
      if (st.depleted !== undefined && rec.part) {
        rec.part.scale.setScalar(st.depleted ? 0.45 : 1);
        if (rec.part.userData.fruits) rec.part.userData.fruits.visible = !st.depleted;
      }
      if (rec.preset === 'depot') {
        rec.part.userData.logs.forEach((m, i) => { m.visible = i < Math.ceil(Math.min(st.wood ?? 0, 24) / 2); });
        rec.part.userData.food.forEach((b, i) => { b.visible = i < Math.ceil(Math.min(st.food ?? 0, 40) / 4); });
      }
      if (rec.preset === 'house' && rec.born !== undefined) {
        const k = Math.min(1, (clock.t - rec.born) / 0.6);
        rec.o.scale.setScalar(0.01 + 0.99 * (1 - Math.pow(1 - k, 3)));
      }
      if (rec.preset === 'site') {
        const goal = (st.progress ?? 0) / (st.need || 1);
        rec.prog += (goal - rec.prog) * Math.min(1, frameDt * 4);
        const wallH = Math.max(0.02, rec.prog * 2.2);
        rec.part.userData.walls.scale.y = wallH; rec.part.userData.walls.position.y = wallH / 2;
      }
      if (rec.pulse) rec.part.scale.setScalar(1 + 0.12 * Math.sin(clock.t * 6));
      fit(rec.label); fit(rec.bubble);
    }

    const fe = followEnt();
    if (fe) {
      // 鏡頭阻尼：目標點＝玩家位置＋往移動方向看前一點（look-ahead），用和幀率無關的指數平滑追過去，
      // 相機和目標一起平移，保留玩家自己轉的角度與遠近。
      const px = wx(fe.x), pz = wz(fe.y);
      if (follow.last) {
        const k0 = 1 - Math.exp(-frameDt * 6);
        const vx = frameDt > 0 ? (px - follow.last.x) / frameDt : 0, vz = frameDt > 0 ? (pz - follow.last.z) / frameDt : 0;
        follow.vel.x += (vx - follow.vel.x) * k0; follow.vel.z += (vz - follow.vel.z) * k0;
      }
      follow.last = { x: px, z: pz };
      const LOOK = 0.35;
      const tx = px + follow.vel.x * LOOK, tz = pz + follow.vel.z * LOOK;
      const k = 1 - Math.exp(-frameDt * 4.5);
      const dx = (tx - controls.target.x) * k, dz = (tz - controls.target.z) * k;
      controls.target.x += dx; controls.target.z += dz;
      camera.position.x += dx; camera.position.z += dz;
    }
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    name: '3d',
    render,
    resize,
    // 鏡頭的水平角度（弧度），外殼用來把「往畫面上方推」換算成地圖方向
    azimuth: () => controls.getAzimuthalAngle(),
    resetCamera() {
      const fe = followEnt();
      if (fe) { controls.target.set(wx(fe.x), 0, wz(fe.y)); camera.position.copy(controls.target).add(new THREE.Vector3(0, 24, 28)); }
      else { camera.position.copy(CAM_POS); controls.target.copy(CAM_TARGET); }
      controls.update();
    },
    // 螢幕座標 → 格子座標（點地面移動用）：射線打到 y=0 平面
    toWorld(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
      return { x: hit.x / TILE + W / 2 - 0.5, y: hit.z / TILE + H / 2 - 0.5 };
    },
    dispose() { renderer.dispose(); controls.dispose(); },
    debug: { camera, controls, scene, objs },
  };
}
