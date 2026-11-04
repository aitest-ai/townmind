// 介面外殼：把宣告式面板的節點畫成畫面、顯示提示訊息與「出錯了」畫面。
// 所有文字都用 textContent 放入，不用 innerHTML，避免資料裡的字被當成程式碼。

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };

// ---------- 面板 ----------
// onButton(node, values)：按鈕被按下；values 是同一個面板裡所有輸入框的值
export function renderNodes(container, nodes, { onButton, values }) {
  container.textContent = '';
  const button = (n) => {
    const wrap = el('span');
    const b = el('button', n.primary ? 'primary' : '', n.label);
    b.disabled = n.enabled === false;
    if (n.reason && n.enabled === false) b.title = n.reason;
    b.onclick = () => onButton(n, values);
    wrap.append(b);
    return { wrap, b };
  };
  for (const n of nodes) {
    switch (n.type) {
      case 'text': container.append(el('p', 'p-text', n.text)); break;
      case 'stat': { const d = el('div', 'p-stat'); d.append(el('span', '', n.label), el('b', '', n.value)); container.append(d); break; }
      case 'bar': {
        const d = el('div', 'p-bar'); d.append(el('span', '', n.label));
        const t = el('div', 'track'); const i = el('i'); i.style.width = `${Math.round(Math.max(0, Math.min(1, Number(n.value) || 0)) * 100)}%`;
        t.append(i); d.append(t); container.append(d); break;
      }
      case 'list': {
        const ul = el('ul', 'p-list');
        for (const it of n.items || []) { const li = el('li', '', it.label); if (it.detail) li.append(el('small', '', it.detail)); ul.append(li); }
        if (!(n.items || []).length && n.empty) ul.append(el('li', '', n.empty));
        container.append(ul); break;
      }
      case 'button': {
        const row = el('div', 'p-buttons'); const { wrap } = button(n); row.append(wrap); container.append(row);
        if (n.enabled === false && n.reason) container.append(el('span', 'why', n.reason));
        break;
      }
      case 'buttons': {
        const row = el('div', 'p-buttons');
        const why = [];
        for (const b of n.items || []) { row.append(button(b).wrap); if (b.enabled === false && b.reason) why.push(`${b.label}：${b.reason}`); }
        container.append(row);
        for (const w of why) container.append(el('span', 'why', w));
        break;
      }
      case 'input': {
        const l = el('label', 'field', n.label || '');
        const i = el('input'); i.type = 'text'; i.maxLength = n.maxLen || 60; i.placeholder = n.placeholder || '';
        i.value = values[n.name] ?? ''; i.oninput = () => { values[n.name] = i.value; };
        l.append(i); container.append(l); break;
      }
      case 'select': {
        const l = el('label', 'field', n.label || '');
        const s = el('select');
        for (const o of n.options || []) s.add(new Option(o.label, o.value));
        if (values[n.name] === undefined) values[n.name] = n.value ?? n.options?.[0]?.value;
        s.value = values[n.name]; s.onchange = () => { values[n.name] = s.value; if (n.onChange) onButton({ action: n.onChange }, values); };
        l.append(s); container.append(l); break;
      }
      case 'error': container.append(el('div', 'p-error', n.text)); break;
      default: break; // 不認得的節點：略過，不讓介面壞掉
    }
  }
}

// 面板容器：只有內容變了才重畫（保留輸入框的值）
export function createPanelHost(root) {
  const boxes = new Map();
  return {
    update(list, { onButton }) {
      const seen = new Set();
      for (const p of list) {
        seen.add(p.id);
        let box = boxes.get(p.id);
        if (!box) {
          const sec = el('section', 'panel'); sec.dataset.panel = p.id;
          const h = el('h2', '', p.title || p.id);
          const body = el('div');
          sec.append(h, body);
          box = { sec, h, body, key: '', values: {} };
          boxes.set(p.id, box);
        }
        root.append(box.sec); // 依順序重新排（append 已存在的元素只會移動）
        box.h.textContent = p.title || p.id;
        const key = JSON.stringify(p.nodes);
        if (key !== box.key) {
          box.key = key;
          renderNodes(box.body, p.nodes, { onButton: (n, values) => onButton(p, n, values), values: box.values });
        }
      }
      for (const [id, box] of boxes) if (!seen.has(id)) { box.sec.remove(); boxes.delete(id); }
    },
  };
}

// ---------- 提示與紀錄 ----------
export function toast(text, level = 'info', ms = 5000) {
  const t = el('div', `toast ${level === 'info' ? '' : level}`, text);
  $('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

const logLines = [];
export function log(text) {
  logLines.push(text);
  if (logLines.length > 80) logLines.shift();
  const box = $('log');
  if (!box) return;
  box.textContent = '';
  for (const line of logLines.slice(-30).reverse()) box.append(el('div', '', line));
}

// ---------- 出錯畫面 ----------
// info：{ title, message, hint, details: [字串], actions: [{ label, run, primary }] }
export function showFatal(info) {
  const box = document.querySelector('#fatal .box');
  box.textContent = '';
  box.append(el('h2', '', info.title || '遊戲沒辦法開始'));
  box.append(el('p', '', info.message || ''));
  if (info.hint) box.append(el('p', 'hint', `怎麼辦：${info.hint}`));
  if (info.details?.length) {
    const ul = el('ul');
    for (const d of info.details.slice(0, 30)) ul.append(el('li', '', d));
    if (info.details.length > 30) ul.append(el('li', '', `……還有 ${info.details.length - 30} 則`));
    box.append(ul);
  }
  const row = el('div', 'p-buttons');
  for (const a of info.actions || []) { const b = el('button', a.primary ? 'primary' : '', a.label); b.onclick = a.run; row.append(b); }
  box.append(row);
  $('fatal').style.display = 'block';
}
