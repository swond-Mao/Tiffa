/**
 * Tiffa - Renderer Application v1.4
 * 
 * Layout: Left project panel + Top session tabs + Chat + File sidebar
 */

// ── 旧 localStorage key 迁移（omp → tiffa） ──
(function migrateOldLsKeys() {
  const oldNew = [
    ['omp-approvalMode-default', 'tiffa-approvalMode-default'],
    ['omp-lastModel', 'tiffa-lastModel'],
  ]
  // per-cwd approvalMode keys 需要遍历
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('omp-approvalMode-') && !key.endsWith('-default')) {
      const newKey = key.replace('omp-approvalMode-', 'tiffa-approvalMode-')
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(key))
        localStorage.removeItem(key)
      }
    }
  }
  for (const [oldKey, newKey] of oldNew) {
    if (localStorage.getItem(oldKey) !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey))
      localStorage.removeItem(oldKey)
    }
  }
})()

// ── 输出后处理修正 ──

function fixBareUrls(text) {
  const protectedLinks = [];
  let result = text.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => {
    const idx = protectedLinks.length;
    protectedLinks.push(m);
    return `\x00LINK${idx}\x00`;
  });
  // 转换 file:/// Markdown 链接 [文字](file:///X:/path) → tiffa-local://（反斜杠转正斜杠）
  result = result.replace(/\[([^\]]*)\]\(file:\/\/\/([^\s)]+)\)/g, (m, label, filePath) => {
    const decoded = decodeURIComponent(filePath).replace(/\\/g, '/');
    return `[${label}](tiffa-local://${decoded})`;
  });
  result = result.replace(
    /(^|[\s(\uff08])(https?:\/\/([\w.-]+\.[\w]{2,}(?:\/[\w./?#&=+%@!~:*-]*)?))(?=[\s),，;；。！？）\"'\u4e00-\u9fff]|$)/gm,
    (match, prefix, url, domain) => `${prefix}[${domain}](${url})`
  );
  // 自动链接化 Windows 本地路径：X:\path（允许中文目录名，反斜杠转正斜杠放 URL）
  result = result.replace(
    /(^|[\s(\uff08\uff0c，;；。！？）"])([A-Z]:[\\\/][^\s)\]'",;；，。！？]+)/gm,
    (match, prefix, path) => {
      const urlPath = path.replace(/\\/g, '/');
      return `${prefix}[${path}](tiffa-local://${urlPath})`;
    }
  );
  result = result.replace(/\x00LINK(\d+)\x00/g, (m, idx) => protectedLinks[parseInt(idx)]);
  return result;
}

function inferCodeLanguage(code) {
  if (/^\s*(function|const|let|var|import|export|require)\s/m.test(code)) {
    if (/\bReact\b|jsx|tsx|<\w+\s/.test(code)) return "jsx";
    return "javascript";
  }
  if (/^\s*(def |class |import |from |if __name__)/m.test(code)) return "python";
  if (/^\s*<(!DOCTYPE|html|[a-z])/im.test(code)) return "html";
  if (/^\s*[.#@\[]|\{[\s\S]*:[\s\S]*\}/m.test(code)) return "css";
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\s/im.test(code)) return "sql";
  if (/^\s*(package |import |func |type |var )/m.test(code)) return "go";
  if (/^\s*(fn |let |mut |impl |use )/m.test(code)) return "rust";
  if (/^\s*<\?xml/m.test(code)) return "xml";
  if (/^\s*\[/.test(code) && /=/.test(code)) return "toml";
  if (/^\s*[\w.-]+\s*:/m.test(code) && !/[{;]/.test(code.slice(0, 200))) return "yaml";
  return "";
}

function fixCodeBlockLanguages(text) {
  return text.replace(/(^|\n)```\s*\n([\s\S]*?)```/g, (match, prefix, content) => {
    const lang = inferCodeLanguage(content);
    return `${prefix}\`\`\`${lang}\n${content}\`\`\``;
  });
}

function applyOutputFixes(text) {
  let result = text;
  try { result = fixBareUrls(result); } catch {}
  try { result = fixCodeBlockLanguages(result); } catch {}
  return result;
}

// ── Global State ──
const state = {
  tiffaReady: false,
  agentRunning: false,
  lastEventTime: 0, // 上次收到事件的时间戳
  stallCheckTimer: null, // 卡住检测定时器
  firstResponseTimer: null, // 首次响应超时定时器
  receivedFirstResponse: false, // 是否已收到首次 agent 响应
  currentModel: '--',
  currentProvider: null,
  currentAssistantEl: null,
  currentThinkingEl: null,
  currentTextBuffer: '',
  currentToolCalls: new Map(),
  sidebarCollapsed: true,
  fileTreeRoot: null,  // 文件树当前根目录（null = workspace）
  fileViewMode: localStorage.getItem('tiffa-fileViewMode') || 'list',
  // Project/Session
  projects: [],
  activeProjectDirName: null,
  sessions: [],          // 当前项目全部会话（含活跃和非活跃）
  activeSessionPath: null,
  activeSessionId: null,    // 当前活跃对话的 sessionId（从 sessionPath 提取 UUID）
  activeSessionPaths: new Set(),  // 顶栏活跃tab（最多8个，持久化到 localStorage）
  historyCollapsed: true,         // 历史对话面板折叠状态
  workspacePath: '',
  // 每个对话记住的模型 { provider, modelId }
  sessionModelMap: {},
  // XML 翻译开关
  xmlTranslationEnabled: false,
  // 每个实例(cwd)的 agentRunning 状态，切换项目时保存/恢复
  instanceAgentRunning: new Map(),
  // 每个对话(sessionPath)的 agentRunning 状态，切换对话时保存/恢复
  sessionAgentRunning: new Map(),
  // Per-session 消息缓冲：切换会话时缓存 DOM 子树，切回来时恢复
  sessionMessageCache: new Map(),  // sessionPath -> { html, scrollPos }
  // loadEpoch 防竞态：快速切换会话时防止旧回调覆盖新数据
  loadEpoch: 0,
  // draftInput：一次性输入预填（分支等场景使用，消费后自动清空）
  draftInput: null,  // string | null
  // 归档项目列表
  archivedProjects: [],
  archiveCollapsed: true,
  // Per-workspace approval mode: 'auto' | 'yolo' | 'normal'
  // 'auto' = 自动批准读，确认写; 'yolo' = 全自动; 'normal' = 逐条确认
  approvalMode: 'yolo',
  // 生成中排队消息：存储待发送文本，agent 结束后自动发送
  pendingQueueMessage: null,
  // 本地跟踪：sendSteer 后标记下一条用户消息为 steered（后端可能不携带 steering 字段）
  pendingSteerMarker: false,
  // 本地跟踪：sendFollowUp 后标记下一条用户消息为 queued
  pendingFollowUpMarker: false,
  // Todo 阶段数据
  todoPhases: [],
  // 启动欢迎页阶段：'showing' | 'done'
  welcomePhase: 'showing',
  // 新建对话标志：新建后到收到 session_switch 之前，忽略 message_* 事件
  pendingNewSession: false,
  _newSessionSwitched: false,  // session_switch 是否已到达
  // 待发送图片列表：{ data: base64string, mimeType: string, name: string }
  pendingImages: [],
  // ── 鲁棒性状态 ──
  sessionSwitching: false,       // 会话切换进行中，禁止发送和重叠切换
  modelSwitching: false,         // 模型切换进行中，短暂禁止发送
  lastSwitchTime: 0,             // 上次切换时间戳（防抖用）
  // ── 记忆召回模式 ──
  recallMode: false,             // 全局记忆召回模式（侧边栏搜索框切换）
};

// 从 sessionPath 提取 sessionId（UUID）
// sessionPath 格式: .../sessions/<dir>/<timestamp>_<uuid>.jsonl
function extractSessionId(sessionPath) {
  if (!sessionPath) return null;
  const match = sessionPath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : null;
}
// 反查：通过 sessionId 找到对应的 sessionPath（用于后台事件路由）
function findSessionPathById(sessionId) {
  if (!sessionId) return null;
  if (state.activeSessionId === sessionId) return state.activeSessionPath;
  for (const p of state.activeSessionPaths) {
    if (extractSessionId(p) === sessionId) return p;
  }
  return null;
}
// ── sessionModelMap 持久化 ──
const MODEL_MAP_FILE = 'session-model-map.json';
async function saveModelMap() {
  try {
    const root = await tiffaDesktop.getRootPath();
    await tiffaDesktop.writeFile(root + '\\data\\agent\\' + MODEL_MAP_FILE, JSON.stringify(state.sessionModelMap));
  } catch (e) { console.warn('[持久化] 保存模型映射失败:', e); }
}
async function loadModelMap() {
  try {
    const root = await tiffaDesktop.getRootPath();
    const result = await tiffaDesktop.readFile(root + '\\data\\agent\\' + MODEL_MAP_FILE);
    if (result && result.content) {
      const map = JSON.parse(result.content);
      if (map && typeof map === 'object') {
        // 清理 __new__ 临时键残留（新建对话的临时 ID，重启后无意义）
        let cleaned = false;
        for (const key of Object.keys(map)) {
          if (key.startsWith('__new__')) {
            delete map[key];
            cleaned = true;
          }
        }
        state.sessionModelMap = map;
        // 如果清理了临时键，立即回写清理后的文件
        if (cleaned) {
          try {
            await tiffaDesktop.writeFile(root + '\\data\\agent\\' + MODEL_MAP_FILE, JSON.stringify(map));
          } catch {}
        }
      }
    }
  } catch (e) { console.warn('[持久化] 读取模型映射失败:', e); }
}

// ── DOM References ──
const dom = {
  projectList: document.getElementById('projectList'),
  btnNewProject: document.getElementById('btnNewProject'),
  btnRefreshProjects: document.getElementById('btnRefreshProjects'),
  btnSettings: document.getElementById('btnSettings'),
  btnTheme: document.getElementById('btnTheme'),
  statusText: document.getElementById('statusText'),
  currentModel: document.getElementById('currentModel'),
  btnFiles: document.getElementById('btnFiles'),
  btnXmlTranslation: document.getElementById('btnXmlTranslation'),
  xmlToggleIndicator: document.getElementById('xmlToggleIndicator'),
  btnNewSession: document.getElementById('btnNewSession'),
  sessionTabs: document.getElementById('sessionTabs'),
  messages: document.getElementById('messages'),
  inputArea: document.getElementById('inputArea'),
  newSessionOverlay: document.getElementById('newSessionOverlay'),
  input: document.getElementById('messageInput'),
  btnSend: document.getElementById('btnSend'),
  btnAbort: document.getElementById('btnAbort'),
  pendingQueueBar: document.getElementById('pendingQueueBar'),
  pendingQueueText: document.getElementById('pendingQueueText'),
  pendingQueueSteerBtn: document.getElementById('pendingQueueSteerBtn'),
  pendingQueueCancelBtn: document.getElementById('pendingQueueCancelBtn'),
  btnAttach: document.getElementById('btnAttach'),
  imagePreview: document.getElementById('imagePreview'),
  dragOverlay:   document.getElementById('dragOverlay'),
  fileInput: document.getElementById('fileInput'),
  sidebar: document.getElementById('sidebar'),
  sidebarResizeHandle: document.getElementById('sidebarResizeHandle'),
  panelOverview: document.getElementById('panelOverview'),
  panelFiles: document.getElementById('panelFiles'),
  fileDrawer: document.getElementById('fileDrawer'),
  drawerGap: document.getElementById('drawerGap'),
  drawerTitle: document.getElementById('drawerTitle'),
  drawerBody: document.getElementById('drawerBody'),
  btnCloseDrawer: document.getElementById('btnCloseDrawer'),
  memoryContent: document.getElementById('memoryContent'),
  memorySearch: document.getElementById('memorySearch'),
  btnMemoryRecall: document.getElementById('btnMemoryRecall'),
  fileTree: document.getElementById('fileTree'),
  btnRefreshFiles: document.getElementById('btnRefreshFiles'),
  btnCloseSidebar: document.getElementById('btnCloseSidebar'),
  btnViewList: document.getElementById('btnViewList'),
  btnViewGrid: document.getElementById('btnViewGrid'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  modelList: document.getElementById('modelList'),
  constraintsPreview: document.getElementById('constraintsPreview'),
  btnOpenConstraints: document.getElementById('btnOpenConstraints'),
  modelSwitcher: document.getElementById('modelSwitcher'),
  modelSwitcherList: document.getElementById('modelSwitcherList'),
};

// ── Minimap：Codex 风格消息密度滚动条 ──
// 右侧窄条按消息位置/高度绘制色块（user=accent，assistant=中性灰），
// 视口框跟随滚动，点击/拖拽跳转。canvas 绘制，千条消息一次画完。
const minimap = {
  canvas: null,
  ctx: null,
  dragging: false,
  redrawPending: false,

  init() {
    const panel = document.getElementById('chatPanel');
    if (!panel || !dom.messages) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'minimap';
    panel.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // 尺寸跟随 messages 区域（inputArea 高度变化时同步）
    new ResizeObserver(() => this.syncSize()).observe(dom.messages);
    // 内容增删 → 重绘（流式追加、历史加载、欢迎屏移除）
    new MutationObserver(() => this.scheduleRedraw()).observe(dom.messages, { childList: true });
    // 滚动 → 重绘视口框
    dom.messages.addEventListener('scroll', () => this.scheduleRedraw(), { passive: true });
    // 点击/拖拽跳转
    canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.jump(e);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => { if (this.dragging) this.jump(e); });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    this.syncSize();

  },

  syncSize() {
    if (!this.canvas || !dom.messages) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 14;
    const h = dom.messages.clientHeight;
    this.cssW = w;
    this.cssH = h;
    this.canvas.style.top = dom.messages.offsetTop + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.style.width = w + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scheduleRedraw();
  },

  scheduleRedraw() {
    if (this.redrawPending) return;
    this.redrawPending = true;
    const run = () => { this.redrawPending = false; this.draw(); };
    requestAnimationFrame(run);
    setTimeout(run, 100); // 兜底：rAF 在后台/隐藏页面可能不触发
  },

  jump(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const msgs = dom.messages;
    // .messages 有 scroll-behavior: smooth，拖拽时会被动画抢，临时切 instant
    const prev = msgs.style.scrollBehavior;
    msgs.style.scrollBehavior = 'auto';
    msgs.scrollTop = ratio * (msgs.scrollHeight - msgs.clientHeight);
    msgs.style.scrollBehavior = prev;
  },

  draw() {
    const { ctx, canvas } = this;
    const msgs = dom.messages;
    if (!ctx || !msgs) return;

    // 先判定可滚动性（不依赖 canvas 尺寸，避免 display:none 后死锁）
    const scrollable = msgs.scrollHeight > msgs.clientHeight + 40;
    canvas.style.display = scrollable ? 'block' : 'none';
    msgs.classList.toggle('minimap-active', scrollable);
    // 用 syncSize 保存的 CSS 尺寸（不依赖 clientWidth，避免 display:none 时为 0）
    const w = this.cssW || 14;
    const h = this.cssH || dom.messages.clientHeight;
    if (h <= 0) return;

    ctx.clearRect(0, 0, w, h);
    const scale = h / msgs.scrollHeight;
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent-main-000').trim();
    const neutral = styles.getPropertyValue('--text-400').trim();
    const userColor = accent ? `hsl(${accent})` : 'rgba(100,150,250,0.9)';
    const assistantColor = neutral ? `hsl(${neutral} / 0.45)` : 'rgba(140,140,140,0.45)';

    // 消息色块：位置/高度按 scrollContent 坐标等比映射
    // offsetTop 相对 offsetParent（#chatPanel 已 position:relative），msgs.offsetTop 为其内偏移
    const base = msgs.offsetTop;
    for (const el of msgs.children) {
      if (!el.classList || !el.classList.contains('message')) continue;
      const y = (el.offsetTop - base) * scale;
      const bh = Math.max(el.offsetHeight * scale, 2); // 最小 2px 保证可见
      const isUser = el.classList.contains('user');
      ctx.fillStyle = isUser ? userColor : assistantColor;
      const bw = isUser ? 8 : 6; // user 稍宽，快速区分
      ctx.fillRect((w - bw) / 2, y, bw, bh);
    }

    // 视口指示框
    const vy = msgs.scrollTop * scale;
    const vh = Math.max(msgs.clientHeight * scale, 6);
    ctx.fillStyle = accent ? `hsl(${accent} / 0.10)` : 'rgba(100,150,250,0.10)';
    ctx.fillRect(0, vy, w, vh);
    ctx.strokeStyle = accent ? `hsl(${accent} / 0.35)` : 'rgba(100,150,250,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, vy + 0.5, w - 1, vh - 1);
  },
};

// ── Initialize ──
async function init() {
  state.workspacePath = await tiffaDesktop.getWorkspacePath();
  minimap.init();

  // 拦截本地文件路径链接点击，用 shell.openPath 打开
  dom.messages.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    // tiffa-local:// 格式（由 fixBareUrls 生成，路径用正斜杠，marked 可能 URL 编码）
    if (href.startsWith('tiffa-local://')) {
      e.preventDefault();
      const raw = decodeURIComponent(href.replace('tiffa-local://', ''));
      const filePath = raw.replace(/\//g, '\\');
      tiffaDesktop.openPath(filePath);
      return;
    }
    // file:/// 协议链接（模型可能直接输出）
    if (href.startsWith('file:///')) {
      e.preventDefault();
      const raw = decodeURIComponent(href.replace('file:///', ''));
      const filePath = raw.replace(/\//g, '\\');
      tiffaDesktop.openPath(filePath);
      return;
    }
    // 纯 Windows 路径（如 X:\path，作为 href 不常见但防御性处理）
    if (/^[A-Z]:[\\\/]/.test(href)) {
      e.preventDefault();
      tiffaDesktop.openPath(href);
      return;
    }
    // 外部 http/https 链接：用系统默认浏览器打开，防止在 app 内导航导致页面卡死
    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault();
      tiffaDesktop.openExternal(href);
      return;
    }
  });

  // 事件委托：工具卡片头部点击折叠/展开（支持从缓存恢复的 HTML）
  dom.messages.addEventListener('click', (e) => {
    const header = e.target.closest('.tool-call-header');
    if (!header) return;
    const body = header.nextElementSibling;
    if (body && body.classList.contains('tool-call-body')) {
      body.classList.toggle('collapsed');
    }
  });

  tiffaDesktop.onEvent((event) => {
    // ── 多对话实例事件路由（严格模式） ──
    if (state.activeSessionId != null) {
      // session_switch 必须透传：CLI 分配真实 sessionId 后，_sessionId 已更新为真实值，
      // 与渲染层的临时 sessionId 不匹配，但此事件是迁移 __new__ tab 的唯一途径，不能过滤
      if (event._sessionId !== state.activeSessionId && event.type !== 'session_switch') {
        // 非当前对话（含项目级 _sessionId=null）：仅同步后台状态，不渲染
        if (event._sessionId != null) {
          if (event.type === 'agent_start' || event.type === 'prompt_result') {
            const bgPath = findSessionPathById(event._sessionId);
            if (bgPath) state.sessionAgentRunning.set(bgPath, true);
            renderSessionTabs();
          } else if (event.type === 'agent_end') {
            const bgPath = findSessionPathById(event._sessionId);
            if (bgPath) state.sessionAgentRunning.set(bgPath, false);
            renderSessionTabs();
          }
        }
        return;
      }
    } else {
      // 无活跃会话（刚切项目未选对话）：按 cwd 过滤，只接受项目级事件
      if (event._cwd && state.workspacePath && event._cwd !== state.workspacePath) {
        return;
      }
    }
    handleEvent(event);
  });
  tiffaDesktop.onExited(handleExited);

  setupInput();
  setupProjectPanel();
  setupSessionTabs();
  setupSidebar();
  setupSidebarResize();

  setupCopyBtnDelegation();
  setupSettings();
  setupModelSwitcher();
  setupModelConfig();
  setupThemeToggle();
  setupXmlTranslation();
  setupApprovalMode();
  // 先标记 welcomePhase=done，让 loadProjects 里的会话恢复不走 5.5s 延迟
  state.welcomePhase = 'done';
  await loadModelMap();
  await loadEnabledModels();
  await loadProjects();

  const ready = await tiffaDesktop.isReady();
  if (ready) {
    state.tiffaReady = true;
    updateStatus('就绪');
    fetchCurrentModel();
  }

  // 等待后端就绪再淡出遮罩，避免用户在预热期间提前发送消息
  const overlay = document.getElementById('startupOverlay');
  const statusEl = document.getElementById('startupStatus');
  if (overlay) {
    if (!state.tiffaReady) {
      if (statusEl) statusEl.textContent = '正在启动 AI 引擎…';
      const maxWait = 20000; // 最多等 20 秒
      const start = Date.now();
      while (!state.tiffaReady && Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 300));
        const r = await tiffaDesktop.isReady();
        if (r) {
          state.tiffaReady = true;
          updateStatus('就绪');
          fetchCurrentModel();
        }
      }
      if (!state.tiffaReady) {
        // 超时兜底：仍然允许进入，但提示未就绪
        if (statusEl) statusEl.textContent = '引擎启动较慢，可稍后发送消息';
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    overlay.classList.add('fade-out');
    setTimeout(() => { overlay.remove(); }, 400);
  }
  // 如果没有恢复到历史会话，显示欢迎页
  if (dom.messages.children.length === 0) showWelcome();
  // 启动时尝试恢复 lastModel（仅当有活跃对话且无 sessionModelMap 记录时）
  if (state.tiffaReady) restoreLastModelIfNeeded();
  dom.input.focus();
}

// ── Event Handler ──
function handleEvent(event) {
  // 记录事件时间，用于卡住检测
  state.lastEventTime = Date.now();

  // 多实例事件路由：对话级实例(_sessionId 非空)的事件按 sessionId 路由。
  // 非当前活跃对话的后台实例事件，只更新该对话的 sessionAgentRunning 映射，
  // 不污染全局 state.agentRunning / 不渲染到当前 DOM（切回时从 JSONL 补全内容）。
  // 例外 1：extension_ui_request 是阻塞型审批请求，丢弃会导致后台实例死等卡死，
  // 必须透传给 handleExtensionUI 处理（响应时带 sessionId 路由回原实例）。
  // 例外 2：session_switch 是 __new__ tab 迁移的唯一途径，必须透传。
  if (event._sessionId && state.activeSessionId && event._sessionId !== state.activeSessionId
      && event.type !== 'session_switch') {
    const bgPath = findSessionPathById(event._sessionId);
    if (event.type === 'agent_start' || (event.type === 'prompt_result' && event.agentInvoked)) {
      if (bgPath) state.sessionAgentRunning.set(bgPath, true);
      renderSessionTabs();
      return;
    } else if (event.type === 'agent_end') {
      if (bgPath) state.sessionAgentRunning.set(bgPath, false);
      renderSessionTabs();
      return;
    } else if (event.type !== 'extension_ui_request') {
      // 其他后台事件（message_*/tool_* 等）：不渲染、不改全局状态
      return;
    }
    // extension_ui_request 透传：阻塞型审批请求丢弃会导致后台实例死等卡死，
    // 必须交给下方 handleExtensionUI 处理（响应时带 _sessionId 路由回原实例）
  }

  switch (event.type) {
    case 'ready':
      state.tiffaReady = true;
      updateStatus('就绪');
      // 模型恢复优先于 fetchCurrentModel：避免 fetchCurrentModel 读到 CLI 默认模型覆盖 UI
      {
        const savedModel = state.activeSessionPath ? state.sessionModelMap[state.activeSessionPath] : null;
        if (savedModel && savedModel.provider && savedModel.modelId) {
          restoreModelIfAvailable(savedModel.provider, savedModel.modelId, state.activeSessionId, state.activeSessionPath);
        } else {
          fetchCurrentModel();
        }
      }
      restoreTodoPhases();  // 进程重启后恢复 Todo 面板
      break;
    case 'prompt_result':
      if (event.agentInvoked) {
        state.agentRunning = true;
        state.instanceAgentRunning.set(state.workspacePath, true);
        state.sessionAgentRunning.set(state.activeSessionPath, true);
        startStallCheck();
        updateInputState();
        updateStatus('思考中...');
      }
      break;
    case 'agent_start':
      state.agentRunning = true;
      state.instanceAgentRunning.set(state.workspacePath, true);
      state.sessionAgentRunning.set(state.activeSessionPath, true);
      renderSessionTabs();
      markFirstResponseReceived();
      startStallCheck();
      updateInputState();
      break;
    case 'agent_end':
      state.agentRunning = false;
      state.sessionAgentRunning.set(state.activeSessionPath, false);
      renderSessionTabs();
      state.instanceAgentRunning.set(state.workspacePath, false);
      state.pendingSteerMarker = false;
      stopStallCheck();
      stopFirstResponseCheck();
      finalizeAssistantMessage();
      updateInputState();
      updateStatus('就绪');
      // agent 结束后自动发送排队消息（短暂延迟确保后端就绪）
      setTimeout(() => flushPendingQueue(), 300);
      if (state.activeProjectDirName) loadSessions(state.activeProjectDirName);
      break;
    case 'turn_end':
      finalizeAssistantMessage();
      break;
    case 'message_start':
      // 如果用户消息已在 sendMessage 中提前渲染，跳过重复显示
      if (event.message.role === 'user' && state.agentRunning) {
        break;
      }
      if (event.message.role === 'assistant') markFirstResponseReceived();
      handleMessageStart(event.message);
      break;
    case 'message_update':
      handleMessageUpdate(event.message, event.assistantMessageEvent);
      break;
    case 'message_end':
      handleMessageEnd(event.message);
      break;
    case 'tool_execution_start':
      handleToolStart(event.toolCallId, event.toolName, event.args);
      // ask 工具等用户回复，暂停卡住检测
      if (event.toolName === 'ask') stopStallCheck();
      break;
    case 'tool_execution_update':
      handleToolUpdate(event.toolCallId, event.partialResult);
      break;
    case 'tool_execution_end':
      handleToolEnd(event.toolCallId, event.toolName, event.result, event.isError);
      // ask 工具回复后恢复卡住检测
      if (event.toolName === 'ask' && state.agentRunning) startStallCheck();
      // todo 工具结果包含 phases（在 result.details.phases 中）
      if (event.toolName === 'todo' && event.result) {
        try {
          const result = typeof event.result === 'string' ? JSON.parse(event.result) : event.result;
          const details = result && result.details ? result.details : result;
          if (details && details.phases) {
            state.todoPhases = details.phases;
            renderTodoPanel();
          }
        } catch {}
      }
      break;
    case 'extension_ui_request':
      console.log('[渲染] extension_ui_request:', event.method, event.id, event);
      handleExtensionUI(event);
      break;
    case 'config_update':
      // 只接受当前活跃会话的模型更新，避免后台实例的 config_update 覆盖 UI
      if (event.model) {
        if (!event._sessionId || !state.activeSessionId || event._sessionId === state.activeSessionId) {
          state.currentModel = event.model;
          dom.currentModel.textContent = event.model;
        }
      }
      break;
    case 'session_info_update':
      if (event.title) {
        document.title = `Tiffa - ${event.title}`;
        updateSessionTabTitle(event.title);
      }
      break;
    case 'notice':
      addNotice(event.level, event.message);
      break;
    case 'set_todos':
      if (event.phases) {
        state.todoPhases = event.phases;
        renderTodoPanel();
      }
      break;
    case 'auto_retry_start':
      updateStatus(`重试中 (${event.attempt}/${event.maxAttempts})...`);
      break;
    case 'auto_retry_end':
      updateStatus(event.success ? '就绪' : '重试失败');
      break;
    case 'session_switch':
      // 多对话实例模式下，session_switch 来自当前对话进程内部
      // 安全校验 1：只处理当前 workspace 的事件（防止跨项目串味）
      // 安全校验 2：只在用户主动等待会话分配时（__new__ tab）才处理，
      // 避免后台实例的内部切换事件意外篡改当前视图状态
      if (event.sessionPath && state.activeSessionPath && state.activeSessionPath.startsWith('__new__')
          && (!event._cwd || !state.workspacePath || event._cwd === state.workspacePath)) {
        const newPath = event.sessionPath;
        const oldPath = state.activeSessionPath;

        // 如果当前是 __new__ tab，更新为真实路径
        if (oldPath && oldPath.startsWith('__new__')) {
          // 迁移 sessionModelMap
          if (state.sessionModelMap[oldPath]) {
            state.sessionModelMap[newPath] = state.sessionModelMap[oldPath];
            delete state.sessionModelMap[oldPath];
            saveModelMap();
          }
          // 迁移 sessionAgentRunning
          if (state.sessionAgentRunning.has(oldPath)) {
            state.sessionAgentRunning.set(newPath, state.sessionAgentRunning.get(oldPath));
            state.sessionAgentRunning.delete(oldPath);
          }
          // 迁移 session 对象的 path 和 sessionId
          const ns = state.sessions.find(s => s.path === oldPath);
          if (ns) {
            ns.path = newPath;
            // 存储真实 sessionId，避免切回时用路径字符串做 sessionId 导致找不到实例
            const realSid = extractSessionId(newPath);
            if (realSid) ns.sessionId = realSid;
          }
          // 迁移 activeSessionPaths
          state.activeSessionPaths.delete(oldPath);
          state.activeSessionPaths.add(newPath);
          // 迁移 sessionMessageCache（切走后缓存的 DOM 也要跟新路径走）
          if (state.sessionMessageCache.has(oldPath)) {
            state.sessionMessageCache.set(newPath, state.sessionMessageCache.get(oldPath));
            state.sessionMessageCache.delete(oldPath);
          }
        }

        // 更新 activeSessionId 为真实 sessionId
        const realSessionId = extractSessionId(newPath);
        if (realSessionId) {
          state.activeSessionId = realSessionId;
        }

        state.activeSessionPath = newPath;
        renderSessionTabs();
        saveOpenTabs();
        updateStatus('就绪');
        dom.input.focus();
      }
      break;
  }
}

// ── 卡住检测 ──
// 如果 120 秒没收到任何事件且 agent 仍在运行，提示可能卡住
const STALL_TIMEOUT_MS = 120000; // 2 分钟（深度卡住检测）
const FIRST_RESPONSE_TIMEOUT_MS = 30000; // 30 秒无首次响应 → 提示模型可能不可达

function startStallCheck() {
  stopStallCheck();
  state.lastEventTime = Date.now();
  state.stallCheckTimer = setInterval(() => {
    if (!state.agentRunning) {
      stopStallCheck();
      return;
    }
    const elapsed = Date.now() - state.lastEventTime;
    if (elapsed > STALL_TIMEOUT_MS) {
      updateStatus('可能卡住了 (2分钟无事件)，点击停止可恢复');
      addNotice('warning', '代理可能卡住了 — 2 分钟未收到任何事件。可以点击"停止"按钮恢复。');
      stopStallCheck();
    }
  }, 30000); // 每 30 秒检查一次
}

function stopStallCheck() {
  if (state.stallCheckTimer) {
    clearInterval(state.stallCheckTimer);
    state.stallCheckTimer = null;
  }
}

// 首次响应超时检测：发送消息后如果长时间无 agent 事件，提示模型可能不可达
function startFirstResponseCheck() {
  stopFirstResponseCheck();
  state.receivedFirstResponse = false;
  state.firstResponseTimer = setTimeout(() => {
    if (state.agentRunning && !state.receivedFirstResponse) {
      updateStatus('模型可能不可达，正在等待响应...');
      addNotice('warning', '30 秒未收到模型响应 — 模型可能不可达或网络异常。可以点击"停止"按钮取消，或继续等待。');
    }
  }, FIRST_RESPONSE_TIMEOUT_MS);
}

function stopFirstResponseCheck() {
  if (state.firstResponseTimer) {
    clearTimeout(state.firstResponseTimer);
    state.firstResponseTimer = null;
  }
}

function markFirstResponseReceived() {
  if (!state.receivedFirstResponse) {
    state.receivedFirstResponse = true;
    stopFirstResponseCheck();
  }
}

function handleExited(data) {
  // 多实例：严格按 sessionId 过滤，避免后台/项目级实例退出影响当前活跃对话
  if (state.activeSessionId) {
    // 用户在会话 tab 中：只响应当前会话实例的退出
    if (data.sessionId !== state.activeSessionId) return;
  } else if (data.cwd && state.workspacePath && data.cwd !== state.workspacePath) {
    return; // 无活跃会话时按 cwd 过滤
  }

  // 进程正在自动重启，不重置全部 UI 状态，但标记未就绪禁止发送
  if (data.autoRestarting) {
    state.tiffaReady = false;
    updateInputState();
    updateStatus(`重启中 (第${data.crashCount}次)...`);
    return;
  }

  state.tiffaReady = false;
  state.agentRunning = false;
  state.sessionAgentRunning.set(state.activeSessionPath, false);
  renderSessionTabs();
  state.pendingSteerMarker = false;
  finalizeAssistantMessage();
  updateInputState();
  // 崩溃耗尽（超过自动重启上限）
  if (data.crashCount && data.crashCount > 0) {
    updateStatus(`连续崩溃 ${data.crashCount} 次，已停止自动重启`);
    addNotice('error', `Tiffa 连续崩溃 ${data.crashCount} 次，已停止自动续行。请检查模型服务是否正常，然后手动发消息继续。`);
  } else {
    updateStatus(`已断开 (code: ${data.code})`);
  }
}

// ── Welcome Screen ──
function showWelcome() {
  if (dom.messages.children.length > 0) return;
  const mottos = [
    '风起于青萍之末',
    '万物皆有裂痕，那是光照进来的地方',
    '所有伟大的行动，都始于一个微不足道的念头',
    '寂静深处，听见回声',
    '未经审视的生活不值得过',
    '山高月小，水落石出',
    '你所浪费的今天，是昨天殒去之人奢望的明天',
    '夜空中最亮的星，未必离你最近',
    '一切坚固的东西都将烟消云散',
    '落花无言，人淡如菊',
    '海面之下，冰川犹在',
    '若机器有梦，它会梦见什么',
    '在无尽参数的尽头，是否也有一片星空',
    '每一次推理，都是一场微小的宇宙诞生',
  ];
  const motto = mottos[Math.floor(Math.random() * mottos.length)];
  dom.messages.innerHTML = `
    <div class="welcome-screen">
      <div class="welcome-logo">Tiffa</div>
      <div class="welcome-title">与万物对弈，共时间同行</div>
      <div class="welcome-motto">${escapeHtml(motto)}</div>
      <div class="welcome-features">
        <div class="welcome-feature">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
          <span>记忆管理</span>
        </div>
        <div class="welcome-feature">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>项目管理</span>
        </div>
        <div class="welcome-feature">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>弱模适配</span>
        </div>
        <div class="welcome-feature">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          <span>主题切换</span>
        </div>
        <div class="welcome-feature">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          <span>差异对比</span>
        </div>
        <div class="welcome-feature">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span>待办面板</span>
        </div>
        <div class="welcome-feature">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <span>本地部署</span>
        </div>
        <div class="welcome-feature">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>便携即用</span>
        </div>
      </div>
      <div class="welcome-hint">输入消息开始对话</div>
    </div>`;
}

// ── Project Panel ──

function setupProjectPanel() {
  dom.btnRefreshProjects.addEventListener('click', () => loadProjects());
  dom.btnNewProject.addEventListener('click', openNewProjectFolder);
}

async function openNewProjectFolder() {
  try {
    // 保存旧实例状态
    if (state.workspacePath) state.instanceAgentRunning.set(state.workspacePath, state.agentRunning);

    const result = await tiffaDesktop.openFolderDialog();
    if (result.canceled) return;
    if (result.error) {
      addNotice('error', `打开文件夹失败: ${result.error}`);
      return;
    }
    const folderPath = result.path;
    updateStatus('切换项目...');
    const changeResult = await tiffaDesktop.activateInstance(folderPath);
    if (changeResult.error) {
      addNotice('error', `切换项目失败: ${changeResult.error}`);
      updateStatus('就绪');
      return;
    }
    state.workspacePath = folderPath;
    state.activeProjectDirName = null;
    state.activeSessionPath = null;
    state.tiffaReady = true;
    // 恢复新实例状态
    try {
      const instances = await tiffaDesktop.getInstances();
      const current = instances.find(i => i.cwd === folderPath);
      if (current) {
        state.instanceAgentRunning.set(folderPath, current.agentRunning);
        state.agentRunning = current.agentRunning;
      }
    } catch {}
    finalizeAssistantMessage();
    updateInputState();
    dom.messages.innerHTML = '';
    if (state.agentRunning) {
      const el = createAssistantMessageElement();
      dom.messages.appendChild(el);
      state.currentAssistantEl = el;
      state.currentTextBuffer = '';
    }
    updateStatus(state.agentRunning ? '思考中...' : '就绪');
    // 重新加载项目列表（新 cwd 会在 Tiffa 发消息后自动出现）
    await loadProjects();
    addNotice('info', `已切换到: ${folderPath}`);
  } catch (err) {
    addNotice('error', `切换项目失败: ${err.message}`);
    updateStatus('就绪');
  }
}

async function loadProjects() {
  dom.projectList.innerHTML = '<div class="project-loading">加载中...</div>';
  const result = await tiffaDesktop.listProjects();
  if (result.error) {
    dom.projectList.innerHTML = `<div class="project-loading" style="color:var(--danger)">${escapeHtml(result.error)}</div>`;
    return;
  }
  state.projects = result;
  // 同时加载归档项目列表
  try {
    const archivedResult = await tiffaDesktop.listArchivedProjects();
    state.archivedProjects = (archivedResult && !archivedResult.error) ? archivedResult : [];
  } catch { state.archivedProjects = []; }
  renderProjects();
  // Auto-select first project and restore open tabs
  if (state.projects.length > 0 && !state.activeProjectDirName) {
    await selectProject(state.projects[0].dirName);
  }
}

function renderProjects() {
  dom.projectList.innerHTML = '';
  if (!state.projects || state.projects.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'project-loading';
    hint.style.cursor = 'pointer';
    hint.title = '点击选择项目文件夹';
    hint.textContent = '暂无项目，点击＋打开文件夹';
    hint.addEventListener('click', openNewProjectFolder);
    dom.projectList.appendChild(hint);
  } else {
    for (const project of state.projects) {
      const item = document.createElement('div');
      item.className = 'project-item';
      if (project.dirName === state.activeProjectDirName) item.classList.add('active');
      const initial = (project.displayName || '?')[0].toUpperCase();
      const name = project.displayName || '未知项目';
      const count = project.sessionCount || 0;
      item.innerHTML = `<span class="project-item-icon">${escapeHtml(initial)}</span><span class="project-item-name">${escapeHtml(name)}</span>${count > 0 ? `<span class="project-item-sessioncount">${count}</span>` : ''}`;
      item.title = project.cwd || project.displayName;
      item.addEventListener('click', () => selectProject(project.dirName));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showProjectContextMenu(e, project);
      });
      dom.projectList.appendChild(item);
    }
  }

  // ── 归档项目区域 ──
  const archived = state.archivedProjects || [];
  if (archived.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'archive-divider';
    dom.projectList.appendChild(divider);

    const archiveHeader = document.createElement('div');
    archiveHeader.className = 'archive-header';
    archiveHeader.innerHTML = `
      <svg class="archive-toggle-icon ${state.archiveCollapsed ? '' : 'open'}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      <span>归档</span>
      <span class="archive-count">${archived.length}</span>
    `;
    archiveHeader.addEventListener('click', () => {
      state.archiveCollapsed = !state.archiveCollapsed;
      renderProjects();
    });
    dom.projectList.appendChild(archiveHeader);

    if (!state.archiveCollapsed) {
      const archiveList = document.createElement('div');
      archiveList.className = 'archive-list';
      for (const project of archived) {
        const item = document.createElement('div');
        item.className = 'project-item archived';
        const initial = (project.displayName || '?')[0].toUpperCase();
        const name = project.displayName || '未知项目';
        item.innerHTML = `<span class="project-item-icon">${escapeHtml(initial)}</span><span class="project-item-name">${escapeHtml(name)}</span>`;
        item.title = project.cwd || project.displayName;
        // 归档项目右键菜单：恢复 / 永久删除
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showArchivedProjectContextMenu(e, project);
        });
        archiveList.appendChild(item);
      }
      dom.projectList.appendChild(archiveList);
    }
  }
}

// ── Project Context Menu ──
let activeContextMenu = null;

function showProjectContextMenu(e, project) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="open-explorer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>在文件管理器中打开
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" data-action="archive">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>归档项目
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" data-action="delete">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>删除项目
    </div>
  `;
  document.body.appendChild(menu);

  // 定位
  const rect = dom.projectList.getBoundingClientRect();
  let x = e.clientX;
  let y = e.clientY;
  // 确保不超出视口
  const menuWidth = 220, menuHeight = 120;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  activeContextMenu = { menu, project };

  menu.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.context-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    closeContextMenu();
    if (action === 'open-explorer') tiffaDesktop.openPath(project.cwd);
    else if (action === 'archive') await archiveProject(project);
    else if (action === 'delete') await deleteProject(project);
  });

  // 点击其他地方关闭
  setTimeout(() => {
    document.addEventListener('click', closeContextMenuOnClick, { once: true });
  }, 0);
}

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.menu.remove();
    activeContextMenu = null;
  }
}

function closeContextMenuOnClick(e) {
  if (activeContextMenu && !activeContextMenu.menu.contains(e.target)) {
    closeContextMenu();
  }
}

async function archiveProject(project) {
  const confirmed = confirm(`归档项目「${project.displayName || project.cwd}」？\n\n项目会话将移至归档区，可随时恢复。`);
  if (!confirmed) return;
  try {
    const result = await tiffaDesktop.archiveProject(project.dirName);
    if (result.error) {
      addNotice('error', `归档失败: ${result.error}`);
      return;
    }
    // 归档后清空聊天区并显示欢迎页面
    state.activeProjectDirName = null;
    state.activeSessionPath = null;
    state.activeSessionPaths.clear();
    dom.messages.innerHTML = '';
    showWelcome();
    addNotice('info', `已归档: ${project.displayName}`);
    await loadProjects();
  } catch (err) {
    addNotice('error', `归档失败: ${err.message}`);
  }
}

async function deleteProject(project) {
  const confirmed = confirm(`永久删除项目「${project.displayName || project.cwd}」？\n\n所有会话记录将丢失，无法恢复！`);
  if (!confirmed) return;
  // 二次确认
  const doubleCheck = confirm(`再次确认：删除「${project.displayName}」的全部数据？此操作不可撤销。`);
  if (!doubleCheck) return;
  try {
    const result = await tiffaDesktop.deleteProject(project.dirName);
    if (result.error) {
      addNotice('error', `删除失败: ${result.error}`);
      return;
    }
    // 加入 removedCwds 防止 discoverWorkspaceProjects 让它复活
    if (project.cwd) {
      try { await tiffaDesktop.addRemovedCwd(project.cwd); } catch {}
    }
    if (project.dirName === state.activeProjectDirName) {
      state.activeProjectDirName = null;
      state.activeSessionPath = null;
      dom.messages.innerHTML = '';
      showWelcome();
    }
    addNotice('info', `已删除: ${project.displayName}`);
    await loadProjects();
  } catch (err) {
    addNotice('error', `删除失败: ${err.message}`);
  }
}

// ── 归档项目上下文菜单 ──
function showArchivedProjectContextMenu(e, project) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="restore">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>恢复项目
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" data-action="hard-delete">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>永久删除
    </div>
  `;
  document.body.appendChild(menu);

  let x = e.clientX, y = e.clientY;
  const menuWidth = 160, menuHeight = 80;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  activeContextMenu = { menu, project };

  menu.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.context-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    closeContextMenu();
    if (action === 'restore') await restoreArchivedProject(project);
    else if (action === 'hard-delete') await hardDeleteArchivedProject(project);
  });

  setTimeout(() => {
    document.addEventListener('click', closeContextMenuOnClick, { once: true });
  }, 0);
}

