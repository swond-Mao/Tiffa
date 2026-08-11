/**
 * 消息模型（React 版 ChatMessage / MessagePart）
 *
 * 与旧版 DOM 结构对应：
 * - thinking → <details class="thinking-block">（可折叠，思考中默认展开）
 * - tool     → <div class="tool-call">（卡片，默认折叠，出错自动展开）
 * - text     → markdown 正文（<div class="markdown-body">）
 */

export interface TextPart {
  kind: 'text';
  text: string;
}

export interface ThinkingPart {
  kind: 'thinking';
  text: string;
  /** 思考中（实时追加 delta 时 true；thinking_end 后 false） */
  live?: boolean;
}

export type ToolStatus = 'running' | 'done' | 'error';

export interface ToolPart {
  kind: 'tool';
  toolCallId: string;
  toolName: string;
  status: ToolStatus;
  /** 参数 JSON 字符串（用于展示） */
  args?: string;
  /** 结果文本（截断 10000 字符） */
  result?: string;
  /** 是否渲染了 diff 视图 */
  hasDiff?: boolean;
  /** 出错时自动展开 */
  expanded?: boolean;
}

export type MessagePart = TextPart | ThinkingPart | ToolPart;

export interface MessageImage {
  data: string; // base64
  mimeType: string;
  name?: string;
}

export interface ChatMessage {
  /** 消息 id（历史 JSONL 的 id；流式新消息可为空） */
  id?: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  /** 正在流式接收 */
  streaming?: boolean;
  /** user: 引导（⟳） */
  steered?: boolean;
  /** user: 排队（⏳） */
  queued?: boolean;
  /** assistant: 模型 tag（model.split('/').pop()） */
  modelTag?: string;
  /** 时间（显示用，历史为原始 timestamp 的本地时间字符串） */
  time?: string;
  /** user: 附加图片 */
  images?: MessageImage[];
  /** assistant: stopReason=error 时的错误信息 */
  error?: string;
}

/** 流式生成中的 per-session 状态 */
export interface StreamingState {
  /** 当前流式 assistant 消息索引（在 ChatMessage[] 中的下标） */
  messageIndex: number;
  /** 文本缓冲（text_delta 累积） */
  textBuffer: string;
  /** 正在累积的 thinking（live）下标 */
  thinkingIndex: number;
  /** 当前 text part 下标（-1 = 无） */
  textPartIndex: number;
  /** 工具调用 map：toolCallId -> ToolPart 下标 */
  toolPartIndexes: Record<string, number>;
  /** 80ms 节流渲染计时器 */
  renderTimer: number | null;
}

export function createEmptyStreamingState(): StreamingState {
  return {
    messageIndex: -1,
    textBuffer: '',
    thinkingIndex: -1,
    textPartIndex: -1,
    toolPartIndexes: {},
    renderTimer: null,
  };
}

/** 会话 DOM 缓存（React 版缓存消息数组快照 + 滚动位置，上限 3） */
export interface SessionMessageCacheEntry {
  messages: ChatMessage[];
  scrollPos: number;
}

/** 增量历史游标状态（per-session） */
export interface HistoryState {
  /** 已加载消息数（增量游标） */
  cursor: number;
  hasMore: boolean;
  /** 内存中尚未渲染的更早消息（懒加载队列） */
  pending: unknown[];
  /** 启动预载缓存（一次性消费） */
  cache?: { messages: unknown[]; hasMore: boolean } | null;
}
