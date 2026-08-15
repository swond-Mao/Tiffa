'use strict';
/**
 * pptx-designer visual/chartHtml.js — chart 元素 → 真实 HTML/SVG 图表
 *
 * 供 preview（elHtml.js）与 render-editor（画布/缩略图/导出镜像）共享，
 * 输入 chart 元素定义（DSL 契约见 SKILL.md / 设计文档），输出定位容器 HTML。
 * 本文件为纯函数模块，无外部依赖；浏览器端内联时自动跳过 module.exports。
 *
 * 支持类型：bar（分组/堆叠/百分比堆叠、横向/纵向）/ line / area / pie / doughnut
 * 配色：el.colors > series[].color > 主题 palette（primary/accent/warn/gold/purple 轮换）
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rgba(hex, alpha) {
  const h = String(hex == null ? '' : hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** nice ticks：0..maxVal 之间取约 target 个整齐刻度（1/2/5 × 10^n） */
function niceTicks(maxVal, target) {
  maxVal = Number(maxVal) || 0;
  if (maxVal <= 0) return [0, 1];
  const raw = maxVal / Math.max(1, (target || 5) - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  step *= mag;
  const ticks = [];
  for (let v = 0; v <= maxVal + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks.length < 2) ticks.push(maxVal);
  // 保证最大刻度 >= 数据最大值（否则柱高 >100% 溢出容器被裁切）
  while (ticks[ticks.length - 1] < maxVal) {
    ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1e6) / 1e6);
  }
  return ticks;
}

/** 数值格式化：>=1 万转「万」，其余去尾零 */
function fmtNum(v) {
  if (typeof v !== 'number' || isNaN(v)) return String(v == null ? '' : v);
  if (Math.abs(v) >= 10000) {
    const w = v / 10000;
    return (Math.round(w * 10) / 10) + '万';
  }
  return String(Math.round(v * 10) / 10);
}

/* ── 柱状图（div 实现，支持 grouped/stacked/percentStacked + 横向/纵向） ── */
function barChart(el, series, labels, opt) {
  const values = series.map((s) => (s.values || []).map((v) => Number(v) || 0));
  let maxVal = 0;
  values.forEach((vs) => vs.forEach((v) => { if (v > maxVal) maxVal = v; }));
  const grouping = el.grouping || 'clustered';
  const pct = grouping === 'percentStacked';
  const ticks = pct ? [0, 25, 50, 75, 100] : niceTicks(maxVal || 1, 5);
  const tickMax = pct ? 100 : ticks[ticks.length - 1];
  return el.barDirection === 'bar' ? hbarChart(el, series, labels, values, ticks, tickMax, pct, grouping, maxVal, opt) : vbarChart(el, series, labels, values, ticks, tickMax, pct, grouping, maxVal, opt);
}

/* 纵向柱状：左 y 轴刻度 + 底部 x 轴标签 */
function vbarChart(el, series, labels, values, ticks, tickMax, pct, grouping, maxVal, opt) {
  const axisW = 38, axisH = 20;
  const tickRow = (t) => {
    const topPct = (1 - t / tickMax) * 100;
    return `<div style="position:absolute;left:0;right:0;top:${topPct}%;border-top:1px solid ${opt.grid};transform:translateY(-0.5px)"></div>`
      + `<div style="position:absolute;right:2px;top:${topPct}%;transform:translateY(-50%);font-size:10px;color:${opt.sub};white-space:nowrap">${pct ? Math.round(t) + '%' : fmtNum(t)}</div>`;
  };
  const axisCol = `<div style="width:${axisW}px;flex-shrink:0;position:relative">${ticks.map(tickRow).join('')}</div>`;

  const n = labels.length || 1;
  const m = series.length || 1;
  const groupW = 100 / n;
  const barGap = 0.1; // 组两侧留空比例（单边）
  const bars = [];
  for (let i = 0; i < n; i++) {
    const leftPct = i * groupW;
    if (grouping === 'stacked' || grouping === 'percentStacked') {
      let acc = 0;
      for (let s = 0; s < m; s++) {
        const v = values[s][i] || 0;
        const hPct = pct ? (maxVal > 0 ? (v / maxVal) * 100 : 0) : tickMax > 0 ? (v / tickMax) * 100 : 0;
        if (hPct <= 0) continue;
        const showVal = opt.showValue && (pct ? hPct >= 8 : hPct >= 4);
        bars.push(`<div style="position:absolute;left:${leftPct + barGap}%;width:${groupW - barGap * 2}%;bottom:${acc}%;height:${hPct}%;background:${series[s].color};border-radius:3px 3px 0 0">`
          + (showVal ? `<span style="position:absolute;left:50%;bottom:calc(100% + 2px);transform:translateX(-50%);font-size:10px;color:${opt.text};white-space:nowrap">${fmtNum(v)}</span>` : '')
          + `</div>`);
        acc += hPct;
      }
    } else {
      const seriesW = (groupW - barGap * 2) / m;
      for (let s = 0; s < m; s++) {
        const v = values[s][i] || 0;
        const hPct = tickMax > 0 ? (v / tickMax) * 100 : 0;
        const showVal = opt.showValue && hPct >= 2.5;
        bars.push(`<div style="position:absolute;left:${leftPct + barGap + s * seriesW}%;width:${seriesW}%;bottom:0;height:${hPct}%;background:${series[s].color};border-radius:3px 3px 0 0">`
          + (showVal ? `<span style="position:absolute;left:50%;bottom:calc(100% + 2px);transform:translateX(-50%);font-size:10px;color:${opt.text};white-space:nowrap">${fmtNum(v)}</span>` : '')
          + `</div>`);
      }
    }
  }
  const plot = `<div style="flex:1;min-width:0;position:relative">${bars.join('')}</div>`;
  const xLabels = labels.map((lb) => `<div style="flex:1;min-width:0;text-align:center;font-size:11px;color:${opt.sub};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lb)}</div>`).join('');
  return `<div style="flex:1;min-height:0;display:flex">${axisCol}${plot}</div>`
    + `<div style="height:${axisH}px;display:flex;margin-left:${axisW}px">${xLabels}</div>`;
}