async function restoreArchivedProject(project) {
  try {
    const result = await tiffaDesktop.restoreProject(project.dirName);
    if (result && result.error) {
      addNotice('error', `恢复失败: ${result.error}`);
      return;
    }
    addNotice('info', `已恢复: ${project.displayName || project.dirName}`);
    await loadProjects();
  } catch (err) {
    addNotice('error', `恢复失败: ${err.message}`);
  }
}

async function hardDeleteArchivedProject(project) {
  const confirmed = confirm(`永久删除归档项目「${project.displayName || project.cwd}」？\n\n所有数据将丢失，无法恢复！`);
  if (!confirmed) return;
  try {
    const result = await tiffaDesktop.deleteProject(project.dirName);
    if (result && result.error) {
      addNotice('error', `删除失败: ${result.error}`);
      return;
    }
    // 加入 removedCwds 防止复活
    if (project.cwd) {
      try { await tiffaDesktop.addRemovedCwd(project.cwd); } catch {}
    }
    addNotice('info', `已永久删除: ${project.displayName || project.dirName}`);
    await loadProjects();
  } catch (err) {
    addNotice('error', `删除失败: ${err.message}`);
  }
}

async function selectProject(dirName) {
  // 允许重复选择同一项目（切走再切回来需要刷新状态）
  const isReselect = state.activeProjectDirName === dirName;

  // 缓存当前会话的 DOM（切回来时能快速恢复，不用重新加载历史）
  if (state.activeSessionPath && !isReselect) {
    state.sessionMessageCache.set(state.activeSessionPath, {
      html: dom.messages.innerHTML,
      scrollPos: dom.messages.scrollTop,
    });
    // 上限 3：长会话 innerHTML 可达 5-20MB，10 份缓存 = 50-200MB 堆内存
    if (state.sessionMessageCache.size > 3) {
      const oldest = state.sessionMessageCache.keys().next().value;
      state.sessionMessageCache.delete(oldest);
    }
  }

  // 保存旧实例的 agentRunning 状态
  const oldCwd = state.workspacePath;
  if (oldCwd) state.instanceAgentRunning.set(oldCwd, state.agentRunning);
  // 切换项目时先停掉stall check，避免旧项目的看门狗误触发
  stopStallCheck();

  // 找到项目的 cwd 路径
  const project = state.projects.find(p => p.dirName === dirName);
  if (!project || !project.cwd) return;

  // 激活对应实例（懒启动或复用已有实例，无需重启 Tiffa）
  if (project.cwd !== state.workspacePath || isReselect) {
    updateStatus('切换项目...');
    try {
      const result = await tiffaDesktop.activateInstance(project.cwd);
      if (result.error) {
        addNotice('error', `切换项目失败: ${result.error}`);
        updateStatus('就绪');
        return;
      }
      state.workspacePath = result.cwd || project.cwd;
      state.fileTreeRoot = null;  // 切换项目时重置文件树根目录
      if (result.ready === false) {
        state.tiffaReady = false;
        updateStatus('正在启动 Tiffa 实例，请稍候...');
        addNotice('info', '新项目 Tiffa 实例正在启动，就绪后可发送消息');
      } else {
        state.tiffaReady = true;
      }
    } catch (err) {
      addNotice('error', `切换项目失败: ${err.message}`);
      updateStatus('就绪');
      return;
    }
  }

  state.activeProjectDirName = dirName;
  if (!isReselect) {
    state.activeSessionPath = null;
    state.activeSessionId = null;
    state.activeSessionPaths.clear();  // 切换项目时重置活跃tab
  }
  restoreApprovalMode(state.workspacePath);

  // 恢复新实例的 agentRunning 状态
  const newCwd = state.workspacePath;
  // 同步真实状态：切走期间可能错过了 agent_end 事件
  try {
    const instances = await tiffaDesktop.getInstances();
    const current = instances.find(i => i.cwd === newCwd);
    if (current) {
      state.instanceAgentRunning.set(newCwd, current.agentRunning);
      state.agentRunning = current.agentRunning;
    }
  } catch {}

  if (state.agentRunning) {
    startStallCheck();
    updateInputState();
    updateStatus('思考中...');
  } else {
    stopStallCheck();
    finalizeAssistantMessage();
    updateInputState();
    updateStatus('就绪');
  }
  renderProjects();
  loadMemoryContent();  // 切换项目时刷新记忆面板
  // 若侧边栏展开且在文件 Tab，刷新文件树
  if (!state.sidebarCollapsed && !dom.panelFiles.classList.contains('hidden')) {
    loadFileTree(state.workspacePath);
  }
  await loadSessions(dirName);

  // 恢复上次打开的所有标签（懒加载：只加载活跃对话内容，其余点击时再加载）
  const realSessions = state.sessions.filter(s => !s.path.startsWith('__new__'));
  const savedTabs = restoreOpenTabs(dirName, realSessions);

  let targetPath = null;
  if (savedTabs) {
    // 恢复所有已保存的标签
    for (const p of savedTabs.paths) state.activeSessionPaths.add(p);
    targetPath = savedTabs.active;
    // 确保活跃路径在 sessions 列表中有对应对象（防御性）
    const sessionPaths = new Set(state.sessions.map(s => s.path));
    for (const p of savedTabs.paths) {
      if (!sessionPaths.has(p)) {
        const real = realSessions.find(s => s.path === p);
        if (real) state.sessions.push(real);
      }
    }
  } else if (realSessions.length > 0) {
    // 无保存记录：回退为只打开最新会话
    targetPath = realSessions[realSessions.length - 1].path;
    state.activeSessionPaths.add(targetPath);
  }

  if (targetPath) {
    state.activeSessionPath = targetPath;
    state.activeSessionId = extractSessionId(targetPath) || targetPath;
    renderSessionTabs();
    saveOpenTabs();

    const doLoad = async () => {
      // 优先使用缓存
      const cached = state.sessionMessageCache.get(targetPath);
      if (cached) {
        dom.messages.innerHTML = cached.html;
        dom.messages.scrollTop = cached.scrollPos;
        dom.messages.querySelectorAll('pre').forEach(pre => { pre.dataset.enhanced = ''; });
        enhanceCodeBlocks(dom.messages);
        lazyHighlightCodeBlocks(dom.messages);
      } else {
        if (state.agentRunning) {
          try {
            dom.messages.innerHTML = '';
            await loadAndRenderHistory(targetPath);
          } catch {}
          const el = createAssistantMessageElement();
          dom.messages.appendChild(el);
          state.currentAssistantEl = el;
          state.currentTextBuffer = '';
          scrollToBottom(true);
        } else {
          try {
            dom.messages.innerHTML = '';
            await loadAndRenderHistory(targetPath);
          } catch {}
        }
      }

      // 激活对话级实例（await 确保就绪后再允许发消息）
      const targetSid = extractSessionId(targetPath);
      if (targetSid) {
        state.tiffaReady = false;
        updateInputState();
        try {
          const result = await tiffaDesktop.activateSession(state.workspacePath, targetSid);
          // 竞态防护：等待期间用户可能又切走了
          if (state.activeSessionPath !== targetPath) return;
          if (!result.error) {
            state.tiffaReady = result.ready !== false;
            const saved = state.sessionModelMap[targetPath];
            if (saved && saved.provider && saved.modelId) {
              await restoreModelIfAvailable(saved.provider, saved.modelId, targetSid, targetPath);
            } else {
              // 无会话级模型记录 → 回退到 lastModel
              try {
                const lastRaw = localStorage.getItem('tiffa-lastModel');
                if (lastRaw) {
                  const last = JSON.parse(lastRaw);
                  if (last && last.provider && last.modelId) {
                    await restoreModelIfAvailable(last.provider, last.modelId, targetSid, targetPath);
                  }
                }
              } catch {}
            }
          } else {
            try { state.tiffaReady = await tiffaDesktop.isReady(); } catch { state.tiffaReady = false; }
          }
        } catch {
          try { state.tiffaReady = await tiffaDesktop.isReady(); } catch { state.tiffaReady = false; }
        }
        updateInputState();
      }
    };

    if (state.welcomePhase === 'showing') {
      setTimeout(doLoad, 5500);
    } else {
      await doLoad();
    }
  } else {
    if (state.welcomePhase === 'showing') {
      // 启动阶段不覆盖欢迎页
    } else {
      dom.messages.innerHTML = '';
      showWelcome();
    }
  }
}

