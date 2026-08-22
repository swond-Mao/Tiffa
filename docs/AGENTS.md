# AGENTS.md — Tiffa 项目规范（v8 · 2026-08-11）

> 本文所有数字均在 2026-08-11 现场核实。
> 详细设计与踩坑记录见 `开发文档.md`；本文只保留每会话必须常驻的规范。

## 项目概述

Tiffa：基于 `@oh-my-pi/pi-coding-agent` v17.2.2 的便携 AI 工作台，Electron 桌面壳 + Bun 内核子进程（JSONL over stdin/stdout）。

**核心理念**：搭内核的车。扩展只保留内核原生不覆盖的功能，其余全部交给内核。

## 关键路径

| 路径 | 说明 |
|------|------|
|| `$ROOT` | 便携包根目录（`PORTABLE_ROOT`） |
| `npm-global\node_modules\@oh-my-pi\pi-coding-agent\` | Tiffa 内核 (v17.2.2) |
| `npm-global\node_modules\bun\bin\bun.exe` | Bun 运行时 (v1.3.14) |
| `python\python.exe` / `node\node.exe` | Python / Node.js 运行时 |
| `data\agent\` | 配置目录 (config.yml, models.yml, agent.db, models.db) |
| `data\agent\rules\` | TTSR 规则目录（**13 条**，零 context 成本约束） |
| `data\agent\memories\mnemopi\` | Mnemopi 记忆数据库 |
| `data\memory\` | USER.md / constraints-inject.md / inbox/ |
| `plugins\claude-mode-extension.ts` | Claude 化扩展 v6.2（1477 行） |
| `plugins\computer-use-extension.ts` | 桌面自动化扩展（128 行） |
| `electron\assets\` | 品牌图标 `tiffa-icon.ico`（7 尺寸）/ `.png` |
| `skills\` | 专业技能目录（**22 个**） |
| `data\agent\managed-skills\` | 内核托管技能（22 个，随内核同步） |
| `.cache\` | npm / pip 缓存（install 注入，全程不写 C 盘） |
| `workspace\` | 工作区根目录 |
| `tiffa-desktop.exe` | 桌面启动器（C# winexe，已嵌入图标） |

## 启动方式

| 方式 | 命令/文件 | 说明 |
|------|---------|------|
| 桌面启动器 | `tiffa-desktop.exe` | 双击启动 Electron GUI，无控制台窗口 |
| VBS 启动器 | `tiffa-desktop.vbs` | 双击启动 Electron GUI（无编译依赖） |
| 批处理启动 | `start-desktop.bat` | 带 --portable-root 参数启动 Electron |
| TUI 模式 | `start-tiffa.bat --tui` | 终端交互模式 |
| WebUI 模式 | `start-tiffa.bat --web` | RPC-UI JSON 事件流 |

## 模型配置

### 模型清单 (models.yml)

| Provider | 模型 | 特点 |
|----------|------|------|
| kimi | kimi-k3 | 旗舰，262K 上下文，推理+视觉 |
| minimax | MiniMax-M3 / MiniMax-M2.7 | 100 万上下文 / 视觉 |
| xiaomi | mimo-v2.5 / mimo-v2.5-pro | 轻量快速 / 旗舰推理 |
| volcengine | glm-5.2 | 火山方舟 Coding Plan，102 万上下文 |
| opencode-zen | 7 个免费模型 | 含 mimo-v2.5-free（视觉） |
| deepseek | — | 仅配 provider，未列模型 |
| **llama.cpp** | localmodel | 家用模型**本地直连** `127.0.0.1:11434` |
| **local-server** | localmodel | 家用模型**远程中继** `47.108.197.247:9876`（frp） |

> **本地 provider 必须用内核约定名，不可自定义**（2026-08-01 改名，原为 `qwen` / `qwen-remote`）：
> - 名字命中内核 `modelLacksWebpSupport()` 白名单（`ollama` / `ollama-cloud` / `llama.cpp` / `lm-studio` / `local-server`）→ `excludeWebP: true`，拖拽与 `read` 两条路径都不会被编码成 WebP，避免 llama.cpp（stb_image 无 libwebp）返回 HTTP 200 + 空 choices 的**静默崩**。
> - 远程中继特意选 `local-server` 而非 `llama.cpp` 系：`append-only-context-mode.ts` 的 `LOCAL_INFERENCE_PROVIDERS` 不含 `local-server`，避免凭空打开 append-only 上下文。本地直连因 loopback 判定本就开着，改名后行为不变。
> - 两者 `supportsTools` 必须都为 `true`：这是**协议切换**不是工具开关，标 `false` 会让 `resolveDialect()` 从原生 function calling 退化成 GLM in-band 文本协议。
> - **验证陷阱**：`cli.js models --json` 是固定十字段投影，不输出 `supportsTools` / `supportsWebp`，不能用它判断字段是否被 schema 剥离；用 `ModelsConfigFile.relocate(path).tryLoad()`。

### 模型角色 (config.yml)

| 角色 | 模型 | 说明 |
|------|------|------|
| default / smol / commit | llama.cpp/localmodel | 默认 / 轻量 / 提交 |
| slow / plan / vision | kimi/kimi-k3 | 深度推理 / 规划 / 视觉 |
| tiny | xiaomi/mimo-v2.5 | 最小模型 |

---

## 记忆系统：Mnemopi

配置值**必须通过 `settings` 数据库直接写入**。config.yml 嵌套写法（`memory.mnemopi.scoping: global`）**不生效**，已验证。

### 当前生效配置（settings 数据库实测）

| 参数 | 值 | 说明 |
|------|---|---|
| `mnemopi.embeddingModel` | `BAAI/bge-small-zh-v1.5` | 中文模型 512 维，勿与英文默认 384 维混用 |
| `mnemopi.scoping` | `per-project-tagged` | 写项目 bank 打标签，召回时并行搜项目 + 全局，项目优先 |
| `mnemopi.autoRecall` | `true` | 首条消息自动召回 |
| `mnemopi.autoRetain` | `true` | 自动写入 |
| `mnemopi.retainEveryNTurns` | `2` | 每 2 轮 retain 一次 |
| `mnemopi.recallLimit` | `10` | 最多召回 10 条 |
| `mnemopi.injectionTokenLimit` | `2000` | 注入上限 2000 token |
| `mnemopi.debug` | `true` | 调试输出 |

### 五层记忆分层

| 层 | 载体 | 内容 | 注入方式 |
|---|------|------|---------|
| L1 | `data/memory/USER.md` | 用户身份/偏好（跨项目） | 每会话全文注入 |
| L2 | 全局 bank | 跨项目使用历史 | 语义召回 |
| L3 | `<项目>/PROJECT.md` | 项目纲领/铁律 | 每会话全文注入（hook 自动生成脚手架） |
| L4 | 项目 bank | 项目近期进度 | 语义召回（优先） |

> **压缩时对话连续性**：不再依赖独立的 gap-fill 层（2026-08-05 已废弃，每会话独立 dump + 60 分钟清理维护成本过高且与 Mnemopi 重叠）。会话压缩由扩展 `session.compacting` hook 走 ③ 旁路结构化总结（详见下文），生成的 9 段摘要即对话连续性载体；工具调用/结果细节经 `messageToParts` 提取后进入摘要（语义级），无需每会话额外 dump。

> **隐私设计**：`data/memory/USER.md` / `MEMORY.md` / `AI.md` 是运行时个人数据（AI 自动填充/覆写，内核记忆整理时直接 `Bun.write` 覆写 MEMORY.md），**已 gitignore 不入库**；模板由 install.ps1 第 6 步 Ensure-MemoryTemplate 生成（已存在则跳过），`AI.md` 的模板是随仓库的 `data/memory/AI.md.template`（中性骨架不含角色卡，应用启动缺失时自动从模板重建，角色卡由各机器自己在设置页生成）。`constraints-inject.md` / `design-outline.md` 为项目级模板，正常入库。**绝对不要手动 `git add -f` 这三个运行时文件。**

### 写入路由

| 用户说的话 | 写入位置 |
|-----------|---------|
| "这个项目必须/不能 xxx" / "记录到项目记忆" | PROJECT.md（铁律） |
| "以后你都必须/不能 xxx" | USER.md（跨项目偏好） |
| 其他（踩坑/决策/进度） | mnemopi 自动积累 |

---

## 三层约束体系

### 第 1 层：TTSR 规则（零 Context 成本，13 条）

规则目录：`data/agent/rules/`，流式匹配——模型输出时实时检测，违规立即拦截，不占 context token。

| 规则文件 | 拦截行为 |
|----------|---------|
| `no-bare-codeblock.md` | 代码块必须标注语言 |
| `no-filler-opening.md` | 禁止废话开头 |
| `no-xml-toolcall.md` | 禁止 XML 格式调用工具 |
| `no-md-filepath-link.md` | 禁止链接包装文件路径 |
| `no-hardcoded-secrets.md` | 禁止硬编码密钥 |
| `no-git-add-all.md` | 禁止 `git add -A` |
| `no-git-push-force.md` | 禁止 `git push --force` |
| `cwd-file-placement.md` | 文件必须放在项目目录内 |
| `chinese-punctuation.md` | 中文标点 |
| `tool-call-commentary.md` | 禁止工具调用废话 |
| `intermediate-files-to-temp.md` | 中间文件落 temp，不污染项目 |
| `no-direct-mnemopi-inspection.md` | 禁止直接翻 mnemopi 数据库 |
| `no-repeated-tool-calls.md` | 禁止相同参数重复调工具 |

### 第 2 层：行为约束（before_agent_start 注入）

路径：`data/memory/constraints-inject.md`，TTSR 覆盖不了的语义/行为约束，通过扩展 `before_agent_start` hook 注入 systemPrompt 前缀。

涵盖：读文件规范、3 次失败换方法、先计划再执行、skill 铁律（技能目录感知 + 先读再规划）、沟通风格、安全铁律。

### 第 3 层：tool_call 运行时拦截 + 熔断

- 危险路径拦截（System32、Windows、Program Files）
- 配置文件自改拦截（config.yml、models.yml、claude-mode-extension.ts）
- 密钥文件读取拦截、反斜杠路径纠正
- workspace 根目录新建一级子目录拦截
- 技能强制：调技能脚本前必须先 `read skill://` 加载步骤 + `ask` 询问用户，否则 block；pptx-designer 的 build.js 额外要求「主题」关键词的新鲜 ask；支持 SKILL.md frontmatter `gates:` 声明（新技能免改插件代码，见「技能感知与门禁」节）
- 内联 pyautogui 拦截
- 静默工具调用检测（连续 3 次无文字说明 → steer 提醒）
- **熔断**：同一轮内被 block 累计 3 次 → 强制终止并要求换方法，防止弱模型反复重试撑爆 context

