---
name: pptx-designer
description: 从零设计生成专业汇报 PPT（原生 .pptx，强设计规则约束，支持上传模板模仿风格、上传材料生成内容）。**正儿八经的汇报场景（答辩/学术/政务/述职/行业分析/医院汇报）优先选本 skill**，不要用 dashiai-ppt（那是快速拼装/HTML 演示路线）。产出可被 WPS/Office 编辑的原生 .pptx。
description_cn: "从零设计生成专业汇报 PPT（原生 .pptx，强设计规则，支持模板模仿与材料生成）。答辩/学术/政务/述职/行业分析等正儿八经汇报优先用本skill。"
triggers:
  - 汇报PPT
  - 专业PPT
  - 从零做PPT
  - 答辩PPT
  - 学术汇报
  - 政务汇报
  - 述职报告
  - 年终总结
  - 医院汇报
  - 模仿模板
  - 按模板做
  - 上传模板做PPT
  - 按这个模板的风格
---

# pptx-designer

数据驱动页面定义 → `build.js` 编译原生 .pptx + lint 规则校验 → HTML 版式快照预览。

## 快速导航

| 任务 | 执行路径 |
| --- | --- |
| 从零创建 PPT | 下方标准流程（Step 1-8） |
| 上传模板模仿风格 | Step 0 模板分析 → 标准流程 |
| 上传材料（docx/pdf/pptx）生成 | Step 0 材料提取 → 标准流程 |

## 需求澄清（钩子模式，必须执行）

**制作前必须用 ask 工具询问以下两项，不得跳过**（用户已明确指定的除外）：

| 必问项 | 选项 | 默认 |
| --- | --- | --- |
| **① 选哪个模板/风格** | dashiai 12 套风格 / 领域预设 3 套（学术/咨询/红金）/ 自定义模板（用户上传 PPTX 分析）/ 默认商务浅色 | 默认商务浅色 |
| **② 图片怎么来** | 用户提供素材 / AI 生图（image-gen-router）/ 先用占位（后补图）/ 纯图表不用图 | 先用占位 |

其他澄清规则：主题缺失必问；受众/场合影响表达则轻问 1 次；页数默认 10-15 不问；演讲者备注默认不写不问。
用户说"直接做/你决定/看着办"或信息完整 → 跳过反问。**禁止多轮追问**。沟通用「页/封面/目录/这一页」术语，不暴露内部实现。
## 项目目录约定（必须遵守）

所有产物**必须**放在项目目录下，禁止散到 /tmp 或其他位置。

```
<项目目录>/
├── STORY.md                 # 叙事逻辑
├── DESIGN.md                # 设计稿
├── design.json              # 项目配置（色板/字体/主题）
├── pages/                   # 页面定义（slide_XX_名称.js）
├── resources/
│   └── images/              # 配图素材
└── output/                  # 生成产物
    ├── preview.html         # 翻页预览
    ├── editor.html          # 交互式编辑器
    ├── deck.pptx            # 编辑器一键导出（可编辑，视觉高保真）
    ├── deck.pdf             # 编辑器一键导出（PDF）
    └── 最终.pptx            # 编译产物（原生全形状，用户确认后生成）
```

**产物纪律**：
- 项目目录由用户指定或由 AI 在合理位置创建（如用户工作目录）
- 所有命令用 `--project <项目目录>` 指向项目根
- `preview.js` 输出到 `<项目目录>/output/preview.html`
- `render-editor.js` 输出到 `<项目目录>/output/editor.html`
- `build.js` 的 `-o` 指向 `<项目目录>/output/xxx.pptx`
- **禁止**把产物放到 /tmp、C 盘、技能目录等用户不知道的位置

## 标准流程（编辑优先，确认后导出）

> **核心原则**：先让用户在编辑器里改到满意，**用户确认后才编译 .pptx**。

### Step 0：模板/材料预处理（可选）


**用户上传了模板 PPTX 要模仿风格**：
```bash
node scripts/profile_template.js <模板.pptx> -o design.json
# 分析结果：色板/字体/字号范围/元素类型 → 直接作为 DESIGN.md 风格基线
```

