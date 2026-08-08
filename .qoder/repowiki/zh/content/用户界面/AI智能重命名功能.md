# AI智能重命名功能

<cite>
**本文引用的文件**   
- [README.md](file://README.md)
- [AGENTS.md](file://AGENTS.md)
- [main.js](file://electron/main.js)
- [preload.js](file://electron/preload.js)
- [app.js](file://electron/renderer/app.js)
- [index.html](file://electron/renderer/index.html)
- [styles.css](file://electron/renderer/styles.css)
</cite>

## 更新摘要
**变更内容**   
- 新增AI身份配置功能，允许用户通过模态界面设置自定义AI名称和称呼偏好
- 集成记忆层IPC调用，更新AI.md和USER.md文件
- 新增自动零计算重命名模式（使用消息截断）
- 增强手动AI重命名模式（文学四字风格提示）
- 实现三层aiRenameMode状态检查防止竞态条件
- 优化会话历史加载性能（使用gap-fill文件和firstMessage内存访问）

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件聚焦 Tiffa 的"AI 智能重命名"能力，主要覆盖会话标题的智能生成与持久化、用户手动重命名的实现路径，以及渲染层对重命名状态的交互控制。该能力依托 Electron 主进程的文件操作、IPC 通道与渲染进程的状态管理，确保在弱模型环境下也能稳定产出简洁、可读的会话标题，并支持用户即时修正。

**更新** 系统现已支持两种重命名模式：自动零计算模式（基于首条消息截断）和手动AI模式（文学四字风格），并通过三层状态检查机制确保并发安全。同时新增了AI身份配置功能，允许用户通过模态界面设置自定义AI名称和称呼偏好。

## 项目结构
围绕"AI 智能重命名"，关键代码分布在以下位置：
- 渲染进程（UI/状态）：electron/renderer/app.js
- 预加载桥接（IPC 暴露）：electron/preload.js
- 主进程（文件系统/会话数据读写）：electron/main.js
- 身份配置界面：electron/renderer/index.html
- 样式定义：electron/renderer/styles.css
- 项目说明与约束：README.md、AGENTS.md

```mermaid
graph TB
UI["渲染进程 app.js<br/>状态与交互"] --> Bridge["预加载 preload.js<br/>IPC 桥接"]
Bridge --> Main["主进程 main.js<br/>会话文件读写/重命名"]
Main --> FS["文件系统<br/>.jsonl 会话头更新"]
UI --> State["本地状态 aiRenameMode / aiRenameText"]
State --> AutoMode["自动零计算模式<br/>firstMessage截断"]
State --> ManualMode["手动AI模式<br/>文学四字风格"]
Identity["身份配置界面<br/>index.html"] --> IdentityModal["身份设置模态框<br/>showIdentityModal()"]
IdentityModal --> MemoryIPC["记忆层IPC调用<br/>memory:getIdentity/saveIdentity"]
MemoryIPC --> MemoryFiles["记忆文件<br/>AI.md / USER.md"]
```

图表来源
- [app.js:160-163](file://electron/renderer/app.js#L160-L163)
- [app.js:637-651](file://electron/renderer/app.js#L637-L651)
- [app.js:4104-4143](file://electron/renderer/app.js#L4104-L4143)
- [app.js:834-893](file://electron/renderer/app.js#L834-L893)
- [preload.js:72](file://electron/preload.js#L72)
- [preload.js:82-83](file://electron/preload.js#L82-L83)
- [main.js:2410-2437](file://electron/main.js#L2410-L2437)
- [main.js:3443-3507](file://electron/main.js#L3443-L3507)
- [index.html:310-316](file://electron/renderer/index.html#L310-L316)
- [index.html:352-375](file://electron/renderer/index.html#L352-L375)

章节来源
- [README.md:1-236](file://README.md#L1-L236)
- [AGENTS.md:158-208](file://AGENTS.md#L158-L208)

## 核心组件
- 渲染进程状态与交互
  - 维护 aiRenameMode 与 aiRenameText，用于控制"正在 AI 重命名"的显示抑制与文本累积。
  - 提供输出后处理（URL/代码块语言推断），提升展示质量。
  - 支持自动零计算重命名和手动AI重命名两种模式。
  - **新增** 身份配置状态管理，维护 aiName 和 userName 字段。
- IPC 桥接
  - 暴露 renameSession(sessionPath, newTitle) 给渲染进程调用。
  - **新增** getIdentity() 和 saveIdentity(aiName, userName) 方法用于身份配置。
- 主进程会话重命名
  - 校验 .jsonl 文件存在性
  - 读取首行 header JSON，更新 title 字段
  - 写回文件，返回成功或错误信息
- **新增** 记忆层文件操作
  - 解析和更新 AI.md 文件中的 AI 名字字段
  - 解析和更新 USER.md 文件中的用户称呼字段
  - 提供 Markdown 字段解析器，支持 `- 字段名：值` 格式

**更新** 新增三层状态检查机制，防止竞态条件导致的UI状态不一致。新增身份配置功能，通过模态界面让用户设置AI名称和用户称呼。

章节来源
- [app.js:160-163](file://electron/renderer/app.js#L160-L163)
- [app.js:32-91](file://electron/renderer/app.js#L32-L91)
- [app.js:637-651](file://electron/renderer/app.js#L637-L651)
- [app.js:4104-4143](file://electron/renderer/app.js#L4104-L4143)
- [app.js:834-893](file://electron/renderer/app.js#L834-L893)
- [preload.js:72](file://electron/preload.js#L72)
- [preload.js:82-83](file://electron/preload.js#L82-L83)
- [main.js:2410-2437](file://electron/main.js#L2410-L2437)
- [main.js:3443-3507](file://electron/main.js#L3443-L3507)

## 架构总览
下图展示了"AI 智能重命名"从用户触发到落盘的完整流程，包括渲染进程状态切换、IPC 调用、主进程文件解析与写入，以及新增的身份配置流程。

```mermaid
sequenceDiagram
participant U as "用户"
participant R as "渲染进程(app.js)"
participant P as "预加载(preload.js)"
participant M as "主进程(main.js)"
participant F as "文件系统"
Note over U,F : 重命名流程
U->>R : 点击"AI 重命名"按钮
R->>R : 设置 aiRenameMode=当前会话, 清空 aiRenameText
R->>P : invoke('sessions : rename', sessionPath, newTitle)
P->>M : IPC 'sessions : rename'
M->>F : 校验 .jsonl 存在
M->>F : 读取首行 header JSON
M->>M : 更新 header.title = newTitle
M->>F : 写回修改后的首行
M-->>P : {success : true}
P-->>R : 返回结果
R->>R : 清除 aiRenameMode, 刷新列表
Note over U,F : 身份配置流程
U->>R : 打开设置 → AI 身份
R->>P : invoke('memory : getIdentity')
P->>M : IPC 'memory : getIdentity'
M->>F : 读取 AI.md 和 USER.md
M-->>P : {aiName, userName, needsSetup}
P-->>R : 返回身份信息
R->>R : 显示身份设置模态框
U->>R : 输入AI名称和用户称呼
R->>P : invoke('memory : saveIdentity', name, title)
P->>M : IPC 'memory : saveIdentity'
M->>F : 更新 AI.md 和 USER.md 文件
M-->>P : {ok : true}
P-->>R : 保存成功
R->>R : 更新本地状态，关闭模态框
```

图表来源
- [app.js:160-163](file://electron/renderer/app.js#L160-L163)
- [app.js:637-651](file://electron/renderer/app.js#L637-L651)
- [app.js:834-893](file://electron/renderer/app.js#L834-L893)
- [preload.js:72](file://electron/preload.js#L72)
- [preload.js:82-83](file://electron/preload.js#L82-L83)
- [main.js:2410-2437](file://electron/main.js#L2410-L2437)
- [main.js:3443-3507](file://electron/main.js#L3443-L3507)

## 详细组件分析

### 渲染进程：AI 重命名状态与交互
- 状态字段
  - aiRenameMode：非空表示正在进行 AI 重命名，用于抑制渲染或提示中。
  - aiRenameText：累积 AI 返回的标题文本，便于预览与提交。
  - **新增** aiName 和 userName：存储AI名称和用户称呼信息。
- 输出后处理
  - fixBareUrls：将裸链接转换为 Markdown 链接，兼容 file:/// 与 Windows 路径。
  - fixCodeBlockLanguages：自动推断代码块语言，提升可读性。
- 交互建议
  - 进入重命名模式时，禁用输入框并显示"生成中…"；收到结果后恢复。
  - 若生成失败，保留旧标题并提供重试入口。

**更新** 新增三层状态检查机制：
1. 消息开始阶段：`if (state.aiRenameMode) return;` 防止用户消息渲染
2. 消息更新阶段：在text_delta中累积aiRenameText而非渲染
3. 消息发送阶段：`if (!state.aiRenameMode)` 阻止正常消息发送

**新增** 身份配置功能：
- initIdentity()：启动时获取当前身份配置，首次启动且未跳过时弹出设置框
- showIdentityModal()：显示身份设置模态框，支持填写AI名称和用户称呼
- 支持"稍后再说"选项，通过localStorage记录跳过状态

章节来源
- [app.js:160-163](file://electron/renderer/app.js#L160-L163)
- [app.js:32-91](file://electron/renderer/app.js#L32-L91)
- [app.js:2279-2280](file://electron/renderer/app.js#L2279-L2280)
- [app.js:2314-2316](file://electron/renderer/app.js#L2314-L2316)
- [app.js:3277](file://electron/renderer/app.js#L3277)
- [app.js:834-893](file://electron/renderer/app.js#L834-L893)

### IPC 桥接：renameSession 与身份配置
- 暴露方法：renameSession(sessionPath, newTitle)
- 作用：将渲染进程的请求转发至主进程 IPC 处理器，完成会话标题更新。
- **新增** 身份配置IPC方法：
  - getIdentity()：获取当前AI身份配置
  - saveIdentity(aiName, userName)：保存新的身份配置

章节来源
- [preload.js:72](file://electron/preload.js#L72)
- [preload.js:82-83](file://electron/preload.js#L82-L83)

### 主进程：会话重命名逻辑与身份配置
- 入口：ipcMain.handle('sessions:rename', ...)
- 处理步骤
  - 校验 sessionPath 以 .jsonl 结尾且存在
  - 读取文件首行作为 header JSON
  - 将 header.title 设置为 newTitle
  - 写回文件首行，保持后续内容不变
  - 返回 { success: true } 或 { error: message }
- 并发安全
  - 仅修改首行 header，避免读取整个文件导致与内核并发 append 冲突丢数据。

**新增** 身份配置IPC处理：
- memory:getIdentity：读取AI.md和USER.md文件，解析其中的字段信息
- memory:saveIdentity：更新AI.md和USER.md文件中的相应字段
- 支持Markdown格式的字段解析：`- 字段名：值`

章节来源
- [main.js:2410-2437](file://electron/main.js#L2410-L2437)
- [main.js:3443-3507](file://electron/main.js#L3443-L3507)

### 自动标题生成（补充）
- 当会话无标题时，系统会基于首条用户消息截取前若干字符作为标题，并写入 header.title 与追加 title 事件，保证列表展示一致性。
- 该逻辑与"AI 智能重命名"互补：前者兜底自动生成，后者由用户触发或上层策略驱动。

**更新** 新增自动零计算重命名模式：
- 在agent_end事件中，系统自动检测会话是否需要重命名
- 使用session.firstMessage进行截断处理（最多20字符）
- 零算力消耗，不调用AI模型
- 适用于首次对话结束后的快速标题生成

章节来源
- [main.js:1954-2022](file://electron/main.js#L1954-L2022)
- [app.js:637-651](file://electron/renderer/app.js#L637-L651)

### 手动AI重命名模式（新增）
- 用户触发时，系统构建文学四字风格的提示词
- 优先读取gap-fill文件获取高密度上下文摘要
- 其次使用内存中的firstMessage作为备选
- 生成≤10字的中文标题，要求文艺凝练有意境
- 禁止工程日志风格（如"修复XXX问题"）

**更新** 会话历史加载性能优化：
- 优先读取gap-fill文件（compaction后的高密度摘要）
- 其次使用session.firstMessage（内存中直接取，零延迟）
- 避免频繁的文件I/O操作

章节来源
- [app.js:4104-4143](file://electron/renderer/app.js#L4104-L4143)

### 三层状态检查机制（新增）
为防止竞态条件，系统在三个关键位置检查aiRenameMode状态：

1. **消息开始检查**：`handleMessageStart`中阻止用户消息渲染
2. **消息更新检查**：`handleMessageUpdate`中累积文本而非渲染
3. **消息发送检查**：`sendMessage`中阻止正常消息发送

这种设计确保在AI重命名模式下，用户的正常交互不会干扰重命名过程。

章节来源
- [app.js:2279-2280](file://electron/renderer/app.js#L2279-L2280)
- [app.js:2314-2316](file://electron/renderer/app.js#L2314-L2316)
- [app.js:3277](file://electron/renderer/app.js#L3277)

### 身份配置模态界面（新增）
- **界面结构**：包含AI名称输入框、用户称呼输入框、错误提示区域和操作按钮
- **交互逻辑**：
  - 首次启动时自动弹出，可跳过设置
  - 支持实时验证，至少需要填写一项
  - 保存后更新本地状态并持久化到记忆文件
  - 可通过设置菜单随时重新配置
- **数据存储**：
  - AI名称写入AI.md文件的`- 名字：值`字段
  - 用户称呼写入USER.md文件的`- 称呼：值`字段

章节来源
- [index.html:310-316](file://electron/renderer/index.html#L310-L316)
- [index.html:352-375](file://electron/renderer/index.html#L352-L375)
- [app.js:834-893](file://electron/renderer/app.js#L834-L893)
- [styles.css:2752-2757](file://electron/renderer/styles.css#L2752-L2757)

## 依赖关系分析
- 渲染进程依赖预加载桥接暴露的 IPC 方法
- 主进程依赖 Node.js fs 模块进行 .jsonl 文件的头行读写
- 会话数据结构约定：首行为 JSON header，包含 id、version、title、cwd 等字段
- **新增** 记忆系统依赖：
  - AI.md 和 USER.md 文件遵循特定Markdown格式
  - 字段格式：`- 字段名：值`
  - 支持中文冒号和英文冒号

```mermaid
graph LR
AppJS["renderer/app.js"] --> PreloadJS["preload.js"]
PreloadJS --> MainJS["electron/main.js"]
MainJS --> FS["fs.renameSync/readFileSync/writeFileSync"]
AppJS --> GapFill["gap-fill文件<br/>高密度摘要"]
AppJS --> FirstMsg["firstMessage<br/>内存缓存"]
AppJS --> IdentityUI["身份配置界面<br/>index.html"]
IdentityUI --> IdentityState["身份状态<br/>aiName/userName"]
IdentityState --> MemoryFiles["记忆文件<br/>AI.md / USER.md"]
```

图表来源
- [app.js:160-163](file://electron/renderer/app.js#L160-L163)
- [app.js:4112](file://electron/renderer/app.js#L4112)
- [app.js:4122](file://electron/renderer/app.js#L4122)
- [app.js:834-893](file://electron/renderer/app.js#L834-L893)
- [preload.js:72](file://electron/preload.js#L72)
- [preload.js:82-83](file://electron/preload.js#L82-L83)
- [main.js:2410-2437](file://electron/main.js#L2410-L2437)
- [main.js:3443-3507](file://electron/main.js#L3443-L3507)
- [index.html:310-316](file://electron/renderer/index.html#L310-L316)

章节来源
- [AGENTS.md:158-208](file://AGENTS.md#L158-L208)

## 性能考虑
- 只读/写首行 header，避免全量 I/O，降低与内核并发写入的冲突风险。
- 短路径校验与快速失败（文件不存在、格式非法）减少无效开销。
- 渲染层使用局部状态切换，避免频繁 DOM 重建。
- **新增** 自动零计算模式避免AI调用开销，提升响应速度。
- **新增** gap-fill文件优先读取，减少大文件解析时间。
- **新增** firstMessage内存缓存，避免重复文件读取。
- **新增** 身份配置采用增量更新，只修改相关字段而不重写整个文件。

**更新** 性能优化重点：
- 自动重命名：零算力消耗，直接字符串处理
- 手动重命名：优先使用内存数据和gap-fill文件
- 状态检查：O(1)复杂度，避免不必要的DOM操作
- 身份配置：Markdown字段解析采用正则匹配，避免全文件扫描

[本节为通用指导，不直接分析具体文件]

## 故障排查指南
- 症状：重命名失败，提示"会话文件未找到"
  - 检查 sessionPath 是否指向有效的 .jsonl 文件
  - 确认文件未被占用或权限不足
- 症状：标题未更新
  - 确认 header JSON 合法，首行可被正确解析
  - 检查 writeFileSync 是否抛出异常
- 症状：列表未刷新
  - 渲染进程需在成功后清理 aiRenameMode 并触发列表重载
- **新增** 症状：自动重命名未生效
  - 检查会话是否为首次对话（path不以__new__开头）
  - 确认session.firstMessage不为空
- **新增** 症状：AI重命名模式卡住
  - 检查三层状态检查是否正确重置aiRenameMode
  - 确认agent_end事件正常触发
- **新增** 症状：身份配置保存失败
  - 检查AI.md和USER.md文件是否存在且可写
  - 确认文件格式符合Markdown规范
  - 验证字段格式是否正确（`- 字段名：值`）

章节来源
- [main.js:2410-2437](file://electron/main.js#L2410-L2437)
- [main.js:3443-3507](file://electron/main.js#L3443-L3507)
- [app.js:637-651](file://electron/renderer/app.js#L637-L651)
- [app.js:834-893](file://electron/renderer/app.js#L834-L893)
- [app.js:2279-2280](file://electron/renderer/app.js#L2279-L2280)
- [app.js:4139](file://electron/renderer/app.js#L4139)

## 结论
Tiffa 的"AI 智能重命名"通过渲染进程状态管理、IPC 桥接与主进程轻量文件操作，实现了低开销、高可靠的会话标题更新。配合自动标题生成机制，既满足弱模型环境下的稳定性，又保留了用户可控性与扩展空间。

**更新** 新版本的增强特性：
- 自动零计算模式提供即时响应，无需AI调用
- 手动AI模式支持文学四字风格，提升标题质量
- 三层状态检查确保并发安全性
- gap-fill文件和firstMessage优化提升性能
- **新增** 身份配置功能，允许用户自定义AI名称和用户称呼
- **新增** 记忆系统集成，持久化身份配置到AI.md和USER.md文件

未来可在上层策略中接入 LLM 生成标题，结合规则与记忆系统进一步提升标题质量与一致性。身份配置功能也为个性化AI助手体验奠定了基础。

[本节为总结性内容，不直接分析具体文件]

## 附录
- 相关启动方式与环境变量参考 README.md 与 AGENTS.md，便于定位运行环境与路径配置。
- 如需扩展重命名策略（如批量重命名、模板化命名），建议在 IPC 层新增接口并在主进程中统一校验与审计。

**更新** 新增功能参考：
- 自动重命名逻辑位于 `app.js:637-651`
- 手动AI重命名逻辑位于 `app.js:4104-4143`
- 三层状态检查位于 `app.js:2279-2280`, `app.js:2314-2316`, `app.js:3277`
- **新增** 身份配置逻辑位于 `app.js:834-893`
- **新增** 身份配置界面位于 `index.html:310-316`, `index.html:352-375`
- **新增** 记忆层IPC处理位于 `main.js:3443-3507`

章节来源
- [README.md:1-236](file://README.md#L1-L236)
- [AGENTS.md:158-208](file://AGENTS.md#L158-L208)