---

## Claude 化扩展 (v6.2)

扩展文件：`plugins/claude-mode-extension.ts`（2071 行），通过 `-e` 参数加载。

### 6 个 Hooks

| # | 事件 | 功能 |
|---|------|------|
| 0 | `session_start` | 移除 eval/hub 工具 |
| 1 | `before_agent_start` | 注入 USER.md + PROJECT.md（含脚手架自动生成）+ 进度聚合（跨天/周/月 → 日报/周报/月报）+ 项目目标推演提示 + 静默工具调用计数重置 + 技能目录注入 + 技能会话必问重注入 |
| 2 | `tool_call` | 危险拦截 + 熔断 + 技能强制 + 静默检测 + git commit 检测（记录 pendingGitCommit）（见第 3 层约束） |
| 3 | `session.compacting` | 压缩路由：① 本地视觉 snapcompact → ② 主模型视觉 snapcompact → ③ 旁路模型结构化总结（9 段）→ ④ 内核自压兜底（gap-fill 已废弃） |
| 4 | `session_stop` | error 续行一次（最多一次，5 秒延迟），其他不干预 |
| 5 | `tool_result` | 审计日志（JSONL）+ git commit 成功 → 读最近会话消息 → 旁路总结 → 写 `.progress/log.md` 流水账 |

