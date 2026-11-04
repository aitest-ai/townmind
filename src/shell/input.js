// 輸入：鍵盤方向鍵／WASD，以及在畫面上「點一下」走過去。
// 拖曳（旋轉 3D 鏡頭）不算點一下：按下到放開不超過 300 毫秒、移動不超過 8 像素才算。
const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };

export function attachInput({ stage, player, toWorld, onInteract }) {
  const down = new Set();
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const apply = () => {
    let x = 0, y = 0;
    for (const k of down) { x += KEYS[k][0]; y += KEYS[k][1]; }
    player.setDirection(x, y);
  };
  addEventListener('keydown', (e) => {
    if (typing()) return;
    if (KEYS[e.code]) { down.add(e.code); apply(); e.preventDefault(); }
    else if ((e.code === 'Space' || e.code === 'KeyE') && onInteract) { onInteract(); e.preventDefault(); }
  });
  addEventListener('keyup', (e) => { if (down.delete(e.code)) apply(); });
  addEventListener('blur', () => { down.clear(); apply(); });

  let press = null;
  stage.addEventListener('pointerdown', (e) => { if (e.isPrimary) press = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  stage.addEventListener('pointerup', (e) => {
    if (!press || !e.isPrimary) return;
    const quick = performance.now() - press.t < 300 && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8;
    press = null;
    if (!quick || e.target.closest('button')) return;
    const p = toWorld(e.clientX, e.clientY);
    if (p) player.setTarget(p.x, p.y);
  });
}
