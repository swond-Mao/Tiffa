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

/** FNV-1a 32 位哈希（轻量无依赖，内容 → 短 token） */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * 历史消息稳定 id：主进程 parseSessionLines 不产出 id（ParsedMessage 无 id 字段），
 * 旧代码 `id: msg.id` 导致所有历史消息 id 为 undefined → ChatView 渲染 key 全部退化成
 * 同一个 `m-0`（重复 key）→ React 跨会话 diff 错乱、旧会话气泡 DOM 不卸载（日志实锤
 * n=0 sh=12233：0 条消息但内容高度 12000+px，即其他会话的残留 DOM）。
 * 用内容哈希（role+时间戳+正文+思考+工具数）生成：同一消息重复解析 id 不变，
 * 保证 React key 稳定且跨会话不冲突。
 */
function historyMessageId(msg: TiffaHistoryMessage): string {
  const text = String(msg.text || '');
  const thinking = String(msg.thinking || '');
  const tc = Array.isArray(msg.toolCalls) ? msg.toolCalls.length : 0;
  return `hist-${fnv1a(`${msg.role}|${msg.timestamp || ''}|${text}|${thinking}|${tc}`)}`;
}

/** 历史消息 → ChatMessage（等价 buildHistoryFragment 的单条转换） */
export function buildHistoryMessage(msg: TiffaHistoryMessage): ChatMessage | null {
  if (msg.role === 'user') {
    const text = String(msg.text || '');
    if (!text) return null;
    return {
      id: msg.id || historyMessageId(msg),
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
      id: msg.id || historyMessageId(msg),
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

// ── 子代理实时进度 ──────────────────────────────────────────────

/** 内核 AgentProgress 的宽松视图（进度帧与 partialResult 共用） */
export interface AgentProgressLike {
  status?: string;
  agent?: string;
  id?: string;
  task?: string;
  currentTool?: string;
  currentToolArgs?: string;
  lastIntent?: string;
  toolCount?: number;
  requests?: number;
  tokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  cost?: number;
  durationMs?: number;
  recentOutput?: string[];
}

const PROGRESS_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  aborted: '已中止',
};

/** 折成一行并截断：进度文本会反复重绘，撑宽卡片等于没做 */
function clip(s: unknown, max: number): string {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

function fmtSec(ms?: number): string {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** 一批子代理进度 → 每个代理一行的人话摘要 */
export function formatTaskProgress(list: unknown): string {
  if (!Array.isArray(list) || list.length === 0) return '';
  const rows = list as AgentProgressLike[];
  const lines = rows.map((p, i) => {
    const who = clip(p?.agent || p?.id || 'agent', 24);
    const st = PROGRESS_LABEL[p?.status || ''] || p?.status || '?';
    const bits: string[] = [st];
    const doing = p?.currentTool ? `${p.currentTool} ${clip(p.currentToolArgs, 40)}` : clip(p?.lastIntent, 48);
    if (doing && p?.status === 'running') bits.push(`▸ ${doing.trim()}`);
    if (p?.toolCount) bits.push(`工具 ${p.toolCount}`);
    if (p?.requests) bits.push(`轮次 ${p.requests}`);
    if (p?.contextTokens) {
      const cw = p.contextWindow ? `/${p.contextWindow}` : '';
      bits.push(`ctx ${p.contextTokens}${cw}`);
    }
    const dur = fmtSec(p?.durationMs);
    if (dur) bits.push(dur);
    return `${i + 1}. ${who} — ${bits.join(' · ')}`;
  });
  // 卡住的代理最后跑一条输出，避免「看着像死了」
  const running = rows.find((p) => p?.status === 'running');
  const tail = running?.recentOutput?.filter(Boolean).slice(-1)[0];
  if (tail) lines.push(`   ↳ ${clip(tail, 120)}`);
  return lines.join('\n');
}

/** 从 tool_execution_update 的 partialResult 里取出可展示的文本 */
export function extractToolUpdateText(partialResult: unknown): string {
  if (partialResult == null) return '';
  const pr = partialResult as {
    progress?: unknown;
    details?: { progress?: unknown };
    content?: Array<{ type?: string; text?: string }>;
  };
  const prog = Array.isArray(pr.progress)
    ? pr.progress
    : Array.isArray(pr.details?.progress)
      ? pr.details?.progress
      : null;
  const asTask = formatTaskProgress(prog);
  if (asTask) return asTask;
  if (Array.isArray(pr.content)) {
    return pr.content
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n')
      .slice(0, 4000);
  }
  return '';
}
