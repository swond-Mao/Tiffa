# Electron 桌面前端

## 架构概述

Electron 主进程（`electron/main.js`，~2248 行）承担三大职责：
1. **TiffaInstanceManager** — 多实例生命周期管理
2. **IPC Handler** — 渲染进程 ↔ 主进程通信（37+ 个 handler）
3. **窗口管理** — BrowserWindow 创建、DevTools、菜单

## TiffaInstance — 单子进程生命周期

每个 Tiffa 子进程由一个 `TiffaInstance` 对象管理：

```javascript
class TiffaInstance {
  cwd            // 工作目录
  sessionId      // null=项目级 / UUID=对话级
  process        // child_process (spawn)
  rl             // readline.Interface（stdout 逐行解析）
  ready          // 是否收到 'ready' 事件
  agentRunning   // agent 是否正在执行
  pendingCommands // Map<id, {resolve, reject, timer}>
  crashCount     // 连续崩溃计数（上限 3 次自动重启）
  isPrewarming   // embedding 预热中（过滤噪音事件）
}
```

### 启动流程

```
start() → spawn(BUN_EXE, [cli.js, --mode, rpc-ui, -e, extension.ts])
       → readline 逐行解析 stdout
       → 收到 {type:"ready"} → ready=true
       → 3秒后发送 /memory rebuild 预热 embedding（30秒超时）
```

### 环境变量注入

```javascript
env = {
  ...process.env,
  LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',       // POSIX shell UTF-8
  PYTHONIOENCODING: 'utf-8:replace',          // Python UTF-8
  PI_CODING_AGENT_DIR: PORTABLE_ROOT/data/agent,
  HOME: PORTABLE_ROOT/home,
  USERPROFILE: PORTABLE_ROOT/home,
}
```

### 崩溃自动重启

- 条件：`!userKilled && code !== 0 && crashCount < 3`
- 延迟：3 秒后重启
- 成功启动后重置 `crashCount`

### 进程终止

- `kill()` — 标记 userKilled + `_killTree(pid)`（Windows 用 `taskkill /PID /T /F`）
- `forceKill(reason)` — stall 检测超时后强制终止

## TiffaInstanceManager — 多实例管理器

```javascript
class TiffaInstanceManager {
  instances: Map<key, TiffaInstance>  // key = "resolvedCwd#sessionId"
  spawning: Map<key, Promise>         // 防竞态：复用正在 spawn 的 Promise
  activeKey: string                   // 当前活跃实例
  activeCwd: string
}
```

| 特性 | 值 |
|------|---|
| 最大实例数 | 8 (`MAX_INSTANCES`) |
| 就绪检测 | 100ms 轮询，最多 300 次（30 秒） |
| LRU 淘汰 | 淘汰 `lastActiveTime` 最久且非 activeKey 的实例 |
| 命令超时 | 5 分钟（`sendCommand` 的 Promise reject） |

### 实例类型

| 类型 | key 格式 | 触发 |
|------|---------|------|
| 项目级 | `cwd#project` | `activate(cwd)` — 切换项目 |
| 对话级 | `cwd#sessionId` | `activateSession(cwd, sessionId)` — 打开对话标签 |

### 事件转发

所有子进程事件附加 `_cwd` + `_sessionId` 标记后通过 `mainWindow.webContents.send('tiffa:event', event)` 转发到渲染进程。预热期间（`isPrewarming=true`）过滤噪音。

## IPC Handler 分类

### Tiffa 管理 (14)

| Handler | 说明 |
|---------|------|
| `tiffa:send` | 发送消息（含 /omfg 拦截逻辑） |
| `tiffa:abort` | 中止当前 agent |
| `tiffa:setModel` | 切换模型 |
| `tiffa:getModels` | 获取可用模型列表 |
| `tiffa:isReady` | 查询就绪状态 |
| `tiffa:getState` | 获取内核状态 |
| `tiffa:diagnostics` | 诊断信息（pid/pending/stdin） |
| `tiffa:steer` | 注入引导消息 |
| `tiffa:followUp` | 追加消息 |
| `tiffa:extensionResponse` | 扩展 UI 交互响应 |
| `tiffa:compact` | 手动触发上下文压缩 |
| `tiffa:command` | 通用命令透传 |
| `tiffa:activate` | 激活项目级实例 |
| `tiffa:activateSession` | 激活对话级实例 |

### 文件系统 (4)

`fs:listDir` / `fs:readFile`（5MB 上限）/ `fs:writeFile`（限 PORTABLE_ROOT 内）/ `fs:readImage`

### 会话管理 (16)

项目列表/会话列表/切换/新建/历史加载/归档/删除/重命名/导出 HTML 等。

### 模型配置 (5)

`models:read` / `models:write` / `models:restart` / `models:writeProvider` / `models:deleteProvider`

## /omfg 命令拦截

主进程在 `tiffa:send` 中拦截 `/omfg <complaint>`（或 `/吐槽`）：
1. 读取 `data/agent/rules/` 现有规则列表
2. 构造 TTSR 规则生成 prompt（OI3 标准格式）
3. 替换原始消息，让模型直接 `write` 规则文件
4. 即时生效，无需重启

## Preload 桥接

`electron/preload.js`（133 行）通过 `contextBridge.exposeInMainWorld('tiffaDesktop', {...})` 暴露受控 API：
- Tiffa 命令代理（send/abort/setModel/steer 等）
- 事件监听（`onEvent` / `onExited`）
- 文件系统操作
- 会话/项目管理
- 渲染库（marked + hljs，主进程侧预配置）
- 剪贴板 + 文件路径解析

安全配置：`contextIsolation: true`，`nodeIntegration: false`，`sandbox: false`（preload 需 fs 访问）。