### 进度追踪器（Progress Tracker · 2026-08-08）

**功能**：git commit 成功后自动记流水账，跨天/周/月聚合成日报/周报/月报写入 PROJECT.md「进度日志」区，项目目标长期未定时提示推演。

**触发链路**：`tool_call` 检测 `git commit` → 记 `pendingGitCommit` → `tool_result` 确认 bash 成功且未超时（30s）→ `readRecentSessionMessages()` 读当前会话最新 JSONL → `callBypassModel(msgs, PROGRESS_SUMMARY_PROMPT)` 旁路总结 → `appendProgressLog()` 写入 `.progress/log.md`；旁路失败兜底用 commit message（`-m`/`-am`），无则「完成一次提交」。

**存储**：`.progress/log.md`（流水账）+ `.progress/state.json`（lastSeen / lastAggregatedDay / lastAggregatedWeek / lastAggregatedMonth 水位）+ PROJECT.md「进度日志」区（只保留当前层级：有周报删日报，有月报删周报）。

**聚合时机**：每次 `before_agent_start` 调 `aggregateProgress()`，幂等（水位不变不重复聚合）。**项目目标推演**：`buildGoalHint()` 检测「项目目标=暂未确定」+ 有周报/月报 → 注入提示，让模型 ask 用户确认后更新（不自动改写）。

