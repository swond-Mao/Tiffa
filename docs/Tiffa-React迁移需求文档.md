# Tiffa 前端 React 化迁移 · 开发需求文档

> 版本：v1.0（2026-08-10）
> 背景：Tiffa 前端为手写 vanilla JS 单文件（`electron/renderer/app.js`，约 334KB），状态与 DOM 靠人肉同步，多会话并发场景下维护成本高。目标：按参考实现 dimchang/oh-my-pi-UI 的架构，将**渲染层**迁移为 React，消除"改了状态必须手工补渲染"的痛点。
> 范围：**只动渲染层**。内核（@oh-my-pi/pi-coding-agent）、`electron/main.js`、`electron/preload.js`、`plugins/`、`data/` 一律不得改动。

---

## 1. 硬性约束（违反即失败）

| # | 约束 | 原因 |
|---|------|------|
| 1 | **不得修改 `electron/main.js` 与 `electron/preload.js`**（除第 4 条允许的一行 loadFile 路径） | 主进程/进程池/路由/关机流程已加固并有 21 项单测，改动会破坏并发正确性 |
| 2 | **不得修改 IPC 契约**：preload 暴露的 `window.tiffaDesktop` API 签名全部原样使用（见 §5） | 渲染层只是消费者，契约变了 = 主进程也要改 |
| 3 | **不得修改内核、plugins、data 目录** | 与本次无关 |
| 4 | **保持便携性**：electron-builder 打包后，renderer 产物必须是纯静态文件，运行时零依赖、零网络；不写注册表、不装全局、userData 仍锁便携目录（`main.js` 顶层已处理，勿动） | Tiffa 立身之本 |
| 5 | **功能等价**：迁移后所有现有功能行为一致（验收清单见 §8），性能不劣化 | 换引擎不是砍功能 |

允许的最小改动：
- `electron/package.json`：`"files"` 中 renderer 条目指向构建产物（如 `renderer/dist/**/*`），devDependencies 增加 vite/react 等。
- `electron/main.js` 仅一行：`mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))` → 改为加载构建产物（如 `renderer/dist/index.html`）。**除此之外 main.js 任何行不得改**。

---

## 2. 现状盘点（迁移前必须读的代码）

| 文件 | 说明 |
|------|------|
| `electron/renderer/index.html` | 入口，`<script>` 顺序加载 `themes.js` → `app.js` |
| `electron/renderer/app.js`（334KB） | 全部 UI 逻辑：state 全局对象 + 5+ 个 Map（`sessionMessageCache`/`sessionAgentRunning`/`instanceAgentRunning`/`activeTabMeta`/`sessionModelMap`/`autoNamedSessions`/`historyPending`/`historyCursor`/`historyHasMore`/`sessionCacheFresh`/`projectSessions`/`preparingNewSessions`）+ localStorage 持久化（`tiffa:openTabs`、`tiffa-lastModel`、`tiffa-approvalMode-*` 等）+ 手动 DOM 操作 |
| `electron/renderer/styles.css`（95KB） | **整份保留**，React 组件复用同一套 class，不改样式体系 |
| `electron/renderer/themes.js` | 7 主题变量，保留 |
| `electron/preload.js` | IPC 桥，暴露 `window.tiffaDesktop`（只读，勿改） |

## 3. 目标架构（对照 dimchang/oh-my-pi-UI）

参考实现：`https://github.com/dimchang/oh-my-pi-UI`（MIT，克隆 `%TEMP%\ohmy-ui` 可读源码）。它同样是 OMP 内核的 UI，其 React 架构是本次模板，但**只借鉴其渲染层模式，不照搬其主进程**。

**技术栈（与 dim 对齐）**：
- React 18 + react-dom
- zustand（状态管理，dim 同款，比 Redux 轻）
- react-markdown + remark-gfm（消息 markdown 渲染，替代 preload 里的 marked）
- Vite（**仅构建 renderer**，不引入 electron-vite——main/preload 保持手写 JS 不动）
- TypeScript（新增 .tsx 源码）
- Vitest（单测，对齐 dim 与现有 `main.test.js`）

**状态建模（从 dim 借鉴）**：
- zustand store 按域拆分：`useSessionsStore`（会话列表/tab/占位）、`useProjectsStore`、`useChatStore`（per-session 消息缓冲，`Record<sessionPath, ChatMessage[]>`）、`useProcStore`（per-session 进程状态 `status: offline|online|streaming`，对应 dim 的 `procStateMap`）、`useUiStore`（ask 队列、主题、设置）。
- **per-session 事件路由**：主进程事件帧已带 `_sessionId` / `_sessionPath` / `_cwd` 标记（现有契约），store 按标记路由到对应会话缓冲，**不要**用"当前激活会话"猜路由（dim frame-router 思路，但主进程已实现，前端只消费标记）。
- **临时会话占位**：新对话 path 为 `__new_<uuid>`，`listSessions` 扫盘结果**必须保留 `__new_` 开头的占位**（dim store.ts 的 `setSessions` 思路），`session_switch` 事件后迁移为真实路径。

