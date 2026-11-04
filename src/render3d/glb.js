// GLB 角色轉接器：把 3dcodeverse-lab 資產工廠產出的 GLB 包成和程式生成角色相同的介面。
// ⚠ 尚未用真實 GLB 實測（目前專案內沒有工廠產出的角色檔）。第一個角色進來時請先驗證：
//   1. 動畫名稱（見下方 ALIASES）  2. 尺度與朝向（asset_manifest.json 的 unit/forward）  3. 腳是否貼地
//
// 工廠規範（見 3dcodeverse-lab 的 docs/AI_ASSET_PIPELINE.md）：
//   GLB 自帶骨架與動畫；動畫用可辨識名稱；asset_manifest.json 的 clips 列出動畫清單。
// 本專案要求的動畫：Idle、Walk、Carry、Work、Pick、Rest。缺少時用 ALIASES 退而求其次。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const ALIASES = {
  Idle: ['Idle'],
  Walk: ['Walk', 'Run'],
  Carry: ['Carry', 'Walk', 'Run'],
  Work: ['Work', 'Punch', 'Idle'],
  Pick: ['Pick', 'Work', 'Idle'],
  Rest: ['Rest', 'Sit', 'Idle'],
};

const cache = new Map(); // url -> Promise<gltf>，同一個模型只下載一次，多個角色用 SkeletonUtils.clone

export async function loadGLBCharacter(url, { height = 2 } = {}) {
  if (!cache.has(url)) cache.set(url, new GLTFLoader().loadAsync(url));
  const gltf = await cache.get(url);
  const object = clone(gltf.scene);

  // 以包圍盒把高度縮放到 height，並把腳底放到 y=0
  const box = new THREE.Box3().setFromObject(object);
  const h = box.max.y - box.min.y || 1;
  const wrapper = new THREE.Group();
  object.scale.setScalar(height / h);
  object.position.y = -box.min.y * (height / h);
  wrapper.add(object);
  object.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const mixer = new THREE.AnimationMixer(object);
  const actions = new Map(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
  const find = (name) => {
    for (const n of ALIASES[name] || [name]) {
      if (actions.has(n)) return actions.get(n);
      const hit = [...actions.keys()].find((k) => k.endsWith('_' + n));
      if (hit) return actions.get(hit);
    }
    return null;
  };
  let active = null;

  return {
    object: wrapper,
    animationNames: [...actions.keys()],
    play(name) {
      const next = find(name);
      if (!next || next === active) return;
      next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      if (active) next.crossFadeFrom(active, 0.15, false);
      active = next;
    },
    update(dt) { mixer.update(Math.min(Math.max(dt, 0), 0.1)); },
    setTint() {},   // GLB 角色自帶材質，不依任務換色
    setCarry() {},  // 之後可在骨架手部掛點加上搬運物
  };
}
