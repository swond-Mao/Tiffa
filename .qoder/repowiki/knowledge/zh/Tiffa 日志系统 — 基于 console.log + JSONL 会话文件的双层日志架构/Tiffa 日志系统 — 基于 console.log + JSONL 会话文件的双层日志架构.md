---
kind: logging_system
name: Tiffa 日志系统 — 基于 console.log + JSONL 会话文件的双层日志架构
category: logging_system
scope:
    - '**'
source_files:
    - electron/main.js
    - plugins/claude-mode.log
---

## 1. 使用的系统与框架

本项目**未引入专用日志框架**（如 winston、pino、log4js），而是采用两层轻量级日志方案：
- **Electron 主进程**：直接使用 Node.js `console.log` / `console.warn` / `console.error`，通过带前缀的标签（如 `[TiffaInstance:${cwd}]`、`[tiffa:stderr:${cwd}]`）区分来源。
- **Bun 内核子进程（Tiffa CLI）**：通过 JSONL 协议输出结构化事件，同时插件（claude-mode-extension.ts）将运行期日志写入 `plugins/claude-mode.log` 文本文件。
- **会话持久化**：每个对话以 `.jsonl` 文件形式按行存储结构化消息，既是数据也是可审计的日志。

## 2. 关键文件与位置
- `electron/main.js` — Electron 主进程，所有 `console.*` 调用集中于此，负责子进程生命周期、IPC、窗口事件。
- `plugins/claude-mode.log` — Claude Mode 扩展的运行日志，格式为 `[ISO时间] [event_type] key=value...`。
- `data/agent/sessions/<project>/<session>.jsonl` — 每个会话的 JSONL 对话记录（由 IPC 接口 `sessions:archiveSession` / `sessions:deleteSession` / `sessions:getUserEntries` 等管理）。
- `data/agent/config.yml` — Agent 运行时配置（可能包含日志级别等设置）。

## 3. 架构与约定
### 3.1 Electron 主进程日志
- 使用 `console.log/warn/error` 直接输出到控制台（Electron 开发者工具或终端）。
- 统一前缀约定：`[TiffaInstance:<shortCwd>]`、`[tiffa:stderr:<shortCwd>]`、`[TiffaManager]`、`[主进程]`、`[workspace]`、`[projects]`。
- stderr 管道被捕获并转发为 `console.log`，避免子进程错误丢失。
- 无日志级别过滤，无文件落盘，依赖控制台输出和外部日志收集。

### 3.2 Bun 内核与插件日志
- Tiffa CLI 通过 JSONL 协议向 stdout 输出事件（`type`、`id`、`success`、`data`、`error` 等字段）。
- Claude Mode 扩展将结构化日志追加写入 `plugins/claude-mode.log`，每行格式：`[ISO8601时间] [事件类型] 键值对`。
- 事件类型包括：`init`、`session_start`、`session_stop`、`tool_call.silent_warn`、`tool_result`、`before_agent_start` 等。

### 3.3 会话 JSONL 文件
- 每个会话一个 `.jsonl` 文件，第一行为元数据 header（含 `title`、`timestamp` 等），后续每行一条 JSON 消息。
- 支持归档（移动到 `sessions-archive/`）、删除、重命名、导出 HTML 等操作。
- 可通过 `sessions:getUserEntries` 提取用户消息用于分支功能。

## 4. 开发者应遵循的规则
1. **Electron 主进程**：使用 `console.log/warn/error` 时务必添加 `[模块名:<上下文>]` 前缀，便于在大量输出中定位来源。
2. **Bun 内核插件**：新增日志点应遵循 `plugins/claude-mode.log` 的 `[时间] [事件类型] key=value` 格式，确保可解析性。
3. **会话 JSONL**：不要直接修改已归档的 `.jsonl` 文件结构；通过 IPC 接口操作会话文件，保证一致性。
4. **无全局 logger**：项目未定义统一的 logger 模块，新增日志点需自行遵循上述约定，避免散落无标记的 `console.*` 调用。
5. **日志轮转**：当前无自动轮转机制，`claude-mode.log` 会持续增长，需外部清理策略。

## 5. 局限性
- 无结构化日志框架，无法灵活配置输出目标（文件/远程/控制台）。
- 无日志级别控制（DEBUG/INFO/WARN/ERROR），全部输出到控制台。
- 无聚合分析能力，依赖人工查看日志文件或外部采集工具。
- 会话 JSONL 文件较大时，读取性能可能成为瓶颈。