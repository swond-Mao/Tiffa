#!/usr/bin/env node
/**
 * pptx-designer build-layout-catalog.cjs — 从 dashiai layout-manifest.json 生成页级模板目录
 *
 * 输出 references/layout-catalog.md：按语义类别分组的布局清单，
 * AI 在设计阶段按「内容类型 → 布局需求」查目录选页级模板。
 *
 * 用法:
 *   node scripts/build-layout-catalog.cjs [manifest路径] [-o 输出.md]
 * 默认:
 *   manifest = ../dashiai-ppt/project/layout-manifest.json（相对本脚本的技能根）
 *   输出     = references/layout-catalog.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SKILL_ROOT = path.resolve(HERE, '..');
const DEFAULT_MANIFEST = path.resolve(SKILL_ROOT, '..', 'dashiai-ppt', 'project', 'layout-manifest.json');
const DEFAULT_OUT = path.join(SKILL_ROOT, 'references', 'layout-catalog.md');

const args = process.argv.slice(2);
const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const manifestPath = get('-i') || args[0] || DEFAULT_MANIFEST;
const outPath = get('-o') || DEFAULT_OUT;

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const layouts = manifest.layouts;
const keys = Object.keys(layouts).sort();

/* ── 语义归类：slot 字符串 → 类别 ─────────────────────── */
const RULES = [
  { cat: '封面', re: /^cover/i },
  { cat: '目录/议程', re: /^(contents|agenda)/i },
  { cat: '章节过渡', re: /^(chapter|section|interlude|divider)/i },
  { cat: '大数字/KPI', re: /^(bignum|bignumber|statgrid|stat3|scorecard|kpi|metric|evil|bento|stat|cards|ticket)/i },
  { cat: '图表·趋势', re: /^(trend|line|area|stream-area|sparkline|slope|stream|vertical|annotated|peak|peaktrough|horizon|curve|growth|cumulative|delta)/i },
  { cat: '图表·构成占比', re: /^(donut|pie|waterfall|stacked|stackbars|mekko|waffle|mosaic|marimekko|sunburst|stack|rose|polar-rose)/i },
  { cat: '图表·分布比较', re: /^(bar|column|grouped|diverging|bullet|lollipop|dumbbell|bubble|scatter|dotplot|box|histogram|tornado|pareto|ladder|spread)/i },
  { cat: '图表·多维', re: /^(radar|heatmap|treemap|funnel|sankey|pyramid|tier|quadrant|matrix|gauge|gauges|meter|venn|spectrum|layers|arc|orbit|bump)/i },
  { cat: '图表·时间/排期', re: /^(gantt|timeline|zigzag|milestone|monthly|calendar|era|journey)/i },
  { cat: '排行/表格', re: /^(ranking|rank|top10|table|bump|leaderboard|investors|ledger|scoreboard|register|logowall)/i },
  { cat: '对比/对决', re: /^(versus|duel|compare|split|diptych|beforeafter|triptych|triad|pair)/i },
  { cat: '流程/路线/链', re: /^(process|roadmap|chain|flow|stages|phase|round|loop|orbit|network|ecosystem|orgchart|tree|method|checklist|plans|route)/i },
  { cat: '观点/结论/金句', re: /^(quote|statement|manifesto|conclusion|outlook|takeaway|lesson|recap|closing|type-statement|voices|faq|verdict|principles)/i },
  { cat: '案例/特写', re: /^(case|profile|spotlight|editorial|feature|story|showcase|banner|hero|compute|resource|exhibit|magazine|poster)/i },
  { cat: '图片/画廊', re: /^(photo|image|gallery|gridwall|gallerywall|filmstrip|album|moodboard|collage|pict|sticker|postcard|stampsheet|vinyl|lyric|polaroid|masonry|panorama|zine|team)/i },
  { cat: '雷达/风险/能力', re: /^(radar|risk|strength|capab|feature)/i },
  { cat: '地区/区域', re: /^(region|geo|map|global|country|city|bay|sector|market)/i },
  { cat: '附录/收尾', re: /^(appendix|colophon|back|end)/i },
];