### 压缩摘要（替代 gap-fill · 2026-08-05 废弃 gap-fill）

gap-fill 原设计为「每会话独立 dump 最近 50 条消息原文（`data/memory/inbox/compact-{sessionId}-{ts}.txt`）+ 落盘 `gap-fill-{sessionId}.md` + 60 分钟清理」，维护成本高且与 Mnemopi 语义召回重叠，已从扩展层彻底移除（grep 无残留）。

现由 `session.compacting` hook 的 **③ 旁路结构化总结** 承担对话连续性：

1. **触发**：内核 `session.compacting` 压缩事件
2. **提取**：`messageToParts()` 统一提取 transcript 的 user/assistant 文本 + `tool_use`/`tool_result` 分片（兼容嵌套 `message` 字段与数组 content），转成 `[工具调用]`/`[工具结果]` 文本
3. **总结**：旁路模型（env > `data/agent/bypass-model.json` > config default）生成 9 段结构化摘要（数据/指令隔离 prompt 防回显），落盘 `data/agent/last-compact-summary.md`
4. **兜底**：旁路不可达/失败 → ④ 内核 LLM 自压（`return undefined`，扩展不注入 gap）
5. **工具细节归属**：recall（Mnemopi）只存 user/assistant 文本、**不存工具**；工具调用/结果的连续性由 ③ 摘要的语义级保留覆盖，故无需复活 gap-fill

### 技能加载方式

Tiffa 无自定义 `skill` 工具。技能通过内核原生 `read skill://<name>` 协议加载：

- 模型用 `read` 工具读取 `skill://<技能名>` → 内核解析到 `data/agent/managed-skills/<技能名>/SKILL.md` → 返回完整内容
- `skills.customDirectories` 设置（agent.db settings 表）指向 `$ROOT/skills`
- `constraints-inject.md` 中列出触发词到 `read skill://` 路径的映射

### 技能感知与门禁（2026-08-21）

**问题**：非确定性管线技能（skill 内有主题/图片来源等用户选择点）曾出现：规划阶段不知道技能存在、不读 SKILL.md、跳必问确认。

**三个机制**（均在 claude-mode-extension.ts）：
1. **技能目录注入**（before_agent_start）：扫描各技能 SKILL.md frontmatter（name/description_cn/triggers/must_ask/gates，mtime 缓存），每轮注入「技能目录」表（技能｜用途｜触发词）——规划期按用途选技能（约束见 constraints-inject.md「先读再规划铁律」）
2. **gates frontmatter 声明**：SKILL.md 的 `gates:`（pattern/requireAsk/requireAskKeywords）合并进 tool_call 门禁——新技能受保护免改插件代码；内置白名单（comfy.py/craftman.py/pptgen.py/computer_use.py）优先，首个命中即停
3. **技能会话必问重注入**：SKILL.md 已加载（TTL 10 分钟）期间，每轮重注入该技能 must_ask 清单，防上下文压缩后纪律丢失

ask 关键词组检测：`ASK_KEYWORD_GROUPS`（style/theme），门禁 `requireAskKeywords` 按组要求新鲜 ask。

### /omfg 命令

Electron 主进程拦截 `/omfg <complaint>`，替换为 TTSR 规则生成/修复 prompt，模型直接用 write 工具写 `.md` 规则文件，即时生效。扩展本身不处理此命令。

---

## Electron 桌面前端

### 架构

