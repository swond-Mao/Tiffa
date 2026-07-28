---
kind: frontend_style
name: Tiffa 桌面端主题与样式系统
category: frontend_style
scope:
    - '**'
source_files:
    - electron/renderer/styles.css
    - electron/renderer/themes.js
    - electron/renderer/index.html
    - electron/package.json
---

## 样式架构概述

Tiffa 的 UI 基于 Electron 渲染进程，采用 **HSL Token + CSS 变量** 的主题系统，完全移植自 OpenCodeUI。所有颜色通过运行时注入的 CSS 变量控制，支持 7 套预设主题 × 3 种模式（light/dark/system）。

## 核心文件与职责

- `electron/renderer/styles.css` — 全局样式表，定义 HSL Token 变量、布局、组件样式
- `electron/renderer/themes.js` — 主题引擎，管理 7 套预设配色和动态切换逻辑
- `electron/renderer/index.html` — 渲染入口，引入样式和脚本
- `electron/package.json` — Electron 应用配置，依赖 highlight.js、marked、yaml

## 设计令牌体系

### HSL Token 命名规范
```css
:root {
  /* 背景色阶：bg-000 ~ bg-400 */
  --bg-000: 210 20% 18%;
  --bg-100: 210 20% 14%;
  --bg-200: 210 20% 11%;
  --bg-300: 210 20% 9%;
  --bg-400: 210 25% 6%;
  
  /* 文本色阶：text-000 ~ text-600 */
  --text-000: 0 0% 100%;
  --text-100: 210 15% 92%;
  --text-200: 210 10% 70%;
  --text-300: 210 8% 55%;
  --text-400: 210 8% 40%;
  --text-500: 210 6% 32%;
  --text-600: 210 10% 25%;
  
  /* 强调色：brand/main/secondary */
  --accent-brand: 165 50% 55%;
  --accent-main-000: 165 45% 45%;
  --accent-main-100: 165 50% 55%;
  --accent-main-200: 165 55% 65%;
  --accent-secondary-100: 200 50% 60%;
  
  /* 语义色：success/warning/danger/info */
  --success-100: 140 50% 55%;
  --warning-100: 35 80% 60%;
  --danger-000: 5 65% 60%;
  --info-100: 200 60% 65%;
}
```

### 兼容层设计
为保持向后兼容，themes.js 自动生成旧版 hex 变量别名：
```css
--bg-primary: hsl(var(--bg-200));
--text-primary: hsl(var(--text-100));
--accent: hsl(var(--accent-main-000));
--border: hsl(var(--border-200));
```

## 主题预设系统

### 内置 7 套主题
| 主题 | 风格描述 | 主色调 |
|------|----------|--------|
| Eucalyptus | 莫兰迪桉树绿，清爽冷静 | 绿色系 |
| Claude | 暖调橙色品牌风格 | 橙色系 |
| Breeze | 冷调青绿护眼 | 青色系 |
| Sakura | 粉白色系，温柔暖调 | 粉色系 |
| Ocean | 深蓝白色系，沉稳专注 | 蓝色系 |
| Dracula | 官方 Dracula 预设 | 紫色系 |
| Obsidian | 纯黑高对比紫灰 | 黑白灰 |

### 模式切换机制
- **system**: 跟随系统偏好（`prefers-color-scheme`）
- **light/dark**: 强制浅色或深色模式
- 支持运行时监听系统主题变化自动切换

## 布局与组件约定

### 三栏布局结构
```html
<div id="app">
  <aside id="projectPanel"> <!-- 左侧项目栏 --> </aside>
  <div id="mainArea">
    <header id="titlebar"> <!-- 顶栏 --> </header>
    <div id="sessionTabBar"> <!-- 会话标签栏 --> </div>
    <div id="main-layout">
      <main id="chatPanel"> <!-- 聊天面板 --> </main>
      <aside id="sidebar"> <!-- 右侧文件侧边栏 --> </aside>
    </div>
  </div>
</div>
```

### 组件样式规范
- **按钮**: `.btn-*` 类名，统一 36px 尺寸，圆角 6px
- **面板**: 使用 `hsl(var(--bg-100))` 作为背景，`hsl(var(--border-200))` 作为边框
- **交互状态**: hover 使用 `hsl(var(--bg-300))`，active 使用强调色
- **阴影**: `--shadow-sm/md/lg` 三级阴影，随主题 alpha 变化

## 响应式策略
- 使用 CSS Flexbox 实现自适应布局
- 侧边栏支持折叠/展开动画（`transition: width 0.15s ease`）
- 文件树支持嵌套缩进和拖拽调整宽度
- Minimap 消息密度滚动条提供快速导航

## 开发约束与最佳实践

### 颜色使用规范
1. **禁止硬编码颜色值**，必须使用 CSS 变量
2. 背景色按层级选择 `bg-100/200/300/400`
3. 文本色按层级选择 `text-100/200/300/400`
4. 语义化颜色优先使用 `success/warning/danger/info`

### 主题扩展指南
1. 在 `themes.js` 中新增 ThemeColors 对象
2. 遵循 background/text/accent/semantic/border/special 结构
3. 同时定义 light 和 dark 两套配色
4. 在 THEME_PRESETS 数组中注册新主题

### 样式组织原则
- 全局变量集中在 `:root` 伪类
- 组件样式按功能模块分组注释
- 使用 BEM 命名约定（block__element--modifier）
- 动画过渡统一使用 0.15s 缓动时间

## 技术栈依赖
- **Electron**: 桌面应用框架
- **highlight.js**: 代码语法高亮
- **marked**: Markdown 解析
- **Bun**: JavaScript 运行时（内核子进程）
- **CSS Variables**: 主题变量系统
- **Flexbox**: 现代布局方案