function categorize(slot) {
  for (const r of RULES) if (r.re.test(slot || '')) return r.cat;
  return '其他';
}

/* ── 生成目录 ─────────────────────────────────────────── */
const byCat = {};
keys.forEach(k => {
  const l = layouts[k];
  const cat = categorize(l.slot);
  (byCat[cat] = byCat[cat] || []).push({ key: k, label: l.label || '', slot: l.slot || '', theme: l.themePack });
});

const catOrder = [...new Set(RULES.map(r => r.cat))].filter(c => byCat[c]);
const extraCats = Object.keys(byCat).filter(c => !catOrder.includes(c)).sort();
const allCats = [...catOrder, ...extraCats];

let md = `# 页级模板目录（layout-catalog.md）

> 由 \`scripts/build-layout-catalog.cjs\` 从 dashiai layout-manifest.json 生成（共 ${keys.length} 个布局）。
> **用途**：AI 在设计阶段按「内容类型 → 布局需求」查本节选页级模板。
> **选法**：页面定义写 \`layout: 'themeXX_pageNNN'\` + 对应数据字段。
> **红线**：没有合适模板就手搓 DSL，禁止为套模板删改内容。

## 快速对照（内容类型 → 类别 → 示例）

| 内容类型 | 查类别 | 示例布局 |
| --- | --- | --- |
| 封面/开场 | 封面 | theme01_page001 编辑式双栏、theme02_page001… |
| 目录/议程 | 目录/议程 | theme01_page009 报告导览 |
| 章节切换 | 章节过渡 | theme01_page011 章节·市场全景 |
| 核心数字/KPI | 大数字/KPI | theme01_page006 大数字·资本体量 |
| 趋势/时间序列 | 图表·趋势 | theme01_page012 纵向趋势 |
| 占比/构成 | 图表·构成占比 | theme01_page079 甜甜圈 |
| 对比/涨跌 | 对比/对决 | theme01_page025 三强横向对比 |
| 排行/榜单 | 排行/表格 | theme01_page019 头部玩家 |
| 流程/路线 | 流程/路线/链 | theme01_page040 阶段性策略路线图 |
| 时间线/里程碑 | 图表·时间/排期 | theme01_page028 里程碑时间轴 |
| 金句/结论 | 观点/结论/金句 | theme01_page027 金句·CEO 视角 |
| 案例/特写 | 案例/特写 | theme01_page026 典型案例 |
| 图片/画廊 | 图片/画廊 | theme01_page076 影像长卷 |
| 架构/关系 | 流程/路线/链 | theme01_page014 产业链分层 |
| 风险/能力 | 雷达/风险/能力 | theme01_page038 风险研判 |
| 地区分布 | 地区/区域 | theme01_page034 地区分布 |

`;

allCats.forEach(cat => {
  const items = byCat[cat].sort((a, b) => a.key.localeCompare(b.key));
  const themes = [...new Set(items.map(i => i.theme))];
  md += `## ${cat}（${items.length} 个 · ${themes.length} 套主题覆盖）\n\n`;
  md += `| key | label | slot |\n| --- | --- | --- |\n`;
  items.forEach(i => {
    md += `| ${i.key} | ${i.label} | ${i.slot} |\n`;
  });
  md += '\n';
});

md += `## 其他说明\n\n- 布局按主题成套：同一 slot 在不同主题下有对应页（如 theme01_page006 ↔ theme02_page006），选模板时优先查所选主题。\n- label 为中文语义名，slot 为机器分类，AI 按内容匹配 label/slot。\n- 重新生成：\`node scripts/build-layout-catalog.cjs\`\n`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, 'utf8');
console.log(`✅ 模板目录已生成: ${outPath}`);
console.log(`   类别数: ${allCats.length}，布局总数: ${keys.length}，文件大小: ${(md.length / 1024).toFixed(1)} KB`);
