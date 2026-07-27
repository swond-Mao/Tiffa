# AGENTS.md — Tiffa 项目规范（v6.1）

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

## 记忆系统：Mnemopi（v6.1）

v6.1 配置值通过 `settings` 数据库直接写入，不依赖 config.yml 嵌套格式（已验证 config.yml 嵌套写法不生效）。

### 当前生效配置（settings 数据库）

| 参数 | 值 | 说明 |
|------|---|---|
| `mnemopi.scoping` | `global` | 所有项目共享同一库，每条带 metadata.cwd 标记来源 |
| `mnemopi.autoRecall` | `false` | 关闭自动召回，由 PROJECT.md 做确定性注入 |
| `mnemopi.autoRetain` | `true` | 每次 agent_end 自动 retain 到 global 库 |
| `mnemopi.retainEveryNTurns` | `2` | 每 2 轮 retain 一次 |
| `mnemopi.recallLimit` | `10` | 最多召回 10 条 |
| `mnemopi.injectionTokenLimit` | `2000` | 注入上限 2000 token |

> **注意**：config.yml 嵌套写法（`memory.mnemopi.scoping: global`）不生效，必须用 `settings` 数据库写入。
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

### 第 2 层：行为约束（before_agent_start 注入）

路径：`data/memory/constraints-inject.md`，TTSR 覆盖不了的语义/行为约束，
通过扩展 `before_agent_start` hook 注入 systemPrompt 前缀。

涵盖：读文件规范、3 次失败换方法、任务计划、skill 工具铁律、沟通风格、安全铁律。

通过 `tool_call` hook 实现运行时拦截：
- 危险路径拦截（System32、Windows、Program Files）
- 配置文件自改拦截（config.yml、models.yml、claude-mode-extension.ts）
- workspace 根目录新建一级子目录拦截
- 静默工具调用检测（连续 3 次无文字说明 → steer 提醒）

---

## Claude 化扩展 (v4.0)

扩展文件：`plugins/claude-mode-extension.ts`（461 行，v6.1.1），通过 `-e` 参数加载。

### v4.0 设计原则（精简为 v6.1）

- **已删除**：AGENTS.md 注入、MEMORY.md/PROJECT.md 注入、违反检测、权限契约审批、XML 工具调用纠正、敏感信息检测、memory_search/memory_write 工具、/omfg 命令、constraints.md 注入
- **保留**：gap-fill 断片补救、危险路径/配置文件拦截、静默工具调用检测、审计日志、error 续行（最多一次，5秒延迟）


### 6 个 Hooks（v6.1）

| # | 事件 | 功能 |
|---|------|------|
| 0 | `session_start` | 移除 eval/hub 工具 |
| 1 | `before_agent_start` | 静默工具调用计数重置 |
| 2 | `tool_call` | 危险路径/配置文件自改/workspace mkdir 拦截 + 静默工具调用检测（≥3次 → steer） |
| 3 | `session_stop` | error 续行一次（最多一次，5秒延迟），其他不干预 |
| 4 | `session.compacting` | gap-fill 提取（改动文件/命令/决策）+ compact dump + 立即返回 context 注入 |
| 5 | `tool_result` | 审计日志（JSONL） |

### gap-fill 断片补救（v6.1）

1. **触发**：`session.compacting` hook
2. **compact dump**：`data/memory/inbox/compact-{sessionId}-{ts}.txt`（最近50条消息原文）
3. **gap-fill 提取**：改动文件、关键命令（排除ls/cd/echo等）、决策要点（正则去噪，上限60条）
4. **gap-fill 落盘**：`data/memory/inbox/gap-fill-{sessionId}.md`
5. **立即注入**：返回 `{context: [gapFill内容]}`，不等下轮
6. **清理**：60分钟后自动删除（跨 session）


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

### IPC Handler (37 个)

**Omp 管理 (12)**：omp:send, omp:abort, omp:setModel, omp:getModels, omp:isReady, omp:getState, omp:steer, omp:extensionResponse, omp:compact, omp:command, omp:activate, omp:instances

**文件系统 (4)**：fs:listDir, fs:readFile, fs:writeFile, fs:readImage

**Workspace/项目 (2)**：workspace:openFolderDialog, workspace:change

**模型配置 (3)**：models:read, models:write, models:restart
**Session 管理 (14)**：sessions:listProjects, sessions:listSessions, sessions:switch, sessions:new, sessions:loadHistory, sessions:archiveProject, sessions:deleteProject, sessions:listArchived, sessions:restoreProject, sessions:archiveSession, sessions:deleteSession, sessions:rename, sessions:listArchivedSessions, sessions:restoreSession

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
### ComfyUI 生图速查（操作指令，非行为约束）

