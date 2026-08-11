# 主进程模块化治理：3781 行 JS 单文件 → 按职责拆 TS 模块

## 问题根因分析

**现象**：`electron/main.js` 是 3781 行的 JS 单文件，所有逻辑（实例管理、IPC、会话管理、窗口创建、配置读写、项目发现、压缩链路、记忆召回、模型补全等）全部堆在一起。对比同源 dim 项目（oh-my-pi-UI）的 TS 模块化拆分（main.ts 902 行 + omp-pool/process/skills 三个模块），Tiffa 的主进程已严重退化。

**根因**：Tiffa 从 oh-my-pi-UI fork 后，改造过程中把原本分散在多个 TS 模块的逻辑合并到单一 JS 文件，且后续每次修 bug/加功能都追加到文件末尾（3781 行），从未拆分。

**影响**：
- 任何改动都要读 3781 行找目标位置，修改风险高
- 无法独立测试某一块逻辑（现有 21 个 main.test.js 用例依赖 `require('./main.js')` 加载整个文件）
- 新增功能时容易与已有逻辑冲突（如 IPC handler 和工具函数命名碰撞）
- 代码审查困难：一次 PR 可能改 500 行散落在各处的代码

**修复目标**：按职责拆成 8 个 TS 模块 + 1 个入口文件（TS），**纯搬移 + 同步转 TS**。每个模块拆分时就是 JS→TS 的转换，一次完成两件事。现有 21 个单测 + CI 跑绿后视为行为不变。

---

## 实现计划

### 原则

1. **零行为变更**：拆分是搬移，不改任何逻辑行。每拆一个模块立即跑 `npm run test:unit` 验证。
2. **一步到位 TS**：每个模块拆分时同步转 TypeScript，避免"先拆 JS 再改 TS"走回头路。
3. **入口文件瘦身**：main.ts 保留 Configuration（1-43 行）+ App Lifecycle（3718-3778 行）+ 测试导出（3778-3781 行），其余全部搬走。
4. **导出兼容**：编译产物 `main.js`（由 TS 编译产出）末尾 `module.exports = { TiffaInstanceManager, readTailLines, parseSessionLines }` 保持不变，通过 re-export 维持测试兼容。

### TS 编译配置

**新增** `electron/tsconfig.main.json`：
```typescript
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": ".",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["node", "electron"]
  },
  "include": ["main.ts", "modules/**/*.ts", "preload.ts"],
  "exclude": ["renderer", "node_modules", "scripts"]
}
```

**关键设置**：
- `target: "ES2022"` — 与当前 Node 22 运行时匹配
- `module: "CommonJS"` — 与现有 `require()/module.exports` 一致，不追 ESM
- `outDir: "."` — 编译产物与 `.ts` 并列（如 `modules/session-utils.ts` → `modules/session-utils.js`）
- `strict: true` — 开启严格模式（nullCheck、noImplicitAny）

**package.json 更新**：
```json
{
  "main": "main.js",
  "scripts": {
    "build:main": "tsc --project tsconfig.main.json",
    "build": "npm run build:main && npm run build:renderer",
    "typecheck": "npm run typecheck:main && npm run typecheck:renderer",
    "typecheck:main": "tsc --noEmit --project tsconfig.main.json",
    "test:unit": "node main.test.js && npm run test:renderer",
    "start": "electron ."
  }
}
```

**CI 更新**：`.github/workflows/ci.yml` 跑 `npm run build` 取代 `npm run build:renderer`。

### 类型策略

**已存在的类型**（不需要额外声明）：
- `@types/electron` — package.json devDeps 已有
- `@types/node` — TypeScript 内置
- `react`, `zustand` — renderer 已用

**需要手动加的类型**（TS 编译发现即补）：
- `global.PORTABLE_ROOT` — 入口文件声明 `declare global { namespace NodeJS { interface Global { PORTABLE_ROOT: string } }`
- `Bun.env` — 旁路插件用，加 `declare const Bun: { env: Record<string, string | undefined> }`
- 自定义接口 — `SessionInfo`, `TiffaInstanceConfig` 等按需声明

**`any` 兜底规则**：如果某段逻辑确需 `any`（如 IPC 事件参数、`yaml` 解析结果），加 `// TODO: 强类型化` 注释，不阻塞编译。

---

### 阶段一：拆分工具函数（低风险，无依赖）

#### 1. `modules/session-utils.ts` — 会话工具函数

