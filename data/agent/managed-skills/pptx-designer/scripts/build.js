#!/usr/bin/env node
/**
 * pptx-designer build.js
 * 页面定义(pages/*.js) → 原生 .pptx
 *
 * 用法:
 *   node scripts/build.js --project <项目目录> -o <输出.pptx>
 *   node scripts/build.js --project <项目目录> --lint-only   # 只做规则校验
 *
 * 页面定义 DSL:
 *   每页一个 .js 文件, module.exports = { id, type, role, background, palette?, elements: [...] }
 *   元素类型: text / rect / roundRect / ellipse / line / image / chart / table
 *   坐标系: 1280x720 逻辑 px（设计稿坐标），build 时映射到真实幻灯片 960x540（10x5.625in）
 *
 * 换算依据（关键，勿改）:
 *   LAYOUT_16x9 实际 = 10 x 5.625 英寸 = 9144000 x 5143500 EMU
 *   逻辑画布 = 1280 x 720 px（设计稿）
 *   INCH_PER_PX = 10 / 1280 = 0.0078125（宽高一致：5.625/720 = 0.0078125）
 *   PT_PER_PX   = 0.0078125 * 72 = 0.5625（字号/行距 px → pt）
 */
const path = require('path');
const fs = require('fs');
const { THEMES: THEME_DEFS, CANVAS_W, CANVAS_H } = require(path.join(__dirname, 'visual', 'themes.js'));

const INCH_PER_PX = 10 / 1280; // 逻辑 px → 英寸
const PT_PER_PX = INCH_PER_PX * 72; // 逻辑 px → pt（字号）

// 允许在 lint 中直接使用的通用中性色（无需进 palette）
const NEUTRAL = new Set(['#ffffff', '#000000']);

function px(v) { return v * INCH_PER_PX; }
function pt(v) { return v * PT_PER_PX; } // px 字号 → pt
function hex(c) {
  const s = String(c).trim();
  // rgba(r,g,b[,a]) / rgb(r,g,b) → RRGGBB（忽略 alpha，.pptx 颜色为 6 位 hex）
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    return ((1 << 24) + (+m[1] << 16) + (+m[2] << 8) + +m[3]).toString(16).slice(1).toUpperCase();
  }
  return s.replace('#', '').toUpperCase();
}
function norm(c) { return String(c).toLowerCase(); }

// 边界裁剪：超出画布的元素自动裁剪（返回裁剪后的 {x,y,w,h}）
function clipBounds(el) {
  const x = Math.max(0, el.x || 0);
  const y = Math.max(0, el.y || 0);
  const w = Math.max(0, (el.w || 0) - Math.max(0, (el.x || 0) + (el.w || 0) - CANVAS_W));
  const h = Math.max(0, (el.h || 0) - Math.max(0, (el.y || 0) + (el.h || 0) - CANVAS_H));
  return { x, y, w, h };
}

function loadProject(projectDir) {
  const pagesDir = path.join(projectDir, 'pages');
  const designFile = path.join(projectDir, 'design.json');
  const design = fs.existsSync(designFile) ? JSON.parse(fs.readFileSync(designFile, 'utf8')) : {};
  const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();
  const pages = files.map(f => {
    const p = require(path.join(pagesDir, f));
    if (!p.id) p.id = f.replace(/\.js$/, '');
    return p;
  });
  return { design, pages, pagesDir };
}

