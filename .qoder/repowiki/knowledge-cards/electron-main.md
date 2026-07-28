# 知识卡：Electron 主进程

## 模块标识

- **路径**: `electron/main.js`（2248 行）+ `electron/preload.js`（133 行）
- **运行环境**: Node.js (Electron 33)
- **职责**: 多实例管理、IPC 通信、窗口生命周期、/omfg 拦截

## 核心类

### TiffaInstance
单个 Tiffa 子进程封装。关键属性：`cwd`, `sessionId`, `process`, `ready`, `agentRunning`, `pendingCommands`, `crashCount`, `isPrewarming`。

### TiffaInstanceManager
多实例管理器。`instances: Map<key, TiffaInstance>`，key 格式 `resolvedCwd#sessionId`。最大 8 实例，LRU 淘汰，100ms 轮询就绪（30秒超时）。

## 通信协议

- 与内核：JSONL over stdin/stdout（spawn + readline）
- 与渲染进程：Electron IPC（ipcMain.handle / webContents.send）
- 命令模式：`sendCommand(frame)` → Promise（5分钟超时）
- 事件转发：附加 `_cwd` + `_sessionId` 后 send 到渲染进程

## 关键机制

| 机制 | 说明 |
|------|------|
| 崩溃重启 | code≠0 + !userKilled + crashCount<3 → 3秒后重启 |
| Embedding 预热 | ready 后 3秒发 /memory rebuild，30秒 isPrewarming 过滤噪音 |
| /omfg 拦截 | tiffa:send 中正则匹配 → 构造 TTSR 规则生成 prompt |
| 进程终止 | Windows: taskkill /PID /T /F（树形终止） |
| UTF-8 治理 | _utf8Env() 注入 LANG/PYTHONIOENCODING 等 |

## 依赖关系

- 上游：`start-desktop.bat` 传入 `--portable-root`
- 下游：spawn `bun.exe cli.js --mode rpc-ui -e extension.ts`
- 平行：`preload.js` 通过 contextBridge 桥接渲染进程

## 修改注意

- 此文件 2248 行，内聚性强，不要拆分
- IPC handler 全在 `setupIpc()` 函数内
- 新增 IPC 需同步更新 preload.js 的暴露 API
- `PORTABLE_ROOT` 是全局锚点，所有路径由此派生
