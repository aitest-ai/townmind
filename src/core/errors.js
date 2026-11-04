// 框架錯誤：訊息一律是白話的繁體中文，並附上「怎麼辦」的提示。
// 使用者不看程式碼，介面要能把這些訊息直接顯示出來。
export class FrameworkError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'FrameworkError';
    this.code = code;
    this.hint = hint;
  }
}