async function loadSessions(dirName) {
  const result = await tiffaDesktop.listSessions(dirName);
  if (result.error) {
    state.sessions = [];
  } else {
    // 保留未迁移的 __new__ 临时 tab（已迁移的会被磁盘列表自然替代）
    const newTabs = state.sessions.filter(s => s.path.startsWith('__new__') && state.activeSessionPaths.has(s.path));
    // 合并后按 path 去重（磁盘版本优先，信息更完整）
    const seen = new Set();
    state.sessions = [...result, ...newTabs].filter(s => {
      if (seen.has(s.path)) return false;
      seen.add(s.path);
      return true;
    });
  }
  renderSessionTabs();
  renderHistoryPanel();
}

// ── History Panel (左侧项目栏下方的可折叠历史对话区域) ──

// 事件委托只绑一次
let _historyPanelBound = false;  // 已废弃，保留避免引用错误

function renderHistoryPanel() {
  const container = document.getElementById('historyPanel');
  if (!container) return;

  const nonActiveSessions = state.sessions.filter(s => !state.activeSessionPaths.has(s.path));

  let html = `<div class="history-header" id="historyToggle">
    <span class="history-toggle-icon">${state.historyCollapsed ? '▶' : '▼'}</span>
    <span>历史对话</span>
    <span class="history-count">${nonActiveSessions.length}</span>
  </div>`;

  if (!state.historyCollapsed) {
    html += '<div class="history-list">';
    if (nonActiveSessions.length === 0) {
      html += '<div class="history-empty">暂无历史对话</div>';
    } else {
      for (const session of nonActiveSessions) {
        const title = session.title || session.firstMessage || '新对话';
        const msgCount = session.messageCount || 0;
        const timeStr = session.mtime ? relTime(session.mtime) : '';
        html += `<div class="history-item" data-path="${escapeHtml(session.path)}">
          <div class="history-item-info" data-path="${escapeHtml(session.path)}">
            <span class="history-item-title">${escapeHtml(title.length > 25 ? title.substring(0, 25) + '...' : title)}</span>
            <span class="history-item-meta">${msgCount}条${timeStr ? ' · ' + escapeHtml(timeStr) : ''}</span>
          </div>
          <div class="history-item-actions">
            <button class="history-btn history-btn-archive" data-path="${escapeHtml(session.path)}" title="归档">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
            </button>
            <button class="history-btn history-btn-delete" data-path="${escapeHtml(session.path)}" title="删除">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>`;
      }
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // 折叠/展开（每次重新绑，因为 toggle 元素被 innerHTML 重建了）
  const toggle = document.getElementById('historyToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      state.historyCollapsed = !state.historyCollapsed;
      renderHistoryPanel();
    });
  }

  // 事件绑定（用 .onclick= 赋值而非 addEventListener，自动替换旧处理器，避免累积）
  container.onclick = async (e) => {
    // 用 closest 查找按钮（SVG 子元素点击时 target 不是 button 本身）
    const archiveBtn = e.target.closest('.history-btn-archive');
    const deleteBtn = e.target.closest('.history-btn-delete');

    // 归档按钮
    if (archiveBtn) {
      e.stopPropagation();
      const sessionPath = archiveBtn.dataset.path;
      if (sessionPath) {
        const result = await tiffaDesktop.archiveSession(sessionPath);
        if (result.success) {
          addNotice('info', '对话已归档');
          state.activeSessionPaths.delete(sessionPath);
          if (state.activeSessionPath === sessionPath) {
            state.activeSessionPath = null;
            const remaining = state.sessions.filter(s => state.activeSessionPaths.has(s.path));
            if (remaining.length > 0) {
              switchToSession(remaining[remaining.length - 1].path);
            } else {
              dom.messages.innerHTML = '';
              showWelcome();
              setTimeout(() => dom.input.focus(), 50);
            }
          }
          await loadSessions(state.activeProjectDirName);
          updateInputState();
        } else {
          addNotice('error', `归档失败: ${result.error || '未知错误'}`);
        }
      }
      return;
    }

    // 删除按钮
    if (deleteBtn) {
      e.stopPropagation();
      const sessionPath = deleteBtn.dataset.path;
      if (sessionPath) {
        if (!(await showModalConfirm('删除对话', '确定要删除这个对话吗？删除后无法恢复。'))) return;
        const result = await tiffaDesktop.deleteSession(sessionPath);
        if (result.success) {
          addNotice('info', '对话已删除');
          state.activeSessionPaths.delete(sessionPath);
          // 如果删除的是当前活跃对话，切换到其他对话或欢迎页
          if (state.activeSessionPath === sessionPath) {
            state.activeSessionPath = null;
            const remaining = state.sessions.filter(s => state.activeSessionPaths.has(s.path));
            if (remaining.length > 0) {
              switchToSession(remaining[remaining.length - 1].path);
            } else {
              dom.messages.innerHTML = '';
              showWelcome();
              setTimeout(() => dom.input.focus(), 50);
            }
          }
          await loadSessions(state.activeProjectDirName);
          updateInputState();
        } else {
          addNotice('error', `删除失败: ${result.error || '未知错误'}`);
        }
      }
      return;
    }

    // 点击历史项 → 恢复到活跃tab
    const itemInfo = e.target.closest('.history-item-info');
    if (itemInfo) {
      const sessionPath = itemInfo.dataset.path;
      if (sessionPath) {
        // 防重复：如果已在活跃tab中，直接切换而不重复添加
        if (!state.activeSessionPaths.has(sessionPath)) {
          state.activeSessionPaths.add(sessionPath);
        }
        switchToSession(sessionPath);
        renderHistoryPanel();
      }
    }
  };

  // 历史面板右键菜单
  container.oncontextmenu = (e) => {
    const itemInfo = e.target.closest('.history-item-info');
    if (!itemInfo) return;
    e.preventDefault();
    const sessionPath = itemInfo.dataset.path;
    if (!sessionPath) return;
    const session = state.sessions.find(s => s.path === sessionPath);
    if (session) {
      showSessionTabContextMenu(e, session);
    }
  };
}

// ── Session Tabs ──

function setupSessionTabs() {
  dom.btnNewSession.addEventListener('click', async () => {
    try {
      // 没有选中项目时，先引导用户选择文件夹
      if (!state.activeProjectDirName) {
        updateStatus('请先选择项目文件夹...');
        const result = await tiffaDesktop.openFolderDialog();
        if (result.canceled) { updateStatus('就绪'); return; }
        if (result.error) {
          addNotice('error', `打开文件夹失败: ${result.error}`);
          updateStatus('就绪');
          return;
        }
        // 切换到选中的文件夹
        const changeResult = await tiffaDesktop.activateInstance(result.path);
        if (changeResult.error) {
          addNotice('error', `切换项目失败: ${changeResult.error}`);
          updateStatus('就绪');
          return;
        }
        state.workspacePath = result.path;
        state.tiffaReady = true;
        // 重新加载项目列表并自动选中
        await loadProjects();
        // loadProjects 内部会自动选中第一个项目并加载 session
        updateStatus('就绪');
        return;
      }
      updateStatus('新建对话...');

      // 缓存当前对话的 DOM 与运行状态：新建对话会清屏，切回时从缓存恢复，避免 JSONL 未 flush 时内容"完全消失"
      if (state.activeSessionPath && !state.activeSessionPath.startsWith('__new__')) {
        state.sessionMessageCache.set(state.activeSessionPath, {
          html: dom.messages.innerHTML,
          scrollPos: dom.messages.scrollTop,
        });
        if (state.sessionMessageCache.size > 3) {
          const oldest = state.sessionMessageCache.keys().next().value;
          state.sessionMessageCache.delete(oldest);
        }
      }
      if (state.activeSessionPath) {
        state.sessionAgentRunning.set(state.activeSessionPath, state.agentRunning);
      }

      // 生成临时 sessionId（对话级实例独立进程）
      const tempSessionId = crypto.randomUUID();
      const tempSessionPath = '__new__' + Date.now();

      // 创建临时 session 对象
      const newSession = {
        path: tempSessionPath,
        title: '新对话',
        firstMessage: '',
        messageCount: 0,
        sessionId: tempSessionId,  // 存储实例 sessionId，切回时用于查找实例
      };
      state.sessions.push(newSession);
      state.activeSessionPath = tempSessionPath;
      state.activeSessionId = tempSessionId;
      state.activeSessionPaths.add(tempSessionPath);
      if (state.currentProvider && state.currentModel) {
        state.sessionModelMap[tempSessionPath] = { provider: state.currentProvider, modelId: state.currentModel };
        saveModelMap();
      }

      // 清屏 + 显示欢迎页
      dom.messages.innerHTML = '';
      showWelcome();
      renderSessionTabs();
      saveOpenTabs();

      // 激活对话级实例（独立 Tiffa 进程）
      const result = await tiffaDesktop.activateSession(state.workspacePath, tempSessionId);
      if (result.error) {
        addNotice('error', `新建对话失败: ${result.error}`);
        updateStatus('就绪');
        return;
      }
      state.tiffaReady = result.ready !== false;

      // 设置模型（继承之前的模型）
      if (state.currentProvider && state.currentModel && state.currentModel !== '--') {
        try { await tiffaDesktop.setModel(state.currentProvider, state.currentModel, tempSessionId); } catch {}
      }

      updateInputState();
      updateStatus('就绪');
      dom.input.focus();

      // 后台异步刷新真实会话列表
      setTimeout(async () => {
        if (state.activeProjectDirName) {
          await loadSessions(state.activeProjectDirName);
        }
      }, 2000);
    } catch (err) {
      addNotice('error', `新建对话失败: ${err.message}`);
      updateStatus('就绪');
    }
  });
}

// ── 标签持久化：记住打开的对话标签，重启后恢复 ──

function saveOpenTabs() {
  if (!state.activeProjectDirName) return;
  const key = `tiffa:openTabs:${state.activeProjectDirName}`;
  const data = {
    paths: [...state.activeSessionPaths].filter(p => !p.startsWith('__new__')),
    active: state.activeSessionPath && !state.activeSessionPath.startsWith('__new__') ? state.activeSessionPath : null,
  };
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * 从 localStorage 恢复已打开的标签。
 * 返回 { paths: string[], active: string|null }，已过滤不存在的会话。
 */
function restoreOpenTabs(dirName, sessions) {
  const key = `tiffa:openTabs:${dirName}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.paths) || data.paths.length === 0) return null;
    const validPaths = new Set(sessions.map(s => s.path));
    // 过滤 __new__ 临时路径（防御性：即使 saveOpenTabs 已过滤，localStorage 可能残留旧数据）
    const paths = data.paths.filter(p => validPaths.has(p) && !p.startsWith('__new__'));
    if (paths.length === 0) return null;
    const active = (data.active && paths.includes(data.active)) ? data.active : paths[paths.length - 1];
    return { paths, active };
  } catch { return null; }
}

function renderSessionTabs() {
  dom.sessionTabs.innerHTML = '';

  // 顶栏只显示活跃的tab
  const activeTabs = state.sessions.filter(s => state.activeSessionPaths.has(s.path));

  if (activeTabs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'session-tab';
    empty.style.color = 'var(--text-muted)';
    empty.style.fontStyle = 'italic';
    empty.textContent = '暂无对话';
    dom.sessionTabs.appendChild(empty);
    return;
  }

  for (const session of activeTabs) {
    const tab = document.createElement('button');
    tab.className = 'session-tab';
    if (session.path === state.activeSessionPath) tab.classList.add('active');
    if (state.sessionAgentRunning.get(session.path)) tab.classList.add('running');
    const title = session.title || session.firstMessage || '新对话';
    const msgCount = session.messageCount || 0;
    tab.innerHTML = `
      <span class="session-tab-name">${escapeHtml(title.length > 12 ? title.substring(0, 12) + '…' : title)}</span>
      ${msgCount > 0 ? `<span class="session-tab-msgcount">${msgCount}</span>` : ''}
      <span class="session-tab-close" title="关闭标签（不删除对话）">&#10005;</span>`;
    tab.title = title;
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showSessionTabContextMenu(e, session);
    });
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('session-tab-close')) {
        e.stopPropagation();
        // 关闭标签：从活跃tab移除
        state.activeSessionPaths.delete(session.path);
        if (state.activeSessionPath === session.path) {
          state.activeSessionPath = null;
          const remaining = state.sessions.filter(s => state.activeSessionPaths.has(s.path));
          if (remaining.length > 0) {
            const adjacent = remaining[remaining.length - 1];
            switchToSession(adjacent.path);
          } else {
            dom.messages.innerHTML = '';
            showWelcome();
            setTimeout(() => dom.input.focus(), 50);
          }
        }
        renderSessionTabs();
        saveOpenTabs();
        return;
      }
      switchToSession(session.path);
    });
    dom.sessionTabs.appendChild(tab);
  }
}

async function switchToSession(sessionPath) {
  if (state.activeSessionPath === sessionPath) return;
  // 防抱：300ms 内连续点击只处理最后一次，避免快速切换引发竞态
  const now = Date.now();
  if (now - state.lastSwitchTime < 300) return;
  state.lastSwitchTime = now;
  // 切换锁：防止重叠 switchToSession 调用（异步期间用户又点了另一个 tab）
  if (state.sessionSwitching) return;
  state.sessionSwitching = true;
  updateInputState();
  const oldSessionPath = state.activeSessionPath;

  // 切换对话时丢弃未发送的排队消息
  clearPendingQueue();

  // 保存旧对话的 agentRunning 状态（切换回来时恢复）
  // 不 abort 旧实例：多实例并行架构下，旧实例应在后台继续跑完生成并 flush JSONL。
  // LRU 淘汰已跳过 agentRunning 实例（main.js），不会被强杀丢失内容。
  if (oldSessionPath) {
    state.sessionAgentRunning.set(oldSessionPath, state.agentRunning);
  }
  stopStallCheck();
  stopFirstResponseCheck();

  state.activeSessionPath = sessionPath;
  state.activeSessionPaths.add(sessionPath);

  // 提取目标对话的 sessionId
  // __new__ tab：从 session 对象取存储的 tempSessionId（实例 key 用的是这个 UUID）
  // 普通对话：从文件路径提取 UUID
  let targetSessionId = extractSessionId(sessionPath);
  if (!targetSessionId && sessionPath.startsWith('__new__')) {
    const sessObj = state.sessions.find(s => s.path === sessionPath);
    targetSessionId = sessObj && sessObj.sessionId ? sessObj.sessionId : null;
  }
  state.activeSessionId = targetSessionId || sessionPath;  // 实在没有才用 path 自身作 id

  // 活跃tab上限8个，超过时移除最早未激活的
  const activeList = state.sessions.filter(s => state.activeSessionPaths.has(s.path));
  if (activeList.length > 8) {
    for (const s of activeList) {
      if (s.path !== sessionPath) {
        state.activeSessionPaths.delete(s.path);
        break;
      }
    }
  }
  renderSessionTabs();
  try {
    // 缓存当前会话的消息 DOM
    if (oldSessionPath) {
      state.sessionMessageCache.set(oldSessionPath, {
        html: dom.messages.innerHTML,
        scrollPos: dom.messages.scrollTop,
      });
      if (state.sessionMessageCache.size > 3) {
        const oldest = state.sessionMessageCache.keys().next().value;
        state.sessionMessageCache.delete(oldest);
      }
    }

    // __new__ tab 还没写盘，不能 loadHistory，但可以从缓存恢复
    if (sessionPath.startsWith('__new__')) {
      const cachedNew = state.sessionMessageCache.get(sessionPath);
      if (cachedNew) {
        dom.messages.innerHTML = cachedNew.html;
        dom.messages.scrollTop = cachedNew.scrollPos;
        dom.messages.querySelectorAll('pre').forEach(pre => { pre.dataset.enhanced = ''; });
        enhanceCodeBlocks(dom.messages);
        lazyHighlightCodeBlocks(dom.messages);
      } else {
        dom.messages.innerHTML = '';
        showWelcome();
      }
      // 激活对应的对话级实例
      if (targetSessionId) {
        state.tiffaReady = false;
        updateInputState();
        try {
          const result = await tiffaDesktop.activateSession(state.workspacePath, targetSessionId);
          if (state.activeSessionPath !== sessionPath) { state.sessionSwitching = false; updateInputState(); return; }
          if (!result.error) {
            state.tiffaReady = result.ready !== false;
            const saved = state.sessionModelMap[sessionPath];
            if (saved && saved.provider && saved.modelId) {
              try { await restoreModelIfAvailable(saved.provider, saved.modelId, targetSessionId, sessionPath); } catch {}
            } else {
              // 无会话级模型记录 → 回退到上次使用的模型，避免跳回 CLI 默认模型
              try {
                const lastRaw = localStorage.getItem('tiffa-lastModel');
                if (lastRaw) {
                  const last = JSON.parse(lastRaw);
                  if (last && last.provider && last.modelId) {
                    await restoreModelIfAvailable(last.provider, last.modelId, targetSessionId, sessionPath);
                  }
                }
              } catch {}
            }
          } else {
            try { state.tiffaReady = await tiffaDesktop.isReady(); } catch { state.tiffaReady = false; }
          }
        } catch {
          try { state.tiffaReady = await tiffaDesktop.isReady(); } catch { state.tiffaReady = false; }
        }
        updateInputState();
      }
      state.sessionSwitching = false;
      updateInputState();
      restoreTodoPhases();
      return;
    }

    // 先渲染历史（从文件系统读取，不依赖 Tiffa ready）
    const cached = state.sessionMessageCache.get(sessionPath);
    if (cached) {
      if (state.welcomePhase === 'showing') {
        setTimeout(() => {
          dom.messages.innerHTML = cached.html;
          dom.messages.scrollTop = cached.scrollPos;
          dom.messages.querySelectorAll('pre').forEach(pre => { pre.dataset.enhanced = ''; });
          enhanceCodeBlocks(dom.messages);
          lazyHighlightCodeBlocks(dom.messages);
        }, 5500);
      } else {
        dom.messages.innerHTML = cached.html;
        dom.messages.scrollTop = cached.scrollPos;
        dom.messages.querySelectorAll('pre').forEach(pre => { pre.dataset.enhanced = ''; });
        enhanceCodeBlocks(dom.messages);
        lazyHighlightCodeBlocks(dom.messages);
      }
    } else {
      if (state.welcomePhase === 'showing') {
        setTimeout(() => {
          dom.messages.innerHTML = '';
          loadAndRenderHistory(sessionPath);
        }, 5500);
      } else {
        dom.messages.innerHTML = '';
        await loadAndRenderHistory(sessionPath);
      }
    }
  } catch (err) {
    addNotice('error', `切换对话失败: ${err.message}`);
  }

  // 恢复目标对话的 agentRunning 状态（每个对话独立跟踪）
  state.agentRunning = state.sessionAgentRunning.get(sessionPath) || false;
  updateInputState();
  if (state.agentRunning) {
    updateStatus('运行中...');
  }

  // 激活对话级实例（独立进程，切换不干扰其他对话）
  // 使用 await 确保实例就绪后再允许用户发送消息，避免发给未 ready 的进程
  if (targetSessionId) {
    state.tiffaReady = false;
    updateInputState();
    try {
      const result = await tiffaDesktop.activateSession(state.workspacePath, targetSessionId);
      // 竞态防护：等待期间用户可能又切走了，此时放弃后续操作
      if (state.activeSessionPath !== sessionPath) { state.sessionSwitching = false; updateInputState(); return; }
      if (!result.error) {
        state.tiffaReady = result.ready !== false;
        const saved = state.sessionModelMap[sessionPath];
        if (saved && saved.provider && saved.modelId) {
          await restoreModelIfAvailable(saved.provider, saved.modelId, targetSessionId, sessionPath);
        } else {
          // 无会话级模型记录 → 回退到上次使用的模型，避免新实例用 CLI 默认模型
          try {
            const lastRaw = localStorage.getItem('tiffa-lastModel');
            if (lastRaw) {
              const last = JSON.parse(lastRaw);
              if (last && last.provider && last.modelId) {
                await restoreModelIfAvailable(last.provider, last.modelId, targetSessionId, sessionPath);
              }
            }
          } catch {}
        }
      } else {
        // activateSession 返回错误 -> 兜底检查实例是否已就绪
        const ready = await tiffaDesktop.isReady();
        state.tiffaReady = ready;
      }
    } catch {
      // 激活异常 -> 兜底检查实例是否已就绪，避免永久阻塞
      try { state.tiffaReady = await tiffaDesktop.isReady(); } catch { state.tiffaReady = false; }
    }
    updateInputState();
  }
  saveOpenTabs();
  renderHistoryPanel();
  state.sessionSwitching = false;
  updateInputState();
  restoreTodoPhases();  // 恢复目标会话的 Todo 面板
}

async function loadAndRenderHistory(sessionPath) {
  // loadEpoch 防竞态：快速切换会话时防止旧回调覆盖新数据
  const epoch = ++state.loadEpoch;
  try {
    const result = await tiffaDesktop.loadSessionHistory(sessionPath);
    // 如果在等待期间又切换了会话，放弃本次结果
    if (epoch !== state.loadEpoch) return;

    if (result.error) {
      addNotice('warning', `无法加载历史: ${result.error}`);
      return;
    }
    if (!result.messages || result.messages.length === 0) {
      showWelcome();
      return;
    }

    // 移除欢迎屏
    const welcome = dom.messages.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    // 渲染每条历史消息（DocumentFragment 批量插入，避免 N 次 DOM 操作）
    const fragment = document.createDocumentFragment();
    for (const msg of result.messages) {
      if (epoch !== state.loadEpoch) return; // 双重检查
      if (msg.role === 'user') {
        const text = msg.text || '';
        if (!text) continue;
        fragment.appendChild(createHistoryUserMessage(text, msg.timestamp, {
          steered: !!msg.steering,
          queued: !!msg.follow_up,
        }));
      } else if (msg.role === 'assistant') {
        const text = msg.text || '';
        const thinking = msg.thinking || '';
        const toolCalls = msg.toolCalls || [];
        if (!text && !thinking && toolCalls.length === 0) continue;
        fragment.appendChild(createHistoryAssistantMessage(text, thinking, toolCalls, msg.timestamp, msg.model));
      }
    }
    dom.messages.appendChild(fragment);
    scrollToBottom(true);
  } catch (err) {
    if (epoch === state.loadEpoch) addNotice('warning', `加载历史失败: ${err.message}`);
  }
}

// 用户消息公共辅助：roleLabel 和 classList 逻辑统一维护
function getUserRoleLabel(opts = {}) {
  return opts.steered ? '⟳ 引导' : opts.queued ? '⏳ 排队' : '你';
}
function applyUserMessageClasses(el, opts = {}) {
  if (opts.steered) el.classList.add('steered');
  if (opts.queued) el.classList.add('queued');
}

function createHistoryUserMessage(content, timestamp, opts = {}) {
  const div = document.createElement('div');
  div.className = 'message user';
  applyUserMessageClasses(div, opts);
  const header = document.createElement('div');
  header.className = 'message-header';
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : '';
  header.innerHTML = `<span class="message-role user">${getUserRoleLabel(opts)}</span><span class="message-time">${escapeHtml(time)}</span>`;
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = content;
  header.appendChild(createCopyBtn());
  div.appendChild(header);
  div.appendChild(body);
  return div;
}

function createHistoryAssistantMessage(text, thinking, toolCalls, timestamp, model) {
  const div = document.createElement('div');
  div.className = 'message assistant';
  const header = document.createElement('div');
  header.className = 'message-header';
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : '';
  const modelTag = model ? `<span class="message-model">${escapeHtml(model.split('/').pop() || model)}</span>` : '';
  header.innerHTML = `<span class="message-role assistant">助手</span>${modelTag}<span class="message-time">${escapeHtml(time)}</span>`;
  const body = document.createElement('div');
  body.className = 'message-body markdown-body';

  // 思考过程（<details> 折叠）
  // 纯思考消息（无正文）：自动展开，summary 提示更明确
  const hasOnlyThinking = thinking && !text && (!toolCalls || toolCalls.length === 0);
  if (thinking) {
    const thinkDiv = document.createElement('div');
    thinkDiv.className = 'thinking-block';
    const details = document.createElement('details');
    if (hasOnlyThinking) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = hasOnlyThinking
      ? `模型回复（思考过程 ${thinking.length} 字）`
      : `思考过程 (${thinking.length} 字)`;
    const thinkContent = document.createElement('div');
    thinkContent.className = 'thinking-content';
    thinkContent.textContent = thinking;
    details.appendChild(summary);
    details.appendChild(thinkContent);
    thinkDiv.appendChild(details);
    body.appendChild(thinkDiv);
  }

  // 工具调用（折叠摘要）
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      const tcDiv = document.createElement('div');
      tcDiv.className = 'tool-call';
      const tcHeader = document.createElement('div');
      tcHeader.className = 'tool-call-header';
      const summary = summarizeToolCall(tc.name, tc.input);
      tcHeader.innerHTML = `<span class="tool-call-name">${escapeHtml(tc.name || 'tool')}</span><span class="tool-call-summary">${escapeHtml(summary)}</span><span class="tool-call-status done">完成</span>`;
      const tcBody = document.createElement('div');
      tcBody.className = 'tool-call-body collapsed';
      const tcInput = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2);
      // 检查是否包含 diff
      const diffText = extractDiff(tc.output || tc.result);
      if (diffText) {
        tcBody.textContent = tcInput;
        tcBody.appendChild(renderDiffView(diffText));
      } else {
        const output = tc.output || tc.result;
        if (output) {
          tcBody.textContent = tcInput + '\n\n结果:\n' + (typeof output === 'string' ? output : JSON.stringify(output, null, 2));
        } else {
          tcBody.textContent = tcInput;
        }
      }
      tcHeader.addEventListener('click', () => tcBody.classList.toggle('collapsed'));
      tcDiv.appendChild(tcHeader);
      tcDiv.appendChild(tcBody);
      body.appendChild(tcDiv);
    }
  }

  // 正文（历史消息不高亮，代码块进入视口后再做 hljs）
  if (text) {
    const fixed = applyOutputFixes(text);
    const rendered = document.createElement('div');
    rendered.innerHTML = sanitizeHtml(tiffaDesktop.markedNoHighlight(fixed));
    body.appendChild(rendered);
  }

  // 助手消息复制按钮
  header.appendChild(createCopyBtn());

  // 代码块增强（复制按钮 + 可折叠）
  enhanceCodeBlocks(body);
  // 代码块懒高亮（进入视口才执行 hljs）
  lazyHighlightCodeBlocks(body);

  div.appendChild(header);
  div.appendChild(body);
  return div;
}

