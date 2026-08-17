/**
 * useChatStore — 聊天域（per-session 消息缓冲 / 流式生成状态 / 历史游标 / DOM 缓存）
 *
 * 对应 app.js state 中：messages（DOM 版）、currentAssistantEl/currentTextBuffer/
 * currentThinkingEl/currentToolCalls（流式）、sessionMessageCache/sessionCacheFresh、
 * historyCache/historyCursor/historyHasMore/historyPending、draftInput/pendingImages/
 * welcomePhase/aiRenameMode/aiRenameText。
 *
 * 消息用不可变数组存储（ChatMessage[]），组件订阅变化渲染；
 * 流式 text_delta 累积到 StreamingState.textBuffer，80ms 节流 flush 进 TextPart。
 */
import { create } from 'zustand';
import type { ChatMessage, HistoryState, MessageImage, MessagePart, SessionMessageCacheEntry, StreamingState } from '../types/messages';
import { createEmptyStreamingState } from '../types/messages';
import { applyOutputFixes } from '../services/outputFixes';
import { extractDiff, summarizeToolCall } from '../services/messageBuilders';
import { dbgLog } from '../services/utils';

export const HISTORY_LAZY_BATCH = 40;
export const SESSION_CACHE_LIMIT = 3;

// 注：不再做 80ms 节流 flush。旧实现 textDelta 只累积 textBuffer，80ms 后才整段写入
// TextPart → 正式回复文字每 80ms“刷”出一大块（窗口两次 flush 间静止），用户感知为
// “窗口静止、文字在下面刷、刷完出现一大块”——即“小窗刷字”。思考块/代码块走
// thinkingDelta/toolArgsUpdate 是每 delta 立即渲染，所以平滑、不刷。
// 现在 textDelta 也改为立即追加（React 18 自动批处理：同帧多次 delta 合并为一次渲染，
// 性能与思考块相同），文字逐 token 平滑增长。

export interface ChatState {
  /** per-session 消息数组 */
  messagesMap: Record<string, ChatMessage[]>;
  /** per-session 流式生成状态 */
  streaming: Record<string, StreamingState>;
  /** 会话 DOM 缓存：消息快照 + 滚动位置（上限 3，LRU 淘汰） */
  sessionMessageCache: Record<string, SessionMessageCacheEntry>;
  /** agent_end flush 标记新鲜；agent_start 标记不新鲜 */
  sessionCacheFresh: Record<string, boolean>;
  /** per-session 增量历史游标 */
  history: Record<string, HistoryState>;
  /** 一次性输入预填（分支等场景使用） */
  draftInput: string | null;
  /** 待发送图片列表 */
  pendingImages: MessageImage[];
  /** 启动欢迎页阶段 */
  welcomePhase: 'showing' | 'done';
  /** AI 重命名模式：流式文本转存不渲染 */
  aiRenameMode: boolean;
  aiRenameText: string;

  // ── 历史 ──
  setHistory: (path: string, patch: Partial<HistoryState>) => void;
  resetHistory: (path: string) => void;

  // ── 消息 CRUD ──
  setMessages: (path: string | null, messages: ChatMessage[]) => void;
  appendUserMessage: (path: string | null, msg: ChatMessage) => void;
  beginAssistantMessage: (path: string | null) => void;
  removeStreamingMessage: (path: string | null) => void;

  // ── 流式 ──
  textStart: (path: string | null) => void;
  textDelta: (path: string | null, delta: string) => void;
  textEnd: (path: string | null, content?: string) => void;
  thinkingStart: (path: string | null) => void;
  thinkingDelta: (path: string | null, delta: string) => void;
  thinkingEnd: (path: string | null) => void;
  toolStart: (path: string | null, toolCallId: string, toolName: string, args: unknown) => void;
  /** 流式更新工具参数（toolcall_delta）：更新已存在 tool part 的 args，不重建 */
  toolArgsUpdate: (path: string | null, toolCallId: string, args: unknown) => void;
  toolEnd: (path: string | null, toolCallId: string, toolName: string, result: unknown, isError: boolean) => void;
  finalizeAssistant: (path: string | null) => void;
  /** 模型失败：把原因注入当前（可能为空的）assistant 消息，停止流式态 */
  injectAssistantError: (path: string | null, text: string) => void;

  // ── 缓存 ──
  cacheSnapshot: (path: string | null, scrollPos: number) => void;
  markCacheFresh: (path: string | null, fresh: boolean) => void;
  migrateChatKey: (oldPath: string, newPath: string) => void;

