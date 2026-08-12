# pptx-designer：从零设计生成专业汇报 PPT 技能（原生 .pptx）

## 1. 目标

为 Tiffa 新增一个 PPT 生成技能 `pptx-designer`：参照 WorkBuddy tencent-pptx 的**设计方法论**（从零逐页设计、视觉锚点、密度门禁、Hero/Supporting 节奏、非对称版式预算），底层用开源 `pptxgenjs` 输出**原生 .pptx**（可被 WPS/Office 编辑）。与现有 `dashiai-ppt`（模板组合/HTML 预览）和 `pptx-from-layouts`（模板母版）互补，主打"正儿八经的汇报 PPT"。

## 2. 现状与差距

| 现状 | 问题 |
|---|---|
| `dashiai-ppt` | 模板拼装，PPTX 为 HTML 导出（样式损耗），无设计规则约束 |
| `pptx-from-layouts` | 依赖用户模板，python-pptx 生态，无从零设计能力 |
| `pptgen` | HTML 交互页，非 Office 汇报场景 |
| 腾讯 tencent-pptx | 方法论强，但底层 `slidep-*` 闭源不可用 |

根因：Tiffa 缺一条「从零设计 + 强规则约束 + 原生 .pptx」的生成路径。

## 3. 总体架构

```
G:/Tiffa/skills/pptx-designer/
├── SKILL.md                        # 主流程（需求澄清→STORY→DESIGN→逐页→编译→预览）
├── references/
│   ├── design-principle.md         # 通用设计法则（重写，不抄原文）
│   ├── story-principle.md          # 叙事原则（重写）
│   ├── component-guide.md          # pptxgenjs 组件/API 使用指南 + 单位换算
│   └── designs/                    # 预设风格（重写思路）
│       ├── academic.md             # 学术风（蓝白克制）
│       ├── consulting.md           # 商务咨询风（权威数据密集）
│       └── redgold.md              # 红金政务风（庄重中文优先）
├── scripts/
│   ├── build.js                    # 页面定义 → .pptx 编译器 + 规则校验（--lint）
│   └── preview.js                  # 页面定义 → 静态 HTML 预览快照
├── package.json                    # 依赖 pptxgenjs
└── templates/                      # （预留）素材
```

## 4. 页面定义 DSL（数据驱动，非 JSX）

每页一个 `.js` 文件，导出对象（放 `pages/slide_XX_desc.js`），build.js 统一渲染。

```js
// pages/slide_01_cover.js
module.exports = {
  id: 'slide_01_cover',
  type: 'cover',          // cover | catalog | section | content | ending
  role: 'hero',           // hero | supporting | transition
  background: '#FFFFFF',
  elements: [
    // text / rect / line / image / chart / table / svg
    { type: 'text', x: 80, y: 220, w: 900, h: 120,
      text: '2026 年度医疗质量报告', fontSize: 72, bold: true, color: '#1A1A1A' },
    { type: 'rect', x: 80, y: 360, w: 120, h: 8, fill: '#C8102E' },
  ],
};
```

**为什么数据驱动**：build.js 渲染时可执行规则校验（配色 ∈ DESIGN.md 色板、字号 ∈ 阶梯、元素不溢出 1280×720、母版区齐全），这是"设计规则可执行"的关键，JSX 编译链路做不到同等校验强度。

## 5. pptxgenjs 映射

| 语义 | pptxgenjs API |
|---|---|
| 画布 1280×720 | `LAYOUT_16x9`（13.333×7.5 in），内部 px→inch 换算函数 `px(1280)=13.333` |
| 文本（富文本/加粗/变色） | `slide.addText(runs[], opts)`，runs 支持 `{text, options:{bold,color}}` |
| 矩形/圆/线/箭头 | `slide.addShape('rect'|'ellipse'|'line', opts)`，支持渐变 fill |
| 图片 | `slide.addImage({path, x,y,w,h})` |
| 图表 | `slide.addChart('bar'|'line'|'pie', data, opts)` |
| 表格 | `slide.addTable(rows, opts)` |
| 背景装饰 | 绝对定位 shape + 透明度（`fill:{transparency}`） |

规则校验（build.js `--lint`，全量跑）：配色 ≤4 hex 且来自 DESIGN.md、字号符合阶梯、无元素溢出、内容页含标题块+页码、Hero 页有视觉锚点（≥48px 数字或 ≥40% 面积图）、版式与 role 匹配。

## 6. 工作流（SKILL.md）