**搬入内容**（按区域注释）：
- `_extractSessionIdFromPath()`（第 64 行）
- `_encodeSessionDirName()`（第 98 行）
- `extractWorkspaceSuffix()`（第 113 行）
- `stableSessionDirName()`（第 132 行）
- `_findSessionFile()`（第 148 行）
- `_rotateLogIfNeeded()`（第 217 行）
- `_mainLog()`（第 224 行）
- `readTailLines()`（第 256 行）— **导出，main.test.js 依赖**
- `parseSessionLines()`（第 309 行）— **导出，main.test.js 依赖**
- `_tryGenerateSessionTitle()`（第 2646 行）— 标题生成
- `parseSessionHeader()`（第 2574 行）— JSONL header 解析
- `encodeSessionDirName()` / `decodeSessionDirName()`（第 2238-2247 行）
- `extractCwdFromSessionDir()`（第 2266 行）
- `isEmptySessionDir()`（第 2302 行）
- `cwdDisplayName()`（第 2312 行）
- `parseMdField()`（第 3654 行）

**依赖**：`path`, `fs`（Node 内置），`PORTABLE_ROOT`（全局）

**导出**：全部函数 + `readTailLines`、`parseSessionLines`（供 main.ts re-export）

#### 2. `modules/config-utils.ts` — 配置读写

**搬入内容**：
- 旁路模型配置（`bypass-model.json` 读写，第 3362-3383 行）
- MCP 模型配置（`grounding.json`，第 3385-3405 行）
- 模型健康检查（`_checkModelHealth`，第 3407-3430 行）
- `resolveDefaultModelFromConfig()`（第 3220 行）
- `findProviderConfig()`（第 3236 行）
- `callCompletion()`（第 3254 行）— 轻量模型补全

**依赖**：`fs`, `path`, `yaml`（js-yaml）

**导出**：全部函数

#### 3. `modules/project-utils.ts` — 项目/工作空间管理

**搬入内容**：
- `readRemovedCwds()` / `writeRemovedCwds()` / `isRemovedCwd()` / `unremoveCwd()`（第 2014-2056 行）
- `rimraf()` / `rimrafWithRetry()`（第 2057-2085 行）
- `readProjectsJson()` / `writeProjectsJson()` / `ensureProjectInJson()` / `cleanupProjectsJson()`（第 2086-2198 行）
- `migrateSessionsToProjectsJson()`（第 2318 行）
- `migrateSessionDirsForNewRoot()`（第 2418 行）
- `discoverWorkspaceProjects()`（第 2552 行）
- `findProjectByDirName()`（第 2883 行）
- `sessionFileBelongsToCwd()`（第 2895 行）
- `deleteSessionFilesForCwd()` / `moveSessionFilesForCwd()`（第 2929-3000 行）
- 项目归档/删除四步逻辑（第 3024-3136 行）
- 单会话归档/删除/重命名（第 3138-3216 行）
- 列出归档/恢复归档/读取用户消息/导出 HTML（第 3432-3503 行）

**依赖**：`session-utils`（会话目录编码/查找）、`config-utils`（部分）、`TiffaInstanceManager`（关闭实例）

**导出**：全部函数

#### 4. `modules/computer-use-utils.ts` — Computer Use 相关

**搬入内容**：
- `isComputerUseEnabled()`（第 1788 行）
- `syncComputerUseMcp()`（第 1795 行）
- 全局记忆召回（第 3568 行）

**依赖**：`fs`, `path`, `config-utils`（grounding.json）

**导出**：全部函数

---

### 阶段二：拆分核心类（中风险，有循环依赖）

#### 5. `modules/tiffa-instance.ts` — TiffaInstance 类

**搬入内容**：
- `class TiffaInstance`（第 388-830 行）— 含 start()/事件处理/ask 记账/上下文恢复
- `_utf8Env()`（第 195 行）— TiffaInstance.start() 依赖

**依赖**：`session-utils`（_encodeSessionDirName、stableSessionDirName、_findSessionFile）、`config-utils`（callCompletion）、`computer-use-utils`（isComputerUseEnabled）、`path`, `fs`, `child_process`, `string_decoder`

**导出**：`TiffaInstance`

**注意**：TiffaInstance 内部引用 `EXTENSION_PATH`, `COMPUTER_USE_EXTENSION_PATH`, `TIFFA_CLI`, `BUN_EXE`——这些常量留在 main.ts（Configuration 区域），通过 module 导出传入。

#### 6. `modules/tiffa-manager.ts` — TiffaInstanceManager 类

**搬入内容**：
- `class TiffaInstanceManager`（第 832-1228 行）— 含 activate()/activateSession()/LRU/保活/迁移

**依赖**：`tiffa-instance`（TiffaInstance 构造）、`session-utils`（会话目录查找）

**导出**：`TiffaInstanceManager`

**测试兼容**：main.test.js 的 21 个用例依赖 `require('./main.js').TiffaInstanceManager`——编译产物 `main.js`（由 main.ts 编译）末尾 re-export：
```typescript
export { TiffaInstanceManager } from './modules/tiffa-manager';
export { readTailLines, parseSessionLines } from './modules/session-utils';
```

---

### 阶段三：拆分窗口和 IPC（高风险，需 Electron 运行时）

#### 7. `modules/window-setup.ts` — 窗口创建

