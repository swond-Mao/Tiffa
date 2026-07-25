# AGENTS.md — Tiffa 项目规范

## 项目概述

oh-my-tiffa：基于 `@oh-my-pi/pi-coding-agent` v17.0.7 的便携 AI 编程助手，搭载 Claude 化扩展 (v2.8) + Electron 桌面前端 (v1.5)。

## 关键路径

| 路径 | 说明 |
|------|------|
| `G:\oh-my-pi\` | 便携包根目录 |
| `npm-global\node_modules\@oh-my-pi\pi-coding-agent\` | omp 核心 (v17.0.7) |
| `npm-global\node_modules\bun\bin\bun.exe` | Bun 运行时 (v1.3.14) |
| `python\python.exe` | Python 解释器 |
| `node\node.exe` | Node.js 运行时 |
| `data\agent\` | 配置目录 (config.yml, models.yml, projects.json) |
| `data\memory\` | 长期记忆目录 (MEMORY.md, constraints.md, inbox/, daily-log/) |
| `plugins\claude-mode-extension.ts` | Claude 化扩展 (v2.8) |
| `plugins\xml-tool-translator.ts` | XML 工具调用翻译层 (v7.0, 已退役) |
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
| minimax | MiniMax-M3 | 100 万上下文，MiniMax-M2.7 (204.8K) |
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

## Claude 化扩展 (v2.8)

扩展文件：`plugins/claude-mode-extension.ts`，通过 `-e` 参数加载。

### 架构变化 (v1.0 → v2.8)

| 版本 | 变化 |
|------|------|
| v1.0 | 基础 7 hook + 弱模型检测 + 参数注入 |
| v1.1 | 增强 5 hook（审计、输入检测、session 终检、审批契约、自定义工具） |
| v1.2 | 弱模型 XML 预警 + 返回值截断 |
| v1.3 | 三层记忆架构 + memory_write 工具 + registerTool 签名修复 |
| v1.4 | XML 工具调用翻译层（streamSimple 链路，已退役） |
| v2.0 | **砍掉所有基于错误前提的功能**（弱模型检测、周期性约束重申、XML翻译层、消息截断、输出修正） |
| v2.1 | **恢复违反检测机制**：4 个检测器 + 针对性补强 |
| v2.2 | 工具调用纪律改为仅第 1 轮约定 + 违反检测触发重申 |
| v2.3 | **XML 工具调用自动纠正**：检测→自动发 steer 消息→2 次失败才通知用户 |
| v2.4 | **eval 工具从工具列表移除**（模型不可见，零 token 浪费）；**伪完成检测**（stop 但无文本输出→自动续行）；**interrupted 续行**（token 截断也自动续行） |
| v2.5 | **session_stop 续行修复**：检查 stop_hook_active 防递归续行；续行轮中改用 sendUserMessage 绕过 omp 内部 session-stop-continuation 机制 |
| v2.6 | **彻底弃用 omp 原生续行**：所有续行统一走 sendUserMessage + 2秒延迟，避免 omp 内部同步续行竞态崩溃；新增续行计数器（上限5次）+ 用户输入自动取消待定续行 |
| v2.7 | **error 独立计数器**（MAX_ERROR_CONTINUE=1）：确定性错误最多续行1次，不再5次空转；complete/aborted/用户取消时重置 error 计数器 |
| v2.8 | **移除 detectRepetitiveOutput**：正则检测重复输出误杀率过高，三次验证（代码层/Qwen规则/K3规则）均不可行；保留 error 独立计数器 |

### TTSR 规则系统（零 Context 成本约束）

传统做法：每轮把约束写进 systemPrompt，占几百 token。TTSR（Time Traveling Stream Rules）的做法：规则写在 `.md` 文件里，**流式匹配**——模型输出时实时检测，违规立即拦截，不占一轮 token。

**规则目录**：`data/agent/rules/`

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

**从 constraints.md 迁移**：代码块标注、废话开头、XML工具调用、工具调用废话、裸URL（前端处理）、中文标点、文件路径链接、文件存放位置、硬编码密钥、git add -A、git push --force 已全部迁至 TTSR。constraints.md 保留语义/行为类约束（无法用正则检测）。

### /omfg 命令（一句话创建 TTSR 规则）

Electron 主进程拦截 `/omfg <complaint>` 命令，替换为 TTSR 规则生成/修复 prompt，模型直接用 write 工具写 `.md` 规则文件，即时生效。

**prompt 设计**：融合 OI3 标准格式（精确 regex 指导）+ 灵活修复能力（模型可直接修复已有规则漏洞），不走 JSON 中间步骤（因 RPC 模式无 ephemeral turn 能力做验证循环）。

**已知问题**：`/omfg` 后需空格（已修复为 `\s*` 容错）；重复输出检测规则（`no-repetitive-output.md`）经三次验证均误杀结构化输出，已删除。

| # | 事件 | 功能 |
|---|------|------|
| 0 | `session_start` | eval 工具移除（从活跃工具列表中剔除，模型完全不可见） |
| 1 | `before_agent_start` | AGENTS.md + PROJECT.md + MEMORY.md + constraints.md 注入、gap-fill 断片补救、违反检测、工具调用纪律（仅第 1 轮）、长命令执行规范 |
| 2 | `tool_call` | 权限拦截（danger 级拒绝、危险路径拦截、workspace mkdir 拦截、配置文件自改拦截） |
| 3 | `tool_result` | 审计日志 |
| 4 | `session.compacting` | gap-fill 确定性提取（文件/命令/决策）+ compact dump（最近 50 条消息）+ constraints 关键条目重注入 |
| 5 | `tool_approval_requested` | 自动审批契约（read 自动批、danger 自动拒、危险路径拦截） |
| 6 | `session_stop` | 伪完成检测 + 自动续行 + 审计日志 |
| 7 | `input` | 敏感信息检测（密码/API密钥/身份证/手机号），只记录不阻断 |
| 8 | `after_provider_response` | 审计日志 + 违反检测（记录上一轮输出）+ XML 工具调用自动纠正 |

### 3 个自定义工具

| 工具 | 说明 | execute 签名 |
|------|------|-------------|
| `memory_search` | 搜索记忆文件（PROJECT.md → MEMORY.md → daily-log，最近 7 天） | `(toolCallId, params, signal, onUpdate, ctx)` |
| `skill` | 加载专业技能执行专业任务（18 个 skill） | `(toolCallId, params, signal, onUpdate, ctx)` |
| `memory_write` | 追加内容到 PROJECT.md (target=project) 或 MEMORY.md (target=memory) | `(toolCallId, params, signal, onUpdate, ctx)` |

**工具返回格式**：`{ content: [{ type: "text", text: "..." }], details: {...} }`

### 违反检测系统 (v2.1)

| 检测器 | 检测内容 | 补强措施 |
|--------|---------|---------|
| 裸 URL | 输出中包含未用 Markdown 链接格式包裹的 URL | 要求使用 `[文字](URL)` |
| 无语言代码块 | ` ``` ` 后无语言标注 | 要求标注语言 |
| 废话开头 | "好的，我来帮您" 等无意义开头 | 要求直接进入主题 |
| 工具调用不汇报 | 调用工具后无中文文字说明 | 要求每次调用工具后说明发现/判断 |