## 4. 必须消费的既有能力（禁止重造）

主进程/渲染层已有以下机制，React 版**直接调用，不得另起炉灶**：

1. **增量历史读取**：`tiffaDesktop.loadSessionHistory(path, { tail, skip })` → `{ messages, hasMore }`。首屏拉 `{tail:200, skip:0}`，滚动/按钮"加载更早"时 `skip += 已加载数` 递增拉取。禁止改回全量读取。
2. **会话级路由**：`tiffaDesktop.send(message, images, sessionId)`、`setModel(provider, modelId, sessionId)`、`abort(sessionId)`、`steer/followUp(message, sessionId)`、`extensionResponse(id, value, sessionId)`、`command(type, payload, sessionId)`、`getModels/getState/compact/isReady(sessionId)` —— **所有调用必须传当前会话的 sessionId**。
3. **全实例诊断**：`tiffaDesktop.diagnostics()` → `{ instances: [{key, cwd, sessionId, ready, agentRunning, pid, pendingCommands, pendingAskIds, ...}], activeKey }`，用于"模型无响应/卡住"时的原因提示（30s 首响超时提示需带上模型名 + 内核状态）。
4. **错误透传**：事件 `type==='error'` 携带 `message/error` 原因，前端必须展示具体原因（禁止只显示"代理出错"）。
5. **会话占位/迁移**：`activateSession(cwd, sessionId)` 新建会话；`getInstances()` 查实例。
6. **保留 Tiffa 优于 dim 的设计（主进程侧，勿动）**：EOF drain 优雅关机、崩溃自动重启 + 上下文恢复、`__new_` 占位不吞、LRU 保活。

## 5. preload API 清单（消费契约，签名不可改）

会话/消息：`send / abort / setModel / steer / followUp / extensionResponse / command / compact / getModels / getState / isReady / diagnostics`
事件监听：`onEvent(cb)`（帧带 `_cwd/_sessionId/_sessionPath`）、`onExited(cb)`
会话管理：`listProjects / listSessions(dirName) / loadSessionHistory(path, opts) / activateInstance(cwd) / activateSession(cwd, sessionId) / closeSession(cwd, sessionId) / getInstances / archiveProject / deleteProject / listArchivedProjects / restoreProject / archiveSession / deleteSession / renameSession / restoreSession / listArchivedSessions / getUserEntries / exportSessionHtml`
文件/资源：`listDir / readFile / writeFile / readImage / fetchProviderModels / openExternal / openPath / getWorkspacePath / getRootPath / getPathForFile`
配置：`readModelsYml / writeModelsYml / restartTiffa / writeTiffaProvider / deleteTiffaProvider / writeApprovalMode / getXmlTranslationStatus / toggleXmlTranslation / getComputerUseStatus / toggleComputerUse / getBypassModel / saveBypassModel / getGroundingModel / saveGroundingModel / checkModelHealth`
记忆：`recallMemory / getIdentity / saveIdentity`
渲染库：`marked / markedNoHighlight / hljs`（React 版可用 react-markdown 替代，但**行为必须等价**：GFM、breaks、代码高亮、长会话不高亮优先）
其他：`clipboardWriteText / openFolderDialog / changeWorkspace / completeWithLightModel / rendererLog`

## 6. 事件流契约（React 版必须正确处理的事件）

主进程 `onEvent` 回调收到帧，`_sessionId !== 当前会话` 的后台帧只更新 per-session 状态（agent_start/agent_end 时 `sessionAgentRunning`、自动重命名），**不得渲染进当前视图**。需处理的事件类型：
`ready / prompt_result / agent_start / agent_end / turn_end / message_start / message_update / message_end / tool_execution_start / tool_execution_update / tool_execution_end / extension_ui_request / config_update / session_info_update / notice / set_todos / auto_retry_start / auto_retry_end / session_switch / error`，以及消息流内事件：`thinking_start/thinking/thinking_end/text/toolcall_start/toolcall_end`（assistant 消息增量渲染）。

要点：
- `session_switch`：把 `__new_` tab 迁移为真实路径（同步迁移 sessionModelMap/sessionAgentRunning/activeTabMeta/sessionMessageCache 等所有引用）。
- `extension_ui_request`：阻塞型审批（confirm/select/input/editor/open_url），**无论是否当前会话都必须入全局 ask 队列展示**，切走不丢；应答走 `extensionResponse(id, value, sessionId)`。
- `agent_end`：flush 该会话 DOM/消息缓存并标记新鲜（对应现 `sessionCacheFresh` 逻辑），供切回秒开；触发自动重命名。
- `error`：展示 `message/error` 原因；首响前报错立即复位"思考中"状态。

## 7. 组件树规划（建议，可调整）

