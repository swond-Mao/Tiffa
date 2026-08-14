#!/usr/bin/env node
/**
 * pptx-designer preview.js — 翻页式 HTML 预览（双引擎视觉）
 *
 * 页面定义(pages/*.js + design.theme) → HTML 版式 + 主题装饰层
 * 顶部有主题下拉，可实时切换 16 套主题看视觉差异。
 *
 * 用法:
 *   node scripts/preview.js --project <项目目录> [-o preview.html]
 *
 * 预览定位为"版式快照"，最终以 .pptx 为准（见 build.js）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { elHtml, decorationHtml, esc } = require(path.join(__dirname, 'visual', 'elHtml.js'));
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

function pageHtml(page, idx, total, design) {
  const themeId = page.theme || design.theme || 'generic';
  const theme = THEMES[themeId] || THEMES.generic;
  const body = page.elements.map(el => elHtml(el, page, theme)).join('\n');
  const deco = decorationHtml(page, theme);
  const tag = `<span class="tag">${page.type} · ${page.role}</span>`;
  const bgStyle = page.background ? page.background : themeCSS(themeId);
  return `<section class="slide" data-theme="${themeId}" ${page.background?'data-custombg="1"':''} data-id="${esc(page.id)}" style="background:${bgStyle};color:${theme.palette.text}">
    <div class="slide-inner">${deco}${body}</div>
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

  // 主题下拉选项
  const themeOptions = Object.entries(THEMES)
    .map(([id, t]) => `<option value="${id}">${esc(t.name)}</option>`).join('');

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
  .hint { position:fixed; top:18px; right:90px; color:rgba(255,255,255,.4); font-size:12px; z-index:50; }
  .fullbtn { position:fixed; bottom:18px; right:18px; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.25);
             color:#E2E8F0; width:44px; height:44px; border-radius:22px; font-size:16px; cursor:pointer; z-index:50; }
  /* 主题切换工具条 */
  .theme-toolbar { position:fixed; top:18px; right:18px; z-index:60; display:flex; align-items:center; gap:8px;
                   background:rgba(30,41,59,.9); padding:6px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.15); }
  .theme-toolbar label { color:#94A3B8; font-size:12px; }
  .theme-toolbar select { background:#1E293B; color:#E2E8F0; border:1px solid #334155; border-radius:6px;
                          padding:4px 8px; font-size:13px; cursor:pointer; }
  .theme-toolbar .tag-flash { font-size:11px; color:#4ADE80; opacity:0; transition:.3s; }
  .theme-toolbar .tag-flash.show { opacity:1; }
</style>
</head>
<body>
  <div class="deck">
    <div class="viewport">
      <div class="track">${slides}</div>
    </div>
  </div>
  <div class="dots">${dots}</div>
  <div class="theme-toolbar">
    <label>主题</label>
    <select id="themeSel">${themeOptions}</select>
    <span class="tag-flash" id="flash">✓ 已切换</span>
  </div>
  <div class="nav">
    <button id="prev">‹</button>
    <span class="counter"><span id="cur">1</span> / ${pages.length}</span>
    <button id="next">›</button>
  </div>
  <button class="fullbtn" id="full">⛶</button>
  <div class="hint">← → 翻页 · 空格全屏 · 滚轮切页 · 右上切换主题</div>
<script>
(function(){
  var slides = document.querySelectorAll('.slide');
  var dots = document.querySelectorAll('.dot');
  var track = document.querySelector('.track');
  var cur = 0, total = slides.length, scTimer = null;
  var themes = ${JSON.stringify(Object.fromEntries(Object.entries(THEMES).map(([k,t])=>[k,{bg:t.bg,palette:t.palette,texture:t.texture}])))};
  function go(i){
    if(i < 0) i = 0; if(i >= total) i = total - 1;
    cur = i;
    track.style.transform = 'translateX(' + (-cur * 1280) + 'px)';
    document.getElementById('cur').textContent = cur + 1;
    dots.forEach(function(d, k){ d.classList.toggle('active', k === cur); });
  }
  function themeBg(th){
    var bg = th.bg, tex = th.texture, p = th.palette, img = '';
    if(tex === 'radial') img = '; background-image: radial-gradient(ellipse 60% 45% at 82% 12%, ' + p.primary + '33 0%, transparent 55%), radial-gradient(ellipse 50% 50% at 8% 88%, ' + p.accent + '2e 0%, transparent 50%)';
    else if(tex === 'dot') img = '; background-image: radial-gradient(circle, ' + p.line + ' 1px, transparent 1px); background-size: 24px 24px';
    else if(tex === 'grid') img = '; background-image: linear-gradient(' + p.line + ' 1px, transparent 1px), linear-gradient(90deg, ' + p.line + ' 1px, transparent 1px); background-size: 40px 40px';
    return bg + img;
  }
  // 切换全局主题（预览只改视觉层：背景/文字色/装饰色变量；版式坐标不变）
  var curTheme = document.querySelector('#themeSel').value;
  function applyTheme(thId){
    var th = themes[thId]; if(!th) return;
    curTheme = thId;
    document.querySelectorAll('.slide').forEach(function(s){
      // 页面显式设了背景（如深色封面）不随主题切换覆盖，避免字色重叠
      if(s.getAttribute('data-custombg') !== '1'){
        s.style.background = themeBg(th);
        s.style.color = th.palette.text;
      }
    });
    // 装饰层用 CSS 变量重绘（渐变条/强调色依赖主题 palette）
    document.documentElement.style.setProperty('--tp-primary', th.palette.primary);
    document.documentElement.style.setProperty('--tp-accent', th.palette.accent);
    document.documentElement.style.setProperty('--tp-line', th.palette.line);
    document.documentElement.style.setProperty('--tp-sub', th.palette.sub);
    document.documentElement.style.setProperty('--tp-text', th.palette.text);
    var flash = document.getElementById('flash');
    flash.classList.add('show');
    setTimeout(function(){ flash.classList.remove('show'); }, 800);
  }
  document.getElementById('themeSel').addEventListener('change', function(e){ applyTheme(e.target.value); });
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
  document.documentElement.style.setProperty('--tp-primary', themes[curTheme].palette.primary);
  document.documentElement.style.setProperty('--tp-accent', themes[curTheme].palette.accent);
  document.documentElement.style.setProperty('--tp-line', themes[curTheme].palette.line);
  document.documentElement.style.setProperty('--tp-sub', themes[curTheme].palette.sub);
  document.documentElement.style.setProperty('--tp-text', themes[curTheme].palette.text);
  scale(); go(0);
})();
</script>
</body>
</html>`;

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outFile), html);
  console.log(`✅ 翻页式预览已生成（${pages.length} 页，${Object.keys(THEMES).length} 套主题可切换）: ${path.resolve(outFile)}`);
}

main();