// ---------------- 规则校验 ----------------
function lint(projectDir) {
  const { design, pages } = loadProject(projectDir);
  const palette = (design.palette || []).map(norm);
  const errors = [];
  const warn = [];

  pages.forEach((page, i) => {
    const ctx = `[${page.id}]`;
    const isContent = !['cover', 'section', 'ending'].includes(page.type);
    const isHero = page.role === 'hero';

    // 母版区: 内容页必须有标题(顶部 y<130) 与 页码(页脚 y>=650)
    if (isContent) {
      const hasTitle = page.elements.some(el =>
        el.type === 'text' && el.y < 130 && (el.fontSize || 0) >= 30);
      const hasPageNum = page.elements.some(el =>
        el.type === 'text' && el.y >= 650 && /NN|TOTAL|页码|^\d+\s*\/\s*\d+/.test(el.text || ''));
      if (!hasTitle) errors.push(`${ctx} 内容页缺少标题块 (A区 0-130px, fontSize>=30)`);
      if (!hasPageNum) warn.push(`${ctx} 内容页缺少页码 (C区 650-720px)`);
    }

    // Hero 页必须有视觉锚点
    if (isHero) {
      const anchorNum = page.elements.some(el => el.type === 'text' && (el.fontSize || 0) >= 48);
      const anchorVisual = page.elements.some(el =>
        (el.type === 'image' && el.w * el.h >= 0.4 * 540 * 1120) ||
        (el.type === 'rect' && el.w * el.h >= 0.4 * 540 * 1120));
      if (!anchorNum && !anchorVisual) errors.push(`${ctx} Hero 页缺少视觉锚点 (≥48px 数字 或 ≥40% B区面积的图/色块)`);
    }

    // 配色 ∈ palette ∪ 中性色
    if (palette.length) {
      page.elements.forEach((el, j) => {
        const colors = [el.color, el.fill, el.background, el.headerFill, el.lineColor].filter(Boolean);
        colors.forEach(c => {
          if (!palette.includes(norm(c)) && !NEUTRAL.has(norm(c))) {
            errors.push(`${ctx} 元素#${j} 颜色 ${c} 不在 DESIGN palette ${palette.join(',')} 中`);
          }
        });
      });
    }

    // 溢出检查
    page.elements.forEach((el, j) => {
      const right = (el.x || 0) + (el.w || 0);
      const bottom = (el.y || 0) + (el.h || 0);
      if ((el.x || 0) < -2 || (el.y || 0) < -2 || right > CANVAS_W + 2 || bottom > CANVAS_H + 2) {
        errors.push(`${ctx} 元素#${j} (${el.type}) 溢出画布: x=${el.x} y=${el.y} w=${el.w} h=${el.h}`);
      }
    });
  });

  // 页面间版式重复（相邻页面主元素布局相似度粗检: 只提示）
  for (let i = 1; i < pages.length; i++) {
    const a = pages[i - 1].elements.filter(e => e.type === 'rect').length;
    const b = pages[i].elements.filter(e => e.type === 'rect').length;
    if (a === b && a >= 3) warn.push(`[${pages[i].id}] 与上一页 rect 数量相同(${a})，注意版式雷同`);
  }

  return { errors, warn, pages: pages.length };
}

