#!/usr/bin/env node
/**
 * pptx-designer render-editor.js
 * 页面定义(pages/*.js) → 交互式编辑器 HTML（Canva 式：点选/拖拽/缩放/改字/属性面板/图表强调/导出）
 *
 * 用法:
 *   node scripts/render-editor.js --project <项目目录> [-o editor.html]
 *
 * 交互说明:
 *   - 顶部: 页面 tabs 切换 + 导出按钮
 *   - 画布: 点选元素(高亮) → 拖动移动 / 右下角手柄缩放 / 双击改文字
 *   - 右侧: 属性面板(文字/字号/颜色/位置/尺寸; 图表: 系列增删+强调)
 *   - 导出: deck.json (页面定义 + design) → 下载后交回 build.js 渲染 .pptx
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { THEMES, CANVAS_W, CANVAS_H, themeCSS, themeVars } = require(path.join(__dirname, 'visual', 'themes.js'));
const { chartHTML } = require(path.join(__dirname, 'visual', 'chartHtml'));
const { shrinkFactor } = require('./shrink');

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

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 与 preview.js 相同的元素渲染（编辑器画布用）
function elHtml(el, page, theme) {
  const style = `left:${el.x || 0}px;top:${el.y || 0}px;width:${el.w || 0}px;height:${el.h || 0}px;`;
  switch (el.type) {
    case 'text': {
      const { factor, fontSize: sfs, lineH: slh } = shrinkFactor(el);
      const fs = sfs;
      const lineH = slh;
      const align = el.align || 'left';
      const valign = el.valign || 'top';
      const color = el.color || '#1A1A1A';
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
      return `<div style="position:absolute;${style}font-size:${fs}px;font-weight:${el.bold ? 'bold' : 'normal'};font-style:${el.italic ? 'italic' : 'normal'};color:${color};text-align:${align};display:flex;align-items:${valign === 'middle' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start'};${lineHpx}overflow:hidden;white-space:pre-wrap">${inner}</div>`;
    }
    case 'rect':
    case 'roundRect': {
      const bg = el.fill || 'transparent';
      const opacity = el.opacity !== undefined ? `opacity:${el.opacity};` : '';
      const radius = (el.type === 'roundRect' || el.radius !== undefined) ? `border-radius:${el.radius || 8}px;` : '';
      const border = el.lineColor ? `border:${el.lineWidth || 1}px solid ${el.lineColor};` : '';
      return `<div style="position:absolute;${style}background:${bg};${opacity}${radius}${border}"></div>`;
    }
    case 'ellipse': {
      return `<div style="position:absolute;${style}background:${el.fill || 'transparent'};border-radius:50%;${el.opacity !== undefined ? `opacity:${el.opacity};` : ''}"></div>`;
    }
    case 'line': {
      return `<svg style="position:absolute;left:${el.x1 || 0}px;top:${el.y1 || 0}px;overflow:visible" width="2" height="2"><line x1="0" y1="0" x2="${(el.x2 || 0) - (el.x1 || 0)}" y2="${(el.y2 || 0) - (el.y1 || 0)}" stroke="${el.color || '#1A1A1A'}" stroke-width="${el.width || 2}"/></svg>`;
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
      // 真实图表：bar/line/area/pie/doughnut → 共享 chartHtml 模块（视觉与 preview 一致）
      return chartHTML(el, theme);
    }
    case 'table': {
      const rows = (el.rows || []).map(r =>
        `<tr>${r.map(c => `<td style="border:1px solid ${el.borderColor || '#E2E8F0'};padding:6px 10px;font-weight:${c.bold ? 'bold' : 'normal'};color:${c.color || el.color || '#1A1A1A'}">${esc(c.text)}</td>`).join('')}</tr>`).join('');
      return `<div style="position:absolute;${style};overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:${el.fontSize || 14}px">${rows}</table></div>`;
    }
    default:
      return `<!-- 未知元素 ${el.type} -->`;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const projectDir = get('--project') || process.cwd();
  const outFile = get('-o') || path.join(projectDir, 'output', 'editor.html');
  const { design, pages } = loadProject(projectDir);

  // 图片元素预处理：_src 转 file:// URL，编辑器内可直接预览真实图片（加载失败回退占位）
  function preprocessImages(page) {
    (page.elements || []).forEach(el => {
      if (el.type === 'image' && el.path) {
        const abs = path.resolve(el.path);
        if (fs.existsSync(abs)) el._src = 'file:///' + abs.replace(/\\/g, '/');
        else delete el._src;
      } else if (el._src) {
        delete el._src;
      }
    });
  }
  pages.forEach(preprocessImages);

  // 模板页预处理：layout 页用 dashiai 主题运行时渲染为静态 HTML（编辑器内只读预览）
  const layoutCssList = [];
  async function preprocessLayouts(page) {
    if (!page.layout) return;
    try {
      const mod = await import(pathToFileURL(path.join(__dirname, 'export', 'layout-render.mjs')).href);
      const { html, css, meta } = await mod.renderLayoutPage(page.layout, page.data || {});
      page._layoutHtml = html;
      page._layoutLabel = meta.label || page.layout;
      try {
        const c = await mod.describeLayout(page.layout);
        page._layoutControls = (c && c.controls) || [];
        page._layoutDefaults = (c && c.defaultProps) || {};
      } catch(e2) { page._layoutControls = []; }
      if (css && !layoutCssList.includes(css)) layoutCssList.push(css);
    } catch (e) {
      console.warn('[layout] ' + page.layout + ' 渲染失败: ' + e.message);
      page._layoutHtml = '<div style="padding:40px;color:#F87171;font-size:18px">模板渲染失败: ' + esc(page.layout) + '<br>' + esc(e.message) + '</div>';
      page._layoutLabel = '模板渲染失败';
    }
  }
  await Promise.all(pages.map(preprocessLayouts));

  // 注入页面数据（编辑器 JS 使用）
  const deckData = JSON.stringify({ design, pages }).replace(/</g, '\\u003c');
  const layoutStyle = layoutCssList.length ? '<style>' + layoutCssList.join('\n') + '</style>' : '';

  // 浏览器端导出组件（file:// 绝对路径，随技能目录走）
  const vendorScriptTags = [
    'html-to-image.js','pptxgen.bundle.js','editable-pptx-browser.js','pdf-lib.min.js','gsap.min.js'
  ].map(f => '<script src="' + pathToFileURL(path.join(__dirname, '..', 'assets', 'vendor', f)).href + '"></script>').join('\n');
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${esc(design.title || 'PPT 编辑器')}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { height:100%; font-family:"微软雅黑",sans-serif; background:#0F172A; color:#E2E8F0; overflow:hidden; }
  #topbar { height:52px; display:flex; align-items:center; gap:8px; padding:0 14px; background:#1E293B; border-bottom:1px solid #334155; }
  #topbar .title { font-weight:bold; color:#F8FAFC; margin-right:8px; }
  .tab { padding:6px 12px; border-radius:6px; background:#334155; border:1px solid #475569; color:#CBD5E1; cursor:pointer; font-size:13px; }
  .tab.active { background:#3B82F6; border-color:#3B82F6; color:#fff; }
  .btn { padding:6px 14px; border-radius:6px; border:none; cursor:pointer; font-size:13px; font-weight:bold; }
  .btn-primary { background:#3B82F6; color:#fff; }
  .btn-ghost { background:#334155; color:#CBD5E1; }
  .spacer { flex:1; }
  #stage { position:relative; height:calc(100% - 52px); display:flex; }
  #canvasWrap { flex:1; position:relative; overflow:hidden; background:#0F172A; display:flex; align-items:center; justify-content:center; }
  #canvas { width:1280px; height:720px; position:relative; background:#fff; box-shadow:0 10px 60px rgba(0,0,0,.6); transform-origin:center; }
  .el { position:absolute; cursor:move; }
  .el.selected { outline:2px solid #3B82F6; outline-offset:0; }
  .el .handle { position:absolute; right:-6px; bottom:-6px; width:12px; height:12px; background:#3B82F6; border:2px solid #fff; border-radius:3px; cursor:se-resize; display:none; }
  .el.selected .handle { display:block; }
  #panel { width:280px; background:#1E293B; border-left:1px solid #334155; padding:14px; overflow-y:auto; font-size:13px; }
  #panel h3 { font-size:14px; margin-bottom:10px; color:#F8FAFC; }
  .field { margin-bottom:10px; }
  .field label { display:block; color:#94A3B8; margin-bottom:4px; font-size:12px; }
  .field input,.field select { width:100%; padding:6px 8px; background:#0F172A; border:1px solid #334155; color:#E2E8F0; border-radius:5px; font-size:13px; }
  .field input[type=color] { height:30px; padding:2px; }
  .row2 { display:flex; gap:8px; }
  .row2 .field { flex:1; }
  .empty { color:#64748B; text-align:center; padding:40px 10px; font-size:13px; }
  .series-item { display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid #334155; }
  .series-item input[type=color] { width:26px; height:22px; padding:1px; }
  .series-item input[type=text] { flex:1; background:#0F172A; border:1px solid #334155; color:#E2E8F0; border-radius:4px; padding:3px 6px; font-size:12px; }
  .series-item label { font-size:11px; color:#94A3B8; display:flex; align-items:center; gap:3px; }
  .series-item .del { background:none; border:none; color:#F87171; cursor:pointer; font-size:15px; }
  .add { background:#334155; border:1px dashed #64748B; color:#94A3B8; width:100%; padding:5px; border-radius:5px; cursor:pointer; margin-top:6px; font-size:12px; }
  #toast { position:fixed; bottom:18px; left:50%; transform:translateX(-50%); background:#059669; color:#fff; padding:8px 18px; border-radius:8px; font-size:13px; opacity:0; transition:.3s; z-index:99; }
  #toast.show { opacity:1; }
  #exportBanner { display:none; background:#7F1D1D; color:#FECACA; padding:8px 14px; font-size:13px; align-items:center; gap:10px; border-bottom:1px solid #991B1B; }
  #exportBanner code { background:rgba(255,255,255,.12); padding:1px 6px; border-radius:4px; font-size:12px; }
  #exportBanner .btn { padding:3px 12px; font-size:12px; background:#991B1B; color:#FECACA; }
  #exportBanner .btn:hover { background:#B91C1C; }
  #exportBanner.ok { background:#065F46; color:#A7F3D0; border-bottom-color:#047857; }
  /* ---- 原创暗色 UI 升级 ---- */
  #topbar { background:linear-gradient(180deg,#1E293B,#16202F); box-shadow:0 1px 0 rgba(255,255,255,.06), 0 4px 18px rgba(0,0,0,.35); position:relative; z-index:6; }
  .title { letter-spacing:.4px; }
  .tab { border-radius:8px; transition:all .15s; }
  .tab:hover { background:#475569; color:#fff; }
  .btn { border-radius:8px; transition:all .15s; box-shadow:0 1px 2px rgba(0,0,0,.3); }
  .btn:hover { filter:brightness(1.12); transform:translateY(-1px); }
  #stage { background:radial-gradient(ellipse 80% 60% at 50% 0%, #1E293B 0%, #0B1220 100%); }
  #panel { background:#141D2E; border-left:1px solid #24334A; box-shadow:-4px 0 18px rgba(0,0,0,.25); }
  #panel h3 { font-size:13px; color:#E2E8F0; border-bottom:1px solid #24334A; padding-bottom:8px; }
  .field label { color:#94A3B8; }
  .field input,.field select { border-radius:6px; background:#0F1A2E; border:1px solid #2A3B57; }
  #rail { width:176px; background:#101A2B; border-right:1px solid #24334A; overflow-y:auto; padding:10px 0; flex:none; scrollbar-width:thin; scrollbar-color:#334155 transparent; }
  .rail-item { position:relative; width:152px; height:86px; margin:0 auto 10px; border-radius:8px; overflow:hidden; cursor:pointer; border:2px solid transparent; background:#0B1524; transition:border-color .15s, box-shadow .15s; }
  .rail-item:hover { border-color:#3D5A85; }
  .rail-item.active { border-color:#3B82F6; box-shadow:0 0 0 1px #3B82F6, 0 4px 12px rgba(59,130,246,.25); }
  .rail-mini { position:absolute; left:50%; top:50%; margin-left:-640px; margin-top:-360px; }
  .rail-label { position:absolute; left:5px; bottom:3px; font-size:10px; color:#E2E8F0; background:rgba(11,21,36,.78); padding:1px 6px; border-radius:4px; }
  #canvasWrap { position:relative; }
  #pager { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:10px; background:rgba(20,29,46,.92); border:1px solid #2A3B57; border-radius:999px; padding:5px 14px; z-index:5; box-shadow:0 4px 16px rgba(0,0,0,.4); backdrop-filter:blur(6px); }
  .pg { width:26px; height:26px; border-radius:50%; border:1px solid #334155; background:#1E293B; color:#E2E8F0; font-size:15px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; }
  .pg:hover { background:#3B82F6; border-color:#3B82F6; color:#fff; }
  #pgCount { color:#CBD5E1; font-size:12px; min-width:44px; text-align:center; font-variant-numeric:tabular-nums; }
  /* ---- HospAI 设计语言增强（借鉴 MedReview/SmartReview：渐变+光晕+焦点环） ---- */
  :root {
    --hosp-primary:#1890FF; --hosp-primary-hover:#40A9FF; --hosp-primary-glow:rgba(24,144,255,.35);
    --hosp-success:#52C41A; --hosp-success-glow:rgba(82,196,26,.32);
    --hosp-danger:#FF4D4F; --hosp-warning:#FA8C16;
    --hosp-text:#E2E8F0; --hosp-sub:#94A3B8;
  }
  /* 顶栏：深蓝渐变 + 底部彩色光晕分隔线 */
  #topbar { background:linear-gradient(135deg,#16213E 0%,#1E293B 60%,#16202F 100%); }
  #topbar::after { content:""; position:absolute; left:0; right:0; bottom:-1px; height:1px; background:linear-gradient(90deg,transparent, rgba(24,144,255,.5), rgba(82,196,26,.4), transparent); }
  /* 按钮：渐变主按钮 + 内高光 + hover 光晕浮起 */
  .btn { font-weight:600; letter-spacing:.3px; }
  .btn-primary { background:linear-gradient(135deg,#1890FF,#40A9FF); box-shadow:0 2px 10px rgba(24,144,255,.28), inset 0 1px 0 rgba(255,255,255,.28); }
  .btn-primary:hover { filter:brightness(1.08); transform:translateY(-1px); box-shadow:0 5px 16px rgba(24,144,255,.45), inset 0 1px 0 rgba(255,255,255,.28); }
  .btn-primary:active { transform:translateY(0); box-shadow:0 2px 6px rgba(24,144,255,.3); }
  .btn-ghost { background:rgba(148,163,184,.08); border:1px solid rgba(148,163,184,.18); color:#CBD5E1; }
  .btn-ghost:hover { background:rgba(148,163,184,.16); border-color:rgba(24,144,255,.5); color:#fff; transform:translateY(-1px); box-shadow:0 2px 10px rgba(24,144,255,.18); }
  /* 导出按钮统一渐变（顶栏已精简，导出收进底部下拉） */
  /* tab：active 渐变发光 */
  .tab { border:1px solid rgba(148,163,184,.16); background:rgba(148,163,184,.06); }
  .tab.active { background:linear-gradient(135deg,#1890FF,#40A9FF); border-color:transparent; box-shadow:0 2px 10px rgba(24,144,255,.38), inset 0 1px 0 rgba(255,255,255,.28); }
  /* 输入控件：focus 焦点环（SmartReview ring 风格） */
  .field input:focus,.field select:focus,.series-item input[type=text]:focus { outline:none; border-color:#1890FF; box-shadow:0 0 0 3px rgba(24,144,255,.16); }
  /* 画布选中态：统一 HospAI 蓝 */
  .el.selected { outline-color:#1890FF; }
  .el .handle { background:#1890FF; box-shadow:0 0 0 2px rgba(24,144,255,.25); }
  /* 缩略图 active 发光 */
  .rail-item.active { border-color:#1890FF; box-shadow:0 0 0 1px #1890FF, 0 6px 18px rgba(24,144,255,.35); }
  /* 翻页 pill：发光 + 内高光 */
  #pager { box-shadow:0 4px 20px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.07); }
  .pg:hover { background:linear-gradient(135deg,#1890FF,#40A9FF); border-color:transparent; }
  /* 底部工具栏：分隔线 + 主题下拉 + 导出下拉菜单（顶栏按钮已精简下沉） */
  .toolbar-sep { width:1px; height:18px; background:#2A3B57; margin:0 4px; }
  #themeSel { background:#0F1A2E; border:1px solid #2A3B57; color:#CBD5E1; border-radius:6px; padding:3px 8px; font-size:12px; cursor:pointer; }
  #themeSel:focus { outline:none; border-color:#1890FF; box-shadow:0 0 0 3px rgba(24,144,255,.16); }
  .export-menu-wrap { position:relative; }
  .btn-export { background:linear-gradient(135deg,#1890FF,#40A9FF); color:#fff; border:none; border-radius:8px; padding:5px 14px; font-size:12px; font-weight:600; letter-spacing:.3px; cursor:pointer; box-shadow:0 2px 8px rgba(24,144,255,.3), inset 0 1px 0 rgba(255,255,255,.25); transition:all .15s; }
  .btn-export:hover { filter:brightness(1.1); transform:translateY(-1px); box-shadow:0 4px 14px rgba(24,144,255,.45), inset 0 1px 0 rgba(255,255,255,.25); }
  .export-menu { position:absolute; bottom:calc(100% + 10px); right:0; min-width:220px; background:#141D2E; border:1px solid #2A3B57; border-radius:10px; box-shadow:0 10px 32px rgba(0,0,0,.55), 0 0 0 1px rgba(24,144,255,.08); padding:6px; display:none; z-index:60; }
  .export-menu.open { display:block; }
  .export-menu-title { font-size:11px; color:#94A3B8; padding:4px 10px 6px; }
  .export-menu-item { padding:8px 10px; font-size:13px; color:#E2E8F0; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:8px; transition:background .12s; }
  .export-menu-item:hover { background:rgba(24,144,255,.14); color:#fff; }
  .export-menu-divider { height:1px; background:#24334A; margin:4px 6px; }
  /* 顶栏页码导航（替代 tabs：多页不溢出，点击页码输入跳转） */
  #topnav { display:flex; align-items:center; gap:6px; background:rgba(20,29,46,.85); border:1px solid #2A3B57; border-radius:999px; padding:3px 10px; box-shadow:0 2px 10px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06); }
  #topnav .pg { width:22px; height:22px; font-size:13px; background:transparent; border-color:#334155; }
  #topnav .pg:hover { background:linear-gradient(135deg,#1890FF,#40A9FF); border-color:transparent; }
  #topPg { color:#CBD5E1; font-size:12px; min-width:52px; text-align:center; cursor:pointer; font-variant-numeric:tabular-nums; padding:3px 8px; border-radius:6px; transition:background .12s; }
  #topPg:hover { background:rgba(24,144,255,.15); color:#fff; }
  /* 添加系列按钮 hover 强化 */
  .add:hover { border-color:#1890FF; color:#40A9FF; background:rgba(24,144,255,.08); }
  /* 删除按钮 hover 微动效 */
  .series-item .del:hover { transform:scale(1.2); }
  /* toast：厚重投影 + 字重 */
  #toast { box-shadow:0 6px 24px rgba(0,0,0,.5); font-weight:600; letter-spacing:.3px; }
  /* 主题下拉微调 */
  #themeSel { background:#0F1A2E; border:1px solid #2A3B57; color:#CBD5E1; }
  #themeSel:focus { outline:none; border-color:#1890FF; box-shadow:0 0 0 3px rgba(24,144,255,.16); }
</style>
${layoutStyle}
</head>
<body>
  ${vendorScriptTags}
  <div id="topbar">
    <span class="title">${esc(design.title || 'PPT 编辑器')}</span>
    <div class="spacer"></div>
    <div id="topnav" title="点击页码可输入跳转">
      <button class="pg" onclick="pg(-1)" title="上一页">&#8249;</button>
      <span id="topPg" onclick="jumpPage()">1 / 1</span>
      <button class="pg" onclick="pg(1)" title="下一页">&#8250;</button>
    </div>
  </div>
  <div id="exportBanner">
    <span>已启用浏览器端导出（无需服务）；如需服务端导出请运行 <code>node scripts/serve-export.cjs</code></span>
    <button class="btn" onclick="checkExportService(true)">重试</button>
  </div>
  <div id="stage">
    <aside id="rail"></aside>
    <div id="canvasWrap">
      <div id="canvas"></div>
      <div id="pager">
        <button class="pg" onclick="pg(-1)">&#8249;</button>
        <span id="pgCount">1 / 1</span>
        <button class="pg" onclick="pg(1)">&#8250;</button>
        <div class="toolbar-sep"></div>
        <select id="themeSel" title="切换主题">
          ${Object.entries(THEMES).map(([id,t])=>`<option value="${id}">${t.name}</option>`).join('')}
        </select>
        <div class="export-menu-wrap">
          <button class="btn-export" onclick="toggleExportMenu(event)">导出 ▾</button>
          <div class="export-menu" id="exportMenu">
            <div class="export-menu-title">导出文件</div>
            <div class="export-menu-item" onclick="toggleExportMenu(event); exportTo('pptx')">📊 导出 PPTX 演示文稿</div>
            <div class="export-menu-item" onclick="toggleExportMenu(event); exportTo('pdf')">📄 导出 PDF 文档</div>
            <div class="export-menu-divider"></div>
            <div class="export-menu-item" onclick="toggleExportMenu(event); exportDeck()">导出 deck.json（页面定义）</div>
            <div class="export-menu-item" onclick="toggleExportMenu(event); exportPages()">导出 pages/*.js 源码</div>
          </div>
        </div>
      </div>
    </div>
    <div id="panel"><div class="empty">点击画布中的元素进行编辑<br/><br/>拖动移动 · 右下角手柄缩放 · 双击改文字<br/>图表可在右侧增删系列 / 设置强调</div></div>
  </div>
  <div id="toast"></div>
  <div id="deck" style="position:absolute;left:-20000px;top:0;width:1280px;height:720px;overflow:hidden;pointer-events:none"></div>
<script>
// ── 图表渲染模块（visual/chartHtml.js 内联：画布/缩略图/导出镜像三处共用真实图表） ──
${fs.readFileSync(path.join(__dirname, 'visual', 'chartHtml.js'), 'utf8')}
const DECK = ${deckData};
// 主题库（16 套，供编辑器切主题/装饰/背景用）
const themeMap = ${JSON.stringify(Object.fromEntries(Object.entries(THEMES).map(([k,t])=>
  [k,{ bg:t.bg, dark:!!t.dark, texture:t.texture,
       palette:Object.fromEntries(Object.entries(t.palette).filter(([kk])=>!kk.startsWith('--'))),
       decoration:t.decoration||{} }])))};
let cur = 0;          // 当前页索引
let selIdx = -1;      // 选中的元素索引
let drag = null;      // 拖拽状态

const $ = s => document.querySelector(s);
const canvas = $('#canvas');
const panel = $('#panel');

function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}

// ---------- 渲染当前页 ----------
function render(){
  const page = DECK.pages[cur];
  const themeId = page.theme || (DECK.design&&DECK.design.theme) || 'generic';
  const th = themeMap[themeId] || themeMap.generic;
  canvas.innerHTML = '';
  // 模板页（layout）：只读展示预渲染 HTML
  if(page._layoutHtml){
    let bg = page.background || th.bg;
    if(th.texture==='radial') bg += '; background-image: radial-gradient(ellipse 60% 45% at 82% 12%, '+rgbaOf(th.palette.primary,0.2)+' 0%, transparent 55%), radial-gradient(ellipse 50% 50% at 8% 88%, '+rgbaOf(th.palette.accent,0.18)+' 0%, transparent 50%)';
    canvas.style.background = bg;
    canvas.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0">'+page._layoutHtml+'</div>');
    canvas.insertAdjacentHTML('beforeend', '<div style="position:absolute;right:10px;top:10px;background:rgba(124,58,237,.9);color:#fff;font-size:12px;padding:4px 10px;border-radius:999px;z-index:5">模板页 · '+esc(page._layoutLabel||page.layout||'')+'</div>');
    renderTabs(); renderRail(); updatePager();
    return;
  }
  // 主题背景（含径向光效纹理）
  let bg = page.background || th.bg;
  if(th.texture==='radial') bg += '; background-image: radial-gradient(ellipse 60% 45% at 82% 12%, '+rgbaOf(th.palette.primary,0.2)+' 0%, transparent 55%), radial-gradient(ellipse 50% 50% at 8% 88%, '+rgbaOf(th.palette.accent,0.18)+' 0%, transparent 50%)';
  canvas.style.background = bg;
  // 装饰层（角落强调条 / 页脚条）
  canvas.insertAdjacentHTML('beforeend', decoHtml(page, th));
  page.elements.forEach((el,i)=>{
    const div = document.createElement('div');
    div.className = 'el' + (i===selIdx ? ' selected' : '');
    div.innerHTML = elHtml(el, page, th) + '<div class="handle"></div>';
    // 交互绑定
    div.addEventListener('mousedown', e => select(i, e));
    div.addEventListener('dblclick', e => editText(i, e));
    canvas.appendChild(div);
  });
  renderTabs(); renderRail(); updatePager();
}
// ---------- 页面装饰层（编辑器预览） ----------
function decoHtml(page, th){
  const p = th.palette, d = page.decoration || th.decoration || {}, corner = d.corner || '';
  let h = '';
  if(corner==='bar'){
    h += '<div style="position:absolute;right:0;top:0;width:140px;height:8px;background:'+p.primary+';opacity:.85;pointer-events:none;"></div>';
    h += '<div style="position:absolute;right:0;top:8px;width:90px;height:4px;background:'+p.accent+';opacity:.5;pointer-events:none;"></div>';
  } else if(corner==='glow' && th.dark){
    h += '<div style="position:absolute;right:-60px;top:-60px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle, '+rgbaOf(p.primary,0.22)+', transparent 65%);pointer-events:none;"></div>';
  } else if(corner==='barDark' && th.dark){
    h += '<div style="position:absolute;left:0;bottom:0;width:100%;height:6px;background:linear-gradient(90deg,'+p.primary+','+p.accent+');opacity:.9;pointer-events:none;"></div>';
  }
  if(page.role !== 'hero' && d.footer !== false){
    h += '<div style="position:absolute;left:0;bottom:0;width:180px;height:4px;background:'+p.primary+';opacity:.5;pointer-events:none;"></div>';
  }
  return h;
}

function elHtml(el, page, theme){
  const style = 'left:'+(el.x||0)+'px;top:'+(el.y||0)+'px;width:'+(el.w||0)+'px;height:'+(el.h||0)+'px;';
  switch(el.type){
    case 'text': {
      const fs = el.fontSize||18;
      const align = el.align||'left', valign = el.valign||'top';
      const color = el.color||'#1A1A1A';
      let inner;
      if(el.runs && el.runs.length){
        inner = el.runs.map(r=>'<span style="font-weight:'+(r.bold?'bold':'normal')+';color:'+(r.color||color)+';font-size:'+((r.fontSize||fs))+'px">'+esc(r.text)+'</span>').join('');
      } else inner = esc(el.text||'');
      return '<div style="position:absolute;'+style+'font-size:'+fs+'px;font-weight:'+(el.bold?'bold':'normal')+';color:'+color+';text-align:'+align+';display:flex;align-items:'+(valign==='middle'?'center':valign==='bottom'?'flex-end':'flex-start')+';white-space:pre-wrap">'+inner+'</div>';
    }
    case 'rect': case 'roundRect':
      return '<div style="position:absolute;'+style+'background:'+(el.fill||'transparent')+';'+(el.type==='roundRect'||el.radius!==undefined?'border-radius:'+(el.radius||8)+'px;':'')+((el.lineColor)?'border:1px solid '+el.lineColor+';':'')+'"></div>';
    case 'ellipse':
      return '<div style="position:absolute;'+style+'background:'+(el.fill||'transparent')+';border-radius:50%"></div>';
    case 'line':
      return '<svg style="position:absolute;left:'+(el.x1||0)+'px;top:'+(el.y1||0)+'px;overflow:visible" width="2" height="2"><line x1="0" y1="0" x2="'+((el.x2||0)-(el.x1||0))+'" y2="'+((el.y2||0)-(el.y1||0))+'" stroke="'+(el.color||'#1A1A1A')+'" stroke-width="'+(el.width||2)+'"/></svg>';
    case 'image': {
      if (el._src) {
        const fit = el.objectFit === 'contain' ? 'contain' : 'cover';
        const radius = el.radius ? 'border-radius:'+el.radius+'px;' : '';
        return '<img src="'+el._src+'" data-x="'+(el.x||0)+'" data-y="'+(el.y||0)+'" data-w="'+(el.w||0)+'" data-h="'+(el.h||0)+'" style="position:absolute;'+style+'object-fit:'+fit+';'+radius+'" onerror="imgFail(event)">';
      }
      const cap = el.caption ? '图片占位 · '+el.caption : '图片占位';
      return '<div style="position:absolute;'+style+';background:#E2E8F0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:14px">'+esc(cap)+'</div>';
    }
    case 'chart': {
      // 真实图表：与 preview 一致的 chartHtml 模块（主题由调用方传入）
      return chartHTML(el, theme);
    }
    case 'table': {
      const rows = (el.rows||[]).map(r=>'<tr>'+r.map(c=>'<td style="border:1px solid '+(el.borderColor||'#E2E8F0')+';padding:4px 8px;font-weight:'+(c.bold?'bold':'normal')+';color:'+(c.color||el.color||'#333')+'">'+esc(c.text)+'</td>').join('')+'</tr>').join('');
      return '<div style="position:absolute;'+style+';overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:'+(el.fontSize||14)+'px">'+rows+'</table></div>';
    }
    case 'gradientBar': {
      const g = (el.dir==='vertical') ? 'linear-gradient(0deg, '+(el.from||'#3B82F6')+', '+(el.to||'#0EA5E9')+')' : 'linear-gradient(90deg, '+(el.from||'#3B82F6')+', '+(el.to||'#0EA5E9')+')';
      return '<div style="position:absolute;'+style+'background:'+g+';border-radius:'+((el.radius===undefined?6:el.radius))+'px"></div>';
    }
    case 'glowOrb': {
      const r = el.r||200, cx=(el.x||0), cy=(el.y||0);
      return '<div style="position:absolute;left:'+cx+'px;top:'+cy+'px;width:'+r+'px;height:'+r+'px;border-radius:50%;background:radial-gradient(circle, '+(el.color||'#3B82F6')+(el.alpha===undefined?'59':Math.round(el.alpha*255).toString(16))+', transparent 70%);filter:blur('+(el.blur||40)+'px);pointer-events:none;"></div>';
    }
    case 'decoBlock': {
      return '<div style="position:absolute;'+style+'background:'+(el.fill||'#3B82F6')+';border-radius:'+(el.radius===undefined?8:el.radius)+'px;opacity:'+(el.alpha===undefined?0.1:el.alpha)+';pointer-events:none;"></div>';
    }
    case 'kpiBlock': {
      return '<div style="position:absolute;'+style+'background:'+(el.fill||'rgba(255,255,255,0.06)')+';border:1px solid '+(el.borderColor||'rgba(255,255,255,0.3)')+';border-radius:'+(el.radius===undefined?12:el.radius)+'px;display:flex;flex-direction:column;justify-content:center;padding:12px 16px;box-sizing:border-box;"><div style="font-size:'+(el.numSize||44)+'px;font-weight:800;color:'+(el.color||'#2FE07F')+';line-height:1.1">'+esc(el.value!==undefined?el.value:(el.text||''))+'</div>'+(el.label?'<div style="font-size:'+(el.labelSize||14)+'px;color:#8A94A6;margin-top:6px">'+esc(el.label)+'</div>':'')+'</div>';
    }
    default: return '';
  }
}
// hex → rgba（浏览器端辅助）
function rgbaOf(hex, a){ var h=String(hex||'').replace('#',''); if(!h) return hex; var full=h.length===3?h.split('').map(function(c){return c+c}).join(''):h; var n=parseInt(full,16); return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')'; }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ---------- 左侧缩略图栏 ----------
function renderRail(){
  const rail = document.getElementById('rail');
  if(!rail) return;
  rail.innerHTML = '';
  DECK.pages.forEach((page, i)=>{
    const item = document.createElement('div');
    item.className = 'rail-item' + (i === cur ? ' active' : '');
    item.title = (i+1) + ' ' + (page.type || '');
    item.onclick = function(){ goPage(i); };
    const mini = document.createElement('div');
    mini.className = 'rail-mini';
    mini.style.cssText = 'width:1280px;height:720px;transform:scale(0.125);transform-origin:top left;background:' + (page.background || '#FFFFFF');
    const th = themeMap[page.theme||(DECK.design&&DECK.design.theme)||'generic']||themeMap.generic;
    if(page._layoutHtml){
      mini.innerHTML = '<div style="position:absolute;inset:0">' + page._layoutHtml + '</div>';
    } else {
      (page.elements||[]).forEach(el=>{ mini.innerHTML += elHtml(el, page, th); });
    }
    item.appendChild(mini);
    const label = document.createElement('div');
    label.className = 'rail-label';
    label.textContent = (i+1) + ' ' + (page.type || '');
    item.appendChild(label);
    rail.appendChild(item);
  });
}
function pg(d){
  goPage(Math.max(0, Math.min(DECK.pages.length - 1, cur + d)));
}
function updatePager(){
  const el = document.getElementById('pgCount');
  if(el) el.textContent = (cur + 1) + ' / ' + DECK.pages.length;
}
// ---------- 顶部页码导航（替代页面 tabs：多页不溢出） ----------
function renderTabs(){
  const el = document.getElementById('topPg');
  if(el) el.textContent = (cur + 1) + ' / ' + DECK.pages.length;
}
function jumpPage(){
  const v = prompt('跳转到页码（1-' + DECK.pages.length + '）', String(cur + 1));
  const n = parseInt(v, 10);
  if(!isNaN(n) && n >= 1 && n <= DECK.pages.length) goPage(n - 1);
}
function goPage(i){ cur=i; selIdx=-1; render(); syncThemeSel(); $('#panel').innerHTML='<div class="empty">点击元素编辑</div>'; animateIn(); }
function animateIn(){
  if(!window.gsap) return;
  const els = canvas.querySelectorAll('.el');
  if(!els.length) return;
  gsap.fromTo(els, {opacity:0, y:12}, {opacity:1, y:0, duration:0.35, stagger:0.03, ease:'power2.out'});
}

// ---------- 选中 + 拖拽 ----------
function select(i, e){
  e.stopPropagation();
  selIdx = i; render(); renderPanel();
  const el = DECK.pages[cur].elements[i];
  const elDiv = canvas.children[i];
  const startX = e.clientX, startY = e.clientY;
  const ox = el.x||0, oy = el.y||0;
  // 缩放手柄
  if(e.target.classList.contains('handle')){
    const sw = el.w||0, sh = el.h||0;
    const onMove = ev => { el.w = Math.max(20, sw + (ev.clientX-startX)); el.h = Math.max(16, sh + (ev.clientY-startY)); render(); };
    const onUp = ()=>{ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); };
    document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    return;
  }
  const onMove = ev => {
    el.x = Math.round(ox + (ev.clientX-startX));
    el.y = Math.round(oy + (ev.clientY-startY));
    render();
  };
  const onUp = ()=>{ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); renderPanel(); };
  document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
}

// ---------- 双击改文字 ----------
function editText(i, e){
  const el = DECK.pages[cur].elements[i];
  if(el.type !== 'text' && el.type !== 'table') return;
  e.stopPropagation();
  const div = canvas.children[i].firstChild;
  const old = el.text || '';
  div.setAttribute('contenteditable','true');
  div.focus();
  const save = ()=>{
    div.removeAttribute('contenteditable');
    if(el.type === 'text') el.text = div.textContent;
    else {
      // 表格: 简化为整表文本编辑（按行分割）
      el.text = div.textContent;
    }
    render(); renderPanel(); toast('文字已更新');
  };
  div.addEventListener('blur', save, {once:true});
  div.addEventListener('keydown', e2=>{ if(e2.key==='Enter') div.blur(); });
}

// ---------- 属性面板 ----------
function renderPanel(){
  const lpage = DECK.pages[cur];
  if(lpage && lpage.layout && lpage._layoutControls && lpage._layoutControls.length){
    renderLayoutPanel(lpage);
    return;
  }
  if(selIdx < 0){ panel.innerHTML = '<div class="empty">点击元素编辑</div>'; return; }
  const el = DECK.pages[cur].elements[selIdx];
  let h = '<h3>元素 #'+(selIdx+1)+' · '+el.type+'</h3>';
  h += '<div class="row2"><div class="field"><label>X</label><input type="number" value="'+(el.x||0)+'" onchange="setF('+selIdx+',\\'x\\',+this.value)"></div>';
  h += '<div class="field"><label>Y</label><input type="number" value="'+(el.y||0)+'" onchange="setF('+selIdx+',\\'y\\',+this.value)"></div></div>';
  h += '<div class="row2"><div class="field"><label>宽</label><input type="number" value="'+(el.w||0)+'" onchange="setF('+selIdx+',\\'w\\',+this.value)"></div>';
  h += '<div class="field"><label>高</label><input type="number" value="'+(el.h||0)+'" onchange="setF('+selIdx+',\\'h\\',+this.value)"></div></div>';
  if(el.type === 'text'){
    h += '<div class="field"><label>文字</label><textarea rows="3" style="width:100%;background:#0F172A;border:1px solid #334155;color:#E2E8F0;border-radius:5px;padding:6px" onchange="setT('+selIdx+',this.value)">'+esc(el.text||'')+'</textarea></div>';
    h += '<div class="row2"><div class="field"><label>字号</label><input type="number" value="'+(el.fontSize||18)+'" onchange="setF('+selIdx+',\\'fontSize\\',+this.value)"></div>';
    h += '<div class="field"><label>颜色</label><input type="color" value="'+(el.color||'#1A1A1A')+'" onchange="setF('+selIdx+',\\'color\\',this.value)"></div></div>';
    h += '<div class="row2"><div class="field"><label>加粗</label><select onchange="setF('+selIdx+',\\'bold\\',this.value===\\'true\\')"><option value="false"'+(el.bold?'':' selected')+'>否</option><option value="true"'+(el.bold?' selected':'')+'>是</option></select></div>';
    h += '<div class="field"><label>对齐</label><select onchange="setF('+selIdx+',\\'align\\',this.value)"><option'+(el.align==='left'?' selected':'')+'>left</option><option'+(el.align==='center'?' selected':'')+'>center</option><option'+(el.align==='right'?' selected':'')+'>right</option></select></div></div>';
    h += '<div class="field"><label>行距</label><input type="number" value="'+(el.lineSpacing||'')+'" placeholder="自动" onchange="setF('+selIdx+',\\'lineSpacing\\',+this.value||undefined)"></div>';
  }
  if(el.type === 'rect' || el.type === 'roundRect' || el.type === 'ellipse'){
    h += '<div class="row2"><div class="field"><label>填充</label><input type="color" value="'+(el.fill||'#3B82F6')+'" onchange="setF('+selIdx+',\\'fill\\',this.value)"></div>';
    h += '<div class="field"><label>圆角</label><input type="number" value="'+(el.radius||0)+'" onchange="setF('+selIdx+',\\'radius\\',+this.value)"></div></div>';
  }
  if(el.type === 'chart'){ h += chartPanel(el, selIdx); }
  if(el.type === 'image'){
    h += '<div class="field"><label>图片路径（绝对路径或相对项目目录）</label><input type="text" value="'+esc(el.path||'')+'" onchange="setImagePath('+selIdx+',this.value)"></div>';
    h += '<div class="row2"><div class="field"><label>填充</label><select onchange="setF('+selIdx+',\\'objectFit\\',this.value)"><option value="cover"'+(el.objectFit!=='contain'?' selected':'')+'>cover 裁剪</option><option value="contain"'+(el.objectFit==='contain'?' selected':'')+'>contain 完整</option></select></div>';
    h += '<div class="field"><label>圆角</label><input type="number" value="'+(el.radius||0)+'" onchange="setF('+selIdx+',\\'radius\\',+this.value)"></div></div>';
    h += '<div class="field"><label>占位说明（图缺失时显示）</label><input type="text" value="'+esc(el.caption||'')+'" onchange="setF('+selIdx+',\\'caption\\',this.value)"></div>';
  }
  if(el.type === 'table'){
    h += '<div class="field"><label>表格内容（每行一记录，用 | 分列）</label><textarea rows="6" style="width:100%;background:#0F172A;border:1px solid #334155;color:#E2E8F0;border-radius:5px;padding:6px" onchange="setTable('+selIdx+',this.value)">'+esc((el.rows||[]).map(r=>r.map(c=>typeof c==='string'?c:c.text).join('|')).join('\\n'))+'</textarea></div>';
  }
  // 增强元素编辑
  if(el.type === 'gradientBar'){
    h += '<div class="row2"><div class="field"><label>起始色</label><input type="color" value="'+(el.from||'#3B82F6')+'" onchange="setF('+selIdx+',\\'from\\',this.value)"></div>';
    h += '<div class="field"><label>结束色</label><input type="color" value="'+(el.to||'#0EA5E9')+'" onchange="setF('+selIdx+',\\'to\\',this.value)"></div></div>';
    h += '<div class="row2"><div class="field"><label>方向</label><select onchange="setF('+selIdx+',\\'dir\\',this.value)"><option'+(el.dir!=='vertical'?' selected':'')+'>horizontal</option><option'+(el.dir==='vertical'?' selected':'')+'>vertical</option></select></div>';
    h += '<div class="field"><label>圆角</label><input type="number" value="'+(el.radius||6)+'" onchange="setF('+selIdx+',\\'radius\\',+this.value)"></div></div>';
  }
  if(el.type === 'glowOrb'){
    h += '<div class="field"><label>颜色</label><input type="color" value="'+(el.color||'#3B82F6')+'" onchange="setF('+selIdx+',\\'color\\',this.value)"></div>';
    h += '<div class="row2"><div class="field"><label>直径</label><input type="number" value="'+(el.r||200)+'" onchange="setF('+selIdx+',\\'r\\',+this.value)"></div>';
    h += '<div class="field"><label>模糊</label><input type="number" value="'+(el.blur||40)+'" onchange="setF('+selIdx+',\\'blur\\',+this.value)"></div></div>';
  }
  if(el.type === 'decoBlock'){
    h += '<div class="field"><label>填充色</label><input type="color" value="'+(el.fill||'#3B82F6')+'" onchange="setF('+selIdx+',\\'fill\\',this.value)"></div>';
    h += '<div class="row2"><div class="field"><label>透明度</label><input type="number" min="0" max="1" step="0.05" value="'+(el.alpha===undefined?0.1:el.alpha)+'" onchange="setF('+selIdx+',\\'alpha\\',+this.value)"></div>';
    h += '<div class="field"><label>圆角</label><input type="number" value="'+(el.radius||8)+'" onchange="setF('+selIdx+',\\'radius\\',+this.value)"></div></div>';
  }
  if(el.type === 'kpiBlock'){
    h += '<div class="row2"><div class="field"><label>数值</label><input type="text" value="'+esc(el.value!==undefined?el.value:'')+'" onchange="setF('+selIdx+',\\'value\\',this.value)"></div>';
    h += '<div class="field"><label>标签</label><input type="text" value="'+esc(el.label||'')+'" onchange="setF('+selIdx+',\\'label\\',this.value)"></div></div>';
    h += '<div class="row2"><div class="field"><label>数字颜色</label><input type="color" value="'+(el.color||'#2FE07F')+'" onchange="setF('+selIdx+',\\'color\\',this.value)"></div>';
    h += '<div class="field"><label>数号大小</label><input type="number" value="'+(el.numSize||44)+'" onchange="setF('+selIdx+',\\'numSize\\',+this.value)"></div></div>';
  }
  panel.innerHTML = h;
}

function renderLayoutPanel(page){
  let h = '<h3>模板页字段 · ' + esc(page._layoutLabel || page.layout) + '</h3>';
  h += '<div style="color:#94A3B8;font-size:12px;margin-bottom:10px">修改后导出立即生效；重新生成 editor.html 可预览最新效果</div>';
  (page._layoutControls || []).forEach(c=>{
    const val = (page.data && page.data[c.key] !== undefined) ? page.data[c.key] : c.default;
    h += '<div class="field"><label>' + esc(c.label || c.key) + (c.unit ? '（' + esc(c.unit) + '）' : '') + '</label>';
    if(c.type === 'number'){
      h += '<input type="number" min="' + (c.min !== undefined ? c.min : '') + '" max="' + (c.max !== undefined ? c.max : '') + '" step="' + (c.step !== undefined ? c.step : 1) + '" value="' + (val !== undefined ? val : '') + '" onchange="setLayoutField(' + cur + ',\\'' + c.key + '\\',+this.value)">';
    } else if(c.type === 'boolean'){
      h += '<select onchange="setLayoutField(' + cur + ',\\'' + c.key + '\\',this.value===\\'true\\')"><option value="false"' + (val ? '' : ' selected') + '>否</option><option value="true"' + (val ? ' selected' : '') + '>是</option></select>';
    } else if(c.type === 'color'){
      const opts = (c.options && c.options.length) ? c.options.map(o=>'<option value="' + esc(o.value) + '"' + (String(val) === String(o.value) ? ' selected' : '') + '>' + esc(o.label || o.value) + '</option>').join('') : '';
      h += opts ? '<select onchange="setLayoutField(' + cur + ',\\'' + c.key + '\\',this.value)">' + opts + '</select>' : '<input type="color" value="' + (val || '#000000') + '" onchange="setLayoutField(' + cur + ',\\'' + c.key + '\\',this.value)">';
    } else if(c.type === 'select' && c.options && c.options.length){
      h += '<select onchange="setLayoutField(' + cur + ',\\'' + c.key + '\\',this.value)">' + c.options.map(o=>'<option value="' + esc(o.value) + '"' + (String(val) === String(o.value) ? ' selected' : '') + '>' + esc(o.label || o.value) + '</option>').join('') + '</select>';
    } else {
      h += '<input type="text" value="' + esc(val !== undefined ? val : '') + '" onchange="setLayoutField(' + cur + ',\\'' + c.key + '\\',this.value)">';
    }
    if(c.desc) h += '<div style="color:#64748B;font-size:11px;margin-top:3px">' + esc(c.desc) + '</div>';
    h += '</div>';
  });
  panel.innerHTML = h;
}
function setLayoutField(i, key, v){
  const page = DECK.pages[cur];
  if(!page.data) page.data = {};
  page.data[key] = v;
  toast('已更新：' + key + '（导出生效；重新生成 editor.html 预览）');
}
function chartPanel(el, idx){
  let h = '<div class="field"><label>图表类型</label><select onchange="setF('+idx+',\\'chartType\\',this.value)">';
  ['bar','line','pie','doughnut','area'].forEach(t=>{ h += '<option'+(el.chartType===t?' selected':'')+'>'+t+'</option>'; });
  h += '</select></div>';
  h += '<div class="field"><label>分类（逗号分隔）</label><input type="text" value="'+(el.labels||[]).join(',')+'" onchange="setLabels('+idx+',this.value)"></div>';
  h += '<div class="field"><label>系列（可增删/改色/强调）</label></div>';
  (el.series||[]).forEach((s,si)=>{
    h += '<div class="series-item"><input type="color" value="'+(s.color||'#3B82F6')+'" onchange="setSeriesColor('+idx+','+si+',this.value)">'
      + '<input type="text" value="'+esc(s.name||'')+'" onchange="setSeriesName('+idx+','+si+',this.value)">'
      + '<label><input type="checkbox"'+(s.emphasis?' checked':'')+' onchange="setSeriesEmphasis('+idx+','+si+',this.checked)">强调</label>'
      + '<button class="del" onclick="delSeries('+idx+','+si+')">×</button></div>';
  });
  h += '<button class="add" onclick="addSeries('+idx+')">+ 添加系列</button>';
  h += '<div class="field" style="margin-top:8px"><label>系列数据（每系列逗号分隔，与分类对应）</label>';
  (el.series||[]).forEach((s,si)=>{
    h += '<input type="text" value="'+(s.values||[]).join(',')+'" placeholder="系列 '+(si+1)+' 数据" style="width:100%;background:#0F172A;border:1px solid #334155;color:#E2E8F0;border-radius:4px;padding:4px 6px;margin-bottom:4px" onchange="setSeriesValues('+idx+','+si+',this.value)">';
  });
  h += '</div>';
  return h;
}

// ---------- 数据操作 ----------
function setF(i,k,v){
  const el = DECK.pages[cur].elements[i];
  el[k] = v; render(); renderPanel();
}
function setT(i,v){ DECK.pages[cur].elements[i].text = v; render(); }
function setLabels(i,v){ DECK.pages[cur].elements[i].labels = v.split(',').map(s=>s.trim()).filter(Boolean); render(); }
function setTable(i,v){
  const rows = v.split('\\n').filter(r=>r.trim()).map(r=>r.split('|').map(c=>c.trim()));
  DECK.pages[cur].elements[i].rows = rows; render();
}
function setSeriesColor(i,si,v){ DECK.pages[cur].elements[i].series[si].color = v; render(); }
function setSeriesName(i,si,v){ DECK.pages[cur].elements[i].series[si].name = v; render(); }
function setSeriesEmphasis(i,si,v){ DECK.pages[cur].elements[i].series[si].emphasis = v; render(); }
function setSeriesValues(i,si,v){ DECK.pages[cur].elements[i].series[si].values = v.split(',').map(s=>+s.trim()); render(); }
function addSeries(i){
  const el = DECK.pages[cur].elements[i];
  const labels = el.labels||[];
  el.series = el.series||[];
  el.series.push({ name:'系列'+(el.series.length+1), values: labels.map(()=>0), color:'#3B82F6' });
  render(); renderPanel();
}
function delSeries(i,si){ DECK.pages[cur].elements[i].series.splice(si,1); render(); renderPanel(); }

// ---------- 一键导出（本地导出服务） ----------
// 端口默认 47832，可用 URL 参数覆盖：editor.html?port=47833
const EXPORT_PORT = Number(new URLSearchParams(location.search).get('port')) || 47832;
const EXPORT_BASE = 'http://127.0.0.1:' + EXPORT_PORT;
// 导出服务健康检查：未启动时顶栏下显示红条提示
async function checkExportService(manual){
  const banner = document.getElementById('exportBanner');
  if(!banner) return false;
  try{
    const ctl = new AbortController();
    const timer = setTimeout(function(){ ctl.abort(); }, 2000);
    const resp = await fetch(EXPORT_BASE + '/api/health', { signal: ctl.signal });
    clearTimeout(timer);
    const data = resp.ok ? await resp.json() : null;
    const ok = !!(data && data.ok);
    banner.style.display = ok ? 'none' : 'flex';
    if(manual && !ok) toast('导出服务未就绪');
    return ok;
  }catch(e){
    banner.style.display = 'flex';
    if(manual) toast('导出服务未就绪');
    return false;
  }
}
function exportDir(){
  try{
    let p = decodeURIComponent(location.pathname || '');
    if(p.charAt(0) === '/') p = p.slice(1); // file:///D:/... → D:/...
    const idx = p.lastIndexOf('/');
    return idx > 0 ? p.slice(0, idx) : ''; // editor.html 所在目录（项目 output/）
  }catch{ return ''; }
}
async function exportToServer(format){
  const outDir = exportDir();
  if(!outDir){ toast('无法确定项目 output 目录'); return; }
  toast('正在导出 '+format.toUpperCase()+' …');
  try{
    const resp = await fetch(EXPORT_BASE+'/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck: DECK, format, outDir }),
    });
    const data = await resp.json();
    if(data && data.ok){ toast('✅ 已导出: ' + data.file); }
    else { toast('导出失败: ' + ((data&&data.error)||'未知错误')); console.error('[export]', data); }
  }catch(e){
    toast('服务端导出异常，改用浏览器端导出…');
    console.error('[export-server]', e);
  }
}
async function exportTo(format){
  const serverOk = await checkExportService(false);
  if(serverOk){ await exportToServer(format); return; }
  if(format === 'pptx'){ await exportPptxBrowser(); return; }
  if(format === 'pdf'){ await exportPdfBrowser(); return; }
  toast('不支持的格式: ' + format);
}
// ---------- 浏览器端导出（无需 serve-export 服务） ----------
function mirrorAllRender(){
  const deck = document.getElementById('deck');
  if(!deck) return;
  deck.innerHTML = '';
  DECK.pages.forEach((page, pi)=>{
    const slide = document.createElement('div');
    slide.className = 'slide' + (pi === 0 ? ' active' : '');
    slide.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px;overflow:hidden;background:' + (page.background || '#FFFFFF');
    const th = themeMap[page.theme||(DECK.design&&DECK.design.theme)||'generic']||themeMap.generic;
    if(page._layoutHtml){
      slide.innerHTML = '<div style="position:absolute;inset:0">' + page._layoutHtml + '</div>';
    } else {
      (page.elements||[]).forEach(el=>{
        const node = document.createElement('div');
        if(el.type === 'text') node.setAttribute('data-editable-pptx-required-text','');
        node.innerHTML = elHtml(el, page, th);
        slide.appendChild(node);
      });
    }
    deck.appendChild(slide);
  });
}
window.go = function(i){
  const slides = document.querySelectorAll('#deck > .slide');
  slides.forEach((s, idx)=>{ s.classList.toggle('active', idx === i); });
};
window.__getVisibleSlides = function(){
  return [...document.querySelectorAll('#deck > .slide:not([hidden])')];
};
async function exportPptxBrowser(){
  if(!window.__editablePptxBrowser){ toast('导出引擎未加载（请刷新页面重试）'); return; }
  if(!window.PptxGenJS || !window.htmlToImage){ toast('导出组件未加载'); return; }
  mirrorAllRender();
  toast('正在导出 PPTX…');
  try{
    const { blob, report } = await window.__editablePptxBrowser.exportEditablePptxInBrowser({
      title: (DECK.design && DECK.design.title) || 'Presentation',
      onProgress: function(up){ if(up && up.detail) toast('导出中 · ' + up.detail); },
    });
    download(blob, 'deck.pptx');
    toast('✅ PPTX 已导出（' + ((report && report.slideCount) || DECK.pages.length) + ' 页）');
  }catch(e){
    console.error('[export-pptx-browser]', e);
    toast('浏览器端导出失败：' + (e && e.message || e));
  }
}
async function exportPdfBrowser(){
  if(!window.htmlToImage || !window.PDFLib){ toast('PDF 组件未加载'); return; }
  const saved = cur;
  toast('正在导出 PDF…');
  const pages = [];
  try{
    for(let i=0;i<DECK.pages.length;i++){
      cur = i; render();
      await new Promise(r=>setTimeout(r,60));
      const dataUrl = await htmlToImage.toPng(document.getElementById('canvas'), { width:1280, height:720, pixelRatio:2, cacheBust:true });
      pages.push(dataUrl);
      if(i % 5 === 4) toast('截图 ' + (i+1) + '/' + DECK.pages.length);
    }
    const pdf = await window.PDFLib.PDFDocument.create();
    for(const du of pages){
      const img = await pdf.embedPng(du);
      const page = pdf.addPage([960, 540]);
      page.drawImage(img, { x:0, y:0, width:960, height:540 });
    }
    const bytes = await pdf.save();
    download(new Blob([bytes], {type:'application/pdf'}), 'deck.pdf');
    toast('✅ PDF 已导出（' + pages.length + ' 页）');
  }catch(e){
    console.error('[export-pdf-browser]', e);
    toast('PDF 导出失败：' + (e && e.message || e));
  }finally{
    cur = saved; render();
  }
}
function setImagePath(i,v){
  const el = DECK.pages[cur].elements[i];
  el.path = v;
  if(v){ el._src = 'file:///' + String(v).replace(/\\\\/g,'/'); } else { delete el._src; }
  render(); renderPanel();
}
function imgFail(ev){
  const el = ev && ev.currentTarget;
  if(!el) return;
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;left:'+(el.dataset.x||0)+'px;top:'+(el.dataset.y||0)+'px;width:'+(el.dataset.w||0)+'px;height:'+(el.dataset.h||0)+'px;background:#E2E8F0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:14px';
  d.textContent = '图片加载失败';
  el.replaceWith(d);
}

// ---------- 导出 ----------
function exportDeck(){
  const blob = new Blob([JSON.stringify(DECK,null,2)], {type:'application/json'});
  download(blob, 'deck.json');
  toast('deck.json 已导出');
}
function exportPages(){
  // 导出每个页面为 module.exports 格式 + design.json
  const files = {};
  DECK.pages.forEach((p,i)=>{
    const idx = String(i+1).padStart(2,'0');
    files['slide_'+idx+'_'+slug(p.id)+'.js'] = '// 页 '+(i+1)+' · '+p.type+' · '+p.role+'\\\nmodule.exports = '+JSON.stringify(p,null,2)+';\\n';
  });
  files['design.json'] = JSON.stringify(DECK.design,null,2);
  // 打包下载（逐个下载）
  const names = Object.keys(files);
  if(names.length > 6){
    // 多文件: 导出单个 JSON 包
    const blob = new Blob([JSON.stringify(files,null,2)], {type:'application/json'});
    download(blob, 'deck_pages.json'); toast('已导出 deck_pages.json（含全部页面定义）');
  } else {
    names.forEach(n=>download(new Blob([files[n]],{type:'application/javascript'}), n));
    toast('已导出 '+names.length+' 个文件');
  }
}
function slug(s){ return String(s).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,30); }
function download(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}

// ---------- 画布缩放适配 ----------
function fitCanvas(){
  const wrap = $('#canvasWrap');
  const s = Math.min(wrap.clientWidth/1280, wrap.clientHeight/720);
  canvas.style.transform = 'scale('+s+')';
}
window.addEventListener('resize', fitCanvas);
document.addEventListener('click', e=>{ if(e.target === canvas || e.target.id === 'canvasWrap'){ selIdx=-1; render(); renderPanel(); } });

// ---------- 启动 ----------
// 供编辑器用的紧凑主题名表（浏览器端，需在 syncThemeSel 前定义）
const THEMES_MAP = ${JSON.stringify(Object.fromEntries(Object.entries(THEMES).map(([k,t])=>[k,t.name])))};
// 主题切换：改当前页 theme 字段并重渲染
const themeSel = document.getElementById('themeSel');
function syncThemeSel(){
  const page = DECK.pages[cur];
  const tid = page.theme || (DECK.design&&DECK.design.theme) || 'generic';
  themeSel.value = THEMES_MAP[tid] ? tid : 'generic';
}
function applyThemeToPage(tid){
  const page = DECK.pages[cur];
  page.theme = tid;
  render();
  renderTabs();
  toast('主题已切换：' + (THEMES_MAP[tid] || tid));
}
themeSel.addEventListener('change', e => applyThemeToPage(e.target.value));
// 导出下拉菜单：切换显示 + 点击外部关闭（菜单项 onclick 已带 toggle 自关）
function toggleExportMenu(e){
  if(e) e.stopPropagation();
  const m = document.getElementById('exportMenu');
  if(m) m.classList.toggle('open');
}
document.addEventListener('click', e=>{
  const m = document.getElementById('exportMenu');
  if(m && m.classList.contains('open') && !m.contains(e.target) && e.target.id !== 'exportBtn') m.classList.remove('open');
});
render(); syncThemeSel(); fitCanvas();
checkExportService(false);
</script>
</body>
</html>`;

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outFile), html);
  console.log(`✅ 编辑器已生成: ${path.resolve(outFile)}`);
}

main().catch(e => { console.error('❌ 编辑器生成失败:', e); process.exit(1); });
