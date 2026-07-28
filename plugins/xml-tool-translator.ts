/**
 * xml-tool-translator.ts — XML 工具调用翻译层 (v7.0)
 *
 * 将模型输出的 XML 格式工具调用翻译成标准 tool_calls 事件。
 * 注册 streamSimple 到 "custom-openai" API 名，
 * models.yml 中 qwen.api="custom-openai" 的模型会走此翻译层。
 *
 * v7.0 前端开关模式：
 * - 注册只传 {api:"custom-openai", streamSimple}，不传 models/baseUrl/apiKey
 * - models.yml 中 qwen.api="custom-openai"，用户看不到这个字段
 * - 每次请求前读开关文件 `data/agent/xml-translation-enabled`
 *   - 文件存在且内容为 "true" → 启用 XML 翻译
 *   - 文件不存在或内容非 "true" → 纯 pass-through（直接调原生 OpenAI completions）
 * - 任何模型都可能需要 XML 翻译（不仅千问），前端开关全局控制
 *
 * XML 格式示例（模型退化为 XML 工具调用时的输出）：
 *   <function=read>{"filePath": "/some/path"}</function>
 *   <function=bash>{"command": "ls -la"}</function>
 *
 * 设计原则：
 * - 同时支持原生 tool_calls（pass-through）和 XML 格式（translate）
 * - XML 检测基于 <function=NAME>...payload...</function> 模式
 * - 增量处理：SSE delta 逐块到达，XML 可跨多个 chunk
 * - 容错：XML 解析失败时回退为纯文本
 * - 前瞻缓冲：文本 delta 到达时先缓冲，确认无 XML 后再推送，避免重复
 */

import { appendFileSync, existsSync, statSync, readFileSync } from "node:fs"
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

// ═══════════════════════════════════════════════════════════
// 事件流创建：导入 Tiffa 内核内置 AssistantMessageEventStream
// ═══════════════════════════════════════════════════════════

let _createStreamFn: (() => any) | null | undefined = undefined

async function getCreateStreamFn(): Promise<(() => any) | null> {
  if (_createStreamFn !== undefined) return _createStreamFn

  // 策略1: ESM 动态 import（Bun 原生支持 TS）
  try {
    const mod = await import("@oh-my-pi/pi-ai/utils/event-stream")
    if (typeof mod.createAssistantMessageEventStream === "function") {
      _createStreamFn = mod.createAssistantMessageEventStream
      log("stream.import", "ESM import succeeded")
      return _createStreamFn
    }
  } catch (err: any) {
    log("stream.import.esm-fail", err?.message || String(err))
  }

  // 策略2: 直接路径 import（便携包环境）
  try {
    const tiffaModules = join(PORTABLE_ROOT, "npm-global", "node_modules")
    const mod = await import(join(tiffaModules, "@oh-my-pi", "pi-coding-agent", "node_modules", "@oh-my-pi", "pi-ai", "src", "utils", "event-stream.ts"))
    if (typeof mod.createAssistantMessageEventStream === "function") {
      _createStreamFn = mod.createAssistantMessageEventStream
      log("stream.import", "Direct path import succeeded")
      return _createStreamFn
    }
  } catch (err: any) {
    log("stream.import.direct-fail", err?.message || String(err))
  }

  // 回退：手动构造 AssistantMessageEventStream（最小实现）
  log("stream.import", "All import strategies failed, using manual construction")
  _createStreamFn = createManualStream
  return _createStreamFn
}

/**
 * 手动构造一个兼容 AssistantMessageEventStream 的流对象。
 * 这只在 import 全部失败时使用，尽量匹配 Tiffa 内核内置的行为：
 * - push(event) 在 done 后丢弃事件
 * - end(result) 解决 finalResultPromise
 * - 支持 async iteration
 */