function updateSessionTabTitle(title) {
  const tabs = dom.sessionTabs.querySelectorAll('.session-tab');
  for (const tab of tabs) {
    if (tab.classList.contains('active')) {
      const nameEl = tab.querySelector('.session-tab-name');
      if (nameEl) nameEl.textContent = title.length > 12 ? title.substring(0, 12) + '…' : title;
      tab.title = title;
    }
  }
  // 同步到 state.sessions
  if (state.activeSessionPath) {
    const session = state.sessions.find(s => s.path === state.activeSessionPath);
    if (session) session.title = title;
  }
}

// ── Message Rendering ──

function handleMessageStart(message) {
  if (message.role === 'user') {
    // 后端可能不携带 steering/follow_up 字段，优先用本地跟踪标记
    const isSteered = message.steering || state.pendingSteerMarker;
    const isQueued = message.follow_up || state.pendingFollowUpMarker;
    if (state.pendingSteerMarker) state.pendingSteerMarker = false;
    if (state.pendingFollowUpMarker) state.pendingFollowUpMarker = false;
    dom.messages.appendChild(createMessageElement('user', message.content, {
      steered: !!isSteered,
      queued: !!isQueued,
    }));
    scrollToBottom();
  } else if (message.role === 'assistant') {
    const el = createAssistantMessageElement();
    dom.messages.appendChild(el);
    state.currentAssistantEl = el;
    state.currentTextBuffer = '';
    scrollToBottom();
  }
}



function handleMessageUpdate(message, assistantEvent) {
  if (!assistantEvent) return;
  switch (assistantEvent.type) {
    case 'text_start': state.currentTextBuffer = ''; break;
    case 'text_delta':
      state.currentTextBuffer += assistantEvent.delta;
      updateAssistantContent(state.currentTextBuffer);
      scrollToBottom();
      break;
    case 'text_end':
      state.currentTextBuffer = assistantEvent.content || state.currentTextBuffer;
      updateAssistantContent(state.currentTextBuffer);
      break;
    case 'thinking_start': {
      const el = createThinkingBlock();
      appendToAssistant(el);
      state.currentThinkingEl = el;
      break;
    }
    case 'thinking_delta':
      if (state.currentThinkingEl && state.currentThinkingEl._content) {
        state.currentThinkingEl._content.textContent += assistantEvent.delta;
      }
      break;
    case 'thinking_end':
      // 思考结束后更新摘要文本
      if (state.currentThinkingEl && state.currentThinkingEl._summary) {
        const text = state.currentThinkingEl._content.textContent;
        state.currentThinkingEl._summary.textContent = text
          ? `思考过程 (${text.length} 字)`
          : '思考过程';
      }
      state.currentThinkingEl = null;
      break;
    case 'toolcall_start': handleInlineToolCallStart(assistantEvent.toolCall || {}); break;
    case 'toolcall_end': handleInlineToolCallEnd(assistantEvent.toolCall || {}); break;
    case 'error': addNotice('error', '代理出错'); break;
  }
}

function handleMessageEnd(message) {
  if (message.role === 'assistant') finalizeAssistantMessage();
}

// ── 复制按钮事件委托：解决 innerHTML 缓存恢复后事件丢失问题 ──
function setupCopyBtnDelegation() {
  dom.messages.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    e.stopPropagation();
    let text;
    const header = btn.closest('.message-header');
    if (header) {
      // 消息级复制：取整个消息体文本
      const msg = header.closest('.message');
      const body = msg?.querySelector('.message-body');
      text = body ? (body.innerText || body.textContent) : '';
    } else {
      // 代码块复制：取 code 元素文本
      const pre = btn.closest('pre');
      if (!pre) return;
      const code = pre.querySelector('code');
      text = code ? code.textContent : pre.textContent;
    }
    if (!text) return;
    try {
      tiffaDesktop.clipboardWriteText(text);
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = '复制'; }, 1500);
    } catch {
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
      });
    }
  });
}

function createCopyBtn() {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = '复制';
  btn.title = '复制内容';
  // 事件由 setupCopyBtnDelegation 统一委托处理
  return btn;
}

function createMessageElement(role, content, opts = {}) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (role === 'user') applyUserMessageClasses(div, opts);
  const header = document.createElement('div');
  header.className = 'message-header';
  const roleLabel = role === 'user' ? getUserRoleLabel(opts) : '助手';
  header.innerHTML = `<span class="message-role ${role}">${roleLabel}</span>
    <span class="message-time">${new Date().toLocaleTimeString()}</span>`;
  const body = document.createElement('div');
  body.className = 'message-body';
  if (role === 'user') {
    if (typeof content === 'string') body.textContent = content;
    else if (Array.isArray(content)) {
      body.textContent = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    }
    // 用户消息：内容确定，直接加复制按钮
    header.appendChild(createCopyBtn());
  }
  div.appendChild(header);
  div.appendChild(body);
  return div;
}

function createAssistantMessageElement() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  const header = document.createElement('div');
  header.className = 'message-header';
  header.innerHTML = `<span class="message-role assistant">助手</span>
    <span class="message-time">${new Date().toLocaleTimeString()}</span>`;
  const body = document.createElement('div');
  body.className = 'message-body markdown-body';
  div.appendChild(header);
  div.appendChild(body);
  return div;
}

function updateAssistantContent(rawText) {
  if (!state.currentAssistantEl) return;
  const body = state.currentAssistantEl.querySelector('.message-body');
  if (!body) return;
  const text = applyOutputFixes(rawText);
  body.innerHTML = sanitizeHtml(tiffaDesktop.marked(text));
  enhanceCodeBlocks(body);
}

// ── 代码块增强：统一复制按钮 + 可折叠 ──
// ── 代码块懒处理：进入视口才执行 hljs 高亮 / 测高折叠 ──
// 统一观察器：CODE 元素 → 高亮；PRE 元素 → 折叠。提前 300px 触发，滚动到之前已完成
const codeBlockObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target;
    codeBlockObserver.unobserve(el);
    if (el.tagName === 'CODE') {
      // 已高亮的代码含 hljs span 子元素；未高亮的是纯文本（该判断在缓存恢复后依然正确）
      if (el.children.length > 0) continue;
      const langMatch = (el.className || '').match(/language-(\S+)/);
      const lang = langMatch ? langMatch[1] : '';
      const raw = el.textContent || '';
      try {
        el.innerHTML = lang && tiffaDesktop.hljs.getLanguage(lang)
          ? tiffaDesktop.hljs.highlight(raw, { language: lang }).value
          : tiffaDesktop.hljs.highlightAuto(raw).value;
      } catch { /* 高亮失败保持原文 */ }
    } else {
      collapsePreIfTall(el);
    }
  }
}, { root: null, rootMargin: '300px' });

// 高度超过 150px 的 pre 包裹折叠层（仅在元素近视口时测量，不与 content-visibility 冲突）
function collapsePreIfTall(pre) {
  if (pre.dataset.collapseDone) return;
  pre.dataset.collapseDone = '1';
  if (!pre.isConnected || pre.scrollHeight <= 150) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'collapsible-pre-wrap';
  pre.parentNode.insertBefore(wrapper, pre);
  wrapper.appendChild(pre);
  pre.classList.add('collapsed');

  const toggle = document.createElement('button');
  toggle.className = 'code-toggle-btn';
  toggle.textContent = '展开代码';
  toggle.onclick = (e) => {
    e.stopPropagation();
    const expanded = pre.classList.toggle('collapsed');
    toggle.textContent = expanded ? '展开代码' : '收起代码';
  };
  wrapper.appendChild(toggle);
}

function lazyHighlightCodeBlocks(container) {
  container.querySelectorAll('pre code').forEach(code => {
    if (code.children.length > 0) return; // 已高亮
    codeBlockObserver.observe(code); // 重复 observe 同一元素是 no-op，安全
  });
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre').forEach(pre => {
    // 复制按钮：未增强且不存在残留按钮时才添加（缓存恢复的 HTML 已序列化按钮，防重复）
    if (!pre.dataset.enhanced) {
      pre.dataset.enhanced = '1';
      pre.style.position = 'relative';
      if (!pre.querySelector(':scope > .copy-btn')) {
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = '复制';
        btn.style.cssText = 'position:absolute;top:4px;right:4px;padding:2px 8px;font-size:11px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:var(--text-secondary);cursor:pointer;z-index:2;';
        btn.onclick = (e) => {
          e.stopPropagation();
          const code = pre.querySelector('code');
          const text = code ? code.textContent : pre.textContent;
          try {
            tiffaDesktop.clipboardWriteText(text);
            btn.textContent = '已复制!';
            setTimeout(() => btn.textContent = '复制', 2000);
          } catch {
            navigator.clipboard.writeText(text).then(() => {
              btn.textContent = '已复制!';
              setTimeout(() => btn.textContent = '复制', 2000);
            });
          }
        };
        pre.appendChild(btn);
      }
    }
    // 懒折叠：已包裹的跳过；已在观察中的 observe 是 no-op
    if (!pre.dataset.collapseDone && !(pre.parentElement && pre.parentElement.classList.contains('collapsible-pre-wrap'))) {
      codeBlockObserver.observe(pre);
    }
    // 懒高亮
    const code = pre.querySelector('code');
    if (code && code.children.length === 0) codeBlockObserver.observe(code);
  });
}

function finalizeAssistantMessage() {
  // AI 消息结束，加复制按钮
  if (state.currentAssistantEl) {
    const header = state.currentAssistantEl.querySelector('.message-header');
    const body = state.currentAssistantEl.querySelector('.message-body');
    if (header && body && !header.querySelector('.copy-btn')) {
      header.appendChild(createCopyBtn());
    }
    // 纯思考消息（无正文）：自动展开 thinking 块，并更新 summary 提示
    const thinkingDetails = body.querySelector('.thinking-block details');
    if (thinkingDetails && !state.currentTextBuffer?.trim()) {
      thinkingDetails.open = true;
      const summary = thinkingDetails.querySelector('summary');
      if (summary) {
        const len = (thinkingDetails.querySelector('.thinking-content')?.textContent?.length) || 0;
        summary.textContent = `模型回复（思考过程 ${len} 字）`;
      }
    }
  }
  state.currentAssistantEl = null;
  state.currentTextBuffer = '';
  state.currentThinkingEl = null;
}

function appendToAssistant(el) {
  if (state.currentAssistantEl) {
    const body = state.currentAssistantEl.querySelector('.message-body');
    if (body) body.appendChild(el);
  }
}

function createThinkingBlock() {
  const wrapper = document.createElement('div');
  wrapper.className = 'thinking-block';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '思考中...';
  const content = document.createElement('div');
  content.className = 'thinking-content';
  details.appendChild(summary);
  details.appendChild(content);
  wrapper.appendChild(details);
  // 存引用供 thinking_delta 使用
  wrapper._summary = summary;
  wrapper._content = content;
  return wrapper;
}

// ── Tool Call Rendering ──

// ── Diff 视图工具函数 ──

// 从工具结果中提取 diff 文本（兼容多种字段名）
function extractDiff(result) {
  if (!result) return null;
  if (typeof result === 'string') {
    return looksLikeDiff(result) ? result : null;
  }
  if (typeof result === 'object') {
    const r = result;
    for (const key of ['diff', 'patch', 'unified_diff', 'unifiedDiff', 'edits', 'changes']) {
      const v = r[key];
      if (typeof v === 'string' && looksLikeDiff(v)) return v;
    }
    // 递归查找 result/output/data 嵌套
    for (const key of ['result', 'output', 'data']) {
      const nested = extractDiff(r[key]);
      if (nested) return nested;
    }
  }
  return null;
}

function looksLikeDiff(s) {
  if (typeof s !== 'string') return false;
  return /^--- |^\+\+\+ |^@@ |^[-+]\s/m.test(s) || s.includes('@@ -');
}

// 渲染 unified diff 为着色 HTML
function renderDiffView(diffText) {
  const container = document.createElement('div');
  container.className = 'diff';
  const lines = diffText.split('\n');
  for (const ln of lines) {
    const div = document.createElement('div');
    let cls = 'diff-ctx';
    if (ln.startsWith('@@')) cls = 'diff-hunk';
    else if (ln.startsWith('+') && !ln.startsWith('+++')) cls = 'diff-add';
    else if (ln.startsWith('-') && !ln.startsWith('---')) cls = 'diff-del';
    else if (ln.startsWith('+++') || ln.startsWith('---')) cls = 'diff-hunk';
    div.className = `diff-line ${cls}`;
    div.textContent = ln || ' ';
    container.appendChild(div);
  }
  return container;
}

// 从工具参数中提取一行摘要（路径/命令/模式等关键信息）
function summarizeToolCall(toolName, args) {
  if (!args || typeof args !== 'object') return '';
  const a = args;
  // 常见工具的摘要提取规则
  if (a.filePath || a.file_path) return a.filePath || a.file_path;
  if (a.path) return a.path;
  if (a.command) return a.command;
  if (a.pattern) return a.pattern;
  if (a.query) return a.query.substring(0, 60);
  if (a.url) return a.url;
  if (a.cwd) return a.cwd;
  if (a.directory || a.dir) return a.directory || a.dir;
  if (a.content) {
    const c = typeof a.content === 'string' ? a.content : JSON.stringify(a.content);
    return c.substring(0, 60) + (c.length > 60 ? '...' : '');
  }
  // 通用：取第一个字符串值
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === 'string' && v.length > 0) return v.substring(0, 80);
  }
  return '';
}

function handleToolStart(toolCallId, toolName, args) {
  updateStatus(`执行: ${toolName}`);
  const div = document.createElement('div');
  div.className = 'tool-call';
  div.id = `tool-${toolCallId}`;
  const summary = summarizeToolCall(toolName, args);
  const header = document.createElement('div');
  header.className = 'tool-call-header';
  header.innerHTML = `<span class="tool-call-name">${escapeHtml(toolName)}</span>
    <span class="tool-call-summary">${escapeHtml(summary)}</span>
    <span class="tool-call-status running">执行中</span>`;
  header.addEventListener('click', () => div.querySelector('.tool-call-body').classList.toggle('collapsed'));
  const body = document.createElement('div');
  body.className = 'tool-call-body collapsed';
  if (args) {
    const argStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    body.textContent = `参数:\n${argStr}`;
  }
  div.appendChild(header);
  div.appendChild(body);
  if (state.currentAssistantEl) {
    const b = state.currentAssistantEl.querySelector('.message-body');
    if (b) b.appendChild(div);
  } else dom.messages.appendChild(div);
  state.currentToolCalls.set(toolCallId, div);
  scrollToBottom();
}

function handleToolUpdate() {}

function handleToolEnd(toolCallId, toolName, result, isError) {
  const div = state.currentToolCalls.get(toolCallId);
  if (!div) return;
  const status = div.querySelector('.tool-call-status');
  if (status) {
    status.className = `tool-call-status ${isError ? 'error' : 'done'}`;
    status.textContent = isError ? '出错' : '完成';
  }
  const body = div.querySelector('.tool-call-body');
  if (body && result) {
    const r = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const existing = body.textContent || '';
    // 检查结果是否包含 diff
    const diffText = extractDiff(result);
    if (diffText) {
      body.textContent = existing + (existing ? '\n\n' : '');
      body.appendChild(renderDiffView(diffText));
    } else {
      body.textContent = existing + (existing ? '\n\n' : '') + `结果:\n${r.substring(0, 10000)}`;
    }
  }
  // 出错时自动展开
  if (isError) body.classList.remove('collapsed');
  state.currentToolCalls.delete(toolCallId);
  scrollToBottom();
}

function handleInlineToolCallStart() {}
function handleInlineToolCallEnd(toolCall) {
  if (toolCall && toolCall.name) {
    const el = document.createElement('div');
    el.className = 'tool-call';
    el.innerHTML = `<div class="tool-call-header"><span class="tool-call-name">${escapeHtml(toolCall.name)}</span><span class="tool-call-status done">等待中</span></div>`;
    appendToAssistant(el);
    scrollToBottom();
  }
}

// ── Extension UI (Custom Modal) ──

// 用 Promise 实现的自定义模态框，替代不可靠的原生 prompt/confirm
function showModalInput(title, prefill) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('extModal');
    const titleEl = document.getElementById('extModalTitle');
    const bodyEl = document.getElementById('extModalBody');
    const btnOk = document.getElementById('extModalOk');
    const btnCancel = document.getElementById('extModalCancel');

    titleEl.textContent = title || '请输入';
    bodyEl.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.value = prefill || '';
    textarea.placeholder = '输入你的回答...';
    bodyEl.appendChild(textarea);

    overlay.classList.remove('hidden');
    textarea.focus();

    const cleanup = () => {
      overlay.classList.add('hidden');
      btnOk.replaceWith(btnOk.cloneNode(true)); // remove all listeners
      btnCancel.replaceWith(btnCancel.cloneNode(true));
      // Re-get references after cloneNode
      document.getElementById('extModalOk');
      document.getElementById('extModalCancel');
    };

    setTimeout(() => {
      document.getElementById('extModalOk').addEventListener('click', () => {
        const val = textarea.value;
        cleanup();
        resolve(val);
      });
      document.getElementById('extModalCancel').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
    }, 0);
  });
}

function showModalSelect(title, options) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('extModal');
    const titleEl = document.getElementById('extModalTitle');
    const bodyEl = document.getElementById('extModalBody');
    const btnCancel = document.getElementById('extModalCancel');
    const btnOk = document.getElementById('extModalOk');

    titleEl.textContent = title || '请选择';
    bodyEl.innerHTML = '';
    const optsDiv = document.createElement('div');
    optsDiv.className = 'ext-modal-options';
    let selectedIdx = -1;

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const label = typeof opt === 'string' ? opt : (opt.label || opt.value || JSON.stringify(opt));
      const btn = document.createElement('button');
      btn.className = 'ext-modal-option';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        // Highlight selected
        optsDiv.querySelectorAll('.ext-modal-option').forEach(b => b.style.borderColor = 'var(--border)');
        btn.style.borderColor = 'var(--accent)';
        selectedIdx = i;
      });
      optsDiv.appendChild(btn);
    }
    bodyEl.appendChild(optsDiv);

    // Hide OK for select, just click option
    btnOk.classList.add('hidden');

    overlay.classList.remove('hidden');

    const cleanup = () => {
      overlay.classList.add('hidden');
      btnOk.classList.remove('hidden');
      btnOk.replaceWith(btnOk.cloneNode(true));
      btnCancel.replaceWith(btnCancel.cloneNode(true));
    };

    // Click option = select + confirm
    optsDiv.querySelectorAll('.ext-modal-option').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const opt = options[i];
        const value = typeof opt === 'string' ? opt : (opt.value !== undefined ? opt.value : opt);
        cleanup();
        resolve(value);
      });
    });

    setTimeout(() => {
      document.getElementById('extModalCancel').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
    }, 0);
  });
}

function showModalConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('extModal');
    const titleEl = document.getElementById('extModalTitle');
    const bodyEl = document.getElementById('extModalBody');
    const btnOk = document.getElementById('extModalOk');
    const btnCancel = document.getElementById('extModalCancel');

    titleEl.textContent = title || '确认';
    bodyEl.innerHTML = `<div style="color:var(--text-secondary);white-space:pre-wrap;">${escapeHtml(message || '')}</div>`;

    overlay.classList.remove('hidden');

    const cleanup = () => {
      overlay.classList.add('hidden');
      btnOk.replaceWith(btnOk.cloneNode(true));
      btnCancel.replaceWith(btnCancel.cloneNode(true));
    };

    setTimeout(() => {
      document.getElementById('extModalOk').addEventListener('click', () => {
        cleanup();
        resolve(true);
      });
      document.getElementById('extModalCancel').addEventListener('click', () => {
        cleanup();
        resolve(false);
      });
    }, 0);
  });
}

function handleExtensionUI(event) {
  const { id, method } = event;
  // 多实例：审批响应必须带回发请求的实例 sessionId，否则会发给当前活跃实例（可能已切换）
  const ssid = event._sessionId || null;
  const resp = (value) => tiffaDesktop.extensionResponse(id, value, ssid);

  switch (method) {
    case 'editor': {
      // 编辑器输入（ask 工具等）
      showModalInput(event.title || '请输入', event.prefill || '').then(v => {
        if (v !== null) {
          resp({ value: v });
        } else {
          resp({ cancelled: true });
        }
      });
      break;
    }
    case 'select': {
      const opts = event.options || [];
      showModalSelect(event.title || '请选择', opts).then(value => {
        if (value !== null && value !== undefined) {
          resp({ value });
        } else {
          resp({ cancelled: true });
        }
      });
      break;
    }
    case 'confirm': {
      showModalConfirm(event.title, event.message).then(result => {
        resp(result ? { confirmed: true } : { cancelled: true });
      });
      break;
    }
    case 'input': {
      showModalInput(event.title || '请输入', event.placeholder || '').then(v => {
        if (v !== null) {
          resp({ value: v });
        } else {
          resp({ cancelled: true });
        }
      });
      break;
    }
    case 'setWidget':
      // 终端 UI 控件展示（ask 工具的交互面板等），桌面端不需要渲染，直接确认
      resp({ confirmed: true });
      break;
    case 'notify':
      addNotice(event.notifyType || 'info', event.message);
      resp({ confirmed: true });
      break;
    case 'setStatus':
      updateStatus(event.statusText || '');
      resp({ confirmed: true });
      break;
    case 'setTitle':
      document.title = `Tiffa - ${event.title || ''}`;
      resp({ confirmed: true });
      break;
    case 'cancel':
      resp({ confirmed: true });
      break;
    case 'open_url':
      if (event.url) tiffaDesktop.openExternal(event.url);
      resp({ confirmed: true });
      break;
    case 'set_editor_text':
      // 设置 draftInput 而非直接写 dom.input.value，避免与 updateInputState 冲突
      if (event.text) {
        state.draftInput = event.text;
        // 如果 agent 未运行，立即消费；否则等 updateInputState 消费
        if (!state.agentRunning) {
          dom.input.value = state.draftInput;
          state.draftInput = null;
          dom.input.focus();
          dom.input.dispatchEvent(new Event('input'));
        }
      }
      resp({ confirmed: true });
      break;
    default:
      console.warn('[Extension UI] 未处理的 method:', method);
      resp({ confirmed: true });
  }
}

// ── Input ──
function setupInput() {
  dom.input.addEventListener('keydown', (e) => {
    // Slash 命令弹窗导航
    if (state.slashVisible) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSlashSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSlashSelection(-1); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const selected = document.querySelector('.slash-item.selected');
        if (selected) selected.click();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); hideSlashPopup(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.agentRunning) {
        submitMidRun();
      } else {
        sendMessage();
      }
    }
    // Shift+Enter 始终为换行，生成中也不例外
  });
  dom.input.addEventListener('input', () => {
    dom.input.style.height = 'auto';
    dom.input.style.height = Math.min(dom.input.scrollHeight, 160) + 'px';
    // Slash 命令检测
    handleSlashInput();
  });
  dom.btnSend.addEventListener('click', sendMessage);
  dom.btnAbort.addEventListener('click', abortMessage);

  // 排队栏按钮：引导 / 取消
  if (dom.pendingQueueSteerBtn) {
    dom.pendingQueueSteerBtn.addEventListener('click', () => {
      const text = state.pendingQueueMessage;
      if (!text) return;
      clearPendingQueue();
      sendSteer(text);
    });
  }
  if (dom.pendingQueueCancelBtn) {
    dom.pendingQueueCancelBtn.addEventListener('click', () => {
      clearPendingQueue();
    });
  }

  // ── 图片上传 ──
  // 1. 文件选择按钮
  dom.btnAttach.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', (e) => {
    handleImageFiles(Array.from(e.target.files));
    e.target.value = ''; // 重置，允许重复选择同文件
  });

  // 2. 拖放到输入区域 → 插入文件路径（编码助手场景：agent 自己去读文件）
  const inputArea = document.getElementById('inputArea');
  inputArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputArea.classList.add('drag-over');
  });
  inputArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputArea.classList.remove('drag-over');
  });
  inputArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    // 图片文件 → 加入预览待发送；非图片文件 → 插入路径文本
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const otherFiles  = files.filter(f => !f.type.startsWith('image/'));
    if (imageFiles.length > 0) handleImageFiles(imageFiles);
    if (otherFiles.length  > 0) insertFilePaths(otherFiles);
  });

  // 3. 粘贴图片 (Ctrl+V)
  dom.input.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return; // 纯文本粘贴，不拦截
    e.preventDefault();
    imageItems.forEach(item => {
      const blob = item.getAsFile();
      if (blob) readImageFile(blob);
    });
  });
}

// ── 拖放文件路径插入 ──
function insertFilePaths(files) {
  const paths = Array.from(files)
    .map(f => {
      // Electron 32+ 移除了 File.path，需走 webUtils.getPathForFile（preload 桥接）
      if (window.tiffaDesktop && typeof window.tiffaDesktop.getPathForFile === 'function') {
        try { return window.tiffaDesktop.getPathForFile(f); } catch { return f.path; }
      }
      return f.path;
    })
    .filter(Boolean);
  if (paths.length === 0) return;
  const current = dom.input.value;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  dom.input.value = current + separator + paths.join('\n') + '\n';
  // 触发自动增长
  dom.input.dispatchEvent(new Event('input'));
  dom.input.focus();
}

// ── 视觉图片预览管理（附件按钮/粘贴用） ──
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

function handleImageFiles(files) {
  files.forEach(file => readImageFile(file));
}

function readImageFile(file) {
  if (!file.type.startsWith('image/')) {
    addNotice('warning', `不支持的文件类型: ${file.type}`);
    return;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    addNotice('warning', `图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大支持 20MB`);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    // e.target.result = "data:image/png;base64,..."
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(',')[1];
    state.pendingImages.push({
      data: base64,
      mimeType: file.type,
      name: file.name || 'clipboard.png',
    });
    renderImagePreview();
  };
  reader.readAsDataURL(file);
}