/* 横向柱状：左 x 轴标签（类别）+ 右绘图区，值刻度在底部 */
function hbarChart(el, series, labels, values, ticks, tickMax, pct, grouping, maxVal, opt) {
  const axisW = 46, axisH = 18;
  const n = labels.length || 1;
  const m = series.length || 1;
  const rowH = 100 / n; // 每类占高
  const barGap = 0.12;
  const bars = [];
  for (let i = 0; i < n; i++) {
    const topPct = i * rowH;
    if (grouping === 'stacked' || grouping === 'percentStacked') {
      let acc = 0;
      for (let s = 0; s < m; s++) {
        const v = values[s][i] || 0;
        const wPct = pct ? (maxVal > 0 ? (v / maxVal) * 100 : 0) : tickMax > 0 ? (v / tickMax) * 100 : 0;
        if (wPct <= 0) continue;
        const showVal = opt.showValue && (pct ? wPct >= 10 : wPct >= 5);
        bars.push(`<div style="position:absolute;top:${topPct + barGap}%;height:${rowH - barGap * 2}%;left:${acc}%;width:${wPct}%;background:${series[s].color};border-radius:0 3px 3px 0">`
          + (showVal ? `<span style="position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:10px;color:${opt.text};white-space:nowrap">${fmtNum(v)}</span>` : '')
          + `</div>`);
        acc += wPct;
      }
    } else {
      const seriesH = (rowH - barGap * 2) / m;
      for (let s = 0; s < m; s++) {
        const v = values[s][i] || 0;
        const wPct = tickMax > 0 ? (v / tickMax) * 100 : 0;
        const showVal = opt.showValue && wPct >= 4;
        bars.push(`<div style="position:absolute;top:${topPct + barGap + s * seriesH}%;height:${seriesH}%;left:0;width:${wPct}%;background:${series[s].color};border-radius:0 3px 3px 0">`
          + (showVal ? `<span style="position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:10px;color:${opt.text};white-space:nowrap">${fmtNum(v)}</span>` : '')
          + `</div>`);
      }
    }
  }
  // 底部值刻度
  const tickRow = (t) => {
    const leftPct = (t / tickMax) * 100;
    return `<div style="position:absolute;top:0;bottom:0;left:${leftPct}%;border-left:1px solid ${opt.grid};transform:translateX(-0.5px)"></div>`
      + `<div style="position:absolute;top:2px;left:${leftPct}%;transform:translateX(-50%);font-size:10px;color:${opt.sub};white-space:nowrap">${pct ? Math.round(t) + '%' : fmtNum(t)}</div>`;
  };
  const plot = `<div style="flex:1;min-width:0;position:relative;margin-top:16px">${bars.join('')}</div>`;
  const xLabels = labels.map((lb) => `<div style="height:${rowH}%;display:flex;align-items:center;padding-right:6px;font-size:11px;color:${opt.sub};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box">${esc(lb)}</div>`).join('');
  return `<div style="flex:1;min-height:0;display:flex">`
    + `<div style="width:${axisW}px;flex-shrink:0;display:flex;flex-direction:column;justify-content:space-between">${xLabels}</div>`
    + `<div style="flex:1;min-width:0;position:relative"><div style="position:absolute;left:0;right:0;top:0;bottom:${axisH}px">${plot}</div>${ticks.map(tickRow).join('')}</div>`
    + `</div>`;
}

