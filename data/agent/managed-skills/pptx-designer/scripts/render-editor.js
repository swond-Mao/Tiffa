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

const { THEMES, CANVAS_W, CANVAS_H, themeCSS, themeVars } = require(path.join(__dirname, 'visual', 'themes.js'));
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
function elHtml(el, page) {
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
      const labels = el.labels || [];
      const series = el.series || [];
      const rows = labels.map((lb, i) =>
        `<tr><td>${esc(lb)}</td>${series.map(s => `<td>${esc(s.values[i])}</td>`).join('')}</tr>`).join('');
      const head = `<tr><th></th>${series.map(s => `<th>${esc(s.name || '')}</th>`).join('')}</tr>`;
      return `<div style="position:absolute;${style};border:1px dashed #94A3B8;border-radius:8px;padding:12px;box-sizing:border-box;overflow:auto;background:rgba(255,255,255,0.6)"><div style="font-size:12px;color:#64748B;margin-bottom:6px">[${el.chartType} 图表占位 · 编辑器可改系列]</div><table style="border-collapse:collapse;font-size:12px">${head}${rows}</table></div>`;
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

function main() {
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

  // 注入页面数据（编辑器 JS 使用）
  const deckData = JSON.stringify({ design, pages }).replace(/</g, '\\u003c');

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
</style>
</head>
<body>
  <div id="topbar">
    <span class="title">${esc(design.title || 'PPT 编辑器')}</span>
    <span id="tabs"></span>
    <div class="spacer"></div>
    <label class="theme-label" style="color:#94A3B8;font-size:12px;margin-right:4px">主题</label>
    <select id="themeSel" style="background:#0F172A;border:1px solid #334155;color:#CBD5E1;border-radius:6px;padding:4px 8px;font-size:13px;cursor:pointer">
      ${Object.entries(THEMES).map(([id,t])=>`<option value="${id}">${t.name}</option>`).join('')}
    </select>
    <button class="btn btn-ghost" onclick="exportDeck()">导出 deck.json</button>
    <button class="btn btn-ghost" onclick="exportPages()">导出 pages/*.js</button>
    <button class="btn btn-primary" style="background:#7C3AED" onclick="exportTo('pptx')">导出 PPTX</button>
    <button class="btn btn-primary" style="background:#059669" onclick="exportTo('pdf')">导出 PDF</button>
  </div>
  <div id="exportBanner">
    <span>导出服务未启动，无法一键导出 PPTX/PDF。请先运行 <code>node scripts/serve-export.cjs</code></span>
    <button class="btn" onclick="checkExportService(true)">重试</button>
  </div>
  <div id="stage">
    <div id="canvasWrap"><div id="canvas"></div></div>
    <div id="panel"><div class="empty">点击画布中的元素进行编辑<br/><br/>拖动移动 · 右下角手柄缩放 · 双击改文字<br/>图表可在右侧增删系列 / 设置强调</div></div>
  </div>
  <div id="toast"></div>
<script>
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
  // 主题背景（含径向光效纹理）
  let bg = page.background || th.bg;
  if(th.texture==='radial') bg += '; background-image: radial-gradient(ellipse 60% 45% at 82% 12%, '+rgbaOf(th.palette.primary,0.2)+' 0%, transparent 55%), radial-gradient(ellipse 50% 50% at 8% 88%, '+rgbaOf(th.palette.accent,0.18)+' 0%, transparent 50%)';
  canvas.style.background = bg;
  // 装饰层（角落强调条 / 页脚条）
  canvas.insertAdjacentHTML('beforeend', decoHtml(page, th));
  page.elements.forEach((el,i)=>{
    const div = document.createElement('div');
    div.className = 'el' + (i===selIdx ? ' selected' : '');
    div.innerHTML = elHtml(el, page) + '<div class="handle"></div>';
    // 交互绑定
    div.addEventListener('mousedown', e => select(i, e));
    div.addEventListener('dblclick', e => editText(i, e));
    canvas.appendChild(div);
  });
  renderTabs();
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

function elHtml(el, page){
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
      const labels = el.labels||[]; const series = el.series||[];
      const rows = labels.map((lb,i)=>'<tr><td>'+esc(lb)+'</td>'+series.map(s=>'<td>'+(s.emphasis?'<b style="color:#E11D48">':'')+esc(s.values[i])+(s.emphasis?'</b>':'')+'</td>').join('')+'</tr>').join('');
      const head = '<tr><th></th>'+series.map(s=>'<th style="color:'+(s.emphasis?'#E11D48':s.color||'#333')+'">'+esc(s.name||'')+'</th>').join('')+'</tr>';
      return '<div style="position:absolute;'+style+';border:1px dashed #94A3B8;border-radius:8px;padding:10px;overflow:auto;background:rgba(255,255,255,0.6)"><table style="border-collapse:collapse;font-size:12px">'+head+rows+'</table></div>';
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

// ---------- 页面 tabs ----------
function renderTabs(){
  $('#tabs').innerHTML = DECK.pages.map((p,i)=>
    '<button class="tab'+(i===cur?' active':'')+'" onclick="goPage('+i+')">'+(i+1)+' '+(p.type||'')+'</button>').join('');
}
function goPage(i){ cur=i; selIdx=-1; render(); syncThemeSel(); $('#panel').innerHTML='<div class="empty">点击元素编辑</div>'; }

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
async function exportTo(format){
  const outDir = exportDir();
  if(!outDir){ toast('无法确定项目 output 目录'); return; }
  if(!(await checkExportService())){ toast('导出服务未启动，请先运行 node scripts/serve-export.cjs'); return; }
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
    toast('导出服务未启动：请先运行 node scripts/serve-export.cjs');
    console.error('[export]', e);
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
render(); syncThemeSel(); fitCanvas();
checkExportService(false);
</script>
</body>
</html>`;

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outFile), html);
  console.log(`✅ 编辑器已生成: ${path.resolve(outFile)}`);
}

main();
