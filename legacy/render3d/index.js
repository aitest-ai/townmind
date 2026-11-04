// 3D 視圖：吃同一份世界資料（world / npcs），只負責畫，不改任何遊戲狀態。
// 座標：世界 (x, y) → 3D (x, z)，1 世界單位 = 0.1 公尺，並以倉庫為原點。
// 尺度是「玩具比例」：人物比真實比例大一點，從高處看才看得清楚。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TASK_COLOR } from '../world.js';
import { npcPos } from '../layout.js';
import { createProceduralCharacter } from './characters.js';

const S = 0.1;
const wx = (x) => (x - 400) * S;
const wz = (y) => (y - 260) * S;
const WORKER_H = 2.6, RESIDENT_H = 3.1;
const FONT = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif";

const SKINS = [0xf1c9a5, 0xe5b48b, 0xd39b72, 0xf6d5b8, 0xc68863];
const HAIRS = [0x2b1f18, 0x3b2a20, 0x5a3b22, 0x1a1a1a, 0x7a5a30];
const PANTS = [0x3d4f73, 0x4a5a40, 0x5a4a3a, 0x3a3a4a];

const lerpAngle = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};
const std = (hex, rough = 0.9) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0 });

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

// ---------- 主函式 ----------
export async function createRenderer3D(canvas, world, npcs) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const SKY = 0xcfe8f5;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 95, 230);

  const camera = new THREE.PerspectiveCamera(42, 800 / 520, 0.5, 400);
  const CAM_POS = new THREE.Vector3(0, 46, 56), CAM_TARGET = new THREE.Vector3(0, 0, 2);
  camera.position.copy(CAM_POS);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(CAM_TARGET);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 10; controls.maxDistance = 120;
  controls.screenSpacePanning = false;
  controls.update();

  // 光
  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x7a9a5a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -56, right: 56, top: 46, bottom: -46, near: 1, far: 160 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // 地面
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), std(0x7fae5f, 1)); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true; scene.add(outer);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(82, 54), std(0xa3cf78, 1)); field.rotation.x = -Math.PI / 2; field.receiveShadow = true; scene.add(field);

  // 裝飾：外圈森林、花（只是好看，與遊戲無關）
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const FOREST = 90;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.55, 2.4, 6), std(0x6b4a2b), FOREST);
  const crownA = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 3.4, 7), std(0x3a7f40), FOREST);
  const crownB = new THREE.InstancedMesh(new THREE.ConeGeometry(1.9, 3.0, 7), std(0x48994d), FOREST);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < FOREST; i++) {
    let x, z;
    do { x = (rnd() - 0.5) * 190; z = (rnd() - 0.5) * 150; } while (Math.abs(x) < 43 && Math.abs(z) < 29);
    const sc = 0.8 + rnd() * 0.9;
    m4.compose(new THREE.Vector3(x, 1.2 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, 3.6 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); crownA.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, 5.6 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); crownB.setMatrixAt(i, m4);
  }
  [trunks, crownA, crownB].forEach((m) => { m.castShadow = true; scene.add(m); });
  const FLOWERS = 140;
  const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 5), std(0xffffff, 0.6), FLOWERS);
  const palette = [0xffffff, 0xffd84a, 0xff8fb1, 0xb59cff];
  for (let i = 0; i < FLOWERS; i++) {
    const x = (rnd() - 0.5) * 78, z = (rnd() - 0.5) * 50;
    m4.compose(new THREE.Vector3(x, 0.14, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); flowers.setMatrixAt(i, m4);
    flowers.setColorAt(i, new THREE.Color(palette[i % 4]));
  }
  scene.add(flowers);

  // 倉庫與庫存
  const stock = makeStockpile(); scene.add(stock);
  const depotLabel = makeTextSprite(); depotLabel.userData.set('倉庫'); depotLabel.position.set(0, 5.3, -2.2); scene.add(depotLabel);

  // 資源點（樹與灌木）
  const resObjs = world.res.map((r) => {
    const o = r.type === 'wood' ? makeTree() : makeBush();
    o.position.set(wx(r.x), 0, wz(r.y)); o.rotation.y = rnd() * 6.28; scene.add(o); return { r, o };
  });

  // 房屋與工地
  const houseObjs = [];
  const site = makeSite(); site.visible = false; scene.add(site);
  let siteProg = 0;

  // 群體小人
  const workerObjs = new Map();
  for (const wk of world.workers) {
    const ch = createProceduralCharacter({
      height: WORKER_H, skin: SKINS[wk.id % SKINS.length], hair: HAIRS[(wk.id * 3) % HAIRS.length],
      pants: PANTS[wk.id % PANTS.length], shirt: 0x9a9a9a,
    });
    ch.object.position.set(wx(wk.x), 0, wz(wk.y)); scene.add(ch.object);
    workerObjs.set(wk.id, { ch, px: wx(wk.x), pz: wz(wk.y), yaw: Math.random() * 6.28 });
  }

  // 居民（角色卡可指定 model 走 GLB，否則用程式生成角色）
  const resObjsN = [];
  async function buildResident(n) {
    let ch = null;
    if (n.model) {
      try {
        const { loadGLBCharacter } = await import('./glb.js');
        ch = await loadGLBCharacter(n.model, { height: RESIDENT_H });
      } catch (e) {
        console.warn(`居民 ${n.name} 的 GLB 載入失敗，改用程式生成角色：`, e);
      }
    }
    if (!ch) {
      ch = createProceduralCharacter({
        height: RESIDENT_H, shirt: parseInt(n.color.slice(1), 16),
        skin: n.look?.skin ?? SKINS[0], hair: n.look?.hair ?? HAIRS[0], accessory: n.look?.accessory ?? null,
      });
    }
    scene.add(ch.object);
    const name = makeTextSprite(); name.userData.set(`${n.name}・${n.role}`, { size: 26 }); name.position.y = RESIDENT_H + 0.9; ch.object.add(name);
    const bubble = makeTextSprite(); bubble.position.y = RESIDENT_H + 2.6; bubble.visible = false; ch.object.add(bubble);
    return { n, ch, bubble, name };
  }
  for (const n of npcs) resObjsN.push(await buildResident(n));

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
  new ResizeObserver(resize).observe(canvas);

  // ---------- 每幀更新 ----------
  const clock = { t: 0 };
  function render(frameDt, simDt, speed) {
    resize();
    clock.t += frameDt;
    const animDt = frameDt * Math.min(speed || 1, 3);

    // 太陽緩慢繞行（陰影跟著動，純視覺）
    const a = 0.7 + world.t * 0.012;
    sun.position.set(Math.cos(a) * 38, 55, Math.sin(a) * 30 + 10);
    sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();

    // 資源點大小跟著剩餘量變化
    for (const { r, o } of resObjs) o.scale.setScalar(0.3 + 0.7 * (r.left / r.max));

    // 庫存視覺
    const logs = stock.userData.logs, food = stock.userData.food;
    logs.forEach((m, i) => { m.visible = i < Math.ceil(Math.min(world.stock.wood, 24) / 2); });
    food.forEach((b, i) => { b.visible = i < Math.ceil(Math.min(world.stock.food, 40) / 4); });

    // 房屋
    while (houseObjs.length < world.houses.length) {
      const i = houseObjs.length, h = world.houses[i];
      const g = makeHouse(i); g.position.set(wx(h.x), 0, wz(h.y));
      g.rotation.y = Math.atan2(-wx(h.x), -wz(h.y)); g.scale.setScalar(0.01);
      scene.add(g); houseObjs.push({ g, born: clock.t });
    }
    for (const h of houseObjs) {
      const k = Math.min(1, (clock.t - h.born) / 0.6);
      h.g.scale.setScalar(0.01 + 0.99 * (1 - Math.pow(1 - k, 3)));
    }

    // 工地：牆隨進度長高
    if (world.site) {
      site.visible = true;
      site.position.set(wx(world.site.x), 0, wz(world.site.y));
      const goal = world.site.progress / world.site.need;
      siteProg += (goal - siteProg) * Math.min(1, frameDt * 4);
    } else {
      site.visible = false; siteProg = 0;
    }
    const wallH = Math.max(0.02, siteProg * 2.2);
    site.userData.walls.scale.y = wallH; site.userData.walls.position.y = wallH / 2;

    // 群體小人
    for (const wk of world.workers) {
      const c = workerObjs.get(wk.id);
      const px = wx(wk.x), pz = wz(wk.y);
      const dx = px - c.px, dz = pz - c.pz, dist = Math.hypot(dx, dz);
      const vel = simDt > 0 ? dist / simDt : 0;
      const moving = vel > 0.8;
      if (dist > 0.003) c.yaw = lerpAngle(c.yaw, Math.atan2(dx, dz), Math.min(1, frameDt * 10));
      c.px = px; c.pz = pz;
      c.ch.object.position.set(px, 0, pz); c.ch.object.rotation.y = c.yaw;
      c.ch.setTint(parseInt(TASK_COLOR[wk.task].slice(1), 16));
      c.ch.setCarry(wk.carry > 0 ? (wk.task === 'gather_food' ? 'food' : wk.task === 'gather_wood' ? 'wood' : 'plank') : null);
      let clip;
      if (wk.state === 'work') clip = wk.task === 'gather_food' ? 'Pick' : 'Work';
      else if (moving) clip = wk.carry > 0 ? 'Carry' : 'Walk';
      else clip = wk.task === 'rest' ? 'Rest' : 'Idle';
      c.ch.play(clip); c.ch.update(animDt);
    }

    // 居民
    for (const r of resObjsN) {
      const p = npcPos(world, r.n);
      const px = wx(p.x), pz = wz(p.y);
      r.ch.object.position.set(px, 0, pz);
      r.ch.object.rotation.y = Math.atan2(-px, -pz);
      r.ch.play('Idle'); r.ch.update(animDt);
      const speaking = world.t < r.n.sayUntil && r.n.say;
      if (r.n.busy) { r.bubble.visible = true; r.bubble.userData.set('…', { bubble: true, size: 34 }); }
      else if (speaking) { r.bubble.visible = true; r.bubble.userData.set(r.n.say, { bubble: true }); }
      else r.bubble.visible = false;
    }

    // 文字標籤的大小跟著鏡頭距離調整：遠看不會太小、近看不會擋住畫面
    const tmp = new THREE.Vector3();
    const fit = (sp) => {
      if (!sp.visible || !sp.userData.base) return;
      sp.getWorldPosition(tmp);
      const k = THREE.MathUtils.clamp(camera.position.distanceTo(tmp) / 45, 0.4, 1.7);
      sp.scale.set(sp.userData.base.w * k, sp.userData.base.h * k, 1);
    };
    fit(depotLabel);
    for (const r of resObjsN) { fit(r.name); fit(r.bubble); }

    controls.update();
    renderer.render(scene, camera);
  }

  return {
    name: '3d',
    render,
    resetCamera() { camera.position.copy(CAM_POS); controls.target.copy(CAM_TARGET); controls.update(); },
    dispose() { renderer.dispose(); },
    debug: { camera, controls, scene }, // 除錯與自動測試用
  };
}