  // ── 杂项 ──
  setDraftInput: (v: string | null) => void;
  setPendingImages: (v: MessageImage[]) => void;
  addPendingImage: (img: MessageImage) => void;
  setWelcomePhase: (v: 'showing' | 'done') => void;
  setAiRenameMode: (v: boolean) => void;
  setAiRenameText: (v: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messagesMap: {},
  streaming: {},
  sessionMessageCache: {},
  sessionCacheFresh: {},
  history: {},
  draftInput: null,
  pendingImages: [],
  welcomePhase: 'showing',
  aiRenameMode: false,
  aiRenameText: '',

  // ── 历史 ──
  setHistory: (path, patch) =>
    set((s) => ({
      history: { ...s.history, [path]: { ...(s.history[path] || { cursor: 0, hasMore: false, pending: [] }), ...patch } },
    })),

  resetHistory: (path) =>
    set((s) => {
      const history = { ...s.history };
      delete history[path];
      return { history };
    }),

  // ── 消息 CRUD ──
  setMessages: (path, messages) =>
    set((s) => {
      if (!path) return s;
      return { messagesMap: { ...s.messagesMap, [path]: messages } };
    }),

  appendUserMessage: (path, msg) =>
    set((s) => {
      if (!path) return s;
      return { messagesMap: { ...s.messagesMap, [path]: [...(s.messagesMap[path] || []), msg] } };
    }),

  beginAssistantMessage: (path) =>
    set((s) => {
      if (!path) return s;
      const messages = [...(s.messagesMap[path] || [])];
      // 稳定 id：供 React key 使用（历史懒加载头部插入时消息索引会变，key 不能依赖索引）
      messages.push({
        id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        parts: [],
        streaming: true,
        time: new Date().toLocaleTimeString(),
      });
      const streaming = { ...s.streaming, [path]: { ...createEmptyStreamingState(), messageIndex: messages.length - 1 } };
      return { messagesMap: { ...s.messagesMap, [path]: messages }, streaming };
    }),

  removeStreamingMessage: (path) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st || st.messageIndex < 0) return s;
      const messages = [...(s.messagesMap[path] || [])];
      messages.splice(st.messageIndex, 1);
      const streaming = { ...s.streaming };
      delete streaming[path];
      return { messagesMap: { ...s.messagesMap, [path]: messages }, streaming };
    }),

  // ── 流式 ──
  textStart: (path) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st) return s;
      const streaming = { ...s.streaming, [path]: { ...st, textBuffer: '', textPartIndex: -1 } };
      return { streaming };
    }),

  /** 流式文本：立即追加到 TextPart（与 thinkingDelta 一致）。
   *  旧实现 80ms 节流（textDelta 只进 buffer、定时整段 flush）是“小窗刷字”根因：
   *  文字每 80ms 整段替换跳出，窗口在两次 flush 间“静止”。改为立即追加后，
   *  React 18 自动批处理会把同帧多次 delta 合并为一次渲染，文字逐 token 平滑增长。 */
  textDelta: (path, delta) => {
    if (!path || !delta) return;
    useChatStore.setState((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts = [...msg.parts];
      let idx = st.textPartIndex;
      const cur = idx >= 0 ? parts[idx] : undefined;
      if (cur && cur.kind === 'text') {
        parts[idx] = { kind: 'text', text: cur.text + delta };
      } else {
        parts.push({ kind: 'text', text: delta });
        idx = parts.length - 1;
      }
      messages[st.messageIndex] = { ...msg, parts, streaming: true };
      return {
        messagesMap: { ...s.messagesMap, [path]: messages },
        // textBuffer 继续累积：textEnd 未带完整内容时作为兜底
        streaming: { ...s.streaming, [path]: { ...st, textBuffer: st.textBuffer + delta, textPartIndex: idx } },
      };
    });
  },

  textEnd: (path, content) => {
    useChatStore.setState((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st) return s;
      const buffer = content !== undefined && content !== null ? content : st.textBuffer;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts = [...msg.parts];
      let idx = st.textPartIndex;
      if (idx >= 0 && parts[idx] && parts[idx].kind === 'text') {
        parts[idx] = { kind: 'text', text: buffer };
      } else {
        parts.push({ kind: 'text', text: buffer });
        idx = parts.length - 1;
      }
      messages[st.messageIndex] = { ...msg, parts };
      return {
        messagesMap: { ...s.messagesMap, [path]: messages },
        streaming: { ...s.streaming, [path]: { ...st, textBuffer: '', textPartIndex: idx } },
      };
    });
  },

  thinkingStart: (path) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts: MessagePart[] = [...msg.parts, { kind: 'thinking', text: '', live: true }];
      messages[st.messageIndex] = { ...msg, parts };
      return {
        messagesMap: { ...s.messagesMap, [path]: messages },
        streaming: { ...s.streaming, [path]: { ...st, thinkingIndex: parts.length - 1 } },
      };
    }),

  thinkingDelta: (path, delta) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st || st.thinkingIndex < 0) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts = [...msg.parts];
      const tp = parts[st.thinkingIndex];
      if (!tp || tp.kind !== 'thinking') return s;
      parts[st.thinkingIndex] = { ...tp, text: tp.text + delta };
      messages[st.messageIndex] = { ...msg, parts };
      return { messagesMap: { ...s.messagesMap, [path]: messages } };
    }),

  thinkingEnd: (path) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st || st.thinkingIndex < 0) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts = [...msg.parts];
      const tp = parts[st.thinkingIndex];
      if (tp && tp.kind === 'thinking') {
        parts[st.thinkingIndex] = { ...tp, live: false };
        messages[st.messageIndex] = { ...msg, parts };
      }
      return {
        messagesMap: { ...s.messagesMap, [path]: messages },
        streaming: { ...s.streaming, [path]: { ...st, thinkingIndex: -1 } },
      };
    }),

  toolStart: (path, toolCallId, toolName, args) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts = [...msg.parts];
      const argStr = typeof args === 'string' ? args : JSON.stringify(args ?? null, null, 2);
      parts.push({ kind: 'tool', toolCallId, toolName, status: 'running', args: argStr });
      messages[st.messageIndex] = { ...msg, parts };
      return {
        messagesMap: { ...s.messagesMap, [path]: messages },
        streaming: {
          ...s.streaming,
          [path]: { ...st, toolPartIndexes: { ...st.toolPartIndexes, [toolCallId]: parts.length - 1 } },
        },
      };
    }),

  /** toolcall_delta：更新已存在 tool part 的 args（不重建，避免闪烁） */
  toolArgsUpdate: (path, toolCallId, args) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st) return s;
      const idx = st.toolPartIndexes[toolCallId];
      if (idx === undefined) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts = [...msg.parts];
      const tp = parts[idx];
      if (!tp || tp.kind !== 'tool') return s;
      const argStr = typeof args === 'string' ? args : JSON.stringify(args ?? null, null, 2);
      if (tp.args === argStr) return s; // 无变化不动
      parts[idx] = { ...tp, args: argStr };
      messages[st.messageIndex] = { ...msg, parts };
      return { messagesMap: { ...s.messagesMap, [path]: messages } };
    }),

  toolEnd: (path, toolCallId, toolName, result, isError) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st) return s;
      const idx = st.toolPartIndexes[toolCallId];
      if (idx === undefined) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts = [...msg.parts];
      const tp = parts[idx];
      if (!tp || tp.kind !== 'tool') return s;
      // bash/execute 工具：非零退出码不等于真错误（等价旧版降级逻辑）
      let showError = isError;
      if (isError && (toolName === 'bash' || toolName === 'execute' || toolName === 'run')) {
        const r = typeof result === 'string' ? result : JSON.stringify(result ?? '');
        if (r && r.length < 5000 && !/error|Error|ERROR|failed|Failed|FAILED|exception|Exception|traceback|Traceback/.test(r)) {
          showError = false;
        }
      }
      const resultStr =
        result === undefined || result === null
          ? undefined
          : typeof result === 'string'
            ? result.substring(0, 10000)
            : JSON.stringify(result, null, 2).substring(0, 10000);
      const diff = extractDiff(result);
      parts[idx] = {
        ...tp,
        status: showError ? 'error' : 'done',
        result: resultStr,
        hasDiff: !!diff,
        expanded: showError ? true : tp.expanded,
      };
      messages[st.messageIndex] = { ...msg, parts };
      return { messagesMap: { ...s.messagesMap, [path]: messages } };
    }),

  /** 80ms 节流 flush 已废弃（textDelta 立即渲染后不再需要） */

  finalizeAssistant: (path) =>
    set((s) => {
      if (!path) return s;
      const st = s.streaming[path];
      if (!st) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const msg = messages[st.messageIndex];
      if (!msg) return s;
      const parts = msg.parts.map((p) =>
        p.kind === 'thinking' ? { ...p, live: false } : p,
      );
      messages[st.messageIndex] = { ...msg, parts, streaming: false };
      const streaming = { ...s.streaming };
      delete streaming[path];
      return { messagesMap: { ...s.messagesMap, [path]: messages }, streaming };
    }),

  /** 模型失败原因注入：当前流式 assistant 消息存在则写入 error 字段并结束流式；
   *  无流式消息（如发送即失败）则追加一条带 error 的空 assistant 消息 */
  injectAssistantError: (path, text) =>
    set((s) => {
      if (!path) return s;
      const messages = [...(s.messagesMap[path] || [])];
      const st = s.streaming[path];
      if (st && st.messageIndex >= 0 && messages[st.messageIndex]) {
        const msg = messages[st.messageIndex];
        messages[st.messageIndex] = { ...msg, error: text, streaming: false };
        const streaming = { ...s.streaming };
        delete streaming[path];
        return { messagesMap: { ...s.messagesMap, [path]: messages }, streaming };
      }
      messages.push({
        role: 'assistant',
        parts: [],
        error: text,
        streaming: false,
        time: new Date().toLocaleTimeString(),
      });
      return { messagesMap: { ...s.messagesMap, [path]: messages } };
    }),

  // ── 缓存 ──
  cacheSnapshot: (path, scrollPos) =>
    set((s) => {
      if (!path) return s;
      const messages = s.messagesMap[path];
      if (!messages) return s;
      const next = { ...s.sessionMessageCache, [path]: { messages, scrollPos } };
      // 上限 3：超限时移除最早插入的（Object.keys 顺序即插入序）
      const keys = Object.keys(next).filter((k) => k !== path);
      if (keys.length >= SESSION_CACHE_LIMIT) {
        const oldest = keys[0];
        if (oldest) delete next[oldest];
      }
      return { sessionMessageCache: next };
    }),

  markCacheFresh: (path, fresh) =>
    set((s) => {
      if (!path) return s;
      const sessionCacheFresh = { ...s.sessionCacheFresh, [path]: fresh };
      if (!fresh) delete sessionCacheFresh[path];
      return { sessionCacheFresh };
    }),

  /** session_switch 迁移：消息/流式/缓存/历史 全部跟新路径走 */
  migrateChatKey: (oldPath, newPath) =>
    set((s) => {
      const messagesMap = { ...s.messagesMap };
      if (messagesMap[oldPath]) {
        messagesMap[newPath] = messagesMap[oldPath];
        delete messagesMap[oldPath];
      }
      const streaming = { ...s.streaming };
      if (streaming[oldPath]) {
        streaming[newPath] = streaming[oldPath];
        delete streaming[oldPath];
      }
      const sessionMessageCache = { ...s.sessionMessageCache };
      if (sessionMessageCache[oldPath]) {
        sessionMessageCache[newPath] = sessionMessageCache[oldPath];
        delete sessionMessageCache[oldPath];
      }
      const sessionCacheFresh = { ...s.sessionCacheFresh };
      if (sessionCacheFresh[oldPath]) {
        sessionCacheFresh[newPath] = true;
        delete sessionCacheFresh[oldPath];
      }
      const history = { ...s.history };
      if (history[oldPath]) {
        history[newPath] = history[oldPath];
        delete history[oldPath];
      }
      return { messagesMap, streaming, sessionMessageCache, sessionCacheFresh, history };
    }),

  // ── 杂项 ──
  setDraftInput: (v) => set({ draftInput: v }),
  setPendingImages: (v) => set({ pendingImages: v }),
  addPendingImage: (img) =>
    set((s) => ({ pendingImages: [...s.pendingImages, img] })),
  setWelcomePhase: (v) => set({ welcomePhase: v }),
  setAiRenameMode: (v) => {
    if (!v) dbgLog('aiRename', `final text: ${useChatStore.getState().aiRenameText.length} 字`);
    set({ aiRenameMode: v });
  },
  setAiRenameText: (v) => set({ aiRenameText: v }),
}));

/** 供调试/导出：流式文本再应用 output fixes（text_end 完整渲染时用） */
export function finalizeStreamText(raw: string): string {
  return applyOutputFixes(raw);
}
