// 2D／3D 視圖共用：居民站位（繞著倉庫排成一圈，單位為世界座標）。
export function npcPos(world, n) {
  return { x: world.base.x + Math.cos(n.angle) * 62, y: world.base.y + Math.sin(n.angle) * 40 };
}