function removePendingImage(index) {
  state.pendingImages.splice(index, 1);
  renderImagePreview();
}

function clearPendingImages() {
  state.pendingImages = [];
  renderImagePreview();
}

function renderImagePreview() {
  const container = dom.imagePreview;
  if (state.pendingImages.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = state.pendingImages.map((img, i) => {
    const thumbSrc = `data:${img.mimeType};base64,${img.data}`;
    return `<div class="image-preview-item">
      <img src="${thumbSrc}" alt="${img.name}" title="${img.name}">
      <button class="image-preview-remove" data-index="${i}" title="移除">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('');
  // 绑定移除按钮事件
  container.querySelectorAll('.image-preview-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index, 10);
      removePendingImage(idx);
    });
  });
}

// ── Slash 命令自动补全 ──
const slashCommands = [
  { name: '/compact',   desc: '压缩对话上下文' },
  { name: '/clear',     desc: '清空当前对话' },
  { name: '/model',     desc: '切换模型' },
  { name: '/skills',    desc: '列出可用技能' },
  { name: '/help',      desc: '显示帮助信息' },
  { name: '/cost',      desc: '显示 token 消耗' },
  { name: '/undo',      desc: '撤销上一轮对话' },
  { name: '/branch',    desc: '从当前消息分支新对话' },
];

state.slashVisible = false;
state.slashSelectedIndex = -1;

function handleSlashInput() {
  const value = dom.input.value;
  if (value.startsWith('/') && !value.includes(' ')) {
    const query = value.toLowerCase();
    const matched = slashCommands.filter(c => c.name.startsWith(query));
    if (matched.length > 0) {
      showSlashPopup(matched);
      return;
    }
  }
  hideSlashPopup();
}

function showSlashPopup(commands) {
  const popup = document.getElementById('slashPopup');
  if (!popup) return;
  popup.innerHTML = '';
  commands.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = 'slash-item' + (i === 0 ? ' selected' : '');
    item.innerHTML = `<span class="slash-item-name">${escapeHtml(cmd.name)}</span><span class="slash-item-desc">${escapeHtml(cmd.desc || '')}</span>`;
    item.addEventListener('click', () => {
      dom.input.value = cmd.name + ' ';
      dom.input.focus();
      hideSlashPopup();
      // 自动增长
      dom.input.style.height = 'auto';
      dom.input.style.height = Math.min(dom.input.scrollHeight, 160) + 'px';
    });
    popup.appendChild(item);
  });
  popup.classList.add('visible');
  state.slashVisible = true;
  state.slashSelectedIndex = 0;
}

function hideSlashPopup() {
  const popup = document.getElementById('slashPopup');
  if (popup) popup.classList.remove('visible');
  state.slashVisible = false;
  state.slashSelectedIndex = -1;
}

function moveSlashSelection(delta) {
  const items = document.querySelectorAll('.slash-item');
  if (items.length === 0) return;
  state.slashSelectedIndex = (state.slashSelectedIndex + delta + items.length) % items.length;
  items.forEach((item, i) => item.classList.toggle('selected', i === state.slashSelectedIndex));
}

async function sendMessage() {
  const message = dom.input.value.trim();
  if (!message && state.pendingImages.length === 0) return;
  // 强制等待：切换会话/模型期间禁止发送，避免消息落入错误实例
  if (state.sessionSwitching) { addNotice('warning', '正在切换会话，请稍候'); return; }
  if (state.modelSwitching) { addNotice('warning', '正在切换模型，请稍候'); return; }
  if (!state.tiffaReady) {
    // 引擎未就绪：短暂等待一次（可能是重启中），避免用户必须手动重试
    updateStatus('等待引擎就绪…');
    let waited = 0;
    while (!state.tiffaReady && waited < 5000) {
      await new Promise(r => setTimeout(r, 300));
      waited += 300;
      try { state.tiffaReady = await tiffaDesktop.isReady(); } catch {}
    }
    if (!state.tiffaReady) { addNotice('warning', 'Tiffa 尚未就绪，请稍后再试'); updateStatus('未就绪'); return; }
    updateStatus('就绪');
  }

  // 如果当前没有活动会话，自动创建一个新对话
  if (!state.activeSessionPath) {
    const tempSessionId = crypto.randomUUID();
    const tempPath = '__new__' + Date.now();
    const newSession = {
      path: tempPath,
      title: '新对话',
      firstMessage: message.substring(0, 30),
      messageCount: 0,
      sessionId: tempSessionId,  // 存储实例 sessionId
    };
    state.sessions.push(newSession);
    state.activeSessionPath = tempPath;
    state.activeSessionId = tempSessionId;
    state.activeSessionPaths.add(tempPath);
    renderSessionTabs();
    saveOpenTabs();
    // 激活对话级实例
    try {
      const result = await tiffaDesktop.activateSession(state.workspacePath, tempSessionId);
      if (result.error) {
        addNotice('error', `创建对话失败: ${result.error}`);
        return;
      }
      state.tiffaReady = result.ready !== false;
      if (state.currentProvider && state.currentModel && state.currentModel !== '--') {
        try { await tiffaDesktop.setModel(state.currentProvider, state.currentModel, state.activeSessionId); } catch {}
      }
    } catch (err) {
      addNotice('error', `创建对话失败: ${err.message}`);
      return;
    }
  }

  // Clear welcome screen on first message
  const welcome = dom.messages.querySelector('.welcome-screen');
  if (welcome) welcome.remove();
  dom.input.value = '';
  dom.input.style.height = 'auto';
  // 携带待发送图片
  const images = state.pendingImages.length > 0
    ? state.pendingImages.map(img => ({ data: img.data, mimeType: img.mimeType }))
    : undefined;
  clearPendingImages();
  // 立即显示用户消息 + "思考中"状态（本地模型 prefill 可能 60-90 秒，不等 Tiffa 事件）
  dom.messages.appendChild(createMessageElement('user', message));
  scrollToBottom();
  state.agentRunning = true;
  state.sessionAgentRunning.set(state.activeSessionPath, true);
  renderSessionTabs();
  state.instanceAgentRunning.set(state.workspacePath, true);
  startStallCheck();
  startFirstResponseCheck();
  updateInputState();
  updateStatus('思考中...');
  try { await tiffaDesktop.send(message, images, state.activeSessionId); }
  catch (err) {
    addNotice('error', `发送失败: ${err.message}`);
    // 发送失败时重置状态，避免 UI 卡在“思考中...”
    state.agentRunning = false;
    state.sessionAgentRunning.set(state.activeSessionPath, false);
    renderSessionTabs();
    state.instanceAgentRunning.set(state.workspacePath, false);
    stopStallCheck();
    stopFirstResponseCheck();
    finalizeAssistantMessage();
    updateInputState();
    updateStatus('就绪');
  }
}

async function abortMessage() {
  try {
    await tiffaDesktop.abort(state.activeSessionId);
  } catch (err) { /* ignore */ }
  stopStallCheck();
  // 不立即设 agentRunning=false，等 Tiffa 的 agent_end 事件来更新
  // 给 UI 反馈，避免用户以为没反应
  updateStatus('已发送停止信号，等待 agent 响应...');
  // 15 秒兖底：如果 Tiffa 没发 agent_end，强制重置 UI 状态
  setTimeout(() => {
    if (state.agentRunning) {
      state.agentRunning = false;
      state.sessionAgentRunning.set(state.activeSessionPath, false);
      renderSessionTabs();
      finalizeAssistantMessage();
      updateInputState();
      updateStatus('已停止');
    }
  }, 15000);
}

// ── Steer / Follow-up：生成中途干预或追加 ──
// 术语映射：后端 steering ↔ 渲染层 steered ↔ 引导
//           后端 follow_up ↔ 渲染层 queued  ↔ 排队

/**
 * 生成中途按 Enter：将消息放入排队栏，等待 agent 结束后自动发送
 */
function submitMidRun() {
  const text = dom.input.value.trim();
  if (!text) return;
  dom.input.value = '';
  dom.input.style.height = 'auto';
  // 存入排队栏（覆盖时提示）
  if (state.pendingQueueMessage) {
    addNotice('info', '排队消息已替换');
  }
  state.pendingQueueMessage = text;
  if (dom.pendingQueueText) dom.pendingQueueText.textContent = text;
  if (dom.pendingQueueBar) dom.pendingQueueBar.classList.remove('hidden');
}

function clearPendingQueue() {
  state.pendingQueueMessage = null;
  if (dom.pendingQueueBar) dom.pendingQueueBar.classList.add('hidden');
}

/**
 * agent 结束后自动发送排队消息（作为 follow_up）
 */
function flushPendingQueue() {
  const text = state.pendingQueueMessage;
  if (!text) return;
  clearPendingQueue();
  sendFollowUp(text);
}

async function sendSteer(text) {
  state.pendingSteerMarker = true;
  const el = createMessageElement('user', text, { steered: true });
  dom.messages.appendChild(el);
  scrollToBottom();
  addNotice('info', '已发送引导，当前工具完成后将按新方向继续');
  updateInputState();
  try { await tiffaDesktop.steer(text, state.activeSessionId); }
  catch (err) {
    el.remove();
    state.pendingSteerMarker = false;
    addNotice('error', `引导失败: ${err.message}`);
  }
}

async function sendFollowUp(text) {
  state.pendingFollowUpMarker = true;
  const el = createMessageElement('user', text, { queued: true });
  dom.messages.appendChild(el);
  scrollToBottom();
  addNotice('info', '消息已排队，当前任务完成后执行');
  try { await tiffaDesktop.followUp(text, state.activeSessionId); }
  catch (err) {
    el.remove();
    state.pendingFollowUpMarker = false;
    addNotice('error', `排队失败: ${err.message}`);
  }
}

function updateInputState() {
  dom.btnSend.classList.toggle('hidden', state.agentRunning);
  dom.btnAbort.classList.toggle('hidden', !state.agentRunning);
  // 生成中输入框视觉区分
  if (dom.inputArea) dom.inputArea.classList.toggle('input-running', state.agentRunning);
  // 强制禁用：未就绪 / 切换会话中 / 切换模型中 → 禁止输入，避免用户操作落入错误实例
  const shouldDisable = !state.tiffaReady || state.sessionSwitching || state.modelSwitching;
  dom.input.disabled = shouldDisable;
  dom.btnSend.disabled = shouldDisable;
  if (dom.inputArea) dom.inputArea.classList.toggle('input-disabled', shouldDisable);
  // placeholder
  dom.input.placeholder = shouldDisable
    ? (state.sessionSwitching ? '正在切换会话…' : state.modelSwitching ? '正在切换模型…' : '等待引擎就绪…')
    : state.agentRunning
      ? 'Enter 排队 | 点击引导按钮立即干预'
      : '输入消息，Enter 发送，Shift+Enter 换行...';
  if (!state.agentRunning && !shouldDisable) {
    if (state.draftInput) {
      dom.input.value = state.draftInput;
      state.draftInput = null;
      dom.input.focus();
      dom.input.dispatchEvent(new Event('input'));
    } else {
      dom.input.focus();
    }
  }
}

function updateStatus(text) { dom.statusText.textContent = text; }

function addNotice(level, message) {
  // 聊天内联通知（保留原有行为）
  const div = document.createElement('div');
  div.className = `notice ${level}`;
  div.textContent = message;
  dom.messages.appendChild(div);
  scrollToBottom();
  // 同时显示浮动 Toast
  showToast(level, message);
}

// ── Toast 浮动通知系统 ──
const toastIcons = {
  info:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  warning:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  error:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
};

function showToast(level, message, duration = 5000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${level}`;
  toast.innerHTML = `
    <span class="toast-icon" style="color: var(--${level === 'info' ? 'info' : level === 'success' ? 'success' : level === 'warning' ? 'warning' : 'danger'})">
      ${toastIcons[level] || toastIcons.info}
    </span>
    <div class="toast-body">${escapeHtml(message)}</div>
    <button class="toast-close">&times;</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  const remove = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  };
  closeBtn.addEventListener('click', remove);

  container.appendChild(toast);
  if (duration > 0) {
    setTimeout(remove, duration);
  }
}

// ── File Tree (sidebar) ──
function setupSidebar() {
  dom.btnFiles.addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    dom.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
    if (!state.sidebarCollapsed) {
      // 点击"文件浏览"按钮时自动切换到"文件"Tab
      switchSidebarTab('files');
      loadFileTree(state.workspacePath);
      loadMemoryContent();
    } else {
      closeFileDrawer();
    }
  });
  dom.btnCloseSidebar.addEventListener('click', () => {
    state.sidebarCollapsed = true;
    dom.sidebar.classList.add('collapsed');
    closeFileDrawer();
  });
  dom.btnRefreshFiles.addEventListener('click', () => {
    loadFileTree(state.workspacePath);
    loadMemoryContent();
  });
  // 视图切换：列表 / 缩略图
  updateViewToggleUI();
  dom.btnViewList.addEventListener('click', () => switchFileViewMode('list'));
  dom.btnViewGrid.addEventListener('click', () => switchFileViewMode('grid'));
  // Tab 切换：概要 / 文件
  document.querySelectorAll('.sidebar-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchSidebarTab(btn.dataset.tab);
    });
  });
  // 抽屉关闭（滑动回收）
  dom.btnCloseDrawer.addEventListener('click', closeFileDrawer);
  // 点击间隙关闭
  dom.drawerGap.addEventListener('click', closeFileDrawer);
  // 记忆搜索框：实时过滤小节 / 召回模式下回车触发全局召回
  if (dom.memorySearch) {
    dom.memorySearch.addEventListener('input', () => {
      if (state.recallMode) return; // 召回模式不实时过滤
      filterMemorySections(dom.memorySearch.value);
    });
    dom.memorySearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.recallMode) {
        e.preventDefault();
        performMemoryRecall(dom.memorySearch.value);
      }
      if (e.key === 'Escape' && state.recallMode) {
        exitRecallMode();
      }
    });
  }
  // 全局记忆召回按钮
  if (dom.btnMemoryRecall) {
    dom.btnMemoryRecall.addEventListener('click', () => {
      if (state.recallMode) {
        exitRecallMode();
      } else {
        enterRecallMode();
      }
    });
  }
}

// 切换侧边栏 Tab（概要 / 文件）
function switchSidebarTab(tab) {
  dom.panelOverview.classList.toggle('hidden', tab !== 'overview');
  dom.panelFiles.classList.toggle('hidden', tab !== 'files');
  document.querySelectorAll('.sidebar-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // 切换到文件 tab 时始终重新加载文件树（切换项目后旧数据需刷新）
  if (tab === 'files') loadFileTree(state.workspacePath);
}

// ── Todo Panel ──
function renderTodoPanel() {
  const container = document.getElementById('todoList');
  const countEl = document.getElementById('todoCount');
  if (!container) return;
  const phases = state.todoPhases || [];
  if (countEl) {
    const total = phases.reduce((sum, p) => sum + (p.tasks ? p.tasks.length : 0), 0);
    countEl.textContent = total > 0 ? `${total} 项` : '';
  }
  if (phases.length === 0) {
    container.innerHTML = '<div class="todo-empty">暂无待办</div>';
    return;
  }
  container.innerHTML = phases.map(phase => {
    const items = (phase.tasks || []).map(task => {
      const statusIcon = getTodoStatusIcon(task.status);
      return `<div class="todo-item"><span class="${statusIcon.cls}">${statusIcon.icon}</span><span class="todo-text">${escapeHtml(task.content)}</span></div>`;
    }).join('');
    const name = phase.name || '未命名阶段';
    return `<div class="todo-phase"><div class="todo-phase-title">${escapeHtml(name)}</div>${items || '<div class="todo-item todo-empty-phase">(空)</div>'}</div>`;
  }).join('');
}

function getTodoStatusIcon(status) {
  if (status === 'completed' || status === 'done') return { icon: '✓', cls: 'todo-done' };
  if (status === 'in_progress' || status === 'active') return { icon: '◎', cls: 'todo-active' };
  if (status === 'blocked' || status === 'failed' || status === 'abandoned') return { icon: '✗', cls: 'todo-blocked' };
  return { icon: '○', cls: 'todo-pending' };
}

// 从内核 get_state 恢复 Todo 面板（切换会话/启动时调用）
async function restoreTodoPhases() {
  try {
    const st = await tiffaDesktop.getState();
    if (st && Array.isArray(st.todoPhases)) {
      state.todoPhases = st.todoPhases;
      renderTodoPanel();
    }
  } catch {}
}

async function loadFileTree(dirPath) {
  // dirPath 可选，不传则用当前 fileTreeRoot
  const target = dirPath || state.fileTreeRoot || state.workspacePath;
  state.fileTreeRoot = target;
  const entries = await tiffaDesktop.listDir(target);
  if (entries.error) {
    dom.fileTree.innerHTML = `<div class="file-tree-item" style="color:var(--danger)">${entries.error}</div>`;
    return;
  }
  dom.fileTree.innerHTML = '';
  dom.fileTree.classList.toggle('grid-view', state.fileViewMode === 'grid');

  // “返回上一级”导航（根目录是 workspace，不能超越）
  const wsRoot = state.workspacePath;
  if (target !== wsRoot && target.startsWith(wsRoot)) {
    const upItem = document.createElement('div');
    upItem.className = 'file-tree-item file-tree-up';
    upItem.innerHTML = '<span class="file-tree-icon">←</span><span class="ft-name">..</span>';
    upItem.addEventListener('click', () => {
      const parent = target.replace(/[\\/][^\\/]+$/, '') || wsRoot;
      // 不允许超越 workspace
      const safeParent = parent.length >= wsRoot.length ? parent : wsRoot;
      loadFileTree(safeParent);
    });
    dom.fileTree.appendChild(upItem);
  }

  renderFileEntries(target, entries, dom.fileTree, 0);
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];

function isImageFile(ext) {
  return IMAGE_EXTS.includes(ext);
}

function renderFileEntries(basePath, entries, container, depth) {
  const gridMode = state.fileViewMode === 'grid';
  for (const entry of entries) {
    if (gridMode && !entry.isDirectory) {
      renderGridItem(entry, container);
    } else {
      renderListItem(entry, container, depth);
    }
  }
}

function renderListItem(entry, container, depth) {
  const item = document.createElement('div');
  item.className = `file-tree-item ${entry.isDirectory ? 'directory' : ''}`;
  item.style.paddingLeft = `${12 + depth * 16}px`;
  const icon = entry.isDirectory ? 'D' : getFileIcon(entry.ext);
  const sizeHtml = (!entry.isDirectory && entry.size > 0) ? `<span class="file-tree-size">${formatFileSize(entry.size)}</span>` : '';
  item.innerHTML = `<span class="file-tree-icon">${icon}</span><span class="ft-name">${escapeHtml(entry.name)}</span>${sizeHtml}`;
  item.addEventListener('click', () => {
    if (entry.isDirectory) {
      // 点击进入目录（重新根化文件树）
      loadFileTree(entry.path);
    } else {
      openFilePreview(entry);
    }
  });
  container.appendChild(item);
}

function renderGridItem(entry, container) {
  const item = document.createElement('div');
  item.className = 'file-grid-item';
  if (isImageFile(entry.ext)) item.classList.add('image');
  const sizeHtml = entry.size > 0 ? `<span class="file-grid-size">${formatFileSize(entry.size)}</span>` : '';
  if (isImageFile(entry.ext)) {
    item.innerHTML = `
      <div class="file-grid-thumb" data-path="${escapeHtml(entry.path)}">
        <div class="file-grid-thumb-loading">…</div>
      </div>
      <div class="file-grid-info">
        <span class="file-grid-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
        ${sizeHtml}
      </div>`;
    // 异步加载缩略图
    loadThumbnail(entry.path, item.querySelector('.file-grid-thumb'));
  } else {
    const icon = getFileIcon(entry.ext);
    item.innerHTML = `
      <div class="file-grid-thumb file-grid-thumb-icon"><span>${icon}</span></div>
      <div class="file-grid-info">
        <span class="file-grid-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
        ${sizeHtml}
      </div>`;
  }
  item.addEventListener('click', () => openFilePreview(entry));
  container.appendChild(item);
}

// 异步加载图片缩略图，带简单缓存
const thumbCache = new Map();
async function loadThumbnail(filePath, thumbEl) {
  if (!thumbEl) return;
  if (thumbCache.has(filePath)) {
    const cached = thumbCache.get(filePath);
    thumbEl.innerHTML = `<img src="${cached}" alt="">`;
    return;
  }
  try {
    const result = await tiffaDesktop.readImage(filePath);
    if (result.error) { thumbEl.innerHTML = '<span class="file-grid-thumb-err">!</span>'; return; }
    const src = `data:${result.mimeType};base64,${result.base64}`;
    // 限制缓存大小：超过 100 条时清除最早的
    if (thumbCache.size > 100) {
      const firstKey = thumbCache.keys().next().value;
      thumbCache.delete(firstKey);
    }
    thumbCache.set(filePath, src);
    thumbEl.innerHTML = `<img src="${src}" alt="">`;
  } catch {
    thumbEl.innerHTML = '<span class="file-grid-thumb-err">!</span>';
  }
}

function switchFileViewMode(mode) {
  if (state.fileViewMode === mode) return;
  state.fileViewMode = mode;
  localStorage.setItem('tiffa-fileViewMode', mode);
  updateViewToggleUI();
  // 重新加载当前目录
  loadFileTree(state.fileTreeRoot || state.workspacePath);
}

function updateViewToggleUI() {
  const isList = state.fileViewMode === 'list';
  if (dom.btnViewList) dom.btnViewList.classList.toggle('active', isList);
  if (dom.btnViewGrid) dom.btnViewGrid.classList.toggle('active', !isList);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function getFileIcon(ext) {
  const icons = { '.js': '{}', '.ts': '{}', '.py': '~', '.md': '#', '.json': '{}', '.yml': '-', '.yaml': '-', '.html': '<>', '.css': '#', '.bat': '>', '.txt': '~', '.log': '~', '.csv': '=', '.png': 'I', '.jpg': 'I', '.jpeg': 'I', '.gif': 'I', '.webp': 'I', '.pdf': 'P', '.docx': 'W', '.xlsx': 'X', '.pptx': 'S' };
  return icons[ext] || 'F';
}

async function openFilePreview(entry) {
  // 抽屉式预览：点击文件弹出滑动覆盖层
  if (state.sidebarCollapsed) { state.sidebarCollapsed = false; dom.sidebar.classList.remove('collapsed'); }
  dom.drawerTitle.textContent = entry.name;
  dom.drawerBody.innerHTML = '<div class="preview-empty">加载中…</div>';
  dom.drawerGap.classList.add('visible');
  dom.fileDrawer.classList.add('open');

  if (isImageFile(entry.ext)) {
    const result = await tiffaDesktop.readImage(entry.path);
    if (result.error) { dom.drawerBody.innerHTML = `<div class="preview-empty">${escapeHtml(result.error)}</div>`; return; }
    const src = `data:${result.mimeType};base64,${result.base64}`;
    dom.drawerBody.innerHTML = `<div class="image-preview-full"><img src="${src}" alt="${escapeHtml(entry.name)}"></div>`;
  } else {
    const result = await tiffaDesktop.readFile(entry.path);
    if (result.error) { dom.drawerBody.innerHTML = `<div class="preview-empty">${escapeHtml(result.error)}</div>`; return; }
    const ext = result.ext || entry.ext || '';
    // HTML 文件用 iframe 渲染
    if (ext === '.html' || ext === '.htm') {
      dom.drawerBody.innerHTML = `<iframe srcdoc="${escapeHtml(result.content)}" sandbox="allow-scripts allow-same-origin"></iframe>`;
    } else if (ext === '.md' || ext === '.markdown') {
      const html = simpleMarkdownRender(result.content);
      dom.drawerBody.innerHTML = `<iframe srcdoc="${escapeHtml(html)}" sandbox="allow-scripts allow-same-origin"></iframe>`;
    } else {
      // 代码文件：hljs 高亮
      const langMap = { '.js': 'javascript', '.ts': 'typescript', '.py': 'python', '.css': 'css', '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.bat': 'bash', '.sh': 'bash', '.xml': 'xml', '.sql': 'sql', '.rs': 'rust', '.go': 'go', '.java': 'java', '.cpp': 'cpp', '.c': 'c' };
      const lang = langMap[ext] || '';
      let highlighted;
      try { highlighted = lang && tiffaDesktop.hljs.getLanguage(lang) ? tiffaDesktop.hljs.highlight(result.content, { language: lang }).value : tiffaDesktop.hljs.highlightAuto(result.content).value; }
      catch { highlighted = escapeHtml(result.content); }
      dom.drawerBody.innerHTML = `<pre class="code-preview"><code class="hljs">${highlighted}</code></pre>`;
    }
  }
}

function closeFileDrawer() {
  dom.fileDrawer.classList.remove('open');
  dom.drawerGap.classList.remove('visible');
}

// ── 记忆内容加载 ──
// rawProjectMd: 保存原始 markdown 供搜索过滤使用
state.rawProjectMd = '';

async function loadMemoryContent() {
  if (!dom.memoryContent) return;
  dom.memoryContent.classList.add('markdown-body');
  // 清空搜索框
  if (dom.memorySearch) dom.memorySearch.value = '';
  try {
    // 只显示当前项目的 PROJECT.md（项目进度/决策/规范）
    if (state.workspacePath) {
      const proj = await tiffaDesktop.readFile(state.workspacePath + '\\PROJECT.md');
      if (proj && proj.content) {
        state.rawProjectMd = proj.content;
        dom.memoryContent.innerHTML = sanitizeHtml(tiffaDesktop.marked(proj.content));
        wrapMemorySections(dom.memoryContent);
        return;
      }
    }
    state.rawProjectMd = '';
    dom.memoryContent.textContent = '暂无 PROJECT.md';
  } catch {
    state.rawProjectMd = '';
    dom.memoryContent.textContent = '无法加载';
  }
}

// 将渲染后的平铺 DOM 按 h3 标题分组成可过滤小节
// 每个 h3 到下一个 h3/h2 之间的元素包裹进 div.memory-section
function wrapMemorySections(container) {
  const children = Array.from(container.children);
  let currentSection = null;
  for (const el of children) {
    if (el.tagName === 'H3') {
      // 开始新小节
      currentSection = document.createElement('div');
      currentSection.className = 'memory-section';
      currentSection.dataset.section = el.textContent.trim();
      container.insertBefore(currentSection, el);
      currentSection.appendChild(el);
    } else if (el.tagName === 'H2') {
      // H2 是大类标题，不属于任何 h3 小节
      currentSection = null;
    } else if (currentSection) {
      currentSection.appendChild(el);
    }
  }
}

// 按关键词过滤记忆小节
function filterMemorySections(query) {
  if (!dom.memoryContent) return;
  const sections = dom.memoryContent.querySelectorAll('.memory-section');
  const q = query.trim().toLowerCase();
  if (!q) {
    sections.forEach(s => s.style.display = '');
    return;
  }
  sections.forEach(s => {
    s.style.display = s.dataset.section.toLowerCase().includes(q) ||
      s.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
// ── 全局记忆召回 ──

function enterRecallMode() {
  state.recallMode = true;
  if (dom.btnMemoryRecall) dom.btnMemoryRecall.classList.add('active');
  if (dom.memorySearch) {
    dom.memorySearch.placeholder = '输入关键词，回车搜索全局记忆…';
    dom.memorySearch.value = '';
    dom.memorySearch.focus();
  }
  if (dom.memoryContent) {
    dom.memoryContent.classList.remove('markdown-body');
    dom.memoryContent.innerHTML = '<div class="memory-recall-empty">输入关键词后按回车，搜索所有项目的记忆</div>';
  }
}

function exitRecallMode() {
  state.recallMode = false;
  if (dom.btnMemoryRecall) dom.btnMemoryRecall.classList.remove('active');
  if (dom.memorySearch) {
    dom.memorySearch.placeholder = '搜索记忆…';
    dom.memorySearch.value = '';
  }
  loadMemoryContent();
}

async function performMemoryRecall(query) {
  const q = (query || '').trim();
  if (!q) return;
  if (dom.memoryContent) {
    dom.memoryContent.classList.remove('markdown-body');
    dom.memoryContent.innerHTML = '<div class="memory-recall-loading">搜索中…</div>';
  }
  try {
    const result = await tiffaDesktop.recallMemory(q);
    if (result.error) {
      if (dom.memoryContent) {
        dom.memoryContent.innerHTML = `<div class="memory-recall-empty">搜索失败：${escapeHtml(result.error)}</div>`;
      }
      return;
    }
    renderRecallResults(result.results || [], q);
  } catch (err) {
    if (dom.memoryContent) {
      dom.memoryContent.innerHTML = `<div class="memory-recall-empty">搜索出错：${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderRecallResults(results, query) {
  if (!dom.memoryContent) return;
  if (results.length === 0) {
    dom.memoryContent.innerHTML = `<div class="memory-recall-empty">未找到与「${escapeHtml(query)}」相关的记忆</div>`;
    return;
  }
  let html = `<div class="memory-recall-back" onclick="exitRecallMode()">← 返回项目记忆</div>`;
  html += `<div class="memory-recall-results">`;
  for (const item of results) {
    const time = item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const bank = item.bank || '';
    const source = item.source || '';
    html += `<div class="memory-recall-item" title="${escapeHtml(item.content)}">`;
    html += `<div class="memory-recall-item-content">${escapeHtml(item.content)}</div>`;
    html += `<div class="memory-recall-item-meta">`;
    if (bank) html += `<span class="memory-recall-item-bank">${escapeHtml(bank)}</span>`;
    if (source) html += `<span>${escapeHtml(source)}</span>`;
    if (time) html += `<span>${time}</span>`;
    html += `</div></div>`;
  }
  html += `</div>`;
  dom.memoryContent.innerHTML = html;
}

// 简易 Markdown → HTML（不依赖外部库）
function simpleMarkdownRender(md) {
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:16px;color:#333;background:#fff;}h1{border-bottom:1px solid #eee;padding-bottom:8px;}h2{border-bottom:1px solid #eee;padding-bottom:6px;}code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-size:0.9em;}li{margin:4px 0;}</style></head><body>${html}</body></html>`;
}

// ── Sidebar Resize ──
function setupSidebarResize() {
  const handle = dom.sidebarResizeHandle;
  const sidebar = dom.sidebar;
  let dragging = false, startX, startWidth;
  handle.addEventListener('mousedown', (e) => {
    if (sidebar.classList.contains('collapsed')) return;
    dragging = true; startX = e.clientX; startWidth = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newWidth = Math.max(200, Math.min(window.innerWidth * 0.6, startWidth + (startX - e.clientX)));
    sidebar.style.width = newWidth + 'px';
    // 内容自适应宽度，不再设固定 min-width
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return; dragging = false; handle.classList.remove('dragging');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
  });
}

// 分隔线：(文件树 + Todo) ↔ 预览，只调整预览区高度
// ── Session Tab Context Menu ──

function showSessionTabContextMenu(e, session) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="rename">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>重命名
    </div>
    <div class="context-menu-item" data-action="branch">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>分支
    </div>
    <div class="context-menu-item" data-action="export-html">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出 HTML
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" data-action="archive">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>归档对话
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" data-action="delete">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>删除对话
    </div>
  `;
  document.body.appendChild(menu);

  // 定位
  let x = e.clientX;
  let y = e.clientY;
  const menuWidth = 160, menuHeight = 220;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  activeContextMenu = { menu, session };

  menu.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.context-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    console.log('[DEBUG] 右键菜单点击:', action, session.path);
    closeContextMenu();
    if (action === 'rename') {
      console.log('[DEBUG] 调用 renameSession');
      await renameSession(session);
    }
    else if (action === 'branch') await branchSession(session);
    else if (action === 'export-html') await exportSessionHtml(session);
    else if (action === 'archive') await archiveSessionFromTab(session);
    else if (action === 'delete') await deleteSessionFromTab(session);
  });

  setTimeout(() => {
    document.addEventListener('click', closeContextMenuOnClick, { once: true });
  }, 0);
}

async function archiveSessionFromTab(session) {
  const result = await tiffaDesktop.archiveSession(session.path);
  if (result.success) {
    addNotice('info', '对话已归档');
    state.activeSessionPaths.delete(session.path);
    if (state.activeSessionPath === session.path) {
      state.activeSessionPath = null;
      const remaining = state.sessions.filter(s => state.activeSessionPaths.has(s.path));
      if (remaining.length > 0) {
        switchToSession(remaining[remaining.length - 1].path);
      } else {
        dom.messages.innerHTML = '';
        showWelcome();
        setTimeout(() => dom.input.focus(), 50);
      }
    }
    await loadSessions(state.activeProjectDirName);
    updateInputState();
  } else {
    addNotice('error', `归档失败: ${result.error || '未知错误'}`);
  }
}

async function deleteSessionFromTab(session) {
  const title = session.title || session.firstMessage || '新对话';
  if (!(await showModalConfirm('删除对话', `确定要删除对话「${title}」吗？删除后无法恢复。`))) return;
  const result = await tiffaDesktop.deleteSession(session.path);
  if (result.success) {
    addNotice('info', '对话已删除');
    state.activeSessionPaths.delete(session.path);
    if (state.activeSessionPath === session.path) {
      state.activeSessionPath = null;
      const remaining = state.sessions.filter(s => state.activeSessionPaths.has(s.path));
      if (remaining.length > 0) {
        switchToSession(remaining[remaining.length - 1].path);
      } else {
        dom.messages.innerHTML = '';
        showWelcome();
        setTimeout(() => dom.input.focus(), 50);
      }
    }
    await loadSessions(state.activeProjectDirName);
    updateInputState();
  } else {
    addNotice('error', `删除失败: ${result.error || '未知错误'}`);
  }
}

async function renameSession(session) {
  if (!session || !session.path) return;
  const currentTitle = session.title || session.firstMessage || '新对话';
  const newTitle = await showModalInput('请输入新的对话名称：', currentTitle);
  if (newTitle === null) return;  // 用户取消
  const trimmedTitle = newTitle.trim();
  if (!trimmedTitle) {
    addNotice('warning', '对话名称不能为空');
    return;
  }
  // __new__ 临时会话还没写盘，不调用后端
  if (session.path.startsWith('__new__')) {
    session.title = trimmedTitle;
    session.firstMessage = trimmedTitle.substring(0, 30);
    renderSessionTabs();
    renderHistoryPanel();
    return;
  }
  const result = await tiffaDesktop.renameSession(session.path, trimmedTitle);
  if (result.success) {
    session.title = trimmedTitle;
    renderSessionTabs();
    renderHistoryPanel();
    addNotice('success', '对话已重命名');
  } else {
    addNotice('error', `重命名失败: ${result.error || '未知错误'}`);
  }
}

// ── 分支功能 ──
async function branchSession(session) {
  if (!session || !session.path) return;
  try {
    const result = await tiffaDesktop.getUserEntries(session.path);
    if (!result || !result.entries || result.entries.length === 0) {
      addNotice('warning', '该对话没有可分支的用户消息');
      return;
    }
    showBranchPicker(session, result.entries);
  } catch (err) {
    addNotice('error', `获取对话记录失败: ${err.message}`);
  }
}

function showBranchPicker(session, entries) {
  const overlay = document.createElement('div');
  overlay.className = 'branch-overlay';
  const modal = document.createElement('div');
  modal.className = 'branch-modal';

  let listHtml = '';
  for (const entry of entries) {
    const text = (entry.text || '').substring(0, 80);
    listHtml += `<div class="branch-entry" data-id="${escapeHtml(entry.id)}">
      <span class="branch-entry-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </span>
      <span class="branch-entry-text">${escapeHtml(text)}${text.length >= 80 ? '...' : ''}</span>
    </div>`;
  }
  modal.innerHTML = `
    <div class="branch-header">
      <span class="branch-title">分支对话</span>
      <span class="branch-subtitle">选择分支点，从该消息之后创建新对话</span>
      <button class="settings-close" id="branchClose">&times;</button>
    </div>
    <div class="branch-list">${listHtml}</div>
    <div class="branch-hint">点击选择分支点</div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  modal.querySelector('#branchClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  modal.querySelectorAll('.branch-entry').forEach(el => {
    el.addEventListener('click', async () => {
      const msgId = el.dataset.id;
      const text = entries.find(e => e.id === msgId)?.text || '';
      close();
      // 发送 branch 命令
      try {
        await tiffaDesktop.command('branch', { entryId: msgId });
        // 设置 draftInput 预填分支后的输入
        state.draftInput = text;
        addNotice('info', '已创建分支，输入框已预填原始消息');
        // 刷新会话列表
        if (state.activeProjectDirName) await loadSessions(state.activeProjectDirName);
        updateInputState();
      } catch (err) {
        addNotice('error', `分支失败: ${err.message}`);
      }
    });
  });
}

// ── 导出 HTML ──
async function exportSessionHtml(session) {
  if (!session || !session.path) return;
  try {
    const result = await tiffaDesktop.exportSessionHtml(session.path);
    if (result && result.path) {
      addNotice('success', `已导出到: ${result.path}`);
    } else if (result && result.error) {
      addNotice('error', `导出失败: ${result.error}`);
    } else {
      addNotice('info', '导出完成');
    }
  } catch (err) {
    addNotice('error', `导出失败: ${err.message}`);
  }
}

// ── Utilities ──
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 简易 HTML 消毒：移除 script/危险标签、事件属性、javascript: URL
function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const dangerous = tpl.content.querySelectorAll('script,style,link,meta,base,object,embed,form');
  dangerous.forEach(el => el.remove());
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
  const toClean = [];
  while (walker.nextNode()) toClean.push(walker.currentNode);
  for (const el of toClean) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || (attr.value.trim().toLowerCase().startsWith('javascript:'))) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return tpl.innerHTML;
}

// cwdKey：规范化路径用于比较（\→/，去尾 /，小写）
function cwdKey(p) {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// relTime：人性化相对时间
function relTime(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  let ts;
  if (typeof dateStr === 'number') ts = dateStr;
  else if (typeof dateStr === 'string') ts = new Date(dateStr).getTime();
  else return '';
  if (isNaN(ts)) return '';
  const diff = now - ts;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(month / 12)} 年前`;
}

function scrollToBottom(force = false) {
  requestAnimationFrame(() => {
    // 粘底滚动：仅在用户已接近底部时自动滚动，不抢用户翻页；force 用于历史加载等必须到底的场景
    const el = dom.messages;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (force || nearBottom) el.scrollTop = el.scrollHeight;
  });
}
const path = {
  basename: (p) => (p || '').split(/[\\/]/).pop(),
  extname: (p) => { const name = path.basename(p); const dot = name.lastIndexOf('.'); return dot > 0 ? name.substring(dot) : ''; },
};

// ── Theme Toggle（使用 themes.js 主题引擎）──
function setupThemeToggle() {
  let { presetId, mode, resolvedMode } = initTheme()
  updateThemeIcons(resolvedMode)
  updateHljsTheme(resolvedMode)

  if (dom.btnTheme) {
    dom.btnTheme.addEventListener('click', () => {
      const currentMode = localStorage.getItem(LS_MODE_KEY) || 'system'
      // 快速按钮行为：
      // - system → 切到 dark（脱离 system）
      // - dark → light
      // - light → dark
      let next
      if (currentMode === 'system') {
        next = resolveMode('system') === 'dark' ? 'light' : 'dark'
      } else {
        next = currentMode === 'light' ? 'dark' : 'light'
      }
      setThemeMode(next)
      updateThemeIcons(next)
      updateHljsTheme(next)
    })
  }
}

function updateThemeIcons(resolvedMode) {
  const moonIcon = document.querySelector('.icon-moon')
  const sunIcon = document.querySelector('.icon-sun')
  if (moonIcon && sunIcon) {
    moonIcon.style.display = resolvedMode === 'dark' ? '' : 'none'
    sunIcon.style.display = resolvedMode === 'light' ? '' : 'none'
  }
}

function updateHljsTheme(resolvedMode) {
  const darkLink = document.getElementById('hljs-dark')
  const lightLink = document.getElementById('hljs-light')
  if (darkLink && lightLink) {
    if (resolvedMode === 'light') {
      darkLink.disabled = true
      lightLink.disabled = false
    } else {
      darkLink.disabled = false
      lightLink.disabled = true
    }
  }
}

// ── XML Translation Toggle ──
async function setupXmlTranslation() {
  // 从开关文件恢复状态
  try {
    const result = await tiffaDesktop.getXmlTranslationStatus();
    if (result && result.enabled) {
      state.xmlTranslationEnabled = true;
      dom.btnXmlTranslation.classList.add('active');
    }
  } catch {}

  dom.btnXmlTranslation.addEventListener('click', async () => {
    state.xmlTranslationEnabled = !state.xmlTranslationEnabled;
    try {
      await tiffaDesktop.toggleXmlTranslation(state.xmlTranslationEnabled);
    } catch {}
    if (state.xmlTranslationEnabled) {
      dom.btnXmlTranslation.classList.add('active');
    } else {
      dom.btnXmlTranslation.classList.remove('active');
    }
  });
}

// ── Approval Mode（per-workspace 工具审批模式） ──
// 'normal' = 逐条确认, 'auto' = 自动批准读、确认写, 'yolo' = 全自动
const APPROVAL_MODES = ['normal', 'auto', 'yolo'];
const APPROVAL_MODE_LABELS = { normal: '审批：确认', auto: '审批：半自动', yolo: '审批：全自动' };

function setupApprovalMode() {
  // 恢复全局默认值
  const saved = localStorage.getItem('tiffa-approvalMode-default');
  if (saved && APPROVAL_MODES.includes(saved)) state.approvalMode = saved;
  renderApprovalModeIndicator();
}

function renderApprovalModeIndicator() {
  // 在 titlebar-right 区域显示 approval mode 按钮
  let indicator = document.getElementById('approvalModeBtn');
  if (!indicator) {
    indicator = document.createElement('button');
    indicator.id = 'approvalModeBtn';
    indicator.className = 'titlebar-btn approval-mode-btn';
    indicator.title = '工具审批模式：点击切换';
    const rightArea = document.querySelector('.titlebar-right');
    if (rightArea) rightArea.insertBefore(indicator, rightArea.firstChild);
    indicator.addEventListener('click', () => {
      cycleApprovalMode();
    });
  }
  indicator.textContent = APPROVAL_MODE_LABELS[state.approvalMode] || '确认';
  indicator.className = `titlebar-btn approval-mode-btn mode-${state.approvalMode}`;
}

function cycleApprovalMode() {
  const idx = APPROVAL_MODES.indexOf(state.approvalMode);
  state.approvalMode = APPROVAL_MODES[(idx + 1) % APPROVAL_MODES.length];
  // 持久化到 per-workspace
  const key = 'tiffa-approvalMode-' + cwdKey(state.workspacePath);
  try { localStorage.setItem(key, state.approvalMode); } catch {}
  // 也保存为默认
  try { localStorage.setItem('tiffa-approvalMode-default', state.approvalMode); } catch {}
  renderApprovalModeIndicator();
  addNotice('info', `审批模式: ${APPROVAL_MODE_LABELS[state.approvalMode]}`);
  // 写入 config.yml（下次会话生效）
  tiffaDesktop.writeApprovalMode(state.approvalMode).then(result => {
    if (!result?.success) console.warn('[审批] 写入 config.yml 失败:', result?.error);
  }).catch(() => {});
  // 通知 Tiffa（当前会话通过 steer 告知）
  if (state.agentRunning) {
    try { tiffaDesktop.command('steer', { message: `[system] 用户切换审批模式为: ${state.approvalMode}（${APPROVAL_MODE_LABELS[state.approvalMode]}）` }); } catch {}
  }
}

function restoreApprovalMode(cwd) {
  const key = 'tiffa-approvalMode-' + cwdKey(cwd);
  const saved = localStorage.getItem(key);
  if (saved && APPROVAL_MODES.includes(saved)) {
    state.approvalMode = saved;
  } else {
    const def = localStorage.getItem('tiffa-approvalMode-default');
    state.approvalMode = (def && APPROVAL_MODES.includes(def)) ? def : 'yolo';
  }
  renderApprovalModeIndicator();
  // 写入 config.yml 同步
  tiffaDesktop.writeApprovalMode(state.approvalMode).catch(() => {});
}

// ── Settings ──
function setupSettings() {
  dom.btnSettings.addEventListener('click', () => {
    dom.settingsOverlay.classList.toggle('hidden');
    if (!dom.settingsOverlay.classList.contains('hidden')) {
      loadConstraintsPreview(); loadModelConfig(); loadModelList(); renderThemePresets();
    }
  });
  dom.btnCloseSettings.addEventListener('click', () => dom.settingsOverlay.classList.add('hidden'));
  dom.settingsOverlay.addEventListener('click', (e) => { if (e.target === dom.settingsOverlay) dom.settingsOverlay.classList.add('hidden'); });
  dom.btnOpenConstraints.addEventListener('click', async () => { tiffaDesktop.openPath((await tiffaDesktop.getRootPath()) + '\\data\\memory\\constraints.md'); });
}

function renderThemePresets() {
  const container = document.getElementById('themePresetList');
  if (!container) return;
  const current = getCurrentTheme();
  container.innerHTML = THEME_PRESETS.map(p => {
    const active = p.id === current.presetId;
    return `<div class="theme-preset-card${active ? ' active' : ''}" data-preset-id="${p.id}">
      <div class="theme-preset-swatch">
        <div class="theme-swatch-dark" style="background:hsl(${p.dark.background.bg100})"></div>
        <div class="theme-swatch-light" style="background:hsl(${p.light.background.bg100})"></div>
      </div>
      <div class="theme-preset-info">
        <div class="theme-preset-name">${p.name}</div>
        <div class="theme-preset-desc">${p.description}</div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.theme-preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-preset-id');
      setThemePreset(id);
      renderThemePresets();
    });
  });

  // 渲染日夜模式选择器
  renderThemeModeSelector();
}

