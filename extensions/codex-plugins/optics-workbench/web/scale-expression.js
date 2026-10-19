"use strict";

// Arithmetic only: no JavaScript evaluation or identifiers.
(() => {
  function parseScaleExpression(input) {
    if (typeof input !== "string" || input.length > 128) throw new Error("倍率算式过长，请简化输入。");
    const text = input.replace(/\s+/g, "");
    let pos = 0, depth = 0;
    function finite(value) {
      if (!Number.isFinite(value)) throw new Error("算式结果必须是有限数值。");
      return value;
    }
    function primary() {
      if (++depth > 32) throw new Error("括号或符号层数过多。");
      let value;
      const char = text[pos];
      if (char === "+" || char === "-") {
        pos++; value = primary() * (char === "-" ? -1 : 1);
      } else if (char === "(") {
        pos++; value = expression();
        if (text[pos++] !== ")") throw new Error("请补全算式括号。");
      } else {
        const match = text.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
        if (!match) throw new Error("请输入数字或算式，例如 47/39；支持 + - * / 和括号。");
        pos += match[0].length; value = finite(Number(match[0]));
      }
      depth--; return finite(value);
    }
    function term() {
      let value = primary();
      while (text[pos] === "*" || text[pos] === "/") {
        const op = text[pos++], right = primary();
        if (op === "/" && right === 0) throw new Error("除数不能为 0。");
        value = finite(op === "*" ? value * right : value / right);
      }
      return value;
    }
    function expression() {
      let value = term();
      while (text[pos] === "+" || text[pos] === "-") {
        const op = text[pos++], right = term();
        value = finite(op === "+" ? value + right : value - right);
      }
      return value;
    }
    const factor = expression();
    if (pos !== text.length) throw new Error("算式仅支持数字、+ - * / 和括号，例如 47/39。");
    if (factor < 0.01 || factor > 100) throw new Error("计算后的倍率须在 0.01–100 之间。");
    return factor;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = {parseScaleExpression};
  else window.OpticsScaleExpression = {parseScaleExpression};
})();
