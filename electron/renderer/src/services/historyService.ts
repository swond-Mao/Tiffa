/**
 * historyService — 历史加载（增量/懒加载/防竞态/幽灵自愈）+ 自动 AI 重命名
 *
 * 等价 app.js loadAndRenderHistory / loadEarlierBatch / autoRenameWithLightModel /
 * loadModelMap。
 */
import { useChatStore, HISTORY_LAZY_BATCH } from '../stores/useChatStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useUiStore } from '../stores/useUiStore';
import { buildHistoryMessages } from './messageBuilders';
import { extractSessionId, dbgLog, msgFingerprint } from './utils';
import type { TiffaHistoryMessage } from '../types/tiffaDesktop';

/** loadEpoch 防竞态：快速切换会话时防止旧回调覆盖新数据（模块级） */
let loadEpoch = 0;

/** 启动预载历史缓存（一次性消费）：sessionPath -> { messages, hasMore } */
export function setHistoryPreload(path: string, messages: unknown[], hasMore: boolean): void {
  useChatStore.getState().setHistory(path, { cache: { messages, hasMore } });
}

/**
 * 加载并渲染会话历史（等价 loadAndRenderHistory）
 * - 预载缓存优先（一次性消费）
 * - 增量：tail:200 + skip=cursor
 * - 首屏只渲染尾部 HISTORY_LAZY_BATCH 条，更早入 pending
 * - Session file not found 幽灵自愈
 * 返回 true 表示有消息已渲染，false 表示空/失败
 */
export async function loadAndRenderHistory(sessionPath: string): Promise<boolean> {
  const epoch = ++loadEpoch;
  dbgLog('hist', `loadAndRenderHistory start ${sessionPath.slice(-50)}`);
  const chat = useChatStore.getState();
  const sessions = useSessionsStore.getState();
  try {
    let raw: unknown[] | null = null;
    let hasMore = false;
    const hist = chat.history[sessionPath];
    const cached = hist?.cache;
    const fromCache = !!cached;
    if (cached) {
      // 预载缓存命中：同时推进游标（=已渲染尾部条数），否则后续「加载更早」
      // 会以 skip=0 重复读取已显示的尾部并前插——表现为消息重复/拼接错乱。
      chat.setHistory(sessionPath, { cache: null, cursor: cached.messages.length, hasMore: !!cached.hasMore });
      raw = cached.messages;
      hasMore = !!cached.hasMore;
      dbgLog('hist', `命中预载缓存 ${raw.length} 条`);
    } else {
      const cursor = hist?.cursor || 0;
      let result = await window.tiffaDesktop.loadSessionHistory(sessionPath, { tail: 200, skip: cursor });
      if (epoch !== loadEpoch) return false;
      if (result?.error) {
        if (result.error === 'Session file not found') {
          // 幽灵 tab 自愈：移除该 tab 并切走
          ghostTabSelfHeal(sessionPath);
          return false;
        }
        useUiStore.getState().addToast('warning', `无法加载历史: ${result.error}`);
        return false;
      }
      raw = (result?.messages as unknown[]) || [];
      // 兜底：游标已到文件尾但内存无消息（缓存被淘汰/预载消费后）——
      // 增量返回空会显示空对话；重置游标全量重读保证内容完整。
      if (raw.length === 0 && cursor > 0) {
        chat.setHistory(sessionPath, { cursor: 0, hasMore: false });
        result = await window.tiffaDesktop.loadSessionHistory(sessionPath, { tail: 200, skip: 0 });
        if (epoch !== loadEpoch) return false;
        if (!result?.error) {
          raw = (result?.messages as unknown[]) || [];
        }
      }
      hasMore = !!result?.hasMore;
      // 重读后游标 = 最新全量长度（避免旧游标叠加导致 skip 跳过重复区）
      chat.setHistory(sessionPath, { cursor: raw.length, hasMore });
    }
    if (!raw || raw.length === 0) {
      chat.setMessages(sessionPath, []);
      return false;
    }
    const all = buildHistoryMessages(raw as TiffaHistoryMessage[]);
    const older = all.length > HISTORY_LAZY_BATCH ? all.slice(0, -HISTORY_LAZY_BATCH) : [];
    const tail = all.length > HISTORY_LAZY_BATCH ? all.slice(-HISTORY_LAZY_BATCH) : all;
    dbgLog('hist', `落库 src=${fromCache ? 'cache' : 'ipc'} path=${sessionPath} active=${sessions.activeSessionPath ?? 'null'} tail=${msgFingerprint(tail)} all=${all.length}`);
    chat.setMessages(sessionPath, tail);
    useChatStore.getState().setWelcomePhase('done');
    return tail.length > 0;
  } catch (err) {
    if (epoch === loadEpoch) {
      useUiStore.getState().addToast('warning', `加载历史失败: ${(err as Error).message}`);
    }
    return false;
  }
}

