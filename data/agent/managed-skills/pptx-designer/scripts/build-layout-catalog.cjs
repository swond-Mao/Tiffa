#!/usr/bin/env node
/**
 * pptx-designer build-layout-catalog.cjs — 从 dashiai layout-manifest.json 生成页级模板目录
 *
 * v2（taxonomy）：在 v1 内容类型分类之上：
 *   1. 扩充 slot/label 规则，清理「其他」死区（原 416 个 → 目标 <50）
 *   2. 新增 L3 布局族（纯文字/多卡片/并列/流程/总分/左图右文/图表/金句/时间轴/画廊）
 *   3. 自动提取卡数/图数（countBindings）
 *   4. 按族给文本容量基准
 *   5. 顶部检索流程（L1→L2→L3→L4 + 相邻页防撞）
 *
 * 用法:
 *   node scripts/build-layout-catalog.cjs [manifest路径] [-o 输出.md]
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

/* ── L2 内容类型：slot 正则（v1 主规则 + v2 补充） ─────── */
const RULES = [
  { cat: '封面', re: /^cover/i },
  { cat: '目录/议程', re: /^(contents|agenda)/i },
  { cat: '章节过渡', re: /^(chapter|section|interlude|divider|ch\d+|capital-chapter)/i },
  { cat: '大数字/KPI', re: /^(bignum|bignumber|statgrid|stat3|scorecard|kpi|metric|evil|bento|stat|cards|ticket|summary|overview|spec|big|monolith|megafigure|bigstat|megadeals|megabig|dominance|avgticket|deal-size)/i },
  { cat: '图表·趋势', re: /^(trend|line|area|stream-area|sparkline|slope|stream|vertical|annotated|peak|peaktrough|horizon|curve|growth|cumulative|delta|q[1-4]|monthchart|charts|candles|valuationjump|valuechart|capflow|forward-page)/i },
  { cat: '图表·构成占比', re: /^(donut|pie|waterfall|stacked|stackbars|mekko|waffle|mosaic|marimekko|sunburst|stack|rose|polar-rose|share|mix|scene|allocation|sizesplit|investor|investor-mix|concentration|concentration-page|isotype|radialstack|quilt)/i },
  { cat: '图表·分布比较', re: /^(bar|column|grouped|diverging|bullet|lollipop|dumbbell|bubble|scatter|dotplot|box|histogram|tornado|pareto|ladder|spread|heat|range|distribution|ridge|dealmap|deal-map-page|dotfield|point|quad)/i },
  { cat: '图表·多维', re: /^(radar|heatmap|treemap|funnel|sankey|pyramid|tier|quadrant|matrix|gauge|gauges|meter|venn|spectrum|layers|arc|orbit|bump|radar-page|matrix-page|crosstab|grade|radialbar|icicle|honeycomb|polar|balance|hive|medallions)/i },
  { cat: '图表·时间/排期', re: /^(gantt|timeline|zigzag|milestone|monthly|calendar|era|journey|cold-start|accelerate|cooldown|snapshot)/i },
  { cat: '排行/表格', re: /^(ranking|rank|top10|table|bump|leaderboard|investors|ledger|scoreboard|register|logowall|datatable|directory|board|schedule|specs|glossary)/i },
  { cat: '对比/对决', re: /^(versus|duel|compare|split|diptych|beforeafter|triptych|triad|pair|duo|contrast)/i },
  { cat: '流程/路线/链', re: /^(process|roadmap|chain|flow|stages|phase|round|loop|orbit|network|ecosystem|orgchart|tree|method|checklist|plans|route|flux|pipeline|path|steps|swimlane|cycle|cyclewheel|spheres|mindmap|metro|diagram|migration|playbooks|gate|shield|escalation|stair)/i },
  { cat: '观点/结论/金句', re: /^(quote|statement|manifesto|conclusion|outlook|takeaway|lesson|recap|closing|type-statement|voices|faq|verdict|principles|lede|epigraph|bracket|typeriver|thesis|testimonial|testimonials|whynow|join)/i },
  { cat: '案例/特写', re: /^(case|profile|spotlight|editorial|feature|story|showcase|banner|hero|compute|resource|exhibit|magazine|poster|openai|anthropic|xai|coreweave|scaleai|perplexity|databricks|glean|figure|ssi|agent|search|legal|health|finance|dev|datainfra|lowcode|opensource|safety|autonomy|robotics|chip|education|support|sales|alignment|content-gen|knowledge|benchmark|dossier|nexus|foundry|segment|stage|halfhero|immersive|ring|pf-|gpu|embodied|supply|trio|syndicate|infra|ipowatch)/i },
  { cat: '流程/路线/链', re: /^(early-stage|composite|breakdown|deal-structure)/i },
  { cat: '图表·多维', re: /^(aarrr|rfm|maba|swot|fiveforces|canvas|pest|shift|chord|cross)/i },
  { cat: '图表·构成占比', re: /^(dealstruct|alloc)/i },
  { cat: '大数字/KPI', re: /^(capacity|slate|beacon|ceiling|index|source|catalog|signal|ribbon|avg-ticket|cardgrid|cards)/i },
  { cat: '排行/表格', re: /^(pricing|directory)/i },
  { cat: '图片/画廊', re: /^(inset|fullbleed|captioned)/i },
  { cat: '图片/画廊', re: /^(photo|image|gallery|gridwall|gallerywall|filmstrip|album|moodboard|collage|pict|sticker|postcard|stampsheet|vinyl|lyric|polaroid|masonry|panorama|zine|team|plate|pinboard|spark|strata|wall)/i },
  { cat: '雷达/风险/能力', re: /^(radar|risk|strength|capab|feature|riskchain|compliance|margin|moat|revenue|regrisk|openrisk|revrisk|capmatrix)/i },
  { cat: '地区/区域', re: /^(region|geo|map|global|country|city|bay|sector|market|nyc|seattle|boston|other|alliance|locale|cartogram|parallel)/i },
  { cat: '附录/收尾', re: /^(appendix|colophon|back|end|sources|about)/i },
];

