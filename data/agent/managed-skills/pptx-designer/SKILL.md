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

> **管线声明**：本技能是大技能 `skill://ppt` 的「从零设计」管线。被大技能委托时跳过需求澄清（Step0-1 由大技能完成），直接进入主题确认与设计。

# pptx-designer

数据驱动页面定义 → `build.js` 编译原生 .pptx + lint 规则校验 → HTML 版式快照预览。

## 依赖准备（install.ps1 已预装）

技能依赖（react/react-dom/playwright-core/pptxgenjs/pdf-lib/pngjs/html-to-image/gsap）由 **`install.ps1` 第 6 步自动安装**；整包拷贝时 `node_modules/` 随包带走，内网即拷即用。

若 `node_modules/` 缺失（如拷贝时未包含），需联网手动安装：

```bash
cd data/agent/managed-skills/pptx-designer
npm install    # 自动命中仓库根 .npmrc 国内镜像（npmmirror）
```

- **依赖检查**：执行任务前先确认 `node_modules/` 存在；缺失时联网机器先 npm install，内网机器直接拷贝联网机器的 `node_modules/` 目录，不要硬跑脚本
- **导出浏览器**：一键导出依赖系统 Edge/Chrome（`launch-export-browser` 自动探测），Windows 一般自带
- **模板目录重建**（可选）：`build-layout-catalog.cjs` 重建 layout-catalog.md 需要 dashiai-ppt 技能在场；日常流程不需要，目录产物已入库

## 快速导航

| 任务 | 执行路径 |
| --- | --- |
| 从零创建 PPT（有文字稿） | 标准流程 Step 1 起 |
| 从零创建 PPT（只有主题） | Step 0 文字稿 → 标准流程 |
| 上传模板模仿风格 | Step 2 主题逆向 → 标准流程 |
| 上传材料（docx/pdf/pptx）生成 | Step 0 材料提取 → 标准流程 |

## 需求澄清（钩子模式，必须执行）

**制作前必须用 ask 工具确认以下事项，不得跳过**（用户已明确指定的除外）：

| 必问项 | 选项 | 默认 |
| --- | --- | --- |
| **① 文字稿有没有** | 已有文字稿直接给 / 只有主题要 AI 先出文字稿 / 上传材料 | 先出文字稿 |
| **② 图片怎么来** | 用户提供素材 / AI 生图（image-gen-router）/ 先用占位（后补图）/ 纯图表不用图 | 先用占位 |

其他澄清规则：受众/场合影响表达则轻问 1 次；页数在**大纲确认**时由用户定（默认 10-15 页不问）；演讲者备注默认不写不问。
主题选择**不在制作前问**，在大纲确认后（Step 2）问。
用户说"直接做/你决定/看着办"或信息完整 → 跳过反问。**禁止多轮追问**。沟通用「页/封面/目录/这一页」术语，不暴露内部实现。
## 项目目录约定（必须遵守）

所有产物**必须**放在项目目录下，禁止散到 /tmp 或其他位置。