1. **需求澄清**：主题必问；受众/场合轻问 1 次；页数默认 10-15；风格默认商务浅色；备注默认不写。用户说"直接做"→ 跳过反问
2. **STORY.md**：意图对齐（受众/目标/长度/调性/边界）→ 页面骨架（Hero 占比 20-30%、非对称 ≥40%、rhythm 曲线）→ 页面大纲（字段：title/type/role/rhythm/layout/visual/density/anti_pattern）
3. **DESIGN.md**：画布 1280×720、母版 A/B/C 三区（标题 0-120 / 内容 120-660 / 页脚 660-720）、色板 ≤4 hex + 面积分配、字号阶梯、每页版式映射表、配图清单
4. **逐页生成**：pages/slide_XX.js（对照 STORY + DESIGN，动笔自检 10 条硬约束）
5. **编译**：`node scripts/build.js --project <dir> -o 输出.pptx`（内部先 lint 后渲染）
6. **预览**：`node scripts/preview.js --project <dir>` 生成静态 HTML 快照 + `shell.openPath` 打开 .pptx
7. **交付**：面向用户语言说明主题/页数/风格

## 7. 预设风格（3 套 + 通用）

| 风格 | 调性 | 色板示例 | 适用 |
|---|---|---|---|
| academic | 可信/蓝白克制 | #FFFFFF #1E3A5F #3B82F6 #64748B | 答辩、科研、临床汇报、课题 |
| consulting | 权威/数据密集 | #0F172A #3B82F6 #06B6D4 #F8FAFC | 行业研究、高管汇报、投行 |
| redgold | 庄重/红金 | #FFFFFF #C8102E #D4AF37 #1A1A1A | 党政、国企、党课、表彰 |

命中规则：用户场景明确属于三领域 → 读对应风格文件；否则走通用设计原则（AI 自由设计）。

## 8. 实现计划（分阶段）

### 阶段 A：骨架 + 编译器（本次）
- `文件: skills/pptx-designer/package.json` — 依赖 pptxgenjs
- `文件: skills/pptx-designer/scripts/build.js` — px→inch 换算、元素渲染器（text/rect/line/image/chart/table）、lint 校验、CLI 参数
- `文件: skills/pptx-designer/scripts/preview.js` — 页面定义 → HTML 快照
- `文件: skills/pptx-designer/references/component-guide.md` — API 速查
- `文件: skills/pptx-designer/SKILL.md` — 主流程（阶段 A 先简版，规则文档后续补）
- **验证**：demo 项目（封面 1 + 内容 2 页）→ build 出 .pptx → preview 出 HTML

### 阶段 B：设计方法论文档
- `references/design-principle.md`、`story-principle.md`、`designs/{academic,consulting,redgold}.md`（重写腾讯思路）

### 阶段 C：生成后编辑 + 生图接入
- 编辑指令（改文字/换图）走 build.js 重新渲染；生图接 image-gen-router

## 9. 修改文件清单

| 文件 | 改动范围 |
|---|---|
| `skills/pptx-designer/SKILL.md` | 新建，主流程 |
| `skills/pptx-designer/package.json` | 新建，依赖 pptxgenjs |
| `skills/pptx-designer/scripts/build.js` | 新建，编译器+lint |
| `skills/pptx-designer/scripts/preview.js` | 新建，HTML 快照预览 |
| `skills/pptx-designer/references/component-guide.md` | 新建，API 速查 |
| `skills/pptx-designer/references/design-principle.md` 等 | 阶段 B 新建 |
| `electron/design/pptx-designer-design.md` | 本文档 |

## 10. 风险与对策

- **pptxgenjs 样式边界**（渐变文字、SVG 蒙版）：不支持则降级（纯色/图片替代），记录踩坑
- **中文渲染**：pptxgenjs 输出依赖 WPS/Office 字体，字体名用系统中文字体（微软雅黑/思源黑体），无需内嵌
- **预览 HTML 与 .pptx 视觉偏差**：预览定位为"版式快照"，以 .pptx 为准，注明偏差免责

---

## 进度记录（2026-08-13）

### 阶段 A+B 已全部完成

**核心修复**：LAYOUT_16x9 实际 10×5.625in（960×540px），修正 INCH_PER_PX=10/1280、PT_PER_PX=0.5625，坐标与字号精确映射，HTML/PPTX 一致。

**已完成**：
- build.js：编译 + lint（配色/溢出/母版/Hero 锚点）+ 边界裁剪 + 文本预计算字号（shrink.js 共享算法）+ margin:0 + chart 增强（barDirection/grouping/title）+ table 斑马纹
- preview.js：HTML 版式快照（共享 shrink 算法）
- profile_template.js：上传 PPTX → 解包 XML 提取色板/字体/字号/元素类型 → 生成 design.json（模板模仿核心，比截图+视觉更精确）
- extract_assets.js：docx/pptx/xlsx → 提取图片
- 方法论文档（重写腾讯思路）：design-principle.md（通用法则）、story-principle.md（叙事原则）、designs/academic.md（14 条闸门）、consulting.md（17 条）、redgold.md（18 条）、dashiai-styles.md（dashiai 12 套主题色板整合）
- SKILL.md：完整流程（模板分析 → STORY → DESIGN → 逐页 → 编译 → 预览 → 交付）

**验证**：demo（封面+数据页+要点页）编译通过，坐标/字号/内边距/自动页码 XML 级确认；模板分析器从 demo 提取出 5 色板全中；dashiai 12 套主题色板提取成功。