/* ── 折线/面积图（SVG 线面 + div 圆点/数值，规避 preserveAspectRatio 拉伸变形） ── */
function lineChart(el, series, labels, opt) {
  const area = el.chartType === 'area';
  const values = series.map((s) => (s.values || []).map((v) => Number(v) || 0));
  let maxVal = 0;
  values.forEach((vs) => vs.forEach((v) => { if (v > maxVal) maxVal = v; }));
  const ticks = niceTicks(maxVal || 1, 5);
  const tickMax = ticks[ticks.length - 1];
  const axisW = 38, axisH = 20;
  const n = labels.length || 2;

  const tickRow = (t) => {
    const topPct = (1 - t / tickMax) * 100;
    return `<div style="position:absolute;left:0;right:0;top:${topPct}%;border-top:1px solid ${opt.grid};transform:translateY(-0.5px)"></div>`
      + `<div style="position:absolute;right:2px;top:${topPct}%;transform:translateY(-50%);font-size:10px;color:${opt.sub};white-space:nowrap">${fmtNum(t)}</div>`;
  };
  const axisCol = `<div style="width:${axisW}px;flex-shrink:0;position:relative">${ticks.map(tickRow).join('')}</div>`;

  const x = (i) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v) => (tickMax > 0 ? (1 - v / tickMax) * 100 : 0);

  // SVG：只画网格线与折线/面积（preserveAspectRatio="none" 拉伸无碍）
  let svg = `<svg style="position:absolute;inset:0;width:100%;height:100%" viewBox="0 0 100 100" preserveAspectRatio="none">`;
  const svgParts = [];
  if (area) {
    series.forEach((s, si) => {
      const pts = values[si].map((v, i) => `${x(i)},${y(v)}`);
      const polygon = `${pts.join(' ')} ${x(n - 1)},100 ${x(0)},100`;
      svgParts.push(`<polygon points="${polygon}" fill="${rgba(s.color, 0.18)}" stroke="none"/>`);
    });
  }
  series.forEach((s, si) => {
    const pts = values[si].map((v, i) => `${x(i)},${y(v)}`).join(' ');
    svgParts.push(`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`);
  });
  svg += svgParts.join('') + '</svg>';

  // 圆点 + 数值（div，固定像素不拉伸）
  let dots = '';
  for (let si = 0; si < series.length; si++) {
    for (let i = 0; i < n; i++) {
      const v = values[si][i] || 0;
      dots += `<div style="position:absolute;left:${x(i)}%;top:${y(v)}%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;background:${series[si].color};border:2px solid ${opt.dark ? '#0B0D12' : '#FFFFFF'};box-sizing:border-box"></div>`
        + (opt.showValue ? `<div style="position:absolute;left:${x(i)}%;top:${y(v)}%;transform:translate(-50%,-130%);font-size:10px;color:${opt.text};white-space:nowrap">${fmtNum(v)}</div>` : '');
    }
  }

  const plot = `<div style="flex:1;min-width:0;position:relative">${svg}${dots}</div>`;
  const xLabels = labels.map((lb) => `<div style="flex:1;min-width:0;text-align:center;font-size:11px;color:${opt.sub};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lb)}</div>`).join('');
  return `<div style="flex:1;min-height:0;display:flex">${axisCol}${plot}</div>`
    + `<div style="height:${axisH}px;display:flex;margin-left:${axisW}px">${xLabels}</div>`;
}