function createManualStream(): any {
  const queue: any[] = []
  const waiting: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = []
  let done = false

  let finalResolve: ((v: any) => void) | null = null
  const finalResultPromise = new Promise<any>(r => { finalResolve = r })

  const stream = {
    push(event: any) {
      if (done) return
      // 检查终止事件
      if (event.type === "done" || event.type === "error") {
        done = true
        if (event.type === "done" && finalResolve) {
          finalResolve(event.message)
        } else if (event.type === "error" && finalResolve) {
          finalResolve(event.error)
        }
      }
      if (waiting.length > 0) {
        waiting.shift()!.resolve({ value: event, done: false })
      } else {
        queue.push(event)
      }
    },
    end(result?: any) {
      if (done) return
      done = true
      if (result && finalResolve) finalResolve(result)
      for (const w of waiting) {
        w.resolve({ value: undefined, done: true })
      }
      waiting.length = 0
    },
    fail(err: unknown) {
      done = true
      for (const w of waiting) {
        w.reject(err)
      }
      waiting.length = 0
    },
    finalResultPromise,
    result() { return finalResultPromise },
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (queue.length > 0) {
            return { value: queue.shift(), done: false }
          }
          if (done) {
            return { value: undefined, done: true }
          }
          return new Promise((resolve, reject) => {
            waiting.push({ resolve, reject })
          })
        },
      }
    },
  }

  return stream
}

// ═══════════════════════════════════════════════════════════
// XML 工具调用正则
// ═══════════════════════════════════════════════════════════

const XML_TOOL_OPEN_RE = /<function[=\s](\w+)>/i

// ═══════════════════════════════════════════════════════════
// SSE 解析器
// ═══════════════════════════════════════════════════════════

async function* parseSSELines(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let buffer = ""
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6)
        if (data === "[DONE]") return
        try { yield JSON.parse(data) } catch { /* skip unparseable */ }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// XML 工具调用增量解析器
// ═══════════════════════════════════════════════════════════

interface XmlToolCallState {
  inXmlTool: boolean
  toolName: string
  argsBuffer: string
}

function createXmlToolCallState(): XmlToolCallState {
  return { inXmlTool: false, toolName: "", argsBuffer: "" }
}

interface ParsedEvent {
  type: "text" | "toolCall"
  text?: string
  toolCall?: { name: string; arguments: Record<string, unknown>; rawXml: string }
}

/**
 * 从文本缓冲中提取并翻译 XML 工具调用。
 * 返回翻译后的事件列表和未消耗的剩余文本。
 */
function extractXmlToolCalls(text: string, state: XmlToolCallState): {
  events: ParsedEvent[]
  remaining: string
} {
  const events: ParsedEvent[] = []
  let pos = 0

  while (pos < text.length) {
    if (state.inXmlTool) {
      const closeIdx = text.indexOf("</function>", pos)
      if (closeIdx === -1) {
        // 未找到闭合标签，继续缓冲
        state.argsBuffer += text.slice(pos)
        return { events, remaining: "" }
      }

      state.argsBuffer += text.slice(pos, closeIdx)
      const rawXml = `<function=${state.toolName}>${state.argsBuffer}</function>`

      let args: Record<string, unknown> = {}
      try {
        const trimmedArgs = state.argsBuffer.trim()
        if (trimmedArgs) args = JSON.parse(trimmedArgs)
      } catch {
        const jsonMatch = state.argsBuffer.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try { args = JSON.parse(jsonMatch[0]) } catch { /* 放弃 */ }
        }
        log("xml-translator.parse-warn", `tool=${state.toolName} args parse failed: ${state.argsBuffer.slice(0, 100)}`)
      }

      events.push({
        type: "toolCall",
        toolCall: { name: state.toolName, arguments: args, rawXml },
      })

      log("xml-translator.detected", `tool=${state.toolName} args=${JSON.stringify(args).slice(0, 100)}`)

      state.inXmlTool = false
      state.toolName = ""
      state.argsBuffer = ""
      pos = closeIdx + "</function>".length
    } else {
      const openMatch = text.slice(pos).match(XML_TOOL_OPEN_RE)
      if (!openMatch) {
        const remaining = text.slice(pos)
        if (remaining) {
          events.push({ type: "text", text: remaining })
        }
        return { events, remaining: "" }
      }

      const beforeText = text.slice(pos, pos + openMatch.index!)
      if (beforeText) {
        events.push({ type: "text", text: beforeText })
      }

      state.inXmlTool = true
      state.toolName = openMatch[1]
      state.argsBuffer = ""
      pos += openMatch.index! + openMatch[0].length
    }
  }

  return { events, remaining: "" }
}

