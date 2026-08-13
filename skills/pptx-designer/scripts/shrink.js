/**
 * shrink.js — 文本自适应缩放（build.js 与 preview.js 共享）
 *
 * 原理：在渲染前估算文本在容器内的换行行数与总高度，
 * 超出容器高度时按比例缩小字号。HTML 预览与 PPTX 使用同一算法，
 * 保证两端显示一致，不依赖 WPS/PowerPoint 的 normAutofit。
 */
const CHAR_W_CJK = 1.05;  // 全角字符宽度 ≈ 1.05em（微软雅黑实际略宽，保守）
const CHAR_W_NUM = 0.62;  // 数字 ≈ 0.62em
const CHAR_W_ASCII = 0.58; // 半角字母/符号 ≈ 0.58em
const LINE_H_FACTOR = 1.5; // 行高保守系数（WPS 实际行高常高于 1.4em）

function charWidth(ch) {
  const code = ch.charCodeAt(0);
  if (code > 0x2E80) return CHAR_W_CJK;
  if (/[0-9]/.test(ch)) return CHAR_W_NUM;
  return CHAR_W_ASCII;
}

/**
 * 计算文本元素的缩放系数
 * @param {object} el 文本元素 {x,y,w,h,text|runs,fontSize,lineSpacing}
 * @returns {{factor:number, fontSize:number, lineH:number}}
 */
function shrinkFactor(el) {
  const w = el.w || 200;
  const h = el.h || 100;
  // 基准字号取元素与 runs 中的最大值（保守：避免大字号 run 溢出）
  const baseFs = Math.max(
    el.fontSize || 18,
    ...(el.runs || []).map(r => r.fontSize || el.fontSize || 18)
  );
  const lineH = el.lineSpacing || Math.round(baseFs * LINE_H_FACTOR);
  // 拼接全文（runs 拼一起，按行分割）
  const text = (el.runs && el.runs.length ? el.runs.map(r => r.text) : [el.text || '']).join('');
  const rawLines = text.split('\n');

  // 估算换行后的总行数（宽度超出自动换行）
  let wrappedLines = 0;
  rawLines.forEach(line => {
    let lineW = 0;
    for (const ch of line) lineW += charWidth(ch) * baseFs;
    wrappedLines += Math.max(1, Math.ceil(lineW / Math.max(1, w)));
  });
  const totalH = wrappedLines * lineH;

  let factor = 1;
  if (totalH > h) factor = Math.min(factor, h / totalH);
  // 单行最宽也不得超过容器宽（极端保护：容器极窄时）
  const maxLineW = rawLines.reduce((m, line) => {
    let lw = 0;
    for (const ch of line) lw += charWidth(ch) * baseFs;
    return Math.max(m, lw);
  }, 0);
  if (maxLineW > w * 1.02 && wrappedLines === rawLines.length) {
    // 每行都无法换行（单字符超宽场景），按宽度缩
    factor = Math.min(factor, w / maxLineW);
  }

  return { factor, fontSize: Math.round(baseFs * factor), lineH: Math.round(lineH * factor) };
}

module.exports = { shrinkFactor, charWidth };
