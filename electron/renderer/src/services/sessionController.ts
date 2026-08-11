/**
 * sessionController — 会话/项目编排（发送/中止/切换/项目/模型恢复）
 *
 * 等价 app.js sendMessage / abortMessage / sendSteer / sendFollowUp /
 * switchToSession / selectProject / loadProjects / loadSessions /
 * migrateStuckNewTabs / restoreTodoPhases / 模型管理。
 */
import { useSessionsStore, makeNewSessionPath } from '../stores/useSessionsStore';
import { useProjectsStore } from '../stores/useProjectsStore';
import { useChatStore } from '../stores/useChatStore';
import { useProcStore, renameProcKey } from '../stores/useProcStore';
import { useUiStore, type AskItem } from '../stores/useUiStore';
import type { TiffaProjectSummary } from '../types/tiffaDesktop';
import {
  startStallCheck, stopStallCheck,
  startFirstResponseCheck, stopFirstResponseCheck,
  markFirstResponseReceived,
} from './generationGuard';
import { loadAndRenderHistory, autoRenameWithLightModel, setHistoryPreload } from './historyService';
import { dirNameFromSessionPath, extractSessionId, dbgLog } from './utils';
import { normalizeUserContent } from './messageBuilders';

// ── 模块级状态 ──

let availableModelSet: Set<string> | null = null;
let availableModelSetTime = 0;
let lastSwitchTime = 0;

/** 全局 ask 输入处理器（由 AskModal 组件注册；null 时降级为直接返回 null） */
let askInputHandler: ((title: string, prefill: string) => Promise<string | null>) | null = null;
export function setAskInputHandler(h: ((title: string, prefill: string) => Promise<string | null>) | null): void {
  askInputHandler = h;
}
export async function showModalInput(title: string, prefill: string): Promise<string | null> {
  if (askInputHandler) return askInputHandler(title, prefill);
  return null;
}

// ── 模型管理 ──