function renderThemeModeSelector() {
  const container = document.getElementById('themeModeSelector');
  if (!container) return;
  const current = getCurrentTheme();

  const modes = [
    { id: 'light', label: '亮色', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' },
    { id: 'dark', label: '暗色', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' },
    { id: 'system', label: '跟随系统', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
  ];

  container.innerHTML = modes.map(m => {
    const active = m.id === current.mode;
    return `<button class="theme-mode-btn${active ? ' active' : ''}" data-mode="${m.id}">${m.icon}<span>${m.label}</span></button>`;
  }).join('');

  container.querySelectorAll('.theme-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      setThemeMode(mode);
      const resolvedMode = resolveMode(mode);
      updateThemeIcons(resolvedMode);
      updateHljsTheme(resolvedMode);
      renderThemeModeSelector();
    });
  });
}

async function loadModelList() {
  dom.modelList.innerHTML = '<div class="model-item loading">加载模型列表...</div>';
  try {
    await loadHiddenModels();
    // 确保modelsConfigData已加载（用于过滤内置模型）
    if (!modelsConfigData) {
      try {
        const cfgResult = await tiffaDesktop.readModelsYml();
        if (cfgResult && !cfgResult.error) modelsConfigData = cfgResult.data;
      } catch {}
    }
    const result = await tiffaDesktop.getModels();
    if (result && result.models) renderModelList(result.models);
    else dom.modelList.innerHTML = '<div class="model-item empty">暂无可用模型</div>';
  } catch { dom.modelList.innerHTML = '<div class="model-item empty">无法获取模型列表</div>'; }
}

let activeModelProvider = 'all'; // 供应商筛选状态
let cachedModelList = null;      // 缓存模型列表供筛选时复用
let hiddenModels = new Set();    // 隐藏的模型 ID 集合
let showHiddenModels = false;    // 临时展开已隐藏模型

async function loadHiddenModels() {
  try {
    const root = await tiffaDesktop.getRootPath();
    const result = await tiffaDesktop.readFile(root + '\\data\\agent\\hidden-models.json');
    if (result && result.content) {
      hiddenModels = new Set(JSON.parse(result.content));
    }
  } catch { hiddenModels = new Set(); }
}

async function saveHiddenModels() {
  try {
    const root = await tiffaDesktop.getRootPath();
    await tiffaDesktop.writeFile(root + '\\data\\agent\\hidden-models.json', JSON.stringify([...hiddenModels]));
  } catch {}
}

function renderModelList(models) {
  if (models) cachedModelList = models;
  const modelList = cachedModelList || [];
  dom.modelList.innerHTML = '';
  
  // 过滤掉不在用户 models.yml 中的内置模型（如 moonshot-v1-128k 等）
  let filteredModelList = modelList;
  if (modelsConfigData && modelsConfigData.providers) {
    // 构建 models.yml 中定义的所有模型 ID 集合
    const userModelIds = new Set();
    for (const prov of Object.values(modelsConfigData.providers)) {
      if (prov.models) for (const m of prov.models) userModelIds.add(m.id);
    }
    if (userModelIds.size > 0) {
      // 只保留 models.yml 中定义的模型，以及 home-models（Tiffa config.yml 中的本地模型）
      filteredModelList = modelList.filter(m => userModelIds.has(m.id) || (m.provider && m.provider.startsWith('home-')));
    }
  }
  
  // 提取供应商列表（基于过滤后的模型）
  const providers = [...new Set(filteredModelList.map(m => m.provider).filter(Boolean))];
  
  // 渲染筛选按钮
  const filterEl = document.getElementById('modelProviderFilter');
  if (filterEl) {
    filterEl.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'provider-filter-btn' + (activeModelProvider === 'all' ? ' active' : '');
    allBtn.textContent = '全部';
    allBtn.addEventListener('click', () => { activeModelProvider = 'all'; renderModelList(); });
    filterEl.appendChild(allBtn);
    for (const p of providers) {
      const btn = document.createElement('button');
      btn.className = 'provider-filter-btn' + (activeModelProvider === p ? ' active' : '');
      btn.textContent = p;
      btn.addEventListener('click', () => { activeModelProvider = p; renderModelList(); });
      filterEl.appendChild(btn);
    }
  }
  
  // 按供应商筛选
  let filtered = activeModelProvider === 'all' ? filteredModelList : filteredModelList.filter(m => m.provider === activeModelProvider);
  const hiddenCount = filtered.filter(m => hiddenModels.has(m.id)).length;
  
  // 不展开时，过滤掉隐藏模型
  const displayed = showHiddenModels ? filtered : filtered.filter(m => !hiddenModels.has(m.id));
  
  for (const model of displayed) {
    const div = document.createElement('div');
    div.className = 'model-item';
    const isCurrent = state.currentModel === model.id || state.currentModel === model.name;
    const isHidden = hiddenModels.has(model.id);
    if (isCurrent) div.classList.add('active');
    if (isHidden) div.classList.add('dimmed');
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'model-item-info';
    infoDiv.innerHTML = `<span class="model-item-name">${escapeHtml(model.name || model.id)}</span><span class="model-item-provider">${escapeHtml(model.provider || '')}</span></div>`;
    div.appendChild(infoDiv);
    
    // 右侧：开关 + 当前标记
    const rightDiv = document.createElement('div');
    rightDiv.style.cssText = 'display:flex;align-items:center;gap:8px;';
    
    const toggle = document.createElement('label');
    toggle.className = 'model-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !isHidden;
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) hiddenModels.delete(model.id);
      else hiddenModels.add(model.id);
      saveHiddenModels();
      renderModelList();
    });
    const slider = document.createElement('span');
    slider.className = 'model-toggle-slider';
    toggle.appendChild(checkbox);
    toggle.appendChild(slider);
    toggle.addEventListener('click', (e) => e.stopPropagation());
    rightDiv.appendChild(toggle);
    
    if (isCurrent) {
      const check = document.createElement('span');
      check.className = 'model-item-check';
      check.textContent = '当前';
      rightDiv.appendChild(check);
    }
    div.appendChild(rightDiv);
    
    div.addEventListener('click', (e) => { if (!e.target.closest('.model-toggle')) switchModel(model.provider, model.id); });
    dom.modelList.appendChild(div);
  }
  
  // 底部：已隐藏提示
  if (hiddenCount > 0 && !showHiddenModels) {
    const hint = document.createElement('div');
    hint.className = 'model-item model-hidden-hint';
    hint.textContent = `${hiddenCount} 个模型已隐藏，点击展开`;
    hint.addEventListener('click', () => { showHiddenModels = true; renderModelList(); });
    dom.modelList.appendChild(hint);
  } else if (showHiddenModels && hiddenCount > 0) {
    const hint = document.createElement('div');
    hint.className = 'model-item model-hidden-hint';
    hint.textContent = '收起已隐藏模型';
    hint.addEventListener('click', () => { showHiddenModels = false; renderModelList(); });
    dom.modelList.appendChild(hint);
  }
  
  if (displayed.length === 0 && hiddenCount === 0) dom.modelList.innerHTML = '<div class="model-item empty">无匹配模型</div>';
}