// ═══════════════════════════════════════════════════════════
// 文本缓冲+安全刷新策略
// ═══════════════════════════════════════════════════════════
//
// 核心问题：如果文本到达时立即推 text_delta，后面发现
// 缓冲中有 XML 工具调用，就会导致文本重复推送。
//
// 解决方案：
// 1. 文本 delta 到达时先缓冲到 textBuffer
// 2. 每次缓冲更新后尝试安全刷新：
//    - 如果缓冲尾部可能是 <function= 的开头，hold back
//    - 如果缓冲足够长且无 XML 迹象，安全推送前面的文本
//    - 如果发现 <function= 确认出现，进入 XML 收集模式
// 3. 在 finish_reason 时做最终 flush

const XML_LOOKAHEAD = 20  // 前瞻窗口：hold back 最多 20 字符

/** 检查字符串尾部是否可能是 XML 标签的开始 */
function partialXmlTagEnd(text: string): number {
  const tail = text.slice(-XML_LOOKAHEAD)
  const match = tail.match(/<(?:f|fu|fun|func|funct|functi|functio|function|function[=\s]\w*)?$/)
  if (match) return match[0].length
  return 0
}

// ═══════════════════════════════════════════════════════════
// OpenAI 消息格式转换
// ═══════════════════════════════════════════════════════════

function buildOpenAIMessages(context: any): any[] {
  const messages: any[] = []

  if (context.systemPrompt) {
    const sysText = Array.isArray(context.systemPrompt)
      ? context.systemPrompt.filter((s: any) => typeof s === "string").join("\n\n")
      : String(context.systemPrompt)
    if (sysText) messages.push({ role: "system", content: sysText })
  }

  // v7.3: 先遍历一遍，收集所有 assistant 消息中的 toolCall id（用于防御性配对）
  const allAssistantToolCallIds: string[] = []
  for (const msg of context.messages || []) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "toolCall" && part.id) {
          allAssistantToolCallIds.push(part.id)
        }
      }
    }
  }
  let toolResultIdx = 0  // 全局计数器，用于 fallback 配对

  for (const msg of context.messages || []) {
    // v7.3: 详细日志——追踪 toolCallId 匹配链
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const tcParts = msg.content.filter((p: any) => p.type === "toolCall")
      if (tcParts.length > 0) {
        log("id-debug.assistant", `toolCalls=${tcParts.map((p: any) => `${p.name}#${p.id}`).join(",")}`)
      }
    }
    if (msg.role === "toolResult") {
      log("id-debug.toolResult", `toolCallId=${msg.toolCallId || msg.tool_call_id || "MISSING"} contentLen=${typeof msg.content === "string" ? msg.content.length : Array.isArray(msg.content) ? msg.content.length : 0}`)
    }

    if (msg.role === "user") {
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c: any) => {
              if (c.type === "text") return c.text
              if (c.type === "image") return `[image:${c.mimeType || "png"}]`
              return ""
            }).join("")
          : ""
      messages.push({ role: "user", content })
    } else if (msg.role === "assistant") {
      const entry: any = { role: "assistant", content: null }
      const textParts: string[] = []
      const toolCalls: any[] = []

      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") textParts.push(part.text)
          else if (part.type === "thinking") { /* skip thinking in history */ }
          else if (part.type === "toolCall") {
            toolCalls.push({
              index: toolCalls.length,
              id: part.id,
              type: "function",
              function: { name: part.name, arguments: JSON.stringify(part.arguments || {}) },
            })
          }
        }
      } else if (typeof msg.content === "string") {
        textParts.push(msg.content)
      }

      if (textParts.length > 0) entry.content = textParts.join("")
      if (toolCalls.length > 0) entry.tool_calls = toolCalls
      if (!entry.content && !entry.tool_calls) entry.content = ""

      messages.push(entry)
    } else if (msg.role === "toolResult") {
      const content = Array.isArray(msg.content)
        ? msg.content.map((c: any) => c.text || "").join("")
        : typeof msg.content === "string" ? msg.content : ""

      // v7.3: 防御性 id 配对——优先用消息自带的 id，匹配不到则按顺序从 assistant toolCall 列表中取
      let resolvedId = msg.toolCallId || msg.tool_call_id || ""
      if (!resolvedId || !allAssistantToolCallIds.includes(resolvedId)) {
        // id 为空或不在 assistant toolCall 列表中 → 按顺序配对
        if (toolResultIdx < allAssistantToolCallIds.length) {
          const fallbackId = allAssistantToolCallIds[toolResultIdx]
          log("id-debug.fallback", `original=${resolvedId || "EMPTY"} → fallback=${fallbackId} (idx=${toolResultIdx})`)
          resolvedId = fallbackId
        } else {
          log("id-debug.fallback-failed", `original=${resolvedId || "EMPTY"} idx=${toolResultIdx} out of range (total=${allAssistantToolCallIds.length})`)
          resolvedId = `tc_fallback_${toolResultIdx}`
        }
      }
      toolResultIdx++

      messages.push({
        role: "tool",
        tool_call_id: resolvedId,
        content: msg.isError ? `[ERROR] ${content}` : content,
      })
    }
  }

  return messages
}