**服务**：ComfyUI 通过 9876 端口反向代理，输出目录 `E:\workspace\comfyui_out`。未运行时生图会失败，应提醒用户先启动。

| 意图 | 管线 | 命令 |
|------|------|------|
| 人物写真/名人/角色肖像 | `zimage` | `python comfy.py zimage "<提示词>" --steps 9 --size 1080x1920 --name zimage` |
| 海报带文字/排版文字 | `ernie` | `python comfy.py ernie "<提示词>" --size 768x1280 --name ernie` |
| 艺术感/动画质感/电影海报 | `krea2` | `python comfy.py krea2 "<提示词>" --steps 8 --size 1080x1920 --name krea2` |
| 写实/场景/静物/自由尺寸 | `klein` | `python comfy.py klein "<提示词>" --size 832x1216 --seed 0 --steps 8 --name klein` |
| 改图/P图/编辑/换背景 | `edit` | `python comfy.py edit "<本地图片路径>" "<编辑指令>" --name edit` |

- **路径**：`G:\oh-my-pi\skills\comfyui-image-gen\comfy.py`
- **提示词扩写**：用户给简短需求后，先扩写成详细中文提示词再传给管线
- **长宽比**：竖图默认 portrait，横图用 landscape
- **输出**：命令最后打印 `RESULT:[路径]`，报告纯路径
- **铁律**：用户没明确选管线时必须问——列出 5 个管线让用户选

---

**注意**：用户明确说"用 XX skill"才加载对应 skill。不要主动建议或预判用户要哪个 skill。

## 环境变量

| 变量 | 说明 |
|------|------|
| `PI_CODING_AGENT_DIR` | Agent 数据目录 |
| `HOME` / `USERPROFILE` | 重定向到便携包内 |
| `KIMI_API_KEY` | Kimi API 认证（用户级环境变量） |
| `PORTABLE_ROOT` | 便携包根目录 |

---
## Windows 开发注意事项

- **行尾符**：Windows 用 `\r\n`，PowerShell 脚本先归一化为 `\n` 再 regex
- **换行符 in regex**：`.` 不匹配 `\n`，需加 `(?s)` 单行模式使 `.` 匹配换行符
- **UTF-8 无 BOM**：PowerShell 5.1 读取无 BOM 的 UTF-8 中文文件会出错，输出重定向亦然
- **PowerShell 脚本**：shebang 在 Windows 不可用，所有脚本用 `.ps1` 后缀，必要时用 `powershell -File`

---

## 记忆系统更新（v6.1）

### 当前配置（settings 数据库写入生效）

| 参数 | 值 | 说明 |
|------|---|------|
| `mnemopi.scoping` | `global` | 所有项目共享同一库，metadata.cwd 标记来源 |
| `mnemopi.autoRecall` | `false` | 关闭自动召回，由 PROJECT.md 做确定性注入 |
| `mnemopi.autoRetain` | `true` | 每次 agent_end 自动 retain 到 global 库 |
| `mnemopi.retainEveryNTurns` | `2` | 每 2 轮 retain 一次 |
| `mnemopi.recallLimit` | `10` | 最多召回 10 条 |

### 记忆分层（v6.1）

| 层 | 机制 | 用途 |
|---|------|------|
| 确定性注入 | PROJECT.md → before_agent_start hook | 项目级规范/决策，每会话开头 |
| 断片恢复 | gap-fill → compacting hook 立即注入 | 压缩时提取要点，直接返回 context |
| 全量积累 | mnemopi global 库 autoRetain | 所有对话语义存储，manual recall 时可跨项目查询 |
| 全局铁律 | MEMORY.md（omp 原生加载） | 跨项目通用事实，控制在 30 条以内 |
| 项目规范 | AGENTS.md（omp 原生加载） | 当前项目架构/约束 |

### gap-fill（session.compacting hook）

- 提取：改动文件、关键命令（排除 ls/cd/echo 等）、决策要点
- 落盘：`data/memory/inbox/gap-fill-{sessionId}.md` + `compact-{sessionId}-{ts}.txt`
- 注入：压缩后立即返回 `{context: [gapFill内容]}`，不等下轮
- 清理：60 分钟后自动删除（跨 session）

### PROJECT.md 与 mnemopi 同步问题

- PROJECT.md（hook 按规则写）和 mnemopi（autoRetain 全量写）是互补层，无需同步
- PROJECT.md 是精选要点，服务当前项目；mnemopi 是全量积累，服务跨项目 RAG
- 两者天然分工，不强制同步

