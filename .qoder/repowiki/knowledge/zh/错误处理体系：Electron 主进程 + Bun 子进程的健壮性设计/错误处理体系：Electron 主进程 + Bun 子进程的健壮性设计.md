---
kind: error_handling
name: 错误处理体系：Electron 主进程 + Bun 子进程的健壮性设计
category: error_handling
scope:
    - '**'
source_files:
    - electron/main.js
    - electron/preload.js
    - electron/renderer/app.js
    - data/agent/managed-skills/comfyui-image-gen/comfy.py
    - data/agent/managed-skills/pptgen/pptgen.py
---

## 1. 整体架构与策略

Tiffa 的错误处理围绕「Electron 主进程管理 Bun 子进程」的架构展开，采用**多层防御 + 自动恢复**的设计：
- **主进程层**（`electron/main.js`）：负责子进程生命周期、IPC 桥接、崩溃检测与自动重启
- **渲染层**（`electron/renderer/app.js`）：用户界面状态同步、卡住检测、错误提示
- **技能脚本层**（Python 脚本）：各 skill 内部的 try/except 局部容错

## 2. 核心机制

### 2.1 子进程崩溃自动恢复
`TiffaInstance` 类实现了完整的崩溃恢复循环：
- 监听 `process.on('exit')` 事件，记录退出码和信号
- 非用户主动 kill 且非零退出码时，最多自动重启 3 次（`maxCrashRestart = 3`）
- 每次重启间隔 3 秒，通过 `_restartTimer` 控制
- 重启耗尽后通知渲染进程停止自动续行

### 2.2 IPC 命令超时与拒绝
`sendCommand()` 方法为每个命令设置 5 分钟超时定时器：
- 使用 `pendingCommands` Map 跟踪待响应命令
- 超时时 reject Promise 并清理资源
- 进程退出时立即拒绝所有待定命令，避免 Promise 永久挂起

### 2.3 多实例隔离与 LRU 淘汰
`TiffaInstanceManager` 管理多个 Tiffa 实例（项目级 + 对话级）：
- 最多同时运行 8 个实例（`MAX_INSTANCES = 8`）
- 超过上限时按 `lastActiveTime` 淘汰最久未活跃的实例
- 每个实例独立的生命周期、崩溃计数和重启策略

### 2.4 渲染层卡住检测
`startStallCheck()` 实现两层超时检测：
- **首次响应超时**：30 秒无 agent 事件 → 提示模型可能不可达
- **深度卡住检测**：120 秒无事件 → 提示可能卡住，建议点击停止恢复
- 通过 `state.lastEventTime` 追踪最后收到事件的时间

### 2.5 Python 技能脚本容错
各 skill 脚本（如 `comfy.py`、`pptgen.py`）使用标准的 try/except：
- 捕获 `urllib.error.HTTPError`、`json.JSONDecodeError` 等具体异常
- 对网络请求、JSON 解析等易失败操作进行局部保护
- 使用 `raise TimeoutError` 明确超时语义

## 3. 错误传播路径

```
Bun 子进程 → JSONL 事件流 → Electron 主进程 → IPC → 渲染进程 UI
```

- **子进程错误**：通过 stderr 输出到控制台日志
- **命令失败**：通过 `{success: false, error: '...'}` 格式返回
- **进程崩溃**：通过 `tiffa:exited` 事件通知渲染进程
- **UI 错误**：通过 `addNotice()` 显示用户友好的错误消息

## 4. 开发者规范

1. **子进程通信**：始终使用 `sendCommand()` 而非 `sendRaw()`，确保超时和重试机制生效
2. **错误分类**：区分可恢复错误（网络超时）和致命错误（进程崩溃），分别处理
3. **资源清理**：Promise 拒绝时必须清理定时器、Map 条目和事件监听器
4. **用户反馈**：所有错误必须通过 `addNotice()` 或状态更新告知用户
5. **安全边界**：文件操作需验证路径在 `PORTABLE_ROOT` 内，防止路径穿越攻击
6. **优雅降级**：关键功能失败时应回退到默认行为，不中断主流程

## 5. 关键文件

- `electron/main.js`：主进程错误处理核心，包含 `TiffaInstance`、`TiffaInstanceManager` 类
- `electron/preload.js`：安全的 IPC 桥接，封装错误处理逻辑
- `electron/renderer/app.js`：渲染层错误展示和用户交互恢复
- `data/agent/managed-skills/*/`：各技能脚本的局部错误处理