function buildOpenAITools(context: any): any[] {
  if (!context.tools || context.tools.length === 0) return []
  return context.tools.map((t: any) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.parameters || t.inputSchema || { type: "object", properties: {} },
    },
  }))
}

// ═══════════════════════════════════════════════════════════
// 自定义 streamSimple 实现
// 重要：streamSimple 必须同步返回 stream 对象！
// Tiffa 内核调用 streamSimple(model, context, options) 时期望同步得到 stream，
// 如果返回 Promise，Tiffa 内核会尝试迭代 Promise 导致 "undefined is not a function"。
// 异步操作（fetch、流处理）在 stream 内部完成。
// ═══════════════════════════════════════════════════════════

function xmlTranslatingStreamSimple(model: any, context: any, options: any): any {
  // 每次请求时检查开关状态
  const xmlTranslationEnabled = isXmlTranslationEnabled()

  // 调试：记录 Tiffa 内核传入的 model 对象结构，确认 baseUrl/apiKey 是否被传入
  log("xml-translator.model-info", `model=${JSON.stringify({id:model.id,name:model.name,provider:model.provider,api:model.api,baseUrl:model.baseUrl,requestModelId:model.requestModelId})} options_keys=${Object.keys(options||{}).join(",")}`)

  // 同步创建 stream：优先使用已缓存的 Tiffa 内核内置 stream，否则用 manual 实现
  // 注意：不能 await getCreateStreamFn()，因为 streamSimple 必须同步返回 stream
  let stream: any
  if (_createStreamFn && typeof _createStreamFn === "function") {
    try {
      stream = _createStreamFn()
    } catch (err: any) {
      log("xml-translator.stream.fallback", `Tiffa stream failed: ${err?.message}, using manual`)
      stream = createManualStream()
    }
  } else {
    stream = createManualStream()
    // 后台异步尝试 import，下次调用可能用上
    getCreateStreamFn().catch(() => {})
  }

  if (!xmlTranslationEnabled) {
    // 开关关闭 → 纯 pass-through：直接调原生 OpenAI completions API，不做 XML 翻译
    log("xml-translator.pass-through", "XML translation OFF, using pass-through mode")
    ;(async () => {
      await handlePassThrough(model, context, options, stream)
    })()
  return stream
}

// ═══════════════════════════════════════════════════════════
// Pass-through 模式：开关关闭时，直接调原生 OpenAI completions API
// 不做 XML 检测/翻译，完全透传
// ═══════════════════════════════════════════════════════════

async function handlePassThrough(model: any, context: any, options: any, stream: any) {
  // 从 provider 配置缓存获取 baseUrl/apiKey（Tiffa 内核不一定会合并到 model 对象上）
  const provCfg = model.provider ? _providerConfigs.get(model.provider) : undefined
  const baseUrl = model.baseUrl || provCfg?.baseUrl || options?.baseUrl || process.env.LLM_BASE_URL || "http://127.0.0.1:11434/v1"
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions"
  const messages = buildOpenAIMessages(context)
  const tools = buildOpenAITools(context)

  const body: Record<string, unknown> = {
    model: model.requestModelId || model.id,
    messages,
    stream: true,
  }
  if (tools.length > 0) body.tools = tools
  if (model.maxTokens) body.max_tokens = model.maxTokens
  if (options?.temperature != null) body.temperature = options.temperature

  // 传递 chat_template_kwargs（关闭 thinking 模式等）
  if (options?.chat_template_kwargs) {
    body.chat_template_kwargs = options.chat_template_kwargs
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  // 优先用 options.apiKey（Tiffa 内核传入），其次用 provider 配置缓存，忽略 "none" 占位
  const effectiveApiKey = (options?.apiKey && options.apiKey !== "none") ? options.apiKey
    : (provCfg?.apiKey && provCfg.apiKey !== "none") ? provCfg.apiKey : null
  if (effectiveApiKey && typeof effectiveApiKey === "string") {
    headers["Authorization"] = `Bearer ${effectiveApiKey}`
  }
  if (model.headers) Object.assign(headers, model.headers)
  if (options?.extraHeaders) Object.assign(headers, options.extraHeaders)

  log("xml-translator.request", `url=${url} model=${body.model} msgs=${messages.length} tools=${tools.length}`)

  // 异步处理流
  ;(async () => {
    // ── 输出消息骨架 ──
    const output: any = {
      role: "assistant",
      content: [],
      api: model.api || "openai-completions",
      provider: model.provider || "qwen",
      model: model.id,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "stop",
      timestamp: Date.now(),
    }

    let contentIndex = 0

    // ── 文本缓冲状态 ──
    let textBuffer = ""         // 待推送的文本缓冲
    let textStarted = false     // 是否已推 text_start
    let emittedTextTotal = ""   // 已推送的文本总内容（用于 text_end 的 content）

    // ── thinking 状态 ──
    let thinkingStarted = false
    let currentThinking = ""

    // ── 原生 tool_calls 状态 ──
    const nativeToolCalls = new Map<number, { id: string; name: string; argumentsBuffer: string }>()
    let hasToolCalls = false

    // ── XML 解析状态 ──
    const xmlState = createXmlToolCallState()

    // ══════════════════════════════════════════
    // 辅助：推送文本 delta
    // ══════════════════════════════════════════
    function emitTextDelta(text: string) {
      if (!text) return
      if (!textStarted) {
        textStarted = true
        stream.push({ type: "text_start", contentIndex, partial: output })
      }
      stream.push({ type: "text_delta", contentIndex, delta: text, partial: output })
      emittedTextTotal += text
    }

    // ════════════════════════════
    // 辅助：关闭文本块
    // ════════════════════════════
    function closeTextBlock() {
      if (textStarted) {
        stream.push({ type: "text_end", contentIndex, content: emittedTextTotal, partial: output })
        if (emittedTextTotal) {
          output.content.push({ type: "text", text: emittedTextTotal })
        }
        contentIndex++
        textStarted = false
        emittedTextTotal = ""
      }
    }

    // ══════════════════════════════════════════
    // 辅助：处理缓冲中的文本（安全刷新）
    // ══════════════════════════════════════════
    function flushTextBuffer(isFinal: boolean) {
      if (!textBuffer) return

      if (isFinal) {
        // 最终刷新：完整处理 XML
        const { events, remaining } = extractXmlToolCalls(textBuffer, xmlState)
        for (const evt of events) {
          if (evt.type === "text" && evt.text) {
            emitTextDelta(evt.text)
          } else if (evt.type === "toolCall" && evt.toolCall) {
            closeTextBlock()  // XML 工具调用前先关闭文本块
            emitToolCall(evt.toolCall)
          }
        }
        textBuffer = remaining
        return
      }

      // 增量刷新：检查缓冲是否有 XML 标签
      if (XML_TOOL_OPEN_RE.test(textBuffer)) {
        // 发现 <function= → 尝试提取完整 XML 工具调用
        const { events, remaining } = extractXmlToolCalls(textBuffer, xmlState)
        for (const evt of events) {
          if (evt.type === "text" && evt.text) {
            emitTextDelta(evt.text)
          } else if (evt.type === "toolCall" && evt.toolCall) {
            closeTextBlock()
            emitToolCall(evt.toolCall)
          }
        }
        textBuffer = remaining
        return
      }

      // 无 XML 迹象 → 检查尾部是否可能是 XML 标签开头
      const partialLen = partialXmlTagEnd(textBuffer)
      if (partialLen > 0 && textBuffer.length > partialLen) {
        // 尾部可能是 XML 标签开头 → hold back，推送前面的安全文本
        const safeEnd = textBuffer.length - partialLen
        emitTextDelta(textBuffer.slice(0, safeEnd))
        textBuffer = textBuffer.slice(safeEnd)
      } else if (textBuffer.length > XML_LOOKAHEAD * 2) {
        // 缓冲较长且无 XML → 推送大部分，保留小窗口
        const safeEnd = textBuffer.length - XML_LOOKAHEAD
        emitTextDelta(textBuffer.slice(0, safeEnd))
        textBuffer = textBuffer.slice(safeEnd)
      }
      // 缓冲较短 → 继续等待更多数据
    }

    // ══════════════════════════════════════════
    // 辅助：发射 XML 翻译后的 toolcall 事件
    // ══════════════════════════════════════════
    function emitToolCall(tc: { name: string; arguments: Record<string, unknown>; rawXml: string }) {
      hasToolCalls = true
      const tcId = `tc_xml_${Date.now()}_${contentIndex}`
      const toolCall = {
        type: "toolCall" as const,
        id: tcId,
        name: tc.name,
        arguments: tc.arguments,
      }

      stream.push({ type: "toolcall_start", contentIndex, partial: output })
      stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(tc.arguments), partial: output })
      stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output })
      output.content.push(toolCall)
      contentIndex++

      log("xml-translator.translated", `name=${tc.name} id=${tcId}`)
    }

    // ════════════════════════════
    // 辅助：结束 thinking 块，同时扫描其中的 XML 工具调用
    // ════════════════════════════
    function closeThinkingBlock() {
      if (thinkingStarted) {
        // 扫描 thinking 中的 XML 工具调用
        if (XML_TOOL_OPEN_RE.test(currentThinking) && /<\/function>/.test(currentThinking)) {
          const thinkingXmlState = createXmlToolCallState()
          const { events, remaining } = extractXmlToolCalls(currentThinking, thinkingXmlState)
          // 翻译出的 toolcall
          for (const evt of events) {
            if (evt.type === "toolCall" && evt.toolCall) {
              closeTextBlock()
              emitToolCall(evt.toolCall)
              log("xml-translator.thinking-xml", `name=${evt.toolCall.name}`)
            }
          }
          // 只保留非 XML 部分作为 thinking 内容
          const cleanThinking = remaining
            + events.filter(e => e.type === "text" && e.text).map(e => e.text).join("")
          if (cleanThinking.trim()) {
            stream.push({ type: "thinking_end", contentIndex, content: cleanThinking, partial: output })
            output.content.push({ type: "thinking", thinking: cleanThinking })
            contentIndex++
          } else {
            // thinking 全是 XML 工具调用，没有实际思考内容
            stream.push({ type: "thinking_end", contentIndex, content: "", partial: output })
            contentIndex++
          }
        } else {
          // 无 XML，正常结束 thinking
          stream.push({ type: "thinking_end", contentIndex, content: currentThinking, partial: output })
          output.content.push({ type: "thinking", thinking: currentThinking })
          contentIndex++
        }
        thinkingStarted = false
        currentThinking = ""
      }
    }

    // ══════════════════════════════════════════
    // 主循环：处理 SSE 流
    // ══════════════════════════════════════════
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "Unknown error")
        log("xml-translator.http-error", `${resp.status} ${errText.slice(0, 200)}`)
        stream.push({
          type: "error",
          reason: "error",
          error: { ...output, stopReason: "error", errorMessage: `HTTP ${resp.status}: ${errText.slice(0, 200)}` },
        })
        stream.end()
        return
      }

      // 推送 start 事件
      stream.push({ type: "start", partial: output })

      const reader = resp.body?.getReader()
      if (!reader) {
        stream.push({ type: "error", reason: "error", error: { ...output, stopReason: "error", errorMessage: "No response body" } })
        stream.end()
        return
      }

      for await (const chunk of parseSSELines(reader)) {
        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta || {}

        // 更新 usage
        if (chunk.usage) {
          output.usage.inputTokens = chunk.usage.prompt_tokens || output.usage.inputTokens
          output.usage.outputTokens = chunk.usage.completion_tokens || output.usage.outputTokens
        }

        // ── 处理 reasoning/thinking 内容 → 立即推送，不受文本缓冲影响 ──
        const reasoningDelta = delta.reasoning_content || delta.reasoning
        if (reasoningDelta) {
          if (!thinkingStarted) {
            thinkingStarted = true
            stream.push({ type: "thinking_start", contentIndex, partial: output })
          }
          stream.push({ type: "thinking_delta", contentIndex, delta: reasoningDelta, partial: output })
          currentThinking += reasoningDelta
        }

        // ── 处理原生 tool_calls → 增量收集 ──
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!nativeToolCalls.has(idx)) {
              nativeToolCalls.set(idx, { id: tc.id || `tc_native_${idx}`, name: "", argumentsBuffer: "" })
            }
            if (tc.function?.name) nativeToolCalls.get(idx)!.name = tc.function.name
            if (tc.function?.arguments) nativeToolCalls.get(idx)!.argumentsBuffer += tc.function.arguments
          }
        }

        // ── 处理文本内容 → 缓冲 + 安全刷新（核心） ──
        if (delta.content != null && delta.content !== "") {
          textBuffer += delta.content
          flushTextBuffer(false)  // 增量刷新，只推送安全文本
        }

        // ── 处理 finish ──
        if (choice.finish_reason) {
          // 最终刷新文本缓冲（处理可能的 XML 工具调用）
          flushTextBuffer(true)

          // 关闭文本块
          closeTextBlock()

          // 结束 thinking 块
          closeThinkingBlock()

          // 处理原生 tool_calls
          if (nativeToolCalls.size > 0) {
            hasToolCalls = true
            for (const [idx, tc] of nativeToolCalls) {
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(tc.argumentsBuffer || "{}") } catch {}

              const toolCall = {
                type: "toolCall" as const,
                id: tc.id,
                name: tc.name,
                arguments: args,
              }

              stream.push({ type: "toolcall_start", contentIndex, partial: output })
              stream.push({ type: "toolcall_delta", contentIndex, delta: tc.argumentsBuffer, partial: output })
              stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output })
              output.content.push(toolCall)
              contentIndex++
            }
          }

          // 设置 stopReason
          if (hasToolCalls || choice.finish_reason === "tool_calls") {
            output.stopReason = "toolUse"
          } else if (choice.finish_reason === "length") {
            output.stopReason = "length"
          } else {
            output.stopReason = "stop"
          }
        }
      }

      // ── 流意外结束兜底 ──
      flushTextBuffer(true)
      closeTextBlock()
      closeThinkingBlock()

      if (nativeToolCalls.size > 0) {
        hasToolCalls = true
        for (const [idx, tc] of nativeToolCalls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.argumentsBuffer || "{}") } catch {}
          const toolCall = { type: "toolCall" as const, id: tc.id, name: tc.name, arguments: args }
          stream.push({ type: "toolcall_start", contentIndex, partial: output })
          stream.push({ type: "toolcall_delta", contentIndex, delta: tc.argumentsBuffer, partial: output })
          stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output })
          output.content.push(toolCall)
          contentIndex++
        }
      }

      if (hasToolCalls) output.stopReason = "toolUse"

      output.duration = Date.now() - output.timestamp
      stream.push({ type: "done", reason: output.stopReason, message: output })
      stream.end(output)

      log("xml-translator.done", `stopReason=${output.stopReason} hasToolCalls=${hasToolCalls} contentBlocks=${output.content.length}`)

    } catch (err: any) {
      log("xml-translator.error", err?.message || String(err))
      stream.push({ type: "error", reason: "error", error: { ...output, stopReason: "error", errorMessage: err?.message } })
      stream.end()
    }
  })()

  return stream
}

