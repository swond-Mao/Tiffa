# Claude 化扩展

## 概述

`plugins/claude-mode-extension.ts`（v6.2，546 行）是 Tiffa 的行为增强层，运行在 **Bun** 环境（非 Node），使用 TypeScript + `import.meta.dir`。

设计理念：**搭内核的车，不造内核的轮**——只保留内核原生不覆盖的功能。

## 已删除功能（内核已覆盖）

| 功能 | 替代方 |
|------|--------|
| AGENTS.md 注入 | 内核自动从 CWD 查找注入 |
| MEMORY.md 注入 | Mnemopi autoRecall |
| 违反检测（4 个检测器） | TTSR 实时拦截 |
| 权限契约审批 | 内核内置审批 |
| XML 工具调用纠正 | TTSR no-xml-toolcall.md |
| /omfg 命令 | Electron 主进程拦截 |
| memory_write/search 工具 | Mnemopi 原生 retain/recall |
| skill 工具 | 内核 manage_skill + managed-skills |
| gap-fill 断片补救 | 保留（见下） |
| constraints.md 注入 | TTSR + AGENTS.md |

## 6 个 Hooks

### Hook 0: session_start

```typescript
pi.on("session_start", async () => {
  await sanitizeTools("session_start")
})
```

- 移除 `eval`、`hub` 工具（弱模型用不了，占工具列表位置）
- 确保记忆工具（`recall`/`retain`/`reflect`/`memory_edit`）在活跃列表中

### Hook 1: before_agent_start

每轮 agent 启动前执行，返回 `{ systemPrompt: [...] }` 注入 system prompt 前缀：

1. **行为约束注入**：读取 `data/memory/constraints-inject.md`
2. **PROJECT.md 生成/注入**：
   - 项目根目录无 PROJECT.md → 自动生成脚手架（项目概述/关键决策/注意事项/外部服务）
   - 有 → 读取并注入
3. **记忆工具提示**：告知 agent 可用 recall/retain/memory_edit

同时重置 `silentToolCallCount = 0`。

### Hook 2: tool_call

运行时拦截，每次工具调用前检查：

**静默工具调用检测：**
- 连续 3 次工具调用无文字说明 → 返回 `{ steer: "请先说明进展" }`

**写入工具拦截（edit/write）：**
| 检查 | 动作 |
|------|------|
| 危险路径（System32/Windows/Program Files/config.yml/models.yml/扩展自身） | `{ block: true }` |
| 配置文件自改 | `{ block: true }` |
| workspace 根目录新建一级子目录 | `{ block: true }` |

**读取工具拦截（read/bash/shell）：**
| 检查 | 动作 |
|------|------|
| .env 系列文件 | `{ block: true }` |
| 证书/密钥文件（.pem/.key/.crt/.p12/.pfx/.ovpn） | `{ block: true }` |
| 含敏感词文件名（password/secret/token/api_key） | `{ block: true }` |

**bash mkdir 拦截：**
- 在 workspace 根目录下 mkdir 新子目录 → `{ block: true }`

### Hook 3: session.compacting

上下文压缩时触发，执行 gap-fill 断片补救：

```
1. cleanupGapFills() — 清理 60 分钟前的旧 gap-fill 文件
2. compact dump — 最近 50 条消息原文落盘到 inbox/compact-{sessionId}-{ts}.txt
3. gap-fill 提取：
   - 已读文件（readFileSet）→ 避免重读
   - 改动文件（fileSet）
   - 关键命令（cmdSet，排除 ls/cd/echo 等）
   - 决策要点（decisionLines，正则匹配关键词，上限 60 条）
4. 落盘：inbox/gap-fill-{sessionId}.md
5. 立即注入：return { context: [gapFill内容] }（不等下轮）
```

### Hook 4: session_stop

error 续行机制（一次制）：

```typescript
if (reason === "error" && !hasContinuedAfterError) {
  hasContinuedAfterError = true
  await sleep(5000)  // 5 秒延迟
  return { continue: true, additionalContext: "上一轮出错，请继续" }
}
```

- 正常完成（`reason === "complete"`）时重置标记
- 最多续行一次，防止无限循环

### Hook 5: tool_result

- **审计日志**：每次工具调用结果写入 `data/log/{date}.jsonl`
- **堆栈泄露拦截**：错误结果含 ≥2 行 `at xxx (file:line:col)` → 替换为安全提示

## 辅助模块

### 审计日志

```typescript
auditLog(entry) → data/log/{yyyy-MM-dd}.jsonl
// 每行一个 JSON：{ ts, event, tool/reason, ... }
```

### 路径常量

```typescript
PLUGIN_DIR    = import.meta.dir
AGENT_DIR     = $PI_CODING_AGENT_DIR || ~/.omp/agent
PORTABLE_ROOT = resolve(AGENT_DIR, "..", "..")
DATA_DIR      = resolve(AGENT_DIR, "..")
MEMORY_DIR    = DATA_DIR/memory
INBOX_DIR     = MEMORY_DIR/inbox
LOG_DIR_PATH  = DATA_DIR/log
```

### 危险路径模式

```typescript
const DANGER_PATH_PATTERNS = [
  /\\System32\\/i, /\\Windows\\/i, /\\Program\s*Files/i,
  /\\config\.yml$/i, /\\models\.yml$/i,
  /\\claude-mode-extension\.ts$/i,
]
```

## 设计约束

- 扩展**不能**修改内核行为，只能通过 hook 返回值影响（block/steer/context/continue）
- 扩展**不能**自行注册工具（已删除 skill/memory 工具，交给内核）
- 扩展文件自身受 tool_call hook 保护，AI 不可修改
