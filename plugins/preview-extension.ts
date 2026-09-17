/**
 * preview-extension.ts — 让 AI 把预览推到 Tiffa 侧边栏实时预览区
 *
 * 为什么需要它：渲染层的预览面板只能被动接收，而「何时该推」只有 AI 自己知道。
 * 本扩展注册 preview_show 工具，并在会话启动时注入使用规则。
 *
 * 通道选择：用内核既有的 ui.setWidget（ExtensionUIContext），不新增 IPC、不新起进程。
 * 约定 widgetKey 以 `preview:` 开头，前端 eventRouter 据此识别为预览帧并上屏；
 * 其它 key 维持原语义（终端控件，桌面端直接确认）。
 * ⚠️ setWidget 是 fire-and-forget（返回 void、无回调），所以对模型的回执只能由本
 *    扩展自己组织 —— 地址取自主进程写入的 TIFFA_PREVIEW_ORIGIN，不谎报完整 URL
 *    （条目 id 由前端转主进程登记后才存在）。
 *
 * 文件从磁盘读，不经过模型上下文：预览 HTML 动辄几十 KB，塞进对话既烧 token
 * 又会让后续每轮都带上它。前端按 id 向主进程回环服务取内容。
 */
import { statSync } from "node:fs"
import { isAbsolute, resolve, sep } from "node:path"

const TYPE_HINT = /\.(html?|svg|png|jpe?g|webp|gif|css|js|json|md|txt|csv|log)$/i

/** 只读校验：不登记、不占用 watcher */
function checkFile(fp: string): { ok: boolean; why?: string; size?: number } {
  if (!fp) return { ok: false, why: "路径为空" }
  if (!isAbsolute(fp)) return { ok: false, why: "必须是绝对路径" }
  if (!TYPE_HINT.test(fp)) return { ok: false, why: "该类型暂不支持预览（支持 html/图片/文本类）" }
  try {
    const st = statSync(fp)
    if (!st.isFile()) return { ok: false, why: "不是文件" }
    return { ok: true, size: st.size }
  } catch {
    return { ok: false, why: "文件不存在或不可读" }
  }
}

/**
 * 主进程回环服务 origin。
 * 由 electron/main.ts 在 listen 之后写入 process.env.TIFFA_PREVIEW_ORIGIN，
 * 内核 Bun 子进程继承 —— 扩展与前端拿到同一地址，不会各猜一个端口。
 */
function previewOrigin(): string | null {
  const raw = process.env.TIFFA_PREVIEW_ORIGIN || ""
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(raw) ? raw : null
}

/**
 * 载荷约定：首行为 JSON 元数据 {file,title}，其余行不参与解析。
 * 用整段正文当解析源会被 HTML 里的花括号带偏，故只信任首行。
 */
function buildWidgetLines(file: string, title: string): string[] {
  return [JSON.stringify({ file, title })]
}

export default async function (pi: any) {
  const Type = pi?.typebox?.Type
  const hasUi = !!pi?.ui && typeof pi.ui.setWidget === "function"

  if (Type && typeof pi?.registerTool === "function") {
    try {
      pi.registerTool({
        name: "preview_show",
        label: "推送预览",
        description: [
          "把一个本地文件（HTML 页面 / 截图 / SVG / 文本）推送到 Tiffa 侧边栏的「实时预览」区，让用户直接看到成果。",
          "file 必须是绝对路径。同一文件重复推送会顶到同一个预览条目并自动刷新（不必先关后开）。",
          "适用时机：生成或修改了 HTML/图片/海报/页面截图之后；用户说「打开看看」「预览给我看」「效果如何」时。",
          "预览区在文件被再次写入时会自动更新，所以改完文件不必每改一次就推一次 —— 推一次后继续改即可。",
          "本工具不读取文件内容、不占用对话上下文，只传路径。",
        ].join(" "),
        parameters: Type.Object({
          file: Type.String({ description: "要预览的文件绝对路径，如 G:/proj/output/page.html" }),
          title: Type.Optional(Type.String({ description: "预览条目显示名，缺省用文件名" })),
        }),
        async execute(_toolCallId: string, params: any) {
          const file = resolve(String(params?.file || ""))
          const chk = checkFile(file)
          if (!chk.ok) {
            return {
              content: [{ type: "text", text: `预览未推送：${chk.why}（${params?.file || "空"}）` }],
              isError: true,
            }
          }
          if (!hasUi) {
            return {
              content: [{ type: "text", text: "预览未推送：当前运行环境无 ui.setWidget 通道（非 Tiffa 桌面端）" }],
              isError: true,
            }
          }
          const origin = previewOrigin()
          if (!origin) {
            // 服务没起来时直说，别推一帧让前端渲染空白框 —— 那比报错更难解释
            return {
              content: [{ type: "text", text: "预览未推送：主进程预览服务未就绪（需重启 Tiffa 应用加载新代码）" }],
              isError: true,
            }
          }
          const title = String(params?.title || "").trim() || file.split(sep).pop() || file
          try {
            pi.ui.setWidget("preview:" + file, buildWidgetLines(file, title))
          } catch (e: any) {
            return {
              content: [{ type: "text", text: `预览推送失败：${e?.message || String(e)}` }],
              isError: true,
            }
          }
          return {
            content: [{
              type: "text",
              text: [
                `已推送到侧边栏「实时预览」：${title}`,
                `文件：${file}（${chk.size} 字节）`,
                `预览服务：${origin}`,
                `该文件再次被写入时预览会自动刷新，无需重复推送。`,
              ].join("\n"),
            }],
          }
        },
      })
    } catch {
      /* 注册失败不拖垮扩展加载 */
    }
  }

  // ── 使用规则注入 ──
  // 不注入的话模型不知道有这个工具（扩展工具默认 discoverable），功能等于没装。
  pi.on("before_agent_start", async () => {
    return {
      systemPrompt: [
        "# 侧边栏实时预览（重要）",
        "",
        "你有 `preview_show` 工具：把本地文件推到用户界面右侧的「实时预览」区，用户当场看到成果。",
        "",
        "## 何时必须调用",
        "- 生成或改完 **HTML 页面 / 海报 / 落地页 / 图表页** —— 不要只说「已生成 xxx.html」，用户看不到渲染结果",
        "- 产出 **截图、渲染图、SVG** 等图像文件后",
        "- 用户说「打开看看」「预览给我看」「我看下效果」「哪里不对」时",
        "- 修 UI/布局问题：先预览现状 → 定位代码 → 改完再预览一次，让用户看到前后对比",
        "",
        "## 注意",
        "- 同一文件重复推送顶到同一条目并自动刷新；**改文件过程中不必每改一次推一次**，推一次后继续改即可",
        "- 参数是绝对路径；文件必须已存在（先写盘再预览）",
        "- 本工具不把内容读进对话，不占上下文",
        "- 若返回「预览服务未就绪」，说明应用需要重启，如实告知用户即可，不要反复重试",
      ].join("\n"),
    }
  })
}
