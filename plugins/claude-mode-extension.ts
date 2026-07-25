/**
 * claude-mode-extension.ts — omp 扩展 v4.0
 *
 * 重构理念：从"补完 omp"变成"搭 omp 的车"
 *
 * 删除（omp 原生已覆盖）：
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
 *
 * 保留（omp 不覆盖）：
 * - gap-fill 断片补救
 * - 危险路径/配置文件拦截
 * - 静默工具调用检测
 * - skill 工具
 * - 审计日志
 * - error 续行（最小化）
 * - hub 工具移除
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"

// ── 路径常量 ──
const PLUGIN_DIR = import.meta.dir
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || process.env.USERPROFILE || "~", ".omp", "agent")
const PORTABLE_ROOT = resolve(AGENT_DIR, "..", "..")
const DATA_DIR = resolve(AGENT_DIR, "..")
const MEMORY_DIR = join(DATA_DIR, "memory")
const INBOX_DIR = join(MEMORY_DIR, "inbox")
const CONSTRAINTS_PATH = join(MEMORY_DIR, "constraints.md")
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

// ═══════════════════════════════════════════════════════════
// 扩展入口
// ═══════════════════════════════════════════════════════════
export default async function (pi: any) {
  ensureDir(MEMORY_DIR)
  ensureDir(INBOX_DIR)
  ensureDir(LOG_DIR_PATH)

  let agentTurnCount = 0
  let silentToolCallCount = 0
  const SILENT_TOOL_CALL_THRESHOLD = 3

  log("init", [
    "=== claude-mode extension loaded (v4.0) ===",
    `pid: ${process.pid}`,
    `portableRoot: ${PORTABLE_ROOT}`,
  ])

  // ── 0. session_start ── 移除无用工具 + 注册自定义工具
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

    // 注册 skill 工具
    try {
      if (pi.registerTool && typeof pi.registerTool === "function") {
        const SKILLS_DIR = join(PORTABLE_ROOT, "skills")

        pi.registerTool({
          name: "skill",
          description: "加载专业技能执行专业任务。调用时传入 skill 名称获取完整执行指令。",
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
                return { content: [{ type: "text", text: JSON.stringify({ count: dirs.length, skills: dirs }) }], details: {} }
              }

              const safeName = skillName.replace(/[/\\:.]/g, "")
              const skillMdPath = join(SKILLS_DIR, safeName, "SKILL.md")
              if (!existsSync(skillMdPath)) {
                return { content: [{ type: "text", text: `Skill "${skillName}" 不存在` }], details: {}, isError: true }
              }

              let content = readFileSync(skillMdPath, "utf8")
              // 路径替换
              const replacements: Array<[RegExp, string]> = [
                [/E:\\Opencode\\data\\config\\opencode\\skills/g, SKILLS_DIR.replace(/\\/g, "\\")],
                [/E:\\Opencode/g, PORTABLE_ROOT.replace(/\\/g, "\\")],
                [/D:\\AI\\Opencode/g, PORTABLE_ROOT.replace(/\\/g, "\\")],
              ]
              for (const [pattern, replacement] of replacements) {
                content = content.replace(pattern, replacement)
              }

              log("skill.load", `loaded: ${skillName}`)
              return { content: [{ type: "text", text: content }], details: { skill: skillName } }
            } catch (err: any) {
              return { content: [{ type: "text", text: `Skill 加载出错: ${err.message}` }], details: { error: err.message }, isError: true }
            }
          },
        })
        log("registerTool", "skill registered")
      }
    } catch (err: any) {
      log("registerTool.error", err?.message || String(err))
    }
  })

  // ── 1. before_agent_start ── gap-fill 断片补救 + constraints 最小化注入
  pi.on("before_agent_start", async (event: any) => {
    try {
      agentTurnCount++
      silentToolCallCount = 0
      const injections: string[] = []

      // gap-fill 断片补救
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

      // constraints.md 最小化注入（仅保留无法 TTSR 化的语义/行为约束）
      if (existsSync(CONSTRAINTS_PATH)) {
        try {
          const constraints = readFileSync(CONSTRAINTS_PATH, "utf8").trim()
          if (constraints) {
            injections.push([
              "# 核心约束（constraints.md，严格遵守）",
              "",
              constraints,
            ].join("\n"))
          }
        } catch {}
      }

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

  // ── 3. session_stop ── error 续行（最小化，用 omp 原生机制）
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

      auditLog({ event: "session_stop", reason, stopReason: lastMsg?.stopReason })
      log("session_stop", `reason=${reason}`)

      // 仅 error 和 unknown 续行，其他不干预
      if (reason === "error") {
        return { continue: true, additionalContext: "上一轮请求出错，请继续之前的任务。如果无法继续，向用户说明情况。" }
      }
      if (reason === "unknown") {
        return { continue: true, additionalContext: "会话异常终止，请继续之前的任务。" }
      }
    } catch (err: any) {
      log("session_stop.error", err?.message || String(err))
    }
  })

  // ── 4. session.compacting ── gap-fill 断片提取 + constraints 重注入
  pi.on("session.compacting", async (event: any) => {
    try {
      const sessionID = event.sessionId || ""
      log("session.compacting", `=== fired === sessionID: ${sessionID}`)

      cleanupGapFills(sessionID)

      const messages = event.messages || []
      if (messages.length === 0) return

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

        const ellipsis = (s: string, head: number, tail: number) =>
          s.length <= head + tail + 3 ? s : s.slice(0, head) + " … " + s.slice(-tail)

        if (readFileSet.size > 0) {
          entries.push(`## 已读过的文件（无需重读）`)
          for (const f of [...readFileSet].sort()) entries.push(`- 已读取：${f}`)
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

      // constraints 重注入
      const contextLines = [
        "保留：已读过的文件列表、改动文件路径、关键命令、重要决策。舍弃：工具输出详情、中间步骤。",
      ]
      if (existsSync(CONSTRAINTS_PATH)) {
        try {
          const raw = readFileSync(CONSTRAINTS_PATH, "utf8").trim()
          if (raw) {
            const keyLines = raw.split("\n").filter((l: string) => l.includes("**")).slice(0, 5)
            if (keyLines.length > 0) contextLines.push("【约束重申】" + keyLines.join("\n"))
          }
        } catch {}
      }
      return { context: contextLines }
    } catch (err: any) {
      log("session.compacting.error", err?.message || String(err))
    }
  })

  // ── 5. tool_result ── 审计日志
  pi.on("tool_result", async (event: any) => {
    try {
      const tool = event.toolName || "unknown"
      auditLog({ event: "tool_result", tool, isError: event.isError || false })
      log("tool_result", `tool=${tool}`)
    } catch (err: any) {
      log("tool_result.error", err?.message || String(err))
    }
  })

  log("init", "=== claude-mode extension v4.0 ready ===")
}