**搬入内容**：
- `createWindow()`（第 1250-1315 行）
- `syncCustomStartupImage()`（第 1229-1249 行）
- 外部链接拦截逻辑（第 1298-1315 行）

**依赖**：`BrowserWindow`, `shell`, `path`, `fs`（Electron + Node）

**导出**：`createWindow`

#### 8. `modules/ipc-handlers.ts` — IPC 处理器

**搬入内容**：
- `function setupIpc()`（第 1317-3716 行）— 16 个 IPC handler + 辅助函数

**依赖**：`ipcMain`（Electron）、`TiffaInstanceManager`、`session-utils`、`config-utils`、`project-utils`、`computer-use-utils`

**导出**：`setupIpc`

---

### 阶段四：入口文件瘦身 + 验证

#### main.ts 拆分后结构

```typescript
// ── Configuration ── (第 1-43 行，转 TS)
// PORTABLE_ROOT, BUN_EXE, TIFFA_CLI, EXTENSION_PATH, ...
// 便携 userData 锁定

// ── 全局异常捕获 ── (第 233-248 行，转 TS)
// ── Global State ── (第 209-232 行，转 TS)
// tiffaManager 实例化

// ── 模块导入 ──
import { TiffaInstanceManager } from './modules/tiffa-manager';
import { readTailLines, parseSessionLines } from './modules/session-utils';
import { createWindow } from './modules/window-setup';
import { setupIpc } from './modules/ipc-handlers';
import { TiffaInstance } from './modules/tiffa-instance';

// ── App Lifecycle ── (第 3718-3778 行，转 TS)
// app.on('ready', ...)

// ── 测试导出 ──
export { TiffaInstanceManager, readTailLines, parseSessionLines };
```

拆分后 main.ts 预计约 **150-200 行**（原 3781 行），仅保留入口逻辑 + 配置 + 测试导出。

---

### 验证策略

每拆一个模块立即跑：
1. `npm run typecheck:main` — 主进程类型检查
2. `npm run typecheck:renderer` — 渲染层类型检查（不受影响）
3. `node main.test.js` — 21 个 main 单测（必须全绿）
4. `npm run test:renderer` — renderer 测试
5. `npm run build` — 编译 main + 构建 renderer 产物

全部跑绿 → 提交 → 拆下一个模块。

---

## 修改文件清单

| 文件 | 改动范围 |
|------|---------|
| `electron/main.ts` | **改写**（原 main.js）：~200 行 TS，保留 Configuration + App Lifecycle + 模块导入 + 测试导出 |
| `electron/modules/session-utils.ts` | **新建**，~400 行：会话 ID 提取/目录编码/日志/标题生成 |
| `electron/modules/config-utils.ts` | **新建**，~200 行：旁路模型/MCP/模型健康/模型补全 |
| `electron/modules/project-utils.ts` | **新建**，~500 行：projects.json/项目发现/归档/删除/迁移 |
| `electron/modules/computer-use-utils.ts` | **新建**，~100 行：Computer Use 开关/记忆召回 |
| `electron/modules/tiffa-instance.ts` | **新建**，~450 行：TiffaInstance 类 |
| `electron/modules/tiffa-manager.ts` | **新建**，~400 行：TiffaInstanceManager 类 |
| `electron/modules/window-setup.ts` | **新建**，~80 行：窗口创建/启动页 |
| `electron/modules/ipc-handlers.ts` | **新建**，~1600 行：setupIpc + 16 个 handler |
| `electron/tsconfig.main.json` | **新建**：主进程 TS 编译配置 |
| `electron/package.json` | **更新**：scripts 加 `build:main`/`typecheck:main`，main 仍指向 main.js（编译产物） |
| `electron/main.test.js` | **微调**：require 路径不变（仍 `require('./main.js')` 指向编译产物） |
| `.github/workflows/ci.yml` | **微调**：跑 `npm run build` 取代 `npm run build:renderer` |

## 风险与约束

- **循环依赖**：project-utils 引用 TiffaInstanceManager（关闭实例），TiffaInstanceManager 引用 TiffaInstance，TiffaInstance 引用 session-utils。解决：project-utils 中的"关闭实例"逻辑延迟到 ipc-handlers.ts 的 IPC handler 层处理，不放在 project-utils 内部。
- **便携自包含**：所有路径基于 `PORTABLE_ROOT`，拆模块后路径引用不变（模块内直接 `import path from 'path'`，不依赖相对路径）。
- **CI 兼容**：`.github/workflows/ci.yml` 跑 `npm run build`（先 TS 编译 main 再 vite 构建 renderer），测试接口不变。
- **用户已验证的功能**：聊天、流式、尾巴、工具调用、压缩链路——拆分不碰这些逻辑，纯搬移 + TS 编译。
- **TS 编译失败兜底**：如果某段逻辑 TS 编译不过（如 `any` 类型推断），加 `any` + `// TODO` 注释，不阻塞拆分。行为不变是最高优先级。