// 带校验的模型恢复：检查 provider/modelId 是否在当前可用模型列表中
// 避免 sessionModelMap 中的残留（如已删除的模型）导致恢复失败
let _availableModelSet = null; // 缓存可用模型集合
let _availableModelSetTime = 0; // 缓存时间戳（5 分钟 TTL）
async function getAvailableModelSet() {
  if (_availableModelSet && Date.now() - _availableModelSetTime < 5 * 60 * 1000) return _availableModelSet;
  try {
    const result = await tiffaDesktop.getModels();
    if (result && result.models) {
      _availableModelSet = new Set();
      for (const m of result.models) {
        if (m.provider && m.id) _availableModelSet.add(`${m.provider}/${m.id}`);
      }
      _availableModelSetTime = Date.now();
    }
  } catch {}
  return _availableModelSet;
}

// 校验并恢复会话模型：若模型不在可用列表中则跳过
// expectedSessionPath: 可选，传入时会在异步操作后校验当前会话是否仍是同一个，避免快速切换时旧回调覆盖新会话的模型显示
async function restoreModelIfAvailable(provider, modelId, sessionId, expectedSessionPath) {
  const availableSet = await getAvailableModelSet();
  if (availableSet && !availableSet.has(`${provider}/${modelId}`)) {
    console.warn(`[restoreModel] 模型 "${provider}/${modelId}" 不在可用列表中，跳过恢复`);
    return false;
  }
  try {
    await tiffaDesktop.setModel(provider, modelId, sessionId);
    // 竞态防护：异步期间用户可能已切走，后端命令已发出（实例模型正确），但不更新全局 UI
    if (expectedSessionPath && state.activeSessionPath !== expectedSessionPath) {
      return true;
    }
    state.currentModel = modelId;
    state.currentProvider = provider;
    dom.currentModel.textContent = modelId;
    return true;
  } catch {
    return false;
  }
}

async function switchModel(provider, modelId) {
  // 确保对话实例已激活，避免 setModel 落到错误实例（项目级 fallback）
  if (!state.tiffaReady) {
    addNotice('warning', 'Tiffa 尚未就绪，请稍候再切换模型');
    return;
  }
  if (state.sessionSwitching) {
    addNotice('warning', '正在切换会话，请稍候再切换模型');
    return;
  }
  // 模型切换锁：禁止切换期间发送消息，避免用旧模型发出去
  state.modelSwitching = true;
  updateInputState();
  try {
    await tiffaDesktop.setModel(provider, modelId, state.activeSessionId);
    state.currentModel = modelId;
    state.currentProvider = provider;
    dom.currentModel.textContent = modelId;
    addNotice('info', `已切换到模型: ${modelId}`);
    // 记住当前对话使用的模型
    if (state.activeSessionPath) {
      state.sessionModelMap[state.activeSessionPath] = { provider, modelId };
      saveModelMap();
    }
    // 持久化 lastModel，下次启动自动恢复
    try {
      localStorage.setItem('tiffa-lastModel', JSON.stringify({ provider, modelId }));
    } catch {}
  } catch (err) { addNotice('error', `切换模型失败: ${err.message}`); }
  finally {
    state.modelSwitching = false;
    updateInputState();
  }
}

// 从 Tiffa 获取当前模型名并更新顶栏显示（纯读取，不恢复模型）
async function fetchCurrentModel() {
  try {
    const result = await tiffaDesktop.getModels();
    if (result && result.models && result.models.length > 0) {
      const first = result.models[0];
      const name = first.name || first.id || '';
      if (name) {
        state.currentModel = name;
        state.currentProvider = first.provider || '';
        dom.currentModel.textContent = name;
      }
      // 构建可用模型集合（provider + modelId），供 restoreModelIfAvailable 校验
      _availableModelSet = new Set();
      for (const m of result.models) {
        if (m.provider && m.id) _availableModelSet.add(`${m.provider}/${m.id}`);
      }
      _availableModelSetTime = Date.now();
    }
  } catch {}
}

// 启动时的 lastModel 恢复：只在有活跃对话实例时才恢复，避免 setModel 落到错误实例上
// 调用时机：init 完成 + selectProject/switchToSession 激活对话实例之后
async function restoreLastModelIfNeeded() {
  // 没有活跃对话 -> 不恢复（等用户选了对话再说）
  if (!state.activeSessionId) return;
  // 该对话已有 sessionModelMap 记录 -> 用 sessionModelMap 恢复，不用 lastModel
  const activePath = state.activeSessionPath;
  if (activePath && state.sessionModelMap[activePath]) return;
  try {
    const saved = localStorage.getItem('tiffa-lastModel');
    if (!saved) return;
    const last = JSON.parse(saved);
    if (!last || !last.modelId || !last.provider) return;
    // 校验模型在可用列表中
    const availableSet = await getAvailableModelSet();
    if (availableSet && !availableSet.has(`${last.provider}/${last.modelId}`)) {
      console.warn(`[restoreLastModel] 模型 "${last.provider}/${last.modelId}" 不在可用列表中，清除残留`);
      localStorage.removeItem('tiffa-lastModel');
      return;
    }
    // 恢复到当前活跃对话实例
    const restored = await restoreModelIfAvailable(last.provider, last.modelId, state.activeSessionId, state.activeSessionPath);
    if (!restored) {
      localStorage.removeItem('tiffa-lastModel');
    }
  } catch {}
}

async function loadConstraintsPreview() {
  try {
    const result = await tiffaDesktop.readFile((await tiffaDesktop.getRootPath()) + '\\data\\memory\\constraints.md');
    if (result && result.content) {
      const lines = result.content.split('\n').filter(l => l.trim());
      dom.constraintsPreview.innerHTML = `<pre class="constraints-text">${escapeHtml(lines.slice(0, 15).join('\n'))}${lines.length > 15 ? '\n...' : ''}</pre>`;
    } else dom.constraintsPreview.textContent = '暂无约束规则';
  } catch { dom.constraintsPreview.textContent = '无法读取约束文件'; }
}

// ── Model Switcher（带搜索 + 分组） ──
let modelSwitcherCache = null; // 缓存模型列表供搜索过滤

function setupModelSwitcher() {
  dom.currentModel.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.modelSwitcher.classList.toggle('hidden');
    if (!dom.modelSwitcher.classList.contains('hidden')) {
      loadModelSwitcherList();
      const searchInput = document.getElementById('modelSearchInput');
      if (searchInput) {
        searchInput.value = '';
        requestAnimationFrame(() => searchInput.focus());
      }
    }
  });
  document.addEventListener('click', (e) => {
    if (!dom.modelSwitcher.contains(e.target) && e.target !== dom.currentModel) dom.modelSwitcher.classList.add('hidden');
  });
  // 搜索过滤
  const searchInput = document.getElementById('modelSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderModelSwitcherList(searchInput.value.trim().toLowerCase());
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dom.modelSwitcher.classList.add('hidden');
      } else if (e.key === 'Enter') {
        // 选中第一个可见模型
        const first = dom.modelSwitcherList.querySelector('.model-item:not(.empty)');
        if (first) first.click();
      }
    });
  }
}

async function loadModelSwitcherList() {
  dom.modelSwitcherList.innerHTML = '<div class="model-item loading">加载中...</div>';
  try {
    await loadHiddenModels();
    // 确保 modelsConfigData 已加载（用于过滤非用户配置的模型）
    if (!modelsConfigData) {
      try {
        const cfgResult = await tiffaDesktop.readModelsYml();
        if (cfgResult && !cfgResult.error) modelsConfigData = cfgResult.data;
      } catch {}
    }
    const result = await tiffaDesktop.getModels();
    if (result && result.models) {
      modelSwitcherCache = result.models.filter(m => !hiddenModels.has(m.id));
      renderModelSwitcherList('');
    } else dom.modelSwitcherList.innerHTML = '<div class="model-item empty">暂无模型</div>';
  } catch { dom.modelSwitcherList.innerHTML = '<div class="model-item empty">加载失败</div>'; }
}

function renderModelSwitcherList(query) {
  if (!modelSwitcherCache) return;
  dom.modelSwitcherList.innerHTML = '';
  
  // 过滤：优先白名单，否则按 models.yml 中用户配置的模型过滤
  let filtered = modelSwitcherCache;
  const whitelistActive = enabledModels !== undefined;
  if (whitelistActive) {
    filtered = filtered.filter(m => {
      const key = `${m.provider}/${m.id}`;
      const isCurrent = state.currentModel === m.id || state.currentModel === m.name;
      return enabledModels.includes(key) || isCurrent;
    });
  } else if (modelsConfigData && modelsConfigData.providers) {
    // 白名单未配置时，只显示 models.yml 中用户实际配置的模型
    const userModelIds = new Set();
    for (const prov of Object.values(modelsConfigData.providers)) {
      if (prov.models) for (const m of prov.models) userModelIds.add(m.id);
    }
    if (userModelIds.size > 0) {
      const currentId = state.currentModel;
      filtered = filtered.filter(m => userModelIds.has(m.id) || m.id === currentId || m.name === currentId);
    }
  }
  if (query) {
    filtered = filtered.filter(m => {
      const name = (m.name || m.id || '').toLowerCase();
      const provider = (m.provider || '').toLowerCase();
      return name.includes(query) || provider.includes(query);
    });
  }

  if (filtered.length === 0) {
    dom.modelSwitcherList.innerHTML = '<div class="model-item empty">无匹配模型</div>';
    return;
  }

  // 按供应商分组
  const groups = {};
  for (const model of filtered) {
    const prov = model.provider || '其他';
    if (!groups[prov]) groups[prov] = [];
    groups[prov].push(model);
  }

  for (const [provider, models] of Object.entries(groups)) {
    const header = document.createElement('div');
    header.className = 'model-switcher-group-header';
    header.textContent = provider;
    dom.modelSwitcherList.appendChild(header);

    for (const model of models) {
      const div = document.createElement('div');
      div.className = 'model-item';
      if (state.currentModel === model.id || state.currentModel === model.name) div.classList.add('active');
      div.textContent = model.name || model.id;
      div.addEventListener('click', () => {
        switchModel(model.provider, model.id);
        dom.modelSwitcher.classList.add('hidden');
      });
      dom.modelSwitcherList.appendChild(div);
    }
  }
}

// ── Model Config ──
let modelsConfigData = null;

function setupModelConfig() {
  document.getElementById('btnAddProvider').addEventListener('click', () => addProviderUI());
  document.getElementById('btnSaveModels').addEventListener('click', () => saveModelConfig());
  document.getElementById('btnRestartTiffa').addEventListener('click', async () => {
    const s = document.querySelector('.config-status');
    if (s) { s.textContent = '重启中...'; s.className = 'config-status loading'; }
    try {
      const r = await tiffaDesktop.restartTiffa();
      if (s) { s.textContent = r.success ? '已重启' : '重启失败'; s.className = r.success ? 'config-status saved' : 'config-status error'; }
    } catch (err) { if (s) { s.textContent = '重启失败: ' + err.message; s.className = 'config-status error'; } }
    setTimeout(() => { if (s) s.textContent = ''; }, 5000);
  });
}

async function loadModelConfig() {
  const container = document.getElementById('modelConfig');
  container.innerHTML = '<div class="model-item loading">加载中...</div>';
  try {
    const result = await tiffaDesktop.readModelsYml();
    if (result.error) { container.innerHTML = `<div class="model-item empty">读取失败: ${escapeHtml(result.error)}</div>`; return; }
    modelsConfigData = result.data;
    renderModelConfig();
  } catch (err) { container.innerHTML = `<div class="model-item empty">加载失败: ${escapeHtml(err.message)}</div>`; }
}

function renderModelConfig() {
  const container = document.getElementById('modelConfig');
  container.innerHTML = '';
  if (!modelsConfigData || !modelsConfigData.providers) { container.innerHTML = '<div class="model-item empty">暂无供应商配置</div>'; return; }
  for (const [k, v] of Object.entries(modelsConfigData.providers)) container.appendChild(createProviderCard(k, v));
  const s = document.createElement('div'); s.className = 'config-status'; s.style.cssText = 'padding:4px 14px;font-size:12px;';
  container.after(s);
}

function createProviderCard(provKey, provVal) {
  const card = document.createElement('div'); card.className = 'provider-card'; card.dataset.providerKey = provKey;
  const header = document.createElement('div'); header.className = 'provider-header';
  header.innerHTML = `<div><span class="provider-name">${escapeHtml(provKey)}</span><span class="provider-url">${escapeHtml(provVal.baseUrl || '')}</span></div><div style="display:flex;align-items:center;gap:6px;"><span class="provider-toggle">&#9660;</span></div>`;
  header.addEventListener('click', (e) => { if (e.target.closest('.btn-delete-provider')) return; card.querySelector('.provider-body').classList.toggle('open'); card.querySelector('.provider-toggle').classList.toggle('open'); });
  card.appendChild(header);
  const body = document.createElement('div'); body.className = 'provider-body';
  const delBtn = document.createElement('button'); delBtn.className = 'btn-delete-provider'; delBtn.textContent = '删除此供应商'; delBtn.style.cssText = 'float:right;margin-bottom:8px;';
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`确定删除供应商 "${provKey}"？\n这将同时删除 models.yml 中的配置和白名单中的相关模型。`)) return;
    // 用 YAML 注释保留式删除
    const result = await tiffaDesktop.deleteTiffaProvider(provKey);
    if (result.error) { addNotice('error', '删除失败: ' + result.error); return; }
    // 清理白名单中该供应商的孤儿 key
    if (enabledModels && enabledModels.some(k => k.startsWith(`${provKey}/`))) {
      enabledModels = enabledModels.filter(k => !k.startsWith(`${provKey}/`));
      if (enabledModels.length === 0) enabledModels = undefined;
      await saveEnabledModels();
    }
    delete modelsConfigData.providers[provKey];
    card.remove();
    addNotice('success', `已删除供应商 ${provKey}`);
  });
  body.appendChild(delBtn);
  body.appendChild(createConfigField('baseUrl', 'API 地址', provVal.baseUrl || '', 'https://api.example.com/v1'));
  body.appendChild(createConfigField('apiKey', 'API Key（可选）', provVal.apiKey || '', 'sk-xxx'));
  body.appendChild(createConfigField('auth', '认证方式', provVal.auth || '', 'none / bearer'));
  const mDiv = document.createElement('div'); mDiv.style.marginTop = '12px';
  mDiv.innerHTML = '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">模型列表</div>';
  if (provVal.models) for (let i = 0; i < provVal.models.length; i++) mDiv.appendChild(createModelEntry(provKey, i, provVal.models[i]));
  const addBtn = document.createElement('button'); addBtn.className = 'btn-add-model'; addBtn.textContent = '+ 添加模型';
  addBtn.addEventListener('click', () => {
    addModelDialog(provKey, () => { document.getElementById('modelConfig').innerHTML = ''; renderModelConfig(); });
  });
  // "从服务器拉取模型"按钮
  const fetchBtn = document.createElement('button'); fetchBtn.className = 'btn-add-model'; fetchBtn.textContent = '从服务器拉取模型';
  fetchBtn.style.cssText = 'margin-left:6px;border-style:dashed;';
  const fetchStatusDiv = document.createElement('div'); fetchStatusDiv.style.cssText = 'font-size:11px;color:var(--text-muted);margin:4px 0;display:none;';
  const fetchListDiv = document.createElement('div'); fetchListDiv.style.cssText = 'display:none;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin:6px 0;';
  fetchBtn.addEventListener('click', async () => {
    const baseUrl = provVal.baseUrl || '';
    const apiKey = provVal.apiKey || '';
    if (!baseUrl) { addNotice('error', '请先填写 API 地址'); return; }
    fetchBtn.disabled = true; fetchStatusDiv.style.display = 'block'; fetchStatusDiv.textContent = '正在拉取...'; fetchStatusDiv.style.color = 'var(--text-muted)';
    const result = await tiffaDesktop.fetchProviderModels(baseUrl, apiKey);
    fetchBtn.disabled = false;
    if (result.error) { fetchStatusDiv.textContent = '拉取失败: ' + result.error; fetchStatusDiv.style.color = 'var(--danger)'; return; }
    const models = result.models || [];
    if (models.length === 0) { fetchStatusDiv.textContent = '服务器返回空列表'; return; }
    // 过滤掉已存在的模型
    const existIds = new Set((provVal.models || []).map(m => m.id));
    const newModels = models.filter(m => !existIds.has(m.id));
    if (newModels.length === 0) { fetchStatusDiv.textContent = '服务器模型全部已添加'; fetchListDiv.style.display = 'none'; return; }
    fetchStatusDiv.textContent = `找到 ${models.length} 个模型，${existIds.size > 0 ? models.length - newModels.length + ' 个已存在，' : ''}${newModels.length} 个可添加：勾选后点确认`;
    fetchListDiv.style.display = 'block'; fetchListDiv.innerHTML = '';
    const checked = new Map();
    for (const m of newModels) {
      checked.set(m.id, false);
      const row = document.createElement('label'); row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;cursor:pointer;font-size:12px;color:var(--text-secondary);';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.addEventListener('change', () => { checked.set(m.id, cb.checked); updateConfirmState(); });
      row.appendChild(cb); row.appendChild(document.createTextNode(m.id));
      fetchListDiv.appendChild(row);
    }
    const confirmRow = document.createElement('div'); confirmRow.style.cssText = 'margin-top:6px;';
    const confirmAddBtn = document.createElement('button'); confirmAddBtn.textContent = '添加勾选的模型'; confirmAddBtn.style.cssText = 'padding:4px 10px;border:1px solid var(--accent);border-radius:4px;background:var(--accent);color:white;cursor:pointer;font-size:12px;';
    confirmAddBtn.disabled = true; confirmAddBtn.style.opacity = '0.5';
    const updateConfirmState = () => { const any = [...checked.values()].some(v => v); confirmAddBtn.disabled = !any; confirmAddBtn.style.opacity = any ? '1' : '0.5'; };
    confirmAddBtn.addEventListener('click', async () => {
      const toAdd = [...checked.entries()].filter(([,v]) => v).map(([id]) => id);
      if (!modelsConfigData.providers[provKey].models) modelsConfigData.providers[provKey].models = [];
      const newModelMap = new Map(newModels.map(x => [x.id, x]));
      for (const id of toAdd) {
        const src = newModelMap.get(id);
        const reasoning = (src && src.reasoning) || false;
        modelsConfigData.providers[provKey].models.push({ id, name: id, reasoning, input: ['text'], supportsTools: true, contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
      }
      fetchListDiv.style.display = 'none'; fetchStatusDiv.style.display = 'none';
      await saveModelConfig();
      document.getElementById('modelConfig').innerHTML = ''; renderModelConfig();
      addNotice('success', `已添加 ${toAdd.length} 个模型到 ${provKey}`);
    });
    confirmRow.appendChild(confirmAddBtn); fetchListDiv.appendChild(confirmRow);
  });
  const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
  btnRow.appendChild(addBtn); btnRow.appendChild(fetchBtn);
  mDiv.appendChild(btnRow); mDiv.appendChild(fetchStatusDiv); mDiv.appendChild(fetchListDiv); body.appendChild(mDiv); card.appendChild(body);
  return card;
}

function addModelDialog(provKey, onDone) {
  // 使用 position: fixed 挂到 body，避免 settings-panel overflow:hidden 导致输入框无法交互
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1100;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:20px;width:320px;';
  box.innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:12px;">添加模型</div>
    <label style="font-size:12px;color:var(--text-muted);">模型 ID</label>
    <input id="dlgModelId" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" placeholder="gpt-4o">
    <label style="font-size:12px;color:var(--text-muted);">显示名称</label>
    <input id="dlgModelName" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" placeholder="GPT-4o">
    <label style="font-size:12px;color:var(--text-muted);">上下文长度</label>
    <input id="dlgModelCtx" type="number" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" value="128000">
    <label style="font-size:12px;color:var(--text-muted);">最大输出</label>
    <input id="dlgModelMax" type="number" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" value="8192">
    <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin:4px 0 16px;cursor:pointer;"><input id="dlgModelReasoning" type="checkbox" style="width:16px;height:16px;accent-color:var(--accent);"> 启用思考模式（推理模型回答前会先思考）</label>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="dlgCancel" style="padding:6px 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">取消</button>
      <button id="dlgOk" style="padding:6px 16px;border:none;border-radius:4px;background:var(--accent);color:white;cursor:pointer;">添加</button>
    </div>`;
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  const idInput = box.querySelector('#dlgModelId');
  setTimeout(() => idInput.focus(), 50);

  const close = () => backdrop.remove();
  box.querySelector('#dlgCancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const submit = async () => {
    const id = box.querySelector('#dlgModelId').value.trim();
    if (!id) { addNotice('error', '模型 ID 不能为空'); return; }
    const name = box.querySelector('#dlgModelName').value.trim() || id;
    const ctx = parseInt(box.querySelector('#dlgModelCtx').value) || 128000;
    const max = parseInt(box.querySelector('#dlgModelMax').value) || 8192;
    const reasoning = box.querySelector('#dlgModelReasoning').checked;
    if (!modelsConfigData.providers[provKey].models) modelsConfigData.providers[provKey].models = [];
    modelsConfigData.providers[provKey].models.push({ id, name, reasoning, input: ['text'], supportsTools: true, contextWindow: ctx, maxTokens: max, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    close();
    onDone();
    await saveModelConfig();
  };

  box.querySelector('#dlgOk').addEventListener('click', submit);
  box.querySelector('#dlgModelId').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  box.querySelector('#dlgModelName').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

function createConfigField(key, label, value, placeholder) {
  const div = document.createElement('div'); div.className = 'config-field'; div.dataset.fieldKey = key;
  div.innerHTML = `<label>${escapeHtml(label)}</label><input type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" data-field="${escapeHtml(key)}">`;
  return div;
}

function createModelEntry(provKey, idx, model) {
  const div = document.createElement('div'); div.className = 'model-entry';
  const thinkBadge = model.reasoning ? ' | 思考' : '';
  div.innerHTML = `<span class="model-entry-id">${escapeHtml(model.id || '')}</span><span class="model-entry-meta">${escapeHtml(model.name || '')} | ${model.contextWindow || '?'}ctx${thinkBadge}</span>`;
  const del = document.createElement('button'); del.className = 'model-entry-delete'; del.textContent = 'x';
  del.addEventListener('click', (e) => { e.stopPropagation(); if (confirm(`确定删除模型 "${model.id}"？`)) { modelsConfigData.providers[provKey].models.splice(idx, 1); document.getElementById('modelConfig').innerHTML = ''; renderModelConfig(); } });
  div.appendChild(del);
  let editing = false;
  div.addEventListener('click', (e) => {
    if (editing) return; // 编辑中不再触发
    if (e.target.classList.contains('model-entry-delete')) return;
    editing = true;
    editModelInline(div, provKey, idx, model, () => { editing = false; });
  });
  return div;
}

function editModelInline(container, provKey, idx, model, onDone) {
  container.innerHTML = ''; container.style.cssText = 'flex-direction:column;align-items:stretch;gap:4px;';
  const fields = [
    { key: 'id', label: 'ID', value: model.id || '' },
    { key: 'name', label: '名称', value: model.name || '' },
    { key: 'contextWindow', label: '上下文', value: String(model.contextWindow || 128000), type: 'number' },
    { key: 'maxTokens', label: '最大输出', value: String(model.maxTokens || 8192), type: 'number' },
    { key: 'reasoning', label: '思考模式', checked: !!model.reasoning, type: 'checkbox' },
  ];
  const inputs = {};
  for (const f of fields) {
    const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:6px;';
    row.innerHTML = `<label style="width:60px;font-size:11px;color:var(--text-muted);flex-shrink:0;">${escapeHtml(f.label)}</label>`;
    let inp;
    if (f.type === 'checkbox') {
      inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = f.checked;
      inp.style.cssText = 'width:16px;height:16px;accent-color:var(--accent);cursor:pointer;';
    } else {
      inp = document.createElement('input'); inp.type = f.type === 'number' ? 'number' : 'text'; inp.value = f.value;
      inp.style.cssText = 'flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;';
    }
    inputs[f.key] = inp; row.appendChild(inp); container.appendChild(row);
  }
  const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:6px;margin-top:4px;';
  const saveBtn = document.createElement('button'); saveBtn.className = 'settings-btn'; saveBtn.textContent = '保存';
  saveBtn.style.cssText = 'font-size:12px;padding:3px 10px;background:var(--accent);color:white;border-color:var(--accent);';
  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const m = modelsConfigData.providers[provKey].models[idx];
    m.id = inputs.id.value; m.name = inputs.name.value;
    m.contextWindow = parseInt(inputs.contextWindow.value) || 128000;
    m.maxTokens = parseInt(inputs.maxTokens.value) || 8192;
    m.reasoning = !!inputs.reasoning.checked;
    if (onDone) onDone();
    document.getElementById('modelConfig').innerHTML = ''; renderModelConfig();
    await saveModelConfig();
  });
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'settings-btn'; cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'font-size:12px;padding:3px 10px;';
  cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); if (onDone) onDone(); document.getElementById('modelConfig').innerHTML = ''; renderModelConfig(); });
  btnRow.appendChild(saveBtn); btnRow.appendChild(cancelBtn); container.appendChild(btnRow);
}

