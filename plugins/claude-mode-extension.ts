/**
 * claude-mode-extension.ts - Tiffa 扩展 v6.2
 *
 * 精简理念：搭 Tiffa 的车，不造 Tiffa 的轮
 *
 * 已删除（Tiffa 内核原生已覆盖 / 不再需要）：
 * - AGENTS.md 注入 -> Tiffa 内核自动从 CWD 查找注入
 * - MEMORY.md 注入 -> Mnemopi autoRecall
 * - 违反检测（4 个检测器） -> TTSR 实时拦截
 * - 权限契约审批 -> Tiffa 内核内置审批
 * - XML 工具调用纠正 -> TTSR no-xml-toolcall.md
 * - /omfg 命令 -> Electron 主进程已拦截
 * - memory_write 工具 -> Mnemopi 原生 retain
 * - memory_search 工具 -> Mnemopi 原生 recall
 * - skill 工具 -> Tiffa 内核原生 manage_skill + managed-skills 目录
 * - gap-fill 断片补救 -> Mnemopi autoRecall 覆盖
 * - constraints.md 注入 -> TTSR 规则 + AGENTS.md 覆盖
 *
 * 保留（Tiffa 内核不覆盖）：
 * - 危险路径/配置文件/扩展自身 拦截
 * - .env / 密钥文件读取拦截
 * - 堆栈/路径泄露拦截
 * - 静默工具调用检测
 * - 审计日志
 * - error 续行（一次制 + 5 秒延迟）
 * - hub 工具移除
 * - PROJECT.md 生成 + 确定性注入（before_agent_start：项目根目录首次对话自动生成脚手架，每会话开头注入 system prompt）
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

// ── 路径常量 ──
const PLUGIN_DIR = import.meta.dir
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || process.env.USERPROFILE || "~", ".omp", "agent")
const PORTABLE_ROOT = resolve(AGENT_DIR, "..", "..")
const DATA_DIR = resolve(AGENT_DIR, "..")
const MEMORY_DIR = join(DATA_DIR, "memory")
const INBOX_DIR = join(MEMORY_DIR, "inbox")
const LOG_DIR_PATH = join(DATA_DIR, "log")
const PLUGIN_LOG = join(PLUGIN_DIR, "claude-mode.log")
const GAPFILL_MAX_AGE_MS = 60 * 60 * 1000

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

// ── 密钥/配置文件路径检测 ──
function isSecretFilePath(fp: string): boolean {
  const norm = String(fp).replace(/\//g, "\\").toLowerCase()
  // .env 系列文件（支持绝对路径和相对路径）
  if (/(?:^|[\\/])\.env(\.|$|[\\/])/i.test(norm)) return true
  if (/^\.env$/i.test(norm)) return true
  // 证书/密钥文件
  if (/\.(pem|key|crt|p12|pfx|ovpn)$/i.test(norm)) return true
  // 含敏感词的文件名
  if (/(?:^|[\\/])(password|secret|token|api[_-]?key|credentials|passwd|pwd)\.[a-zA-Z0-9]{1,10}$/i.test(norm)) return true
  return false
}

// ── 堆栈/路径泄露检测 ──
const STACK_TRACE_AT_LINE = /^\s+at\s+[A-Za-z_$][\w$]*\s+\(.+?:\d+:\d+\)/m

function hasStackLeak(text: string): boolean {
  if (!text || text.length < 20) return false
  const atLines = text.match(/^\s+at\s+[A-Za-z_$][\w$]*\s+\(.+?:\d+:\d+\)/gm)
  if (atLines && atLines.length >= 2) return true
  return false
}

// ── gap-fill 清理（60 分钟） ──
function cleanupGapFills(sessionID: string) {
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
      if (!isCompactDump && sessionID && f !== `gap-fill-${sessionID}.md`) {
        remove = true; reason = "old-session"
      }
      if (!remove) {
        try {
          const stat = statSync(full)
          if (now - stat.mtimeMs > GAPFILL_MAX_AGE_MS) { remove = true; reason = "age" }
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
  ensureDir(INBOX_DIR)

  let agentTurnCount = 0
  let silentToolCallCount = 0
  let consecutiveBlockCount = 0  // 连续被拦截次数（熔断用）
  const SILENT_TOOL_CALL_THRESHOLD = 3

  // ── 技能强制机制：弱模型不读 SKILL.md 就调脚本 -> block ──
  // 会话级持久 + 超时重置（10 分钟）。craftman 等多轮工作流中，
  // 规划阶段 read skill:// + ask 过后，执行阶段（跨轮）不应再要求重来。
  // 超时后或 session_start 时重置，防止用户切换任务后旧状态残留。
  const SKILL_STATE_TTL_MS = 10 * 60 * 1000 // 10 分钟
  let skillLoadedMap = new Map<string, number>() // skill名 -> 加载时间戳
  let askTimestamp = 0                          // 最近一次 ask 的时间戳
  let lastSkillRead = ""                        // 跟踪最近读取的 skill 名，tool_result 时追加路径提示

  // ── WebP 处理：已下放给内核 ──
  // 本地推理引擎（llama.cpp / local-server 等）在 models.yml 用内核原生 provider 命名，
  // 内核 modelLacksWebpSupport() 自动命中 -> excludeWebP，覆盖拖拽 + read 两条路径。
  // 原扩展层白名单已删除（只能罩 tool_result，且拦不住内核回转 webp）。

  function isSkillFresh(skill: string): boolean {
    const ts = skillLoadedMap.get(skill)
    if (!ts) return false
    return Date.now() - ts < SKILL_STATE_TTL_MS
  }

  function isAskFresh(): boolean {
    if (!askTimestamp) return false
    return Date.now() - askTimestamp < SKILL_STATE_TTL_MS
  }

  function resetSkillState() {
    skillLoadedMap = new Map()
    askTimestamp = 0
    lastSkillRead = ""
  }

  // 技能脚本绝对路径提示（弱模型不会拼路径，直接告诉它）
  const SKILL_PATH_HINTS: Record<string, string> = {
    "craftman": [
      "\n\n---\n[系统注入 · 禁止自行拼接路径]",
      `Python 解释器: ${join(PORTABLE_ROOT, "python", "python.exe")}`,
      `craftman.py 绝对路径: ${join(PORTABLE_ROOT, "skills", "craftman", "craftman.py")}`,
      `调用示例: python "${join(PORTABLE_ROOT, "skills", "craftman", "craftman.py")}" --plan-file <plan.json> --no-confirm`,
    ].join("\n"),
    "comfyui-image-gen": [
      "\n\n---\n[系统注入 · 禁止自行拼接路径]",
      `Python 解释器: ${join(PORTABLE_ROOT, "python", "python.exe")}`,
      `comfy.py 绝对路径: ${join(PORTABLE_ROOT, "skills", "comfyui-image-gen", "comfy.py")}`,
    ].join("\n"),
    "computer-use": [
      "\n\n---\n[系统注入 · 禁止自行拼接路径]",
      `Python 解释器: ${join(PORTABLE_ROOT, "python", "python.exe")}`,
      `computer_use.py 绝对路径: ${join(PORTABLE_ROOT, "skills", "computer-use", "computer_use.py")}`,
    ].join("\n"),
  }

  // 技能脚本 -> 对应 skill 名 + 是否必须先问用户
  const SKILL_SCRIPT_RULES: Array<{ pattern: RegExp; skill: string; requireAsk: boolean }> = [
    { pattern: /comfy\.py\b/, skill: "comfyui-image-gen", requireAsk: true },
    { pattern: /craftman\.py\b/, skill: "craftman", requireAsk: true },
    { pattern: /computer_use\.py\b/, skill: "computer-use", requireAsk: true },
  ]

  log("init", [
    "=== claude-mode extension loaded (v6.2) ===",
    `pid: ${process.pid}`,
    `portableRoot: ${PORTABLE_ROOT}`,
  ])

  // ── 工具清理：移除 eval/hub，确保记忆工具可用 ──
  // 内核可能在 compacting 后重新注册全部工具，故需在 session_start + before_agent_start 都调用
  async function sanitizeTools(tag: string) {
    try {
      const all = pi.getActiveTools()
      const removed = ["eval", "hub"]
      // 记忆工具：recall/retain/reflect/memory_edit，loadMode 为 discoverable，
      // 需显式加入活跃列表，否则 LLM 看不到这些工具
      const memoryTools = ["recall", "retain", "reflect", "memory_edit"]
      let filtered = all.filter((t: string) => !removed.includes(t))
      const missing = memoryTools.filter((t: string) => !filtered.includes(t))
      if (missing.length > 0) {
        filtered = [...filtered, ...missing]
        log(tag, `ensured memory tools: [${missing.join(", ")}]`)
      }
      if (filtered.length !== all.length || missing.length > 0) {
        await pi.setActiveTools(filtered)
        const gone = all.filter((t: string) => !filtered.includes(t))
        log(tag, `tools updated (${all.length} -> ${filtered.length})` + (gone.length ? ` removed [${gone.join(", ")}]` : ""))
      }
    } catch (err: any) {
      log(`${tag}.error`, err?.message || String(err))
    }
  }

  // ── 0. session_start ── 移除无用工具 + 确保记忆工具可用 + 解除标题禁用
  pi.on("session_start", async () => {
    resetSkillState()
    await sanitizeTools("session_start")
    // 内核在 rpc-ui/rpc/acp 模式下设置 PI_NO_TITLE=1，完全禁用 AI 标题生成。
    // 桌面端用 rpc-ui 模式，需要标题生成功能，在此解除禁用。
    // 必须在 session_start（内核启动后、首次对话前）执行，早于内核的 title 生成检查。
    try {
      if (process.env.PI_NO_TITLE || (globalThis as any).Bun?.env?.PI_NO_TITLE) {
        delete process.env.PI_NO_TITLE
        if (typeof Bun !== "undefined" && (Bun as any).env) delete (Bun as any).env.PI_NO_TITLE
        log("session_start.title_enable", "PI_NO_TITLE cleared, AI title generation enabled")
      }
    } catch (e: any) {
      log("session_start.title_enable.error", e?.message || String(e))
    }
  })

  // ── 1. before_agent_start ── 注入行为约束 + 项目 PROJECT.md 生成/注入
  pi.on("before_agent_start", async (event: any, ctx?: any) => {
    try {
      agentTurnCount++
      silentToolCallCount = 0
      consecutiveBlockCount = 0
      // skill/ask 状态已改为会话级持久+超时重置，不在此处清零。
      // 仅清理过期的 skill 状态（超过 TTL 的条目）
      const now = Date.now()
      for (const [skill, ts] of skillLoadedMap) {
        if (now - ts >= SKILL_STATE_TTL_MS) skillLoadedMap.delete(skill)
      }
      if (askTimestamp && now - askTimestamp >= SKILL_STATE_TTL_MS) askTimestamp = 0
      await sanitizeTools("before_agent_start")

      const injected: string[] = []

      // (a) 行为约束：constraints-inject.md
      const injectPath = join(MEMORY_DIR, "constraints-inject.md")
      if (existsSync(injectPath)) {
        try {
          const injectContent = readFileSync(injectPath, "utf8").trim()
          if (injectContent) injected.push(injectContent)
        } catch (err: any) {
          log("before_agent_start.inject.error", err?.message || String(err))
        }
      }

      // (a2) 用户档案：USER.md（L1 层记忆，每次会话注入）
      // 写入规则：用户说“以后你都必须/不能 xxx”“记住我喜欢/讨厌 xxx”时写入
      const userMdPath = join(MEMORY_DIR, "USER.md")
      if (existsSync(userMdPath)) {
        try {
          const userContent = readFileSync(userMdPath, "utf8").trim()
          if (userContent) injected.push(`# 用户偏好（USER.md）\n\n> 写入规则：用户说“以后你都必须/不能 xxx”“记住我喜欢/讨厌 xxx”等跨项目偏好时写入此文件。项目级约束写 PROJECT.md。\n\n${userContent}`)
        } catch {}
      }

      // (b) 项目级 PROJECT.md：项目根目录首次对话自动生成脚手架，并确定性注入 system prompt
      // 模板版本号：检测到旧版本时自动升级头部模板（保留用户正文内容）
      try {
        const projectDir = process.cwd()
        const projectMd = join(projectDir, "PROJECT.md")
        const SCAFFOLD_VERSION = "v2"
        const VERSION_MARKER = `<!-- scaffold:${SCAFFOLD_VERSION} -->`

        // 生成脚手架头部模板（版本标记 + 标题 + 元信息 + 路径约定）
        function buildScaffoldHeader(dirName: string, today: string): string {
          return [
            `<!-- scaffold:${SCAFFOLD_VERSION} -->`,
            `# PROJECT.md - ${dirName}`,
            "",
            `> 项目纲领文件。AI 只允许写入「项目目标」和「里程碑进展」（非必要不写），其余内容由用户维护。近期决策/踩坑由 mnemopi 自动记录。`,
            "- **项目名称**：" + dirName,
            "- **项目目标**：暂未确定",
            "- **创建时间**：" + today,
            "",
            "## 项目概述",
            "",
            "（项目目标、技术栈、关键路径）",
            "",
            "**安装方式：移动硬盘便携安装**。Tiffa 安装在移动硬盘上（盘符不固定，可能 E:、F:、G: 等），所有路径必须用相对于 `PORTABLE_ROOT` 的自包含路径，**禁止硬编码盘符**。",
            "",
            "### 路径约定",
            "",
            "- `PORTABLE_ROOT`：Tiffa 安装根目录，启动时自动解析（`--portable-root` CLI 参数 / `PORTABLE_ROOT` 环境变量 / `__dirname/..`），代码中始终用 `path.join(PORTABLE_ROOT, ...)` 拼接",
            "- 文档中记录路径时用 `$ROOT/...` 表示相对于 `PORTABLE_ROOT` 的路径（如 `$ROOT/data/agent/`、`$ROOT/skills/`、`$ROOT/workspace/`）",
            "- 内核环境变量也基于 `PORTABLE_ROOT`：`PI_CODING_AGENT_DIR=$ROOT/data/agent`，`HOME=$ROOT/home`，`BUN_INSTALL=$ROOT`",
            "- `projects.json` 中的 cwd 在启动时会自动迁移盘符（`extractWorkspaceSuffix` 提取 `workspace/` 后缀，重新拼接到当前 `PORTABLE_ROOT`），所以历史记录不怕盘符变化",
            "",
          ].join("\n")
        }

        // 脚手架尾部模板（章节标题 —— 只放稳定的架构级信息）
        const SCAFFOLD_TAIL = [
          "## 架构约定",
          "",
          "（只放稳定的、不经常变动的架构决策和技术约束）",
          "",
          "## 外部服务 / 端口",
          "",
          "（如 ComfyUI: http://host:port 等，写入真实地址可避免弱模型幻觉成错误端口）",
          "",
        ].join("\n")

        if (!existsSync(projectMd)) {
          // 首次生成
          const dirName = projectDir.split(/[\\/]/).pop() || "project"
          const today = new Date().toISOString().split("T")[0]
          const scaffold = buildScaffoldHeader(dirName, today) + SCAFFOLD_TAIL
          try {
            writeFileSync(projectMd, scaffold, "utf8")
            log("before_agent_start.project_md", `created ${projectMd}`)
          } catch (e: any) {
            log("before_agent_start.project_md.error", e?.message || String(e))
          }
        } else {
          // 已存在：检测旧版本，自动升级头部模板
          try {
            const existing = readFileSync(projectMd, "utf8")
            if (!existing.includes(VERSION_MARKER)) {
              // 旧版或无版本标记 -> 升级
              const dirName = projectDir.split(/[\\/]/).pop() || "project"
              const today = new Date().toISOString().split("T")[0]
              const newHeader = buildScaffoldHeader(dirName, today)

              // 尝试提取用户已写的正文（跳过旧头部，从第一个 ## 章节标题开始保留）
              const sectionMatch = existing.match(/\n## /)
              let userBody = ""
              if (sectionMatch && sectionMatch.index !== undefined) {
                userBody = existing.substring(sectionMatch.index + 1) // 保留从 ## 开始的内容
              }

              const upgraded = newHeader + (userBody || SCAFFOLD_TAIL)
              writeFileSync(projectMd, upgraded, "utf8")
              log("before_agent_start.project_md", `upgraded to ${SCAFFOLD_VERSION} ${projectMd}`)
            }
          } catch (e: any) {
            log("before_agent_start.project_md.upgrade.error", e?.message || String(e))
          }
        }
        if (existsSync(projectMd)) {
          const pm = readFileSync(projectMd, "utf8").trim()
          if (pm) injected.push(`# 项目纲领（PROJECT.md · ${projectDir}）\n\n> 写入规则：允许写入「项目目标」「里程碑进展」（非必要不写）「项目铁律/约束」（用户说“这个项目必须/不能 xxx”时写入）。禁止写入踩坑记录、日常决策、临时笔记（由 mnemopi 自动记录）。用户说“以后你都必须/不能 xxx”→写入 USER.md（跨项目偏好）。\n\n${pm}`)
        }
      } catch (err: any) {
        log("before_agent_start.project_md.error", err?.message || String(err))
      }

      // (c) 记忆工具提示：recall 可用于跨项目语义检索历史记忆
      injected.push([
        "# 记忆系统（重要）",
        "",
        "你有语义记忆能力。记忆存储在向量数据库中，通过 `recall` 工具检索，**禁止直接查询 SQLite 数据库文件**。",
        "",
        "## recall（检索记忆）",
        "- 调用方式：`recall` 工具，参数 `{ query: \"检索关键词\" }`",
        "- 触发时机：用户问「之前/上次/以前讨论过」「记得吗」「查一下历史」，或你不确定某事是否做过时",
        "- 示例：`recall({ query: \"ComfyUI 管线配置\" })`、`recall({ query: \"用户偏好的代码风格\" })`",
        "- 返回：相关记忆列表（包含内容、时间、来源）",
        "",
        "## retain（记住事实）",
        "- 已开启自动 retain（每 2 轮），一般无需手动调用",
        "- 仅当用户明确说「记住这个」「把这个存下来」时才手动调用",
        "",
        "## 禁止事项",
        "- 日常对话中检索记忆优先用 `recall` 工具（语义排序、自动双层搜索）",
        "- 仅在诊断/统计/结构化查询（按时间、按类型筛选）时才直接查询数据库",
        "- 数据库路径：`$PORTABLE_ROOT/data/agent/memories/mnemopi/mnemopi.db`（全局 bank）",
      ].join("\n"))

      if (injected.length > 0) {
        const lineCount = injected.reduce((n, s) => n + s.split("\n").length, 0)
        log("before_agent_start.inject", `injecting ${lineCount} lines (constraints + project.md)`)
        return { systemPrompt: injected }
      }
    } catch (err: any) {
      log("before_agent_start.error", err?.message || String(err))
    }
  })

  // ── 2. tool_call ── 危险路径/配置文件/.env 拦截 + 静默工具调用检测
  pi.on("tool_call", async (event: any) => {
    try {
      const tool = event.toolName || ""
      const input = event.input || {}

      // ── 连续拦截熔断：同一轮被 block 3 次后强制终止，避免弱模型反复重试撑爆 context ──
      if (consecutiveBlockCount >= 3) {
        log("tool_call.circuit_breaker", `consecutiveBlockCount=${consecutiveBlockCount}, tool=${tool}`)
        consecutiveBlockCount = 0  // 重置，下一轮可以重新开始
        return {
          block: true,
          reason: `[claude-mode] 熔断：你已被连续拦截 ${consecutiveBlockCount + 1} 次。停止重试！请换一种完全不同的方法，或者直接用文字回复用户说明情况。不要再次调用同一个工具。`,
        }
      }
      consecutiveBlockCount++  // 每次进入 hook 先加 1，如果工具最终放行则在末尾重置为 0

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

      // read / bash 工具：拦截读取 .env / 密钥文件
      if (tool === "read" || tool === "bash" || tool === "shell") {
        let readPath = ""
        if (tool === "read") {
          readPath = String(input.filePath || input.path || "")
          // 跟踪 read skill://<name> 调用
          if (readPath.startsWith("skill://")) {
            const skillName = readPath.slice("skill://".length).split("/")[0].split("?")[0]
            if (skillName) {
              skillLoadedMap.set(skillName, Date.now())
              lastSkillRead = skillName
              log("tool_call.skill_loaded", `skill://${skillName}`)
            }
          }
        } else {
          // bash/shell: 提取 cat/type/Get-Content 等读取命令的目标文件
          const cmd = String(input.command || input.content || "")
          const readCmdMatch = cmd.match(/(?:cat|type|Get-Content|less|more|head|tail)\s+["']?([^\s"']+)["']?/i)
          if (readCmdMatch) readPath = readCmdMatch[1]
        }
        if (readPath && isSecretFilePath(readPath)) {
          log("tool_call.blocked", `${tool} -> ${readPath} (secret file read attempt)`)
          return { block: true, reason: `[claude-mode] 禁止读取密钥/配置文件 ${readPath}。如确需访问，请向用户说明原因并请求授权。` }
        }
      }

      // bash 工具：拦截在 workspace 根目录下 mkdir
      if (tool === "bash" || tool === "shell") {
        const cmd = String(input.command || input.content || "")

        // ── 反斜杠路径自动纠正：所有模型都习惯写 \，但 OMP bash 要求 / ──
        // 检测命令中是否含 Windows 风格路径（盘符:\ 或 连续 \）
        if (/[A-Za-z]:\\/.test(cmd) || /\\[A-Za-z\u4e00-\u9fff]/.test(cmd)) {
          const fixed = cmd.replace(/\\/g, "/")
          log("tool_call.backslash_fix", `original: ${cmd.substring(0, 100)}`)
          return {
            block: true,
            reason: `[claude-mode] bash 命令中的路径必须用正斜杠 /，不能用反斜杠 \\。请用以下修正后的命令重试：\n${fixed}`,
          }
        }
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

      // ── 技能强制：跟踪 ask 工具调用（模型问了用户）──
      if (tool === "ask") {
        askTimestamp = Date.now()
        log("tool_call.ask", `ask recorded at ${askTimestamp}`)
      }

      // ── 技能强制：调技能脚本前必须先 read skill:// 和 ask 用户 ──
      if (tool === "bash" || tool === "shell") {
        const cmd = String(input.command || input.content || "")
        for (const rule of SKILL_SCRIPT_RULES) {
          if (rule.pattern.test(cmd)) {
            if (!isSkillFresh(rule.skill)) {
              log("tool_call.blocked", `${rule.skill} script called without fresh SKILL.md read`)
              return {
                block: true,
                reason: `[claude-mode] 检测到调用 ${rule.skill} 脚本，但尚未加载技能步骤（或已过期）。必须先执行 \`read skill://${rule.skill}\` 读取完整步骤规则，再按规则执行。不读就做 = 跳步骤。`,
              }
            }
            if (rule.requireAsk && !isAskFresh()) {
              log("tool_call.blocked", `${rule.skill} script called without fresh ask`)
              return {
                block: true,
                reason: `[claude-mode] 检测到调用 ${rule.skill} 脚本，但尚未询问用户（或询问已过期）。SKILL.md 要求：执行前必须先用 ask 工具询问用户（如"要不要生图""选哪种管线"等）。请先问用户，再执行。`,
              }
            }
            // ask >= 1 表示模型已问过用户，现在尝试执行——放行
            break
          }
        }

        // ── 技能强制：禁止内联 pyautogui/mss/PIL 操控桌面 ──
        const desktopLibPattern = /\b(pyautogui|import\s+mss|from\s+mss|from\s+PIL|import\s+PIL)\b/
        if (desktopLibPattern.test(cmd) && !cmd.includes("computer_use.py")) {
          log("tool_call.blocked", "inline pyautogui/mss detected without computer_use.py")
          return {
            block: true,
            reason: `[claude-mode] 检测到 bash 中内联使用 pyautogui/mss/PIL 操控桌面。禁止自己写 Python 操控桌面代码，必须通过 computer_use.py 脚本执行。正确用法：\`python "<computer_use.py绝对路径>" run "<任务描述>"\``,
          }
        }
      }
    } catch (err: any) {
      log("tool_call.error", err?.message || String(err))
    }
    // 工具放行（没有被任何拦截规则 block）→ 重置连续拦截计数
    consecutiveBlockCount = 0
  })

  // ── 3. session.compacting ── gap-fill 断片提取 + compact dump + 立即注入
  pi.on("session.compacting", async (event: any, ctx?: any) => {
    try {
      const sessionID = event.sessionId || ""
      log("session.compacting", `=== fired === sessionID: ${sessionID}`)

      cleanupGapFills(sessionID)

      const messages: any[] = event.messages || []
      if (messages.length === 0) return

      // compact dump：落盘最近 50 条消息原文
      try {
        ensureDir(INBOX_DIR)
        const inboxPath = join(INBOX_DIR, `compact-${sessionID}-${Date.now()}.txt`)
        const formatted = messages.slice(-50).map((m) => {
          const role = m.role || "unknown"
          const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")
          const truncated = content.length > 2000 ? content.slice(0, 2000) + "..." : content
          return `[${role}] ${truncated}`
        }).join("\n\n")
        writeFileSync(inboxPath, formatted, "utf8")
        log("session.compacting.dump", `wrote ${inboxPath}`)
      } catch (err: any) {
        log("session.compacting.dump.error", err?.message || String(err))
      }

      // gap-fill 提取：改动文件 / 关键命令 / 决策要点 / 已读文件
      try {
        const gapFillPath = join(INBOX_DIR, `gap-fill-${sessionID}.md`)
        try { if (existsSync(gapFillPath)) unlinkSync(gapFillPath) } catch {}

        const entries: string[] = []
        const fileSet = new Set<string>()
        const readFileSet = new Set<string>()
        const cmdSet = new Set<string>()
        const decisionLines = new Set<string>()
        const kw = /(决定|配置|记住|改了|选了|用.{0,6}方案|路径|踩坑|原因|因为|应该|必须|不要|放弃|采用|修复)/

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
              const noisePrefix = /^(-|\||-|\*|>|"|⚠️|📁|📌|\d+[.、]|\s*[-*]\s)/u
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
          entries.push("## 已读过的文件（无需重读）")
          for (const f of [...readFileSet].sort()) entries.push(`- 已读取：${f}`)
          entries.push("")
        }
        if (fileSet.size > 0) fileSet.forEach((f) => entries.push(`- 改动文件：${f}`))
        if (cmdSet.size > 0) cmdSet.forEach((c) => entries.push(`- 关键命令：${ellipsis(c, 140, 50)}`))
        if (decisionLines.size > 0) decisionLines.forEach((s) => entries.push(`- 决策/要点：${ellipsis(s, 90, 40)}`))

        if (entries.length > 0) {
          const uniq = [...new Set(entries)].slice(0, 60)
          const stats = [
            readFileSet.size > 0 ? `${readFileSet.size} 已读` : "",
            fileSet.size > 0 ? `${fileSet.size} 改动` : "",
            cmdSet.size > 0 ? `${cmdSet.size} 命令` : "",
            decisionLines.size > 0 ? `${decisionLines.size} 决策` : "",
          ].filter(Boolean).join("、")
          const body = `# Gap-fill (断片补救) - ${sessionID}\n\n> 由 compacting hook 自动提取，60 分钟后清理。\n\n${uniq.join("\n")}\n`
          writeFileSync(gapFillPath, body, "utf8")
          log("session.compacting.gapfill", `wrote ${uniq.length} entries to ${gapFillPath} [${stats}]`)

          // 可观测性：通知用户 gap-fill 已触发及提取摘要
          try {
            if (ctx?.ui?.notify) {
              ctx.ui.notify(`断片补救已触发：提取 ${stats || "0 项"}，详见 inbox/gap-fill-${sessionID}.md`, "info")
            }
          } catch (e: any) { log("session.compacting.notify.error", e?.message || String(e)) }

          // 立即注入压缩后上下文（不等下轮）
          const contextText = [
            "# 断片补救（gap-fill，压缩时自动提取）",
            "",
            body,
          ].join("\n")
          return { context: [contextText] }
        }
      } catch (err: any) {
        log("session.compacting.gapfill.error", err?.message || String(err))
      }
    } catch (err: any) {
      log("session.compacting.error", err?.message || String(err))
    }
  })

  let hasContinuedAfterError = false  // 本轮是否已续行过一次

  // ── 4. session_stop ── error 续行一次，5 秒后执行
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

      // 正常完成时重置标记
      if (reason === "complete") {
        hasContinuedAfterError = false
      }

      auditLog({ event: "session_stop", reason, stopReason: lastMsg?.stopReason, hasContinuedAfterError })
      log("session_stop", `reason=${reason} hasContinuedAfterError=${hasContinuedAfterError}`)

      // error 且本轮未续行过：5 秒后续行一次
      if (reason === "error" && !hasContinuedAfterError) {
        hasContinuedAfterError = true
        log("session_stop", "continuing after error in 5s (one-time)")
        await new Promise(r => setTimeout(r, 5000))
        return { continue: true, additionalContext: "上一轮请求出错，请继续之前的任务。如果无法继续，向用户说明情况。" }
      }
      if (reason === "error") {
        log("session_stop", "already continued once after error, stopping")
      }
    } catch (err: any) {
      log("session_stop.error", err?.message || String(err))
    }
  })

  // ── 5. tool_result ── 审计日志 + 堆栈/路径泄露拦截 + 技能路径注入
  pi.on("tool_result", async (event: any, ctx?: any) => {
    try {
      const tool = event.toolName || "unknown"
      auditLog({ event: "tool_result", tool, isError: event.isError || false })
      log("tool_result", `tool=${tool}`)

      // 技能路径注入：读取 skill:// 后追加绝对路径提示（弱模型不会自己拼）
      if (tool === "read" && lastSkillRead && SKILL_PATH_HINTS[lastSkillRead] && !event.isError) {
        const hint = SKILL_PATH_HINTS[lastSkillRead]
        lastSkillRead = "" // 消费一次后清空
        const existing = Array.isArray(event.content) ? event.content : []
        return {
          content: [...existing, { type: "text", text: hint }],
        }
      }
      lastSkillRead = "" // 非技能读取时也清空

      // 检查错误结果是否泄露堆栈/路径
      if (event.isError) {
        // 提取文本内容
        const resultText = Array.isArray(event.content)
          ? event.content
              .filter((c: any) => c?.type === "text" && typeof c?.text === "string")
              .map((c: any) => c.text)
              .join("\n")
          : typeof event.content === "string" ? event.content : ""

        if (hasStackLeak(resultText)) {
          log("tool_result.sanitized", `${tool} result contained stack trace, sanitizing`)
          // 返回修改后的内容（ToolResultEventResult 只支持 content/details/isError）
          return {
            content: [{
              type: "text",
              text: `[错误] 工具执行失败，详细信息已被安全过滤。请检查输入参数后重试，或向用户描述错误现象。`,
            }],
            isError: true,
          }
        }
      }
    } catch (err: any) {
      log("tool_result.error", err?.message || String(err))
    }
  })

  log("init", "=== claude-mode extension v6.2 ready ===")
}