**⚠️ 2026-08-10 前端已从 vanilla JS 迁移到 React + TypeScript（Vite 构建）。本小节为迁移后的权威描述。**

**铁律 1：`electron/renderer/src/` 是唯一真源码。** 旧版 `electron/renderer/app.js`（5896 行 vanilla）**已于 2026-08-11 删除**（git 历史可恢复）。**任何旧文档/代码里出现 `app.js` 的函数名（`followScroll` / `cycleApprovalMode` / `handleExited` / `createAssistantMessageElement` 等），一律去 `src/` 找对应实现——不要重建它、不要按旧逻辑改**。

**铁律 2：运行时加载的是 `dist/index.html`（构建产物），不是源码。** **禁止手改 `dist/assets/*.js` / `*.css`**（会被下次构建覆盖）。改 `src/*.ts(x)` 或 `styles.css` 后必须重新构建。

| 文件 | 说明 |
|------|------|
| `electron/main.js` | 主进程：TiffaInstanceManager + **65 个** IPC handler + 窗口/图标（迁移中未改动，仍是权威） |
| `electron/preload.js` | contextBridge + marked + hljs + IPC 桥接（迁移中未改动） |
| `electron/renderer/src/` | **React+TS 真源码**：`main.tsx` 入口 / `App.tsx` / `components/`（ChatView、MessageBubble、ApprovalModeButton、ModelPicker、StatusBar、SettingsPanel、AskModal…）/ `services/`（**eventRouter.ts**=事件路由、**sessionController.ts**=会话控制）/ `stores/`（useChatStore、useUiStore、useSessionsStore、useProcStore） |
| `electron/renderer/styles.css` | **两套前端共用的样式源**（React 构建时打包进 dist）。改样式改这里，不是 dist 里的 CSS |
| `electron/renderer/themes.js` + `public/themes.js` | 主题引擎：7 套预设 × light/dark/system（vite 原样复制到 dist，活的） |
| `electron/renderer/index.html` | Vite dev 入口：引 `/src/main.tsx` + `styles.css` + `/themes.js` |
| `electron/renderer/dist/` | **构建产物（勿手改）**，main.js 加载其中的 index.html |
| `electron/renderer/vite.config.ts` / `tsconfig.json` | 构建/TS 配置 |

**构建命令**：`cd electron && npm run build:renderer`（= `vite build --config renderer/vite.config.ts`，产物到 `renderer/dist/`，node_modules 在 `electron/` 下）。
**生效规则**：改 `src/` 或 `styles.css` → **必须构建才生效**；改 `main.js` / `preload.js` → 直接生效，无需构建。

**⚠️ 构建环境坑**：在 WorkBuddy Bash 里构建会被 safe-delete 垫片拦（vite 清空 dist 失败）→ 先 `mv dist dist_old_$(date +%H%M%S)` 改名再构建；普通 PowerShell/终端直接 `npm run build:renderer` 无此问题。

### 窗口

初始 `1600×1000`，最小 `1100×720`（布局安全值，缩到最小也不漏边框），`icon: electron/assets/tiffa-icon.ico`。无尺寸持久化逻辑，改默认值即生效，需重启。

### 主题系统

- **7 套预设**：Eucalyptus（默认，莫兰迪）/ Claude（暖橙）/ Breeze（清新护眼）/ Sakura / Ocean / Dracula / Obsidian
- **3 种模式**：亮色 / 暗色 / 跟随系统
- **架构**：`themes.js` 存预设数据 + 注入引擎，JS 动态写 `<style>` 到 `:root`
- **颜色格式**：HSL 不带 `hsl()` 包装（如 `210 20% 18%`），CSS 中用 `hsl(var(--bg-200))`

### TiffaInstanceManager — 多实例管理

| 特性 | 值 |
|------|---|
| 最大实例数 | `MAX_INSTANCES = 8` |
| 通信方式 | JSONL over stdin/stdout |
| 就绪检测 | 100ms 轮询，最多 15 秒 |
| LRU 淘汰 | 淘汰 `lastActiveTime` 最久远且**非 `agentRunning`** 的实例 |
| 崩溃自动重启 | 任何非 `userKilled` 的退出（含 `code === 0`）→ 3 秒后重启，最多 3 次 |

