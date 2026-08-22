/**
 * useUiStore — UI 域（ask 队列 / 模型选择 / 审批模式 / 身份 / 状态栏 / 开关）
 *
 * 对应 app.js state 中：uiQueue / currentModel / currentProvider / pendingQueueMessage /
 * pendingSteerMarker / pendingFollowUpMarker / approvalMode / aiName / userName /
 * todoPhases / sessionSwitching / pendingActivation / modelSwitching / statusText /
 * recallMode / xmlTranslationEnabled / computerUseEnabled / fileViewMode。
 */
import { create } from 'zustand';
import type { TiffaEventFrame } from '../types/tiffaDesktop';
import { cwdKey, lsGet, lsSet } from '../services/utils';

export type ApprovalMode = 'auto' | 'yolo' | 'normal';

/** 思考档位（内核协议 set_thinking_level，与 oh-my-pi UI 一致） */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AskItem extends TiffaEventFrame {
  id: string;
  method: string;
  title?: string;
  prefill?: string;
  options?: string[];
  _sessionId?: string;
  _sessionPath?: string;
}

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface PendingActivation {
  cwd: string;
  sessionId: string;
  path: string;
}

export interface UiState {
  /** 全局 ask 队列（按 id 去重，插入序=展示序，队列头常显） */
  uiQueue: AskItem[];
  currentModel: string;
  currentProvider: string;
  /** 生成中排队消息：agent 结束后自动发送 */
  pendingQueueMessage: string | null;
  /** 排队消息编辑中（textarea 可编辑待发送文本） */
  isEditingQueue: boolean;
  pendingSteerMarker: boolean;
  pendingFollowUpMarker: boolean;
  /** Per-workspace approval mode */
  approvalMode: ApprovalMode;
  /** 审批模式切换触发的有计划重启中：抑制 handleExited 误报"已断开" */
  approvalModeRestarting: boolean;
  aiName: string;
  userName: string;
  gender: string;
  persona: string;
  todoPhases: unknown[];
  sessionSwitching: boolean;
  pendingActivation: PendingActivation | null;
  modelSwitching: boolean;
  statusText: string;
  toasts: Toast[];
  recallMode: boolean;
  xmlTranslationEnabled: boolean;
  computerUseEnabled: boolean;
  fileViewMode: string;
  /** 右侧栏是否展开（btnFiles 控制） */
  sidebarOpen: boolean;
  /** 设置面板是否打开（左下角齿轮控制） */
  settingsOpen: boolean;
  /** 首次启动 onboarding 标记：身份不全（缺 AI 名字/用户称呼）时自动打开「设置 AI 身份」弹窗（identity.ts Phase 3） */
  identitySetupPending: boolean;
  /** 正在 AI 重命名的 session（非 null 时抑制渲染） */
  aiRenameSession: unknown;
  /** 当前会话思考档位（null=未设置，跟随内核/模型默认）；由 thinking_level_changed 事件驱动 */
  thinkingLevel: ThinkingLevel | null;
  /** 当前模型实际支持的档位（内核 state.model.thinking.efforts；null=未知不过滤） */
  thinkingEfforts: ThinkingLevel[] | null;

  // ── actions ──
  enqueueAsk: (req: AskItem) => void;
  dequeueAsk: (id: string) => void;
  setCurrentModel: (model: string, provider?: string) => void;
  setPendingQueueMessage: (v: string | null) => void;
  setIsEditingQueue: (v: boolean) => void;
  setPendingSteerMarker: (v: boolean) => void;
  setPendingFollowUpMarker: (v: boolean) => void;
  setApprovalMode: (v: ApprovalMode) => void;
  setApprovalModeRestarting: (v: boolean) => void;
  loadApprovalMode: (workspacePath: string | null) => void;
  setAiName: (v: string) => void;
  setUserName: (v: string) => void;
  setGender: (v: string) => void;
  setPersona: (v: string) => void;
  setTodoPhases: (v: unknown[]) => void;
  setSessionSwitching: (v: boolean) => void;
  setPendingActivation: (v: PendingActivation | null) => void;
  setModelSwitching: (v: boolean) => void;
  setStatusText: (v: string) => void;
  addToast: (level: Toast['level'], message: string) => void;
  removeToast: (id: number) => void;
  setRecallMode: (v: boolean) => void;
  setXmlTranslationEnabled: (v: boolean) => void;
  setComputerUseEnabled: (v: boolean) => void;
  setFileViewMode: (v: string) => void;
  setAiRenameSession: (v: unknown) => void;
  setThinkingLevelState: (v: ThinkingLevel | null) => void;
  setThinkingEfforts: (v: ThinkingLevel[] | null) => void;
  toggleSidebar: () => void;
  toggleSettings: () => void;
  openIdentitySetup: () => void;
  clearIdentitySetup: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  uiQueue: [],
  currentModel: '',
  currentProvider: '',
  pendingQueueMessage: null,
  isEditingQueue: false,
  pendingSteerMarker: false,
  pendingFollowUpMarker: false,
  approvalMode: 'yolo',
  approvalModeRestarting: false,
  aiName: '助手',
  userName: '',
  gender: '',
  persona: '',
  todoPhases: [],
  sessionSwitching: false,
  pendingActivation: null,
  modelSwitching: false,
  statusText: '',
  toasts: [],
  recallMode: false,
  xmlTranslationEnabled: false,
  computerUseEnabled: false,
  fileViewMode: 'tree',
  sidebarOpen: false,
  settingsOpen: false,
  identitySetupPending: false,
  aiRenameSession: null,
  thinkingLevel: null,
  thinkingEfforts: null,