**运行机制**：每轮已注入完整 constraints.md，违反时只追加针对性警告，不重复注入完整约束。

### XML 工具调用自动纠正 (v2.3)

1. `after_provider_response` 检测输出中 `<function=xxx>` XML 标签
2. 检测到 → 自动发送 steer 消息 "禁止使用 XML 格式调用工具"
3. 下一轮 `before_agent_start` 违反检测触发重申
4. 最多自动重试 2 次，超过上限通知用户

### 约束注入层次

1. **AGENTS.md** — 每轮注入项目规范
2. **PROJECT.md** — 按 cwd 隔离的项目级记忆
3. **MEMORY.md** — 全局长期记忆
4. **gap-fill** — 压缩前自动提取的断片补救
5. **constraints.md** — 每轮注入的核心约束
6. **违反检测** — 针对性补强（仅违规时触发）
7. **工具调用纪律** — 仅第 1 轮约定
8. **长命令执行规范** — 仅第 1 轮约定

### 权限契约

| 层级 | 行为 | 工具示例 |
|------|------|---------|
| read | 自动批准 | read/glob/grep/search/ls/cat/skill/memory_search |
| write | 需确认（路径安全检查后放行） | edit/write/create |
| danger | 自动拒绝 | rm/format/shutdown |

**额外拦截**：
- 危险路径（System32、Windows、Program Files）
- 配置文件自改（config.yml、models.yml、claude-mode-extension.ts）
- workspace 根目录下新建一级子目录

### session_stop 伪完成检测 + 自动续行 (v2.4→v2.6)

从 `last_assistant_message.stopReason + content` 推导停止原因：

| stopReason | hasText | isRepetitive | reason | 自动续行？ |
|---|---|---|---|---|
| `stop` | 有 | 否 | `complete` | 否 |
| `stop` | 有 | 是 | `interrupted` | **是** |
| `stop` | 无 | - | `interrupted` | **是** |
| `length` | - | - | `interrupted` | **是** |
| `error` | - | - | `error` | 是 |
| `aborted` | - | - | `aborted` | 否 |
| (无 lastMsg) | - | - | `unknown` | 是 |

