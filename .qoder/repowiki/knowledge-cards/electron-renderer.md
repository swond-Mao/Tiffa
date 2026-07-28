# 知识卡：渲染进程

## 模块标识

- **路径**: `electron/renderer/app.js`（5008 行）+ `themes.js`（676 行）+ `styles.css`（2846 行）+ `index.html`
- **运行环境**: Chromium 渲染进程（无 Node 访问，通过 preload 桥接）
- **职责**: 聊天 UI、事件渲染、输出后处理、主题系统、文件/Todo/预览侧栏

## 核心模块

### 输出后处理
- `fixBareUrls()` — 裸 URL 链接化 + file:/// → tiffa-local:// + Windows 路径自动链接
- `fixCodeBlockLanguages()` — 无标注代码块语言推断（inferCodeLanguage）
- `applyOutputFixes()` — 统一入口

### 事件渲染
通过 `tiffaDesktop.onEvent(callback)` 接收内核事件，流式渲染 text_delta、ToolCard、Diff 视图。

### 主题系统（themes.js）
- 7 套预设 × light/dark：Eucalyptus / Claude / Breeze / Sakura / Ocean / Dracula / Obsidian
- 颜色格式：HSL 无包装（`'210 20% 18%'`），CSS 用 `hsl(var(--bg-200))`
- 注入方式：JS 动态生成 `<style>` 到 `:root`
- 3 种模式：light / dark / system（prefers-color-scheme）

### 全局状态
```javascript
state = {
  tiffaReady, agentRunning, lastEventTime,
  stallCheckTimer, firstResponseTimer, receivedFirstResponse
}
```

## 关键机制

| 机制 | 说明 |
|------|------|
| Stall 检测 | 3 分钟无事件 → 提示 + steer |
| ToolCard 摘要 | summarizeToolCall() 按工具类型生成图标+标题 |
| Diff 视图 | extractDiff() + renderDiffView() 红绿对比 |
| 模型切换 | 37 供应商预设 + 2步发现向导 + 快速浮层 |
| 会话管理 | 项目侧栏 + 标签页 + 归档/恢复/导出 HTML |
| localStorage 迁移 | omp-* → tiffa-* 前缀自动迁移 |

## 依赖关系

- 上游：`preload.js` 暴露 `window.tiffaDesktop` API
- 数据源：主进程转发的 `tiffa:event` 事件流
- 渲染库：marked（Markdown）+ highlight.js（代码高亮），在 preload 中配置

## 修改注意

- 此文件 5008 行，是最大单文件，内聚性强，不要与 main.js 合并分析
- 主题颜色修改在 themes.js 的预设对象中
- 新增 IPC 调用需确认 preload.js 已暴露对应方法
- CSS 变量命名规范：`--{category}-{level}`（如 `--bg-200`, `--text-100`）
