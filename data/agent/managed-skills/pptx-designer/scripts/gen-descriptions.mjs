// 从模板 defaultProps 结构生成自然语言排布描述 → layout-descriptions.md
import path from 'path';
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..', '..', '..', '..', 'data', 'agent', 'managed-skills', 'pptx-designer');
const mod = await import(pathToFileURL(path.join(SKILL, 'scripts', 'export', 'layout-render.mjs')).href);

function arrLen(x) { return Array.isArray(x) ? x.length : 0; }

function describe(dp) {
  const p = [];
  const has = (k) => dp[k] !== undefined && dp[k] !== '' && dp[k] !== false && dp[k] !== null;

  if (has('kicker')) p.push('顶部眉标 kicker');
  if (has('title')) p.push('主标题');
  if (has('titleEm')) p.push('主标题+强调词');
  if (has('titleTop')) p.push('双行大标题（上行）');
  if (has('titleBottom')) p.push('双行大标题（下行）');
  if (has('lead') || has('intro')) p.push('导语段');
  if (has('desc')) p.push('说明段');

  // 数据卡
  const nStats = arrLen(dp.stats);
  if (nStats) p.push(`中间 ${nStats} 个大数字卡${dp.columns === 2 ? '（2 列）' : ''}（巨数字+标签+副注）`);
  const nCards = arrLen(dp.cards);
  if (nCards) p.push(`${nCards} 个图文卡（标题+描述+标签）`);
  const nInv = arrLen(dp.investors);
  if (nInv) p.push(`${nInv} 行横向条目（名称+分类+右侧数值）`);
  const nTakeaways = arrLen(dp.takeaways);
  if (nTakeaways) p.push(`${nTakeaways} 条结论卡（左侧色块标签+右侧说明）`);
  const nSec = arrLen(dp.secondaries);
  if (nSec) p.push(`主数字下方 ${nSec} 个次级数据`);

  // 图表
  if (has('chartType') || has('segments') || has('series')) p.push('图表主视觉');
  if (arrLen(dp.segments)) p.push(`（${arrLen(dp.segments)} 段占比）`);
  if (arrLen(dp.series)) p.push(`（${arrLen(dp.series)} 系列数据）`);
  if (arrLen(dp.groups)) p.push(`（${arrLen(dp.groups)} 组）`);
  if (has('centerValue')) p.push('环形中心大数字');

  // 流程/时间轴
  const nPhases = arrLen(dp.phases);
  if (nPhases) p.push(`${nPhases} 阶段路线图（时段+标题+要点+结论）`);
  const nSteps = arrLen(dp.steps);
  if (nSteps) p.push(`${nSteps} 步流程（步骤卡+说明）`);
  const nEvents = arrLen(dp.events);
  if (nEvents) p.push(`${nEvents} 节点时间轴（日期+阶段+说明）`);
  const nMilestones = arrLen(dp.milestones);
  if (nMilestones) p.push(`${nMilestones} 项里程碑列表`);

  // 表格
  const nRows = arrLen(dp.rows);
  if (nRows && has('columns')) p.push(`${nRows} 行 × ${arrLen(dp.columns)} 列数据表格`);
  if (nRows && has('cols')) p.push(`${nRows} 行能力矩阵（${arrLen(dp.cols)} 列对比）`);
  if (arrLen(dp.attributes) && arrLen(dp.plans)) p.push(`${arrLen(dp.attributes)} 维度 × ${arrLen(dp.plans)} 方案对照表`);

  // 金句/结论
  if (has('quote')) p.push('大字金句（带引号装饰）');
  if (has('authorName')) p.push('署名');
  if (has('summary')) p.push('底部总结条');
  if (has('bandLabel')) p.push('TL;DR 标签条');

  // 图片
  const nMedia = arrLen(dp.media);
  if (nMedia || has('imageSlotCount')) p.push(`图片槽位（${dp.imageSlotCount ?? nMedia} 个）`);
  if (has('mediaPlaceholderHero')) p.push('主图大槽位');

  // 章节/封面
  if (dp.chapterData) {
    p.length = 0;
    p.push(`章节页：左/上 ${dp.chapterData.zh || '章节标题'} 大字 + 英文副标 + 导语 + ${arrLen(dp.chapterData.tags) || '若干'} 个导航标签`);
  }
  if (has('partLabel')) p.push('章节编号 PART');
  if (has('topics')) p.push(`${arrLen(dp.topics)} 个主题标签`);

  // 装饰
  if (has('showGhost')) p.push('背景巨字');
  if (has('showDecorations') || has('showDecor')) p.push('装饰元素');
  if (has('hero')) p.push('Hero 大数字块');

  if (has('caption')) p.push('底部图注/洞察');
  if (has('footnote')) p.push('页脚落款');

  return p.length ? p.join('，') + '。' : '（结构未自动识别，建议 describeLayout 人工查看）';
}

// 遍历全部模板
const manifest = JSON.parse(fs.readFileSync(path.join(SKILL, '..', 'dashiai-ppt', 'project', 'layout-manifest.json'), 'utf8'));
const keys = Object.keys(manifest.layouts).sort();
const lines = [];
let ok = 0, fail = 0;
for (const k of keys) {
  try {
    const d = await mod.describeLayout(k);
    const desc = describe(d?.defaultProps || {});
    lines.push(`| ${k} | ${d?.label || ''} | ${desc}`);
    ok++;
  } catch (e) { fail++; }
}
const md = `# 页级模板版式描述（layout-descriptions.md）

> 每个模板的**自然语言排布描述**（由 defaultProps 结构自动生成）：选模板时先查本节了解排布，再 describeLayout 确认字段。
> 版式语言定义见 \`layout-styles.md\`。

| key | label | 排布描述 |
| --- | --- | --- |
${lines.join('\n')}

---
生成: ${ok} 成功 / ${fail} 失败 / 共 ${keys.length}
`;
const out = path.join(SKILL, 'references', 'layout-descriptions.md');
fs.writeFileSync(out, md, 'utf8');
console.log(`✅ 版式描述已生成: ${out}`);
console.log(`   成功 ${ok} / 失败 ${fail} / 共 ${keys.length}，大小 ${(md.length / 1024).toFixed(1)} KB`);
