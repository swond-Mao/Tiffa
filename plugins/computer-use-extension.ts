/**
 * computer-use-extension.ts - 电脑控制安全插件
 *
 * 职责：
 * 1. 拦截 bash 中内联 pyautogui/mss/PIL 操控桌面的代码
 * 2. 注入系统提示词，告知模型使用 computer_use 工具
 * 3. 拦截 dangerous 桌面操作
 *
 * 依赖：MCP Server (computer_use_mcp.py) 注册了 computer_use 工具
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const PLUGIN_DIR = import.meta.dir
const PLUGIN_LOG = join(PLUGIN_DIR, "computer-use.log")

function log(category: string, payload: string | string[] | unknown) {
  const ts = new Date().toISOString()
  const lines = Array.isArray(payload) ? payload : [payload]
  const text = lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join(" | ")
  try { appendFileSync(PLUGIN_LOG, `[${ts}] [${category}] ${text}\n`, "utf8") } catch {}
}

// 后台开关：data/agent/computer-use-enabled = "true" 才启用电脑控制。
// 与 main.js 的开关共用同一标记文件（默认关 -> 启动不拉起 MCP、也不注入工具说明）。
function computerUseEnabled(): boolean {
  try {
    const flag = resolve(import.meta.dir, "..", "data", "agent", "computer-use-enabled")
    if (!existsSync(flag)) return false
    return readFileSync(flag, "utf8").trim() === "true"
  } catch {
    return false
  }
}

export default async function (pi: any) {
  log("init", "=== computer-use extension loaded ===")

  // ── 工具调用拦截 ──
  pi.on("tool_call", async (event: any) => {
    try {
      const tool = event.tool
      const input = event.input || event.arguments || {}

      if (tool === "bash" || tool === "shell") {
        const cmd = String(input.command || input.content || "")

        // 拦截内联 pyautogui/mss/PIL 操控桌面
        const desktopLibPattern = /\b(pyautogui|import\s+mss|from\s+mss|from\s+PIL|import\s+PIL)\b/
        if (desktopLibPattern.test(cmd) && !cmd.includes("computer_use")) {
          log("tool_call.blocked", "inline pyautogui/mss detected")
          return {
            block: true,
            reason: `[电脑控制] 检测到 bash 中内联使用 pyautogui/mss/PIL 操控桌面。禁止自己写 Python 操控桌面代码，请使用 MCP 电脑控制工具集（ui_inspect / ui_act / ui_screenshot / desktop_input）。`,
          }
        }

        // 拦截危险操作
        const dangerousPattern = /\b(format\s|shutdown|regedit|taskkill.*\/f.*\/im\s+(explorer|dwm|csrss|lsass|services))\b/i
        if (dangerousPattern.test(cmd)) {
          log("tool_call.blocked", "dangerous command detected")
          return {
            block: true,
            reason: `[电脑控制] 检测到危险命令，已拦截。禁止执行格式化、关机、注册表、杀系统进程等操作。`,
          }
        }
      }
    } catch (err: any) {
      log("tool_call.error", err?.message || String(err))
    }
  })

  // ── 系统提示词注入：告知模型 computer_use 工具的用法 ──
  pi.on("before_agent_start", async (event: any) => {
    try {
      if (!computerUseEnabled()) {
        log("before_agent_start", "computer-use disabled, skip tool instructions")
        return
      }
      const prompt = event.systemPrompt || []
      // 注入电脑控制工具使用说明（v2 原子工具集）
      const computerUsePrompt = [
        {
          type: "text",
          text: `[电脑控制 v3 — 探测优先 + 分类施策]

当用户要求操作电脑、控制桌面、打开应用等桌面自动化任务时，
使用 MCP 电脑控制工具集。禁止在 bash 中自己写 pyautogui/mss/PIL。

【★★★ 三阶段强制流程（不可跳过） ★★★】

■ 阶段一：应用探测（必须先做！）
  1. 确定目标应用是什么、UI 框架是什么
  2. 执行 ui_inspect(window="目标窗口") 试探控件树
     - 返回 ≥5 个有名称控件 → UIA 可用
     - 返回 <3 个或全是 Pane/Custom → 盲窗
  3. 判断有无后台通道（CLI / API / COM）
  常见应用速查：
     微信/QQ = Qt盲窗,无API → OCR路线
     钉钉/飞书/Teams = Electron,有API → API优先
     Office/Outlook = COM自动化 → PowerShell后台
     记事本/资源管理器 = Win32 → UIA精控
     VS Code = 有CLI code命令 → CLI优先
     游戏/Steam = 全盲 → 视觉兜底

■ 阶段二：策略选择（向用户说明理由）
  A. 后台直通：有 CLI/API/COM → bash 直接调，不碰 GUI
  B. UIA 精控：Win32/WPF 标准控件 → inspect→act→screenshot
  C. OCR 盲操：Qt/盲窗 → ui_ocr→ui_find_text→ui_click_text
  D. 视觉兜底：纯图形界面 → screenshot(annotate)→desktop_input
  E. 混合策略：多应用任务按应用分段，每段独立策略
  优先级：A > B > C > D

■ 阶段三：分步执行 + 验证
  - 每步操作后截图/inspect 验证
  - 与预期不符 → 停下重新探测，不盲目重试
  - 多应用任务分段执行，每段独立验证

【工具速查】
  ui_inspect(window?) → 枚举控件（探测用）
  ui_act(ref, action) → 操作元素
  ui_screenshot(annotate?) → 截图验证
  desktop_input(action, nx?, ny?) → 归一化坐标兜底
  ui_ocr(window?) → OCR识别（盲窗用）
  ui_find_text(query, window?) → OCR模糊匹配
  ui_click_text(query, window?) → OCR找字点击
  computer_use(task) → 简单任务便利入口

【关键规则】
  - 禁止跳过探测直接规划“点哪里、输什么”
  - 禁止对所有应用一视同仁，必须分类施策
  - 有后台通道的应用绝不走 GUI
  - 禁止全屏 OCR/截图找内容：Tiffa 窗口里显示着对话内容（含任务关键词），全屏扫描会把对话文字误认为目标应用内容。必须始终指定 window 参数只扫目标窗口
  - 输入中文用 desktop_input(action="type")，自动剪贴板粘贴，支持中文
  - 执行前会弹确认框，ESC 可随时中断`
        }
      ]
      event.systemPrompt = [...prompt, ...computerUsePrompt]
      log("before_agent_start", "injected computer_use tool instructions")
    } catch (err: any) {
      log("before_agent_start.error", err?.message || String(err))
    }
  })

  log("init", "=== computer-use extension ready ===")
}