  enqueueAsk: (req) => {
    const s = get();
    if (!req || !req.id) return;
    if (s.uiQueue.some((q) => q.id === req.id)) return;
    set({ uiQueue: [...s.uiQueue, req] });
  },

  dequeueAsk: (id) => {
    const s = get();
    const uiQueue = s.uiQueue.filter((q) => q.id !== id);
    if (uiQueue.length !== s.uiQueue.length) set({ uiQueue });
  },

  setCurrentModel: (model, provider) =>
    set((s) => ({
      currentModel: model,
      currentProvider: provider !== undefined ? provider : s.currentProvider,
    })),

  setPendingQueueMessage: (v) => set({ pendingQueueMessage: v }),
  setIsEditingQueue: (v) => set({ isEditingQueue: v }),
  setPendingSteerMarker: (v) => set({ pendingSteerMarker: v }),
  setPendingFollowUpMarker: (v) => set({ pendingFollowUpMarker: v }),
  setApprovalMode: (v) => set({ approvalMode: v }),
  setApprovalModeRestarting: (v) => set({ approvalModeRestarting: v }),

  /** 按 cwdKey 持久化恢复审批模式 */
  loadApprovalMode: (workspacePath) => {
    const key = workspacePath ? `tiffa-approvalMode-${cwdKey(workspacePath)}` : null;
    const stored = key ? lsGet(key) : lsGet('tiffa-approvalMode-default');
    if (stored === 'auto' || stored === 'yolo' || stored === 'normal') {
      set({ approvalMode: stored });
    }
  },

  setAiName: (v) => set({ aiName: v }),
  setUserName: (v) => set({ userName: v }),
  setGender: (v) => set({ gender: v }),
  setPersona: (v) => set({ persona: v }),
  setTodoPhases: (v) => set({ todoPhases: v }),
  setSessionSwitching: (v) => set({ sessionSwitching: v }),
  setPendingActivation: (v) => set({ pendingActivation: v }),
  setModelSwitching: (v) => set({ modelSwitching: v }),
  setStatusText: (v) => set({ statusText: v }),

  addToast: (level, message) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, level, message }] }));
    setTimeout(() => get().removeToast(id), 6000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setRecallMode: (v) => set({ recallMode: v }),
  setXmlTranslationEnabled: (v) => set({ xmlTranslationEnabled: v }),
  setComputerUseEnabled: (v) => set({ computerUseEnabled: v }),
  setFileViewMode: (v) => {
    lsSet('tiffa-fileViewMode', v);
    set({ fileViewMode: v });
  },
  setAiRenameSession: (v) => set({ aiRenameSession: v }),
  setThinkingLevelState: (v) => set({ thinkingLevel: v }),
  setThinkingEfforts: (v) => set({ thinkingEfforts: v }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  openIdentitySetup: () => set({ settingsOpen: true, identitySetupPending: true }),
  clearIdentitySetup: () => set({ identitySetupPending: false }),
}));

/** 某会话是否有未应答 ask（tab/树徽标用），key 可以是 sessionId 或 sessionPath */
export function hasPendingAsk(key: string | null | undefined): boolean {
  if (!key) return false;
  const { uiQueue } = useUiStore.getState();
  return uiQueue.some((q) => {
    const qPath = q._sessionPath || '';
    const qSid = q._sessionId || '';
    return qSid === key || qPath === key;
  });
}

/** 队列头来源会话标注：非当前会话的 ask 加【来自「会话名」】 */
export function sessionTagOf(event: AskItem): string {
  const sp = event._sessionPath;
  if (!sp) return '';
  // 由调用方注入当前活跃路径（避免 store 间循环依赖）
  return sp;
}
