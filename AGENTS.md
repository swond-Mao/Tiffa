# AGENTS.md — Tiffa v4.0 项目规范

## 项目概述

oh-my-tiffa：基于 `@oh-my-pi/pi-coding-agent` v17.0.7 的便携 AI 编程助手，搭载 Claude 化扩展 (v4.0) + Electron 桌面前端 (v1.5)。

**v4.0 核心理念**：从"补完 omp"变成"搭 omp 的车"。扩展只保留 omp 原生不覆盖的功能，其余全部交给 omp。

## 关键路径

| 路径 | 说明 |
|------|------|
| `G:\oh-my-pi\` | 便携包根目录 |
| `npm-global\node_modules\@oh-my-pi\pi-coding-agent\` | omp 核心 (v17.0.7) |
| `npm-global\node_modules\bun\bin\bun.exe` | Bun 运行时 (v1.3.14) |
| `python\python.exe` | Python 解释器 |
| `node\node.exe` | Node.js 运行时 |
| `data\agent\` | 配置目录 (config.yml, models.yml, projects.json) |
| `data\agent\rules\` | TTSR 规则目录（10 条，零 context 成本约束） |
| `data\memory\` | 长期记忆目录 (constraints.md, inbox/) |
| `plugins\claude-mode-extension.ts` | Claude 化扩展 (v4.0, 482 行) |
| `skills\` | 专业技能目录 (18 个 skill) |
| `workspace\` | 工作区根目录 |
| `omp-desktop.exe` | 桌面启动器 (C# winexe) |

## 启动方式

| 方式 | 命令/文件 | 说明 |
|------|---------|------|
| 桌面启动器 | `omp-desktop.exe` | 双击启动 Electron GUI，无控制台窗口 |
| VBS 启动器 | `omp-desktop.vbs` | 双击启动 Electron GUI（无编译依赖） |
| 批处理启动 | `start-desktop.bat` | 带 --portable-root 参数启动 Electron |
| TUI 模式 | `start-omp.bat --tui` | 终端交互模式 |
| WebUI 模式 | `start-omp.bat --web` | RPC-UI JSON 事件流 |

## 模型配置

### 云端模型 (models.yml)

| Provider | 模型 | 特点 |
|----------|------|------|
| kimi | kimi-k3 | 最新旗舰，262K 上下文，支持推理+视觉 |
| minimax | MiniMax-M3 | 100 万上下文 |
| xiaomi | mimo-v2-flash / mimo-v2-pro | 轻量快速 / 旗舰推理 |
| qwen | localmodel | 本地模型 (llama.cpp，通过 frp 中继) |

### 模型角色 (config.yml)

| 角色 | 模型 | 说明 |
|------|------|------|
| default | home-models/Qwen3.6-27B | 默认任务 |
| smol | home-models/Qwen3.6-27B | 轻量任务 |
| slow | kimi/kimi-k3 | 深度推理 |
| plan | kimi/kimi-k3 | 规划 |
| vision | kimi/kimi-k3 | 视觉理解 |
| commit | home-models/Qwen3.6-27B | 代码提交 |
| tiny | xiaomi/mimo-v2-flash | 最小模型 |

---

## 记忆系统：Mnemopi（v4.0 启用）

v4.0 起弃用手动 MEMORY.md/PROJECT.md 注入，改用 omp 内置 Mnemopi 语义记忆系统。

### 配置 (config.yml)

```yaml
memory:
  backend: mnemopi
  mnemopi:
    embeddingModel: "fast-bge-small-zh-v1.5"    # BAAI/bge-small-zh-v1.5 的缩写
    scoping: "per-project-plus-global"           # 项目库 + 全局库，项目优先
    autoRecall: true                             # 每轮自动召回相关记忆
    autoRetain: true                             # 自动保存重要内容
    retainEveryNTurns: 5                         # 每 5 轮自动 retain
    recallLimit: 10                              # 最多召回 10 条
    injectionTokenLimit: 2000                    # 注入上限 2000 token