/** 幽灵 tab 自愈：会话文件已被删除/归档，移除 tab 并切走 */
function ghostTabSelfHeal(sessionPath: string): void {
  const sessions = useSessionsStore.getState();
  const chat = useChatStore.getState();
  sessions.closeTab(sessionPath);
  chat.migrateChatKey(sessionPath, sessionPath); // no-op 保留
  if (sessions.activeSessionPath === sessionPath) {
    const remaining = Object.keys(sessions.activeTabMeta).filter(
      (p) => p !== sessionPath && !p.startsWith('__new__'),
    );
    if (remaining.length > 0) {
      const last = remaining[remaining.length - 1];
      useSessionsStore.setState({ activeSessionPath: null, activeSessionId: null });
      import('./sessionController').then((sc) => sc.switchToSession(last)).catch(() => {});
    } else {
      useSessionsStore.setState({ activeSessionPath: null, activeSessionId: null });
      chat.setMessages(sessionPath, []);
      useChatStore.getState().setWelcomePhase('showing');
    }
  }
  sessions.saveOpenTabs();
  useUiStore.getState().addToast('info', '该对话文件已不存在，已从标签中移除');
}

/**
 * 懒加载一批更早消息（等价 loadEarlierBatch）
 * 内存缓冲耗尽时从 IPC 增量拉取；插入消息数组头部（组件保持视口）
 */
export async function loadEarlierBatch(): Promise<void> {
  const path = useSessionsStore.getState().activeSessionPath;
  if (!path) return;
  const chat = useChatStore.getState();
  const hist = chat.history[path];
  let pending: unknown[] = hist?.pending || [];
  if (pending.length === 0) {
    if (!hist?.hasMore) return;
    const cursor = hist?.cursor || 0;
    try {
      const result = await window.tiffaDesktop.loadSessionHistory(path, { tail: 200, skip: cursor });
      if (useSessionsStore.getState().activeSessionPath !== path) return;
      if (result?.error || !Array.isArray(result?.messages)) return;
      pending = buildHistoryMessages(result.messages);
      chat.setHistory(path, { pending, cursor: cursor + pending.length, hasMore: !!result?.hasMore });
    } catch {
      return;
    }
    if (pending.length === 0) return;
  }
  const batch = (pending as unknown[]).splice(-HISTORY_LAZY_BATCH);
  chat.setHistory(path, { pending });
  chat.setMessages(path, [...(batch as never), ...(chat.messagesMap[path] || [])]);
}

/** 是否有更早消息（组件「加载更早」按钮判定） */
export function hasEarlierMessages(path: string | null): boolean {
  if (!path) return false;
  const hist = useChatStore.getState().history[path];
  if (!hist) return false;
  return hist.pending.length > 0 || hist.hasMore;
}

/** 剩余未渲染条数（-1 = 未知） */
export function earlierRemaining(path: string | null): number {
  if (!path) return 0;
  const hist = useChatStore.getState().history[path];
  if (!hist) return 0;
  if (hist.pending.length > 0) return hist.pending.length;
  return hist.hasMore ? -1 : 0;
}

// ── 自动 AI 重命名 ──

const autoRenameInFlight = new Set<string>();

export function buildRenamePrompt(recentText: string, oldTitle: string | null): string {
  const titleLine = oldTitle ? `原标题「${oldTitle}」（若已不符合最近内容就重命名，符合则保持原样输出）：\n` : '';
  return `[SYSTEM: title_generation_task] 立即执行，禁止思考、禁止分析、禁止解释。\n操作：根据对话最近的交流内容，为对话生成一个≤10字的中文标题。\n要求：对话主题可能已漂移，以最近的内容为准。\n${titleLine}风格要求：文艺、凝练、有意境，像古诗标题或棋道术语（例如：“填坑即增强”“棋落无声”“墨晕初开”），禁止工程日志风格（禁止“修复XXX问题”“实现XXX功能”）。\n最近对话：\n${recentText}\n输出：`;
}

/** 从会话历史提取最近 N 条可读文本（跳过 thinking 与空内容） */
export function extractRecentMessages(messages: Array<Record<string, unknown>>, n: number): string {
  if (!Array.isArray(messages)) return '';
  const aiName = useUiStore.getState().aiName;
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = String(m.text || '').trim();
    if (!text) continue;
    const truncated = text.length > 200 ? text.substring(0, 200) + '…' : text;
    lines.push(`${m.role === 'user' ? '用户' : aiName}: ${truncated}`);
  }
  return lines.slice(-n).join('\n');
}

