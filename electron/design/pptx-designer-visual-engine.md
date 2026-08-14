# pptx-designer 双引擎视觉升级设计（HTML 预览 + 原生导出）

> 目标：让 pptx-designer 的视觉冲击力逼近 dashiai-ppt 的 12 套主题，同时保持原生 .pptx 可编辑。
> 现状：pptx-designer 只有"数据驱动页面 → 原生 .pptx"一条链路，预览/编辑器是纯色块版式快照，缺少渐变、装饰、主题切换等视觉语言。

## 1. 核心思路（双引擎）

不再把"HTML 预览"当成 .pptx 的弱副本，而是把它当作**视觉完整引擎**（CSS 渐变/装饰/网格纹理/光效全部呈现），导出 .pptx 时把 HTML 能表达、PowerPoint 也能表达的视觉**降级映射**为原生形状。

```
页面定义 DSL (pages/*.js + design.theme)
        │
        ├─▶ preview.js        — HTML 翻页预览（CSS 全视觉：渐变/装饰/网格）
        ├─▶ render-editor.js  — HTML 交互编辑器（同引擎 + 主题下拉切换 + 实时改）
        └─▶ build.js          — 原生 .pptx（渐变→pptgenjs fill.gradient，装饰→绝对定位 shape + 透明度）
```

三者共享同一个 **视觉引擎模块** `visual/theme.js`（主题定义 + 装饰渲染），消除目前 preview/render-editor/build 三处 `elHtml` 重复。

## 2. 主题系统

### 2.1 主题定义（theme.js 内置，数据驱动）

基于 dashiai 12 套风格 DNA + 现有 3 领域预设，抽象为统一 schema：

```js
// visual/themes.js 导出 THEMES
{
  id: 'theme02',                 // dashiai 主题号，或 academic/consulting/redgold/generic
  name: '炫光紫绿风',
  dark: true,
  bg: '#07090B',                 // 画布背景
  palette: {
    primary: '#2FE07F', accent: '#4EA2FF', warn: '#FF6FAE',
    text: '#F8FAFC', sub: '#94A3B8', line: 'rgba(158,125,255,.35)'
  },
  font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
  texture: 'radial',             // 背景纹理：none | dot | grid | radial | noise
  decoration: {                  // 主题默认装饰（可被页面覆写）
    corner: 'glow',              // 角落装饰：glow | bar | none
    accentBar: { y: 'head', color: '#4EA2FF' },  // 强调色条
  },
  slideBundles: {
    cover: [...], catalog: [...], section: [...], content: [...], ending: [...]
    // 每类页面的装饰模板：封面大块衬底 + 主标题锚点 + 强调色条，内容页侧竖条 + KPI 色块等
  }
}
```

### 2.2 页面 DSF 扩展

```js
module.exports = {
  id: 'slide_01_cover', type: 'cover', role: 'hero',
  theme: 'theme02',            // 可选，缺省用 design.theme
  background: '#07090B',
  decoration: { corner: 'glow', accentBar: { y: 'head' } },  // 可选页级覆写
  elements: [
    // 原有 text/rect/chart/table/image ...
    // 新增增强元素：
    { type: 'gradientBar', x: 80, y: 360, w: 160, h: 8, from: '#2FE07F', to: '#4EA2FF' }, // 渐变条
    { type: 'glowOrb', x: 900, y: 60, r: 220, color: '#9B7DFF', blur: 80 },             // 光晕（HTML），pptx 降级为椭圆低透明
  ],
}
```

### 2.3 新增元素类型 → HTML/PPTX 双实现

| 元素 | HTML 预览（CSS） | .pptx 降级映射（pptgenjs） |
|---|---|---|
| `gradientBar` | `linear-gradient` | `fill:{type:'gradient'}` 或两个矩形半透明叠 |
| `glowOrb` | `radial-gradient + box-shadow` 光晕 | 椭圆 + 高透明度 + 多层同心叠加 |
| `decoBlock` | 半透明装饰块 `rgba()` | 矩形 + `fill:{transparency}` |
| `dotGrid` / `grid` | `background-image` 点/网格 | **跳过**（pptx 无能力）或用细线近似 |
| `kpiBlock` | 色块衬底 + 大数字 | 矩形衬底 + 文本 |
| `bgTexture` | `background` 径向/渐变 | `slide.background = {color}` 纯色或浅渐变 |

