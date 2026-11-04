// 輸入：鍵盤方向鍵／WASD、觸控搖桿、在畫面上「點一下」走過去。
// 方向是「螢幕方向」（上＝往畫面上方），由外殼依鏡頭角度換算成地圖方向，所以 3D 轉了鏡頭之後，往上推還是往前走。
// 拖曳（旋轉 3D 鏡頭）不算點一下：按下到放開不超過 300 毫秒、移動不超過 8 像素才算。
const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };

export function attachInput({ stage, onTap, onInteract, joystick = false }) {
  const down = new Set();
  let stick = { x: 0, y: 0 };
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  addEventListener('keydown', (e) => {
    if (typing()) return;
    if (KEYS[e.code]) { down.add(e.code); e.preventDefault(); }
    else if ((e.code === 'Space' || e.code === 'KeyE') && onInteract) { onInteract(); e.preventDefault(); }
  });
  addEventListener('keyup', (e) => { down.delete(e.code); });
  addEventListener('blur', () => { down.clear(); stick = { x: 0, y: 0 }; });

  // 點一下走過去
  let press = null;
  stage.addEventListener('pointerdown', (e) => { if (e.isPrimary && !e.target.closest('.joystick, button')) press = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  stage.addEventListener('pointerup', (e) => {
    if (!press || !e.isPrimary) return;
    const quick = performance.now() - press.t < 300 && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8;
    press = null;
    if (quick && !e.target.closest('.joystick, button')) onTap?.(e.clientX, e.clientY);
  });

  // 觸控搖桿：左下角，推多少走多快
  let el = null;
  if (joystick) {
    el = document.createElement('div');
    el.className = 'joystick';
    el.setAttribute('aria-label', '移動搖桿');
    const knob = document.createElement('div'); knob.className = 'knob'; el.append(knob);
    stage.append(el);
    let active = null;
    const R = 46;
    const move = (e) => {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const m = Math.min(1, d / R);
      stick = m < 0.15 ? { x: 0, y: 0 } : { x: (dx / R), y: (dy / R) };
    };
    el.addEventListener('pointerdown', (e) => { active = e.pointerId; el.setPointerCapture(e.pointerId); move(e); e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === active) move(e); });
    const end = (e) => { if (e.pointerId !== active) return; active = null; stick = { x: 0, y: 0 }; knob.style.transform = ''; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  return {
    // 目前的方向（螢幕座標，長度 0～1）
    vector() {
      let x = stick.x, y = stick.y;
      for (const k of down) { x += KEYS[k][0]; y += KEYS[k][1]; }
      const l = Math.hypot(x, y);
      return l > 1 ? { x: x / l, y: y / l } : { x, y };
    },
    joystick: el,
  };
}