// ── 开关文件路径 ──
const XML_TRANSLATION_ENABLED_FILE = join(AGENT_DIR, "xml-translation-enabled")

/** 检查 XML 翻译是否启用（每次请求时读取，实时响应前端开关） */
function isXmlTranslationEnabled(): boolean {
  try {
    if (!existsSync(XML_TRANSLATION_ENABLED_FILE)) return false
    const content = readFileSync(XML_TRANSLATION_ENABLED_FILE, "utf8").trim()
    return content === "true"
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════════════════════
// 导出注册函数
// ═══════════════════════════════════════════════════════════
//
// v7.2 所有 provider 统一走 custom-openai + streamSimple：
// - models.yml 里所有 provider 统一用 api: "custom-openai"
// - 启动时读 models.yml，每个 provider 单独 registerProvider（保留原始供应商名）
// - 所有 provider 共用同一个 streamSimple
// - streamSimple 根据开关决定 pass-through 还是 XML 翻译
// - 新加 provider 只需改 models.yml + 重启，自动注册

export function registerXmlToolTranslator(pi: any) {
  const CUSTOM_API = "custom-openai"

  try {
    const providers = loadProvidersFromYml()

    for (const prov of providers) {
      try {
        pi.registerProvider(prov.name, {
          api: CUSTOM_API,
          streamSimple: xmlTranslatingStreamSimple,
          baseUrl: prov.baseUrl,
          apiKey: prov.apiKey,
          models: prov.models,
        })
        log("xml-translator.registered", `provider=${prov.name} models=${prov.models.map((m: any) => m.id).join(",")}`)
      } catch (err: any) {
        log("xml-translator.register.failed", `provider=${prov.name}: ${err?.message || String(err)}`)
      }
    }

    const enabled = isXmlTranslationEnabled()
    log("xml-translator.summary", `${providers.length} providers registered. XML translation ${enabled ? "ON" : "OFF"}.`)
  } catch (err: any) {
    log("xml-translator.register.all-failed", err?.message || String(err))
  }
}

/** provider 配置缓存，供 streamSimple 兜底查找 */
const _providerConfigs: Map<string, { baseUrl: string; apiKey: string }> = new Map()

interface ProviderInfo {
  name: string
  baseUrl: string
  apiKey: string
  models: any[]
}

/** 从 models.yml 读取所有 provider */
function loadProvidersFromYml(): ProviderInfo[] {
  const providers: ProviderInfo[] = []
  try {
    const ymlPath = join(AGENT_DIR, "models.yml")
    if (!existsSync(ymlPath)) return providers
    const content = readFileSync(ymlPath, "utf8")
    const providerBlocks = content.split(/^  (\w+):\s*$/m)
    for (let i = 1; i < providerBlocks.length - 1; i += 2) {
      const provName = providerBlocks[i]
      const block = providerBlocks[i + 1]

      const baseUrlMatch = block.match(/baseUrl:\s*["']?([^"'\n]+)["']?/)
      const baseUrl = baseUrlMatch ? baseUrlMatch[1].trim() : ""
      if (!baseUrl) continue  // 没 baseUrl 的跳过

      const apiKeyMatch = block.match(/apiKey:\s*["']?([^"'\n]+)["']?/)
      const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : "none"

      _providerConfigs.set(provName, { baseUrl, apiKey })

      const modelIdRegex = /id:\s*["']([^"']+)["']/g
      const modelNameRegex = /name:\s*["']([^"']+)["']/g
      const ids = [...block.matchAll(modelIdRegex)].map(m => m[1])
      const names = [...block.matchAll(modelNameRegex)].map(m => m[1])

      const models: any[] = []
      for (let j = 0; j < ids.length; j++) {
        models.push({
          id: ids[j],
          name: names[j] || ids[j],
          provider: provName,
          reasoning: false,
          input: ["text"],
          supportsTools: true,
          contextWindow: 128000,
          maxTokens: 8192,
        })
      }
      if (models.length === 0) continue

      providers.push({ name: provName, baseUrl, apiKey, models })
      log("xml-translator.models-yml", `provider=${provName} models=${ids.join(",")}`)
    }
  } catch (err: any) {
    log("xml-translator.models-yml.error", err?.message || String(err))
  }
  return providers
}
