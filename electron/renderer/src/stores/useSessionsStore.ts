/**
 * useSessionsStore — 会话域（tab 管理 / 会话列表 / 模型记忆 / 自动命名）
 *
 * 对应 app.js state 中：sessions / activeSessionPath / activeSessionId /
 * activeSessionPaths / activeTabMeta / autoNamedSessions / preparingNewSessions /
 * sessionModelMap / expandedSessionTrees / pendingNewSession / _newSessionSwitched。
 *
 * 旧版 Set/Map 一律用 Record<string, ...> 表示（zustand 不变性友好）。
 */
import { create } from 'zustand';
import { lsGet, lsSet } from '../services/utils';
import type { TiffaSessionSummary } from '../types/tiffaDesktop';

/** tab 元数据（跨项目 tab） */
export interface TabMeta {
  dirName: string;
  title?: string;
  firstMessage?: string;
  messageCount?: number;
  sessionId?: string;
  lastActiveAt?: number;
}

/** 会话树展开上限 / tab 上限 / 重启恢复上限 */
export const SESSION_TREE_LIMIT = 8;
export const TABS_MAX = 8;
export const RESTORE_TABS_LIMIT = 3;

const OPEN_TABS_KEY = 'tiffa:openTabs';

export interface SessionsState {
  /** 当前项目的会话列表（左侧树数据源） */
  sessions: TiffaSessionSummary[];
  /** 当前活跃 tab 的会话文件路径 */
  activeSessionPath: string | null;
  /** 当前活跃会话的真实 sessionId（UUID） */
  activeSessionId: string | null;
  /** 已打开 tab 的会话路径数组（≤8） */
  activeSessionPaths: string[];
  /** tab 元数据：path -> TabMeta */
  activeTabMeta: Record<string, TabMeta>;
  /** 已自动命名的会话（防重复） */
  autoNamedSessions: Record<string, true>;
  /** 准备中的新会话（等待 session_switch 迁移），key = __new__ 临时路径 */
  preparingNewSessions: Record<string, true>;
  /** 每会话模型记忆：path -> { provider, modelId } */
  sessionModelMap: Record<string, { provider: string; modelId: string }>;
  /** 每会话思考档位记忆：path -> thinkingLevel */
  sessionThinkingMap: Record<string, string>;
  /** 展开全部对话的项目集合 */
  expandedSessionTrees: Record<string, true>;
  /** 新建对话标志：新建后到收到 session_switch 之前忽略 message_* 事件 */
  pendingNewSession: boolean;
  /** session_switch 是否已到达（配合 pendingNewSession） */
  newSessionSwitched: boolean;

  // ── actions ──
  setSessions: (dirName: string, sessions: TiffaSessionSummary[]) => void;
  upsertSession: (s: TiffaSessionSummary) => void;
  setActiveSession: (path: string | null, id: string | null) => void;
  openTab: (path: string, meta: TabMeta) => void;
  closeTab: (path: string) => void;
  updateTabMeta: (path: string, patch: Partial<TabMeta>) => void;
  migrateTabPath: (oldPath: string, newPath: string, realSessionId: string | null) => void;
  setSessionModel: (path: string, provider: string, modelId: string) => void;
  removeSessionModel: (path: string) => void;
  setSessionThinkingLevel: (path: string, level: string) => void;
  removeSessionThinkingLevel: (path: string) => void;
  markAutoNamed: (path: string) => void;
  clearPreparing: (path: string) => void;
  toggleExpandedTree: (dirName: string) => void;
  setPendingNewSession: (v: boolean) => void;
  setNewSessionSwitched: (v: boolean) => void;
  saveOpenTabs: () => void;
  restoreOpenTabs: () => string[];
  restoreOpenTabsWithActive: () => {
    paths: string[];
    active: string | null;
    metas: Record<string, TabMeta>;
  };
}

const MODEL_MAP_FILE = 'session-model-map.json';
const THINKING_MAP_FILE = 'session-thinking-level-map.json';

/**
 * 模型记忆落盘：data/agent/session-model-map.json（与 loadModelMap 直读对称，直写文件）。
 * 旧实现走 command('save-model-map')，但主进程/内核均无此命令 → 静默 Unknown command →
 * 重启后每会话模型记忆清零（功能丢失）。
 */
function saveModelMap(map: Record<string, { provider: string; modelId: string }>): void {
  void (async () => {
    try {
      const root = await window.tiffaDesktop.getRootPath();
      await window.tiffaDesktop.writeFile(`${root}\\data\\agent\\${MODEL_MAP_FILE}`, JSON.stringify(map));
    } catch (e) {
      console.warn('[持久化] 保存模型映射失败:', e);
    }
  })();
}