```
<项目目录>/
├── OUTLINE.md               # 大纲（每页含布局类型，用户确认后定稿）
├── STORY.md                 # 叙事逻辑（大纲前置分析，可并入 OUTLINE.md）
├── DESIGN.md                # 细化设计稿（每页文字内容/分布/卡片/图片数）
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

## 标准流程（内容优先，用户确认制）

> **第一原则（不可违背）——内容优先**：内容是汇报材料，绝不妥协。
> 模板只是加强视觉的手段：按内容选模板，没有合适模板就手搓。
> **禁止为了套模板删减、扭曲、拼接内容**——手搓是正常路径，不是降级。
> **第二原则**：关键节点用户确认制——**大纲确认 → 主题确认 → 导出确认**，三步缺一不可。

### Step 0：文字稿（可跳过——用户已给文字稿或内容已明确）

**用户只有主题、没有文字稿**：
- 用内容生成能力（如 deep-research 等技能）检索资料产出文字稿，或 ask 用户是否先出文字稿
- 文字稿是后续一切的基础，**不允许在没有文字稿的情况下直接进入大纲**

**用户上传了材料（docx/pdf/pptx）**：
- 图片提取：`node scripts/extract_assets.js <材料.docx> -o resources/images`
- 文本内容用 read 工具直接读取文档，不反复提取

### Step 1：大纲（OUTLINE.md，每页含布局类型）→ 用户确认

阅读 `references/story-principle.md` 组织叙事，生成 OUTLINE.md，**每一页必须标注**：
- 页面定位（封面/目录/章节/内容/结束）
- 内容类型（KPI/对比/流程/图片/观点/列表…）
- 布局类型（L-*，从 `references/layout-library.md` 选）
- 一页装不下 → 标记拆页（如 5a/5b）
- 本页要传达的结论（一句话）

**生成后必须 ask 用户确认**：页数是否合适（可增删，如 14 页调到 39 页）、结构是否合理。
**用户确认前不得进入下一步**。

### Step 2：主题选择 → 用户确认

按顺序：
1. **用户已指定主题** → 直接用
2. **上传了模板 PPTX** → `node scripts/profile_template.js <模板.pptx> -o design.json` 逆向色板/字体/风格，作为基线
3. **未指定** → 按场景推荐（`references/designs/dashiai-styles.md` 12 套 / 领域预设 academic/consulting/redgold），ask 用户确认

主题确定后写 design.json（色板 ≤4 hex、字体 ≤2、主题 ID）。
**风格统一纪律**：全篇一套色板 + ≤2 字体；风格只约束视觉语言，**不约束布局**（布局永远由内容决定）。

### Step 3：细化设计稿（DESIGN.md）

读 `references/methodology.md` §四 决策矩阵 + `references/design-principle.md`，每页声明：
- **本页结论**（一句话，说不清这页不过）
- **文字内容与分布**：标题/正文/数字，哪些字放哪块区域
- **卡片格式**：几块卡片/色块/列表/表格，内容怎么装
- **图片张数与图位**：0-4 张，先定图位再组织文字
- **强调用法**：全局色调下强调色用在哪（某数字/某系列/某色块）
- **拆页落实**：Step 1 标记拆页的页在此展开为两页，各写清内容
- 配图清单：需生图的先走 image-gen-router 出图到 resources/images/

### Step 4：页级模板匹配（目录查模板，无合适就手搓）

按 `references/taxonomy.md` 四层检索（L1→L2→L3→L4，强制，每页候选 3-8 个）：
1. **L1 定位**：封面/目录/章节/结束 → 直接查对应类
2. **L2 内容类型**：正文页按内容定位到 19 类
3. **L3 布局族**：按版式需求选族（纯文字/多卡片/并列/流程/总分/左图右文/图表/大数字/金句/时间轴/画廊/排行表格）——**相邻页防撞**：排除上一页已用 L3 族，全被排除才回退（须换 L4 模板）
4. **L4 候选**：按卡数/图数/容量匹配，同类多选一（保证页标题等一致性）
查不到合适 → 手搓 DSL（正常路径）。
**红线**：模板与内容冲突时，改模板或手搓，**绝不改内容**；优先在所选主题内选；同 slot 多主题成套（theme01_page006 ↔ theme02_page006）

### Step 5：逐页生成页面定义

- 引用模板的页：`{ layout: 'themeXX_pageNNN', data: {...} }`，按模板字段要求填内容
- 手搓页：对照 DESIGN.md 写 DSL（元素：text/rect/roundRect/ellipse/line/image/chart/table + 增强元素）
- 动笔前读 `references/component-guide.md`（API 速查）+ `references/layout-patterns.md`（配图版式库）
- 动笔自检 10 条硬约束（design-principle.md §7），任一不过返工

### Step 6：生成编辑器与预览 + 导出服务

```bash
node scripts/render-editor.js --project <项目目录>   # → output/editor.html（左侧缩略图/翻页器/浏览器端导出/layout 字段面板）
node scripts/preview.js --project <项目目录>         # → output/preview.html
node scripts/serve-export.cjs   # 可选：服务端导出（浏览器端已可直接导出，服务在线时自动优先）
```
把 editor.html 给用户打开，让用户在编辑器里**改字/换主题/调布局/加删元素**。
> 编辑器「导出 PPTX/PDF」**浏览器端直接完成**（内置 editable-pptx-browser 引擎），无需启动服务；serve-export.cjs 在线时自动走服务端路径。layout 模板页右侧有字段面板（改重点/条块数/图片数/主题色）。
> 不要替用户编译 .pptx！用户还没改过，编译了也是废的。

> 导出引擎：`vendor/html-deck-to-pptx`（逐节点保真回退链——可映射的 DOM 转成可编辑形状，
> 映射不了的区域截图但文字从实时 DOM 抽回保持可编辑）。图片内联 base64，成品不依赖素材路径。
> 与 build.js 的区别：build.js 产出**原生全形状** .pptx（渐变/装饰降级为形状），
> 一键导出产出**高保真视觉** .pptx（复杂视觉截图保真，文字可编辑）。两种路径互补，按需选用。

### Step 7：用户确认后编译

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

### Step 8：交付

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

### 模板页（layout）DSL

```js
// 引用页级模板（从 references/layout-catalog.md 选）——无需 elements，按模板字段填 data
module.exports = {
  id: 'slide_02_bignum', type: 'content', role: 'content',
  layout: 'theme01_page006',   // themeXX_pageNNN，同 slot 多主题成套
  data: {                        // 字段参考主题默认内容（layout-catalog.md 每项含字段清单）
    kicker: '2025 全年 · 中国市场 AI 融资',
    value: '1820', unit: '亿元',
    sub: '连续三年高速增长，占全市场融资四分之一。',
    highlightWord: '四分之一',
    secondaries: [
      { value: '210', unit: ' 笔', label: '单笔 ≥ 10 亿元事件' },
      { value: '8.7', unit: ' 亿', label: '平均单笔融资额' },
    ],
    caption: '大数字 · 市场体量一览',
  },
};
```

- layout 页由 dashiai 主题运行时（`vendor/theme-runtime/`）服务端渲染，编辑器/预览/导出一致呈现
- `data` 覆盖模板默认内容（defaultProps），未填字段用模板默认值；数据字段必须取自 layout-catalog 字段清单
- 导出行为：模板页高保真呈现，核心文本（标题/主数字/说明）可编辑，其余视觉区域以图片保真

## 命令速查

```bash
node scripts/build.js --project <目录> -o <输出.pptx>    # 编译（含 lint）
node scripts/build.js --project <目录> --lint-only       # 只校验
node scripts/preview.js --project <目录>                 # 翻页式 HTML 预览
node scripts/render-editor.js --project <目录>           # 交互式编辑器（拖拽/改字/图表强调/一键导出）
node scripts/serve-export.cjs [--port 47832]             # 一键导出服务（编辑器导出按钮的后端）
node scripts/build-layout-catalog.cjs                     # 重新生成页级模板目录（layout-catalog.md）
node scripts/profile_template.js <模板.pptx> -o design.json  # 模板风格逆向
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

- `references/methodology.md` — **PPT 制作方法论**（内容优先五要素 + 决策矩阵 + 模板匹配原则）
- `references/layout-library.md` — 布局模式库（L-* 模式，大纲阶段选）
- `references/layout-catalog.md` — **页级模板目录**（1020 个布局，设计阶段按内容选模板）
- `references/design-principle.md` — 通用设计法则（母版/色彩/字号/密度/配图/自检）
- `references/story-principle.md` — 叙事原则（意图对齐/骨架/大纲/版式速查）
- `references/component-guide.md` — 元素 API 速查
- `references/layout-patterns.md` — 配图版式库（P1-P10）
- `references/designs/academic.md` / `consulting.md` / `redgold.md` — 领域预设风格
- `references/designs/dashiai-styles.md` — dashiai 12 套风格色板