**生命周期铁律**：
1. ready 轮询检测到进程退出时，若 `willRestart` 则**保留实例占位**，不 `instances.delete`（否则重建的进程成孤儿，表现为「点了没反应」）
2. `switchToSession` 切换前若 `agentRunning` 必须先 `abort` + 等 `agent_end`（3 秒超时兜底），避免强杀丢失未写盘 JSONL
3. **删除/归档会话必须先关实例**：`_closeInstancesForSessionFile()` 按 sessionFilePath / sessionId 匹配 → `inst.kill(true)`。只删文件不关实例，内核后续写盘会把 jsonl「复活」
4. `forceKill` 是**死代码**（全仓库无调用）。旧文档的「stall → forceKill 升级」不存在，stall 检测只在 renderer 侧 abort

### IPC Handler（65 个）

| 分组 | 数量 | 代表 |
|------|-----|------|
| Tiffa 管理 | 16 | send / abort / steer / followUp / compact / activate / activateSession / closeSession / diagnostics / instances |
| 会话管理 | 18 | listProjects / listSessions / switch / new / loadHistory / archive* / delete* / restore* / rename / exportHtml |
| 模型配置 | 6 | models:read / write / restart / writeProvider / deleteProvider / config:writeApprovalMode |
| 文件系统 | 4 | fs:listDir / readFile / writeFile / readImage |
| Shell / 路径 | 4 | shell:openExternal / openPath / path:workspace / path:root |
| 其他 | 7 | workspace:* / fetch:providerModels / xml-translation:* / memory:recall |

### 前端要点

- **滚动跟随** = 迁移前 `app.js` 的 `followScroll` 三态机，React 版在 `src/` 有对应实现（Grep 搜 `followScroll` 定位，别按旧文件找）。`scrollToBottom(force)` 只是薄壳。**新增滚动需求改控制器，别在调用点各自写 `scrollTop`**。程序滚动必须临时 `scrollBehavior='auto'`（CSS `scroll-behavior: smooth` 与流式写 `scrollTop` 互斥会「跟丢」）；会话恢复 `scrollTop` 后要补 `followScroll.sync()`
- **模型白名单**（`enabled-models.json`）：`undefined` = 全部显示，**只在用户显式配置时才激活**。添加供应商向导不得在 `undefined` 时自动激活；删除供应商后白名单整体孤儿化 → 重置为 `undefined`
- **输出后处理**：fixBareUrls、fixCodeBlockLanguages、applyOutputFixes
- **ToolCard**：智能摘要 + Diff 视图（summarizeToolCall / extractDiff / renderDiffView）
- **右侧栏**：文件树、Todo 面板、预览区（代码/图片/HTML/MD）

### 迁移后已修问题速查（2026-08-10/11 实修，勿重复排查、勿回退）

| 问题 | 修复位置 | 说明 |
|------|---------|------|
| 审批切换显示"实例断开" | `ApprovalModeButton.tsx` + `eventRouter.ts` | 重启前 `setApprovalModeRestarting(true)`，`handleExited` 见标志直接 return |
| 流式"小框刷字" | `MessageBubble.tsx` + `styles.css` | 流式消息挂 `.streaming` class，CSS `.message.streaming{content-visibility:visible}`（`:last-child` 方案已弃，脆弱） |
| 模型显示漂移 | `eventRouter.ts` + `sessionController.ts` | `config_update` 取 `m.name\|\|m.id`（勿用 `String(对象)`）；`model_changed` 事件已接 |
| 模型不可达无提示 | `eventRouter.ts` | 内核发 `notice` 非 `error`；agent_end 检测空回复 → "模型未返回内容（可能服务器不可达…）" |
| 手动压缩无反应 | `sessionController.ts` | 不再吞错，`压缩失败: <原因>` 透出（`Nothing to compact` = 会话太小，正常） |
| 点模型名白屏 | `SettingsPanel.tsx` ModelEntryRow | React hooks 违规 #310 已修；**hooks 必须无条件调用** |
| 切换审批 JS 报错弹窗 | `main.js` | 已加 `uncaughtException`/`unhandledRejection` 全局捕获（记日志不弹窗） |
| 输出到一半停 | `data/agent/models.yml` | **真因**：`supportsTools: false`（工具协议退化 → Tool not found）+ `maxTokens` 8192 过小（finish_reason=length）。已修：supportsTools 恢复 true、maxTokens→32768。⚠️ 曾误加 compat `extraBody.thinking.type: disabled` 治"提前 end_turn"，2026-08-11 复盘确认为误修（与 thinking 无关），已移除恢复 thinking；再遇此问题勿再关 thinking |
| 事件可见性丢失 | `eventRouter.ts` | 已接 `auto_compaction_start/end`、`retry_fallback_applied/succeeded`、`thinking_level_changed`、`extension_error` |