**核心逻辑**：正常完成一定有文本输出给用户；`stop` 但无文本 = 伪完成（模型"想了想就停了"或"调完工具就停了"），必须续行。

**续行提示语区分**：
- `error` → "上一轮请求出错，请继续"
- `interrupted` + isRepetitive → "上一轮输出出现重复循环，换一种方式表达，避免重复"
- `interrupted` → "上一轮输出未完成（无文本回复），请给出完整结果"
- `unknown` → "会话异常终止，请继续"

**v2.6 续行机制（全面弃用 omp 原生续行）**：

v2.5 的问题：首次续行仍使用 omp 原生 `{ continue: true }`，这是**同步路径**——handler 返回后 omp 立即注入 session-stop-continuation 消息并启动新 agent loop，上一轮的异步清理（工具结果归档、状态重置）来不及完成，造成竞态条件导致进程崩溃。

v2.6 方案：**所有续行统一走 `sendUserMessage` + 2秒延迟**：

| 步骤 | 说明 |
|------|------|
| 1. handler 返回 `undefined` | 不返回 `{ continue: true }`，让 omp 正常结束本轮，完成异步清理 |
| 2. 等 2 秒 | 确保上一轮所有异步操作已完成（工具结果归档、状态重置等） |
| 3. `sendUserMessage(ctx, { deliverAs: "steer" })` | 发送续行指令，触发新 agent loop |

**安全机制**：
- **续行计数器**：上限 5 次，达到上限后停止续行并通知用户手动干预
- **用户输入取消**：2 秒延迟期间如果用户发送了真实消息，自动取消待定续行并重置计数器
- **正常完成重置**：模型正常完成（`complete`）或用户中断（`aborted`）时重置计数器

---

## XML 工具调用翻译层 (v7.0) — 已退役

**已废弃**。流层面 XML 翻译方案（registerProvider + custom-openai + streamSimple）无法正常工作，已退役。代码保留在 `plugins\xml-tool-translator.ts` 供参考，但不再接入启动链路。

**当前方案**：使用 claude-mode-extension v2.3 的 **XML 自动纠正**机制（见上方"XML 工具调用自动纠正 (v2.3)"小节），在 `after_provider_response` 中检测 `<function=xxx>` 标签，自动发 steer 消息提醒模型改用标准 function calling 格式，最多重试 2 次。

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

### 主题系统（移植自 OpenCodeUI）

- **7 套预设**：Eucalyptus / Claude / Breeze / Sakura / Ocean / Dracula / Obsidian
- **3 种模式**：亮色 / 暗色 / 跟随系统
- **架构**：`themes.js` 包含预设数据 + 注入引擎，通过 JS 动态写 `<style>` 到 `:root`
- **颜色格式**：HSL 不带 `hsl()` 包装（如 `210 20% 18%`），CSS 中用 `hsl(var(--bg-200))`
- **Legacy 别名**：旧 `--bg-primary` 等变量自动映射到新 HSL 变量，旧 CSS 仍可用
- **UI**：快速切换按钮（月亮/太阳）只 light/dark 互切；设置面板有三态选择器（含 system）
- **highlight.js**：亮暗主题随模式自动切换

### OmpInstanceManager — 多实例管理

| 特性 | 值 |
|------|---|
| 最大实例数 | 5 |
| 通信方式 | JSONL over stdin/stdout（无端口分配） |
| 就绪检测 | 100ms 轮询，最多 15 秒 |
| LRU 淘汰 | 淘汰 `lastActiveTime` 最久远且非当前活跃的实例 |
| stall 检测 | 3 分钟无事件 → 发 abort + steer；再 30 秒未恢复 → forceKill |
| forceKill | SIGTERM → 5 秒后 SIGKILL；被 forceKill 的实例 3 秒后自动重启 |
| 崩溃自动重启 | code≠0 非用户 kill 的退出 → 3 秒后自动重启 → ready 后 2 秒自动续行（gap-fill 断片补救由扩展自动注入） |
| 正常 kill | SIGTERM，不自动重启 |
| 看门狗间隔 | 30 秒 |
| ask 工具豁免 | 等待用户回复时暂停 stall 超时检测 |

### IPC Handler (36 个)

**Omp 管理 (12)**：omp:send, omp:abort, omp:setModel, omp:getModels, omp:isReady, omp:getState, omp:steer, omp:extensionResponse, omp:compact, omp:command, omp:activate, omp:instances