```

### 作用域模式

| 模式 | 说明 |
|------|------|
| `global` | 全局共享，无项目隔离 |
| `per-project` | 按 CWD 隔离，项目间互不可见 |
| **`per-project-plus-global`** | 项目库 + 全局库，项目优先（当前使用） |

### 嵌入模型

- 缩写 `fast-bge-small-zh-v1.5` → `BAAI/bge-small-zh-v1.5`
- Tokenizer 文件缓存于 `local_cache/fast-bge-small-zh-v1.5/`
- 推理在 Bun 子进程 worker 中运行（CPU，非 GPU）
- 加载失败时 Mnemopi 优雅降级（不崩溃，但不记忆）

### 与旧方案对比

| 特性 | 旧方案 (v2.9) | Mnemopi (v4.0) |
|------|--------------|----------------|
| 搜索方式 | 正则 grep MEMORY.md | 语义向量搜索 |
| 项目隔离 | 手动 PROJECT.md | per-project scoping |
| 写入 | memory_write 工具 | autoRetain 自动 |
| 读取 | memory_search 工具 | autoRecall 自动 |
| 跨项目共享 | 无 | per-project-plus-global |
| 压缩恢复 | gap-fill 手动提取 | autoRecall + gap-fill |

---

## 三层约束体系（v4.0）

### 第 1 层：TTSR 规则（零 Context 成本）

规则目录：`data/agent/rules/`，流式匹配——模型输出时实时检测，违规立即拦截，不占 context token。

| 规则文件 | 拦截行为 | scope | interruptMode |
|----------|---------|-------|--------------|
| `no-bare-codeblock.md` | 代码块必须标注语言 | text | always |
| `no-filler-opening.md` | 禁止废话开头 | text | always |
| `no-xml-toolcall.md` | 禁止 XML 格式调用工具 | text, thinking | always |
| `no-md-filepath-link.md` | 禁止链接包装文件路径 | text | always |
| `no-hardcoded-secrets.md` | 禁止硬编码密钥 | tool:write(*), tool:edit(*) | always |
| `no-git-add-all.md` | 禁止 git add -A | tool | always |
| `no-git-push-force.md` | 禁止 git push --force | tool | always |
| `cwd-file-placement.md` | 文件必须放在项目目录内 | tool:write(*) | never |
| `chinese-punctuation.md` | 中文标点 | text | never |
| `tool-call-commentary.md` | 禁止工具调用废话 | text | never |

### 第 2 层：constraints.md（语义/行为约束，最小化）

路径：`data/memory/constraints.md`，仅保留无法用正则匹配的约束，通过 `before_agent_start` hook 注入。

涵盖：工具调用约束、推理约束、角色/风格约束、安全约束(P0)、Git 约束、代码约束、ComfyUI 生图速查。

### 第 3 层：扩展 Hooks（拦截层）

通过 `tool_call` hook 实现运行时拦截：
- 危险路径拦截（System32、Windows、Program Files）
- 配置文件自改拦截（config.yml、models.yml、claude-mode-extension.ts）
- workspace 根目录新建一级子目录拦截
- 静默工具调用检测（连续 3 次无文字说明 → steer 提醒）

---

## Claude 化扩展 (v4.0)

扩展文件：`plugins/claude-mode-extension.ts`（482 行），通过 `-e` 参数加载。

### v4.0 设计原则

**删除（omp 原生已覆盖）**：
- AGENTS.md 注入 → omp 自动从 CWD 查找注入
- MEMORY.md / PROJECT.md 注入 → Mnemopi autoRecall
- 违反检测（4 个检测器） → TTSR 实时拦截
- 权限契约审批 → omp 内置审批系统
- XML 工具调用自动纠正 → TTSR no-xml-toolcall.md
- 敏感信息检测 → 不再需要
- memory_search / memory_write 工具 → Mnemopi 原生 recall/retain
- /omfg 命令处理 → Electron 主进程已拦截

**保留（omp 不覆盖）**：
- gap-fill 断片补救（压缩前提取关键事实，压缩后注入恢复）
- 危险路径/配置文件拦截
- 静默工具调用检测
- skill 工具注册
- 审计日志
- error/unknown 续行（最小化，使用 omp 原生 `{continue: true}`）

### 6 个 Hooks

| # | 事件 | 功能 |
|---|------|------|
| 0 | `session_start` | 移除 eval/hub 工具；注册 skill 工具 |
| 1 | `before_agent_start` | gap-fill 断片补救注入 + constraints.md 注入 |
| 2 | `tool_call` | 危险路径拦截、配置文件自改拦截、workspace mkdir 拦截、静默工具调用检测 |
| 3 | `session_stop` | error/unknown 续行（用 omp 原生 `{continue: true, additionalContext}`），其他不干预 |
| 4 | `session.compacting` | gap-fill 确定性提取（文件/命令/决策）+ compact dump（最近 50 条消息）+ constraints 关键条目重注入 |
| 5 | `tool_result` | 审计日志 |

### session_stop 续行逻辑（v4.0 简化）

| stopReason | hasText | reason | 续行？ |
|---|---|---|---|
| `error` | - | error | 是（`{continue: true}`） |
| (无 lastMsg) | - | unknown | 是 |
| `length` | - | interrupted | **否**（交给 omp 原生处理） |
| `stop` | 有 | complete | 否 |
| `stop` | 无 | interrupted | **否**（交给 omp 原生处理） |
| `aborted` | - | aborted | 否 |

v4.0 不再自己实现续行机制，仅对 error/unknown 返回 `{continue: true}`，其余全部信任 omp 原生判断。

### gap-fill 断片补救

1. **提取时机**：`session.compacting` hook 触发时
2. **提取内容**：已读文件、改动文件、关键命令、决策/要点（去噪、去重、上限 60 条）
3. **存储位置**：`data/memory/inbox/gap-fill-{sessionId}.md`
4. **注入时机**：`before_agent_start` hook 读取并注入 systemPrompt
5. **清理**：跨 session 的 gap-fill 文件 30 分钟后自动删除

### 1 个自定义工具

| 工具 | 说明 |
|------|------|
| `skill` | 加载专业技能执行专业任务（18 个 skill），传入 `name` 加载，`action: "list"` 列出所有 |

### /omfg 命令

Electron 主进程拦截 `/omfg <complaint>` 命令，替换为 TTSR 规则生成/修复 prompt，模型直接用 write 工具写 `.md` 规则文件，即时生效。扩展本身不处理此命令。

---

## Electron 桌面前端

### 架构

| 文件 | 说明 |
|------|------|
| `electron/main.js` (~1789 行) | 主进程：OmpInstanceManager + IPC handler + 窗口管理 + /omfg 拦截 |
| `electron/preload.js` (~133 行) | contextBridge + marked + hljs + IPC 桥接 |
| `electron/renderer/index.html` | 主界面 HTML |
| `electron/renderer/styles.css` (~2846 行) | HSL Token 主题系统 + 全组件样式 |
| `electron/renderer/app.js` (~3853 行) | 渲染进程主逻辑 |
| `electron/renderer/themes.js` (~659 行) | 主题引擎：7 套预设 × light/dark/system |

### 主题系统

- **7 套预设**：Eucalyptus / Claude / Breeze / Sakura / Ocean / Dracula / Obsidian
- **3 种模式**：亮色 / 暗色 / 跟随系统
- **架构**：`themes.js` 包含预设数据 + 注入引擎，通过 JS 动态写 `<style>` 到 `:root`
- **颜色格式**：HSL 不带 `hsl()` 包装（如 `210 20% 18%`），CSS 中用 `hsl(var(--bg-200))`

### OmpInstanceManager — 多实例管理

| 特性 | 值 |
|------|---|
| 最大实例数 | 5 |
| 通信方式 | JSONL over stdin/stdout |
| 就绪检测 | 100ms 轮询，最多 15 秒 |
| LRU 淘汰 | 淘汰 `lastActiveTime` 最久远且非当前活跃的实例 |
| stall 检测 | 3 分钟无事件 → abort + steer；再 30 秒未恢复 → forceKill |
| 崩溃自动重启 | code≠0 非用户 kill 的退出 → 3 秒后重启 |

### IPC Handler (36 个)

**Omp 管理 (12)**：omp:send, omp:abort, omp:setModel, omp:getModels, omp:isReady, omp:getState, omp:steer, omp:extensionResponse, omp:compact, omp:command, omp:activate, omp:instances

**文件系统 (4)**：fs:listDir, fs:readFile, fs:writeFile, fs:readImage

**Workspace/项目 (2)**：workspace:openFolderDialog, workspace:change

**模型配置 (3)**：models:read, models:write, models:restart

**Session 管理 (13)**：sessions:listProjects, sessions:listSessions, sessions:switch, sessions:new, sessions:loadHistory, sessions:archiveProject, sessions:deleteProject, sessions:listArchived, sessions:restoreProject, sessions:archiveSession, sessions:deleteSession, sessions:listArchivedSessions, sessions:restoreSession

### Renderer 功能

- **输出后处理**：fixBareUrls、fixCodeBlockLanguages、applyOutputFixes
- **ToolCard 智能摘要 + Diff 视图**：summarizeToolCall、extractDiff、renderDiffView
- **右侧栏**：文件树、Todo 面板、预览区（代码/图片/HTML/MD）
- **模型管理**：37 个供应商预设、2 步发现向导、快速切换浮层
- **会话/项目管理**：64KB header scan、两轮 tool 重建、项目排序、分支命令、导出 HTML

---

## Skills（专业技能，18 个）

Skills 目录：`G:\oh-my-pi\skills\`

| Skill | 说明 |
|-------|------|
| canvas-design | 创意海报设计（LLM 生成 HTML+CSS+SVG） |
| comfyui-image-gen | ComfyUI 文生图与图编辑（5 种管线） |
| contract-review | 合同审核（三层审查 + 批注 + 流程图） |
| craftman | 工匠模式（多 skill 工作流编排） |
| dashiai-ppt | Dashi PPT 生成（12 套风格，离线） |
| deep-research | 深度调研（三阶段，多源搜索+交叉验证） |
| diagram-drawing | 图表绘制（Draw.io / Excalidraw） |
| doc-coauthoring | 文档辅写（结构化工作流） |
| docx | Word 文档助手 |
| history-query | 历史查询 |
| image-gen-router | 生图路由助手（统一入口） |
| image-style-enhancer | 图片风格增强器（12 风格菜单） |
| memory-manager | 长期记忆管理 |
| onboarding | 新用户引导 |
| pdf | PDF 助手（生成/读取/合并/拆分/表单/水印） |
| pptgen | HTML 网页演示生成器 |
| pptx-from-layouts | 模板排版 PPT 生成 |
| xlsx | Excel 助手 |

**注意**：用户明确说"用 XX skill"才加载对应 skill。不要主动建议或预判用户要哪个 skill。

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `PI_CODING_AGENT_DIR` | Agent 数据目录 |
| `HOME` / `USERPROFILE` | 重定向到便携包内 |
| `KIMI_API_KEY` | Kimi API 认证（用户级环境变量） |
| `PORTABLE_ROOT` | 便携包根目录 |

---

## 禁忌

- 不要修改 `data/agent/config.yml` 和 `models.yml`（除非用户明确要求）
- 不要修改 `plugins/claude-mode-extension.ts`（除非用户明确要求）
- 不要删除 Docker 镜像

## 运行时路径强制

执行 Python 或 Node 代码时，必须使用便携包内的运行时，禁止使用系统路径：

- **Python** → `G:\oh-my-pi\python\python.exe`
- **Node** → `G:\oh-my-pi\node\node.exe`
- **Bun** → `G:\oh-my-pi\npm-global\node_modules\bun\bin\bun.exe`（omp 必须）