/* L2 兜底：label 关键词（theme08/11 等 slot 无语义时用） */
const LABEL_RULES = [
  { cat: '封面', re: /封面|Cover|cover/ },
  { cat: '目录/议程', re: /目录|导览|纲目|结构表|Contents|Agenda|agenda/ },
  { cat: '章节过渡', re: /章节|间章|Chapter|Section|chapter|section|序章|收束/ },
  { cat: '大数字/KPI', re: /大数字|指标|数字|Big Number|bignumber|评分|Scorecard|scorecard|量级|达成|目标|摘要|Overview|overview|总览/ },
  { cat: '图表·趋势', re: /趋势|走势|曲线|Trend|trend|峰值|Peak|峰谷|累计|环比|Delta|delta|增长|预测/ },
  { cat: '图表·构成占比', re: /占比|构成|份额|Mix|mix|瀑布|Waterfall|waterfall|甜甜圈|donut|玫瑰|rose|象形|资金去向/ },
  { cat: '图表·分布比较', re: /分布|气泡|散点|区间|范围|热力|Heatmap|heatmap|子弹|哑铃|分组|盈亏|点阵/ },
  { cat: '图表·多维', re: /雷达|Radar|radar|矩阵|Matrix|matrix|象限|Quadrant|quadrant|树图|treemap|漏斗|Funnel|funnel|桑基|sankey|金字塔|Pyramid|pyramid|仪表|Gauge|gauge|维恩|Venn|venn|蜂巢|光谱|双钻/ },
  { cat: '图表·时间/排期', re: /时间轴|里程碑|Timeline|timeline|排期|甘特|日历|月历|旅程|Journey|journey|路线图|Roadmap|roadmap|节拍|历程|年度|编年|纪程/ },
  { cat: '排行/表格', re: /排行|排名|榜单|表格|Top|台账|账本|记分|登记|名录|Rating|rating|Leaderboard|leaderboard|明细/ },
  { cat: '对比/对决', re: /对比|对决|对照|双联|三联|分屏|Before|After|前后|Compare|compare|Versus|versus|多空/ },
  { cat: '流程/路线/链', re: /流程|路线|链路|产业链|价值链|方法|Method|method|方法论|闭环|循环|泳道|架构|组织|清单|步骤|Process|process|Roadmap|roadmap|流程图|飞轮|路径|诊断/ },
  { cat: '观点/结论/金句', re: /金句|结论|观点|主张|展望|引言|问答|原则|信条|结语|Quote|quote|Statement|statement|Manifesto|manifesto|Conclusion|conclusion|Outlook|outlook|Verdict|verdict|证言|见证|宣言/ },
  { cat: '案例/特写', re: /案例|特写|聚焦|档案|杂志|海报|Showcase|showcase|Spotlight|spotlight|Profile|profile|Feature|feature|案例集|团队|人物|赛道|图谱|生态|格局|服务|成果|作品|供应链|算力|芯片|具身|知识入口|数据底座|内容生成|降本场景|社区变现|资源绑定|安全防线|安全对齐|早期轮|收入兑现|迁移图|跨页|实证|渠道|样板|破冰航道/ },
  { cat: '观点/结论/金句', re: /大势|透视|板块|资金用途|图注精读|板块联投|全幅比例带|策略/ },
  { cat: '图表·多维', re: /范式转变|三强争霸|早期信号|结构拆解|子项拆分/ },
  { cat: '排行/表格', re: /阵容|均值|估值锚|毛利天花板|资本来源|知识索引|策略推荐/ },
  { cat: '流程/路线/链', re: /工作流嵌入|容量栅格|图像型录|确定性预算|优先基建|垂直应用|重定价|复杂交易结构|未披露轮次|估值之谜/ },
  { cat: '图片/画廊', re: /图片|影像|画廊|图集|拼贴|拍立得|明信片|胶片|全景|照片|图墙|Gallery|gallery|Mosaic|mosaic|图辑|主屏|现场|图景/ },
  { cat: '雷达/风险/能力', re: /风险|能力|合规|壁垒|研判|Risk|risk|Strength|strength/ },
  { cat: '地区/区域', re: /地区|区域|地理|分布|湾区|全球|Region|region|Geo|geo|城市/ },
  { cat: '附录/收尾', re: /附录|封底|数据来源|谢幕|结束|Appendix|appendix|Colophon|colophon|术语/ },
];