**文件系统 (4)**：fs:listDir, fs:readFile, fs:writeFile, fs:readImage

**Workspace/项目 (2)**：workspace:openFolderDialog, workspace:change

**模型配置 (3)**：models:read, models:write, models:restart

**XML 翻译 (2)**：xml-translation:status, xml-translation:toggle

**Session 管理 (13)**：sessions:listProjects, sessions:listSessions, sessions:switch, sessions:new, sessions:loadHistory, sessions:archiveProject, sessions:deleteProject, sessions:listArchived, sessions:restoreProject, sessions:archiveSession, sessions:deleteSession, sessions:listArchivedSessions, sessions:restoreSession

**系统 (4)**：shell:openExternal, shell:openPath, path:workspace, path:root, fetch:providerModels

### Renderer 功能清单

**输出后处理**：

| 函数 | 功能 |
|------|------|
| `fixBareUrls(text)` | 裸 URL → `[domain](url)`；`file:///` → `omp-local://`；Windows 路径自动链接化 |
| `inferCodeLanguage(code)` | 启发式推断代码语言（jsx/js/python/html/css/sql/go/rust/xml/toml/yaml） |
| `fixCodeBlockLanguages(text)` | 无语言标注代码块自动填充推断语言 |
| `applyOutputFixes(text)` | 总入口：fixBareUrls → fixCodeBlockLanguages |

**ToolCard 智能摘要 + Diff 视图**：

| 函数 | 功能 |
|------|------|
| `summarizeToolCall(toolName, args)` | 从工具参数提取一行摘要（路径/命令/查询等），折叠时显示 |
| `extractDiff(result)` | 自动检测工具结果中的 unified diff（递归查找 diff/patch/edits 等字段） |
| `looksLikeDiff(s)` | 正则判断文本是否像 diff（`---`/`+++`/`@@`/`+`/`-` 行首） |
| `renderDiffView(diffText)` | 渲染着色 diff：增行(绿) / 删行(红) / hunk(蓝) / 上下文(灰) |

**右侧栏**：

| 区域 | 功能 |
|------|------|
| 文件树 | 递归展开、.git/node_modules 过滤、文件大小显示（B/KB/MB）、文件图标 |
| Todo 面板 | AI 多步任务进度可视化（按阶段分组，✓/◎/✗/○ 四种状态） |
| 预览区 | 代码高亮、图片预览、HTML/MD 实时预览、可拖拽分隔线、多标签 |

**模型管理**：

- 37 个供应商预设 + YAML 注释保留（Eemeli Aro `yaml` 包 `parseDocument`）
- 2 步模型发现向导 + 3 态白名单（全部显示/仅白名单/白名单+隐藏）
- 模型快速切换浮层（搜索 + 供应商分组）
- `enabledModels === undefined` 时 fallback 到 `modelsConfigData` 过滤

**会话/项目管理**：

- 64KB header scan 快速加载会话列表
- 两轮 tool 重建（tool_execution_start → toolResult 匹配）
- 项目按最近会话活动排序（`lastSessionMtime`）
- `removedCwds` 防复活机制
- 分支命令（`entryId` 格式）、导出 HTML、历史面板人性化时间
- Per-workspace 审批模式（normal/auto/yolo）

### 项目去重机制

| 函数 | 时机 | 去重 Key |
|------|------|---------|
| `ensureProjectInJson` | 每次写入前 | `path.resolve(cwd).toLowerCase()` |
| `cleanupProjectsJson` | 启动时 / 定期 | `path.resolve(cwd).toLowerCase()` |
| `migrateSessionDirsForNewRoot` | 启动迁移 | `path.resolve(cwd).toLowerCase()` |

盘符变化识别：`extractWorkspaceSuffix()` 提取 `/oh-my-pi/workspace/` 之后的相对路径做后缀匹配。

---

## 可移植性（换电脑数据继承）

整个便携包可整体拷贝到新电脑，启动时自动修复路径变化：

- **会话数据**：`data/agent/sessions/` 下按 `{盘符}--{路径}--` 编码的目录名，换电脑后盘符变化会自动重命名
- **项目注册**：`projects.json` 中的绝对路径会自动按新 PORTABLE_ROOT 修正
- **迁移流程**：`migrateSessionDirsForNewRoot()` → `migrateSessionsToProjectsJson()` → `cleanupProjectsJson()`
- **workspace 子目录不存在时**：自动创建（不删除项目条目）
- **非 workspace 项目**：路径不存在时仍会保留条目，下次启动可恢复

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

**注意**：用户明确说"用 XX skill"才加载对应 skill。不要主动建议或预判用户要哪个 skill——听到明确指令才动。

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
