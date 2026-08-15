#!/usr/bin/env node
/**
 * pptx-designer visual/elHtml.js — 统一 HTML 元素渲染（preview.js + render-editor.js 共享）
 *
 * 覆盖原有元素：text/rect/roundRect/ellipse/line/image/chart/table
 * 新增增强元素（双引擎视觉）：gradientBar / glowOrb / decoBlock / kpiBlock
 *   - gradientBar  渐变条（linear-gradient）
 *   - glowOrb      光晕（radial-gradient，深色主题光效）
 *   - decoBlock    半透明装饰块
 *   - kpiBlock     色块衬底 + 大数字（高亮 KPI）
 *
 * shrinkFactor 借用 scripts/shrink.js（与 build.js 同一字号缩放算法，保证预览/导出一致）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { shrinkFactor } = require(path.join(__dirname, '..', 'shrink'));
const { chartHTML } = require(path.join(__dirname, 'chartHtml'));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function rgba(hex, alpha) {
  // hex → rgba（支持 #rgb / #rrggbb）
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (isNaN(n)) return hex;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 渲染单元素为 HTML。
 * @param {object} el 元素定义
 * @param {object} page 所在页（供默认色回退）
 * @param {object} theme 当前主题（供文字/线/衬底默认色）
 */
function elHtml(el, page, theme) {
  const t = (theme && theme.palette) || {};
  const style = `left:${el.x || 0}px;top:${el.y || 0}px;width:${el.w || 0}px;height:${el.h || 0}px;`;
  switch (el.type) {
    case 'text': {
      const { factor, fontSize: sfs, lineH: slh } = shrinkFactor(el);
      const fs = sfs;
      const lineH = slh;
      const align = el.align || 'left';
      const valign = el.valign || 'top';
      const color = el.color || t.text || '#1A1A1A';
      const subColor = t.sub || '#5B6472';
      let inner;
      if (el.runs && el.runs.length) {
        inner = el.runs.map(r => {
          const rfs = Math.round((r.fontSize || el.fontSize || 18) * factor);
          return `<span style="font-weight:${r.bold ? 'bold' : 'normal'};font-style:${r.italic ? 'italic' : 'normal'};color:${r.color || color};font-size:${rfs}px">${esc(r.text)}</span>`;
        }).join('');
      } else {
        inner = esc(el.text || '');
      }
      const lineHpx = lineH ? `line-height:${lineH / fs};` : '';
      const extra = el.secondary ? `color:${subColor};font-size:${Math.round(fs * 0.78)}px;` : '';
      return `<div style="position:absolute;${style}font-size:${fs}px;font-weight:${el.bold ? 'bold' : 'normal'};font-style:${el.italic ? 'italic' : 'normal'};color:${color};text-align:${align};display:flex;align-items:${valign === 'middle' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start'};${lineHpx}${extra}overflow:hidden;white-space:pre-wrap">${inner}</div>`;
    }
    case 'rect':
    case 'roundRect': {
      const bg = el.fill || 'transparent';
      const opacity = el.opacity !== undefined ? `opacity:${el.opacity};` : '';
      const radius = (el.type === 'roundRect' || el.radius !== undefined) ? `border-radius:${el.radius || 8}px;` : '';
      const shadow = (el.shadow && theme && theme.decoration && theme.decoration.shadow) ? `box-shadow:0 6px 24px ${rgba(bg, 0.25)};` : '';
      const border = el.lineColor ? `border:${el.lineWidth || 1}px solid ${el.lineColor};` : '';
      return `<div style="position:absolute;${style}background:${bg};${opacity}${radius}${shadow}${border}"></div>`;
    }
    case 'ellipse': {
      const bg = el.fill || 'transparent';
      const shadow = (el.shadow && theme && theme.decoration && theme.decoration.shadow) ? `box-shadow:0 6px 20px ${rgba(bg, 0.3)};` : '';
      return `<div style="position:absolute;${style}background:${bg};border-radius:50%;${el.opacity !== undefined ? `opacity:${el.opacity};` : ''}${shadow}"></div>`;
    }
    case 'line': {
      return `<svg style="position:absolute;left:${el.x1 || 0}px;top:${el.y1 || 0}px;overflow:visible" width="2" height="2"><line x1="0" y1="0" x2="${(el.x2 || 0) - (el.x1 || 0)}" y2="${(el.y2 || 0) - (el.y1 || 0)}" stroke="${el.color || t.primary || '#1A1A1A'}" stroke-width="${el.width || 2}"/></svg>`;
    }
    case 'image': {
      const rel = path.relative(process.cwd(), el.path).replace(/\\/g, '/');
      const exists = fs.existsSync(el.path);
      if (!exists) {
        const cap = el.caption ? `图片占位 · ${el.caption}` : '图片占位';
        return `<div style="position:absolute;${style};background:#E2E8F0;border-radius:${el.radius || 8}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">`
          + `<div style="font-size:16px;color:#64748B">${esc(cap)}</div>`
          + `<div style="font-size:10px;color:#94A3B8;word-break:break-all;padding:0 12px">${esc(rel)}</div>`
          + `</div>`;
      }
      const fit = el.objectFit === 'contain' ? 'contain' : 'cover';
      return `<img src="${rel}" style="position:absolute;${style}object-fit:${fit}"/>`;
    }
    case 'chart': {
      // 真实图表：bar/line/area/pie/doughnut → 共享 chartHtml 模块（视觉与编辑器一致）
      return chartHTML(el, theme);
    }
    case 'table': {
      const rows = (el.rows || []).map(r =>
        `<tr>${r.map(c => `<td style="border:1px solid ${el.borderColor || rgba(t.line || '#E2E8F0', 0.6)};padding:6px 10px;font-weight:${c.bold ? 'bold' : 'normal'};color:${c.color || el.color || t.text || '#1A1A1A'}">${esc(c.text)}</td>`).join('')}</tr>`).join('');
      return `<div style="position:absolute;${style};overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:${el.fontSize || 14}px;color:${t.text || '#1A1A1A'}">${rows}</table></div>`;
    }

    /* ── 新增增强元素 ─────────────────────────── */
    case 'gradientBar': {
      const from = el.from || t.primary || '#3B82F6';
      const to = el.to || t.accent || '#0EA5E9';
      const horiz = el.dir !== 'vertical';
      const g = horiz
        ? `linear-gradient(90deg, ${from}, ${to})`
        : `linear-gradient(0deg, ${from}, ${to})`;
      return `<div style="position:absolute;${style}background:${g};border-radius:${el.radius ?? (horiz ? 6 : 4)}px;"></div>`;
    }
    case 'glowOrb': {
      // 光晕：CSS 径向渐变 + 模糊，HTML 完整视觉
      const r = el.r || 200;
      const color = rgba(el.color || t.primary || '#3B82F6', el.alpha ?? 0.35);
      const cx = (el.x || 0) + r / 2, cy = (el.y || 0) + r / 2;
      const blur = el.blur || 40;
      return `<div style="position:absolute;left:${cx - r / 2}px;top:${cy - r / 2}px;width:${r}px;height:${r}px;border-radius:50%;background:radial-gradient(circle, ${color}, transparent 70%);filter:blur(${blur}px);pointer-events:none;"></div>`;
    }
    case 'decoBlock': {
      // 半透明装饰块（不遮挡文字，pointer-events:none）
      const bg = rgba(el.fill || t.primary || '#3B82F6', el.alpha ?? 0.1);
      const radius = el.radius !== undefined ? `border-radius:${el.radius}px;` : '';
      return `<div style="position:absolute;${style}background:${bg};${radius}pointer-events:none;"></div>`;
    }
    case 'kpiBlock': {
      // 色块衬底 + 大数字 + 标签
      const bg = el.fill || (t.dark ? 'rgba(255,255,255,0.06)' : rgba(t.primary || '#3B82F6', 0.08));
      const numColor = el.color || (t.dark ? t.primary || '#2FE07F' : t.primary || '#3B82F6');
      const labelColor = t.sub || '#64748B';
      const num = el.value !== undefined ? el.value : (el.text || '');
      const label = el.label || '';
      return `<div style="position:absolute;${style}background:${bg};border:1px solid ${rgba(t.line || '#E2E8F0', 0.5)};border-radius:${el.radius ?? 12}px;display:flex;flex-direction:column;justify-content:center;padding:14px 18px;box-sizing:border-box;">
        <div style="font-size:${el.numSize || 44}px;font-weight:800;color:${numColor};line-height:1.1;">${esc(num)}</div>
        ${label ? `<div style="font-size:${el.labelSize || 14}px;color:${labelColor};margin-top:6px;">${esc(label)}</div>` : ''}
      </div>`;
    }
    default:
      return `<!-- 未知元素 ${el.type} -->`;
  }
}