**用户上传了材料（docx/pdf/pptx）要提取内容**：
- docx/pptx/xlsx 提取图片：`node scripts/extract_assets.js <材料.docx> -o resources/images`
- 文本内容用 read 工具直接读取文档，不反复提取

### Step 1：构建 STORY.md（叙事逻辑）
阅读 `references/story-principle.md`，按三步骤（意图对齐 → 页面骨架 → 页面大纲）生成 STORY.md。

### Step 2：构建 DESIGN.md（设计稿）
1. 风格路由：用户场景是否明确属于学术（高校/科研/医学汇报）、咨询（行研/投行/高管）、红金政务（党政/国企/党课）→ 读对应 `references/designs/*.md`，否则读通用 `references/design-principle.md`
2. **按方法论设计每页**：读 `references/methodology.md`——每页声明六要素（内容类型 → 布局模式 → 页面模板 → 色调 → 图位 → 视觉锚点），布局模式从 `references/layout-library.md` 选，色调从风格库（dashiai-styles.md 或模板分析）选
3. 若走了模板分析（Step 0）→ 以分析出的色板/字体为基线
4. DESIGN.md 必须写：画布母版、色板（≤4 hex）+ 面积分配、字号阶梯、**每页六要素映射表**、配图清单

### Step 3：逐页生成页面定义
- 每页一个 `pages/slide_XX_desc.js`，对照 STORY.md + DESIGN.md 逐页写
- 动笔前读 `references/component-guide.md`（API 速查）+ `references/layout-patterns.md`（配图版式库）
- **配图前置**：先定版式（含图片位）再定文字；需生图的先走 `image-gen-router` 技能出图到 `resources/images/`，逐张核对后再引用；暂无图则用 image 元素占位（自动渲染灰色占位块，后放图重新编译）
- 动笔自检 10 条硬约束（见 design-principle.md §7），任一不过返工

### Step 4：生成编辑器与预览
```bash
node scripts/render-editor.js --project <项目目录>   # → output/editor.html
node scripts/preview.js --project <项目目录>         # → output/preview.html
```
**必须同时启动导出服务**（一次性，保持运行）：
```bash
node scripts/serve-export.cjs   # 后台运行，勿关
```
把 editor.html 给用户打开，让用户在编辑器里**改字/换主题/调布局/加删元素**。
> 不要替用户编译 .pptx！用户还没改过，编译了也是废的。
> 编辑器打开时若服务未启动会显示红条提示，点「重试」或检查服务进程。

### Step 4.5：一键导出（编辑器内直接出可编辑 PPTX/PDF）
**编辑器顶栏的「导出 PPTX」「导出 PDF」按钮**可直接产出文件，无需回到命令行：

1. 导出服务已在 Step 4 启动（`node scripts/serve-export.cjs`）；若服务未启动，编辑器顶部显示红条提示
2. 用户在编辑器里点「导出 PPTX/PDF」→ 产物写到 `<项目目录>/output/deck.pptx` / `deck.pdf`
3. 服务端口冲突时用 `editor.html?port=<端口>` 覆盖（服务端同样 `--port <端口>`）

> 导出引擎：`vendor/html-deck-to-pptx`（逐节点保真回退链——可映射的 DOM 转成可编辑形状，
> 映射不了的区域截图但文字从实时 DOM 抽回保持可编辑）。图片内联 base64，成品不依赖素材路径。
> 与 build.js 的区别：build.js 产出**原生全形状** .pptx（渐变/装饰降级为形状），
> 一键导出产出**高保真视觉** .pptx（复杂视觉截图保真，文字可编辑）。两种路径互补，按需选用。

### Step 5：用户确认后编译
**用户说"满意了/可以了/导出吧/生成 pptx"**，再执行：
```bash
node scripts/build.js --project <项目目录> -o <项目目录>/output/最终.pptx
# 内部先 lint（配色/溢出/母版区/Hero 锚点）后渲染，lint 失败不输出
# lint 报错须先修复页面定义再重跑，不可跳过
```

> **双引擎视觉**（v1.1+）：页面 DSL 支持增强元素 `gradientBar/glowOrb/decoBlock/kpiBlock`，
> HTML 预览/编辑器用 CSS 完整呈现（渐变/光晕/网格纹理）；`build.js` 导出 .pptx 时降级映射
> 为原生形状（渐变→双层矩形、光晕→多层半透明椭圆、装饰→透明圆角块）。
> 主题由 `page.theme` 或 `design.json.theme` 引用，增强视觉语言来自 `scripts/visual/themes.js`。

