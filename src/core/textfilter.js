// 玩家輸入的內容過濾（兒童向）。純函式，不依賴瀏覽器，可在 Node 測試。
// 這是「最低限度」的本機過濾：擋明顯不適合的字詞與個人資料（電話、網址、Email）。
// 不會把句子送到任何外部服務。世界包或學校可以用 services.textFilter 換成更完整的版本。
//
// 回傳 { ok: true, text } 或 { ok: false, reason }（reason 是給小朋友看的白話）。

const BLOCK_WORDS = [
  // 暴力、傷害
  '殺人', '殺了你', '殺死', '去死', '砍死', '打死', '自殺', '血腥', '開槍', '炸彈', '毒品',
  // 辱罵
  '白痴', '白癡', '智障', '笨蛋', '蠢', '廢物', '垃圾人', '滾開', '閉嘴', '幹你', '靠北', '他媽', '媽的', '屁眼', '王八',
  // 成人
  '色情', '做愛', '裸', '性交',
  // 英文
  'fuck', 'shit', 'bitch', 'porn', 'nigger', 'asshole',
];

const PERSONAL = [
  { re: /(?:\+?886|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}/, reason: '不要在遊戲裡寫電話號碼喔' },
  { re: /\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}/, reason: '不要在遊戲裡寫電話號碼喔' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, reason: '不要在遊戲裡寫 Email 喔' },
  { re: /(https?:\/\/|www\.)\S+/i, reason: '遊戲裡不能貼網址喔' },
  { re: /[A-Z][12]\d{8}/i, reason: '不要在遊戲裡寫身分證字號喔' },
];

// 把常見的規避寫法收斂：全形轉半形、去掉空白與符號、轉小寫。
function normalize(s) {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　_\-.*~!@#$%^&()+=|\\/,，。、！？?「」『』【】…]/g, '')
    .toLowerCase();
}

export function defaultTextFilter(text, { audience = 'children', maxLen = 200 } = {}) {
  if (typeof text !== 'string') return { ok: false, reason: '只能輸入文字' };
  let t = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (t.length > maxLen) t = t.slice(0, maxLen);
  for (const p of PERSONAL) if (p.re.test(t)) return { ok: false, reason: p.reason };
  if (audience === 'children') {
    const n = normalize(t);
    if (BLOCK_WORDS.some((w) => n.includes(w))) return { ok: false, reason: '這句話有不適合的字，換個說法吧' };
  }
  return { ok: true, text: t };
}
