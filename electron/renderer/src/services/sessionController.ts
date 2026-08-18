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
import { useUiStore, type AskItem, type ThinkingLevel } from '../stores/useUiStore';
import type { TiffaProjectSummary, TiffaModelInfo, TiffaModelsConfig } from '../types/tiffaDesktop';
import {
  startStallCheck, stopStallCheck,
  startFirstResponseCheck, stopFirstResponseCheck,
  markFirstResponseReceived, stopAllGuards,
} from './generationGuard';
import { loadAndRenderHistory, autoRenameWithLightModel, setHistoryPreload } from './historyService';
import { dirNameFromSessionPath, extractSessionId, dbgLog, localizeKernelMessage, msgFingerprint } from './utils';
import { normalizeUserContent } from './messageBuilders';

// ── 模块级状态 ──

/** 死列表缓存：模型列表增删后要重启才生效，运行期内稳定，故全局只加载一次 */
let modelListCache: TiffaModelInfo[] | null = null;
/** in-flight 去重：并发调用只发一次加载 */
let modelListPromise: Promise<TiffaModelInfo[] | null> | null = null;
/** 竞态序号：过期请求返回时丢弃（不写缓存） */
let modelListSeq = 0;
let lastSwitchTime = 0;
/** 切换序号：每次 switchToSession +1；await 后检查仍是最新才继续（并发切换时旧流程自动放弃） */
let switchSeq = 0;
/** per-session 模型物化互斥：切换会话的后台模型恢复与发送前物化并发时只执行一次 setModel，
 *  避免重复 set_model 命令排队（内核串行处理）导致发送流程长时间阻塞（双对话卡死） */
const restoreModelInFlight = new Set<string>();

