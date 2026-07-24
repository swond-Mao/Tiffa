# AGENTS.md — omp 便携包项目规范

## 项目概述

oh-my-pi (omp) 便携包：基于 `@oh-my-pi/pi-coding-agent` v17.0.7 的便携 AI 编程助手，搭载 Claude 化扩展 (v2.3) + XML 工具调用翻译层 (v7.0) + Electron 桌面前端。

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
| `plugins\claude-mode-extension.ts` | Claude 化扩展 (v2.3) |
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
| qwen | localmodel | 本地模型 (llama.cpp，通过 frp 中继 127.0.0.1:9876) |

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

## Claude 化扩展 (v2.3)

扩展文件：`plugins/claude-mode-extension.ts`，通过 `-e` 参数加载。

### 架构变化 (v1.0 → v2.3)

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

### 8 个事件 Hook

| # | 事件 | 功能 |
|---|------|------|
| 1 | `before_agent_start` | AGENTS.md + PROJECT.md + MEMORY.md + constraints.md 注入、gap-fill 断片补救、违反检测、eval 禁用、工具调用纪律（仅第 1 轮）、长命令执行规范 |
| 2 | `tool_call` | 权限拦截（danger 级拒绝、eval 禁用、危险路径拦截、workspace mkdir 拦截、配置文件自改拦截） |
| 3 | `tool_result` | 审计日志 |
| 4 | `session.compacting` | gap-fill 确定性提取（文件/命令/决策）+ compact dump（最近 50 条消息）+ constraints 关键条目重注入 |
| 5 | `tool_approval_requested` | 自动审批契约（read 自动批、danger 自动拒、危险路径拦截） |
| 6 | `session_stop` | 审计日志 |
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
7. **eval 禁用** — 每轮注入
8. **工具调用纪律** — 仅第 1 轮约定
9. **长命令执行规范** — 仅第 1 轮约定

### 权限契约

| 层级 | 行为 | 工具示例 |
|------|------|---------|
| read | 自动批准 | read/glob/grep/search/ls/cat/skill/memory_search |
| write | 需确认（路径安全检查后放行） | edit/write/create |
| danger | 自动拒绝 | rm/format/shutdown |

**额外拦截**：
- eval 工具（Windows 管道死锁）
- 危险路径（System32、Windows、Program Files）
- 配置文件自改（config.yml、models.yml、claude-mode-extension.ts）
- workspace 根目录下新建一级子目录

---

## XML 工具调用翻译层 (v7.0) — 已退役

**已废弃**。流层面 XML 翻译方案（registerProvider + custom-openai + streamSimple）无法正常工作，已退役。代码保留在 `plugins\xml-tool-translator.ts` 供参考，但不再接入启动链路。

**当前方案**：使用 claude-mode-extension v2.3 的 **XML 自动纠正**机制（见上方"XML 工具调用自动纠正 (v2.3)"小节），在 `after_provider_response` 中检测 `<function=xxx>` 标签，自动发 steer 消息提醒模型改用标准 function calling 格式，最多重试 2 次。

---

## Electron 桌面前端

### 架构

| 文件 | 说明 |
|------|------|
| `electron/main.js` (1682 行) | 主进程：OmpInstanceManager + 36 个 IPC handler + 窗口管理 |
| `electron/preload.js` | contextBridge + marked + hljs |
| `electron/renderer/` | index.html + styles.css + app.js |

### OmpInstanceManager — 多实例管理

| 特性 | 值 |
|------|---|
| 最大实例数 | 5 |
| 通信方式 | JSONL over stdin/stdout（无端口分配） |
| 就绪检测 | 100ms 轮询，最多 15 秒 |
| LRU 淘汰 | 淘汰 `lastActiveTime` 最久远且非当前活跃的实例 |
| stall 检测 | 3 分钟无事件 → 发 abort + steer；再 30 秒未恢复 → forceKill |
| forceKill | SIGTERM → 5 秒后 SIGKILL；被 forceKill 的实例 3 秒后自动重启 |
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

### Renderer 输出后处理

| 函数 | 功能 |
|------|------|
| `fixBareUrls(text)` | 裸 URL → `[domain](url)` Markdown 链接 |
| `inferCodeLanguage(code)` | 启发式推断代码语言（支持 jsx/js/python/html/css/sql/go/rust/xml/toml/yaml） |
| `fixCodeBlockLanguages(text)` | 无语言标注代码块自动填充推断语言 |
| `applyOutputFixes(text)` | 总入口：fixBareUrls → fixCodeBlockLanguages |

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
