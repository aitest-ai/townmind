// 3D 角色：統一介面，來源可以替換。
//
//   character = {
//     object : THREE.Object3D   // 原點在腳底，臉朝 +Z，高度約等於 spec.height
//     play(clip)                // 'Idle' | 'Walk' | 'Carry' | 'Work' | 'Pick' | 'Rest'
//     update(dt)                // 每個畫面幀呼叫一次
//     setTint(hex)              // 任務顏色（上衣）；GLB 角色可不實作
//     setCarry(kind|null)       // 'food' | 'wood' | 'plank' | null
//   }
//
// 來源一：這個檔案的程式生成人形（暫代用，比例刻意做成「兒童風但不是氣球人」）。
// 來源二：src/render3d/glb.js，載入 3dcodeverse-lab 資產工廠產出的 GLB（動畫名稱同上）。
import * as THREE from 'three';

export const CLIPS = ['Idle', 'Walk', 'Carry', 'Work', 'Pick', 'Rest'];

const matCache = new Map();
const M = (hex, rough = 0.85) => {
  const k = `${hex}|${rough}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0 }));
  return matCache.get(k);
};

function addAccessory(head, kind, H, headR) {
  const g = new THREE.Group();
  const top = headR * 0.55;
  switch (kind) {
    case 'hat': { // 村長：圓錐帽
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(headR * 1.5, headR * 1.5, 0.012 * H, 20), M(0x9c5a2c));
      brim.position.y = top;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(headR * 0.95, headR * 1.1, 18), M(0xb8692f));
      cone.position.y = top + headR * 0.55;
      g.add(brim, cone); break;
    }
    case 'strawhat': { // 農夫：草帽
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(headR * 1.7, headR * 1.7, 0.012 * H, 24), M(0xe3c35b));
      brim.position.y = top;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.95, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0xedd07a));
      dome.position.y = top;
      g.add(brim, dome); break;
    }
    case 'bandana': { // 伐木工：紅頭巾
      const band = new THREE.Mesh(new THREE.TorusGeometry(headR * 1.02, headR * 0.12, 8, 24), M(0xc0392b));
      band.rotation.x = Math.PI / 2; band.position.y = headR * 0.38;
      g.add(band); break;
    }
    case 'hardhat': { // 建築師：黃安全帽
      const dome = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0xf2c230, 0.5));
      dome.position.y = headR * 0.32;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(headR * 1.25, headR * 1.25, 0.012 * H, 20), M(0xf2c230, 0.5));
      brim.position.y = headR * 0.34;
      g.add(dome, brim); break;
    }
    case 'beret': { // 詩人：貝雷帽
      const b = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.15, 16, 10), M(0x7d3c98));
      b.scale.set(1, 0.38, 1); b.position.set(headR * 0.12, headR * 0.78, 0); b.rotation.z = -0.22;
      g.add(b); break;
    }
    default: return;
  }
  head.add(g);
}

export function createProceduralCharacter({
  height = 2, skin = 0xf1c9a5, hair = 0x3b2a20, shirt = 0x888888, pants = 0x3d4f73, accessory = null,
} = {}) {
  const H = height;
  const legLen = 0.43 * H, torsoH = 0.33 * H, headR = 0.105 * H;
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const upper = new THREE.Group(); upper.position.y = legLen; rig.add(upper);   // 以髖部為軸
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });

  // 軀幹：膠囊體，肩寬略大於頭寬，避免「氣球人」
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.09 * H, torsoH - 0.18 * H, 4, 10), shirtMat);
  torso.scale.set(1.25, 1, 0.85); torso.position.y = torsoH / 2; upper.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * H, 0.034 * H, 0.05 * H, 8), M(skin));
  neck.position.y = torsoH + 0.005 * H; upper.add(neck);

  // 頭
  const head = new THREE.Group(); head.position.y = torsoH + 0.02 * H + headR; upper.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 16), M(skin, 0.7)));
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.06, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), M(hair, 0.9));
  hairCap.rotation.x = -0.3; head.add(hairCap);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014 * H, 8, 8), M(0x1f1a17, 0.4));
    eye.position.set(sx * 0.04 * H, 0.008 * H, headR * 0.93); head.add(eye);
  }
  addAccessory(head, accessory, H, headR);

  // 手臂（以肩為軸）：袖子＋前臂＋手
  const makeArm = (sx) => {
    const p = new THREE.Group(); p.position.set(sx * 0.145 * H, torsoH - 0.05 * H, 0);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.038 * H, 0.1 * H, 4, 8), shirtMat); sleeve.position.y = -0.09 * H;
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.032 * H, 0.1 * H, 4, 8), M(skin, 0.7)); fore.position.y = -0.22 * H;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.036 * H, 8, 8), M(skin, 0.7)); hand.position.y = -0.31 * H;
    p.add(sleeve, fore, hand); upper.add(p); return p;
  };
  const armL = makeArm(-1), armR = makeArm(1);

  // 腿（以髖為軸）：褲子＋鞋
  const makeLeg = (sx) => {
    const p = new THREE.Group(); p.position.set(sx * 0.055 * H, legLen, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.046 * H, 0.3 * H, 4, 8), M(pants)); leg.position.y = -0.2 * H;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08 * H, 0.04 * H, 0.13 * H), M(0x2b2420, 0.8));
    shoe.position.set(0, -0.41 * H, 0.025 * H);
    p.add(leg, shoe); rig.add(p); return p;
  };
  const legL = makeLeg(-1), legR = makeLeg(1);

  // 手上搬運的東西
  const carryG = new THREE.Group(); carryG.position.set(0, torsoH * 0.5, 0.17 * H); carryG.visible = false; upper.add(carryG);
  const carryMeshes = {
    food: new THREE.Mesh(new THREE.BoxGeometry(0.2 * H, 0.14 * H, 0.2 * H), M(0xe08a2e)),
    wood: new THREE.Mesh(new THREE.CylinderGeometry(0.045 * H, 0.045 * H, 0.36 * H, 8), M(0x7a5230)),
    plank: new THREE.Mesh(new THREE.BoxGeometry(0.34 * H, 0.04 * H, 0.14 * H), M(0xcaa56a)),
  };
  carryMeshes.wood.rotation.z = Math.PI / 2;
  for (const m of Object.values(carryMeshes)) { m.visible = false; carryG.add(m); }

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ---- 動作：每個 clip 算出目標姿勢，再平滑過去 ----
  const cur = { legL: 0, legR: 0, armL: 0, armR: 0, rigY: 0, lean: 0, bob: 0 };
  let clip = 'Idle', t = Math.random() * 10;

  function target(c) {
    const s8 = Math.sin(t * 8), s7 = Math.sin(t * 7);
    switch (c) {
      case 'Walk': return { legL: s8 * 0.75, legR: -s8 * 0.75, armL: -s8 * 0.6, armR: s8 * 0.6, rigY: 0, lean: 0.05, bob: Math.abs(s8) * 0.018 * H };
      case 'Carry': return { legL: s8 * 0.7, legR: -s8 * 0.7, armL: -1.05, armR: -1.05, rigY: 0, lean: -0.04, bob: Math.abs(s8) * 0.014 * H };
      case 'Work': return { legL: 0.15, legR: -0.15, armL: -1.5 - s7 * 0.5, armR: -1.9 - s7 * 0.8, rigY: 0, lean: 0.1 + s7 * 0.08, bob: 0 };
      case 'Pick': return { legL: 0.2, legR: -0.2, armL: -0.4 + Math.sin(t * 5) * 0.2, armR: -0.5 - Math.sin(t * 5) * 0.2, rigY: 0, lean: 0.75 + Math.sin(t * 5) * 0.08, bob: 0 };
      case 'Rest': return { legL: -1.45, legR: -1.45, armL: -0.45, armR: -0.45, rigY: -(legLen - 0.06 * H), lean: 0.05 + Math.sin(t * 1.4) * 0.02, bob: 0 };
      default: return { legL: 0, legR: 0, armL: Math.sin(t * 1.6) * 0.05, armR: -Math.sin(t * 1.6) * 0.05, rigY: 0, lean: 0, bob: Math.sin(t * 2.2) * 0.004 * H };
    }
  }

  return {
    object: root,
    play(name) { clip = CLIPS.includes(name) ? name : 'Idle'; },
    update(dt) {
      t += dt;
      const g = target(clip), k = Math.min(1, dt * 12);
      for (const key in cur) cur[key] += (g[key] - cur[key]) * k;
      legL.rotation.x = cur.legL; legR.rotation.x = cur.legR;
      armL.rotation.x = cur.armL; armR.rotation.x = cur.armR;
      upper.rotation.x = cur.lean;
      rig.position.y = cur.rigY + cur.bob;
    },
    setTint(hex) { shirtMat.color.setHex(hex); },
    setCarry(kind) {
      carryG.visible = !!kind;
      for (const [k, m] of Object.entries(carryMeshes)) m.visible = k === kind;
    },
  };
}