/* ── 饼/环形图（SVG path，保持纵横比） ── */
function pieChart(el, series, labels, colors, opt) {
  const doughnut = el.chartType === 'doughnut';
  const s0 = series[0] || {};
  const values = (s0.values || []).map((v) => Number(v) || 0);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const c = colors && colors.length ? colors : [s0.color || '#3B82F6'];

  // 扇区 path（从 -90° 开始顺时针）
  const arcPath = (r, a0, a1, inner) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    if (!inner) {
      const x0 = 50 + r * Math.cos(a0), y0 = 50 + r * Math.sin(a0);
      const x1 = 50 + r * Math.cos(a1), y1 = 50 + r * Math.sin(a1);
      return `M 50 50 L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
    }
    const ri = r * 0.62;
    const x0 = 50 + r * Math.cos(a0), y0 = 50 + r * Math.sin(a0);
    const x1 = 50 + r * Math.cos(a1), y1 = 50 + r * Math.sin(a1);
    const x2 = 50 + ri * Math.cos(a1), y2 = 50 + ri * Math.sin(a1);
    const x3 = 50 + ri * Math.cos(a0), y3 = 50 + ri * Math.sin(a0);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${ri} ${ri} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
  };

  const parts = [];
  let a = -Math.PI / 2;
  values.forEach((v, i) => {
    if (v <= 0) return;
    const frac = v / total;
    const a1 = a + frac * Math.PI * 2;
    parts.push(`<path d="${arcPath(45, a, a1, doughnut)}" fill="${c[i % c.length]}" stroke="${opt.dark ? '#0B0D12' : '#FFFFFF'}" stroke-width="1"/>`);
    // 占比 ≥7% 才标注百分比
    if (frac >= 0.07) {
      const am = (a + a1) / 2;
      const lr = doughnut ? 33 : 30;
      const tx = 50 + lr * Math.cos(am), ty = 50 + lr * Math.sin(am);
      parts.push(`<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="5" font-weight="600" fill="${opt.dark ? '#FFFFFF' : '#FFFFFF'}">${Math.round(frac * 100)}%</text>`);
    }
    a = a1;
  });
  if (doughnut) {
    parts.push(`<text x="50" y="50" text-anchor="middle" dominant-baseline="middle" font-size="7.5" font-weight="700" fill="${opt.text}">${fmtNum(total)}</text>`);
  }
  const svg = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="flex:1;min-width:0;max-width:70%;height:100%">${parts.join('')}</svg>`;

  // 右侧图例（名称 + 数值）
  const legend = labels.map((lb, i) => `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${opt.sub};padding:3px 0">
    <span style="width:10px;height:10px;border-radius:2px;background:${c[i % c.length]};flex-shrink:0"></span>
    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lb)}</span>
    <span style="color:${opt.text};font-weight:600;white-space:nowrap">${fmtNum(values[i] || 0)}</span></div>`).join('');
  return `<div style="flex:1;min-height:0;display:flex;align-items:center;gap:10px">${svg}${opt.showLegend === false ? '' : `<div style="width:44%;flex-shrink:0">${legend}</div>`}</div>`;
}

/**
 * chart 元素 → 定位容器 HTML
 * @param {object} el chart 元素定义（chartType/labels/series/colors/showLegend/showValue/title/barDirection/grouping）
 * @param {object} theme 主题（{ palette: {primary,accent,warn,gold,purple,text,sub,...}, dark }），可为 undefined
 */
function chartHTML(el, theme) {
  const t = (theme && theme.palette) || {};
  const dark = !!(theme && theme.dark);
  const fallback = ['#3B82F6', '#0EA5E9', '#F59E0B', '#EF4444', '#8B5CF6'];
  const paletteColors = [t.primary, t.accent, t.warn, t.gold, t.purple].filter(Boolean);
  const colors = (el.colors && el.colors.length) ? el.colors : (paletteColors.length ? paletteColors : fallback);
  const series = (el.series || []).map((s, i) => Object.assign({}, s, {
    color: (s && s.color) || colors[i % colors.length],
  }));
  const labels = el.labels || [];
  const type = el.chartType || 'bar';
  const textColor = t.text || '#1A1A1A';
  const subColor = t.sub || '#64748B';
  const grid = rgba(subColor, dark ? 0.22 : 0.15);
  const bg = el.fill || (dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.65)');
  const borderColor = rgba(t.primary || '#94A3B8', 0.22);
  const opt = { dark, text: textColor, sub: subColor, grid, showValue: !!el.showValue, showLegend: el.showLegend };

  const titleHtml = el.title
    ? `<div style="font-size:14px;font-weight:600;color:${textColor};text-align:center;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(el.title)}</div>`
    : '';
  let legendHtml = '';
  if (opt.showLegend !== false && (type === 'bar' || type === 'line' || type === 'area')) {
    legendHtml = `<div style="display:flex;flex-wrap:wrap;justify-content:center;margin-bottom:8px">${series.map((s, i) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:12px;color:${subColor}"><span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block"></span>${esc(s.name || '系列' + (i + 1))}</span>`).join('')}</div>`;
  }

  let bodyHtml;
  if (type === 'bar') bodyHtml = barChart(el, series, labels, opt);
  else if (type === 'line' || type === 'area') bodyHtml = lineChart(el, series, labels, opt);
  else if (type === 'pie' || type === 'doughnut') bodyHtml = pieChart(el, series, labels, colors, opt);
  else bodyHtml = `<div style="color:${subColor};font-size:12px">不支持的图表类型：${esc(type)}</div>`;

  return `<div style="position:absolute;left:${el.x || 0}px;top:${el.y || 0}px;width:${el.w || 0}px;height:${el.h || 0}px;overflow:hidden;box-sizing:border-box;background:${bg};border:1px solid ${borderColor};border-radius:8px;padding:10px 12px;display:flex;flex-direction:column">
    ${titleHtml}${legendHtml}
    <div style="flex:1;min-height:0;display:flex;flex-direction:column">${bodyHtml}</div>
  </div>`;
}

// 浏览器内联（render-editor 注入源码）时 module 不存在，跳过导出即可
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { chartHTML, esc, rgba };
}
