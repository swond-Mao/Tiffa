#!/usr/bin/env node
/**
 * pptx-designer preview.js
 * 页面定义(pages/*.js) → 翻页式 HTML 预览（全屏 16:9，键盘/滚轮/圆点翻页）
 *
 * 用法:
 *   node scripts/preview.js --project <项目目录> [-o preview.html]
 *
 * 说明: 预览定位为"版式快照"，字体/图表等以近似样式呈现，最终以 .pptx 为准。
 */
const path = require('path');
const fs = require('fs');

const CANVAS_W = 1280;
const CANVAS_H = 720;
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

// 估算文本需要的字号缩放系数（超出框宽/高时缩小），保证预览不溢出
// 与 build.js 共享 scripts/shrink.js 同一算法
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
      return `<div style="position:absolute;${style};border:1px dashed #94A3B8;border-radius:8px;padding:12px;box-sizing:border-box;overflow:auto;background:rgba(255,255,255,0.6)"><div style="font-size:12px;color:#64748B;margin-bottom:6px">[${el.chartType} 图表占位 · 以 .pptx 为准]</div><table style="border-collapse:collapse;font-size:12px">${head}${rows}</table></div>`;
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

function pageHtml(page, idx, total, design) {
  const bg = page.background || '#FFFFFF';
  const body = page.elements.map(el => elHtml(el, page)).join('\n');
  const tag = `<span class="tag">${page.type} · ${page.role}</span>`;
  return `<section class="slide" style="background:${bg}" data-id="${esc(page.id)}">
    <div class="slide-inner">${body}</div>
    <div class="meta">${idx + 1} / ${total} ${tag}</div>
  </section>`;
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const projectDir = get('--project') || process.cwd();
  const outFile = get('-o') || path.join(projectDir, 'output', 'preview.html');
  const { design, pages } = loadProject(projectDir);
  const slides = pages.map((p, i) => pageHtml(p, i, pages.length, design)).join('\n');
  const dots = pages.map((p, i) => `<button class="dot" data-i="${i}"></button>`).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${esc(design.title || 'PPT 预览')}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  html, body { height:100%; overflow:hidden; background:#0F172A; font-family:"微软雅黑",sans-serif; }
  .deck { height:100%; display:flex; align-items:center; justify-content:center; position:relative; }
  .viewport { width:1280px; height:720px; position:relative; transform-origin:center center; }
  .track { position:absolute; inset:0; display:flex; transition:transform .45s cubic-bezier(.4,0,.2,1); }
  .slide { flex:0 0 1280px; width:1280px; height:720px; position:relative; overflow:hidden;
           box-shadow:0 10px 60px rgba(0,0,0,.5); }
  .slide-inner { position:absolute; inset:0; }
  .slide-inner * { box-sizing:border-box; }
  .meta { position:absolute; right:10px; top:6px; font-size:11px; color:rgba(255,255,255,.55);
          background:rgba(0,0,0,.35); padding:2px 8px; border-radius:10px; z-index:9; }
  .nav { position:fixed; bottom:18px; left:50%; transform:translateX(-50%); display:flex; gap:10px; align-items:center; z-index:50; }
  .nav button { background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.25); color:#E2E8F0;
                width:44px; height:44px; border-radius:22px; font-size:18px; cursor:pointer; transition:.2s; }
  .nav button:hover { background:rgba(255,255,255,.25); }
  .counter { color:#94A3B8; font-size:14px; min-width:70px; text-align:center; }
  .dots { position:fixed; top:18px; left:50%; transform:translateX(-50%); display:flex; gap:8px; z-index:50; }
  .dot { width:10px; height:10px; border-radius:5px; border:1px solid rgba(255,255,255,.4);
         background:transparent; cursor:pointer; transition:.2s; padding:0; }
  .dot.active { background:#3B82F6; border-color:#3B82F6; transform:scale(1.3); }
  .hint { position:fixed; top:18px; right:18px; color:rgba(255,255,255,.4); font-size:12px; z-index:50; }
  .fullbtn { position:fixed; bottom:18px; right:18px; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.25);
             color:#E2E8F0; width:44px; height:44px; border-radius:22px; font-size:16px; cursor:pointer; z-index:50; }
</style>
</head>
<body>
  <div class="deck">
    <div class="viewport">
      <div class="track">${slides}</div>
    </div>
  </div>
  <div class="dots">${dots}</div>
  <div class="nav">
    <button id="prev">‹</button>
    <span class="counter"><span id="cur">1</span> / ${pages.length}</span>
    <button id="next">›</button>
  </div>
  <button class="fullbtn" id="full">⛶</button>
  <div class="hint">← → 翻页 · 空格全屏 · 滚轮切页</div>
<script>
(function(){
  var slides = document.querySelectorAll('.slide');
  var dots = document.querySelectorAll('.dot');
  var track = document.querySelector('.track');
  var cur = 0, total = slides.length, scTimer = null;
  function go(i){
    if(i < 0) i = 0; if(i >= total) i = total - 1;
    cur = i;
    track.style.transform = 'translateX(' + (-cur * 1280) + 'px)';
    document.getElementById('cur').textContent = cur + 1;
    dots.forEach(function(d, k){ d.classList.toggle('active', k === cur); });
  }
  function scale(){
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / 1280, vh / 720);
    var vp = document.querySelector('.viewport');
    vp.style.transform = 'scale(' + s + ')';
  }
  document.getElementById('prev').onclick = function(){ go(cur - 1); };
  document.getElementById('next').onclick = function(){ go(cur + 1); };
  document.getElementById('full').onclick = function(){ document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); };
  dots.forEach(function(d){ d.onclick = function(){ go(+d.dataset.i); }; });
  window.addEventListener('keydown', function(e){
    if(e.key === 'ArrowRight' || e.key === ' ') go(cur + 1);
    else if(e.key === 'ArrowLeft') go(cur - 1);
    else if(e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  });
  window.addEventListener('wheel', function(e){
    clearTimeout(scTimer);
    scTimer = setTimeout(function(){ go(e.deltaY > 0 ? cur + 1 : cur - 1); }, 120);
  });
  window.addEventListener('resize', scale);
  scale(); go(0);
})();
</script>
</body>
</html>`;

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outFile), html);
  console.log(`✅ 翻页式预览已生成: ${path.resolve(outFile)}`);
}

main();