function saveThinkingLevelMap(map: Record<string, string>): void {
  void (async () => {
    try {
      const root = await window.tiffaDesktop.getRootPath();
      await window.tiffaDesktop.writeFile(`${root}\\data\\agent\\${THINKING_MAP_FILE}`, JSON.stringify(map));
    } catch (e) {
      console.warn('[持久化] 保存思考档位映射失败:', e);
    }
  })();
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeSessionPath: null,
  activeSessionId: null,
  activeSessionPaths: [],
  activeTabMeta: {},
  autoNamedSessions: {},
  preparingNewSessions: {},
  sessionModelMap: {},
  sessionThinkingMap: {},
  expandedSessionTrees: {},
  pendingNewSession: false,
  newSessionSwitched: false,

  setSessions: (dirName, sessions) =>
    set((s) => {
      // 保留内存中已有实时标题（避免磁盘空标题覆盖），合并会话对象
      const merged = sessions.map((incoming) => {
        const old = s.sessions.find((x) => x.path === incoming.path);
        return old && old.title && !incoming.title ? { ...incoming, title: old.title } : incoming;
      });
      void dirName;
      return { sessions: merged };
    }),

  upsertSession: (incoming) =>
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.path === incoming.path);
      const sessions = [...s.sessions];
      if (idx >= 0) sessions[idx] = { ...sessions[idx], ...incoming };
      else sessions.push(incoming);
      return { sessions };
    }),

  setActiveSession: (path, id) => set({ activeSessionPath: path, activeSessionId: id }),

  openTab: (path, meta) =>
    set((s) => {
      if (s.activeSessionPaths.includes(path)) return s;
      const activeSessionPaths = [...s.activeSessionPaths, path].slice(-TABS_MAX);
      return { activeSessionPaths, activeTabMeta: { ...s.activeTabMeta, [path]: meta } };
    }),

  closeTab: (path) =>
    set((s) => {
      const activeSessionPaths = s.activeSessionPaths.filter((p) => p !== path);
      const activeTabMeta = { ...s.activeTabMeta };
      delete activeTabMeta[path];
      return { activeSessionPaths, activeTabMeta };
    }),

  updateTabMeta: (path, patch) =>
    set((s) => {
      const cur = s.activeTabMeta[path];
      if (!cur) return s;
      return { activeTabMeta: { ...s.activeTabMeta, [path]: { ...cur, ...patch } } };
    }),

  /**
   * session_switch 迁移：__new__ 临时路径 -> 真实路径。
   * 仅迁移本 store 的引用；proc/chat 域的引用由 eventRouter 编排调用对应 store。
   */
  migrateTabPath: (oldPath, newPath, realSessionId) =>
    set((s) => {
      const activeTabMeta = { ...s.activeTabMeta };
      if (activeTabMeta[oldPath]) {
        activeTabMeta[newPath] = activeTabMeta[oldPath];
        delete activeTabMeta[oldPath];
        if (realSessionId) activeTabMeta[newPath] = { ...activeTabMeta[newPath], sessionId: realSessionId };
      }
      const sessionModelMap = { ...s.sessionModelMap };
      if (sessionModelMap[oldPath]) {
        sessionModelMap[newPath] = sessionModelMap[oldPath];
        delete sessionModelMap[oldPath];
        saveModelMap(sessionModelMap);
      }
      const sessionThinkingMap = { ...s.sessionThinkingMap };
      if (sessionThinkingMap[oldPath]) {
        sessionThinkingMap[newPath] = sessionThinkingMap[oldPath];
        delete sessionThinkingMap[oldPath];
        saveThinkingLevelMap(sessionThinkingMap);
      }
      const autoNamedSessions = { ...s.autoNamedSessions };
      if (autoNamedSessions[oldPath]) {
        autoNamedSessions[newPath] = true;
        delete autoNamedSessions[oldPath];
      }
      const preparingNewSessions = { ...s.preparingNewSessions };
      if (preparingNewSessions[oldPath]) {
        delete preparingNewSessions[oldPath];
      }
      const sessions = s.sessions.map((x) => {
        if (x.path !== oldPath) return x;
        const ns = { ...x, path: newPath };
        if (realSessionId) ns.sessionId = realSessionId;
        return ns;
      });
      return {
        activeTabMeta,
        sessionModelMap,
        sessionThinkingMap,
        autoNamedSessions,
        preparingNewSessions,
        sessions,
        activeSessionPaths: s.activeSessionPaths.map((p) => (p === oldPath ? newPath : p)),
        activeSessionPath: s.activeSessionPath === oldPath ? newPath : s.activeSessionPath,
        activeSessionId: realSessionId || s.activeSessionId,
        pendingNewSession: false,
        newSessionSwitched: true,
      };
    }),

  setSessionModel: (path, provider, modelId) =>
    set((s) => {
      const sessionModelMap = { ...s.sessionModelMap, [path]: { provider, modelId } };
      saveModelMap(sessionModelMap);
      return { sessionModelMap };
    }),

  removeSessionModel: (path) =>
    set((s) => {
      if (!s.sessionModelMap[path]) return s;
      const sessionModelMap = { ...s.sessionModelMap };
      delete sessionModelMap[path];
      saveModelMap(sessionModelMap);
      return { sessionModelMap };
    }),

  setSessionThinkingLevel: (path, level) =>
    set((s) => {
      const sessionThinkingMap = { ...s.sessionThinkingMap, [path]: level };
      saveThinkingLevelMap(sessionThinkingMap);
      return { sessionThinkingMap };
    }),

  removeSessionThinkingLevel: (path) =>
    set((s) => {
      if (!s.sessionThinkingMap[path]) return s;
      const sessionThinkingMap = { ...s.sessionThinkingMap };
      delete sessionThinkingMap[path];
      saveThinkingLevelMap(sessionThinkingMap);
      return { sessionThinkingMap };
    }),

  markAutoNamed: (path) =>
    set((s) => ({ autoNamedSessions: { ...s.autoNamedSessions, [path]: true } })),

  clearPreparing: (path) =>
    set((s) => {
      const preparingNewSessions = { ...s.preparingNewSessions };
      delete preparingNewSessions[path];
      return { preparingNewSessions };
    }),

  toggleExpandedTree: (dirName) =>
    set((s) => {
      const expandedSessionTrees = { ...s.expandedSessionTrees };
      if (expandedSessionTrees[dirName]) delete expandedSessionTrees[dirName];
      else expandedSessionTrees[dirName] = true;
      return { expandedSessionTrees };
    }),

  setPendingNewSession: (v) => set({ pendingNewSession: v }),
  setNewSessionSwitched: (v) => set({ newSessionSwitched: v }),

  saveOpenTabs: () => {
    const s = get();
    const tabs = s.activeSessionPaths
      .filter((p) => !p.startsWith('__new__'))
      .map((p) => ({ path: p, meta: s.activeTabMeta[p] || {} }))
      .slice(-RESTORE_TABS_LIMIT);
    // 记录上次激活的 tab（等价旧版 saveOpenTabs 的 active 字段，启动时恢复用）
    const active =
      s.activeSessionPath && !s.activeSessionPath.startsWith('__new__') ? s.activeSessionPath : null;
    lsSet(OPEN_TABS_KEY, JSON.stringify({ tabs, active }));
  },

  /** 启动时恢复最近 tab（≤3），返回可打开的路径列表（兼容旧版数组格式） */
  restoreOpenTabs: () => {
    try {
      const raw = lsGet(OPEN_TABS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const tabs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tabs) ? parsed.tabs : [];
      return tabs
        .map((t: { path?: string }) => t && t.path)
        .filter((p: string | undefined): p is string => !!p && !p.startsWith('__new__'))
        .slice(0, RESTORE_TABS_LIMIT);
    } catch {
      return [];
    }
  },

  /** 恢复 tab 列表 + 上次激活路径 + 持久化 meta（等价旧版 restoreOpenTabs 完整行为） */
  restoreOpenTabsWithActive: () => {
    try {
      const raw = lsGet(OPEN_TABS_KEY);
      if (!raw) return { paths: [], active: null, metas: {} };
      const parsed = JSON.parse(raw);
      const tabs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tabs) ? parsed.tabs : [];
      const metas: Record<string, TabMeta> = {};
      const paths: string[] = [];
      for (const t of tabs as Array<{ path?: string; meta?: TabMeta; dirName?: string; title?: string; firstMessage?: string; messageCount?: number; sessionId?: string; lastActiveAt?: number }>) {
        if (!t || !t.path || String(t.path).startsWith('__new__')) continue;
        paths.push(String(t.path));
        if (t.meta && typeof t.meta === 'object') {
          metas[String(t.path)] = t.meta as TabMeta;
        } else if (t.dirName) {
          // 兼容旧版平铺格式（dirName/title/firstMessage/messageCount/sessionId/lastActiveAt）
          metas[String(t.path)] = {
            dirName: String(t.dirName || ''),
            title: t.title,
            firstMessage: t.firstMessage,
            messageCount: t.messageCount,
            sessionId: t.sessionId,
            lastActiveAt: t.lastActiveAt,
          };
        }
      }
      const active = parsed && parsed.active && !String(parsed.active).startsWith('__new__') ? String(parsed.active) : null;
      return { paths: paths.slice(0, RESTORE_TABS_LIMIT), active, metas };
    } catch {
      return { paths: [], active: null, metas: {} };
    }
  },
}));

/** 无会话时创建一个新会话临时路径（UUID 防同一毫秒连续新建冲突） */
export function makeNewSessionPath(): string {
  return '__new__' + crypto.randomUUID();
}