/** 自动 AI 重命名：对话结束后用轻量模型生成文艺标题（静默，不打扰，可并发） */
export async function autoRenameWithLightModel(session: { path: string; title?: string; firstMessage?: string }): Promise<void> {
  const sessPath = session && session.path;
  if (!sessPath) return;
  const sessions = useSessionsStore.getState();
  if (sessions.autoNamedSessions[sessPath]) return;
  if (autoRenameInFlight.has(sessPath)) return;
  autoRenameInFlight.add(sessPath);
  dbgLog('rename', `自动重命名开始 ${sessPath.slice(-40)}`);
  try {
    let context = '';
    try {
      if (!sessPath.startsWith('__new__')) {
        const hist = await window.tiffaDesktop.loadSessionHistory(sessPath, { tail: 100 });
        if (hist && !hist.error && Array.isArray(hist.messages)) {
          context = extractRecentMessages(hist.messages as Array<Record<string, unknown>>, 6);
        }
      }
    } catch {
      /* ignore */
    }
    if (!context.trim()) context = session.firstMessage || '';
    if (!context.trim()) return;
    const oldTitle = session.title && session.title !== '新对话' ? session.title : null;
    const prompt = buildRenamePrompt(context, oldTitle);
    const ui = useUiStore.getState();
    const result = (await window.tiffaDesktop.completeWithLightModel(
      prompt,
      40,
      ui.currentProvider || null,
      ui.currentModel || null,
    )) as { error?: string; text?: string } | undefined;
    if (result && !result.error && result.text) {
      const title = result.text.trim().replace(/^["'“”《]+|["'“”》]+$/g, '').substring(0, 30);
      if (title && title !== session.title) {
        sessions.upsertSession({ path: sessPath, title });
        sessions.updateTabMeta(sessPath, { title });
        if (!sessPath.startsWith('__new__')) {
          window.tiffaDesktop.renameSession(sessPath, title).catch(() => {});
        }
        sessions.markAutoNamed(sessPath);
        sessions.saveOpenTabs();
        dbgLog('rename', `自动重命名完成 ${sessPath.slice(-40)} → ${title}`);
      }
    } else {
      dbgLog('rename', `自动重命名无结果 ${sessPath.slice(-40)}`);
    }
  } catch {
    /* ignore */
  } finally {
    autoRenameInFlight.delete(sessPath);
  }
}

// ── 模型记忆加载 ──

const MODEL_MAP_FILE = 'session-model-map.json';

/** 启动时加载 data/agent/session-model-map.json（清理 __new__ 临时键） */
export async function loadModelMap(): Promise<void> {
  try {
    const root = await window.tiffaDesktop.getRootPath();
    const result = await window.tiffaDesktop.readFile(`${root}\\data\\agent\\${MODEL_MAP_FILE}`);
    if (result && result.content) {
      const map = JSON.parse(result.content) as Record<string, { provider: string; modelId: string }>;
      if (map && typeof map === 'object') {
        let cleaned = false;
        for (const key of Object.keys(map)) {
          if (key.startsWith('__new__')) {
            delete map[key];
            cleaned = true;
          }
        }
        useSessionsStore.setState({ sessionModelMap: map });
        if (cleaned) {
          try {
            await window.tiffaDesktop.writeFile(`${root}\\data\\agent\\${MODEL_MAP_FILE}`, JSON.stringify(map));
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch (e) {
    dbgLog('modelMap', `读取模型映射失败: ${(e as Error).message}`);
  }
}

const THINKING_MAP_FILE = 'session-thinking-level-map.json';

/** 启动时加载 data/agent/session-thinking-level-map.json（清理 __new__ 临时键） */
export async function loadThinkingLevelMap(): Promise<void> {
  try {
    const root = await window.tiffaDesktop.getRootPath();
    const result = await window.tiffaDesktop.readFile(`${root}\\data\\agent\\${THINKING_MAP_FILE}`);
    if (result && result.content) {
      const map = JSON.parse(result.content) as Record<string, string>;
      if (map && typeof map === 'object') {
        let cleaned = false;
        for (const key of Object.keys(map)) {
          if (key.startsWith('__new__')) {
            delete map[key];
            cleaned = true;
          }
        }
        useSessionsStore.setState({ sessionThinkingMap: map });
        if (cleaned) {
          try {
            await window.tiffaDesktop.writeFile(`${root}\\data\\agent\\${THINKING_MAP_FILE}`, JSON.stringify(map));
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch (e) {
    dbgLog('thinkingMap', `读取思考档位映射失败: ${(e as Error).message}`);
  }
}

/** 直接读某会话的思考档位（重启/切换会话恢复用；绕过 sessionThinkingMap 异步加载竞态，直接从文件读） */
export async function readSessionThinkingLevel(path: string): Promise<string | null> {
  try {
    const root = await window.tiffaDesktop.getRootPath();
    const result = await window.tiffaDesktop.readFile(`${root}\\data\\agent\\${THINKING_MAP_FILE}`);
    if (result && result.content) {
      const map = JSON.parse(result.content) as Record<string, string>;
      return map[path] ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 提取真实 sessionId（供外部使用） */
export { extractSessionId };