/** 页面装饰层（slideBundles 简化版）：生成垫在元素下层的装饰 HTML */
function decorationHtml(page, theme) {
  const t = theme || {};
  if (!t.palette) return '';
  const p = t.palette;
  const d = (page.decoration) || t.decoration || {};
  let html = '';
  const corner = d.corner || '';
  // 角落装饰
  if (corner === 'bar') {
    // 右上角强调色条
    html += `<div style="position:absolute;right:0;top:0;width:140px;height:8px;background:${p.primary};opacity:0.85;pointer-events:none;"></div>`;
    html += `<div style="position:absolute;right:0;top:8px;width:90px;height:4px;background:${p.accent};opacity:0.5;pointer-events:none;"></div>`;
  } else if (corner === 'glow' && t.dark) {
    html += `<div style="position:absolute;right:-60px;top:-60px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle, ${rgba(p.primary, 0.22)}, transparent 65%);pointer-events:none;"></div>`;
  } else if (corner === 'barDark' && t.dark) {
    html += `<div style="position:absolute;left:0;bottom:0;width:100%;height:6px;background:linear-gradient(90deg,${p.primary},${p.accent});opacity:0.9;pointer-events:none;"></div>`;
  }
  // 页脚装饰（非 hero 页）
  if (page.role !== 'hero' && d.footer !== false) {
    html += `<div style="position:absolute;left:0;bottom:0;width:180px;height:4px;background:${p.primary};opacity:0.5;pointer-events:none;"></div>`;
  }
  return html;
}

module.exports = { elHtml, decorationHtml, esc, rgba };