// ---------------- 渲染 ----------------
function renderElement(slide, pptx, el, page) {
  // 边界裁剪：防止元素超出画布
  const c = clipBounds(el);
  const o = { x: px(c.x), y: px(c.y), w: px(c.w), h: px(c.h) };

  switch (el.type) {
    case 'text': {
      const { factor, fontSize: sf, lineH: slh } = require('./shrink').shrinkFactor(el);
      const fs = sf;
      const opts = {
        x: o.x, y: o.y, w: o.w, h: o.h,
        fontSize: pt(fs),
        bold: !!el.bold,
        italic: !!el.italic,
        color: hex(el.color || '#1A1A1A'),
        fontFace: el.fontFace || page.fontFace || '微软雅黑',
        align: el.align || 'left',
        valign: el.valign || 'top',
        lineSpacing: slh ? pt(slh) : undefined,
        charSpacing: el.letterSpacing || undefined,
        margin: 0,
        fit: el.fit === undefined ? 'shrink' : el.fit,
      };
      if (el.transparency !== undefined) opts.transparency = el.transparency;
      if (el.rotate !== undefined) opts.rotate = el.rotate;
      const runs = (el.runs || []).map(r => ({
        text: r.text,
        options: {
          bold: r.bold, italic: r.italic,
          color: hex(r.color || el.color || '#1A1A1A'),
          fontSize: pt(Math.round((r.fontSize || el.fontSize || 18) * factor)),
          fontFace: r.fontFace || el.fontFace || page.fontFace || '微软雅黑',
        },
      }));
      slide.addText(runs.length ? runs : el.text, opts);
      break;
    }
    case 'rect':
    case 'roundRect': {
      const shape = el.type === 'roundRect' ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
      const opts = {
        x: o.x, y: o.y, w: o.w, h: o.h,
        fill: el.fill ? { color: hex(el.fill), transparency: el.opacity !== undefined ? 100 - el.opacity * 100 : undefined } : { color: 'FFFFFF', transparency: 100 },
        line: el.lineColor ? { color: hex(el.lineColor), width: px(el.lineWidth || 1) } : { type: 'none' },
      };
      if (el.radius !== undefined) opts.rectRadius = px(el.radius);
      if (el.rotate !== undefined) opts.rotate = el.rotate;
      slide.addShape(shape, opts);
      break;
    }
    case 'ellipse': {
      const eopts = {
        x: o.x, y: o.y, w: o.w, h: o.h,
        fill: el.fill ? { color: hex(el.fill), transparency: el.opacity !== undefined ? 100 - el.opacity * 100 : undefined } : { color: 'FFFFFF', transparency: 100 },
        line: el.lineColor ? { color: hex(el.lineColor), width: px(el.lineWidth || 1) } : { type: 'none' },
      };
      if (el.rotate !== undefined) eopts.rotate = el.rotate;
      slide.addShape(pptx.ShapeType.ellipse, eopts);
      break;
    }
    case 'line': {
      slide.addShape(pptx.ShapeType.line, {
        x: px(el.x1 || 0), y: px(el.y1 || 0),
        w: px((el.x2 || 0) - (el.x1 || 0)), h: px((el.y2 || 0) - (el.y1 || 0)),
        line: { color: hex(el.color || '#1A1A1A'), width: px(el.width || 2) },
      });
      break;
    }
    case 'image': {
      const imgPath = path.resolve(el.path);
      if (!fs.existsSync(imgPath)) {
        // 图片占位：文件缺失时渲染浅灰圆角块 + 提示（先留位，后放图/生图）
        slide.addShape(pptx.ShapeType.roundRect, {
          x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: px(el.radius || 8),
          fill: { color: 'E2E8F0' }, line: { type: 'none' },
        });
        slide.addText(el.caption ? `图片占位\n${el.caption}` : '图片占位', {
          x: o.x, y: o.y, w: o.w, h: o.h,
          align: 'center', valign: 'middle', fontSize: pt(16),
          color: '64748B', fontFace: '微软雅黑', margin: 0, fit: 'shrink',
        });
        // 占位块下方可显示路径提示（小字，便于定位）
        slide.addText(el.path.replace(/\\/g, '/'), {
          x: o.x, y: o.y + o.h - px(24), w: o.w, h: px(18),
          align: 'center', valign: 'middle', fontSize: pt(10),
          color: '94A3B8', fontFace: '微软雅黑', margin: 0, fit: 'shrink',
        });
        break;
      }
      const imgOpts = {
        path: imgPath,
        x: o.x, y: o.y, w: o.w, h: o.h,
        sizing: { type: el.objectFit === 'contain' ? 'contain' : 'cover', w: o.w, h: o.h },
      };
      if (el.rotate !== undefined) imgOpts.rotate = el.rotate;
      slide.addImage(imgOpts);
      break;
    }
    case 'chart': {
      const chartMap = { bar: pptx.ChartType.bar, line: pptx.ChartType.line, pie: pptx.ChartType.pie, doughnut: pptx.ChartType.doughnut, area: pptx.ChartType.area };
      const data = (el.series || []).map(s => ({
        name: s.name, labels: s.labels || el.labels || [], values: s.values || [],
      }));
      const chartOpts = {
        x: o.x, y: o.y, w: o.w, h: o.h,
        showLegend: el.showLegend !== false,
        showValue: !!el.showValue,
        chartColors: (el.colors || []).map(hex),
        catAxisLabelColor: el.axisColor ? hex(el.axisColor) : undefined,
        valAxisLabelColor: el.axisColor ? hex(el.axisColor) : undefined,
      };
      // 横向条形图（tencent DSL 兼容：barDirection='bar'）
      if (el.barDirection === 'bar') chartOpts.barDir = 'bar';
      else if (el.barDirection === 'column') chartOpts.barDir = 'col';
      // 分组方式：clustered / stacked / percentStacked / standard
      if (el.grouping) chartOpts.barGrouping = el.grouping;
      // 图表标题
      if (el.title) { chartOpts.title = el.title; chartOpts.showTitle = true; }
      if (el.titleColor) chartOpts.titleColor = hex(el.titleColor);
      if (el.dataLabelColor) chartOpts.dataLabelColor = hex(el.dataLabelColor);
      if (el.legendColor) chartOpts.legendColor = hex(el.legendColor);
      slide.addChart(chartMap[el.chartType] || pptx.ChartType.bar, data, chartOpts);
      break;
    }
    case 'table': {
      let rows = (el.rows || []).map(r => r.map(cell =>
        typeof cell === 'string' ? { text: cell, options: { fontFace: page.fontFace || '微软雅黑', fontSize: pt(el.fontSize || 14), color: hex(el.color || '#1A1A1A') } }
        : { text: cell.text, options: { bold: cell.bold, color: hex(cell.color || el.color || '#1A1A1A'), fontFace: page.fontFace || '微软雅黑', fontSize: pt(cell.fontSize || el.fontSize || 14) } }));
      // 斑马纹：zebra=true 时奇数数据行加浅底（表头跳过）
      if (el.zebra) {
        const zebraFill = el.zebraFill || '#F8FAFC';
        rows = rows.map((row, ri) => {
          if (ri === 0) return row; // 表头不动
          if (ri % 2 === 1) return row.map(cell => ({
            text: cell.text,
            options: { ...cell.options, fill: { color: hex(zebraFill) } },
          }));
          return row;
        });
      }
      slide.addTable(rows, {
        x: o.x, y: o.y, w: o.w, h: o.h,
        colW: (el.colW || []).map(px),
        border: el.border === false ? { type: 'none' } : { color: hex(el.borderColor || '#E2E8F0'), pt: px(el.borderWidth || 1) },
        fill: el.headerFill ? { color: hex(el.headerFill) } : undefined,
        valign: 'middle',
      });
      break;
    }
    /* ── 增强元素（双引擎视觉 → 原生 .pptx 降级映射） ── */
    case 'gradientBar': {
      // pptxgenjs 渐变兼容有限：用 from 色矩形 + to 色半透 overlay 叠出渐变感
      const from = hex(el.from || '#3B82F6');
      const to = hex(el.to || '#0EA5E9');
      const radius = el.radius !== undefined ? px(el.radius) : px(6);
      slide.addShape(pptx.ShapeType.roundRect, {
        x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: radius,
        fill: { color: from }, line: { type: 'none' },
      });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: radius,
        fill: { color: to, transparency: 45 }, line: { type: 'none' },
      });
      break;
    }
    case 'glowOrb': {
      // 光晕降级：多层同心椭圆 + 递减透明度（近似 HTML radial-gradient 光晕）
      const color = el.color || '#3B82F6';
      const alpha = el.alpha !== undefined ? el.alpha : 0.35;
      const blur = el.blur || 40;
      const cx = o.x, cy = o.y, r = Math.max(o.w, o.h) || px(el.r || 200);
      const layers = [0.22, 0.5, 1].map((f, li) => ({
        size: r * (li === 0 ? 1 : li === 1 ? 0.72 : 0.45),
        trans: Math.min(100, 100 - alpha * 100 * (li === 0 ? 0.5 : li === 1 ? 0.85 : 1)),
      }));
      layers.forEach(l => {
        slide.addShape(pptx.ShapeType.ellipse, {
          x: cx + (r - l.size) / 2, y: cy + (r - l.size) / 2, w: l.size, h: l.size,
          fill: { color: hex(color), transparency: l.trans }, line: { type: 'none' },
        });
      });
      void blur;
      break;
    }
    case 'decoBlock': {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: o.x, y: o.y, w: o.w, h: o.h,
        rectRadius: el.radius !== undefined ? px(el.radius) : px(8),
        fill: { color: hex(el.fill || '#3B82F6'), transparency: el.alpha !== undefined ? Math.round((1 - el.alpha) * 100) : 90 },
        line: { type: 'none' },
      });
      break;
    }
    case 'kpiBlock': {
      // 色块衬底 + 大数值 + 标签
      const numColor = el.color || '#1E3A5F';
      slide.addShape(pptx.ShapeType.roundRect, {
        x: o.x, y: o.y, w: o.w, h: o.h,
        rectRadius: el.radius !== undefined ? px(el.radius) : px(12),
        fill: el.fill ? { color: hex(el.fill), transparency: el.fillTrans || 90 }
                      : { color: 'FFFFFF', transparency: 92 },
        line: { color: hex(el.borderColor || '#E2E8F0'), width: px(1) },
      });
      const val = el.value !== undefined ? el.value : (el.text || '');
      slide.addText(String(val), {
        x: px((el.x || 0) + 14), y: px((el.y || 0) + 12), w: Math.max(0, px((el.w || 0) - 28)), h: px(70),
        fontSize: pt(el.numSize || 44), bold: true, color: hex(numColor),
        fontFace: el.fontFace || page.fontFace || '微软雅黑', margin: 0, fit: 'shrink',
      });
      if (el.label) {
        slide.addText(el.label, {
          x: px((el.x || 0) + 14), y: px((el.y || 0) + 92), w: Math.max(0, px((el.w || 0) - 28)), h: px(30),
          fontSize: pt(el.labelSize || 14), color: hex(el.labelColor || '#64748B'),
          fontFace: el.fontFace || page.fontFace || '微软雅黑', margin: 0, fit: 'shrink',
        });
      }
      break;
    }
    default:
      throw new Error(`未知元素类型: ${el.type}`);
  }
}

