#!/usr/bin/env node
/**
 * pptx-designer deck-render.cjs — DECK JSON → 纯 deck HTML
 *
 * 供 serve-export.cjs 使用：把编辑器导出的 deck（{design, pages}）渲染为
 * 满足 html-deck-to-pptx 引擎 DOM 契约（#deck > .slide）的静态 HTML，
 * 再交给引擎导出可编辑 .pptx / PDF。
 *
 * 与编辑器/preview 同一渲染源（visual/elHtml.js + visual/themes.js），
 * 保证「编辑器所见 = 导出所得」。
 * 图片元素内联 base64（成品不依赖原始素材路径，且避免 file:// 跨目录限制）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { elHtml, decorationHtml, esc } = require(path.join(__dirname, '..', 'visual', 'elHtml.js'));
const { THEMES, CANVAS_W, CANVAS_H, themeCSS } = require(path.join(__dirname, '..', 'visual', 'themes.js'));

/** 图片元素 → base64 data URL（读取失败回退占位） */
function imageDataUrl(el) {
  try {
    const abs = path.resolve(el.path || '');
    if (fs.existsSync(abs)) {
      const ext = (path.extname(abs) || '').toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png';
      return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
    }
  } catch {}
  return null;
}

/** 单元素渲染：image 走 base64 内联，其余走统一 elHtml */
function renderEl(el, page, theme) {
  if (el.type === 'image') {
    const style = `left:${el.x || 0}px;top:${el.y || 0}px;width:${el.w || 0}px;height:${el.h || 0}px;`;
    const data = imageDataUrl(el);
    if (data) {
      const fit = el.objectFit === 'contain' ? 'contain' : 'cover';
      const radius = el.radius ? `border-radius:${el.radius}px;` : '';
      return `<img src="${data}" style="position:absolute;${style}object-fit:${fit};${radius}"/>`;
    }
    const cap = el.caption ? `图片占位 · ${el.caption}` : '图片占位';
    return `<div style="position:absolute;${style};background:#E2E8F0;border-radius:${el.radius || 8}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px"><div style="font-size:16px;color:#64748B">${esc(cap)}</div><div style="font-size:10px;color:#94A3B8;word-break:break-all;padding:0 12px">${esc(el.path || '')}</div></div>`;
  }
  return elHtml(el, page, theme);
}

/** 单页渲染（背景 + 装饰层 + 元素层） */
function renderSlide(page, index, design) {
  const themeId = page.theme || (design && design.theme) || 'generic';
  const theme = THEMES[themeId] || THEMES.generic;
  // 背景：页面显式背景优先，否则主题背景 + 纹理（与编辑器渲染一致）
  let bgCss = '';
  if (page.background) {
    bgCss = `background:${page.background};`;
  } else {
    bgCss = `background:${themeCSS(themeId)};`;
  }
  const deco = decorationHtml(page, theme);
  const els = (page.elements || []).map(el => renderEl(el, page, theme)).join('');
  const active = index === 0 ? ' data-deck-active="true"' : '';
  return `<div class="slide"${active} style="width:${CANVAS_W}px;height:${CANVAS_H}px;position:relative;overflow:hidden;${bgCss}box-sizing:border-box;font-family:'微软雅黑',sans-serif">${deco}${els}</div>`;
}

/**
 * 渲染完整 deck HTML。
 * @param {{design?:object, pages?:Array}} deck 与编辑器 DECK 同构
 * @returns {string} 满足 #deck > .slide 契约的完整 HTML
 */
function renderDeckHtml(deck) {
  const design = (deck && deck.design) || {};
  const pages = (deck && deck.pages) || [];
  const title = esc(design.title || 'PPT');
  const slides = pages.map((p, i) => renderSlide(p, i, design)).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1E293B; }
  #deck { width: ${CANVAS_W}px; }
  .slide { position: relative; width: ${CANVAS_W}px; height: ${CANVAS_H}px; overflow: hidden; }
  .slide img { display: block; }
</style>
</head>
<body>
<div id="deck">
${slides}
</div>
<script>
  // html-deck-to-pptx 引擎翻页运行时：window.go(index) 切换 active 页
  window.go = function (index, opts) {
    var slides = document.querySelectorAll('#deck > .slide');
    for (var i = 0; i < slides.length; i++) {
      if (i === index) { slides[i].classList.add('active'); slides[i].setAttribute('data-deck-active', 'true'); }
      else { slides[i].classList.remove('active'); slides[i].removeAttribute('data-deck-active'); }
    }
  };
  window.__getVisibleSlides = function () {
    return Array.prototype.slice.call(document.querySelectorAll('#deck > .slide'));
  };
</script>
</body>
</html>`;
}

module.exports = { renderDeckHtml, renderSlide };

// CLI 直用：node deck-render.cjs <deck.json> -o <out.html>
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const input = get('-i') || args[0];
  const out = get('-o') || 'deck-export.html';
  if (!input) { console.error('用法: node deck-render.cjs <deck.json> -o <out.html>'); process.exit(2); }
  const deck = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  fs.writeFileSync(path.resolve(out), renderDeckHtml(deck), 'utf8');
  console.log('✅ deck HTML 已生成: ' + path.resolve(out));
}
