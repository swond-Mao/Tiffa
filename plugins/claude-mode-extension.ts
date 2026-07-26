/**
 * claude-mode-extension.ts — omp 扩展 v6.0
 *
 * 精简理念：搭 omp 的车，不造 omp 的轮
 *
 * 已删除（omp 原生已覆盖 / 不再需要）：
 * - AGENTS.md 注入 → omp 自动从 CWD 查找注入
 * - MEMORY.md 注入 → Mnemopi autoRecall
 * - PROJECT.md 注入 → Mnemopi per-project 隔离
 * - 违反检测（4 个检测器） → TTSR 实时拦截
 * - 权限契约审批 → omp 内置审批
 * - XML 工具调用纠正 → TTSR no-xml-toolcall.md
 * - 敏感信息检测 → 不再需要
 * - /omfg 命令 → Electron 主进程已拦截
 * - memory_write 工具 → Mnemopi 原生 retain
 * - memory_search 工具 → Mnemopi 原生 recall
 * - gap-fill 断片补救 → 改用原生记忆管理
 * - constraints.md 注入 → 改用原生记忆管理
 *
 * - skill 工具 → omp 原生 manage_skill + managed-skills 目录
 *
 * 保留（omp 不覆盖）：
 * - 危险路径/配置文件拦截
 * - 静默工具调用检测
 * - 审计日志
 * - error 续行（最小化）
 * - hub 工具移除
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"

// ── 路径常量 ──
const PLUGIN_DIR = import.meta.dir
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || process.env.USERPROFILE || "~", ".omp", "agent")
const PORTABLE_ROOT = resolve(AGENT_DIR, "..", "..")
const DATA_DIR = resolve(AGENT_DIR, "..")
const LOG_DIR_PATH = join(DATA_DIR, "log")
const PLUGIN_LOG = join(PLUGIN_DIR, "claude-mode.log")

// ── 日志 ──
function log(category: string, payload: string | string[] | unknown) {
  const ts = new Date().toISOString()
  const lines = Array.isArray(payload) ? payload : [payload]
  const text = lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join(" | ")
  try { appendFileSync(PLUGIN_LOG, `[${ts}] [${category}] ${text}\n`, "utf8") } catch {}
}

function ensureDir(dir: string) {
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch {}
}

// ── 审计日志 ──
function auditLog(entry: Record<string, unknown>) {
  try {
    ensureDir(LOG_DIR_PATH)
    entry.ts = new Date().toISOString()
    const today = new Date().toISOString().split("T")[0]
    appendFileSync(join(LOG_DIR_PATH, `${today}.jsonl`), JSON.stringify(entry) + "\n", "utf8")
  } catch {}
}

// ── 危险路径模式 ──
const DANGER_PATH_PATTERNS = [
  /\\System32\\/i, /\\Windows\\/i, /\\Program\s*Files/i,
  /\\config\.yml$/i, /\\models\.yml$/i,
  /\\claude-mode-extension\.ts$/i,
]

function isDangerousPath(fp: string): boolean {
  return DANGER_PATH_PATTERNS.some(p => p.test(fp))
}

// ═══════════════════════════════════════════════════════════
// 扩展入口
// ═══════════════════════════════════════════════════════════
export default async function (pi: any) {
  ensureDir(LOG_DIR_PATH)

  let agentTurnCount = 0
  let silentToolCallCount = 0
  const SILENT_TOOL_CALL_THRESHOLD = 3

  log("init", [
    "=== claude-mode extension loaded (v6.0) ===",
    `pid: ${process.pid}`,
    `portableRoot: ${PORTABLE_ROOT}`,
  ])

  // ── 0. session_start ── 移除无用工具
  pi.on("session_start", async () => {
    try {
      const all = pi.getActiveTools()
      const removed = ["eval", "hub"]
      const filtered = all.filter(t => !removed.includes(t))
      if (filtered.length < all.length) {
        await pi.setActiveTools(filtered)
        const gone = all.filter(t => !filtered.includes(t))
        log("session_start", `removed [${gone.join(", ")}] (${all.length} → ${filtered.length})`)
      }
    } catch (err: any) {
      log("session_start.error", err?.message || String(err))
    }
  })

  // ── 1. before_agent_start ── 静默工具调用计数重置
  pi.on("before_agent_start", async (event: any) => {
    try {
      agentTurnCount++
      silentToolCallCount = 0
    } catch (err: any) {
      log("before_agent_start.error", err?.message || String(err))
    }
  })

  // ── 2. tool_call ── 危险路径拦截 + 配置文件自改拦截 + 静默工具调用检测
  pi.on("tool_call", async (event: any) => {
    try {
      const tool = event.toolName || ""
      const input = event.input || {}

      // 静默工具调用检测
      silentToolCallCount++
      if (silentToolCallCount >= SILENT_TOOL_CALL_THRESHOLD) {
        log("tool_call.silent_warn", `silentToolCallCount=${silentToolCallCount}, tool=${tool}`)
        silentToolCallCount = 0
        return {
          steer: "你已连续调用多次工具但没有向用户说明你在做什么。请先用中文简要说明当前的进展和发现，再继续操作。",
        }
      }

      // 写入工具：检查文件路径安全性
      if (tool === "edit" || tool === "write") {
        const fp = input.filePath || input.path || ""
        if (fp) {
          // 危险路径拦截
          if (isDangerousPath(fp)) {
            log("tool_call.blocked", `${tool} -> ${fp} (dangerous path)`)
            return { block: true, reason: `[claude-mode] 禁止 AI 操作危险路径 ${fp}。` }
          }
          // 配置文件自改拦截
          const norm = String(fp).replace(/\//g, "\\").toLowerCase()
          if (
            norm.endsWith("\\config.yml") ||
            norm.endsWith("\\models.yml") ||
            norm.includes("\\plugins\\claude-mode-extension.ts")
          ) {
            log("tool_call.blocked", `${tool} -> ${fp} (config self-modification)`)
            return { block: true, reason: `[claude-mode] 禁止 AI 修改配置文件 ${fp}。` }
          }
          // 禁止在 workspace 根目录下新建一级子目录
          const workspaceDir = join(PORTABLE_ROOT, "workspace")
          const normFp = resolve(fp).replace(/\\/g, "/").toLowerCase()
          const normWs = resolve(workspaceDir).replace(/\\/g, "/").toLowerCase()
          if (normFp.startsWith(normWs + "/")) {
            const relPath = normFp.slice(normWs.length + 1)
            const firstDir = relPath.split("/")[0]
            if (firstDir && !existsSync(join(workspaceDir, firstDir))) {
              log("tool_call.blocked", `${tool} -> ${fp} (new workspace subdir: ${firstDir})`)
              return { block: true, reason: `[claude-mode] 禁止在 workspace 下新建项目目录 "${firstDir}"。` }
            }
          }
        }
      }

      // bash 工具：拦截在 workspace 根目录下 mkdir
      if (tool === "bash" || tool === "shell") {
        const cmd = String(input.command || input.content || "")
        if (/\bmkdir\b/i.test(cmd)) {
          const workspaceDir = join(PORTABLE_ROOT, "workspace")
          const normWs = resolve(workspaceDir).replace(/\\/g, "/").toLowerCase()
          const mkdirMatch = cmd.match(/mkdir\s+(?:-[^\s]*\s+)*["']?([^\s"']+)/i)
          if (mkdirMatch) {
            const target = resolve(mkdirMatch[1]).replace(/\\/g, "/").toLowerCase()
            if (target.startsWith(normWs + "/")) {
              const relPath = target.slice(normWs.length + 1)
              const firstDir = relPath.split("/")[0]
              if (firstDir && !existsSync(join(workspaceDir, firstDir))) {
                log("tool_call.blocked", `${tool} -> mkdir ${mkdirMatch[1]} (new workspace subdir)`)
                return { block: true, reason: `[claude-mode] 禁止在 workspace 下新建项目目录 "${firstDir}"。` }
              }
            }
          }
        }
      }
    } catch (err: any) {
      log("tool_call.error", err?.message || String(err))
    }
  })

  let errorContinueCount = 0
  const MAX_ERROR_CONTINUES = 2  // 连续 error 最多续行 2 次，防止死循环

  // ── 3. session_stop ── error 续行（限次，防止死循环）
  pi.on("session_stop", async (event: any) => {
    try {
      const lastMsg = event.last_assistant_message
      let reason: string
      if (lastMsg && typeof lastMsg === "object") {
        const sr = lastMsg.stopReason
        const content = Array.isArray(lastMsg.content) ? lastMsg.content : []
        const hasText = content.some((c: any) => c.type === "text" && typeof c.text === "string" && c.text.trim().length > 0)
        if (sr === "error") reason = "error"
        else if (sr === "aborted") reason = "aborted"
        else if (sr === "length") reason = "interrupted"
        else if (sr === "stop" && !hasText) reason = "interrupted"
        else if (sr === "stop") reason = "complete"
        else reason = "unknown"
      } else {
        reason = "unknown"
      }

      // 正常完成时重置计数
      if (reason === "complete") {
        errorContinueCount = 0
      }

      auditLog({ event: "session_stop", reason, stopReason: lastMsg?.stopReason, errorContinueCount })
      log("session_stop", `reason=${reason} errorContinueCount=${errorContinueCount}`)

      // 仅 error 续行，限次防止死循环
      if (reason === "error" && errorContinueCount < MAX_ERROR_CONTINUES) {
        errorContinueCount++
        log("session_stop", `continuing after error (${errorContinueCount}/${MAX_ERROR_CONTINUES})`)
        return { continue: true, additionalContext: "上一轮请求出错，请继续之前的任务。如果无法继续，向用户说明情况。" }
      }
      if (reason === "error") {
        log("session_stop", `error continue limit reached (${MAX_ERROR_CONTINUES}), stopping`)
      }
    } catch (err: any) {
      log("session_stop.error", err?.message || String(err))
    }
  })

  // ── 4. tool_result ── 审计日志
  pi.on("tool_result", async (event: any) => {
    try {
      const tool = event.toolName || "unknown"
      auditLog({ event: "tool_result", tool, isError: event.isError || false })
      log("tool_result", `tool=${tool}`)
    } catch (err: any) {
      log("tool_result.error", err?.message || String(err))
    }
  })

  log("init", "=== claude-mode extension v6.0 ready ===")
}