function categorize(l) {
  const slot = l.slot || '';
  for (const r of RULES) if (r.re.test(slot)) return r.cat;
  const label = l.label || '';
  for (const r of LABEL_RULES) if (r.re.test(label)) return r.cat;
  return '其他';
}

/* ── L3 布局族 ───────────────────────────────────────── */
function classifyL3(l, cat) {
  const slot = (l.slot || '').toLowerCase();
  const label = l.label || '';
  const cbs = l.countBindings || [];
  const ctx = slot + ' ' + label;

  if (['封面', '目录/议程', '章节过渡', '附录/收尾'].includes(cat)) return { fam: '定位', cards: '-', imgs: '-', cap: '-' };

  let cards = '-';
  const cardB = cbs.find(c => /card|count|block|item|metric/i.test(c.key) && !/image|photo|img|meta/i.test(c.key));
  if (cardB) cards = `${cardB.min}-${cardB.max}`;
  let imgs = '-';
  const imgB = cbs.find(c => /image|photo|img/i.test(c.key));
  if (imgB) imgs = `${imgB.min}-${imgB.max}`;

  let fam = '纯文字';
  if (/flow|process|roadmap|chain|method|steps|swimlane|cycle|route|checklist|pipeline|phases|阶段|流程|路线|方法|闭环|路径|飞轮|迁移/i.test(ctx)) fam = '流程';
  else if (/timeline|gantt|milestone|monthly|calendar|journey|era|排期|时间轴|里程碑|月历|旅程|编年|纪程|节拍|历程/i.test(ctx)) fam = '时间轴';
  else if (/quote|statement|manifesto|conclusion|outlook|verdict|lede|金句|结论|观点|主张|展望|宣言|证言|见证/i.test(ctx)) fam = '金句';
  else if (/donut|pie|waterfall|trend|bar|column|radar|heatmap|treemap|funnel|sankey|line|area|scatter|bubble|gauge|占比|趋势|柱状|雷达|热力|漏斗|桑基|气泡|仪表|象限|矩阵|树图|金字塔|玫瑰/i.test(ctx)) fam = '图表主视觉';
  else if (/bignum|bignumber|stat|metric|scorecard|kpi|大数字|指标|评分|量级|达成|megafigure|bigstat|monolith/i.test(ctx)) fam = '大数字';
  else if (/compare|versus|split|diptych|triptych|triad|对比|对决|对照|双栏|分屏|多空|前后/i.test(ctx)) fam = '并列';
  else if (/table|ranking|ledger|register|排行|表格|榜单|台账|记分|登记|名录|明细|账本/i.test(ctx)) fam = '排行表格';
  else if (cards !== '-' && (parseInt(cards.split('-')[0]) >= 3 || /card|卡/.test(ctx))) fam = `多卡片${cards}`;
  else if (/gallery|grid|mosaic|polaroid|masonry|team|collage|图|画廊|影像|图集|拼贴|照片|图墙|胶片|全景/i.test(ctx)) fam = (imgs !== '-' && imgs !== '0-0') ? '左图右文' : '网格画廊';
  else if (imgs !== '-' && imgs !== '0-0') fam = '左图右文';
  else if (/scorecard|score|评分|记分|总分|verdict|综合/i.test(ctx)) fam = '总分';
  return { fam, cards, imgs, cap: capOf(fam) };
}

const CAP_BY_FAM = {
  '定位': '-', '纯文字': '600-800字', '多卡片': '每卡80-120字', '并列': '200-300字',
  '流程': '每步40-80字', '总分': '50-100+分项各60-100字', '左图右文': '200-300字',
  '图表主视觉': '80-120字+洞察', '金句': '20-50字', '时间轴': '每节点30-60字',
  '网格画廊': '图说各20-40字', '排行表格': '每行20-50字', '大数字': '30-100字+巨数字',
};
function capOf(fam) {
  const base = fam.startsWith('多卡片') ? '多卡片' : fam;
  return CAP_BY_FAM[base] || '待评估';
}

