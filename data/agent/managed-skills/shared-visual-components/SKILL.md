---
name: shared-visual-components
description: "共享视觉组件库：canvas-design / pptgen / craftman 共用的 HTML/CSS 组件与主题。AI 做任何视觉设计（海报/落地页/演示文稿/数据看板）时，必须从本组件库选组件拼装，禁止从零手写 CSS。"
name_cn: "共享视觉组件库"
description_cn: "统一视觉设计底座：12 套主题 + 18 个组件 + 5 个布局模板。任何视觉产出（海报、交互式 HTML、演示文稿、数据看板）先查本库，有现成组件就用，没有才手写。"
---

# 共享视觉组件库

## 核心原则

**AI 不写 CSS，只做「选 + 拼 + 调」。**

视觉设计的质量瓶颈不在 AI 创意，而在 CSS 手写的一致性。本库提供现成的主题、组件、布局模板，AI 的职责是：
1. 从 `registry.json` 选合适的零件
2. 复制组件到目标 HTML
3. 替换占位符（{TITLE}、{SUBTITLE} 等）
4. 微调（改颜色变量、字号、间距）

## 目录结构

```
$PORTABLE_ROOT/data/agent/managed-skills/shared-visual-components/
├── registry.json        # 组件注册表（AI 选组件先读这个）
├── core/                # 基础层：reset / variables / utils
├── themes/              # 12 套主题 CSS（data-theme 切换）
├── components/          # 组件：card / grid / hero / data / nav / text / footer
├── effects/             # 特效：动画 / 背景 / 交互
├── layouts/             # 布局模板：海报 / 落地页 / 演示文稿 / 仪表盘
├── fonts/               # 字体（可选离线下载）
└── tools/               # 工具脚本（html2png 等）
```

## 使用流程（三步拼装）

### 第 1 步：选布局

读 `registry.json` 的 `layouts` 列表，按需求选：

| 需求 | 布局 |
|------|------|
| 社交海报/宣传图 | `poster-1080x1440`（3:4 竖版） |
| 手机壁纸/朋友圈 | `poster-1080x1920`（9:16） |
| 单页介绍/产品页 | `landing-page` |
| 多页演示/交互式网页 | `presentation` |
| 数据展示/看板 | `dashboard` |

### 第 2 步：选主题

读 `registry.json` 的 `themes` 列表，在 `<body>` 设置 `data-theme="<主题id>"`：

```html
<body data-theme="aurora">
```

主题通过 CSS 变量自动换肤，所有组件适配。

### 第 3 步：拼组件

读 `registry.json` 的 `components` 列表，把需要的组件片段复制进布局：

```html
<!-- 例：毛玻璃卡片区 -->
<section class="cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--space-md);">
  <div class="glass card">...</div>
</section>
```

## 引入方式

每个 HTML 必须引入 core 三件套 + 一个主题：

```html
<link rel="stylesheet" href="{BASE}/core/reset.css">
<link rel="stylesheet" href="{BASE}/core/variables.css">
<link rel="stylesheet" href="{BASE}/core/utils.css">
<link rel="stylesheet" href="{BASE}/themes/{THEME}.css">
<body data-theme="{THEME}">
```

其中 `{BASE}` 是组件库根目录（`$PORTABLE_ROOT/data/agent/managed-skills/shared-visual-components`），`{THEME}` 是主题 id（如 `aurora`）。

## 组件清单（18 个）

| 分类 | 组件 | 场景 |
|------|------|------|
| card | glass-card / neumorphic-card / gradient-card | 内容块、特性展示 |
| grid | bento-grid / masonry | 多内容布局、图片墙 |
| hero | particles-hero / gradient-hero / waves-hero | 封面、首屏 |
| data | stat-card / chart-container / progress-bar | 数据展示、图表 |
| nav | tabs / progress-dots | 分类切换、步骤指示 |
| text | gradient-text / typing-effect / reveal-text | 标题、动态文字 |
| footer | social-footer | 页脚 |

## 特效库（11 个）

- **动画**：fade-in / slide-up / pulse / float / shimmer
- **背景**：mesh-gradient / noise-texture / geometric-pattern
- **交互**：magnetic-btn / tilt-card / ripple-click

## 给 canvas-design 的覆盖指令

canvas-design SKILL.md 的"设计哲学"阶段保留（保证艺术性），但 **CANVAS CREATION 阶段必须改用本组件库**：
1. 先读 `registry.json` 选组件
2. 用 `layouts/` 模板做骨架
3. 用 `themes/` 换肤
4. 只在现有组件无法满足需求时，才手写少量补充 CSS

## 给 craftman 的覆盖指令

craftman 编排时，交互式 HTML 的产出路径改为：
1. AI 读 `skill://shared-visual-components` 选布局+主题+组件
2. AI 拼装完整 HTML 到 `<cwd>/.craftman/cover.html`（或直接输出）
3. 不再依赖 pptgen 的模板引擎（除非用户明确要 pptgen 风格）
