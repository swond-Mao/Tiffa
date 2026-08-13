#!/usr/bin/env node
/**
 * pptx-designer profile_template.js
 * 分析上传的 PPTX 模板 → 提取风格参数 → 生成 design.json 风格配置
 *
 * 用法:
 *   node scripts/profile_template.js <模板.pptx> [-o 输出design.json]
 *
 * 原理：直接解包 PPTX（zip），解析 theme1.xml 的配色/字体方案 + 各 slide
 * 的实际用色/字号/版式特征，输出结构化风格摘要。比截图+视觉分析更精确。
 */
const path = require('path');
const fs = require('fs');
const JSZip = require(path.join(__dirname, '..', 'node_modules', 'jszip'));

const VALID_TYPES = new Set(['rect', 'ellipse', 'roundRect', 'line', 'freeformShape', 'textBox', 'pic', 'graphicFrame', 'table', 'chart', 'group', 'cxnSp']);

function readXml(zip, name) {
  const f = zip.file(name);
  return f ? f.async('string') : Promise.resolve(null);
}

// 从 theme1.xml 提取 clrScheme 和 fontScheme
async function extractTheme(zip) {
  const theme = await readXml(zip, 'ppt/theme/theme1.xml');
  if (!theme) return null;
  const clr = {};
  const hexOf = (tag) => {
    const m = theme.match(new RegExp(`<a:${tag}>\\s*<a:srgbClr val="([0-9A-Fa-f]{6})"`));
    return m ? '#' + m[1].toUpperCase() : null;
  };
  ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].forEach(t => {
    const v = hexOf(t);
    if (v) clr[t] = v;
  });
  const fonts = {};
  const major = theme.match(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/);
  const minor = theme.match(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/);
  if (major) fonts.major = major[1];
  if (minor) fonts.minor = minor[1];
  return { clr, fonts };
}

// 统计所有 slide 的实际用色、字号、元素类型
async function scanSlides(zip) {
  const files = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const stats = { colors: {}, fonts: {}, sizes: {}, elements: {}, slides: files.length, pics: 0 };
  const sampleTexts = [];
  for (const f of files.slice(0, 8)) { // 最多扫前 8 页
    const xml = await readXml(zip, f);
    if (!xml) continue;
    // 颜色
    for (const m of xml.matchAll(/srgbClr val="([0-9A-Fa-f]{6})"/g)) {
      const c = '#' + m[1].toUpperCase();
      stats.colors[c] = (stats.colors[c] || 0) + 1;
    }
    // 字号
    for (const m of xml.matchAll(/sz="(\d+)"/g)) {
      const pt = parseInt(m[1]) / 100;
      stats.sizes[pt] = (stats.sizes[pt] || 0) + 1;
    }
    // 字体
    for (const m of xml.matchAll(/typeface="([^"]+)"/g)) {
      stats.fonts[m[1]] = (stats.fonts[m[1]] || 0) + 1;
    }
    // 元素类型
    for (const m of xml.matchAll(/<p:sp>[\s\S]*?<a:prstGeom prst="([^"]+)"/g)) {
      stats.elements[m[1]] = (stats.elements[m[1]] || 0) + 1;
    }
    stats.pics += (xml.match(/<p:pic>/g) || []).length;
    // 抽样文本
    const texts = [...xml.matchAll(/<a:t>([^<]{4,30})<\/a:t>/g)].map(m => m[1]).slice(0, 3);
    if (texts.length) sampleTexts.push({ slide: path.basename(f), texts });
  }
  return { stats, sampleTexts };
}

// 生成建议的 design.json
function buildDesign(theme, stats, templateName) {
  const palette = [];
  const add = (c) => { if (c && !palette.includes(c)) palette.push(c); };
  if (theme) {
    add(theme.clr.dk1); add(theme.clr.lt1);
    add(theme.clr.accent1); add(theme.clr.accent2);
    // 补充实际高频使用色（可能是品牌色）
    const topColors = Object.entries(stats.stats.colors).sort((a, b) => b[1] - a[1]).slice(0, 6);
    topColors.forEach(([c]) => add(c));
  } else {
    Object.entries(stats.stats.colors).sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([c]) => add(c));
  }
  // 字体
  const fontRank = Object.entries(stats.stats.fonts).sort((a, b) => b[1] - a[1]);
  const fontFamily = fontRank.length ? fontRank[0][0] : '微软雅黑';
  // 字号范围
  const sizes = Object.keys(stats.stats.sizes).map(Number).sort((a, b) => a - b);
  const sizeRange = sizes.length ? { min: Math.min(...sizes), max: Math.max(...sizes) } : null;

  return {
    title: path.basename(templateName, path.extname(templateName)),
    sourceTemplate: templateName,
    palette: palette.slice(0, 6),
    fontFamily,
    sizeRange,
    slideCount: stats.stats.slides,
    picCount: stats.stats.pics,
    notes: '由模板自动分析生成，可在生成 PPT 时作为风格基线',
  };
}

function formatSummary(profile) {
  const s = profile.stats;
  const topColors = Object.entries(s.colors).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([c, n]) => `${c}(${n})`).join(' ');
  const topFonts = Object.entries(s.fonts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([f, n]) => `${f}(${n})`).join(' ');
  const sizes = Object.keys(s.sizes).map(Number).sort((a, b) => a - b);
  const elems = Object.entries(s.elements).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([e, n]) => `${e}(${n})`).join(' ');
  return `模板风格分析:
  页数: ${s.slides}  图片: ${s.pics} 张
  高频颜色: ${topColors || '无'}
  字体: ${topFonts || '未检测到显式字体'}
  字号范围(pt): ${sizes.length ? Math.min(...sizes) + ' ~ ' + Math.max(...sizes) : '未知'}
  主要元素: ${elems || '未知'}
  ${profile.sampleTexts.length ? '抽样文本: ' + JSON.stringify(profile.sampleTexts[0]) : ''}`;
}

async function main() {
  const args = process.argv.slice(2);
  const template = args[0];
  const outFile = args.indexOf('-o') >= 0 ? args[args.indexOf('-o') + 1] : null;
  if (!template || !fs.existsSync(template)) {
    console.error('用法: node scripts/profile_template.js <模板.pptx> [-o design.json]');
    process.exit(1);
  }
  const buf = fs.readFileSync(template);
  const zip = await JSZip.loadAsync(buf);
  const theme = await extractTheme(zip);
  const { stats, sampleTexts } = await scanSlides(zip);
  const profile = { theme, stats, sampleTexts };
  const design = buildDesign(theme, profile, template);
  console.log(formatSummary(profile));
  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(path.resolve(outFile), JSON.stringify(design, null, 2));
    console.log(`✅ 风格配置已写入: ${path.resolve(outFile)}`);
  } else {
    console.log('\n建议 design.json:\n' + JSON.stringify(design, null, 2));
  }
}

main().catch(e => { console.error('❌ 分析失败:', e.message); process.exit(1); });
