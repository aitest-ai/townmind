// 種子亂數：同樣的種子 → 同樣的結果。離線補算、競賽重播、測試都靠它「可重現」。
// 用 sfc32（四個 32 位元整數的狀態），狀態是純資料，可以存進存檔。不依賴瀏覽器或 Node。

// 把字串或數字變成 32 位元雜湊（用來從主種子衍生每個模組自己的亂數流）
export function hashSeed(...parts) {
  let h = 1779033703 ^ 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ 0x9e3779b9, 2654435761);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function createRng(seed = 1) {
  let a = hashSeed('a', seed), b = hashSeed('b', seed), c = hashSeed('c', seed), d = hashSeed('d', seed);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next(); // 暖機
  return {
    next,                                                   // [0, 1)
    int: (min, max) => min + Math.floor(next() * (max - min + 1)), // 含兩端
    pick: (list) => (list.length ? list[Math.floor(next() * list.length)] : undefined),
    chance: (p) => next() < p,
    getState: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
    setState: (s) => {
      if (!Array.isArray(s) || s.length !== 4 || !s.every((x) => Number.isInteger(x))) throw new Error('亂數狀態格式不對');
      [a, b, c, d] = s;
    },
  };
}