function build(projectDir, outFile) {
  const { design, pages } = loadProject(projectDir);
  const PptxGenJS = require(path.join(__dirname, '..', 'node_modules', 'pptxgenjs'));
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = design.author || 'Tiffa';
  pptx.title = design.title || '演示文稿';
  pptx.subject = design.subject || '';

  pages.forEach((page, i) => {
    const slide = pptx.addSlide();
    // 主题背景（页级 override > 主题背景 > 默认白）
    const themeId = page.theme || design.theme || 'generic';
    const th = THEME_DEFS[themeId] || THEME_DEFS.generic;
    const bg = page.background || (th && th.bg);
    if (bg) slide.background = { color: hex(bg) };
    if (page.backgroundImage) slide.background = { path: path.resolve(page.backgroundImage) };
    // 主题装饰层（角落强调条 / 页脚条）垫在元素下层
    if (th) {
      const d = page.decoration || th.decoration || {};
      const corner = d.corner || '';
      const p = th.palette || {};
      if (corner === 'bar') {
        slide.addShape(pptx.ShapeType.rect, {
          x: px(1140), y: 0, w: px(140), h: px(8),
          fill: { color: hex(p.primary || '3B82F6') }, line: { type: 'none' },
        });
        slide.addShape(pptx.ShapeType.rect, {
          x: px(1140), y: px(8), w: px(90), h: px(4),
          fill: { color: hex(p.accent || '0EA5E9'), transparency: 50 }, line: { type: 'none' },
        });
      } else if (corner === 'barDark') {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0, y: px(714), w: px(1280), h: px(6),
          fill: { color: hex(p.primary || '3B82F6') }, line: { type: 'none' },
        });
      }
      if (page.role !== 'hero' && d.footer !== false) {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0, y: px(716), w: px(180), h: px(4),
          fill: { color: hex(p.primary || '3B82F6'), transparency: 50 }, line: { type: 'none' },
        });
      }
    }
    page.elements.forEach(el => renderElement(slide, pptx, el, page));
    // 页码兜底: 内容页未显式写页码时自动补
    if (!['cover', 'section', 'ending'].includes(page.type) &&
        !page.elements.some(el => el.type === 'text' && el.y >= 650 && /NN|TOTAL|页码|^\d+\s*\/\s*\d+/.test(el.text || ''))) {
      slide.addText(`${i + 1} / ${pages.length}`, {
        x: px(1120), y: px(668), w: px(120), h: px(40),
        fontSize: pt(14), color: hex(design.palette?.[3] || '#64748B'),
        fontFace: page.fontFace || '微软雅黑', align: 'right', valign: 'middle',
        margin: 0, fit: 'shrink',
      });
    }
  });

  const outDir = path.dirname(path.resolve(outFile));
  fs.mkdirSync(outDir, { recursive: true });
  return pptx.writeFile({ fileName: path.resolve(outFile) }).then(() => path.resolve(outFile));
}

// ---------------- CLI ----------------
function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const projectDir = get('--project') || process.cwd();
  const outFile = get('-o') || path.join(projectDir, 'output', 'deck.pptx');
  const lintOnly = args.includes('--lint-only');

  const { errors, warn, pages } = lint(projectDir);
  warn.forEach(w => console.log(`[warn] ${w}`));
  if (errors.length) {
    console.error(`\n❌ LINT FAILED (${errors.length} 项):`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`✅ lint 通过 (${pages} 页)`);
  if (lintOnly) return;

  build(projectDir, outFile)
    .then(f => console.log(`✅ 已生成: ${f}`))
    .catch(e => { console.error('❌ 生成失败:', e.message); process.exit(1); });
}

main();
