/**
 * claude-mode-extension.ts — omp 扩展 v2.8
 *
 * v2.8: 移除重复输出检测器（副作用大于收益）；保留 error 独立计数器
 * v2.7: error 独立计数器（MAX_ERROR_CONTINUE=1），避免确定性错误5次空转；
 *       complete/aborted 时重置 error 计数器；用户取消续行也重置 error 计数器
 * v2.6: session_stop 续行全面改用 sendUserMessage + 延迟，彻底弃用 omp 原生 { continue: true }
 *       避免 omp 内部同步续行的竞态条件导致进程崩溃；新增续行计数器（上限5次）+ 用户输入取消机制
 * v2.3: XML 工具调用自动纠正（检测→自动发约束+继续，2次失败才通知用户）
 * v2.2: 工具调用纪律改为仅第1轮约定+违反检测触发重申；恢复敏感信息检测、长时间命令执行规范
 *
 * v2.1: 恢复 v1.8 的违反检测机制（周期性重申不再需要，因为每轮已注入完整约束）
 *   - 违反检测：扫描上一轮输出，发现违规就针对性补强 + 完整约束重申
 *   - 新增"工具调用不汇报"违反检测器
 *   - after_provider_response hook 记录最近输出
 *   - 前 2 轮工具调用纪律显眼注入
 *
 * v2.0: 砍掉所有基于错误前提的功能，只保留经过验证的
 *
 * 保留：
 * - AGENTS.md / MEMORY.md / PROJECT.md 注入
 * - gap-fill 断片补救
 * - eval 工具硬拦截
 * - 危险路径 / 配置文件自改 / workspace mkdir 拦截
 * - 权限契约自动审批
 * - session.compacting gap-fill 提取 + constraints 关键条目重注入
 * - 自定义工具（memory_search / skill / memory_write）
 * - 审计日志
 *
 * 砍掉（不再恢复）：
 * - 弱模型检测 — 不再区分强弱模型
 * - 周期性约束重申 — 每轮已注入完整约束，周期重复无意义
 * - XML工具调用翻译层 — streamSimple链路有缺陷，已退役
 * - 工具调用循环拦截 — 是给streamSimple打的补丁，原生链路不需要
 * - 消息清理/截断 — 可能和omp内置冲突
 * - 输出修正 — 后处理改模型输出
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"

// ── 路径常量 ──
const PLUGIN_DIR = import.meta.dir
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || process.env.USERPROFILE || "~", ".omp", "agent")
const PORTABLE_ROOT = resolve(AGENT_DIR, "..", "..")
const DATA_DIR = resolve(AGENT_DIR, "..")
const MEMORY_DIR = join(DATA_DIR, "memory")
const MEMORY_PATH = join(MEMORY_DIR, "MEMORY.md")
const AGENTS_MD_PATH = join(PORTABLE_ROOT, "AGENTS.md")
const CONSTRAINTS_PATH = join(MEMORY_DIR, "constraints.md")
const INBOX_DIR = join(MEMORY_DIR, "inbox")
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

// ── AGENTS.md 读取（mtime 缓存）──
let agentsMdCache = { mtimeMs: 0, content: "" }
function readAgentsMd(): string {
  try {
    if (!existsSync(AGENTS_MD_PATH)) return ""
    const mtimeMs = statSync(AGENTS_MD_PATH).mtimeMs
    if (mtimeMs !== agentsMdCache.mtimeMs) {
      agentsMdCache = { mtimeMs, content: readFileSync(AGENTS_MD_PATH, "utf8").trim() }
    }
    return agentsMdCache.content
  } catch { return "" }
}

// ── MEMORY.md 读取（mtime 缓存）──
let memoryCache = { mtimeMs: 0, content: "" }
function readMemoryMd(): string {
  try {
    if (!existsSync(MEMORY_PATH)) return ""
    const mtimeMs = statSync(MEMORY_PATH).mtimeMs
    if (mtimeMs !== memoryCache.mtimeMs) {
      memoryCache = { mtimeMs, content: readFileSync(MEMORY_PATH, "utf8").trim() }
    }
    return memoryCache.content
  } catch { return "" }
}

// ── 项目级记忆（PROJECT.md）读取（mtime 缓存，按 cwd 路径隔离）──
const projectMdCache = new Map<string, { mtimeMs: number; content: string }>()
function readProjectMd(cwd: string): string {
  if (!cwd) return ""
  try {
    const projectMdPath = join(cwd, "PROJECT.md")
    if (!existsSync(projectMdPath)) return ""
    const mtimeMs = statSync(projectMdPath).mtimeMs
    const cached = projectMdCache.get(cwd)
    if (cached && cached.mtimeMs === mtimeMs) return cached.content
    const content = readFileSync(projectMdPath, "utf8").trim()
    projectMdCache.set(cwd, { mtimeMs, content })
    return content
  } catch { return "" }
}

// ── gap-fill 清理 ──
const GAPFILL_MAX_AGE_MS = 30 * 60 * 1000
const COMPACT_DUMP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function cleanupGapFills(currentSessionID: string) {
  try {
    if (!existsSync(INBOX_DIR)) return
    const files = readdirSync(INBOX_DIR).filter(
      (n) => (n.startsWith("gap-fill-") && n.endsWith(".md")) || (n.startsWith("compact-") && n.endsWith(".txt"))
    )
    const now = Date.now()
    for (const f of files) {
      const full = join(INBOX_DIR, f)
      let remove = false
      let reason = ""
      const isCompactDump = f.startsWith("compact-")
      if (!isCompactDump && currentSessionID && f !== `gap-fill-${currentSessionID}.md`) {
        remove = true; reason = "old-session"
      }
      if (!remove) {
        try {
          const stat = statSync(full)
          const maxAge = isCompactDump ? COMPACT_DUMP_MAX_AGE_MS : GAPFILL_MAX_AGE_MS
          if (now - stat.mtimeMs > maxAge) { remove = true; reason = "age" }
        } catch {}
      }
      if (remove) {
        try { unlinkSync(full); log("gapfill.cleanup", `removed ${f} (${reason})`) }
        catch (e: any) { log("gapfill.cleanup.error", `${f}: ${e?.message}`) }
      }
    }
  } catch (e: any) { log("gapfill.cleanup.error", e?.message) }
}

// ── 审计日志 ──
function LOG_FILE(): string {
  const today = new Date().toISOString().split("T")[0]
  return join(LOG_DIR_PATH, `${today}.jsonl`)
}

function auditLog(entry: Record<string, unknown>) {
  try {
    ensureDir(LOG_DIR_PATH)
    entry.ts = new Date().toISOString()
    appendFileSync(LOG_FILE(), JSON.stringify(entry) + "\n", "utf8")
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// 权限契约
// ═══════════════════════════════════════════════════════════
const TOOL_PERMISSION_TIER: Record<string, "read" | "write" | "danger"> = {
  read: "read", glob: "read", grep: "read", search: "read",
  list: "read", ls: "read", cat: "read", head: "read", tail: "read",
  skill: "read", memory_search: "read",
  edit: "write", write: "write", create: "write",
  "rm": "danger", "rmdir": "danger", "del": "danger",
  "format": "danger", "shutdown": "danger",
}

const DANGER_PATH_PATTERNS = [
  /\\System32\\/i, /\\Windows\\/i, /\\Program\s*Files/i,
  /\\config\.yml$/i, /\\models\.yml$/i,
  /\\claude-mode-extension\.ts$/i,
]

function getToolTier(toolName: string): "read" | "write" | "danger" {
  return TOOL_PERMISSION_TIER[toolName] || "write"
}

function isDangerousPath(fp: string): boolean {
  return DANGER_PATH_PATTERNS.some(p => p.test(fp))
}

// ── 敏感信息检测 ──
const SENSITIVE_PATTERNS = [
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, label: "密码" },
  { pattern: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*\S+/gi, label: "API密钥" },
  { pattern: /\b\d{17,19}\b/g, label: "身份证号" },
  { pattern: /\b1[3-9]\d{9}\b/g, label: "手机号" },
]

function detectSensitiveInfo(text: string): Array<{ label: string; match: string }> {
  const found: Array<{ label: string; match: string }> = []
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) {
      found.push({ label, match: matches[0].slice(0, 30) })
    }
  }
  return found
}

// ═══════════════════════════════════════════════════════════
// 扩展入口
// ═══════════════════════════════════════════════════════════
export default async function (pi: any) {
  ensureDir(MEMORY_DIR)
  ensureDir(INBOX_DIR)
  ensureDir(LOG_DIR_PATH)

  // ── 轮数计数器 & 违反检测状态（v2.1 恢复自 v1.8）──
  let agentTurnCount = 0
  let lastAssistantOutput = ""
  let xmlAutoRetryCount = 0
  const XML_AUTO_RETRY_MAX = 2

  // ── 自动续行状态（v2.8：error 独立计数器；重复检测已移除）──
  let autoContinueCount = 0
  const MAX_AUTO_CONTINUE = 5
  let consecutiveErrorCount = 0
  const MAX_ERROR_CONTINUE = 1       // error 只续行1次：确定性错误重试无意义
  const AUTO_CONTINUE_DELAY_MS = 2000
  let pendingContinueTimer: ReturnType<typeof setTimeout> | null = null

  // ── 静默工具调用检测（v2.9：拦截连续无文本说明的工具调用）──
  let silentToolCallCount = 0        // 本轮连续无文本的工具调用计数
  const SILENT_TOOL_CALL_THRESHOLD = 3  // 连续 N 次无文本后干预
  const HUB_CALL_THRESHOLD = 2      // hub 单独计数，更激进
  let hubCallCount = 0               // 本轮 hub 调用计数
  const USELESS_PEER_TOOLS = new Set(["hub"])  // 单 agent 场景无意义的工具

  // ── 约束违反检测器 ──
  // v2.6: 裸URL、无语言代码块、废话开头、工具调用不汇报 已迁移至 TTSR 规则（data/agent/rules/）
  // 保留违反检测框架供未来添加非 TTSR 适用的检测器
  const VIOLATION_DETECTIONS: Array<{
    name: string
    test: (text: string) => boolean
    remedy: string
  }> = []

  function detectViolations(text: string): string[] {
    const violations: string[] = []
    for (const detector of VIOLATION_DETECTIONS) {
      try {
        if (detector.test(text)) violations.push(detector.remedy)
      } catch {}
    }
    return violations
  }


  function readConstraints(): string {
    try {
      if (!existsSync(CONSTRAINTS_PATH)) return ""
      return readFileSync(CONSTRAINTS_PATH, "utf8").trim()
    } catch { return "" }
  }

  log("init", [
    "=== claude-mode extension loaded (v2.6) ===",
    `pid: ${process.pid}`,
    `agentDir: ${AGENT_DIR}`,
    `portableRoot: ${PORTABLE_ROOT}`,
  ])

  // ═══════════════════════════════════════════════════════════
  // 0. session_start — 移除 eval 工具（从 LLM 工具列表中彻底移除，模型不可见）
  // ═══════════════════════════════════════════════════════════
  pi.on("session_start", async () => {
    try {
      const all = pi.getActiveTools()
      if (all.includes("eval")) {
        const filtered = all.filter(t => t !== "eval")
        await pi.setActiveTools(filtered)
        log("session_start.eval_removed", `removed eval from active tools (${all.length} → ${filtered.length})`)
      }
    } catch (err: any) {
      log("session_start.eval_remove_error", err?.message || String(err))
    }
  })

  // ═══════════════════════════════════════════════════════════
  // 1. before_agent_start — 记忆注入 + 约束重申 + 违反检测
  // ═══════════════════════════════════════════════════════════
  pi.on("before_agent_start", async (event: any, ctx: any) => {
    try {
      agentTurnCount++
      silentToolCallCount = 0   // v2.9: 新轮次重置
      hubCallCount = 0          // v2.9: 新轮次重置
      const injections: string[] = []

      // 1) AGENTS.md 每轮注入
      const agentsMd = readAgentsMd()
      if (agentsMd) {
        injections.push([
          "# 项目规范（AGENTS.md，自动注入，每轮刷新）",
          "这是本项目的核心规范文件。你必须严格遵守其中定义的路径、禁忌和行为规则。",
          "",
          agentsMd,
        ].join("\n"))
      }

      // 2) PROJECT.md 项目级记忆注入（按 cwd 隔离）
      const currentCwd = ctx?.cwd || ""
      const projectMd = readProjectMd(currentCwd)
      if (projectMd) {
        injections.push([
          "# 项目级记忆（PROJECT.md，自动注入，按工作区隔离）",
          "你可以通过 memory_write 工具追加内容到这个文件。",
          `工作区: ${currentCwd}`,
          "",
          projectMd,
        ].join("\n"))
      }

      // 3) MEMORY.md 每轮注入
      const memory = readMemoryMd()
      if (memory) {
        injections.push([
          "# 长期记忆（MEMORY.md，自动注入，每轮刷新）",
          "",
          memory,
        ].join("\n"))
      }

      // 4) gap-fill 断片补救
      const gapFillFiles = existsSync(INBOX_DIR)
        ? readdirSync(INBOX_DIR).filter((n) => n.startsWith("gap-fill-") && n.endsWith(".md"))
        : []
      if (gapFillFiles.length > 0) {
        const latest = gapFillFiles[gapFillFiles.length - 1]
        const content = readFileSync(join(INBOX_DIR, latest), "utf8").trim()
        if (content) {
          injections.push([
            "# 断片补救（gap-fill，压缩前自动提取）",
            "",
            content,
          ].join("\n"))
        }
      }

      // 5) constraints.md 每轮注入
      const constraints = readConstraints()
      if (constraints) {
        injections.push([
          "# 核心约束（constraints.md，自动注入，严格遵守）",
          "",
          constraints,
        ].join("\n"))
      }

      // ── 违反检测 + 针对性重申 ──
      // 每轮已注入完整 constraints.md，违反时只追加针对性警告，不重复注入完整约束
      if (agentTurnCount > 1 && lastAssistantOutput) {
        const fresh = detectViolations(lastAssistantOutput)
        if (fresh.length > 0) {
          injections.push([
            "# 🔴 约束违反警告（你上一轮输出了违规内容，必须立即纠正）",
            "",
            ...fresh.map((v, i) => `${i + 1}. ${v}`),
            "",
            "以上约束你已经违反。下一条回复必须严格遵守。",
          ].join("\n"))
          log("constraints.violation", `detected ${fresh.length} violations: ${fresh.join(", ")}`)
          try {
            pi.notify?.(`约束违反检测: ${fresh.join("; ")}`, "info")
          } catch {}
        }
      }

      // 6) 工具调用纪律（仅第 1 轮约定一次，后续靠违反检测触发重申）
      if (agentTurnCount === 1) {
        injections.push([
          "# 工具调用纪律",
          "- 禁止在 thinking 中用 XML 格式调用工具（如 <function=xxx>），系统无法识别 XML 工具调用，会导致卡死",
          "- 需要调用工具时使用系统提供的标准 function calling 格式",
          "- 输出链接必须用 [文字](URL) 格式",
          "- 代码必须标注语言",
          "",
          "违反上述纪律将被自动检测并强制重申。",
        ].join("\n"))
      }

      // 8) 长时间命令执行规范（第 1 轮约定）
      if (agentTurnCount === 1) {
        injections.push([
          "# 长时间命令执行规范",
          "执行可能耗时超过 10 秒的命令时，必须使用后台启动 + 轮询模式，禁止同步阻塞等待。",
          "",
          "正确做法：",
          "1. 后台启动命令，拿到进程 PID 或立即返回",
          "2. 等待 10 秒后检查状态",
          "3. 如果未就绪，再等 20 秒后检查",
          "4. 如果仍未就绪，再等 40 秒后检查",
          "5. 三轮轮询后，评估是否需要继续等待",
          "",
          "每轮检查都要向用户报告当前状态。禁止直接执行阻塞命令然后干等结果。",
        ].join("\n"))
      }

      // 合并注入到 systemPrompt
      if (injections.length > 0 && event.systemPrompt) {
        const injectionText = injections.join("\n\n")
        if (Array.isArray(event.systemPrompt)) {
          event.systemPrompt.push(injectionText)
        } else {
          event.systemPrompt = [event.systemPrompt, injectionText]
        }
        log("before_agent_start", `injected ${injectionText.length} chars`)
      }
    } catch (err: any) {
      log("before_agent_start.error", err?.message || String(err))
    }
  })

  // ═══════════════════════════════════════════════════════════
  // 2. tool_call — 权限拦截
  // ═══════════════════════════════════════════════════════════
  pi.on("tool_call", async (event: any) => {
    try {
      const tool = event.toolName || ""
      const input = event.input || {}

      // ── v2.9: 静默工具调用检测 ──
      // hub 等单 agent 场景无意义的工具，单独更激进拦截
      if (USELESS_PEER_TOOLS.has(tool)) {
        hubCallCount++
        if (hubCallCount >= HUB_CALL_THRESHOLD) {
          log("tool_call.blocked", `${tool} → useless peer tool (count=${hubCallCount})`)
          return {
            block: true,
            reason: `[claude-mode] 工具 "${tool}" 在当前单 agent 场景下无意义。当前没有其他 agent 可以通信。请改用其他方式完成任务，或直接向用户说明情况。`,
          }
        }
      }

      // 连续无文本说明的工具调用检测
      silentToolCallCount++
      if (silentToolCallCount >= SILENT_TOOL_CALL_THRESHOLD) {
        log("tool_call.silent_warn", `silentToolCallCount=${silentToolCallCount}, tool=${tool}`)
        // 不 block，通过 steer 要求模型先汇报
        silentToolCallCount = 0  // 重置，避免反复 steer
        return {
          steer: "你已连续调用多次工具但没有向用户说明你在做什么。请先用中文简要说明当前的进展和发现，再继续操作。",
        }
      }

      // 危险工具直接拒绝
      const tier = getToolTier(tool)
      if (tier === "danger") {
        log("tool_call.blocked", `${tool} → danger tier`)
        return {
          block: true,
          reason: `[claude-mode] 工具 "${tool}" 属于危险操作，已被自动拦截。`,
        }
      }

      // 写入工具：检查文件路径安全性
      if (tier === "write" && (tool === "edit" || tool === "write")) {
        const fp = input.filePath || input.path || ""
        if (fp) {
          // 危险路径拦截
          if (isDangerousPath(fp)) {
            log("tool_call.blocked", `${tool} -> ${fp} (dangerous path)`)
            return {
              block: true,
              reason: `[claude-mode] 禁止 AI 操作危险路径 ${fp}。`,
            }
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
              return {
                block: true,
                reason: `[claude-mode] 禁止在 workspace 下新建项目目录 "${firstDir}"。`,
              }
            }
          }
          // 配置文件自改拦截
          const norm = String(fp).replace(/\//g, "\\").toLowerCase()
          if (
            norm.endsWith("\\config.yml") ||
            norm.endsWith("\\models.yml") ||
            norm.includes("\\plugins\\claude-mode-extension.ts")
          ) {
            log("tool_call.blocked", `${tool} -> ${fp} (config self-modification)`)
            return {
              block: true,
              reason: `[claude-mode] 禁止 AI 修改配置文件 ${fp}。`,
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
                return {
                  block: true,
                  reason: `[claude-mode] 禁止在 workspace 下新建项目目录 "${firstDir}"。`,
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      log("tool_call.error", err?.message || String(err))
    }
  })

  // ═══════════════════════════════════════════════════════════
  // 3. tool_result — 审计日志
  // ═══════════════════════════════════════════════════════════
  pi.on("tool_result", async (event: any) => {
    try {
      const tool = event.toolName || "unknown"
      const toolCallId = String(event.toolCallId || event.id || "")

      auditLog({ event: "tool_result", tool, toolCallId, isError: event.isError || false })
      log("tool_result", `tool=${tool}`)
    } catch (err: any) {
      log("tool_result.error", err?.message || String(err))
    }
  })

  // ── constraints 周期性重注入文本 ──
  const CONSTRAINTS_REINFORCE_PREFIX = "【约束重申】严格遵守以下核心约束，违反将导致系统卡死："
  let constraintsReinforceText = ""
  if (existsSync(CONSTRAINTS_PATH)) {
    try {
      const raw = readFileSync(CONSTRAINTS_PATH, "utf8").trim()
      if (raw) {
        // 提取关键条目（只取带 ** 的行，即最重要约束），避免注入太多 token
        const lines = raw.split("\n").filter((l: string) => l.includes("**"))
        if (lines.length > 0) {
          constraintsReinforceText = [CONSTRAINTS_REINFORCE_PREFIX, ...lines].join("\n")
        } else {
          // 没有 ** 标记时，取前 5 条非空非标题行
          const contentLines = raw.split("\n").filter((l: string) => l.trim() && !l.startsWith("#")).slice(0, 5)
          constraintsReinforceText = [CONSTRAINTS_REINFORCE_PREFIX, ...contentLines].join("\n")
        }
      }
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════
  // 4. session.compacting — gap-fill 确定性提取 + constraints 重注入
  // ═══════════════════════════════════════════════════════════
  pi.on("session.compacting", async (event: any) => {
    try {
      const sessionID = event.sessionId || ""
      log("session.compacting", `=== fired === sessionID: ${sessionID}`)

      cleanupGapFills(sessionID)

      const messages = event.messages || []
      if (messages.length === 0) {
        log("session.compacting", "no messages, skip")
        return
      }

      // compact dump
      try {
        ensureDir(INBOX_DIR)
        const inboxPath = join(INBOX_DIR, `compact-${Date.now()}.txt`)
        const formatted = messages.slice(-50).map((m: any) => {
          const role = m.role || "unknown"
          const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")
          const truncated = content.length > 2000 ? content.slice(0, 2000) + "..." : content
          return `[${role}] ${truncated}`
        }).join("\n\n")
        writeFileSync(inboxPath, formatted, "utf8")
      } catch (err: any) {
        log("session.compacting.inbox.error", err?.message || String(err))
      }

      // gap-fill 提取
      try {
        const gapFillPath = join(INBOX_DIR, `gap-fill-${sessionID || ""}.md`)
        try { if (existsSync(gapFillPath)) unlinkSync(gapFillPath) } catch {}

        const entries: string[] = []
        const fileSet = new Set<string>()
        const readFileSet = new Set<string>()
        const cmdSet = new Set<string>()
        const decisionLines = new Set<string>()
        const kw = /(决定|配置|记住|改了|选了|用.{0,6}方案|路径|踩坑|原因|因为|应该|必须|不要|放弃|采用|修复|修)/

        for (const m of messages) {
          const content = typeof m.content === "string" ? m.content : ""
          const toolCalls = m.tool_calls || m.toolCalls || []
          for (const tc of toolCalls) {
            const fn = tc.function?.name || tc.toolName || ""
            const args = tc.function?.arguments || tc.input || {}
            if ((fn === "edit" || fn === "write") && args.filePath) {
              fileSet.add(args.filePath)
            } else if (fn === "read" && (args.filePath || args.path)) {
              readFileSet.add(args.filePath || args.path)
            } else if (fn === "bash" && args.command) {
              const c = String(args.command).trim()
              if (c && !/^\s*(ls|dir|cd|echo|Get-ChildItem|Set-Location|pwd|cls|clear)\b/i.test(c)) {
                cmdSet.add(c)
              }
            }
          }
          if (content) {
            for (const line of content.split("\n")) {
              const s = line.trim()
              const noisePrefix = /^(#|\||-|\*|>|"|⚠️|📁|📌|\d+[.、]|\s*[-*]\s)/u
              if (s.length > 12 && s.length < 160 && kw.test(s) && !noisePrefix.test(s) && !decisionLines.has(s)) {
                decisionLines.add(s)
              }
            }
          }
          if (fileSet.size + cmdSet.size + decisionLines.size > 60) break
        }

        const ellipsis = (s: string, head: number, tail: number) => {
          if (s.length <= head + tail + 3) return s
          return s.slice(0, head) + " … " + s.slice(-tail)
        }

        if (readFileSet.size > 0) {
          entries.push(`## 已读过的文件（无需重读）`)
          for (const f of [...readFileSet].sort()) {
            entries.push(`- 已读取：${f}`)
          }
          entries.push("")
        }

        fileSet.forEach((f) => entries.push(`- 改动文件：${f}`))
        cmdSet.forEach((c) => entries.push(`- 关键命令：${ellipsis(c, 140, 50)}`))
        decisionLines.forEach((s) => entries.push(`- 决策/要点：${ellipsis(s, 90, 40)}`))

        if (entries.length) {
          const uniq = [...new Set(entries)].slice(0, 60)
          const body = `# Gap-fill (断片补救) — ${sessionID}\n\n> 由 compacting hook 自动提取。\n\n${uniq.join("\n")}\n`
          writeFileSync(gapFillPath, body, "utf8")
          log("session.compacting.gapfill", `wrote ${uniq.length} entries`)
        }
      } catch (err: any) {
        log("session.compacting.gapfill.error", err?.message || String(err))
      }

      const contextLines = [
        "保留：已读过的文件列表、改动文件路径、关键命令、重要决策。舍弃：工具输出详情、中间步骤。",
      ]
      if (constraintsReinforceText) contextLines.push(constraintsReinforceText)
      return { context: contextLines }
    } catch (err: any) {
      log("session.compacting.error", err?.message || String(err))
    }
  })

  // ═══════════════════════════════════════════════════════════
  // 5. tool_approval — 自动审批契约
  // ═══════════════════════════════════════════════════════════
  pi.on("tool_approval_requested", async (event: any) => {
    try {
      const tool = event.toolName || ""
      const tier = getToolTier(tool)

      if (tier === "read") {
        log("tool_approval.auto_approve", `${tool} (read tier)`)
        return { approved: true, reason: "claude-mode: read-only tool auto-approved" }
      }

      if (tier === "danger") {
        log("tool_approval.auto_reject", `${tool} (danger tier)`)
        return { approved: false, reason: `claude-mode: 危险操作 "${tool}" 已自动拦截` }
      }

      const input = event.input || event.args || {}
      const fp = input.filePath || input.path || ""
      if (fp && isDangerousPath(fp)) {
        log("tool_approval.auto_reject", `${tool} -> ${fp} (dangerous path)`)
        return { approved: false, reason: `claude-mode: 危险路径 ${fp} 已自动拦截` }
      }
    } catch (err: any) {
      log("tool_approval.error", err?.message || String(err))
    }
  })

  // ═══════════════════════════════════════════════════════════
  // 6. session_stop — 自动续行 + 审计日志
  //
  // v2.6 改造：
  //   - 彻底弃用 omp 原生 { continue: true } 续行机制
  //   - 所有续行统一使用 sendUserMessage + 延迟（2秒），让 omp 有时间完成异步清理
  //   - 避免 omp 内部同步续行的竞态条件导致进程崩溃
  //   - 新增续行计数器（上限5次）+ 用户输入自动取消待定续行
  // ═══════════════════════════════════════════════════════════
  pi.on("session_stop", async (event: any) => {
    try {
      // omp 的 emitSessionStop event 不含 reason 字段，
      // 需要从 last_assistant_message.stopReason + content 推导
      const lastMsg = event.last_assistant_message
      let reason: string
      if (lastMsg && typeof lastMsg === "object") {
        const sr = lastMsg.stopReason
        const content = Array.isArray(lastMsg.content) ? lastMsg.content : []
        const hasText = content.some((c: any) => c.type === "text" && typeof c.text === "string" && c.text.trim().length > 0)
        if (sr === "error") reason = "error"
        else if (sr === "aborted") reason = "aborted"
        else if (sr === "length") reason = "interrupted"
        // 伪完成检测：stop 但无文本输出
        else if (sr === "stop" && !hasText) reason = "interrupted"
        else if (sr === "stop") reason = "complete"
        else reason = "unknown"
      } else {
        reason = "unknown"
      }

      auditLog({ event: "session_stop", reason, stopReason: lastMsg?.stopReason, autoContinueCount, consecutiveErrorCount })
      log("session_stop", `reason=${reason} stopReason=${lastMsg?.stopReason} autoContinueCount=${autoContinueCount} consecutiveErrorCount=${consecutiveErrorCount}`)

      // 自动续行：
      // - error：模型出错，最多续行1次（确定性错误重试无意义）
      // - unknown：无 lastMsg，不明原因停止
      // - interrupted：伪完成（stop但无文本）或 token 截断，任务未实际完成
      // 不续行：complete（正常完成）/ aborted（用户主动中断）
      if (reason === "complete" || reason === "aborted") {
        // 正常结束，重置所有续行计数器
        autoContinueCount = 0
        consecutiveErrorCount = 0
        return
      }

      // error 独立计数：连续 error 最多续行1次
      if (reason === "error") {
        if (consecutiveErrorCount >= MAX_ERROR_CONTINUE) {
          log("session_stop.error_max", `连续error已达上限(${MAX_ERROR_CONTINUE})，停止续行`)
          try {
            pi.notify?.(`请求连续出错(${consecutiveErrorCount}次)，可能需要手动干预。`, "warning")
          } catch {}
          consecutiveErrorCount = 0
          autoContinueCount = 0
          return
        }
        consecutiveErrorCount++
      } else {
        // 非 error 续行时，重置 error 计数器
        consecutiveErrorCount = 0
      }

      // 总续行次数上限
      if (autoContinueCount >= MAX_AUTO_CONTINUE) {
        log("session_stop.max_continue", `已达到最大自动续行次数(${MAX_AUTO_CONTINUE})，停止续行`)
        try {
          pi.notify?.(`已自动续行${autoContinueCount}次仍异常，任务可能需要手动干预。`, "warning")
        } catch {}
        autoContinueCount = 0
        return
      }

      autoContinueCount++
      let ctx: string
      if (reason === "error") {
        ctx = "上一轮请求出错，请继续之前的任务。如果无法继续，向用户说明情况。"
      } else if (reason === "interrupted") {
        ctx = "上一轮输出未完成（无文本回复），请继续之前的任务，给出完整结果。"
      } else {
        ctx = "会话异常终止（无停止原因），请继续之前的任务。如果无法继续，向用户说明情况。"
      }

      log("session_stop.auto_continue", `reason=${reason} count=${autoContinueCount}/${MAX_AUTO_CONTINUE} delay=${AUTO_CONTINUE_DELAY_MS}ms`)
      try {
        pi.notify?.(`会话异常停止(${reason})，${AUTO_CONTINUE_DELAY_MS / 1000}秒后自动续行(${autoContinueCount}/${MAX_AUTO_CONTINUE})...`, "info")
      } catch {}

      // 延迟后通过 sendUserMessage 发送续行指令
      // 不返回 { continue: true }，让 omp 正常结束本轮、完成异步清理
      // 延迟期间如果用户发送了真实消息，则取消自动续行
      pendingContinueTimer = setTimeout(() => {
        pendingContinueTimer = null
        try {
          pi.runtime?.sendUserMessage?.(ctx, { deliverAs: "steer" })
          log("session_stop.sendUserMessage.sent", `sent steer message, reason=${reason} count=${autoContinueCount}`)
        } catch (e: any) {
          log("session_stop.sendUserMessage.error", e?.message || String(e))
        }
      }, AUTO_CONTINUE_DELAY_MS)
    } catch (err: any) {
      log("session_stop.error", err?.message || String(err))
    }
  })

  // ═══════════════════════════════════════════════════════════
  // 8. input — 敏感信息检测
  // ═══════════════════════════════════════════════════════════
  pi.on("input", async (event: any) => {
    try {
      const message = event.text || event.message || event.input || ""
      if (typeof message !== "string" || !message) return

      // v2.7: 用户发送真实消息时，取消待定的自动续行 + 重置所有计数器
      if (pendingContinueTimer) {
        clearTimeout(pendingContinueTimer)
        pendingContinueTimer = null
        autoContinueCount = 0
        consecutiveErrorCount = 0
        log("input.cancel_continue", "用户发送消息，取消待定自动续行")
      }

      // /omfg 命令拦截 — 让模型自己生成 TTSR 规则
      const omfgMatch = message.match(/^\/omfg\s+(.+)/)
      if (omfgMatch) {
        try {
          const complaint = omfgMatch[1].trim()
          const ruleDir = join(DATA_DIR, "agent", "rules")
          ensureDir(ruleDir)

          const existingRules = existsSync(ruleDir)
            ? readdirSync(ruleDir).filter(f => f.endsWith('.md')).join(', ') || '(无)'
            : '(无)'

          const omfgPrompt = [
            `用户投诉: "${complaint}"`,
            "",
            "请为这条投诉创建一条 TTSR (Time Traveling Stream Rule) 规则。",
            "",
            "## TTSR 规则机制",
            "TTSR 规则实时监控模型的**流式输出**（不是用户输入），匹配到违规内容时可以中断生成或注入提醒。规则**零 context 开销**——只在触发时才消耗 token。",
            "",
            "## 规则文件格式",
            "Markdown 文件，路径: `data/agent/rules/<英文名>.md`，内容结构：",
            "```",
            "---",
            'description: "简短描述规则目的"',
            'condition: "JavaScript 正则表达式（匹配模型流式输出）"',
            'scope: "逗号分隔的流作用域"',
            'interruptMode: "always 或 never"',
            "---",
            "",
            "这里是规则触发后注入给模型的提醒内容（正文）。",
            "告诉模型做错了什么、应该怎么做。",
            "```",
            "",
            "## 字段说明",
            "- `condition`: JavaScript 正则（字符串或字符串数组），匹配模型的**流式输出文本**",
            "- `scope`: `text`(助手文字), `thinking`(推理), `tool`(所有工具参数), `tool:edit(*.ts)`(编辑特定类型文件)",
            "- `interruptMode`: `always`=匹配时立刻中断生成并注入提醒; `never`=不中断，仅在工具结果中注入提醒",
            "",
            "## 现有规则（避免重复）",
            existingRules,
            "",
            "## 示例",
            "",
            "示例1（中断型）:",
            "```",
            "---",
            'description: "Never use XML format to call tools like <function=xxx>"',
            'condition: "<function[=\\\\s]"',
            'scope: "text, thinking"',
            'interruptMode: "always"',
            "---",
            "",
            "You used XML format to call a tool. This is NOT supported.",
            "You MUST use the standard function calling format.",
            "```",
            "",
            "示例2（提醒型）:",
            "```",
            "---",
            'description: "Use io and os instead of deprecated io/ioutil"',
            'condition: \'"io/ioutil"\'',
            'scope: "tool:edit(*.go), tool:write(*.go)"',
            'interruptMode: never',
            "---",
            "",
            "You used deprecated io/ioutil. Use io and os instead.",
            "```",
            "",
            "## 要求",
            "1. condition 正则要精准，能匹配到违规输出但不误杀",
            "2. scope 要合理——只检查可能违规的流",
            "3. interruptMode: 严重违规(如格式错误、安全隐患)用 `always`，轻微问题(如风格建议)用 `never`",
            "4. 文件名用有意义的英文名（如 no-bare-url.md），不要用时间戳",
            `5. 写入路径: ${join(ruleDir, "<name>.md")}`,
            "6. 写完规则文件后，告诉用户：规则已创建，需要重启 omp 才会生效",
          ].join("\n")

          log("omfg.redirected", `complaint="${complaint}" → sent prompt to model`)
          try {
            pi.notify?.(`TTSR 规则生成中: "${complaint}"`, "info")
          } catch {}
          return { text: omfgPrompt }
        } catch (err: any) {
          log("omfg.error", err?.message || String(err))
        }
      }

      // 敏感信息检测：不阻断，只记录审计日志
      const sensitive = detectSensitiveInfo(message)
      if (sensitive.length > 0) {
        log("input.sensitive", `检测到敏感信息: ${sensitive.map(s => s.label).join(", ")}`)
        auditLog({
          event: "input_sensitive",
          types: sensitive.map(s => s.label),
        })
      }
    } catch (err: any) {
      log("input.error", err?.message || String(err))
    }
  })

  // ═══════════════════════════════════════════════════════════
  // 9. 注册自定义工具 — memory_search / skill / memory_write
  // ═══════════════════════════════════════════════════════════
  try {
    if (pi.registerTool && typeof pi.registerTool === "function") {
      pi.registerTool({
        name: "memory_search",
        description: "搜索记忆文件中的关键词。搜索范围：PROJECT.md → MEMORY.md → daily-log/*.md。输入关键词或正则表达式，返回匹配片段。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词或正则表达式" },
            max_results: { type: "number", description: "返回最大片段数，默认 10" },
          },
          required: ["query"],
        },
        execute: async (toolCallId: string, args: { query: string; max_results?: number }, signal: any, onUpdate: any, ctx: any) => {
          try {
            const { query, max_results = 10 } = args
            const results: string[] = []

            // PROJECT.md
            const currentCwd = ctx?.cwd || ""
            const projectMd = readProjectMd(currentCwd)
            if (projectMd) {
              try {
                const regex = new RegExp(query, "gi")
                const lines = projectMd.split("\n")
                for (let i = 0; i < lines.length; i++) {
                  if (regex.test(lines[i])) {
                    const start = Math.max(0, i - 2)
                    const end = Math.min(lines.length, i + 3)
                    results.push(`[PROJECT.md:行${start + 1}] ${lines.slice(start, end).join("\n")}`)
                    regex.lastIndex = 0
                  }
                }
              } catch {}
            }

            // MEMORY.md
            const memory = readMemoryMd()
            if (memory) {
              try {
                const regex = new RegExp(query, "gi")
                const lines = memory.split("\n")
                for (let i = 0; i < lines.length; i++) {
                  if (regex.test(lines[i])) {
                    const start = Math.max(0, i - 2)
                    const end = Math.min(lines.length, i + 3)
                    results.push(`[MEMORY.md:行${start + 1}] ${lines.slice(start, end).join("\n")}`)
                    regex.lastIndex = 0
                  }
                }
              } catch {}
            }

            // 每日日志
            try {
              const dailyLogDir = join(MEMORY_DIR, "daily-log")
              if (existsSync(dailyLogDir)) {
                const logFiles = readdirSync(dailyLogDir).filter((n) => n.endsWith(".md")).sort().reverse().slice(0, 7)
                for (const logFile of logFiles) {
                  const content = readFileSync(join(dailyLogDir, logFile), "utf8")
                  const regex = new RegExp(query, "gi")
                  const lines = content.split("\n")
                  for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                      const start = Math.max(0, i - 1)
                      const end = Math.min(lines.length, i + 2)
                      results.push(`[${logFile}:行${start + 1}] ${lines.slice(start, end).join("\n")}`)
                      regex.lastIndex = 0
                    }
                    if (results.length >= max_results) break
                  }
                  if (results.length >= max_results) break
                }
              }
            } catch {}

            if (results.length === 0) {
              return { content: [{ type: "text", text: `未找到匹配 "${query}" 的记忆内容` }], details: { found: false } }
            }
            return {
              content: [{ type: "text", text: results.slice(0, max_results).join("\n\n") }],
              details: { found: true, count: results.length },
            }
          } catch (err: any) {
            return { content: [{ type: "text", text: `搜索出错: ${err.message}` }], details: { error: err.message }, isError: true }
          }
        },
      })
      log("registerTool", "memory_search registered")

      // skill 工具
      const SKILLS_DIR = join(PORTABLE_ROOT, "skills")
      let skillsListCache = { mtimeMs: 0, list: [] as string[] }

      pi.registerTool({
        name: "skill",
        description: "加载专业技能执行专业任务。可用技能：craftman（工匠模式，多skill工作流编排，支持pptgen/comfyui/canvas-design组合）、comfyui-image-gen（AI生图）、canvas-design（视觉设计）、pptgen（交互式HTML网页演示）、pptx-from-layouts（PPT文件）、xlsx（表格）、docx（文档）、pdf（PDF）、dashiai-ppt（PPT）、deep-research（深度调研）、diagram-drawing（图表绘制）、doc-coauthoring（文档协作）、contract-review（合同审查）、image-gen-router（生图路由）、image-style-enhancer（图片风格增强）、memory-manager（记忆管理）、history-query（历史查询）、onboarding（新用户引导）。调用时传入 skill 名称获取完整执行指令。当用户提到生图/做PPT/设计/图表/文档/表格/调研等专业任务时，必须先调用此工具加载对应skill。",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill 名称" },
            action: { type: "string", enum: ["load", "list"], description: "load=加载, list=列出所有" },
          },
          required: ["name"],
        },
        execute: async (toolCallId: string, args: { name: string; action?: string }, signal: any, onUpdate: any, ctx: any) => {
          try {
            const { name: skillName, action = "load" } = args

            if (action === "list" || skillName === "list") {
              if (!existsSync(SKILLS_DIR)) return { content: [{ type: "text", text: "No skills directory" }], details: {} }
              const dirs = readdirSync(SKILLS_DIR).filter((n) => {
                try { return statSync(join(SKILLS_DIR, n)).isDirectory() && existsSync(join(SKILLS_DIR, n, "SKILL.md")) } catch { return false }
              })
              return {
                content: [{ type: "text", text: JSON.stringify({ count: dirs.length, skills: dirs }) }],
                details: {},
              }
            }

            const safeName = skillName.replace(/[/\\:.]/g, "")
            const skillMdPath = join(SKILLS_DIR, safeName, "SKILL.md")
            if (!existsSync(skillMdPath)) {
              return { content: [{ type: "text", text: `Skill "${skillName}" 不存在` }], details: {}, isError: true }
            }

            let content = readFileSync(skillMdPath, "utf8")
            const pathReplacements: Array<[RegExp, string]> = [
              [/E:\\Opencode\\data\\config\\opencode\\skills/g, SKILLS_DIR.replace(/\\/g, "\\")],
              [/E:\\Opencode/g, PORTABLE_ROOT.replace(/\\/g, "\\")],
              [/D:\\AI\\Opencode/g, PORTABLE_ROOT.replace(/\\/g, "\\")],
            ]
            for (const [pattern, replacement] of pathReplacements) {
              content = content.replace(pattern, replacement)
            }

            log("skill.load", `loaded: ${skillName}`)
            return {
              content: [{ type: "text", text: content }],
              details: { skill: skillName },
            }
          } catch (err: any) {
            return { content: [{ type: "text", text: `Skill 加载出错: ${err.message}` }], details: { error: err.message }, isError: true }
          }
        },
      })
      log("registerTool", "skill registered")

      // memory_write 工具
      pi.registerTool({
        name: "memory_write",
        description: "追加内容到记忆文件。'project'=PROJECT.md，'memory'=MEMORY.md。",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "要追加的内容" },
            target: { type: "string", enum: ["project", "memory"], description: "写入目标" },
          },
          required: ["content", "target"],
        },
        execute: async (toolCallId: string, args: { content: string; target: string }, signal: any, onUpdate: any, ctx: any) => {
          try {
            const { content, target } = args
            if (!content?.trim()) {
              return { content: [{ type: "text", text: "内容不能为空" }], details: {}, isError: true }
            }
            const timestamp = new Date().toISOString().split("T")[0]

            if (target === "project") {
              const cwd = ctx?.cwd || ""
              if (!cwd) return { content: [{ type: "text", text: "无法确定当前项目目录" }], details: {}, isError: true }
              const projectMdPath = join(cwd, "PROJECT.md")
              const entry = `\n## ${timestamp}\n${content.trim()}\n`
              try {
                if (!existsSync(projectMdPath) || !readFileSync(projectMdPath, "utf8").trim()) {
                  writeFileSync(projectMdPath, `# 项目级记忆\n\n${entry}`, "utf8")
                } else {
                  appendFileSync(projectMdPath, entry, "utf8")
                }
                projectMdCache.delete(cwd)
                log("memory_write.project", `wrote to ${projectMdPath}`)
                return { content: [{ type: "text", text: `已追加到 PROJECT.md` }], details: { target: "project" } }
              } catch (err: any) {
                return { content: [{ type: "text", text: `写入失败: ${err.message}` }], details: { error: err.message }, isError: true }
              }
            }

            if (target === "memory") {
              try {
                const entry = `\n## ${timestamp}\n${content.trim()}\n`
                if (!existsSync(MEMORY_PATH)) {
                  writeFileSync(MEMORY_PATH, `# 全局长期记忆\n\n${entry}`, "utf8")
                } else {
                  appendFileSync(MEMORY_PATH, entry, "utf8")
                }
                memoryCache = { mtimeMs: 0, content: "" }
                log("memory_write.memory", `wrote to MEMORY.md`)
                return { content: [{ type: "text", text: "已追加到 MEMORY.md" }], details: { target: "memory" } }
              } catch (err: any) {
                return { content: [{ type: "text", text: `写入失败: ${err.message}` }], details: { error: err.message }, isError: true }
              }
            }

            return { content: [{ type: "text", text: `未知目标: ${target}` }], details: {}, isError: true }
          } catch (err: any) {
            return { content: [{ type: "text", text: `memory_write 出错: ${err.message}` }], details: { error: err.message }, isError: true }
          }
        },
      })
      log("registerTool", "memory_write registered")
    }
  } catch (err: any) {
    log("registerTool.error", err?.message || String(err))
  }

  // ═══════════════════════════════════════════════════════════
  // 10. after_provider_response — 记录输出 + 违反检测 + XML 自动纠正
  // ═══════════════════════════════════════════════════════════
  pi.on("after_provider_response", async (event: any) => {
    try {
      const responseText = event.text || event.content || event.message || ""
      if (typeof responseText === "string" && responseText) {
        lastAssistantOutput = responseText
        // v2.9: 模型输出了文本，说明不是静默调用，重置计数器
        if (silentToolCallCount > 0) {
          log("silent_tool_call.reset", `had text output, reset silentToolCallCount from ${silentToolCallCount}`)
          silentToolCallCount = 0
        }
        if (hubCallCount > 0) {
          hubCallCount = 0
        }
      }

      // 审计日志
      const usage = event.usage || event.tokenUsage || {}
      auditLog({
        event: "provider_response",
        model: event.model || "unknown",
        tokens: usage.totalTokens || usage.total_tokens || 0,
        turn: agentTurnCount,
      })
      log("after_provider_response", `model=${event.model || "?"} tokens=${usage.totalTokens || usage.total_tokens || 0} turn=${agentTurnCount}`)

      // XML 工具调用自动纠正
      // v2.6: TTSR 规则 no-xml-toolcall.md 已接管实时拦截，此处保留作为兜底
      // （TTSR 在流式输出阶段中断，此处是输出完成后的二次检查）
      if (typeof responseText === "string" && /<function[=\s]/i.test(responseText)) {
        log("xml_tool_call.detected", `xmlAutoRetryCount=${xmlAutoRetryCount}`)

        if (xmlAutoRetryCount < XML_AUTO_RETRY_MAX) {
          xmlAutoRetryCount++
          try {
            pi.notify?.(`检测到 XML 格式工具调用，自动纠正中（第${xmlAutoRetryCount}次）...`, "info")
          } catch {}
          // 延迟后自动发送约束提醒 + 继续指令
          // sendUserMessage 会触发新一轮 agent → before_agent_start 注入违反警告
          setTimeout(() => {
            try {
              pi.runtime?.sendUserMessage?.("继续执行。禁止使用 XML 格式调用工具，必须使用系统提供的标准 function calling 格式。", { deliverAs: "steer" })
              log("xml_auto_retry", `sent steer message, retryCount=${xmlAutoRetryCount}`)
            } catch (e: any) {
              log("xml_auto_retry.error", e?.message || String(e))
            }
          }, 500)
        } else {
          // 超过重试上限，通知用户手动处理
          xmlAutoRetryCount = 0
          try {
            pi.notify?.("XML 格式工具调用自动纠正失败（已重试${XML_AUTO_RETRY_MAX}次），请手动停止后重试。", "warning")
          } catch {}
        }
      } else {
        // 本轮没有 XML，重置重试计数
        if (xmlAutoRetryCount > 0) {
          log("xml_auto_retry.reset", "no XML detected, reset counter")
          xmlAutoRetryCount = 0
        }
      }
    } catch (err: any) {
      log("after_provider_response.error", err?.message || String(err))
    }
  })

  log("init", "=== claude-mode extension v2.9 ready ===")
}
