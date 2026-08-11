/**
 * messageBuilders — 历史消息 → ChatMessage 转换（等价 app.js buildHistoryFragment）
 *
 * 主进程 loadSessionHistory 已把 JSONL 归一化为扁平格式：
 * { role, text?, thinking?, toolCalls?: [{name,input,output,result}], timestamp, model, steering?, follow_up? }
 */
import type { ChatMessage, MessageImage, ThinkingPart, ToolPart } from '../types/messages';
import type { TiffaHistoryMessage } from '../types/tiffaDesktop';

/** 从工具结果中提取 diff 文本（兼容多种字段名） */
export function extractDiff(result: unknown): string | null {
  if (!result) return null;
  if (typeof result === 'string') return looksLikeDiff(result) ? result : null;
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    for (const key of ['diff', 'patch', 'unified_diff', 'unifiedDiff', 'edits', 'changes']) {
      const v = r[key];
      if (typeof v === 'string' && looksLikeDiff(v)) return v;
    }
    for (const key of ['result', 'output', 'data']) {
      const nested = extractDiff(r[key]);
      if (nested) return nested;
    }
  }
  return null;
}

export function looksLikeDiff(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  return /^--- |^\+\+\+ |^@@ |^[-+]\s/m.test(s) || s.includes('@@ -');
}

/** 从工具参数中提取一行摘要（路径/命令/模式等关键信息） */
export function summarizeToolCall(toolName: string, args: unknown): string {
  void toolName;
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  if (a.filePath || a.file_path) return String(a.filePath || a.file_path);
  if (a.path) return String(a.path);
  if (a.command) return String(a.command);
  if (a.pattern) return String(a.pattern);
  if (a.query) return String(a.query).substring(0, 60);
  if (a.url) return String(a.url);
  if (a.cwd) return String(a.cwd);
  if (a.directory || a.dir) return String(a.directory || a.dir);
  if (a.content) {
    const c = typeof a.content === 'string' ? a.content : JSON.stringify(a.content);
    return c.substring(0, 60) + (c.length > 60 ? '...' : '');
  }
  for (const [, v] of Object.entries(a)) {
    if (typeof v === 'string' && v.length > 0) return v.substring(0, 80);
  }
  return '';
}

/** 工具调用 → ToolPart（历史 / 流式共用） */
export function buildToolPart(tc: {
  name?: string;
  input?: unknown;
  output?: unknown;
  result?: unknown;
}, status: ToolPart['status'] = 'done'): ToolPart {
  const input = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input ?? null, null, 2);
  const output = tc.output || tc.result;
  const resultStr =
    output === undefined || output === null
      ? undefined
      : typeof output === 'string'
        ? output
        : JSON.stringify(output, null, 2);
  return {
    kind: 'tool',
    toolCallId: `hist-${Math.random().toString(36).slice(2, 10)}`,
    toolName: tc.name || 'tool',
    status,
    args: input,
    result: resultStr ? resultStr.substring(0, 10000) : undefined,
    hasDiff: !!extractDiff(output),
    expanded: status === 'error',
  };
}

/** 历史消息 → ChatMessage（等价 buildHistoryFragment 的单条转换） */
export function buildHistoryMessage(msg: TiffaHistoryMessage): ChatMessage | null {
  if (msg.role === 'user') {
    const text = String(msg.text || '');
    if (!text) return null;
    return {
      id: msg.id,
      role: 'user',
      parts: [{ kind: 'text', text }],
      steered: !!msg.steering,
      queued: !!msg.follow_up,
      time: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '',
    };
  }
  if (msg.role === 'assistant') {
    const text = String(msg.text || '');
    const thinking = String(msg.thinking || '');
    const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
    if (!text && !thinking && toolCalls.length === 0) return null;
    const parts: ChatMessage['parts'] = [];
    if (thinking) {
      parts.push({ kind: 'thinking', text: thinking, live: false } as ThinkingPart);
    }
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      parts.push(buildToolPart(tc as never));
    }
    if (text) {
      parts.push({ kind: 'text', text });
    }
    const model = msg.model ? String(msg.model) : '';
    return {
      id: msg.id,
      role: 'assistant',
      parts,
      modelTag: model ? (model.split('/').pop() || model) : undefined,
      time: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '',
    };
  }
  return null;
}

/** 批量转换（跳过空消息） */
export function buildHistoryMessages(messages: TiffaHistoryMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const cm = buildHistoryMessage(m);
    if (cm) out.push(cm);
  }
  return out;
}

/** 用户消息内容归一化：content 可能是 string 或 [{type:'text',...}] 数组 */
export function normalizeUserContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
  }
  return '';
}

/** 历史用户消息图片（若主进程返回） */
export function extractUserImages(msg: TiffaHistoryMessage): MessageImage[] {
  const images = msg.images;
  if (!Array.isArray(images)) return [];
  return images
    .filter((im: unknown) => im && typeof im === 'object' && typeof (im as MessageImage).data === 'string')
    .map((im) => ({
      data: (im as MessageImage).data,
      mimeType: (im as MessageImage).mimeType || 'image/png',
      name: (im as MessageImage).name,
    }));
}
