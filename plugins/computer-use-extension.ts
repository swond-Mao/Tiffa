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
import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const PLUGIN_DIR = import.meta.dir
const PLUGIN_LOG = join(PLUGIN_DIR, "computer-use.log")

function log(category: string, payload: string | string[] | unknown) {
  const ts = new Date().toISOString()
  const lines = Array.isArray(payload) ? payload : [payload]
  const text = lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join(" | ")
  try { appendFileSync(PLUGIN_LOG, `[${ts}] [${category}] ${text}\n`, "utf8") } catch {}
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
      const prompt = event.systemPrompt || []
      // 注入电脑控制工具使用说明（v2 原子工具集）
      const computerUsePrompt = [
        {
          type: "text",
          text: `[电脑控制工具 v2 — UIA 优先 + 四级降级]

当用户要求操作电脑、控制桌面、打开应用、输入文字等桌面自动化任务时，
使用 MCP 电脑控制工具集（5 个原子工具）。禁止在 bash 中自己写 pyautogui/mss/PIL。

【标准工作流】
1. ui_inspect(window?) → 枚举当前窗口的可交互控件（返回编号+名称+坐标表+缩略图）
2. ui_act(ref="#编号", action="invoke/click/set_text/...") → 操作指定元素
3. ui_screenshot(annotate=True) → 截图（可选 SoM 编号标注框，4K 友好）
4. desktop_input(action, nx?, ny?) → 归一化坐标兜底（游戏/Canvas/Electron）

【关键规则】
- 第一步永远是 ui_inspect() 看有哪些元素可用
- ui_act 的 ref 用 inspect 返回的编号（如 "#5"）或名称片段
- 每步操作后调用 ui_screenshot() 验证结果——操作后自动附带截图回传
- UIA 路径（L1/L2）不需要视觉模型，速度快且零偏差
- SoM 标注模式（annotate=true）在截图上画编号框，模型只需选编号
- desktop_input 坐标是 0~1000 归一化的，与屏幕分辨率解耦
- 简单任务可用 computer_use(task=...) 便利入口；复杂多步任务逐步调原子工具
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