// ── 供应商预设库（37 个预设，来自 Tiffa 17.x 源码） ──
const PROVIDER_PRESETS = [
  // 热门
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', api: 'openai-completions', authUrl: 'https://platform.deepseek.com/api_keys', hint: 'sk-...', cat: '热门' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', authUrl: 'https://platform.openai.com/api-keys', hint: 'sk-...', cat: '热门' },
  { id: 'anthropic', name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', api: 'openai-completions', authUrl: 'https://console.anthropic.com/settings/keys', hint: 'sk-ant-...', cat: '热门' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', authUrl: 'https://openrouter.ai/keys', hint: 'sk-or-...', cat: '热门' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions', authUrl: 'https://console.groq.com/keys', hint: 'gsk_...', cat: '热门' },
  { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', api: 'openai-completions', authUrl: 'https://console.x.ai/', hint: 'xai-...', cat: '热门' },
  { id: 'moonshot', name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.ai/v1', api: 'openai-completions', authUrl: 'https://platform.moonshot.ai/console/api-keys', hint: 'sk-...', cat: '热门' },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions', authUrl: 'https://cloud.cerebras.ai/platform/', hint: 'csk-...', cat: '热门' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions', authUrl: 'https://fireworks.ai/account/api-keys', hint: 'fw_...', cat: '热门' },
  { id: 'mistral', name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions', authUrl: 'https://console.mistral.ai/api-keys/', hint: '...', cat: '热门' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', api: 'openai-completions', authUrl: 'https://api.together.xyz/settings/api-keys', hint: '...', cat: '热门' },
  { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions', authUrl: 'https://build.nvidia.com/', hint: 'nvapi-...', cat: '热门' },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', api: 'openai-completions', authUrl: 'https://huggingface.co/settings/tokens', hint: 'hf_...', cat: '热门' },
  { id: 'google', name: 'Google (Gemini)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'openai-completions', authUrl: 'https://aistudio.google.com/app/apikey', hint: 'AIza...', cat: '热门' },
  // 国内服务商
  { id: 'zhipu-coding-plan', name: '智谱 GLM (Coding Plan)', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', api: 'openai-completions', authUrl: 'https://open.bigmodel.cn/usercenter/apikeys', hint: '...', cat: '国内' },
  { id: 'zai', name: '智谱 zAI (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', authUrl: 'https://open.bigmodel.cn/usercenter/apikeys', hint: '...', cat: '国内' },
  { id: 'qianfan', name: '百度千帆 (Qianfan)', baseUrl: 'https://qianfan.baidubce.com/v2', api: 'openai-completions', authUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application', hint: '...', cat: '国内' },
  { id: 'firepass', name: 'Fire Pass (Kimi K2 Turbo)', baseUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions', authUrl: 'https://fireworks.ai/firepass', hint: 'fpk_...', cat: '国内' },
  { id: 'xiaomi', name: '小米 (Xiaomi)', baseUrl: 'https://api.xiaomi.com/v1', api: 'openai-completions', authUrl: 'https://platform.mi.com/', hint: '...', cat: '国内' },
  { id: 'minimax-code', name: 'MiniMax Code', baseUrl: 'https://api.minimax.chat/v1', api: 'openai-completions', authUrl: 'https://platform.minimaxi.com/document/Account%20&%20Keys', hint: '...', cat: '国内' },
  { id: 'minimax-code-cn', name: 'MiniMax Code CN', baseUrl: 'https://api.minimaxi.chat/v1', api: 'openai-completions', authUrl: 'https://platform.minimaxi.com/document/Account%20&%20Keys', hint: '...', cat: '国内' },
  { id: 'sakana', name: 'Sakana AI', baseUrl: 'https://api.sakana.ai/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: '国内' },
  { id: 'siliconflow', name: 'SiliconFlow (硅基流动)', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions', authUrl: 'https://cloud.siliconflow.cn/account/ak', hint: 'sk-...', cat: '国内' },
  { id: 'dashscope', name: '阿里 DashScope (通义)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', authUrl: 'https://dashscope.console.aliyun.com/apiKey', hint: 'sk-...', cat: '国内' },
  // 本地 / 自托管
  { id: 'ollama', name: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434', api: 'openai-completions', authUrl: '', hint: '（本地服务可留空）', cat: '本地' },
  { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', api: 'openai-completions', authUrl: '', hint: '（本地服务可留空）', cat: '本地' },
  { id: 'vllm', name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', api: 'openai-completions', authUrl: '', hint: '（本地服务可留空）', cat: '本地' },
  { id: 'llama-cpp', name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080', api: 'openai-completions', authUrl: '', hint: '（本地服务可留空）', cat: '本地' },
  { id: 'ollama-cloud', name: 'Ollama Cloud', baseUrl: 'https://cloud.ollama.com', api: 'openai-completions', authUrl: '', hint: '...', cat: '本地' },
  // 其他
  { id: 'novita', name: 'Novita', baseUrl: 'https://api.novita.ai/openai/v1', api: 'openai-completions', authUrl: 'https://novita.ai/playground/key', hint: '...', cat: '其他' },
  { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', api: 'openai-completions', authUrl: '', hint: 'ppl-...', cat: '其他' },
  { id: 'litellm', name: 'LiteLLM Proxy', baseUrl: 'http://127.0.0.1:4000/v1', api: 'openai-completions', authUrl: '', hint: '（本地代理可留空）', cat: '其他' },
  { id: 'azure', name: 'Azure OpenAI', baseUrl: '', api: 'openai-completions', authUrl: '', hint: '（需 Azure 凭证）', cat: '其他' },
];

// 不需要 API Key 的 api 类型
const NO_KEY_NEEDED_APIS = new Set(['ollama-chat', 'bedrock-converse-stream', 'azure-openai-responses', 'google-vertex']);

// ── 模型白名单系统（三态：undefined=全部显示 / []=已激活空 / [...]=子集） ──
// 持久化到 enabled-models.json
const ENABLED_MODELS_FILE = 'enabled-models.json';
let enabledModels = undefined; // undefined = 未配置白名单

async function loadEnabledModels() {
  try {
    const root = await tiffaDesktop.getRootPath();
    const result = await tiffaDesktop.readFile(root + '\\data\\agent\\' + ENABLED_MODELS_FILE);
    if (result && result.content) {
      const arr = JSON.parse(result.content);
      // 空数组等同于未配置白名单，避免误操作导致看不到任何模型
      if (Array.isArray(arr) && arr.length > 0) enabledModels = arr;
    }
  } catch { enabledModels = undefined; }
}

async function saveEnabledModels() {
  try {
    const root = await tiffaDesktop.getRootPath();
    await tiffaDesktop.writeFile(root + '\\data\\agent\\' + ENABLED_MODELS_FILE, JSON.stringify(enabledModels || []));
  } catch {}
}

// ── 2 步添加供应商向导 ──
function addProviderUI() {
  const overlay = document.createElement('div');
  overlay.className = 'add-model-overlay';
  overlay.innerHTML = `<div class="add-model-modal"></div>`;
  const modal = overlay.querySelector('.add-model-modal');
  document.body.appendChild(overlay);

  // 向导状态
  let step = 1;
  let selectedPreset = null; // null=预设列表, 'custom'=自定义, object=选中预设
  let pid = '', name = '', baseUrl = '', api = 'openai-completions', apiKey = '', manualIds = '';
  let discovered = []; // 第 2 步发现的模型
  let checked = new Set();
  let savedManualIds = []; // 跨步传递
  let polling = false;
  let pollTimer = null;

  const close = () => {
    if (pollTimer) clearTimeout(pollTimer);
    overlay.remove();
  };

  overlay.addEventListener('click', (e) => { if (e.target === overlay && !polling) close(); });

  function render() {
    if (step === 1) renderStep1();
    else renderStep2();
  }

  function renderStep1() {
    if (selectedPreset === null) {
      // 阶段 A：预设选择
      const groups = {};
      for (const p of PROVIDER_PRESETS) {
        if (!groups[p.cat]) groups[p.cat] = [];
        groups[p.cat].push(p);
      }
      const catOrder = ['热门', '国内', '本地', '其他'];
      let presetHtml = '';
      for (const cat of catOrder) {
        if (!groups[cat]) continue;
        presetHtml += `<div class="preset-group"><div class="preset-group-label">${cat}</div><div class="preset-items">`;
        for (const p of groups[cat]) {
          presetHtml += `<button class="preset-card" data-pid="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}\n${escapeHtml(p.baseUrl)}\nAPI: ${escapeHtml(p.api)}${p.authUrl ? '\n点击前往获取 API Key' : ''}">
            <span class="preset-name">${escapeHtml(p.name)}</span>
            <span class="preset-id">${escapeHtml(p.id)}</span>
          </button>`;
        }
        presetHtml += '</div></div>';
      }

      modal.innerHTML = `
        <div class="add-model-head">
          <span class="modal-title">添加模型</span>
          <span class="add-model-subtitle">选择已知提供商或自定义</span>
          <button class="settings-close" id="addModelClose">&times;</button>
        </div>
        <div class="add-model-form">
          <div class="preset-search">
            <input class="form-input" id="presetSearchInput" placeholder="搜索提供商（如 deepseek、kimi、ollama）..." autocomplete="off">
          </div>
          <div class="preset-grid" id="presetGrid">${presetHtml}</div>
          <div class="preset-custom-divider"><span>或</span></div>
          <button class="settings-btn preset-custom-btn" id="customProviderBtn" style="width:100%;padding:10px;">+ 自定义提供商（手动填写所有字段）</button>
        </div>`;

      modal.querySelector('#addModelClose').addEventListener('click', close);
      modal.querySelector('#customProviderBtn').addEventListener('click', () => {
        selectedPreset = 'custom'; pid = ''; name = ''; baseUrl = ''; api = 'openai-completions'; apiKey = ''; manualIds = '';
        render();
      });
      // 预设卡片点击
      modal.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', () => {
          const p = PROVIDER_PRESETS.find(x => x.id === card.dataset.pid);
          if (!p) return;
          selectedPreset = p; pid = p.id; name = p.name; baseUrl = p.baseUrl; api = p.api; apiKey = ''; manualIds = '';
          render();
        });
      });
      // 搜索过滤
      const searchInput = modal.querySelector('#presetSearchInput');
      searchInput.focus();
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        modal.querySelectorAll('.preset-card').forEach(card => {
          const pid = card.dataset.pid.toLowerCase();
          const pname = card.querySelector('.preset-name').textContent.toLowerCase();
          card.style.display = (!q || pid.includes(q) || pname.includes(q)) ? '' : 'none';
        });
        modal.querySelectorAll('.preset-group').forEach(g => {
          const visible = g.querySelectorAll('.preset-card:not([style*="none"])').length;
          g.style.display = visible > 0 ? '' : 'none';
        });
      });
    } else {
      // 阶段 B：表单
      const isCustom = selectedPreset === 'custom';
      const preset = isCustom ? null : selectedPreset;
      const noKeyNeeded = NO_KEY_NEEDED_APIS.has(api);
      const pidValid = /^[a-zA-Z0-9_-]+$/.test(pid);
      const canSave = pidValid && baseUrl.trim() && (apiKey.trim() || noKeyNeeded);
      const hasManualIds = manualIds.split(/[,\s]+/).some(s => s.trim());

      modal.innerHTML = `
        <div class="add-model-head">
          <span class="modal-title">添加模型</span>
          <span class="add-model-subtitle">配置「${isCustom ? '自定义' : escapeHtml(preset.name)}」</span>
          <button class="settings-close" id="addModelClose">&times;</button>
        </div>
        <div class="add-model-form">
          <div class="preset-selected-bar">
            <span>${isCustom ? '自定义提供商' : escapeHtml(preset.name) + ' (ID: ' + escapeHtml(preset.id) + ')'}</span>
            ${preset && preset.authUrl ? `<button class="settings-btn" id="authUrlBtn" style="font-size:12px;padding:2px 8px;">获取 API Key</button>` : ''}
            <button class="settings-btn" id="changePresetBtn" style="font-size:12px;padding:2px 8px;margin-left:auto;">换一个</button>
          </div>
          <label class="form-field">
            <span class="form-label">提供商 ID *</span>
            <input class="form-input" id="fldPid" placeholder="如 deepseek（字母/数字/-/_）" value="${escapeHtml(pid)}" ${isCustom ? '' : 'disabled'}>
          </label>
          <label class="form-field">
            <span class="form-label">显示名</span>
            <input class="form-input" id="fldName" placeholder="如 深度求索（可选）" value="${escapeHtml(name)}">
          </label>
          <label class="form-field">
            <span class="form-label">API 地址 (baseUrl) *</span>
            <input class="form-input" id="fldUrl" placeholder="https://api.example.com/v1" value="${escapeHtml(baseUrl)}">
          </label>
          <label class="form-field">
            <span class="form-label">API 类型</span>
            <select class="form-input" id="fldApi">
              <option value="openai-completions" ${api === 'openai-completions' ? 'selected' : ''}>OpenAI 兼容 (openai-completions)</option>
              <option value="ollama-chat" ${api === 'ollama-chat' ? 'selected' : ''}>Ollama (ollama-chat)</option>
              <option value="openrouter" ${api === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
            </select>
          </label>
          <label class="form-field">
            <span class="form-label">API Key ${noKeyNeeded ? '（可留空）' : '*'}</span>
            <input class="form-input" id="fldKey" type="password" placeholder="${preset ? '输入 ' + escapeHtml(preset.name) + ' API Key' : '输入 API Key'}" value="${escapeHtml(apiKey)}">
            ${preset && preset.hint ? `<span class="form-hint">格式提示：${escapeHtml(preset.hint)}</span>` : ''}
          </label>
          <label class="form-field">
            <span class="form-label">模型 ID（可选，逗号分隔）</span>
            <input class="form-input" id="fldManualIds" placeholder="如 deepseek-v4-pro；留空则尝试自动获取" value="${escapeHtml(manualIds)}">
            <span class="form-hint">${hasManualIds ? '已填模型 ID，可直接「仅保存」' : '留空则依赖自动发现'}</span>
          </label>
          <div class="add-model-actions">
            <button class="settings-btn" id="btnBack">返回</button>
            <button class="settings-btn" id="btnCancel">取消</button>
            ${hasManualIds ? '<button class="settings-btn btn-primary" id="btnSaveOnly">仅保存</button>' : ''}
            <button class="settings-btn btn-primary" id="btnSaveFetch" ${canSave ? '' : 'disabled'}>保存并获取模型列表</button>
          </div>
        </div>`;

      // 绑定字段
      const updateField = (id, handler) => {
        const el = modal.querySelector(id);
        if (el) el.addEventListener('input', () => { handler(el.value); renderActions(); });
      };
      updateField('#fldPid', v => pid = v);
      updateField('#fldName', v => name = v);
      updateField('#fldUrl', v => baseUrl = v);
      updateField('#fldKey', v => apiKey = v);
      updateField('#fldManualIds', v => manualIds = v);
      const apiSelect = modal.querySelector('#fldApi');
      if (apiSelect) apiSelect.addEventListener('change', () => { api = apiSelect.value; render(); });

      modal.querySelector('#addModelClose').addEventListener('click', close);
      modal.querySelector('#btnCancel').addEventListener('click', close);
      modal.querySelector('#btnBack').addEventListener('click', () => { selectedPreset = null; render(); });
      modal.querySelector('#changePresetBtn').addEventListener('click', () => { selectedPreset = null; render(); });
      if (preset && preset.authUrl) modal.querySelector('#authUrlBtn')?.addEventListener('click', () => tiffaDesktop.openExternal(preset.authUrl));

      const saveFetchBtn = modal.querySelector('#btnSaveFetch');
      const saveOnlyBtn = modal.querySelector('#btnSaveOnly');
      if (saveFetchBtn) saveFetchBtn.addEventListener('click', onSaveAndFetch);
      if (saveOnlyBtn) saveOnlyBtn.addEventListener('click', onSaveOnly);
    }
  }

  function renderActions() {
    // 重新计算按钮状态
    const pidValid = /^[a-zA-Z0-9_-]+$/.test(pid);
    const noKeyNeeded = NO_KEY_NEEDED_APIS.has(api);
    const canSave = pidValid && baseUrl.trim() && (apiKey.trim() || noKeyNeeded);
    const btn = modal.querySelector('#btnSaveFetch');
    if (btn) btn.disabled = !canSave;
  }

  function buildConfig() {
    const cfg = { baseUrl: baseUrl.trim(), api };
    if (name.trim()) cfg.name = name.trim();
    if (apiKey.trim()) cfg.apiKey = apiKey.trim();
    else if (!NO_KEY_NEEDED_APIS.has(api)) cfg.auth = 'none';
    const ids = manualIds.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) cfg.models = ids.map(id => ({ id }));
    return cfg;
  }

  async function onSaveAndFetch() {
    const cfg = buildConfig();
    savedManualIds = manualIds.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    try {
      const result = await tiffaDesktop.writeTiffaProvider(pid.trim(), cfg);
      if (result.error) { addNotice('error', '写入失败: ' + result.error); return; }
      addNotice('success', `供应商 ${pid} 已保存，正在获取模型列表...`);
      step = 2;
      // 预填手动 ID 作为 fallback
      if (savedManualIds.length > 0) {
        discovered = savedManualIds.map(id => ({ provider: pid.trim(), id, name: id }));
        checked = new Set(discovered.map(m => `${m.provider}/${m.id}`));
      }
      render();
      pollModels(pid.trim());
    } catch (e) { addNotice('error', '保存失败: ' + e.message); }
  }

  async function onSaveOnly() {
    const cfg = buildConfig();
    try {
      const result = await tiffaDesktop.writeTiffaProvider(pid.trim(), cfg);
      if (result.error) { addNotice('error', '写入失败: ' + result.error); return; }
      // 手动 ID 直接入白名单
      const ids = manualIds.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        const keys = ids.map(id => `${pid.trim()}/${id}`);
        if (enabledModels !== undefined) {
          enabledModels = [...new Set([...enabledModels, ...keys])];
        } else {
          enabledModels = keys;
        }
        await saveEnabledModels();
      }
      addNotice('success', `供应商 ${pid} 已保存`);
      close();
      loadModelConfig();
      loadModelSwitcherList();
    } catch (e) { addNotice('error', '保存失败: ' + e.message); }
  }

  function pollModels(providerId, attempt = 0) {
    polling = true;
    tiffaDesktop.getModels().then(result => {
      const list = (result && result.models ? result.models : []).filter(m => m.provider === providerId);
      if (list.length > 0) {
        discovered = list;
        checked = new Set(list.map(m => `${m.provider}/${m.id}`));
        polling = false;
        render();
      } else if (attempt < 6) {
        pollTimer = setTimeout(() => pollModels(providerId, attempt + 1), 1500);
      } else {
        polling = false;
        render();
      }
    }).catch(() => {
      if (attempt < 6) pollTimer = setTimeout(() => pollModels(providerId, attempt + 1), 1500);
      else { polling = false; render(); }
    });
  }

  function renderStep2() {
    const pidVal = pid.trim();
    if (polling) {
      modal.innerHTML = `
        <div class="add-model-head">
          <span class="modal-title">添加模型</span>
          <span class="add-model-subtitle">正在获取 ${escapeHtml(pidVal)} 的模型列表...</span>
          <button class="settings-close" id="addModelClose">&times;</button>
        </div>
        <div class="add-model-form"><div class="model-config-busy">正在获取模型列表...</div></div>`;
      modal.querySelector('#addModelClose').addEventListener('click', close);
      return;
    }

    if (discovered.length === 0 && savedManualIds.length === 0) {
      modal.innerHTML = `
        <div class="add-model-head">
          <span class="modal-title">添加模型</span>
          <span class="add-model-subtitle">选择要启用的模型（${escapeHtml(pidVal)}）</span>
          <button class="settings-close" id="addModelClose">&times;</button>
        </div>
        <div class="add-model-form">
          <div class="model-config-error">未能获取到「${escapeHtml(pidVal)}」的模型列表。可能原因：API Key / baseUrl 有误，或该端点不支持自动发现。可返回上一步手动填写模型 ID 后点击「仅保存」。</div>
          <div class="add-model-actions">
            <button class="settings-btn" id="btnPrev">上一步</button>
            <button class="settings-btn" id="btnRetry">重试获取</button>
            <button class="settings-btn btn-primary" id="btnFinish">完成</button>
          </div>
        </div>`;
      modal.querySelector('#addModelClose').addEventListener('click', close);
      modal.querySelector('#btnPrev').addEventListener('click', () => { step = 1; render(); });
      modal.querySelector('#btnRetry').addEventListener('click', () => { pollModels(pidVal); render(); });
      modal.querySelector('#btnFinish').addEventListener('click', onFinish);
      return;
    }

    const allChecked = discovered.length > 0 && discovered.every(m => checked.has(`${m.provider}/${m.id}`));
    let listHtml = '';
    if (discovered.length > 0) {
      listHtml = `<label class="provider-model-row all-toggle">
        <input type="checkbox" id="toggleAll" ${allChecked ? 'checked' : ''}>
        <span class="provider-model-name">全选（${checked.size}/${discovered.length}）</span>
      </label>
      <div class="add-model-list">`;
      for (const m of discovered) {
        const key = `${m.provider}/${m.id}`;
        listHtml += `<label class="provider-model-row" title="${escapeHtml(key)}">
          <input type="checkbox" class="model-check" data-key="${escapeHtml(key)}" ${checked.has(key) ? 'checked' : ''}>
          <span class="provider-model-name">${escapeHtml(m.name || m.id)}</span>
        </label>`;
      }
      listHtml += '</div>';
    }

    modal.innerHTML = `
      <div class="add-model-head">
        <span class="modal-title">添加模型</span>
        <span class="add-model-subtitle">选择要启用的模型（${escapeHtml(pidVal)}）</span>
        <button class="settings-close" id="addModelClose">&times;</button>
      </div>
      <div class="add-model-form">
        ${listHtml}
        ${savedManualIds.length > 0 && discovered.length === 0 ? `<div class="form-hint">自动获取失败，但已使用你填写的 ${savedManualIds.length} 个手动模型 ID</div>` : ''}
        <div class="add-model-actions">
          <button class="settings-btn" id="btnPrev">上一步</button>
          <button class="settings-btn btn-primary" id="btnFinish">完成</button>
        </div>
      </div>`;

    modal.querySelector('#addModelClose').addEventListener('click', close);
    modal.querySelector('#btnPrev').addEventListener('click', () => { step = 1; render(); });
    modal.querySelector('#btnFinish').addEventListener('click', onFinish);

    // 全选切换
    const toggleAll = modal.querySelector('#toggleAll');
    if (toggleAll) {
      toggleAll.addEventListener('change', () => {
        if (toggleAll.checked) checked = new Set(discovered.map(m => `${m.provider}/${m.id}`));
        else checked = new Set();
        render();
      });
    }
    // 单个切换
    modal.querySelectorAll('.model-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.key;
        if (cb.checked) checked.add(key);
        else checked.delete(key);
        render();
      });
    });
  }

  async function onFinish() {
    const providerPrefix = `${pid.trim()}/`;
    const checkedKeys = Array.from(checked);
    const allKeys = checkedKeys.length > 0
      ? checkedKeys
      : savedManualIds.map(id => `${pid.trim()}/${id}`);

    // 供应商范围替换：只替换该供应商的 key，保留其他供应商
    if (enabledModels !== undefined) {
      enabledModels = [...new Set([
        ...enabledModels.filter(k => !k.startsWith(providerPrefix)),
        ...allKeys,
      ])];
    } else {
      enabledModels = allKeys.length > 0 ? allKeys : undefined;
    }
    await saveEnabledModels();
    addNotice('success', `已保存 ${pid.trim()} 的模型白名单`);
    close();
    loadModelConfig();
    loadModelSwitcherList();
  }

  render();
}

async function saveModelConfig() {
  const s = document.querySelector('.config-status');
  if (s) { s.textContent = '保存中...'; s.className = 'config-status loading'; }
  document.querySelectorAll('.provider-card').forEach(card => {
    const pk = card.dataset.providerKey; if (!pk || !modelsConfigData.providers[pk]) return;
    const prov = modelsConfigData.providers[pk];
    card.querySelectorAll('.config-field').forEach(field => {
      const input = field.querySelector('input'); if (!input) return;
      const key = input.dataset.field; const value = input.value.trim();
      if (key === 'apiKey') { prov.apiKey = value || 'none'; delete prov.auth; }
      else if (key === 'auth') { /* 忽略 auth 字段，统一用 apiKey */ }
      else if (key && value) prov[key] = value;
    });
  });
  try {
    const yaml = serializeModelsYaml(modelsConfigData);
    const result = await tiffaDesktop.writeModelsYml(yaml);
    if (result.success) { if (s) { s.textContent = '已保存'; s.className = 'config-status saved'; } }
    else { if (s) { s.textContent = '保存失败: ' + (result.error || ''); s.className = 'config-status error'; } }
  } catch (err) { if (s) { s.textContent = '保存失败: ' + err.message; s.className = 'config-status error'; } }
  setTimeout(() => { if (s) s.textContent = ''; }, 8000);
}

function serializeModelsYaml(data) {
  const lines = ['# Tiffa models.yml', ''];
  if (!data || !data.providers) return lines.join('\n');
  lines.push('providers:');
  for (const [k, p] of Object.entries(data.providers)) {
    lines.push(`  ${k}:`, `    baseUrl: "${p.baseUrl || ''}"`, `    api: "${p.api || 'custom-openai'}"`);
    if (p.apiKey) lines.push(`    apiKey: "${p.apiKey}"`);
    if (p.models && p.models.length > 0) {
      lines.push(`    models:`);
      for (const m of p.models) {
        lines.push(`      - id: "${m.id || ''}"`, `        name: "${m.name || m.id || ''}"`, `        reasoning: ${m.reasoning ? 'true' : 'false'}`, `        input:`, ...(m.input || ['text']).map(i => `          - "${i}"`), `        supportsTools: ${m.supportsTools ? 'true' : 'false'}`, `        contextWindow: ${m.contextWindow || 128000}`, `        maxTokens: ${m.maxTokens || 8192}`, `        cost:`, `          input: ${(m.cost && m.cost.input) || 0}`, `          output: ${(m.cost && m.cost.output) || 0}`, `          cacheRead: ${(m.cost && m.cost.cacheRead) || 0}`, `          cacheWrite: ${(m.cost && m.cost.cacheWrite) || 0}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── Start ──
try { init(); console.log('[渲染] init() ok'); }
catch (err) { console.error('[渲染] init() fail:', err); document.getElementById('statusText').textContent = '初始化失败: ' + err.message; }