/** IPC 调用超时包装：模型命令（get_state/set_model/get_available_models）在实例冷启动、
 *  后台模型发现（awaitBackgroundRefresh）或本地模型加载期间可能长时间无响应（主进程命令
 *  超时长达 5 分钟），超时后放弃等待、不阻塞发送流程（命令本身仍会在内核后台完成） */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      dbgLog('model', `${label} 超时(${Math.round(ms / 1000)}s)，不再等待（内核将在后台完成）`);
      reject(new Error(`${label} timeout`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** 仅当本流程仍持有切换锁（seq 仍是最新）时才解锁——被更新的点击覆盖时锁由新流程接管 */
function unlockSwitchIfLatest(seq: number): void {
  if (seq === switchSeq) useUiStore.getState().setSessionSwitching(false);
}

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

/** 过滤链：hidden-models.json → enabled-models.json 白名单 → models.yml 用户配置（保持当前模型可见） */
function applyModelFilters(
  raw: TiffaModelInfo[],
  hidden: Set<string>,
  enabledModels: string[] | undefined,
  modelsConfigData: TiffaModelsConfig | null,
): TiffaModelInfo[] {
  const currentModel = useUiStore.getState().currentModel;
  let filtered = raw.filter((m) => !hidden.has(m.id));
  if (enabledModels) {
    const isCurrent = (m: TiffaModelInfo) => currentModel === m.id || currentModel === m.name;
    filtered = filtered.filter((m) => enabledModels.includes(`${m.provider}/${m.id}`) || isCurrent(m));
  } else if (modelsConfigData && modelsConfigData.providers) {
    const userModelIds = new Set<string>();
    for (const prov of Object.values(modelsConfigData.providers)) {
      if (prov.models) for (const m of prov.models) userModelIds.add(m.id);
    }
    if (userModelIds.size > 0) {
      filtered = filtered.filter((m) => userModelIds.has(m.id) || m.id === currentModel || m.name === currentModel);
    }
  }
  return filtered;
}

/** 完整加载一次模型列表（hidden/enabled/models.yml 过滤链 + 实例可用列表；未就绪时用 models.yml 兑底） */
async function loadModelListOnce(): Promise<TiffaModelInfo[] | null> {
  try {
    // hidden-models.json
    let hidden = new Set<string>();
    try {
      const root = (await window.tiffaDesktop.getRootPath()) as string;
      const res = (await window.tiffaDesktop.readFile(`${root}\\data\\agent\\hidden-models.json`)) as { content?: string } | undefined;
      if (res && res.content) {
        const arr = JSON.parse(res.content);
        if (Array.isArray(arr)) hidden = new Set(arr);
      }
    } catch {
      /* ignore */
    }
    // enabled-models.json 白名单（undefined = 未配置）
    let enabledModels: string[] | undefined;
    try {
      const root = (await window.tiffaDesktop.getRootPath()) as string;
      const res = (await window.tiffaDesktop.readFile(`${root}\\data\\agent\\enabled-models.json`)) as { content?: string } | undefined;
      if (res && res.content) {
        const arr = JSON.parse(res.content);
        if (Array.isArray(arr) && arr.length > 0) enabledModels = arr;
      }
    } catch {
      enabledModels = undefined;
    }
    // models.yml 用户配置
    let modelsConfigData: TiffaModelsConfig | null = null;
    try {
      const cfg = await window.tiffaDesktop.readModelsYml();
      if (cfg && !cfg.error && cfg.data) modelsConfigData = cfg.data;
    } catch {
      /* ignore */
    }

    // 引擎未就绪（实例未拉起）：用 models.yml 用户配置兑底列表（主进程 getModels 无实例会 throw）
    if (!useProcStore.getState().tiffaReady) {
      const fallback: TiffaModelInfo[] = [];
      if (modelsConfigData && modelsConfigData.providers) {
        for (const [provider, prov] of Object.entries(modelsConfigData.providers)) {
          if (prov && prov.models) {
            for (const m of prov.models) fallback.push({ id: m.id, name: m.name || m.id, provider });
          }
        }
      }
      return applyModelFilters(fallback, hidden, enabledModels, modelsConfigData);
    }
    const result = await window.tiffaDesktop.getModels(useSessionsStore.getState().activeSessionId);
    if (!result || !result.models) return [];
    return applyModelFilters(result.models, hidden, enabledModels, modelsConfigData);
  } catch {
    // 加载失败（瞬时错误）返回 null：不写缓存，下次调用自然重试
    return null;
  }
}

/** 死列表缓存读入口：命中缓存秒回；无缓存时发起一次加载（in-flight 去重，并发只发一次）。force=true 强制重载 */
export function getModelListCached(force = false): Promise<TiffaModelInfo[] | null> {
  if (!force && modelListCache) return Promise.resolve(modelListCache);
  if (modelListPromise) return modelListPromise;
  const seq = ++modelListSeq;
  modelListPromise = loadModelListOnce()
    .then((list) => {
      // 竞态：仅最新一次加载写缓存（force 重载会让旧 promise 过期）；
      // 失败（null）不写缓存，下次调用自然重试
      if (seq === modelListSeq && list !== null) modelListCache = list;
      return list;
    })
    .finally(() => {
      modelListPromise = null;
    });
  return modelListPromise;
}

/** 清空死列表缓存（配置写成功 / 实例重启后就绪时调用；下一次调用自然重载） */
export function invalidateModelListCache(): void {
  modelListCache = null;
}

/** 可用模型集合（死列表缓存派生）；未就绪时返回 null（不校验，直接下发） */
async function getAvailableModelSet(): Promise<Set<string> | null> {
  // 引擎未就绪（含崩溃后停止重启）不校验：主进程 handler 无实例会 throw，且兑底列表不完整
  if (!useProcStore.getState().tiffaReady) return null;
  const list = await getModelListCached();
  if (!list || list.length === 0) return null;
  const set = new Set<string>();
  for (const m of list) {
    if (m.provider && m.id) set.add(`${m.provider}/${m.id}`);
  }
  return set;
}

export async function fetchCurrentModel(): Promise<void> {
  // 引擎未就绪（含崩溃后停止重启）不调 getModels：主进程 handler 无实例会 throw
  if (!useProcStore.getState().tiffaReady) return;
  const sessionId = useSessionsStore.getState().activeSessionId;
  // 优先用内核真实当前模型（get_state.model），避免拿"可用列表第一个"当当前模型显示
  try {
    const st = await window.tiffaDesktop.getState(sessionId);
    const sm = (st as { model?: { id?: string; name?: string; provider?: string; thinking?: { mode?: string; efforts?: string[] } } } | null)?.model;
    if (sm && sm.id) {
      useUiStore.getState().setCurrentModel(sm.name || sm.id, sm.provider || '');
    }
    // 同步模型思考档位支持列表（内核实测 state.model.thinking.efforts，UI 据此过滤可选档位）
    const efforts = (sm && sm.thinking && Array.isArray(sm.thinking.efforts) ? sm.thinking.efforts : null) as ThinkingLevel[] | null;
    useUiStore.getState().setThinkingEfforts(efforts);
    const stLevel = (st as { thinkingLevel?: string } | null)?.thinkingLevel;
    if (stLevel && THINKING_LEVELS.includes(stLevel as ThinkingLevel)) {
      useUiStore.getState().setThinkingLevelState(stLevel as ThinkingLevel);
    }
  } catch {
    /* ignore */
  }
  // 兜底：get_state 没拿到模型时才用列表第一个（走死列表缓存，不再实时 getModels）
  try {
    const list = await getModelListCached();
    if (list && list.length > 0) {
      const cur = useUiStore.getState().currentModel;
      if (!cur || cur === '--' || cur === '[object Object]') {
        const first = list[0];
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

/** 恢复模型（校验可用性 + 竞态防护 + 超时保护） */
export async function restoreModelIfAvailable(
  provider: string,
  modelId: string,
  sessionId: string | null,
  expectedSessionPath: string,
): Promise<boolean> {
  if (sessionId) {
    // 同一实例只允许一次模型物化在途：switchToSession 后台恢复与 sendMessage 发送前
    // 物化并发时跳过重复 setModel，避免双 set_model 排队把发送流程拖死
    if (restoreModelInFlight.has(sessionId)) {
      dbgLog('model', `模型恢复已在途（${sessionId}），跳过重复物化`);
      return false;
    }
    restoreModelInFlight.add(sessionId);
  }
  try {
    // 可用列表校验本身也可能卡（实例冷启动/后台模型发现中）→ 10s 超时，超时视为
    // “未知”不校验直接下发（内核 set_model 自带可用性检查）
    const availableSet = await withTimeout(getAvailableModelSet(), 10000, 'getAvailableModelSet').catch(() => null);
    if (availableSet && !availableSet.has(`${provider}/${modelId}`)) {
      // 保存的模型标签可能已失效（models.json 重命名/删除/改配置，如 "Qwen3.X-直连" →
      // "Qwen3.X"）：直接跳过会把实例留在"无模型"状态，用户一发消息内核就崩——
      // 「切换对话后模型没正确拉起来」的根因。先做同 provider 归一化模糊兜底，
      // 匹配到就用匹配项恢复，并顺带修正会话记忆里的过期标签。
      const fallback = await resolveClosestModel(provider, modelId);
      if (fallback) {
        dbgLog('model', `模型 "${provider}/${modelId}" 不在可用列表，回退到 "${fallback.provider}/${fallback.modelId}"`);
        provider = fallback.provider;
        modelId = fallback.modelId;
        try {
          useSessionsStore.getState().setSessionModel(expectedSessionPath, provider, modelId);
        } catch {
          /* ignore */
        }
      } else {
        dbgLog('model', `模型 "${provider}/${modelId}" 不在可用列表中，跳过恢复`);
        return false;
      }
    }
    try {
      // 防御：实例当前已是目标模型时跳过 set_model。避免“切换会话时重复下发模型命令”
      // 触发内核重复切换模型（旧模型连接未释放 + 新模型进程 → 双模型同跑卡死）
      if (sessionId) {
        try {
          const st = (await withTimeout(
            window.tiffaDesktop.getState(sessionId) as Promise<unknown>,
            15000,
            'getState',
          )) as { model?: { id?: string; name?: string; provider?: string } } | null | undefined;
          const cur = st && st.model;
          if (cur && (cur.id === modelId || cur.name === modelId) && (cur.provider || '') === provider) {
            dbgLog('model', `实例已运行 ${provider}/${modelId}，跳过重复设置`);
            return true;
          }
        } catch {
          /* 拿不到当前模型状态则继续下发 */
        }
      }
      // set_model 等待内核响应（本地模型加载/后台模型发现可能很慢）→ 25s 超时兜底：
      // 超时不报错中断发送，模型切换继续在后台进行，下次发送前物化会再次校正
      await withTimeout(
        window.tiffaDesktop.setModel(provider, modelId, sessionId) as Promise<unknown>,
        25000,
        'setModel',
      );
      if (useSessionsStore.getState().activeSessionPath !== expectedSessionPath) return true;
      useUiStore.getState().setCurrentModel(modelId, provider);
      return true;
    } catch {
      return false;
    }
  } finally {
    if (sessionId) restoreModelInFlight.delete(sessionId);
  }
}

/** 精确模型标签失效时的兜底匹配：同 provider 下按归一化 id 找最近可用模型
 *  （去 直连/Direct 后缀、空白、点、下划线、连字符、大小写），找不到再放宽到任意 provider */
async function resolveClosestModel(
  provider: string,
  modelId: string,
): Promise<{ provider: string; modelId: string } | null> {
  try {
    const list = await withTimeout(getModelListCached(true), 10000, 'getModelListRefresh');
    if (!list || list.length === 0) return null;
    const norm = (s: string) =>
      s.toLowerCase().replace(/[\s_.-]+/g, '').replace(/直连|direct/g, '');
    const target = norm(modelId);
    if (!target) return null;
    const sameProvider = list.find((m) => m.provider === provider && m.id && norm(m.id) === target);
    if (sameProvider) return { provider, modelId: sameProvider.id };
    const anyProvider = list.find((m) => m.id && norm(m.id) === target);
    if (anyProvider) return { provider: anyProvider.provider, modelId: anyProvider.id };
    return null;
  } catch {
    return null;
  }
}

/** 切换模型（纯指针：只记忆每会话模型 + lastModel + UI；物化统一在发送路径 sendMessage 完成） */
export async function switchModel(provider: string, modelId: string): Promise<void> {
  const sessions = useSessionsStore.getState();
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
  // 切项目：停止全部会话的检测器（新项目的守卫从零开始）
  stopAllGuards();
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
  const newTabsToMigrate = Object.entries(sessions.activeTabMeta)
    .filter(([p, m]) => p.startsWith('__new__') && m.sessionId)
    .map(([path, m]) => ({ path, sessionId: m.sessionId as string, dirName: m.dirName || '', firstMessage: m.firstMessage || '' }));
  if (newTabsToMigrate.length === 0) return map;
  let instances: Array<{ sessionId?: string; cwd?: string; sessionFilePath?: string; prevSessionIds?: string[] }> = [];
  try {
    const insts = (await window.tiffaDesktop.getInstances()) as Array<{
      sessionId?: string;
      cwd?: string;
      sessionFilePath?: string;
      prevSessionIds?: string[];
    }> | undefined;
    instances = insts || [];
  } catch {
    /* ignore */
  }
  if (instances.length === 0) return map;
  // 磁盘会话列表按 tab 所属项目分别拉取：跨项目后 sessions.sessions 只含当前项目，
  // 旧项目的 __new__ 必须查旧项目的磁盘列表才能找到真实路径（否则永不迁移）。
  const diskCache: Record<string, Array<Record<string, unknown>>> = {};
  const diskForDir = async (dirName: string): Promise<Array<Record<string, unknown>>> => {
    if (diskCache[dirName]) return diskCache[dirName];
    let list: Array<Record<string, unknown>> = [];
    try {
      if (dirName === projects.activeProjectDirName && diskSessions) {
        list = Array.isArray(diskSessions) ? diskSessions : [];
      } else {
        const r = (await window.tiffaDesktop.listSessions(dirName)) as unknown;
        const rr = r as { error?: string; sessions?: unknown } | null | undefined;
        if (!rr || rr.error) {
          list = [];
        } else if (Array.isArray(r)) {
          list = r as Array<Record<string, unknown>>;
        } else if (Array.isArray(rr.sessions)) {
          list = rr.sessions as Array<Record<string, unknown>>;
        }
      }
    } catch {
      /* ignore */
    }
    diskCache[dirName] = list;
    return list;
  };
  for (const nt of newTabsToMigrate) {
    // 仅按 sessionId 精确匹配实例。曾有的兜底 find（cwd 匹配 + 有 sessionFilePath +
    // tab 未打开）会错配到任意后台实例（如 tab 被上限关闭但仍存活的旧会话），
    // 把 __new__ 会话迁移到别人的真实路径，模型记忆 sessionModelMap 随之串味。
    // prevSessionIds：主进程探测迁移（_probeSessionFile）后 sessionId 已是真实 id，
    // 但 tab meta 仍持临时 UUID——按迁移前的旧 id 也能命中同一实例。
    const inst = instances.find(
      (i) => i.sessionId === nt.sessionId || (i.prevSessionIds || []).includes(nt.sessionId),
    );
    if (inst && inst.sessionFilePath) {
      const disk = await diskForDir(nt.dirName);
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
    } else if (nt.firstMessage) {
      // 兜底：实例已退出或 sessionFilePath 缺失（无 session_switch 且探测未命中）——
      // 用 tab 的 firstMessage 在磁盘列表里精确匹配（重复发送同一句首条消息时
      // 会有多条命中，此时不迁移，避免错配）。
      const disk = await diskForDir(nt.dirName);
      const fm = String(nt.firstMessage).trim().toLowerCase();
      const matches = disk.filter(
        (rs) => rs.firstMessage && String(rs.firstMessage).trim().toLowerCase() === fm,
      );
      if (matches.length === 1) {
        const oldPath = nt.path;
        const newPath = String(matches[0].path);
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
  const chatBefore = useChatStore.getState();
  // 诊断：迁移前 oldPath/newPath 各自缓冲与缓存的指纹。若 oldPath(__new__) 已带旧会话 A
  // 的指纹，说明 __new__ 缓冲在迁移前就被污染（根因在 newSession→activateSession 之间的事件串味）；
  // 若 newPath 已带 A 指纹，说明 B 真实路径在迁移前就被写入（根因在 findSessionFile 碰撞或预载串味）。
  dbgLog('migrate', `迁移前 oldPath=${oldPath} ${msgFingerprint(chatBefore.messagesMap[oldPath])}`);
  dbgLog('migrate', `迁移前 newPath=${newPath} ${msgFingerprint(chatBefore.messagesMap[newPath])}`);
  dbgLog('migrate', `迁移前 newCache=${msgFingerprint(chatBefore.sessionMessageCache[newPath]?.messages)} newHistCache=${msgFingerprint(chatBefore.history[newPath]?.cache?.messages)}`);
  sessions.migrateTabPath(oldPath, newPath, realSessionId);
  useChatStore.getState().migrateChatKey(oldPath, newPath);
  renameProcKey(oldPath, newPath);
  const chatAfter = useChatStore.getState();
  dbgLog('migrate', `迁移后 newPath=${newPath} ${msgFingerprint(chatAfter.messagesMap[newPath])}`);
  // 迁移的是当前活跃 tab：迁移前 __new__ 显示的是内存快照（切走时的旧内容），
  // 后台回复已写盘但前台看不到——迁移后必须从磁盘重读最新尾部，否则仍显示旧内容。
  // agent 运行中且有流式时跳过（事件会追平，避免破坏 streaming.messageIndex）。
  if (useSessionsStore.getState().activeSessionPath === newPath) {
    const st = chatAfter.streaming[newPath];
    const hasLiveStream = !!(st && st.messageIndex >= 0);
    if (!hasLiveStream) {
      dbgLog('migrate', `迁移后重载历史 newPath=${newPath} active=true`);
      chatAfter.resetHistory(newPath);
      chatAfter.markCacheFresh(newPath, false);
      void loadAndRenderHistory(newPath).catch(() => {});
    }
  }
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
  if (sessions.activeSessionPath === sessionPath && (chat.messagesMap[sessionPath]?.length || 0) > 0) {
    // 切换中断残留：activeSessionId 与路径归属不一致（如 activeSessionId 已指向新会话而
    // 路径仍是旧的）→ 校正 activeSessionId，避免后续事件按错误归属写入当前视图。
    const pathSid =
      extractSessionId(sessionPath) ||
      (sessionPath.startsWith('__new__')
        ? sessions.activeTabMeta[sessionPath]?.sessionId || null
        : null);
    if (!pathSid || !sessions.activeSessionId || pathSid !== sessions.activeSessionId) {
      useSessionsStore.setState({ activeSessionId: pathSid || sessionPath });
    }
    return;
  }

  // 准备阶段锁：活跃 tab 是未迁移 __new__ 时禁止切走
  if (sessions.preparingNewSessions[sessions.activeSessionPath || ''] && !sessions.preparingNewSessions[sessionPath]) {
    ui.addToast('info', '新对话正在准备中，请稍候…');
    return;
  }
  // 防抖 300ms
  const now = Date.now();
  if (now - lastSwitchTime < 300) return;
  lastSwitchTime = now;
  // 序号锁：sessionSwitching 只用于锁输入/模型（不吞 tab 点击）——
  // 实例准备慢（spawn/上下文恢复可达数秒~30s）时用户仍可点其他 tab，
  // 旧流程在各 await 返回后经 seq 检查自动放弃，避免"切换半天点不过去"。
  const seq = ++switchSeq;
  ui.setSessionSwitching(true);

  // 后台 __new__ tab 先兜底迁移
  if (sessionPath.startsWith('__new__')) {
    const migrationMap = await migrateStuckNewTabs();
    if (migrationMap[sessionPath]) sessionPath = migrationMap[sessionPath];
    if (seq !== switchSeq) return;
  }

  // 跨项目切换：先切项目上下文
  const targetDir = dirNameFromSessionPath(sessionPath);
  if (targetDir && targetDir !== projects.activeProjectDirName) {
    await selectProject(targetDir);
    if (seq !== switchSeq) return;
  }

  const oldSessionPath = sessions.activeSessionPath;
  // 丢弃未发送的排队消息
  ui.setPendingQueueMessage(null);

  // 保存旧会话 agentRunning（不 abort 旧实例：多实例并行）
  if (oldSessionPath) {
    proc.setSessionRunning(oldSessionPath, !!proc.procStateMap[oldSessionPath]?.agentRunning);
  }
  // 只停旧会话的检测器：并行会话的卡住/首响检测不受切换影响
  stopStallCheck(oldSessionPath);
  stopFirstResponseCheck(oldSessionPath);

  // 缓存旧会话消息快照
  if (oldSessionPath) {
    const msgs = chat.messagesMap[oldSessionPath];
    if (msgs && msgs.length > 0) {
      chat.cacheSnapshot(oldSessionPath, 0);
    }
  }

  // 切换被更新的点击覆盖（await 期间用户点了其他 tab）→ 放弃，不再设置 activeSessionPath
  if (seq !== switchSeq) return;
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
    // 优先 tab meta：跨项目后 sessions.sessions 只含当前项目，旧项目的 __new__
    // 对象已不在列表里，但 tab meta 仍保留临时 sessionId——用它才能命中旧实例，
    // 否则 activeSessionId 退化成路径字符串，发送时会 spawn 全新实例丢失上下文。
    const tabMeta = sessions.activeTabMeta[sessionPath];
    targetSessionId = (tabMeta && tabMeta.sessionId) || (sessions.sessions.find((s) => s.path === sessionPath)?.sessionId) || null;
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
        // 指针模式：不 await 激活（点击 tab 轻量），后台查询实例就绪态（isReady 不创建实例）；
        // 未就绪时输入/模型保持可用，点发送时由 sendMessage 兜底拉起。
        void window.tiffaDesktop.isReady(targetSessionId).then(async (ready) => {
          if (useSessionsStore.getState().activeSessionId !== targetSessionId) return;
          proc.setReady(ready);
          if (ready) {
            const saved = useSessionsStore.getState().sessionModelMap[sessionPath];
            if (saved && saved.provider && saved.modelId) {
              try {
                await restoreModelIfAvailable(saved.provider, saved.modelId, targetSessionId, sessionPath);
              } catch {
                /* ignore */
              }
            } else {
              try {
                await restoreLastModelIfNeeded();
              } catch {
                /* ignore */
              }
            }
          } else {
            // 未就绪：清掉上一会话的模型残留（防串数据），拉起后恢复
            ui.setCurrentModel('--', '');
          }
        }).catch(() => {});
      }
      unlockSwitchIfLatest(seq);
      restoreTodoPhases();
      return;
    }

    // 内容渲染：优先用内存快照立即显示（点击 tab 秒开），陈旧快照后台以 JSONL 为准校正。
    // 只有 agent 运行中或 agent_end flush 过（新鲜）时快照才是最新的；
    // 快照缺失/陈旧时从 JSONL 重新读取最新窗口（复用 messagesMap 里可能过期的旧快照
    // 会导致 agent 在后台已把新内容写盘后，切回来仍显示旧尾部——「尾部消失」根因）。
    const cacheFresh = chat.sessionCacheFresh[sessionPath];
    const cached = chat.sessionMessageCache[sessionPath];
    const st = chat.streaming[sessionPath];
    const hasLiveStream = !!(st && st.messageIndex >= 0);
    if (hasLiveStream) {
      // 会话正在流式：messagesMap 已有实时累积内容（后台会话的流式事件也实时写入——
      // eventRouter 已放行后台 message_start/update/end）。此时快照（sessionMessageCache）
      // 可能陈旧：用 setMessages 覆盖 messagesMap 会截断 streaming.messageIndex，
      // 导致后续 text_delta/finalizeAssistant 因消息索引越界全部丢帧——
      // 「切回后台会话内容卡住/只在工具调用或思考结束时跳变」的根因之一。
      // 保持实时内容不覆盖、不重读历史，让流式事件继续追平。
    } else if (cached && cached.messages.length > 0) {
      chat.setMessages(sessionPath, cached.messages);
      // 快照陈旧（未 flush）：立即显示后后台刷新校正。
      // agent 运行中且有流式消息时跳过刷新——流式事件会追平，而刷新替换消息数组会
      // 破坏 streaming.messageIndex 导致输出丢失；agentRunning 残留（后台 agent_end
      // 丢失：tab 被关/LRU 淘汰）或卡住无流式时刷新——从 JSONL 重读最新尾部，
      // 修「切回对话后尾部不见、重启后才可见」。
      if (!cacheFresh) {
        // 先重置历史游标再重读：切走期间若生成了新消息，带旧 cursor 增量读取
        // （skip=cursor）只会返回新增的几条并覆盖整个界面——表现为切回后
        // 「尾部消息消失/从中间截断」。重置后从尾部全量重读 200 条。
        chat.resetHistory(sessionPath);
        void loadAndRenderHistory(sessionPath).catch(() => {});
      }
    } else {
      // 重置历史游标，强制从 JSONL 尾部重新读取（不带上次 skip，以免游标错位返回空/丢尾部）
      chat.resetHistory(sessionPath);
      chat.setMessages(sessionPath, []);
      await loadAndRenderHistory(sessionPath);
    }
    if (seq !== switchSeq) return;
  } catch (err) {
    ui.addToast('error', `切换对话失败: ${(err as Error).message}`);
  }

  // 恢复目标会话 agentRunning
  const agentRunning = !!proc.procStateMap[sessionPath]?.agentRunning;
  if (agentRunning) {
    proc.setSessionRunning(sessionPath, true);
    startStallCheck(sessionPath);
    ui.setStatusText('运行中...');
  } else {
    ui.setStatusText('就绪');
  }

  // 指针模式（参考 dim）：点击 tab 只换显示指针 + 渲染历史，不拉实例（spawn/上下文恢复 4~32s 太重）。
  // 后台轻量查询实例就绪态（isReady 不创建实例）；活动对话（LRU 保活中）点击即可发送，
  // 不活动对话保持可打字/可选模型，点发送时才由 sendMessage 兜底拉起实例。
  if (targetSessionId) {
    void window.tiffaDesktop.isReady(targetSessionId).then(async (ready) => {
      // 无论是否仍为活跃会话：记录该会话实例就绪态（对话树圆点显示依据）
      proc.setSessionReady(sessionPath, ready);
      if (useSessionsStore.getState().activeSessionId !== targetSessionId) return;
      proc.setReady(ready);
      if (ready) {
        const saved = useSessionsStore.getState().sessionModelMap[sessionPath];
        if (saved && saved.provider && saved.modelId) {
          try {
            await restoreModelIfAvailable(saved.provider, saved.modelId, targetSessionId, sessionPath);
          } catch {
            /* ignore */
          }
        } else {
          try {
            await restoreLastModelIfNeeded();
          } catch {
            /* ignore */
          }
        }
      } else {
        // 未就绪：清掉上一会话的模型残留（防串数据），拉起后恢复
        ui.setCurrentModel('--', '');
      }
    }).catch(() => {});
  }
  sessions.saveOpenTabs();
  unlockSwitchIfLatest(seq);
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

  // 指针模式（参考 dim）：点发送才拉实例（acquire 语义）。
  // 已有实例时本调用是轻量激活（刷新 LRU + 返回 ready，幂等无副作用）；
  // 无实例时在这里完成 spawn/上下文恢复（4~32s），期间由 pendingActivation 锁住发送按钮。
  if (sessions.activeSessionId) {
    ui.setPendingActivation({ cwd: projects.workspacePath || '', sessionId: sessions.activeSessionId, path: sessions.activeSessionPath || '' });
    ui.setStatusText('正在连接引擎…');
    try {
      const result = (await window.tiffaDesktop.activateSession(projects.workspacePath || '', sessions.activeSessionId)) as { error?: string; ready?: boolean } | undefined;
      if (result && result.error) {
        ui.addToast('error', `连接引擎失败: ${result.error}`);
        ui.setStatusText('未就绪');
        return;
      }
      proc.setReady(!result || result.ready !== false);
      // 发送前物化：读每会话指针 → 实例当前模型 ≠ 指针时 set_model（校验走死列表缓存，秒）
      const st = useSessionsStore.getState();
      const saved = st.activeSessionPath ? st.sessionModelMap[st.activeSessionPath] : null;
      if (saved && saved.provider && saved.modelId) {
        useUiStore.setState({ modelSwitching: true });
        ui.setStatusText('正在加载模型…');
        try {
          await restoreModelIfAvailable(saved.provider, saved.modelId, st.activeSessionId, st.activeSessionPath || '');
        } catch {
          /* ignore */
        } finally {
          useUiStore.setState({ modelSwitching: false });
          ui.setStatusText('就绪');
        }
      } else {
        try {
          await restoreLastModelIfNeeded();
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      ui.addToast('error', `连接引擎失败: ${(err as Error).message}`);
      ui.setStatusText('未就绪');
      return;
    } finally {
      ui.setPendingActivation(null);
    }
    // 等待期间用户切换了会话：放弃发送（实例已拉起但归属旧会话）
    if (useSessionsStore.getState().activeSessionId !== sessions.activeSessionId) {
      ui.setStatusText('就绪');
      return;
    }
    ui.setStatusText('就绪');
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
  startStallCheck(activePath);
  startFirstResponseCheck(activePath);
  ui.setStatusText('思考中...');
  try {
    await window.tiffaDesktop.send(message, sendImages, useSessionsStore.getState().activeSessionId);
  } catch (err) {
    ui.addToast('error', `发送失败: ${(err as Error).message}`);
    proc.setSessionRunning(activePath, false);
    proc.setInstanceRunning(projects.workspacePath, false);
    stopStallCheck(activePath);
    stopFirstResponseCheck(activePath);
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
    // 内容过短类不是错误：info 级中文提示（“对话内容较短，无需压缩”）
    const loc = localizeKernelMessage(compactError);
    if (loc.isTooShort) {
      ui.addToast('info', loc.text);
      return;
    }
    if (loc.text !== compactError) {
      ui.setStatusText('压缩失败');
      ui.addToast(loc.level || 'error', loc.text);
      return;
    }
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
  // 压缩成功后：完全重置该会话的加载状态再全量重读——
  // ① 清 DOM 缓存与新鲜标记（旧内容快照）
  // ② resetHistory 清掉 history.cache（启动预载的压缩前数据！）与增量游标——
  //    否则 loadAndRenderHistory 会命中压缩前的旧缓存/旧游标，显示压缩前内容（“尾巴丢了”）
  // ③ 清空消息再全量加载压缩后的 JSONL
  if (path && !path.startsWith('__new__')) {
    chat.markCacheFresh(path, false);
    useChatStore.setState((s) => {
      const sessionMessageCache = { ...s.sessionMessageCache };
      const sessionCacheFresh = { ...s.sessionCacheFresh };
      delete sessionMessageCache[path];
      delete sessionCacheFresh[path];
      return { sessionMessageCache, sessionCacheFresh };
    });
    chat.resetHistory(path);
    chat.setMessages(path, []);
    try {
      await loadAndRenderHistory(path);
    } catch {
      /* ignore */
    }
  }
}

// ── 思考档位（内核 set_thinking_level / cycle_thinking_level，与 oh-my-pi UI 同协议）──

/** 合法档位列表（思考档位校验用） */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** 会话激活语义（指针模式）：档位命令前先确保实例在线（未就绪时轻量拉起），返回是否就绪 */
async function ensureOnlineForCommand(): Promise<boolean> {
  const sessions = useSessionsStore.getState();
  const projects = useProjectsStore.getState();
  const proc = useProcStore.getState();
  if (proc.tiffaReady && sessions.activeSessionId) return true;
  if (!sessions.activeSessionId || !projects.workspacePath) return false;
  try {
    const result = (await window.tiffaDesktop.activateSession(projects.workspacePath, sessions.activeSessionId)) as { error?: string; ready?: boolean } | undefined;
    if (result && result.error) return false;
    proc.setReady(!result || result.ready !== false);
    return true;
  } catch {
    return false;
  }
}

/** 设置当前会话思考档位（off=关闭思考；minimal~max=推理深度） */
export async function sendThinkingLevel(level: ThinkingLevel): Promise<void> {
  if (!THINKING_LEVELS.includes(level)) return;
  const ok = await ensureOnlineForCommand();
  if (!ok) {
    useUiStore.getState().addToast('warning', '引擎未就绪，无法切换思考档位');
    return;
  }
  try {
    await window.tiffaDesktop.command('set_thinking_level', { level }, useSessionsStore.getState().activeSessionId);
    useUiStore.getState().setThinkingLevelState(level);
  } catch (err) {
    useUiStore.getState().addToast('error', `切换思考档位失败: ${(err as Error).message}`);
  }
}

/** 循环切换思考档位（Ctrl+T；依次遍历合法档位，跳过当前模型不支持的） */
export async function cycleThinkingLevel(): Promise<void> {
  const ui = useUiStore.getState();
  const efforts = ui.thinkingEfforts;
  const pool = efforts && efforts.length > 0 ? (THINKING_LEVELS as readonly string[]).filter((l) => efforts.includes(l as ThinkingLevel)) : THINKING_LEVELS;
  if (pool.length === 0) return;
  const cur = ui.thinkingLevel;
  const idx = cur ? pool.indexOf(cur) : -1;
  const next = (pool[(idx + 1) % pool.length]) as ThinkingLevel;
  await sendThinkingLevel(next);
}

// ── 手动压缩 ──

export async function abortMessage(): Promise<void> {
  const ui = useUiStore.getState();
  const proc = useProcStore.getState();
  const chat = useChatStore.getState();
  const sid = useSessionsStore.getState().activeSessionId;
  const abortPath = useSessionsStore.getState().activeSessionPath;
  try {
    await window.tiffaDesktop.abort(sid);
  } catch {
    /* ignore */
  }
  stopStallCheck(abortPath);
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