**原则**：HTML 是完整视觉（含 glowOrb/dotGrid 等 pptx 表达不了的效果），.pptx 是"可编辑且尽量逼近"（能映射的映射，不能的降级为纯色/半透明块/跳过）。

## 3. 三引擎统一

### 3.1 新建共享模块 `visual/`

```
scripts/../visual/
├── themes.js     # 12 套 dashiai + 3 领域 + generic 主题定义
├── elHtml.js     # 单元素 → HTML（含增强元素，preview + editor 共用）
└── pptxEl.js     # 单元素 → pptxgenjs slide（含渐变/装饰降级，build 共用）
```

- preview.js / render-editor.js 改 require `visual/elHtml.js`（替代各自内置 elHtml）
- build.js 改 require `visual/pptxEl.js`
- **消除三处 elHtml 重复**，视觉逻辑单点维护

### 3.2 preview.js：支持主题切换

- 读 `design.theme` 或页面 `page.theme` → 应用主题 CSS 变量
- **顶部加主题下拉**（类似 dashiai 预览页），可实时切换 12+3 主题预览视觉
- 生成 `.theme-deco` 层（用 slideBundles 装饰模板）垫在元素下层

### 3.3 render-editor.js：主题下拉 + 装饰渲染

- 工具栏加**主题下拉**，切换重建画布
- 画布渲染同 preview 视觉引擎（渐变/装饰/光晕都在编辑器里看到）
- 属性面板加：元素渐变起止色、装饰开关；页面级覆盖 theme
- 导出仍产 deck.json / pages·js + design.json（含 theme 字段）

### 3.4 build.js：降级映射 + lint

- 新增元素渲染到 pptxgenjs（gradientBar→渐变 fill，glowOrb→半透明椭圆，decoBlock→透明矩形）
- lint 新增：渐变元素 from/to 必须在主题 palette 或 design 色板内；装饰块不遮挡母版区文字
- 保证 .pptx 仍可被 WPS/Office 打开编辑

## 4. 工作流改动（SKILL.md）

在标准流程 STEP 2（DESIGN.md）增加"主题选择"：
- 需求匹配 dashiai 12 套风格 → 用该主题 ID（复用 dashiai-styles.md 路由表）
- 学术/咨询/政务 → 领域主题
- 通用 → 默认商务浅色（generic）
页面定义时通过 `theme` 字段引用，preview 可一键换主题比较。

## 5. 修改文件清单

| 文件 | 改动 |
|---|---|
| `scripts/visual/themes.js` | 新建，主题库（12+3+generic） |
| `scripts/visual/elHtml.js` | 新建，统一 HTML 元素渲染（含增强元素） |
| `scripts/visual/pptxEl.js` | 新建，统一 pptxgenjs 元素渲染（含渐变/装饰降级） |
| `scripts/preview.js` | 改用 visual/elHtml，加主题下拉 + 装饰层 |
| `scripts/render-editor.js` | 改用 visual/elHtml，加主题下拉 + 属性面板扩展 |
| `scripts/build.js` | 改用 visual/pptxEl，加新元素 + lint |
| `SKILL.md` | 设计流程加主题选择步骤 |
| `references/designs/dashiai-styles.md` | 保持（作为主题文档基线，与 themes.js 同步） |

## 6. 验证

1. demo 项目（封面+目录+2 内容+ending）选 theme02 → preview.html 换主题看 4 种以上视觉差异
2. render-editor 打开同项目：主题下拉切换、渐变条/光晕实时改
3. build.js 编译 → .pptx 在 WPS/Office 打开：渐变/装饰块可见、文字不重叠、可编辑
4. 截图对比 HTML 预览 vs .pptx 视觉一致性（接受 pptx 降级的合理偏差）
5. lint 通过：渐变元素配色校验、装饰不遮挡文字

## 7. 风险与对策

- **pptx 无渐变纹理/光晕/网格**：HTML 完整呈现，pptx 降级为半透明块/纯色/跳过，预览注明"导出为降级视觉"
- **主题切换改变版式**：主题只改色板/装饰/背景，不改母版坐标，避免换主题后布局错乱
- **三处逻辑重复**：已用共享 visual/ 模块消除，后续改视觉只动一处
- **渐变透明在 pptx**：pptgenjs 渐变支持有限，用多矩形低透明度叠加近似，必要时降级纯色
