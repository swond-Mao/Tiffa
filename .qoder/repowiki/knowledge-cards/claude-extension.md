# 知识卡：Claude 化扩展

## 模块标识

- **路径**: `plugins/claude-mode-extension.ts`（546 行）
- **运行环境**: Bun（TypeScript 原生，使用 `import.meta.dir`）
- **职责**: 安全拦截、行为约束注入、PROJECT.md 管理、gap-fill 断片补救、审计日志、error 续行
- **版本**: v6.2

## 设计原则

"搭内核的车，不造内核的轮"——只保留内核原生不覆盖的功能。已删除 10+ 项内核已覆盖的功能。

## 6 个 Hooks

| # | 事件 | 功能 | 返回值 |
|---|------|------|--------|
| 0 | `session_start` | 移除 eval/hub，确保记忆工具可用 | — |
| 1 | `before_agent_start` | 注入 constraints + PROJECT.md + 记忆工具提示 | `{ systemPrompt: [...] }` |
| 2 | `tool_call` | 危险路径/配置文件/.env 拦截 + 静默检测 | `{ block }` / `{ steer }` |
| 3 | `session.compacting` | gap-fill 提取 + compact dump + 立即注入 | `{ context: [...] }` |
| 4 | `session_stop` | error 续行一次（5秒延迟） | `{ continue: true }` |
| 5 | `tool_result` | 审计日志 + 堆栈泄露拦截 | `{ content }` (sanitized) |

## 安全拦截矩阵

| 拦截类型 | 触发工具 | 检测方式 |
|---------|---------|---------|
| 危险路径 | edit/write | 正则：System32/Windows/Program Files/config.yml/models.yml/扩展自身 |
| 密钥文件读取 | read/bash/shell | .env + .pem/.key/.crt + 敏感词文件名 |
| workspace mkdir | edit/write/bash | 路径解析判断是否为新一级子目录 |
| 静默调用 | 任意 | 计数器 ≥3 → steer |
| 堆栈泄露 | tool_result | ≥2 行 `at xxx (file:line:col)` |

## 关键路径

```typescript
PORTABLE_ROOT = resolve(AGENT_DIR, "..", "..")  // 从 data/agent 上溯两级
INBOX_DIR = DATA_DIR/memory/inbox               // gap-fill 落盘
LOG_DIR_PATH = DATA_DIR/log                     // 审计日志 JSONL
```

## 依赖关系

- 加载方式：内核启动时 `-e` 参数加载
- 上游：内核 hook 系统提供事件
- 下游：`data/memory/constraints-inject.md`（读取）、`PROJECT.md`（读写）、`data/log/`（写入）
- 保护：自身被 tool_call hook 保护，AI 不可修改

## 修改注意

- 运行在 Bun 而非 Node，可用 `import.meta.dir`、顶级 await 等
- 扩展不能注册工具、不能修改内核行为，只能通过 hook 返回值影响
- 修改后需重启 Tiffa 实例生效
- 此文件受 DANGER_PATH_PATTERNS 保护，agent 无法自行修改