/* ── 生成目录 ─────────────────────────────────────────── */
const byCat = {};
keys.forEach(k => {
  const l = layouts[k];
  const cat = categorize(l);
  const l3 = classifyL3(l, cat);
  (byCat[cat] = byCat[cat] || []).push({
    key: k, label: l.label || '', slot: l.slot || '', theme: l.themePack,
    fam: l3.fam, cards: l3.cards, imgs: l3.imgs, cap: l3.cap === '-' ? '-' : l3.cap,
  });
});

const catOrder = [...new Set(RULES.map(r => r.cat))].filter(c => byCat[c]);
const extraCats = Object.keys(byCat).filter(c => !catOrder.includes(c)).sort();
const allCats = [...catOrder, ...extraCats];
const otherCount = byCat['其他'] ? byCat['其他'].length : 0;

let md = `# 页级模板目录（layout-catalog.md）

> 由 \`scripts/build-layout-catalog.cjs\` 从 dashiai layout-manifest.json 生成（共 ${keys.length} 个布局 · v2 taxonomy）。
> **用途**：AI 在设计阶段按「内容类型 → 布局族 → 候选」查本节选页级模板。
> **选法**：页面定义写 \`layout: 'themeXX_pageNNN'\` + 对应数据字段。
> **红线**：没有合适模板就手搓 DSL，禁止为套模板删改内容。

## 检索流程（L1→L2→L3→L4，强制）

1. **L1 页面定位**：封面/目录/章节过渡/正文/结束页 → 定位类直接挑（封面/目录/章节/附录）
2. **L2 内容类型**：正文页按本页内容定位到 18 类之一（数据KPI/图表·趋势/流程路线/案例特写…）
3. **L3 布局族**：在该类内按版式需求选族（纯文字/多卡片N/并列/流程/总分/左图右文/图表主视觉/金句/时间轴/画廊）
   - **相邻页防撞**：排除上一页已用 L3 族；候选全被排除才允许回退上一族（须换 L4 模板）
4. **L4 候选**：读该族模板表，按卡数/图数/容量匹配，挑 1 个（同类多选一，保证页标题等一致性）
5. 查不到合适 → 手搓 DSL（正常路径，不是降级）

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

### 布局族定义（L3）

| L3 族 | 判定 | 文本容量基准 | 卡数/图数 |
| --- | --- | --- | --- |
| 定位 | 封面/目录/章节/结束 | - | - |
| 纯文字 | 无卡/图，段落为主 | 600-800字 | - |
| 多卡片N | 卡数≥3 | 每卡80-120字 | 卡N |
| 并列 | 2-3 栏对等/对比 | 200-300字 | - |
| 流程 | 步骤/箭头/路线 | 每步40-80字 | - |
| 总分 | 主结论+分项 | 50-100+分项各60-100字 | - |
| 左图右文 | 图+文字块 | 200-300字 | 图N |
| 图表主视觉 | 图占≥50% B 区 | 80-120字+洞察 | 图N |
| 金句 | 大字主张/引语 | 20-50字 | - |
| 时间轴 | 里程碑/排期 | 每节点30-60字 | - |
| 网格画廊 | 图片墙/拼贴 | 图说各20-40字 | 图N |
| 排行表格 | 表格/榜单 | 每行20-50字 | - |

`;

allCats.forEach(cat => {
  const items = byCat[cat].sort((a, b) => a.key.localeCompare(b.key));
  const themes = [...new Set(items.map(i => i.theme))];
  md += `## ${cat}（${items.length} 个 · ${themes.length} 套主题覆盖）\n\n`;
  md += `| key | label | slot | L3族 | 卡数 | 图数 | 容量 |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
  items.forEach(i => {
    md += `| ${i.key} | ${i.label} | ${i.slot} | ${i.fam} | ${i.cards} | ${i.imgs} | ${i.cap} |\n`;
  });
  md += '\n';
});

md += `## 其他说明\n\n- 布局按主题成套：同一 slot 在不同主题下有对应页（如 theme01_page006 ↔ theme02_page006），选模板时优先查所选主题。\n- label 为中文语义名，slot 为机器分类，L3 族为版式分类，卡数/图数来自 manifest countBindings（- 表示无约束），容量为族基准（常用族人工校准中）。\n- 「其他」类 = 未能归类的模板，需人工评估（AI 尽量不选）。\n- 重新生成：\`node scripts/build-layout-catalog.cjs\`\n`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, 'utf8');
console.log(`✅ 模板目录已生成: ${outPath}`);
console.log(`   类别数: ${allCats.length}，布局总数: ${keys.length}，其他: ${otherCount} 个，文件大小: ${(md.length / 1024).toFixed(1)} KB`);
