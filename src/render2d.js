// 2D 俯視圖（原本寫在 main.js，抽出來成為可切換的視圖之一）。
// 所有視圖都實作同一個介面：render(frameDt, simDt, speed)。
import { TASK_COLOR } from './world.js';
import { npcPos } from './layout.js';

const FONT = "13px 'Noto Sans TC', system-ui, sans-serif";

export function createRenderer2D(canvas, world, npcs) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e9f1dc'; ctx.fillRect(0, 0, W, H);
    ctx.font = FONT; ctx.textAlign = 'center';

    // 倉庫
    ctx.fillStyle = '#d8c7a3';
    ctx.beginPath(); ctx.arc(world.base.x, world.base.y, 22, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#6b5b3a'; ctx.fillText('倉庫', world.base.x, world.base.y + 4);

    // 資源點
    for (const r of world.res) {
      const size = 7 + (r.left / r.max) * 10;
      ctx.fillStyle = r.type === 'food' ? '#6bbf59' : '#7a5230';
      ctx.beginPath(); ctx.arc(r.x, r.y, size, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif';
      ctx.fillText(Math.floor(r.left), r.x, r.y + 3);
      ctx.font = FONT;
    }

    // 房子與工地
    for (const h of world.houses) {
      ctx.fillStyle = '#e8d6a8'; ctx.fillRect(h.x - 9, h.y - 6, 18, 14);
      ctx.fillStyle = '#c0583a';
      ctx.beginPath(); ctx.moveTo(h.x - 11, h.y - 6); ctx.lineTo(h.x, h.y - 16); ctx.lineTo(h.x + 11, h.y - 6); ctx.fill();
    }
    if (world.site) {
      const s = world.site;
      ctx.strokeStyle = '#4a7fd0'; ctx.setLineDash([4, 3]); ctx.strokeRect(s.x - 11, s.y - 9, 22, 18); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(74,127,208,.35)';
      ctx.fillRect(s.x - 11, s.y + 9 - (18 * s.progress) / s.need, 22, (18 * s.progress) / s.need);
    }

    // 群體小人
    for (const k of world.workers) {
      ctx.fillStyle = TASK_COLOR[k.task];
      ctx.beginPath(); ctx.arc(k.x, k.y, 4.5, 0, 6.283); ctx.fill();
      if (k.carry) { ctx.fillStyle = '#222'; ctx.fillRect(k.x - 2, k.y - 9, 4, 4); }
    }

    // 居民
    for (const n of npcs) {
      const p = npcPos(world, n);
      ctx.fillStyle = n.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#222'; ctx.fillText(n.name, p.x, p.y + 26);
      if (n.busy) { ctx.fillStyle = '#555'; ctx.fillText('…', p.x, p.y + 4); }
      if (world.t < n.sayUntil && n.say) {
        const txt = n.say.length > 22 ? n.say.slice(0, 22) + '…' : n.say;
        const w = ctx.measureText(txt).width + 14;
        const bx = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, p.x));
        const by = p.y - 28;
        ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(bx - w / 2, by - 15, w, 22, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.fillText(txt, bx, by);
      }
    }
  }

  return { name: '2d', render, resetCamera() {} };
}