---

## 三层自动测试（2026-08-11 建立，对标 dim 项目 oh-my-pi-UI/scripts）

**遇到「内核异常/协议问题」先自检再排查**：ready 超时、事件缺失（agent_start/agent_end 不到）、模型不可达、重启后症状消失等问题，先跑 ① e2e-smoke 定位是内核坏了还是壳的问题，不要直接改 main.js。

| 层 | 手段 | 命令/触发 | 测什么 |
|---|------|----------|--------|
| ① 协议 E2E | `electron/scripts/e2e-smoke.mjs` + `e2e-session.mjs`（spawn 真实内核，不启 Electron） | `cd electron && npm run test:e2e`（smoke+session 连跑） | ready → get_state → prompt → 流式 → agent_end 全协议链 + 会话命令 |
| ② agent 自跑 | 对话中让 Tiffa 自己执行 ① | 说"跑一遍端到端自检" | agent 用 bash 跑脚本判 PASS/FAIL，相当于给 Tiffa 做体检 |
| ③ 浏览器 UI 验证 | 内核内置 browser 工具（puppeteer-core 驱动，`browser.enabled: true` 已开） | 说"用浏览器打开 xx 验证渲染" | aria 快照 + 截图 + JS 断言验证前端 UI；浏览器优先系统 Chrome，无则自动下载到 `~/.omp/puppeteer` |

**脚本要点**：
- `electron/scripts/_kernel.mjs` 是共享启动模块，环境注入与 `main.js` 完全一致（`PI_CODING_AGENT_DIR`→data/agent、便携 HOME、`BUN_INSTALL`、UTF-8）——**新增 E2E 脚本必须复用 `spawnKernel()`，勿另写路径**
- `e2e-smoke` 跑一次会真实调用默认模型（几 token 成本）；`--no-session` 不污染会话；90s 超时（首次 spawn 内核慢）
- `capture-select.mjs` 抓 extension_ui_request 帧（审批/ask 排查），输出 `data/logs/e2e-capture-frames.jsonl`

---

## Skills（22 个）

Skills 目录：`$ROOT/skills/`

| Skill | 说明 |
|-------|------|
| canvas-design | 创意海报设计（LLM 生成 HTML+CSS+SVG） |
| comfyui-image-gen | ComfyUI 文生图与图编辑（5 种管线） |
| **computer-use** | 桌面自动化 v3（UIA 原子工具集 + 五级降级） |
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
| ponytail | 极简方案强制（最懒但能用的实现，质疑过度设计） |
| pptx-from-layouts | 模板排版 PPT 生成 |
| shared-visual-components | 共享视觉组件库（12 套主题 + 18 组件 + 5 布局模板，视觉产出统一底座） |
| video-prompt-gen | 视频生成提示词（MiniMax H3 方法论，三类模式） |
| xlsx | Excel 助手 |

**注意**：用户明确说"用 XX skill"才加载对应 skill（用 `read skill://<name>` 读取 SKILL.md）。不要主动建议或预判用户要哪个 skill。

### Computer Use v3 速查

核心 `skills/computer-use/uia_core.py` + MCP 服务 `computer_use_mcp.py`，配套 `plugins/computer-use-extension.ts`。

- **8 个 MCP 工具**：`ui_inspect` / `ui_act` / `ui_screenshot` / `ui_find_text` / `ui_click_text` / `ui_ocr` / `desktop_input` / `computer_use`
- **三阶段强制流程**：应用探测（不可跳过）→ 策略选择（有 CLI/API/COM 后台通道优先走后台）→ 执行
- **五级降级**：L1 UIA Pattern 直调 → L2 UIA 精确坐标 → L3 SoM 编号标注截图 → L4 归一化坐标(0~1000) → L5 OCR 文本识别
- **安全**：`ask` 确认意图 → 展示计划 → 用户确认 → 执行；`computer_use` 与 `desktop_input(launch)` 额外弹 Windows 确认框