### Step 6：交付
用面向用户语言说明主题、页数、风格要点，提示 .pptx 与 editor.html 路径。
告诉用户 editor.html 可反复修改后重新编译。

## 预设风格（references/designs/）

| 风格 | 调性 | 适用 | 硬闸门 |
| --- | --- | --- | --- |
| academic | 可信/蓝白克制/证据驱动 | 答辩、科研、医学汇报、课题 | 14 条 |
| consulting | 权威/数据密集/Action Title | 行研、投行、高管汇报 | 17 条 |
| redgold | 庄重/红金/中文优先 | 党政、国企、党课、表彰 | 18 条 |

命中规则：场景**明确且典型**属于某领域 → 用预设；模糊/跨领域/通用场景（产品介绍、工作总结、述职、培训）→ 通用设计原则。

## 页面定义 DSL 速查

```js
module.exports = {
  id: 'slide_01_cover', type: 'cover', role: 'hero', background: '#FFFFFF',
  elements: [
    { type: 'text', x: 80, y: 220, w: 900, h: 120, text: '主标题', fontSize: 64, bold: true, color: '#0F172A' },
    { type: 'rect', x: 80, y: 360, w: 120, h: 8, fill: '#3B82F6' },
    { type: 'roundRect', x: 600, y: 200, w: 400, h: 300, fill: '#F8FAFC', radius: 16 },
    { type: 'chart', x: 80, y: 150, w: 700, h: 400, chartType: 'bar',
      labels: ['Q1','Q2'], series: [{name:'2025', values:[30,45]}], colors: ['#3B82F6'] },
    { type: 'table', x: 80, y: 150, w: 800, h: 300, zebra: true,
      rows: [[{text:'指标',bold:true},{text:'2025'}],['满意度','98.6%']], colW: [200,150] },
  ],
};
```

元素：text（runs 富文本）/ rect / roundRect（radius）/ ellipse / line / image / chart（bar/line/pie/doughnut/area，barDirection/grouping）/ table（zebra 斑马纹）。
坐标系 1280×720 逻辑 px，自动映射真实幻灯片；字号自动 shrink 防溢出。

## 命令速查

```bash
node scripts/build.js --project <目录> -o <输出.pptx>    # 编译（含 lint）
node scripts/build.js --project <目录> --lint-only       # 只校验
node scripts/preview.js --project <目录>                 # 翻页式 HTML 预览
node scripts/render-editor.js --project <目录>           # 交互式编辑器（拖拽/改字/图表强调/一键导出）
node scripts/serve-export.cjs [--port 47832]             # 一键导出服务（编辑器导出按钮的后端）
node scripts/profile_template.js <模板.pptx> -o design.json  # 模板风格分析
node scripts/extract_assets.js <材料.docx> -o resources/images # 材料图片提取
```

## 与其它 PPT skill 的分工

| skill | 场景 | 产物 |
| --- | --- | --- |
| **pptx-designer**（本） | 从零设计、模板模仿、强规则 | 原生 .pptx |
| dashiai-ppt | 快速拼装、12 套 HTML 主题模板 | HTML + 导出 |
| pptx-from-layouts | 有现成模板母版 | 基于模板 .pptx |
| pptgen | 交互式 HTML 演示 | HTML |

## 参考文档

- `references/methodology.md` — **PPT 制作方法论**（五步流程 + 每页六要素 + 决策矩阵）
- `references/layout-library.md` — 布局模式库（17 种，AI 按内容选版式）
- `references/design-principle.md` — 通用设计法则（母版/色彩/字号/密度/配图/自检）
- `references/story-principle.md` — 叙事原则（意图对齐/骨架/大纲/版式速查）
- `references/component-guide.md` — 元素 API 速查
- `references/layout-patterns.md` — 配图版式库（P1-P10）
- `references/designs/academic.md` / `consulting.md` / `redgold.md` — 领域预设风格
- `references/designs/dashiai-styles.md` — dashiai 12 套风格色板