async function getAvailableModelSet(): Promise<Set<string> | null> {
  const now = Date.now();
  if (availableModelSet && now - availableModelSetTime < 60000) return availableModelSet;
  // 引擎未就绪（含崩溃后停止重启）不调 getModels：主进程 handler 无实例会 throw
  if (!useProcStore.getState().tiffaReady) return null;
  try {
    const result = await window.tiffaDesktop.getModels(useSessionsStore.getState().activeSessionId);
    if (result && result.models && result.models.length > 0) {
      const set = new Set<string>();
      for (const m of result.models) {
        if (m.provider && m.id) set.add(`${m.provider}/${m.id}`);
      }
      availableModelSet = set;
      availableModelSetTime = now;
      return set;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchCurrentModel(): Promise<void> {
  // 引擎未就绪（含崩溃后停止重启）不调 getModels：主进程 handler 无实例会 throw
  if (!useProcStore.getState().tiffaReady) return;
  const sessionId = useSessionsStore.getState().activeSessionId;
  // 优先用内核真实当前模型（get_state.model），避免拿"可用列表第一个"当当前模型显示
  try {
    const st = await window.tiffaDesktop.getState(sessionId);
    const sm = (st as { model?: { id?: string; name?: string; provider?: string } } | null)?.model;
    if (sm && sm.id) {
      useUiStore.getState().setCurrentModel(sm.name || sm.id, sm.provider || '');
    }
  } catch {
    /* ignore */
  }
  try {
    const result = await window.tiffaDesktop.getModels(sessionId);
    if (result && result.models && result.models.length > 0) {
      const set = new Set<string>();
      for (const m of result.models) {
        if (m.provider && m.id) set.add(`${m.provider}/${m.id}`);
      }
      availableModelSet = set;
      availableModelSetTime = Date.now();
      // 兜底：get_state 没拿到模型时才用列表第一个
      const cur = useUiStore.getState().currentModel;
      if (!cur || cur === '--' || cur === '[object Object]') {
        const first = result.models[0];
        const name = first.name || first.id || '';
        if (name) {
          useUiStore.getState().setCurrentModel(name, first.provider || '');
        }
      }
    }
  } catch {
    /* ignore */
  }
}

/** 恢复模型（校验可用性 + 竞态防护） */
export async function restoreModelIfAvailable(
  provider: string,
  modelId: string,
  sessionId: string | null,
  expectedSessionPath: string,
): Promise<boolean> {
  const availableSet = await getAvailableModelSet();
  if (availableSet && !availableSet.has(`${provider}/${modelId}`)) {
    dbgLog('model', `模型 "${provider}/${modelId}" 不在可用列表中，跳过恢复`);
    return false;
  }
  try {
    await window.tiffaDesktop.setModel(provider, modelId, sessionId);
    if (useSessionsStore.getState().activeSessionPath !== expectedSessionPath) return true;
    useUiStore.getState().setCurrentModel(modelId, provider);
    return true;
  } catch {
    return false;
  }
}

/** 切换模型（每会话记忆） */
export async function switchModel(provider: string, modelId: string): Promise<void> {
  const proc = useProcStore.getState();
  if (!proc.tiffaReady) {
    useUiStore.getState().addToast('warning', 'Tiffa 尚未就绪，请稍候再切换模型');
    return;
  }
  useUiStore.setState({ modelSwitching: true });
  try {
    const sessions = useSessionsStore.getState();
    await window.tiffaDesktop.setModel(provider, modelId, sessions.activeSessionId);
    if (sessions.activeSessionPath) {
      sessions.setSessionModel(sessions.activeSessionPath, provider, modelId);
    }
    const lastModel = lsGetSafe('tiffa-lastModel');
    if (lastModel) {
      try {
        const last = JSON.parse(lastModel);
        last.provider = provider;
        last.modelId = modelId;
        lsSetSafe('tiffa-lastModel', JSON.stringify(last));
      } catch {
        lsSetSafe('tiffa-lastModel', JSON.stringify({ provider, modelId }));
      }
    } else {
      lsSetSafe('tiffa-lastModel', JSON.stringify({ provider, modelId }));
    }
    useUiStore.getState().setCurrentModel(modelId, provider);
  } catch (err) {
    useUiStore.getState().addToast('error', `切换模型失败: ${(err as Error).message}`);
  } finally {
    useUiStore.setState({ modelSwitching: false });
  }
}

/** 启动时的 lastModel 恢复 */
export async function restoreLastModelIfNeeded(): Promise<void> {
  const sessions = useSessionsStore.getState();
  if (!sessions.activeSessionPath) return;
  if (sessions.sessionModelMap[sessions.activeSessionPath]) return;
  try {
    const lastRaw = lsGetSafe('tiffa-lastModel');
    if (!lastRaw) return;
    const last = JSON.parse(lastRaw);
    if (last && last.provider && last.modelId) {
      await restoreModelIfAvailable(last.provider, last.modelId, sessions.activeSessionId, sessions.activeSessionPath);
    }
  } catch {
    /* ignore */
  }
}

function lsGetSafe(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSetSafe(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// ── 项目 ──

export async function loadProjects(): Promise<void> {
  const projectsStore = useProjectsStore.getState();
  const result = (await window.tiffaDesktop.listProjects()) as (TiffaProjectSummary[] & { error?: string }) | undefined;
  if (result && result.error) {
    useUiStore.getState().addToast('error', result.error);
    return;
  }
  const projects: TiffaProjectSummary[] = (Array.isArray(result) ? result : []).map((p) => ({
    dirName: String(p.dirName || ''),
    path: p.path ? String(p.path) : undefined,
    title: p.title ? String(p.title) : p.displayName ? String(p.displayName) : undefined,
    lastActiveAt: typeof p.lastActiveAt === 'number' ? p.lastActiveAt : undefined,
    sessionCount: typeof p.sessionCount === 'number' ? p.sessionCount : undefined,
    cwd: p.cwd ? String(p.cwd) : undefined,
  }));
  projectsStore.setProjects(projects);
  try {
    const archivedResult = (await window.tiffaDesktop.listArchivedProjects()) as Array<Record<string, unknown>> & { error?: string };
    projectsStore.setArchivedProjects(
      archivedResult && !archivedResult.error && Array.isArray(archivedResult)
        ? (archivedResult as unknown as TiffaProjectSummary[])
        : [],
    );
  } catch {
    projectsStore.setArchivedProjects([]);
  }
  // 恢复全局 tab（跨项目）
  restoreOpenTabsFlow();
  // 清理幽灵 tab
  await pruneGhostTabs();
  // 自动选中项目
  const state = useSessionsStore.getState();
  if (projects.length > 0 && !projectsStore.activeProjectDirName) {
    let first = projects[0].dirName;
    if (state.activeSessionPath) {
      const dir = dirNameFromSessionPath(state.activeSessionPath);
      const proj = dir ? projects.find((p) => p.dirName === dir) : null;
      if (proj) first = proj.dirName;
    }
    await selectProject(first);
  }
}

/** 恢复持久化 tab（≤3，跳过 __new__）并重建 meta；同时恢复上次激活的会话 */
function restoreOpenTabsFlow(): void {
  const sessions = useSessionsStore.getState();
  const { paths, active, metas } = sessions.restoreOpenTabsWithActive();
  if (paths.length === 0) return;
  for (const p of paths) {
    const saved = metas[p];
    // 持久化 meta 优先（等价旧版直接用 t.title 恢复）；缺失时回退磁盘会话列表/默认值
    const dir = (saved && saved.dirName) || dirNameFromSessionPath(p);
    if (dir) {
      const list = useProjectsStore.getState().projectSessions[dir];
      const sess = (list || []).find((s) => s.path === p);
      const title = (saved && (saved.title || saved.firstMessage)) || (sess && (sess.title || sess.firstMessage)) || '新对话';
      const firstMessage = (saved && saved.firstMessage) || (sess && sess.firstMessage) || '';
      const messageCount = (saved && saved.messageCount) || (sess && sess.messageCount) || 0;
      const sessionId = (saved && saved.sessionId) || (sess && sess.sessionId) || extractSessionId(p) || undefined;
      const lastActiveAt = (saved && saved.lastActiveAt) || Date.now();
      sessions.openTab(p, { dirName: dir, title, firstMessage, messageCount, sessionId, lastActiveAt });
    }
  }
  // 恢复上次激活的会话（等价旧版 restoreOpenTabs 的 active 恢复）
  // 注意：必须用最新 state 判断（上方 openTab 已更新 activeTabMeta）
  if (active && useSessionsStore.getState().activeTabMeta[active]) {
    useSessionsStore.setState({ activeSessionPath: active, activeSessionId: extractSessionId(active) || active });
  }
}

/** 清理指向已删除会话的幽灵 tab */
async function pruneGhostTabs(): Promise<void> {
  const sessions = useSessionsStore.getState();
  const meta = sessions.activeTabMeta;
  const paths = Object.keys(meta).filter((p) => !p.startsWith('__new__'));
  const dirs = new Set(paths.map((p) => meta[p].dirName).filter(Boolean));
  for (const dir of dirs) {
    try {
      const result = (await window.tiffaDesktop.listSessions(dir)) as Array<Record<string, unknown>> & { error?: string };
      if (result.error || !Array.isArray(result)) continue;
      const diskPaths = new Set(result.map((s) => String(s.path)));
      for (const p of paths) {
        if (meta[p].dirName === dir && !diskPaths.has(p)) {
          sessions.closeTab(p);
          if (sessions.activeSessionPath === p) {
            useSessionsStore.setState({ activeSessionPath: null, activeSessionId: null });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}

export async function selectProject(dirName: string): Promise<void> {
  const projectsStore = useProjectsStore.getState();
  const sessions = useSessionsStore.getState();
  const chat = useChatStore.getState();
  const proc = useProcStore.getState();
  const ui = useUiStore.getState();
  const isReselect = projectsStore.activeProjectDirName === dirName;

  // 缓存当前会话消息（切回来快速恢复）
  if (sessions.activeSessionPath && !isReselect) {
    const msgs = chat.messagesMap[sessions.activeSessionPath];
    if (msgs && msgs.length > 0) {
      chat.cacheSnapshot(sessions.activeSessionPath, 0);
    }
  }
  // 保存旧实例 agentRunning
  const oldCwd = projectsStore.workspacePath;
  if (oldCwd) {
    const running = sessions.activeSessionPath ? proc.procStateMap[sessions.activeSessionPath]?.agentRunning : false;
    proc.setInstanceRunning(oldCwd, !!running);
  }
  stopStallCheck();
  stopFirstResponseCheck();

  const project = useProjectsStore.getState().projects.find((p) => p.dirName === dirName);
  if (!project || !project.path && !project.cwd) return;
  const cwd = project.cwd || project.path || '';
  if (!cwd) return;

  if (cwd !== projectsStore.workspacePath || isReselect) {
    ui.setStatusText('切换项目...');
    try {
      const result = (await window.tiffaDesktop.activateInstance(cwd)) as { error?: string; cwd?: string; ready?: boolean };
      if (result.error) {
        ui.addToast('error', `切换项目失败: ${result.error}`);
        ui.setStatusText('就绪');
        return;
      }
      projectsStore.setWorkspacePath(result.cwd || cwd);
      if (result.ready === false) {
        proc.setReady(false);
        ui.setStatusText('正在启动 Tiffa 实例，请稍候...');
        ui.addToast('info', '新项目 Tiffa 实例正在启动，就绪后可发送消息');
      } else {
        proc.setReady(true);
      }
    } catch (err) {
      ui.addToast('error', `切换项目失败: ${(err as Error).message}`);
      ui.setStatusText('就绪');
      return;
    }
  }

  projectsStore.setActiveProject(dirName);
  // 默认展开当前激活项目（等价旧版 expandedProjects.add：只展开、不折叠）
  projectsStore.expandProject(dirName);
  ui.loadApprovalMode(useProjectsStore.getState().workspacePath);

  // 同步真实实例状态（切走期间可能错过 agent_end）
  const newCwd = useProjectsStore.getState().workspacePath;
  try {
    const instances = (await window.tiffaDesktop.getInstances()) as Array<{ cwd: string; agentRunning?: boolean }>;
    const current = instances.find((i) => i.cwd === newCwd);
    if (current) {
      proc.setInstanceRunning(newCwd, !!current.agentRunning);
    }
  } catch {
    /* ignore */
  }

  await loadSessions(dirName);

  // 目标会话：优先激活该项目在全局 tab 中最近打开的；无 tab 则回退最新会话
  const realSessions = (useSessionsStore.getState().sessions || []).filter((s) => !s.path.startsWith('__new__'));
  const projectTabs = Object.entries(sessions.activeTabMeta).filter(([, m]) => m.dirName === dirName);
  let targetPath: string | null = null;
  if (
    sessions.activeSessionPath &&
    sessions.activeTabMeta[sessions.activeSessionPath] &&
    sessions.activeTabMeta[sessions.activeSessionPath].dirName === dirName
  ) {
    targetPath = sessions.activeSessionPath;
  } else if (projectTabs.length > 0) {
    targetPath = projectTabs[projectTabs.length - 1][0];
  } else if (realSessions.length > 0) {
    targetPath = realSessions[realSessions.length - 1].path;
    const latest = realSessions[realSessions.length - 1];
    sessions.openTab(latest.path, {
      dirName,
      title: latest.title || latest.firstMessage || '新对话',
      firstMessage: latest.firstMessage || '',
      messageCount: latest.messageCount || 0,
      sessionId: latest.sessionId || extractSessionId(latest.path) || undefined,
      lastActiveAt: Date.now(),
    });
  }

  if (targetPath) {
    useSessionsStore.setState({ activeSessionPath: targetPath, activeSessionId: extractSessionId(targetPath) || targetPath });
    // 被外层 switchToSession 跨项目调用时（sessionSwitching=true），内层切换会被防抖/锁拦下
    // 做无用功——由外层继续完成加载；独立调用（点击项目）时正常切换。
    if (!useUiStore.getState().sessionSwitching) {
      await switchToSession(targetPath);
    }
  } else {
    useSessionsStore.setState({ activeSessionPath: null, activeSessionId: null });
    useChatStore.getState().setWelcomePhase('showing');
  }
}

/** 加载项目会话列表（含内联兜底迁移 + 保留实时标题） */
export async function loadSessions(dirName: string): Promise<void> {
  const result = (await window.tiffaDesktop.listSessions(dirName)) as Array<Record<string, unknown>> & { error?: string };
  let sessions = [] as Array<Record<string, unknown>>;
  const isCurrent = dirName === useProjectsStore.getState().activeProjectDirName;
  if (result.error) {
    sessions = [];
  } else if (Array.isArray(result)) {
    sessions = result;
    if (isCurrent) {
      await migrateStuckNewTabs(sessions);
    }
  }
  const normalized = sessions.map((s) => ({
    path: String(s.path || ''),
    title: s.title ? String(s.title) : undefined,
    firstMessage: s.firstMessage ? String(s.firstMessage) : undefined,
    messageCount: typeof s.messageCount === 'number' ? s.messageCount : undefined,
    sessionId: s.sessionId ? String(s.sessionId) : undefined,
    lastActiveAt: typeof s.lastActiveAt === 'number' ? s.lastActiveAt : undefined,
    archived: !!s.archived,
  }));
  const stores = useSessionsStore.getState();
  const merged = normalized.map((incoming) => {
    const old = stores.sessions.find((x) => x.path === incoming.path);
    return old && old.title && !incoming.title ? { ...incoming, title: old.title } : incoming;
  });
  useSessionsStore.setState({ sessions: merged });
  useProjectsStore.getState().setProjectSessions(dirName, merged);
}

// ── __new__ 兜底迁移 ──

/** 后台 __new__ tab 迁移：返回 oldPath -> newPath 映射 */
export async function migrateStuckNewTabs(diskSessions: unknown = null): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const projects = useProjectsStore.getState();
  const sessions = useSessionsStore.getState();
  if (!projects.activeProjectDirName) return map;
  const newTabsToMigrate = sessions.sessions.filter((s) => s.path.startsWith('__new__') && s.sessionId);
  if (newTabsToMigrate.length === 0) return map;
  let instances: Array<{ sessionId?: string; cwd?: string; sessionFilePath?: string }> = [];
  try {
    const insts = (await window.tiffaDesktop.getInstances()) as Array<{ sessionId?: string; cwd?: string; sessionFilePath?: string }> | undefined;
    instances = insts || [];
  } catch {
    /* ignore */
  }
  if (instances.length === 0) return map;
  let disk = diskSessions as Array<Record<string, unknown>> | null;
  if (!disk) {
    try {
      const r = (await window.tiffaDesktop.listSessions(projects.activeProjectDirName)) as Array<Record<string, unknown>> & { sessions?: unknown };
      disk = r && r.sessions ? (r.sessions as Array<Record<string, unknown>>) : Array.isArray(r) ? r : null;
    } catch {
      /* ignore */
    }
  }
  if (!disk) return map;
  for (const nt of newTabsToMigrate) {
    const inst =
      instances.find((i) => i.sessionId === nt.sessionId) ||
      instances.find(
        (i) => i.cwd === projects.workspacePath && i.sessionFilePath && !sessions.activeTabMeta[i.sessionFilePath],
      );
    if (inst && inst.sessionFilePath) {
      const realSession = disk.find((rs) => {
        const norm = (s: unknown) => (s ? String(s).replace(/\//g, '\\').toLowerCase() : '');
        return norm(rs.path) === norm(inst.sessionFilePath);
      });
      if (realSession) {
        const oldPath = nt.path;
        const newPath = String(realSession.path);
        map[oldPath] = newPath;
        const realSid = extractSessionId(newPath);
        applySessionMigration(oldPath, newPath, realSid);
      }
    }
  }
  return map;
}

/** 8 处引用迁移（session_switch / migrateStuckNewTabs 共用） */
export function applySessionMigration(oldPath: string, newPath: string, realSessionId: string | null): void {
  const sessions = useSessionsStore.getState();
  sessions.migrateTabPath(oldPath, newPath, realSessionId);
  useChatStore.getState().migrateChatKey(oldPath, newPath);
  renameProcKey(oldPath, newPath);
}

// ── 会话切换 ──

export async function switchToSession(sessionPath: string): Promise<void> {
  const sessions = useSessionsStore.getState();
  const projects = useProjectsStore.getState();
  const chat = useChatStore.getState();
  const proc = useProcStore.getState();
  const ui = useUiStore.getState();
  // 相同路径：已有消息才跳过——启动恢复场景 activeSessionPath 已由 restoreOpenTabsFlow
  // 预置但消息尚未加载，此时必须继续走加载流程（否则启动后活跃会话历史空白）。
  if (sessions.activeSessionPath === sessionPath && (chat.messagesMap[sessionPath]?.length || 0) > 0) return;

  // 准备阶段锁：活跃 tab 是未迁移 __new__ 时禁止切走
  if (sessions.preparingNewSessions[sessions.activeSessionPath || ''] && !sessions.preparingNewSessions[sessionPath]) {
    ui.addToast('info', '新对话正在准备中，请稍候…');
    return;
  }
  // 防抖 300ms
  const now = Date.now();
  if (now - lastSwitchTime < 300) return;
  lastSwitchTime = now;
  if (ui.sessionSwitching) return;
  ui.setSessionSwitching(true);

  // 后台 __new__ tab 先兜底迁移
  if (sessionPath.startsWith('__new__')) {
    const migrationMap = await migrateStuckNewTabs();
    if (migrationMap[sessionPath]) sessionPath = migrationMap[sessionPath];
  }

  // 跨项目切换：先切项目上下文
  const targetDir = dirNameFromSessionPath(sessionPath);
  if (targetDir && targetDir !== projects.activeProjectDirName) {
    await selectProject(targetDir);
    if (useUiStore.getState().sessionSwitching === false) return;
  }

  const oldSessionPath = sessions.activeSessionPath;
  // 丢弃未发送的排队消息
  ui.setPendingQueueMessage(null);

  // 保存旧会话 agentRunning（不 abort 旧实例：多实例并行）
  if (oldSessionPath) {
    proc.setSessionRunning(oldSessionPath, !!proc.procStateMap[oldSessionPath]?.agentRunning);
  }
  stopStallCheck();
  stopFirstResponseCheck();

  // 缓存旧会话消息快照
  if (oldSessionPath) {
    const msgs = chat.messagesMap[oldSessionPath];
    if (msgs && msgs.length > 0) {
      chat.cacheSnapshot(oldSessionPath, 0);
    }
  }

  useSessionsStore.setState({ activeSessionPath: sessionPath });
  // 打开 tab：确保 meta 存在
  const meta = sessions.activeTabMeta[sessionPath];
  if (!meta) {
    const dir = targetDir || projects.activeProjectDirName;
    const list = (dir && projects.projectSessions[dir]) || sessions.sessions || [];
    const sessObj = list.find((s) => s.path === sessionPath);
    if (sessObj) {
      sessions.openTab(sessionPath, {
        dirName: dir || '',
        title: sessObj.title || sessObj.firstMessage || '新对话',
        firstMessage: sessObj.firstMessage || '',
        messageCount: sessObj.messageCount || 0,
        sessionId: sessObj.sessionId || extractSessionId(sessionPath) || undefined,
        lastActiveAt: Date.now(),
      });
    } else {
      sessions.openTab(sessionPath, {
        dirName: dir || '',
        title: '新对话',
        firstMessage: '',
        messageCount: 0,
        sessionId: extractSessionId(sessionPath) || undefined,
        lastActiveAt: Date.now(),
      });
    }
  } else {
    sessions.openTab(sessionPath, meta);
    sessions.updateTabMeta(sessionPath, { lastActiveAt: Date.now() });
  }

  // 提取目标 sessionId（__new__ 用临时 UUID）
  let targetSessionId = extractSessionId(sessionPath);
  if (!targetSessionId && sessionPath.startsWith('__new__')) {
    const sessObj = sessions.sessions.find((s) => s.path === sessionPath);
    targetSessionId = (sessObj && sessObj.sessionId) || null;
  }
  useSessionsStore.setState({ activeSessionId: targetSessionId || sessionPath });

  // 活跃 tab 上限 8：移除最早未激活的
  const paths = Object.keys(sessions.activeTabMeta).filter((p) => sessions.activeSessionPaths.includes(p));
  if (paths.length > 8) {
    for (const p of paths) {
      if (p !== sessionPath) {
        sessions.closeTab(p);
        break;
      }
    }
  }

  try {
    if (sessionPath.startsWith('__new__')) {
      // __new__ 未写盘：从缓存恢复或欢迎页
      const cachedNew = chat.sessionMessageCache[sessionPath];
      if (cachedNew && cachedNew.messages.length > 0) {
        chat.setMessages(sessionPath, cachedNew.messages);
      } else {
        chat.setMessages(sessionPath, []);
        chat.setWelcomePhase('showing');
      }
      if (targetSessionId) {
        proc.setReady(false);
        try {
          const result = (await window.tiffaDesktop.activateSession(projects.workspacePath || '', targetSessionId)) as { error?: string; ready?: boolean };
          if (useSessionsStore.getState().activeSessionPath !== sessionPath) {
            ui.setSessionSwitching(false);
            return;
          }
          if (!result.error) {
            proc.setReady(result.ready !== false);
            const saved = useSessionsStore.getState().sessionModelMap[sessionPath];
            if (saved && saved.provider && saved.modelId) {
              try {
                await restoreModelIfAvailable(saved.provider, saved.modelId, targetSessionId, sessionPath);
              } catch {
                /* ignore */
              }
            } else {
              await restoreLastModelIfNeeded();
            }
          } else {
            try {
              proc.setReady(await window.tiffaDesktop.isReady(targetSessionId));
            } catch {
              proc.setReady(false);
            }
          }
        } catch {
          try {
            proc.setReady(await window.tiffaDesktop.isReady(targetSessionId));
          } catch {
            proc.setReady(false);
          }
        }
      }
      ui.setSessionSwitching(false);
      restoreTodoPhases();
      return;
    }

    // 缓存命中：只有 agent 运行中 或 agent_end flush 过（新鲜）才用内存快照；
    // 否则一律从 JSONL 重新读取最新窗口——复用 messagesMap 里可能过期的旧快照
    // 会导致 agent 在后台已把新内容写盘后，切回来仍显示旧尾部（「尾部消失」根因）。
    const agentWasRunning = proc.procStateMap[sessionPath]?.agentRunning;
    const cacheFresh = chat.sessionCacheFresh[sessionPath];
    const cached = agentWasRunning || cacheFresh ? chat.sessionMessageCache[sessionPath] : null;
    if (cached && cached.messages.length > 0) {
      chat.setMessages(sessionPath, cached.messages);
    } else {
      // 重置历史游标，强制从 JSONL 尾部重新读取（不带上次 skip，以免游标错位返回空/丢尾部）
      chat.resetHistory(sessionPath);
      chat.setMessages(sessionPath, []);
      await loadAndRenderHistory(sessionPath);
    }
  } catch (err) {
    ui.addToast('error', `切换对话失败: ${(err as Error).message}`);
  }

  // 恢复目标会话 agentRunning
  const agentRunning = !!proc.procStateMap[sessionPath]?.agentRunning;
  if (agentRunning) {
    proc.setSessionRunning(sessionPath, true);
    startStallCheck();
    ui.setStatusText('运行中...');
  } else {
    ui.setStatusText('就绪');
  }

  // 后台激活 + 模型恢复（非阻塞）
  if (targetSessionId) {
    ui.setPendingActivation({ cwd: projects.workspacePath || '', sessionId: targetSessionId, path: sessionPath });
    (async () => {
      try {
        const result = (await window.tiffaDesktop.activateSession(projects.workspacePath || '', targetSessionId)) as { error?: string; ready?: boolean };
        if (useSessionsStore.getState().activeSessionPath !== sessionPath) {
          ui.setPendingActivation(null);
          return;
        }
        if (!result.error) {
          proc.setReady(result.ready !== false);
          const saved = useSessionsStore.getState().sessionModelMap[sessionPath];
          if (saved && saved.provider && saved.modelId) {
            await restoreModelIfAvailable(saved.provider, saved.modelId, targetSessionId, sessionPath);
          } else {
            await restoreLastModelIfNeeded();
          }
        } else {
          try {
            proc.setReady(await window.tiffaDesktop.isReady(targetSessionId));
          } catch {
            proc.setReady(false);
          }
        }
      } catch {
        try {
          proc.setReady(await window.tiffaDesktop.isReady(targetSessionId));
        } catch {
          proc.setReady(false);
        }
      }
      if (useSessionsStore.getState().activeSessionPath === sessionPath) {
        ui.setPendingActivation(null);
      }
    })();
  }
  sessions.saveOpenTabs();
  ui.setSessionSwitching(false);
  restoreTodoPhases();
  dbgLog('switch', `switchToSession done path=${sessionPath.slice(-50)} sid=${targetSessionId}`);
}

// ── 发送 ──

/** 发送消息（/ask 拦截 / 等待就绪 / __new__ 创建 / firstMessage / 立即渲染 / 失败复位） */
export async function sendMessage(text: string, images?: Array<{ data: string; mimeType: string; name?: string }>): Promise<void> {
  const message = text.trim();
  if (!message && (!images || images.length === 0)) return;
  const sessions = useSessionsStore.getState();
  const projects = useProjectsStore.getState();
  const chat = useChatStore.getState();
  const proc = useProcStore.getState();
  const ui = useUiStore.getState();

  // /ask 命令拦截
  if (message.startsWith('/ask') && sessions.activeSessionPath && (!images || images.length === 0)) {
    const question = message.replace(/^\/ask\s*/, '').trim();
    if (question) {
      const answer = await showModalInput('问题：' + question, '');
      if (answer === null || answer.trim() === '') return;
      return sendMessage(answer.trim());
    }
  }

  if (ui.sessionSwitching) {
    ui.addToast('warning', '正在切换会话，请稍候');
    return;
  }
  if (ui.modelSwitching) {
    ui.addToast('warning', '正在切换模型，请稍候');
    return;
  }
  if (!proc.tiffaReady) {
    ui.setStatusText('等待引擎就绪…');
    let waited = 0;
    while (!proc.tiffaReady && waited < 5000) {
      await new Promise((r) => setTimeout(r, 300));
      waited += 300;
      try {
        proc.setReady(await window.tiffaDesktop.isReady(sessions.activeSessionId));
      } catch {
        /* ignore */
      }
    }
    if (!proc.tiffaReady) {
      ui.addToast('warning', 'Tiffa 尚未就绪，请稍后再试');
      ui.setStatusText('未就绪');
      return;
    }
    ui.setStatusText('就绪');
  }

  // 无会话 → 自动创建 __new__
  if (!sessions.activeSessionPath) {
    const tempSessionId = crypto.randomUUID();
    const tempPath = makeNewSessionPath();
    const newSession = {
      path: tempPath,
      title: '新对话',
      firstMessage: message.substring(0, 30),
      messageCount: 0,
      sessionId: tempSessionId,
    };
    useSessionsStore.setState({ sessions: [...useSessionsStore.getState().sessions, newSession] });
    sessions.openTab(tempPath, {
      dirName: projects.activeProjectDirName || '',
      title: '新对话',
      firstMessage: message.substring(0, 30),
      messageCount: 0,
      sessionId: tempSessionId,
      lastActiveAt: Date.now(),
    });
    useSessionsStore.setState({ activeSessionPath: tempPath, activeSessionId: tempSessionId });
    try {
      const result = (await window.tiffaDesktop.activateSession(projects.workspacePath || '', tempSessionId)) as { error?: string; ready?: boolean };
      if (result.error) {
        ui.addToast('error', `创建对话失败: ${result.error}`);
        return;
      }
      proc.setReady(result.ready !== false);
      if (ui.currentProvider && ui.currentModel && ui.currentModel !== '--') {
        try {
          await window.tiffaDesktop.setModel(ui.currentProvider, ui.currentModel, tempSessionId);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      ui.addToast('error', `创建对话失败: ${(err as Error).message}`);
      return;
    }
  }

  // __new__ 阶段：同步 firstMessage
  const activePathNow = useSessionsStore.getState().activeSessionPath;
  if (activePathNow && activePathNow.startsWith('__new__')) {
    const ns = useSessionsStore.getState().sessions.find((s) => s.path === activePathNow);
    if (ns && !ns.firstMessage && message) {
      const fm = message.substring(0, 100);
      useSessionsStore.setState({
        sessions: useSessionsStore.getState().sessions.map((s) => (s.path === ns.path ? { ...s, firstMessage: fm } : s)),
      });
      sessions.updateTabMeta(ns.path, { firstMessage: fm });
    }
  }

  chat.setWelcomePhase('done');
  const activePath = useSessionsStore.getState().activeSessionPath;
  // 立即渲染用户消息
  if (!ui.aiRenameSession) {
    chat.appendUserMessage(activePath, {
      id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      parts: [{ kind: 'text', text: message }],
      time: new Date().toLocaleTimeString(),
      images,
    });
  }
  const sendImages = images && images.length > 0 ? images.map((img) => ({ data: img.data, mimeType: img.mimeType })) : undefined;
  proc.setSessionRunning(activePath, true);
  proc.setInstanceRunning(projects.workspacePath, true);
  startStallCheck();
  startFirstResponseCheck();
  ui.setStatusText('思考中...');
  try {
    await window.tiffaDesktop.send(message, sendImages, useSessionsStore.getState().activeSessionId);
  } catch (err) {
    ui.addToast('error', `发送失败: ${(err as Error).message}`);
    proc.setSessionRunning(activePath, false);
    proc.setInstanceRunning(projects.workspacePath, false);
    stopStallCheck();
    stopFirstResponseCheck();
    chat.finalizeAssistant(activePath);
    ui.setStatusText('就绪');
  }
}

// ── 新建对话（等价旧版 btnNewSession 流程）──

export async function newSession(): Promise<void> {
  const sessions = useSessionsStore.getState();
  const projects = useProjectsStore.getState();
  const chat = useChatStore.getState();
  const proc = useProcStore.getState();
  const ui = useUiStore.getState();
  try {
    // 没有选中项目时，先引导用户选择文件夹
    if (!projects.activeProjectDirName) {
      ui.setStatusText('请先选择项目文件夹...');
      const result = (await window.tiffaDesktop.openFolderDialog()) as { canceled?: boolean; error?: string; path?: string } | undefined;
      if (!result || result.canceled) {
        ui.setStatusText('就绪');
        return;
      }
      if (result.error) {
        ui.addToast('error', `打开文件夹失败: ${result.error}`);
        ui.setStatusText('就绪');
        return;
      }
      const folderPath = result.path;
      if (!folderPath) {
        ui.setStatusText('就绪');
        return;
      }
      const changeResult = (await window.tiffaDesktop.activateInstance(folderPath)) as { error?: string } | undefined;
      if (changeResult && changeResult.error) {
        ui.addToast('error', `切换项目失败: ${changeResult.error}`);
        ui.setStatusText('就绪');
        return;
      }
      projects.setWorkspacePath(folderPath);
      proc.setReady(true);
      await loadProjects();
      ui.setStatusText('就绪');
      return;
    }
    ui.setStatusText('新建对话...');

    // 缓存当前对话（切回时从缓存恢复）
    if (sessions.activeSessionPath && !sessions.activeSessionPath.startsWith('__new__')) {
      const msgs = chat.messagesMap[sessions.activeSessionPath];
      if (msgs && msgs.length > 0) chat.cacheSnapshot(sessions.activeSessionPath, 0);
    }
    if (sessions.activeSessionPath) {
      proc.setSessionRunning(sessions.activeSessionPath, !!proc.procStateMap[sessions.activeSessionPath]?.agentRunning);
    }

    // 生成临时 sessionId / path（UUID 防同一毫秒连续新建冲突）
    const tempSessionId = crypto.randomUUID();
    const tempSessionPath = makeNewSessionPath();
    const newSess = { path: tempSessionPath, title: '新对话', firstMessage: '', messageCount: 0, sessionId: tempSessionId };
    useSessionsStore.setState({ sessions: [...useSessionsStore.getState().sessions, newSess] });
    useSessionsStore.setState({ activeSessionPath: tempSessionPath, activeSessionId: tempSessionId });
    sessions.openTab(tempSessionPath, {
      dirName: projects.activeProjectDirName,
      title: '新对话',
      firstMessage: '',
      messageCount: 0,
      sessionId: tempSessionId,
      lastActiveAt: Date.now(),
    });

    // 准备阶段锁 + 15s 超时兜底
    useSessionsStore.setState((s) => ({ preparingNewSessions: { ...s.preparingNewSessions, [tempSessionPath]: true } }));
    setTimeout(() => {
      useSessionsStore.getState().clearPreparing(tempSessionPath);
      if (projects.activeProjectDirName) void loadSessions(projects.activeProjectDirName);
    }, 15000);

    // 继承当前模型
    if (ui.currentProvider && ui.currentModel) {
      useSessionsStore.getState().setSessionModel(tempSessionPath, ui.currentProvider, ui.currentModel);
    }

    // 清屏 + 欢迎页
    chat.setMessages(tempSessionPath, []);
    chat.setWelcomePhase('showing');
    sessions.saveOpenTabs();

    // 激活对话级实例（独立 Tiffa 进程）
    const result = (await window.tiffaDesktop.activateSession(projects.workspacePath || '', tempSessionId)) as { error?: string; ready?: boolean } | undefined;
    if (result && result.error) {
      ui.addToast('error', `新建对话失败: ${result.error}`);
      ui.setStatusText('就绪');
      return;
    }
    proc.setReady(!result || result.ready !== false);
    // 设置模型（继承之前的模型）
    if (ui.currentProvider && ui.currentModel && ui.currentModel !== '--') {
      try {
        await window.tiffaDesktop.setModel(ui.currentProvider, ui.currentModel, tempSessionId);
      } catch {
        /* ignore */
      }
    }
    ui.setStatusText('就绪');
    requestAnimationFrame(() => {
      (document.querySelector('#inputArea textarea') as HTMLElement | null)?.focus();
    });
    // 后台异步刷新真实会话列表
    setTimeout(() => {
      const dir = useProjectsStore.getState().activeProjectDirName;
      if (dir) void loadSessions(dir);
    }, 2000);
  } catch (err) {
    ui.addToast('error', `新建对话失败: ${(err as Error).message}`);
    ui.setStatusText('就绪');
  }
}

// ── 手动压缩（等价旧版 onCompactClick）──

async function compactRoutePath(): Promise<string | null> {
  try {
    const root = (await window.tiffaDesktop.getRootPath()) as string;
    return `${root}\\data\\agent\\last-compact-route.json`;
  } catch {
    return null;
  }
}

async function readCompactRoute(): Promise<{ ts?: number; route?: string; detail?: string } | null> {
  const p = await compactRoutePath();
  if (!p) return null;
  try {
    const res = (await window.tiffaDesktop.readFile(p)) as { content?: string; error?: string } | undefined;
    if (!res || res.error || !res.content) return null;
    return JSON.parse(res.content) as { ts?: number; route?: string; detail?: string };
  } catch {
    return null;
  }
}

async function waitForCompactRoute(
  beforeTs: number | null,
  timeoutMs: number,
): Promise<{ ts?: number; route?: string; detail?: string } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await readCompactRoute();
    if (r && (beforeTs == null || (r.ts && r.ts !== beforeTs))) return r;
    await new Promise((res) => setTimeout(res, 400));
  }
  return null;
}

export async function compactMessage(): Promise<void> {
  const ui = useUiStore.getState();
  const sessions = useSessionsStore.getState();
  const proc = useProcStore.getState();
  const chat = useChatStore.getState();
  if (!proc.tiffaReady || !sessions.activeSessionId) {
    ui.addToast('warning', 'Tiffa 尚未就绪，请稍后再试');
    return;
  }
  const path = sessions.activeSessionPath;
  if (path && proc.procStateMap[path]?.agentRunning) {
    ui.addToast('warning', '模型正在生成中，请等待完成后再压缩');
    return;
  }
  let beforeTs: number | null = null;
  try {
    const r = await readCompactRoute();
    beforeTs = r && r.ts != null ? r.ts : null;
  } catch {
    /* ignore */
  }
  ui.addToast('info', '正在压缩对话上下文…');
  // compact 是内核异步后台任务：执行完成后不一定会回 response 帧，
  // sendCommand 会挂起 5 分钟超时——不能 await 等它，否则后续刷新/提示全部不执行。
  // 改为竞速：8 秒内若内核回了 response 则提前放行，否则继续轮询 route 文件确认完成。
  // 关键：错误不能吞掉——内核 compact 可能抛 "Compaction already in progress" /
  // "Nothing to compact (session too small)" / "No model selected"，必须让用户看到。
  let compactError: string | null = null;
  try {
    const r = await Promise.race([
      window.tiffaDesktop.compact(sessions.activeSessionId).then(
        (res) => ({ ok: true, res }),
        (err) => ({ ok: false as const, err: (err as Error)?.message || String(err) }),
      ),
      new Promise<{ ok: false; timeout: true }>((r) => setTimeout(() => r({ ok: false, timeout: true }), 8000)),
    ]);
    if (r && r.ok === false && !(r as { timeout?: boolean }).timeout) {
      compactError = (r as { err?: string }).err || '压缩命令失败';
    }
  } catch {
    /* race 兜底 */
  }
  if (compactError) {
    ui.setStatusText('压缩失败');
    ui.addToast('error', `压缩失败: ${compactError}`);
    return;
  }
  // 读取本次压缩走的路径（轮询最长 60 秒，覆盖 snapcompact 视觉帧归档耗时）
  const route = await waitForCompactRoute(beforeTs, 60000);
  if (route && route.route) {
    const labels: Record<string, string> = {
      snapcompact: '内核 snapcompact（视觉帧归档，无损 ~60%）',
      'claude-route': '旁路 Claude 路线（9段结构化摘要）',
      'kernel-llm': '内核 LLM 自压 + gap-fill 兜底',
    };
    ui.addToast('info', `压缩完成 · 路径：${labels[route.route] || route.route}${route.detail ? `（${route.detail}）` : ''}`);
  } else if (beforeTs != null) {
    // 轮询超时且无新 route 记录：压缩可能未真正执行（会话过小被内核拒绝等），别误报"完成"
    ui.addToast('warning', '压缩未确认完成（可能被内核拒绝或仍在执行），请稍后查看会话是否已压缩');
    ui.setStatusText('压缩未确认');
  } else {
    ui.addToast('info', '压缩完成');
  }
  // 压缩成功后：清除缓存（缓存里是压缩前的旧内容），重新从 JSONL 加载渲染
  if (path && !path.startsWith('__new__')) {
    chat.markCacheFresh(path, false);
    useChatStore.setState((s) => {
      const sessionMessageCache = { ...s.sessionMessageCache };
      delete sessionMessageCache[path];
      return { sessionMessageCache };
    });
    try {
      await loadAndRenderHistory(path);
    } catch {
      /* ignore */
    }
  }
}

// ── 手动压缩 ──

export async function abortMessage(): Promise<void> {
  const ui = useUiStore.getState();
  const proc = useProcStore.getState();
  const chat = useChatStore.getState();
  const sid = useSessionsStore.getState().activeSessionId;
  try {
    await window.tiffaDesktop.abort(sid);
  } catch {
    /* ignore */
  }
  stopStallCheck();
  ui.setStatusText('已发送停止信号，等待 agent 响应...');
  // 15s 兜底
  setTimeout(() => {
    const st = useSessionsStore.getState();
    const path = st.activeSessionPath;
    const running = path ? useProcStore.getState().procStateMap[path]?.agentRunning : false;
    if (running) {
      proc.setSessionRunning(path, false);
      chat.finalizeAssistant(path);
      useUiStore.getState().setStatusText('已停止');
    }
  }, 15000);
}

export async function sendSteer(text: string): Promise<void> {
  const chat = useChatStore.getState();
  const ui = useUiStore.getState();
  const path = useSessionsStore.getState().activeSessionPath;
  const sid = useSessionsStore.getState().activeSessionId;
  ui.setPendingSteerMarker(true);
  chat.appendUserMessage(path, {
    id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    parts: [{ kind: 'text', text }],
    steered: true,
    time: new Date().toLocaleTimeString(),
  });
  ui.addToast('info', '已发送引导，当前工具完成后将按新方向继续');
  try {
    await window.tiffaDesktop.steer(text, sid);
  } catch (err) {
    ui.setPendingSteerMarker(false);
    ui.addToast('error', `引导失败: ${(err as Error).message}`);
  }
}

export async function sendFollowUp(text: string): Promise<void> {
  const chat = useChatStore.getState();
  const ui = useUiStore.getState();
  const path = useSessionsStore.getState().activeSessionPath;
  const sid = useSessionsStore.getState().activeSessionId;
  ui.setPendingFollowUpMarker(true);
  chat.appendUserMessage(path, {
    id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    parts: [{ kind: 'text', text }],
    queued: true,
    time: new Date().toLocaleTimeString(),
  });
  ui.addToast('info', '消息已排队，当前任务完成后执行');
  try {
    await window.tiffaDesktop.followUp(text, sid);
  } catch (err) {
    ui.setPendingFollowUpMarker(false);
    ui.addToast('error', `排队失败: ${(err as Error).message}`);
  }
}

/** agent 结束后自动发送排队消息 */
export function flushPendingQueue(): void {
  const ui = useUiStore.getState();
  const text = ui.pendingQueueMessage;
  if (!text) return;
  ui.setPendingQueueMessage(null);
  sendFollowUp(text).catch(() => {});
}

export { markFirstResponseReceived };

/** 从内核 get_state 恢复 Todo 面板（切换会话/启动时调用） */
export async function restoreTodoPhases(): Promise<void> {
  try {
    const st = (await window.tiffaDesktop.getState(useSessionsStore.getState().activeSessionId)) as { todoPhases?: unknown[] } | undefined;
    if (st && Array.isArray(st.todoPhases)) {
      useUiStore.getState().setTodoPhases(st.todoPhases);
    }
  } catch {
    /* ignore */
  }
}

// ── 欢迎页预加载（利用遮罩空闲时间预载数据，进入后切换秒开）──

/**
 * 预载：① 所有已打开 tab 的会话历史（排除当前活跃和 __new__，上限 8）
 *       ② 所有项目的会话列表（避免展开时懒加载等待）
 * 使用节流顺序加载（每次间隔 100ms）避免 IPC 洪水。
 * 启动时与 loadProjects 并行调用（tab 列表直接从 localStorage 读取，
 * 不依赖 store 恢复完成），让遮罩等待期尽早开始预热。
 */
export function preloadDuringWelcome(): void {
  const chat = useChatStore.getState();
  // ① 预载已打开 tab 的会话历史（直接从 localStorage 读，不等 loadProjects 恢复）
  const { paths, active } = useSessionsStore.getState().restoreOpenTabsWithActive();
  const historyTargets = paths.filter((p) => p !== active).slice(0, 8);
  let histIdx = 0;
  const loadNextHistory = () => {
    if (histIdx >= historyTargets.length) return;
    const p = historyTargets[histIdx++];
    if (chat.history[p]?.cache || chat.sessionMessageCache[p]) {
      loadNextHistory();
      return;
    }
    window.tiffaDesktop
      .loadSessionHistory(p, { tail: 200 })
      .then((res) => {
        if (res && !res.error && res.messages && res.messages.length > 0) {
          setHistoryPreload(p, res.messages, !!res.hasMore);
        }
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => setTimeout(loadNextHistory, 100));
  };
  loadNextHistory();

  // ② 预载所有项目的会话列表（复用 loadSessions 规范化 + 兜底迁移）
  const projTargets = useProjectsStore.getState().projects.filter((p) => p.dirName);
  let projIdx = 0;
  const loadNextProject = () => {
    if (projIdx >= projTargets.length) return;
    const dirName = projTargets[projIdx++].dirName;
    if (useProjectsStore.getState().projectSessions[dirName]) {
      loadNextProject();
      return;
    }
    loadSessions(dirName)
      .catch(() => {
        /* ignore */
      })
      .finally(() => setTimeout(loadNextProject, 100));
  };
  loadNextProject();
}