### ComfyUI 生图速查（操作指令，非行为约束）

**服务**：ComfyUI 运行在 `http://47.108.197.247:8188`（与 `skills/comfyui-image-gen/comfy.py` 默认地址及 SKILL.md 一致；可用 `COMFY_URL` 环境变量覆盖），输出目录 `$ROOT/workspace/comfyui_out`。未运行时生图会失败，应提醒用户先启动。

| 意图 | 管线 | 命令 |
|------|------|------|
| 人物写真/名人/角色肖像 | `zimage` | `python comfy.py zimage "<提示词>" --steps 9 --size 1080x1920 --name zimage` |
| 海报带文字/排版文字 | `ernie` | `python comfy.py ernie "<提示词>" --size 768x1280 --name ernie` |
| 艺术感/动画质感/电影海报 | `krea2` | `python comfy.py krea2 "<提示词>" --steps 8 --size 1080x1920 --name krea2` |
| 写实/场景/静物/自由尺寸 | `klein` | `python comfy.py klein "<提示词>" --size 832x1216 --seed 0 --steps 8 --name klein` |
| 改图/P图/编辑/换背景 | `edit` | `python comfy.py edit "<本地图片路径>" "<编辑指令>" --name edit` |

- **路径**：`$ROOT/skills/comfyui-image-gen/comfy.py`
- **提示词扩写**：用户给简短需求后，先扩写成详细中文提示词再传给管线
- **长宽比**：竖图默认 portrait，横图用 landscape
- **输出**：命令最后打印 `RESULT:[路径]`，报告纯路径
- **铁律**：用户没明确选管线时必须问——列出 5 个管线让用户选

---

## 环境变量

| 变量 | 值 | 说明 |
|------|---|------|
|| `PORTABLE_ROOT` | `$ROOT` | 便携包根目录 |
| `PI_CODING_AGENT_DIR` | `$ROOT/data/agent` | Agent 数据目录 |
| `HOME` / `USERPROFILE` | `$ROOT/home` | 重定向到便携包内 |
| `BUN_INSTALL` | `$ROOT` | Bun 安装根 |
| `MNEMOPI_EMBEDDING_MODEL` | `BAAI/bge-small-zh-v1.5` | **必须**，否则回退英文模型导致检索失效 |
| `KIMI_API_KEY` | — | Kimi API 认证（用户级环境变量） |

---

## Git 三远端推送（2026-08-11 实测更新）

```bat
:: origin   -> https://gitee.com/mao-yihong/oh-my-tiffa.git
:: github   -> https://github.com/swond-Mao/Tiffa.git
:: gitcode  -> https://gitcode.com/weixin_42319734/Tiffa.git
```

⚠️ 旧文档的「直接 push 会失败，必须每命令覆盖 `credential.helper=wincred`」**已过时**（2026-08-11 实测：默认凭据链直接 `git push origin master` / `github` / `gitcode` 均成功）。三远端用同一套 Windows 凭据管理器即可，无需 helper 覆盖。

`models.yml`（含 API key）、`data/agent/memories/`、`data/cache/`、`data/agent/cache/`、`local_cache/` 均已 gitignore。

---

## Windows 开发注意事项

- **行尾符**：Windows 用 `\r\n`，PowerShell 脚本先归一化为 `\n` 再 regex
- **换行符 in regex**：`.` 不匹配 `\n`，需加 `(?s)` 单行模式
- **UTF-8 无 BOM**：PowerShell 5.1 读取无 BOM 的 UTF-8 中文文件会出错，输出重定向亦然
- **PowerShell 脚本**：shebang 不可用，所有脚本用 `.ps1` 后缀，必要时 `powershell -File`
- **Bun 跑 TS 需 `.ts` 后缀**：`.js` 文件里写类型注解会报语法错误
- **路径硬编码**：一律用 `$env:PORTABLE_ROOT`，禁止写死 `G:/Tiffa`

### 语法检查

```bat
node\node.exe -c electron\main.js
cd electron && npm run typecheck   :: 渲染层 TS 检查（app.js 已删除，勿重建）
bun build plugins\claude-mode-extension.ts --no-bundle --target=bun
```