```
App
├── StartupRitual（启动剧本+进度条+预加载，完成后淡出）
├── ProjectSidebar（工作区列表/归档/会话树/折叠）
├── SessionTabs（对话标签，8 上限，openTabs 持久化）
├── ChatView
│   ├── MessageList（user/assistant；thinking 折叠；tool call 卡片折叠；
│   │   markdown+高亮；模型 tag；复制按钮；steer/queued 标记；虚拟化/分批渲染大会话）
│   ├── LoadEarlierBtn（增量拉取：loadSessionHistory {tail,skip}）
│   ├── InputBox（多行、/ask、/omfg、图片粘贴/拖拽 chips、排队发送）
│   └── WelcomeScreen
├── RightSidebar（双 Tab：概要 Todo+项目纲领 / 文件导航+抽屉预览）
├── DiffView
├── Minimap
├── ModelPicker（分组/筛选/隐藏模型）
├── SettingsPanel（模型配置/旁路模型/provider/权限模式/XML 翻译/computer use/自定义 CSS）
├── AskModal（confirm/select/input/editor/open_url + 全局队列）
├── StatusBar（当前模型/就绪/思考中/运行中/出错原因）
└── ThemeProvider（7 主题，复用 themes.js 变量）
```

## 8. 验收清单（功能等价，逐项核对）

1. 启动仪式（剧本、进度条、预加载、遮罩淡出时序）行为一致
2. 项目侧栏：多工作区切换、归档/恢复、会话树（懒加载、展开折叠、重命名/删除/归档会话）
3. 会话标签：新建（`__new_` 占位立即可见）、切换（历史秒显 + 后台激活非阻塞）、关闭、8 上限、openTabs 重启恢复（≤3）、幽灵 tab 清理
4. 聊天：消息流式渲染（thinking/正文/工具调用实时增量）、markdown+代码高亮、复制、AI 名/模型 tag、引导/排队标记、长会话分批渲染 + "加载更早"增量拉取
5. 输入：多行自适应、图片粘贴/拖拽（含 webp 由主进程转 png）、/ask、/omfg、排队发送
6. 模型：选择器分组/筛选/隐藏、每会话独立模型记忆（sessionModelMap）、恢复 lastModel
7. 设置：models.yml 编辑、provider 增删、旁路/接地模型、权限模式、XML 翻译、computer use、checkModelHealth
8. ask 弹窗：confirm/select/input/editor/open_url，全局队列，切会话不丢，应答路由正确
9. Todo 面板（getState 恢复）、文件抽屉（HTML 渲染/代码高亮/图片/Markdown）、Diff 视图、Minimap
10. 自动重命名（旁路 + 豆包兜底）、分支（command('branch') + draftInput 预填）、压缩（compact + 路由提示）
11. 状态栏与错误：就绪/思考中/运行中/重启中/崩溃；**模型不可用时展示具体原因**（error 事件 message + 30s 超时提示带模型名与内核诊断）
12. 主题：7 套切换、日夜模式
13. 会话占位/迁移：`__new_` 不消失、session_switch 迁移正确、后台会话状态同步
14. **性能**：大会话（>20MB JSONL）切换首屏 < 1s（依赖增量读取）；流式渲染不卡 UI；多会话并行事件不互相串扰

## 9. 分期计划

- **Phase 0 脚手架**：renderer 目录引入 Vite + React + TS + zustand；构建产物输出 `renderer/dist/`；改 main.js loadFile 一行 + package.json files；**先验证：打包后便携性不丢、静态产物可离线运行**。可交付一个空壳 App 跑通 dev/build。
- **Phase 1 核心聊天**：zustand 状态层建模 + 事件路由（per-session 缓冲）+ 消息流式渲染 + 输入发送/中止。此阶段先打通"发消息→看回复"。
- **Phase 2 会话/项目**：会话标签、项目侧栏、会话树、openTabs 持久化、占位/迁移/后台状态同步。
- **Phase 3 扩展功能**：设置面板、模型管理、ask 队列、Diff/Minimap/文件抽屉、主题、启动仪式、自动重命名/分支/压缩。
- **Phase 4 打磨与切流**：对 §8 逐项回归；性能验证；确认无功能缺失后删除旧 `app.js`/`themes.js` 引用。

## 10. 风险与注意

- **禁止"顺手优化"主进程**：Qoder 若发现主进程"可改进"处，写入交付说明，不得改代码。
- **IPC 契约冻结**：任何"想改 preload API"的想法 = 先记录，不动。
- **回归面大**：§8 全量核对；建议每阶段跑 `node electron/main.test.js`（21 项，主进程单测，应保持全绿）确认主进程未被误改。
- **性能底线**：不得回到全量读历史；长会话渲染必须分批/虚拟化。
- **样式**：styles.css 全量保留复用，不重写设计。
- **dim 可借鉴**：store 拆分（zustand）、per-session 缓冲与 procStateMap、`__new_` 占位保留、事件按 `__sessionPath` 路由。**不可借鉴**：dim 的进程池/主进程设计（Tiffa 已有且更优）、dim 的全局安装 omp 模式（Tiffa 是便携内核）。

## 11. 交付物

1. `electron/renderer/` 下的 React 源码（src/ 或直接结构）+ 构建配置
2. 更新后的 `electron/package.json`（依赖 + files）
3. `main.js` 仅 loadFile 一行的改动（附 diff 说明）
4. 迁移后功能核对报告（对照 §8 清单）
5. 已知差异/未完成项清单（如有）
