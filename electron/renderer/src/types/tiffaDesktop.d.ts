/**
 * Tiffa Renderer 全局类型：window.tiffaDesktop（preload.js IPC 契约，只读消费）
 *
 * ⚠️ 契约冻结：签名全部来自 electron/preload.js，不得修改。
 */

/** 主进程事件帧（preload onEvent 回调收到），统一带会话归属标记 */
export interface TiffaEventFrame {
  type: string;
  /** 消息流内事件：thinking_start/thinking/thinking_end/text/toolcall_start/toolcall_end */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  /** 事件归属：会话 cwd / sessionId / 稳定会话文件路径（session_switch 后才有值） */
  _cwd?: string;
  _sessionId?: string;
  _sessionPath?: string | null;
}

export interface TiffaModelInfo {
  id: string;
  name?: string;
  provider?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
  supportsTools?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface TiffaSessionSummary {
  path: string;
  title?: string;
  firstMessage?: string;
  messageCount?: number;
  sessionId?: string;
  lastActiveAt?: number;
  archived?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface TiffaProjectSummary {
  dirName: string;
  path?: string;
  title?: string;
  lastActiveAt?: number;
  sessionCount?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface TiffaHistoryPage {
  messages: TiffaHistoryMessage[];
  hasMore: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

/** 历史 JSONL 消息的通用形态（主进程 loadSessionHistory 返回） */
export interface TiffaHistoryMessage {
  id?: string;
  role?: string;
  type?: string;
  content?: unknown;
  message?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface TiffaInstanceInfo {
  key: string;
  cwd: string;
  sessionId: string | null;
  ready: boolean;
  agentRunning: boolean;
  pid?: number;
  sessionFilePath?: string | null;
  pendingCommands?: number;
  pendingAskIds?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface TiffaDiagnosticsResult {
  instances?: TiffaInstanceInfo[];
  activeKey?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

/** 模型供应商配置（models.yml 解析结果） */
export interface TiffaModelsConfig {
  providers?: Record<string, TiffaProviderConfig>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface TiffaProviderConfig {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  auth?: string;
  name?: string;
  models?: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    /** Qwen3.8+ 思考深度档位（设置面板勾选后落盘 compat：thinkingFormat + qwenTemplateReasoningEffort） */
    qwen38?: boolean;
    compat?: { thinkingFormat?: string; qwenTemplateReasoningEffort?: boolean };
    input?: string[];
    supportsTools?: boolean;
    contextWindow?: number;
    maxTokens?: number;
    cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [k: string]: any;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface TiffaBypassModelConfig {
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  enabled?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface TiffaDesktopApi {
  // ── Tiffa 代理命令 ──
  send: (message: string, images: unknown[] | undefined, sessionId: string | null) => Promise<unknown>;
  abort: (sessionId: string | null) => Promise<unknown>;
  setModel: (provider: string, modelId: string, sessionId: string | null) => Promise<unknown>;
  getModels: (sessionId: string | null) => Promise<{ models?: TiffaModelInfo[]; error?: string } | undefined>;
  getState: (sessionId: string | null) => Promise<unknown>;
  isReady: (sessionId: string | null) => Promise<boolean>;
  diagnostics: () => Promise<TiffaDiagnosticsResult | undefined>;
  steer: (message: string, sessionId: string | null) => Promise<unknown>;
  followUp: (message: string, sessionId: string | null) => Promise<unknown>;
  extensionResponse: (id: string, value: unknown, sessionId: string | null) => Promise<unknown>;
  rendererLog: (tag: string, msg: string) => void;
  compact: (sessionId: string | null) => Promise<unknown>;
  command: (type: string, payload: unknown, sessionId: string | null) => Promise<unknown>;

  // ── 事件监听 ──
  onEvent: (callback: (data: TiffaEventFrame) => void) => void;
  onExited: (callback: (data: unknown) => void) => void;

  // ── 文件系统 ──
  listDir: (dirPath: string) => Promise<unknown>;
  readFile: (filePath: string) => Promise<{ content?: string; error?: string } | undefined>;
  writeFile: (filePath: string, content: string) => Promise<unknown>;
  readImage: (filePath: string) => Promise<unknown>;
  // 自定义启动页图片（<PORTABLE_ROOT>/data/startup-image.*，主进程已复制到 dist/assets），无则 null
  getStartupImage: () => Promise<{ url: string } | null>;
  fetchProviderModels: (baseUrl: string, apiKey: string) => Promise<{ models?: Array<{ id: string; name?: string; reasoning?: boolean }>; error?: string } | undefined>;

  // ── 外部调用 ──
  openExternal: (url: string) => Promise<unknown>;
  openPath: (filePath: string) => Promise<unknown>;
  showItemInFolder: (filePath: string) => Promise<unknown>;

  // ── 路径工具 ──
  getWorkspacePath: () => Promise<string>;
  getRootPath: () => Promise<string>;

  // ── 会话/项目管理 ──
  listProjects: () => Promise<TiffaProjectSummary[]>;
  listSessions: (projectDirName: string) => Promise<TiffaSessionSummary[]>;
  switchSession: (sessionPath: string) => Promise<unknown>;
  newSession: () => Promise<unknown>;
  loadSessionHistory: (sessionPath: string, opts: { tail?: number; skip?: number }) => Promise<TiffaHistoryPage | undefined>;
  archiveProject: (dirName: string, cwd: string) => Promise<unknown>;
  deleteProject: (dirName: string, cwd: string) => Promise<unknown>;
  listArchivedProjects: () => Promise<TiffaProjectSummary[]>;
  restoreProject: (dirName: string) => Promise<unknown>;
  archiveSession: (sessionPath: string) => Promise<unknown>;
  deleteSession: (sessionPath: string) => Promise<unknown>;
  renameSession: (sessionPath: string, newTitle: string) => Promise<unknown>;
  restoreSession: (sessionPath: string) => Promise<unknown>;
  deleteArchivedSession: (sessionPath: string) => Promise<unknown>;
  listArchivedSessions: (projectDirName: string) => Promise<TiffaSessionSummary[]>;
  getUserEntries: (sessionPath: string) => Promise<unknown>;
  exportSessionHtml: (sessionPath: string) => Promise<unknown>;
  completeWithLightModel: (prompt: string, maxTokens: number, providerHint?: string | null, modelHint?: string | null) => Promise<unknown>;

  // ── 记忆 ──
  recallMemory: (query: string) => Promise<unknown>;
  getIdentity: () => Promise<{ aiName?: string; userName?: string; gender?: string; persona?: string; needsSetup?: boolean } | undefined>;
  saveIdentity: (aiName: string, userName: string, gender?: string, persona?: string) => Promise<unknown>;

  // ── 已移除工作区 ──
  getRemovedCwds: () => Promise<string[]>;
  addRemovedCwd: (cwd: string) => Promise<unknown>;
  removeRemovedCwd: (cwd: string) => Promise<unknown>;

  // ── 模型配置 ──
  readModelsYml: () => Promise<{ data?: TiffaModelsConfig; error?: string } | undefined>;
  writeModelsYml: (content: string) => Promise<{ success?: boolean; error?: string } | undefined>;
  restartTiffa: () => Promise<{ success?: boolean; error?: string } | undefined>;
  writeTiffaProvider: (providerId: string, cfg: TiffaProviderConfig) => Promise<{ error?: string; success?: boolean } | undefined>;
  deleteTiffaProvider: (providerId: string) => Promise<{ error?: string; success?: boolean } | undefined>;

  // ── 配置写入 ──
  writeApprovalMode: (tiffaMode: string) => Promise<{ success?: boolean; error?: string } | undefined>;

  // ── 工作区/项目管理 ──
  openFolderDialog: () => Promise<unknown>;
  changeWorkspace: (newCwd: string) => Promise<unknown>;

  // ── 多实例管理 ──
  activateInstance: (cwd: string) => Promise<unknown>;
  activateSession: (cwd: string, sessionId: string) => Promise<unknown>;
  closeSession: (cwd: string, sessionId: string) => Promise<unknown>;
  getInstances: () => Promise<Array<{ cwd: string; sessionId?: string | null; ready?: boolean }>>;

  // ── XML 翻译 / Computer Use 开关 ──
  getXmlTranslationStatus: () => Promise<{ enabled?: boolean } | undefined>;
  toggleXmlTranslation: (enabled: boolean) => Promise<unknown>;
  getComputerUseStatus: () => Promise<{ enabled?: boolean } | undefined>;
  toggleComputerUse: (enabled: boolean) => Promise<unknown>;
  // ── Playwright（浏览器自动化 MCP）开关 ──
  getPlaywrightStatus: () => Promise<{ enabled?: boolean } | undefined>;
  togglePlaywright: (enabled: boolean) => Promise<unknown>;
  // ── Computer Use v4：每应用策略 + 窗口快照 ──
  getComputerUsePolicies: () => Promise<{ default: string; apps: Record<string, string>; popup_ignore: string[] }>;
  setComputerUsePolicies: (cfg: unknown) => Promise<{ ok: boolean; error?: string }>;
  getWindowSnapshotHotkey: () => Promise<{ enabled: boolean; hotkey: string }>;
  setWindowSnapshotHotkey: (cfg: unknown) => Promise<{ ok: boolean; error?: string }>;
  reloadWindowSnapshotHotkey: () => Promise<{ ok: boolean }>;
  onWindowSnapshot: (cb: (p: { data: string; mimeType: string; title: string }) => void) => () => void;
  onWindowSnapshotError: (cb: (p: { error: string }) => void) => () => void;

  // ── 旁路模型 / MCP 模型配置 ──
  getBypassModel: () => Promise<TiffaBypassModelConfig | undefined>;
  saveBypassModel: (cfg: TiffaBypassModelConfig) => Promise<unknown>;
  getGroundingModel: () => Promise<TiffaBypassModelConfig | undefined>;
  saveGroundingModel: (cfg: TiffaBypassModelConfig) => Promise<unknown>;
  checkModelHealth: (arg: unknown) => Promise<unknown>;

  // ── 渲染库 ──
  marked: (src: string) => string;
  markedNoHighlight: (src: string) => string;
  hljs: {
    highlight: (code: string, opts: { language?: string }) => { value: string };
    highlightAuto: (code: string) => { value: string };
    getLanguage: (lang: string) => unknown;
  };

  // ── 剪贴板 / 文件路径 ──
  clipboardWriteText: (text: string) => void;
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    tiffaDesktop: TiffaDesktopApi;
  }
}

export {};
