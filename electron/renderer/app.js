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
  ompReady: false,
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
  previewTabs: [],
  activePreviewIndex: -1,
  sidebarCollapsed: true,
  // Project/Session
  projects: [],
  activeProjectDirName: null,
  sessions: [],          // 当前项目全部会话（含活跃和非活跃）
  activeSessionPath: null,
  activeSessionPaths: new Set(),  // 顶栏活跃tab（最多5个）
  historyCollapsed: true,         // 历史对话面板折叠状态
  workspacePath: '',
  // 每个对话记住的模型 { provider, modelId }
  sessionModelMap: {},
  // XML 翻译开关
  xmlTranslationEnabled: false,
  // 每个实例(cwd)的 agentRunning 状态，切换项目时保存/恢复
  instanceAgentRunning: new Map(),
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
  // Todo 阶段数据
  todoPhases: [],
  // 启动欢迎页阶段：'showing' | 'done'
  welcomePhase: 'showing',
  // 新建对话标志：新建后到收到 session_switch 之前，忽略 message_* 事件
  pendingNewSession: false,
  _newSessionSwitched: false,  // session_switch 是否已到达
  // 待发送图片列表：{ data: base64string, mimeType: string, name: string }
  pendingImages: [],
};

// ── sessionModelMap 持久化 ──
const MODEL_MAP_FILE = 'session-model-map.json';
async function saveModelMap() {
  try {
    const root = await ompDesktop.getRootPath();
    await ompDesktop.writeFile(root + '\\data\\agent\\' + MODEL_MAP_FILE, JSON.stringify(state.sessionModelMap));
  } catch (e) { console.warn('[持久化] 保存模型映射失败:', e); }
}
async function loadModelMap() {
  try {
    const root = await ompDesktop.getRootPath();
    const result = await ompDesktop.readFile(root + '\\data\\agent\\' + MODEL_MAP_FILE);
    if (result && result.content) {
      const map = JSON.parse(result.content);
      if (map && typeof map === 'object') state.sessionModelMap = map;
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
  newSessionOverlay: document.getElementById('newSessionOverlay'),
  input: document.getElementById('messageInput'),
  btnSend: document.getElementById('btnSend'),
  btnAbort: document.getElementById('btnAbort'),
  btnAttach: document.getElementById('btnAttach'),
  imagePreview: document.getElementById('imagePreview'),
  fileInput: document.getElementById('fileInput'),
  sidebar: document.getElementById('sidebar'),
  sidebarResizeHandle: document.getElementById('sidebarResizeHandle'),
  previewDivider: document.getElementById('previewDivider'),
  sidebarPreview: document.getElementById('sidebarPreview'),
  sidebarTreeSection: null,
  fileTree: document.getElementById('fileTree'),
  btnRefreshFiles: document.getElementById('btnRefreshFiles'),
  btnCloseSidebar: document.getElementById('btnCloseSidebar'),
  previewTabs: document.getElementById('previewTabs'),
  previewContent: document.getElementById('previewContent'),
  btnClosePreview: document.getElementById('btnClosePreview'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  modelList: document.getElementById('modelList'),
  constraintsPreview: document.getElementById('constraintsPreview'),
  btnOpenConstraints: document.getElementById('btnOpenConstraints'),
  modelSwitcher: document.getElementById('modelSwitcher'),
  modelSwitcherList: document.getElementById('modelSwitcherList'),
};

// ── Initialize ──
async function init() {
  state.workspacePath = await ompDesktop.getWorkspacePath();
  dom.sidebarTreeSection = dom.sidebar.querySelector('.sidebar-tree-section');

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
      ompDesktop.openPath(filePath);
      return;
    }
    // file:/// 协议链接（模型可能直接输出）
    if (href.startsWith('file:///')) {
      e.preventDefault();
      const raw = decodeURIComponent(href.replace('file:///', ''));
      const filePath = raw.replace(/\//g, '\\');
      ompDesktop.openPath(filePath);
      return;
    }
    // 纯 Windows 路径（如 X:\path，作为 href 不常见但防御性处理）
    if (/^[A-Z]:[\\\/]/.test(href)) {
      e.preventDefault();
      ompDesktop.openPath(href);
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

  ompDesktop.onEvent((event) => {
    // 多实例：只处理当前活跃实例的事件
    if (event._cwd && state.workspacePath && event._cwd !== state.workspacePath) {
      return; // 忽略非活跃实例的事件
    }
    handleEvent(event);
  });
  ompDesktop.onExited(handleExited);

  // 监听主进程看门狗事件
  ompDesktop.onStallWarning((data) => {
    // 第一级：agent 被通知卡住了，等待它自己处理
    updateStatus(`工具执行超时 (${data.elapsed}秒无响应)，已通知 agent 处理...`);
    addNotice('warning', `工具执行 ${data.elapsed} 秒无响应。已通知 agent，等待它自行恢复或重试。如果 30 秒后仍无响应将强制终止。`);
  });

  ompDesktop.onStallRecovered(() => {
    // Agent 恢复了
    updateStatus('agent 已恢复');
    addNotice('info', 'Agent 已从超时状态恢复，继续执行。');
  });

  ompDesktop.onStallKilled((data) => {
    // 终极升级：agent 也没恢复，强制终止
    state.agentRunning = false;
    stopStallCheck();
    finalizeAssistantMessage();
    updateInputState();
    const reason = data.reason === 'agent-unresponsive' ? '通知 agent 后 30 秒仍未恢复' : data.reason;
    updateStatus('重启中...');
    addNotice('warning', `代理被强制终止（${reason}），正在自动重启...`);
  });

  ompDesktop.onRestarting(() => {
    state.ompReady = false;
    updateStatus('重启中...');
    addNotice('info', 'omp 正在自动重启，请稍候...');
  });

  ompDesktop.onCrashRecovered(() => {
    state.ompReady = true;
    updateInputState();
    addNotice('info', 'omp 崩溃后已自动重启，正在自动续行（断片补救已注入）...');
  });

  setupInput();
  setupProjectPanel();
  setupSessionTabs();
  setupSidebar();
  setupPreview();
  setupSidebarResize();
  setupPreviewDivider();
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

  const ready = await ompDesktop.isReady();
  if (ready) {
    state.ompReady = true;
    updateStatus('就绪');
    fetchCurrentModel();
  }

  // 全部加载完成，淡出启动遮罩
  const overlay = document.getElementById('startupOverlay');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(() => { overlay.remove(); }, 400);
  }
  // 如果没有恢复到历史会话，显示欢迎页
  if (dom.messages.children.length === 0) showWelcome();
  dom.input.focus();
}

// ── Event Handler ──
function handleEvent(event) {
  // 记录事件时间，用于卡住检测
  state.lastEventTime = Date.now();

  // 新建对话过渡期：忽略所有 message_* 事件，防止旧会话消息残留
  if (state.pendingNewSession && (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end')) {
    console.log('[渲染] 新建对话过渡期，忽略消息事件:', event.type);
    return;
  }

  switch (event.type) {
    case 'ready':
      state.ompReady = true;
      updateStatus('就绪');
      fetchCurrentModel();
      break;
    case 'prompt_result':
      if (event.agentInvoked) {
        state.agentRunning = true;
        state.instanceAgentRunning.set(state.workspacePath, true);
        startStallCheck();
        updateInputState();
        updateStatus('思考中...');
      }
      break;
    case 'agent_start':
      state.agentRunning = true;
      state.instanceAgentRunning.set(state.workspacePath, true);
      markFirstResponseReceived();
      startStallCheck();
      updateInputState();
      break;
    case 'agent_end':
      state.agentRunning = false;
      state.instanceAgentRunning.set(state.workspacePath, false);
      stopStallCheck();
      stopFirstResponseCheck();
      finalizeAssistantMessage();
      updateInputState();
      updateStatus('就绪');
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
      // todo 工具结果包含 phases
      if (event.toolName === 'todo' && event.result) {
        try {
          const details = typeof event.result === 'string' ? JSON.parse(event.result) : event.result;
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
      if (event.model) {
        state.currentModel = event.model;
        dom.currentModel.textContent = event.model;
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
      if (event.sessionPath) {
        const newPath = event.sessionPath;
        const oldPath = state.activeSessionPath;

        if (state.pendingNewSession) {
          // 新建对话过渡期：清屏 + 关遮罩，但不关 pendingNewSession
          // （omp 可能在 session_switch 后继续发旧会话的 message_* 事件）
          // pendingNewSession 由新建对话流程在 await 返回后延迟关闭
          if (oldPath && oldPath.startsWith('__new__') && state.sessionModelMap[oldPath]) {
            state.sessionModelMap[newPath] = state.sessionModelMap[oldPath];
            delete state.sessionModelMap[oldPath];
            saveModelMap();
          }
          if (oldPath && oldPath.startsWith('__new__')) {
            const ns = state.sessions.find(s => s.path === oldPath);
            if (ns) ns.path = newPath;
          } else {
            state.sessions.push({ path: newPath, title: '新对话', firstMessage: '', messageCount: 0 });
          }
          // 清屏 + showWelcome
          dom.messages.innerHTML = '';
          showWelcome();
          state.sessionMessageCache.delete(newPath);
          // 标记 session_switch 已到达（但不关 pendingNewSession）
          state._newSessionSwitched = true;
          // 延迟关闭 pendingNewSession，拦截残留的 message_* 事件
          setTimeout(() => {
            if (state.pendingNewSession) {
              state.pendingNewSession = false;
              updateStatus('就绪');
              dom.input.focus();
            }
          }, 300);
        }

        state.activeSessionPath = newPath;
        state.activeSessionPaths.add(newPath);
        renderSessionTabs();
        if (!state.pendingNewSession) {
          updateStatus('就绪');
          dom.input.focus();
        }
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
  // 多实例：只处理当前活跃实例的退出
  if (data.cwd && state.workspacePath && data.cwd !== state.workspacePath) {
    return; // 非活跃实例退出，忽略
  }
  state.ompReady = false;
  state.agentRunning = false;
  finalizeAssistantMessage();
  updateInputState();
  if (data.crashLoop) {
    updateStatus(`连续崩溃 ${data.crashCount} 次，已停止自动重启`);
    addNotice('error', `omp 连续崩溃 ${data.crashCount} 次，已停止自动续行。请检查模型服务是否正常，然后手动发消息继续。`);
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

    const result = await ompDesktop.openFolderDialog();
    if (result.canceled) return;
    if (result.error) {
      addNotice('error', `打开文件夹失败: ${result.error}`);
      return;
    }
    const folderPath = result.path;
    updateStatus('切换项目...');
    const changeResult = await ompDesktop.activateInstance(folderPath);
    if (changeResult.error) {
      addNotice('error', `切换项目失败: ${changeResult.error}`);
      updateStatus('就绪');
      return;
    }
    state.workspacePath = folderPath;
    state.activeProjectDirName = null;
    state.activeSessionPath = null;
    state.ompReady = true;
    // 恢复新实例状态
    try {
      const instances = await ompDesktop.getInstances();
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
    // 重新加载项目列表（新 cwd 会在 omp 发消息后自动出现）
    await loadProjects();
    addNotice('info', `已切换到: ${folderPath}`);
  } catch (err) {
    addNotice('error', `切换项目失败: ${err.message}`);
    updateStatus('就绪');
  }
}

async function loadProjects() {
  dom.projectList.innerHTML = '<div class="project-loading">加载中...</div>';
  const result = await ompDesktop.listProjects();
  if (result.error) {
    dom.projectList.innerHTML = `<div class="project-loading" style="color:var(--danger)">${escapeHtml(result.error)}</div>`;
    return;
  }
  state.projects = result;
  // 同时加载归档项目列表
  try {
    const archivedResult = await ompDesktop.listArchivedProjects();
    state.archivedProjects = (archivedResult && !archivedResult.error) ? archivedResult : [];
  } catch { state.archivedProjects = []; }
  renderProjects();
  // Auto-select first project and restore latest session
  if (state.projects.length > 0 && !state.activeProjectDirName) {
    await selectProject(state.projects[0].dirName);
    // 自动恢复最近的1个会话到活跃tab
    if (state.sessions.length > 0 && !state.activeSessionPath) {
      const latest = state.sessions[state.sessions.length - 1]; // 最新在最后
      if (latest && latest.path) {
        state.activeSessionPath = latest.path;
        state.activeSessionPaths.add(latest.path);
        renderSessionTabs();
        const doRestore = async () => {
          // 先渲染历史（文件系统读取，不依赖 omp），再通知 omp 切换
          try {
            dom.messages.innerHTML = '';
            await loadAndRenderHistory(latest.path);
          } catch {}
          // switchSession 异步通知 omp，不阻塞 UI
          ompDesktop.switchSession(latest.path).catch(() => {});
        };
        if (state.welcomePhase === 'showing') {
          setTimeout(doRestore, 5500);
        } else {
          await doRestore();
        }
      }
    }
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
    if (action === 'open-explorer') ompDesktop.openPath(project.cwd);
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
    const result = await ompDesktop.archiveProject(project.dirName);
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
    const result = await ompDesktop.deleteProject(project.dirName);
    if (result.error) {
      addNotice('error', `删除失败: ${result.error}`);
      return;
    }
    // 加入 removedCwds 防止 discoverWorkspaceProjects 让它复活
    if (project.cwd) {
      try { await ompDesktop.addRemovedCwd(project.cwd); } catch {}
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
    const result = await ompDesktop.restoreProject(project.dirName);
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
    const result = await ompDesktop.deleteProject(project.dirName);
    if (result && result.error) {
      addNotice('error', `删除失败: ${result.error}`);
      return;
    }
    // 加入 removedCwds 防止复活
    if (project.cwd) {
      try { await ompDesktop.addRemovedCwd(project.cwd); } catch {}
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

  // 保存旧实例的 agentRunning 状态
  const oldCwd = state.workspacePath;
  if (oldCwd) state.instanceAgentRunning.set(oldCwd, state.agentRunning);
  // 切换项目时先停掉stall check，避免旧项目的看门狗误触发
  stopStallCheck();

  // 找到项目的 cwd 路径
  const project = state.projects.find(p => p.dirName === dirName);
  if (!project || !project.cwd) return;

  // 激活对应实例（懒启动或复用已有实例，无需重启 omp）
  if (project.cwd !== state.workspacePath || isReselect) {
    updateStatus('切换项目...');
    try {
      const result = await ompDesktop.activateInstance(project.cwd);
      if (result.error) {
        addNotice('error', `切换项目失败: ${result.error}`);
        updateStatus('就绪');
        return;
      }
      state.workspacePath = result.cwd || project.cwd;
      if (result.ready === false) {
        state.ompReady = false;
        updateStatus('正在启动 omp 实例，请稍候...');
        addNotice('info', '新项目 omp 实例正在启动，就绪后可发送消息');
      } else {
        state.ompReady = true;
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
    state.activeSessionPaths.clear();  // 切换项目时重置活跃tab
  }

  // 恢复该项目的 approval mode
  restoreApprovalMode(state.workspacePath);

  // 恢复新实例的 agentRunning 状态
  const newCwd = state.workspacePath;
  // 同步真实状态：切走期间可能错过了 agent_end 事件
  try {
    const instances = await ompDesktop.getInstances();
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
  await loadSessions(dirName);
  // 自动选中并加载该项目的最新会话
  if (state.sessions.length > 0) {
    const latest = state.sessions[state.sessions.length - 1]; // 最新在最后
    if (latest && latest.path) {
      state.activeSessionPath = latest.path;
      state.activeSessionPaths.add(latest.path);
      renderSessionTabs();

      const doLoad = async () => {
        if (state.agentRunning) {
          // agent 正在跑：加载历史 + 创建接续元素，不 switchSession（避免干扰运行中的任务）
          try {
            dom.messages.innerHTML = '';
            await loadAndRenderHistory(latest.path);
          } catch {}
          const el = createAssistantMessageElement();
          dom.messages.appendChild(el);
          state.currentAssistantEl = el;
          state.currentTextBuffer = '';
          scrollToBottom();
        } else {
          // 先渲染历史（从文件系统读取，不依赖 omp），再通知 omp 切换会话
          try {
            dom.messages.innerHTML = '';
            await loadAndRenderHistory(latest.path);
          } catch {}
          // switchSession 通知 omp 内部切换（可能失败，不影响 UI 显示）
          ompDesktop.switchSession(latest.path).then(() => {
            // 切换会话后恢复该对话之前使用的模型
            const saved = state.sessionModelMap[latest.path];
            if (saved && saved.provider && saved.modelId) {
              try {
                ompDesktop.setModel(saved.provider, saved.modelId);
                state.currentModel = saved.modelId;
                state.currentProvider = saved.provider;
                dom.currentModel.textContent = saved.modelId;
              } catch {}
            }
          }).catch(() => {});
        }
      };

      if (state.welcomePhase === 'showing') {
        setTimeout(doLoad, 5500);
      } else {
        await doLoad();
      }
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
  const result = await ompDesktop.listSessions(dirName);
  if (result.error) {
    state.sessions = [];
  } else {
    // 保留 __new__ 临时 tab（新建对话后磁盘刷新可能还没写入）
    const newTabs = state.sessions.filter(s => s.path.startsWith('__new__'));
    state.sessions = [...result, ...newTabs];
  }
  // 初始时只激活 activeSessionPath 对应的 tab
  // （首次加载或切换项目时调用）
  renderSessionTabs();
  renderHistoryPanel();
}

// ── History Panel (左侧项目栏下方的可折叠历史对话区域) ──

// 事件委托只绑一次
let _historyPanelBound = false;

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

  // 事件委托只绑一次
  if (_historyPanelBound) return;
  _historyPanelBound = true;

  container.addEventListener('click', async (e) => {
    // 用 closest 查找按钮（SVG 子元素点击时 target 不是 button 本身）
    const archiveBtn = e.target.closest('.history-btn-archive');
    const deleteBtn = e.target.closest('.history-btn-delete');

    // 归档按钮
    if (archiveBtn) {
      e.stopPropagation();
      const sessionPath = archiveBtn.dataset.path;
      if (sessionPath) {
        const result = await ompDesktop.archiveSession(sessionPath);
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
        if (!confirm('确定要删除这个对话吗？删除后无法恢复。')) return;
        const result = await ompDesktop.deleteSession(sessionPath);
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
        state.activeSessionPaths.add(sessionPath);
        switchToSession(sessionPath);
        renderHistoryPanel();
      }
    }
  });
}

// ── Session Tabs ──

function setupSessionTabs() {
  dom.btnNewSession.addEventListener('click', async () => {
    try {
      // 没有选中项目时，先引导用户选择文件夹
      if (!state.activeProjectDirName) {
        updateStatus('请先选择项目文件夹...');
        const result = await ompDesktop.openFolderDialog();
        if (result.canceled) { updateStatus('就绪'); return; }
        if (result.error) {
          addNotice('error', `打开文件夹失败: ${result.error}`);
          updateStatus('就绪');
          return;
        }
        // 切换到选中的文件夹
        const changeResult = await ompDesktop.activateInstance(result.path);
        if (changeResult.error) {
          addNotice('error', `切换项目失败: ${changeResult.error}`);
          updateStatus('就绪');
          return;
        }
        state.workspacePath = result.path;
        state.ompReady = true;
        // 重新加载项目列表并自动选中
        await loadProjects();
        // loadProjects 内部会自动选中第一个项目并加载 session
        updateStatus('就绪');
        return;
      }

      updateStatus('新建对话...');
      state.pendingNewSession = true;  // 开启过渡期，忽略旧会话消息事件
      state._newSessionSwitched = false;
      // 立即清屏 + 显示欢迎页，不让用户看到加载过程
      dom.messages.innerHTML = '';
      showWelcome();
      await ompDesktop.newSession();
      // 新会话会重置为默认模型，把当前模型设回去（继承之前的模型）
      if (state.currentProvider && state.currentModel && state.currentModel !== '--') {
        try { await ompDesktop.setModel(state.currentProvider, state.currentModel); } catch {}
      }

      if (state._newSessionSwitched) {
        // session_switch 已在 await 期间到达，清屏已在事件处理器中完成
        if (state.currentProvider && state.currentModel) {
          const sp = state.activeSessionPath;
          if (sp && !state.sessionModelMap[sp]) {
            state.sessionModelMap[sp] = { provider: state.currentProvider, modelId: state.currentModel };
            saveModelMap();
          }
        }
        setTimeout(() => {
          state.pendingNewSession = false;
          updateStatus('就绪');
          dom.input.focus();
        }, 300);
      } else {
        // session_switch 还没来，创建临时 __new__ tab
        const newSession = {
          path: '__new__' + Date.now(),
          title: '新对话',
          firstMessage: '',
          messageCount: 0,
        };
        state.sessions.push(newSession);
        state.activeSessionPath = newSession.path;
        state.activeSessionPaths.add(newSession.path);
        if (state.currentProvider && state.currentModel) {
          state.sessionModelMap[newSession.path] = { provider: state.currentProvider, modelId: state.currentModel };
          saveModelMap();
        }
        renderSessionTabs();
      }
      // 后台异步刷新真实会话列表（文件写入后）
      setTimeout(async () => {
        if (state.activeProjectDirName) {
          await loadSessions(state.activeProjectDirName);
        }
      }, 2000);
      // 兜底：5秒后如果 session_switch 没来，强制关闭过渡期
      setTimeout(() => {
        if (state.pendingNewSession) {
          state.pendingNewSession = false;
          updateStatus('就绪');
          dom.input.focus();
        }
      }, 5000);
    } catch (err) {
      state.pendingNewSession = false;
      addNotice('error', `新建对话失败: ${err.message}`);
      updateStatus('就绪');
    }
  });
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
    const title = session.title || session.firstMessage || '新对话';
    const msgCount = session.messageCount || 0;
    tab.innerHTML = `
      <span class="session-tab-name">${escapeHtml(title.length > 20 ? title.substring(0, 20) + '...' : title)}</span>
      ${msgCount > 0 ? `<span class="session-tab-msgcount">${msgCount}</span>` : ''}
      <span class="session-tab-close" title="关闭标签（不删除对话）">&#10005;</span>`;
    tab.title = session.title || session.firstMessage || '新对话';
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
          }
        }
        renderSessionTabs();
        return;
      }
      switchToSession(session.path);
    });
    dom.sessionTabs.appendChild(tab);
  }
}

async function switchToSession(sessionPath) {
  if (state.activeSessionPath === sessionPath) return;
  const oldSessionPath = state.activeSessionPath;
  state.activeSessionPath = sessionPath;
  state.activeSessionPaths.add(sessionPath);
  // 活跃tab上限5个，超过时移除最早未激活的
  const activeList = state.sessions.filter(s => state.activeSessionPaths.has(s.path));
  if (activeList.length > 5) {
    // 找到不在当前激活路径中的最早的tab移除
    for (const s of activeList) {
      if (s.path !== sessionPath) {
        state.activeSessionPaths.delete(s.path);
        break;
      }
    }
  }
  renderSessionTabs();
  try {
    // 缓存当前会话的消息 DOM（Per-session 消息缓冲）
    if (oldSessionPath) {
      state.sessionMessageCache.set(oldSessionPath, {
        html: dom.messages.innerHTML,
        scrollPos: dom.messages.scrollTop,
      });
      // 限制缓存大小（最多 10 个会话）
      if (state.sessionMessageCache.size > 10) {
        const oldest = state.sessionMessageCache.keys().next().value;
        state.sessionMessageCache.delete(oldest);
      }
    }

    // __new__ tab 还没写盘，不能 switchSession/loadHistory
    if (sessionPath.startsWith('__new__')) {
      dom.messages.innerHTML = '';
      showWelcome();
      return;
    }

    // 先渲染历史（从文件系统读取，不依赖 omp ready）
    const cached = state.sessionMessageCache.get(sessionPath);
    if (cached) {
      // 启动阶段：先保持欢迎页，延迟后恢复对话内容
      if (state.welcomePhase === 'showing') {
        setTimeout(() => {
          dom.messages.innerHTML = cached.html;
          dom.messages.scrollTop = cached.scrollPos;
          dom.messages.querySelectorAll('pre').forEach(pre => {
            pre.dataset.enhanced = '';
          });
          enhanceCodeBlocks(dom.messages);
        }, 5500);
      } else {
        dom.messages.innerHTML = cached.html;
        dom.messages.scrollTop = cached.scrollPos;
        dom.messages.querySelectorAll('pre').forEach(pre => {
          pre.dataset.enhanced = '';
        });
        enhanceCodeBlocks(dom.messages);
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

  // 异步通知 omp 切换会话上下文（不阻塞 UI，失败也不影响已渲染的历史）
  ompDesktop.switchSession(sessionPath).then(() => {
    const saved = state.sessionModelMap[sessionPath];
    if (saved && saved.provider && saved.modelId) {
      ompDesktop.setModel(saved.provider, saved.modelId).then(() => {
        state.currentModel = saved.modelId;
        state.currentProvider = saved.provider;
        dom.currentModel.textContent = saved.modelId;
      }).catch(() => {});
    }
  }).catch(() => {});
}

async function loadAndRenderHistory(sessionPath) {
  // loadEpoch 防竞态：快速切换会话时防止旧回调覆盖新数据
  const epoch = ++state.loadEpoch;
  try {
    const result = await ompDesktop.loadSessionHistory(sessionPath);
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

    // 渲染每条历史消息
    for (const msg of result.messages) {
      if (epoch !== state.loadEpoch) return; // 双重检查
      if (msg.role === 'user') {
        const text = msg.text || '';
        if (!text) continue;
        dom.messages.appendChild(createHistoryUserMessage(text, msg.timestamp));
      } else if (msg.role === 'assistant') {
        const text = msg.text || '';
        const thinking = msg.thinking || '';
        const toolCalls = msg.toolCalls || [];
        if (!text && !thinking && toolCalls.length === 0) continue;
        dom.messages.appendChild(createHistoryAssistantMessage(text, thinking, toolCalls, msg.timestamp, msg.model));
      }
    }
    scrollToBottom();
  } catch (err) {
    if (epoch === state.loadEpoch) addNotice('warning', `加载历史失败: ${err.message}`);
  }
}

function createHistoryUserMessage(content, timestamp) {
  const div = document.createElement('div');
  div.className = 'message user';
  const header = document.createElement('div');
  header.className = 'message-header';
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : '';
  header.innerHTML = `<span class="message-role user">你</span><span class="message-time">${escapeHtml(time)}</span>`;
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = content;
  header.appendChild(createCopyBtn(() => body.textContent || body.innerText));
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

  // 正文
  if (text) {
    const fixed = applyOutputFixes(text);
    const rendered = document.createElement('div');
    rendered.innerHTML = ompDesktop.marked(fixed);
    body.appendChild(rendered);
  }

  // 助手消息复制按钮
  header.appendChild(createCopyBtn(() => body.innerText || body.textContent));

  // 代码块增强（复制按钮 + 可折叠）
  enhanceCodeBlocks(body);

  div.appendChild(header);
  div.appendChild(body);
  return div;
}

function updateSessionTabTitle(title) {
  const tabs = dom.sessionTabs.querySelectorAll('.session-tab');
  for (const tab of tabs) {
    if (tab.classList.contains('active')) {
      const nameEl = tab.querySelector('.session-tab-name');
      if (nameEl) nameEl.textContent = title.length > 20 ? title.substring(0, 20) + '...' : title;
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
    dom.messages.appendChild(createMessageElement('user', message.content));
    scrollToBottom();
  } else if (message.role === 'assistant') {
    const el = createAssistantMessageElement();
    dom.messages.appendChild(el);
    state.currentAssistantEl = el;
    state.currentTextBuffer = '';
    scrollToBottom();
  }
}

// ── 重复输出检测：弱量化模型容易陷入重复循环，提前中断节省时间 ──
let _repeatCheckCounter = 0;
let _repeatDetected = false;

function checkRepetition(text) {
  if (!text || text.length < 100) return false;
  // 每 15 个 delta 检查一次
  if (++_repeatCheckCounter % 15 !== 0) return false;
  if (_repeatDetected) return true; // 已检测到，不再重复触发

  // 取末尾 500 字符做分析
  const window = text.slice(-500);
  const lines = window.split('\n').filter(l => l.trim().length > 2);

  // 策略1: 连续重复行检测（代码重复的典型模式）
  let consecutiveRepeat = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1]) {
      consecutiveRepeat++;
      if (consecutiveRepeat >= 3) {
        triggerRepeatAbort('连续重复行');
        return true;
      }
    } else {
      consecutiveRepeat = 0;
    }
  }

  // 策略2: 行频次检测（散布式重复，如同一行出现很多次）
  if (lines.length >= 10) {
    const lineCounts = new Map();
    for (const line of lines) {
      const key = line.trim();
      if (key.length < 3) continue;
      lineCounts.set(key, (lineCounts.get(key) || 0) + 1);
    }
    for (const [, count] of lineCounts) {
      if (count >= 4) {
        triggerRepeatAbort('高频重复行');
        return true;
      }
    }
  }

  // 策略3: 短语级 n-gram 检测（兜底，捕获非换行的重复片段）
  const gramSize = 6;
  const counts = new Map();
  for (let i = 0; i <= window.length - gramSize; i++) {
    const gram = window.slice(i, i + gramSize);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  for (const [, count] of counts) {
    if (count > 8) {
      triggerRepeatAbort('n-gram 重复');
      return true;
    }
  }

  return false;
}

function triggerRepeatAbort(reason) {
  if (_repeatDetected) return; // 避免重复通知
  _repeatDetected = true;
  console.warn(`[重复检测] ${reason}，中断并等待续行`);
  addNotice('warning', `检测到模型输出重复(${reason})，已中断，等待自动续行...`);
  abortMessage();
  // abort 后等 agent 恢复空闲再自动续行
  waitAndContinue(reason);
}

// 等待 agent 空闲后自动续行（用于重复检测中断后的自动恢复）
function waitAndContinue(reason) {
  const maxWait = 20000; // 最多等 20 秒
  const interval = 500;
  let waited = 0;
  const tryContinue = () => {
    if (!state.agentRunning) {
      // agent 已空闲，发送续行消息
      ompDesktop.send(`[system] 上一轮输出因重复(${reason})被中断，请继续之前的任务，换一种方式表达，避免重复相同内容，给出完整结果。`).catch(err => {
        console.warn('[重复检测] 续行发送失败:', err);
      });
      return;
    }
    waited += interval;
    if (waited < maxWait) {
      setTimeout(tryContinue, interval);
    } else {
      console.warn('[重复检测] 等待 agent 空闲超时，放弃自动续行');
      addNotice('warning', '自动续行超时，请手动继续');
    }
  };
  setTimeout(tryContinue, 2000); // 先等 2 秒让 abort 完成
}

function handleMessageUpdate(message, assistantEvent) {
  if (!assistantEvent) return;
  switch (assistantEvent.type) {
    case 'text_start': state.currentTextBuffer = ''; _repeatCheckCounter = 0; _repeatDetected = false; break;
    case 'text_delta':
      state.currentTextBuffer += assistantEvent.delta;
      updateAssistantContent(state.currentTextBuffer);
      scrollToBottom();
      checkRepetition(state.currentTextBuffer);
      break;
    case 'text_end':
      state.currentTextBuffer = assistantEvent.content || state.currentTextBuffer;
      updateAssistantContent(state.currentTextBuffer);
      break;
    case 'thinking_start': {
      _repeatCheckCounter = 0; _repeatDetected = false;
      const el = createThinkingBlock();
      appendToAssistant(el);
      state.currentThinkingEl = el;
      break;
    }
    case 'thinking_delta':
      if (state.currentThinkingEl && state.currentThinkingEl._content) {
        state.currentThinkingEl._content.textContent += assistantEvent.delta;
        checkRepetition(state.currentThinkingEl._content.textContent);
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

function createCopyBtn(getContentFn) {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = '复制';
  btn.title = '复制内容';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = typeof getContentFn === 'function' ? getContentFn() : getContentFn;
    try {
      ompDesktop.clipboardWriteText(text);
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = '复制'; }, 1500);
    } catch {
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
      });
    }
  });
  return btn;
}

function createMessageElement(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const header = document.createElement('div');
  header.className = 'message-header';
  header.innerHTML = `<span class="message-role ${role}">${role === 'user' ? '你' : '助手'}</span>
    <span class="message-time">${new Date().toLocaleTimeString()}</span>`;
  const body = document.createElement('div');
  body.className = 'message-body';
  if (role === 'user') {
    if (typeof content === 'string') body.textContent = content;
    else if (Array.isArray(content)) {
      body.textContent = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    }
    // 用户消息：内容确定，直接加复制按钮
    header.appendChild(createCopyBtn(() => body.textContent || body.innerText));
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
  body.innerHTML = ompDesktop.marked(text);
  enhanceCodeBlocks(body);
}

// ── 代码块增强：统一复制按钮 + 可折叠 ──
function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.dataset.enhanced) return;
    pre.dataset.enhanced = '1';
    pre.style.position = 'relative';

    // 复制按钮
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    btn.style.cssText = 'position:absolute;top:4px;right:4px;padding:2px 8px;font-size:11px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:var(--text-secondary);cursor:pointer;z-index:2;';
    btn.onclick = (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      try {
        ompDesktop.clipboardWriteText(text);
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

    // 可折叠：如果代码块高度超过 150px，包裹一层并添加展开按钮
    requestAnimationFrame(() => {
      if (pre.scrollHeight > 150) {
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
    });
  });
}

function finalizeAssistantMessage() {
  // AI 消息结束，加复制按钮
  if (state.currentAssistantEl) {
    const header = state.currentAssistantEl.querySelector('.message-header');
    const body = state.currentAssistantEl.querySelector('.message-body');
    if (header && body && !header.querySelector('.copy-btn')) {
      header.appendChild(createCopyBtn(() => body.innerText || body.textContent));
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

  switch (method) {
    case 'editor': {
      // 编辑器输入（ask 工具等）
      showModalInput(event.title || '请输入', event.prefill || '').then(v => {
        if (v !== null) {
          ompDesktop.extensionResponse(id, { value: v });
        } else {
          ompDesktop.extensionResponse(id, { cancelled: true });
        }
      });
      break;
    }
    case 'select': {
      const opts = event.options || [];
      showModalSelect(event.title || '请选择', opts).then(value => {
        if (value !== null && value !== undefined) {
          ompDesktop.extensionResponse(id, { value });
        } else {
          ompDesktop.extensionResponse(id, { cancelled: true });
        }
      });
      break;
    }
    case 'confirm': {
      showModalConfirm(event.title, event.message).then(result => {
        ompDesktop.extensionResponse(id, result ? { confirmed: true } : { cancelled: true });
      });
      break;
    }
    case 'input': {
      showModalInput(event.title || '请输入', event.placeholder || '').then(v => {
        if (v !== null) {
          ompDesktop.extensionResponse(id, { value: v });
        } else {
          ompDesktop.extensionResponse(id, { cancelled: true });
        }
      });
      break;
    }
    case 'setWidget':
      // 终端 UI 控件展示（ask 工具的交互面板等），桌面端不需要渲染，直接确认
      ompDesktop.extensionResponse(id, { confirmed: true });
      break;
    case 'notify':
      addNotice(event.notifyType || 'info', event.message);
      ompDesktop.extensionResponse(id, { confirmed: true });
      break;
    case 'setStatus':
      updateStatus(event.statusText || '');
      ompDesktop.extensionResponse(id, { confirmed: true });
      break;
    case 'setTitle':
      document.title = `Tiffa - ${event.title || ''}`;
      ompDesktop.extensionResponse(id, { confirmed: true });
      break;
    case 'cancel':
      ompDesktop.extensionResponse(id, { confirmed: true });
      break;
    case 'open_url':
      if (event.url) ompDesktop.openExternal(event.url);
      ompDesktop.extensionResponse(id, { confirmed: true });
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
      ompDesktop.extensionResponse(id, { confirmed: true });
      break;
    default:
      console.warn('[Extension UI] 未处理的 method:', method);
      ompDesktop.extensionResponse(id, { confirmed: true });
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  dom.input.addEventListener('input', () => {
    dom.input.style.height = 'auto';
    dom.input.style.height = Math.min(dom.input.scrollHeight, 160) + 'px';
    // Slash 命令检测
    handleSlashInput();
  });
  dom.btnSend.addEventListener('click', sendMessage);
  dom.btnAbort.addEventListener('click', abortMessage);

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
    if (files.length > 0) insertFilePaths(files);
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
  const paths = Array.from(files).map(f => f.path).filter(Boolean);
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
  if (!state.ompReady) { addNotice('warning', 'omp 尚未就绪'); return; }
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
  // 立即显示用户消息 + "思考中"状态（本地模型 prefill 可能 60-90 秒，不等 omp 事件）
  dom.messages.appendChild(createMessageElement('user', message));
  scrollToBottom();
  state.agentRunning = true;
  state.instanceAgentRunning.set(state.workspacePath, true);
  startStallCheck();
  startFirstResponseCheck();
  updateInputState();
  updateStatus('思考中...');
  try { await ompDesktop.send(message, images); }
  catch (err) {
    addNotice('error', `发送失败: ${err.message}`);
    // 发送失败时重置状态，避免 UI 卡在"思考中..."
    state.agentRunning = false;
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
    await ompDesktop.abort();
  } catch (err) { /* ignore */ }
  stopStallCheck();
  // 不立即设 agentRunning=false，等 omp 的 agent_end 事件来更新
  // 给 UI 反馈，避免用户以为没反应
  updateStatus('已发送停止信号，等待 agent 响应...');
  // 15 秒兜底：如果 omp 没发 agent_end，强制重置 UI 状态
  setTimeout(() => {
    if (state.agentRunning) {
      state.agentRunning = false;
      finalizeAssistantMessage();
      updateInputState();
      updateStatus('已停止');
    }
  }, 15000);
}

function updateInputState() {
  dom.btnSend.classList.toggle('hidden', state.agentRunning);
  dom.btnAbort.classList.toggle('hidden', !state.agentRunning);
  dom.input.disabled = state.agentRunning;
  if (!state.agentRunning) {
    // 消费 draftInput：一次性预填输入框
    if (state.draftInput) {
      dom.input.value = state.draftInput;
      state.draftInput = null;
      dom.input.focus();
      // 自动调整 textarea 高度
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
    if (!state.sidebarCollapsed) loadFileTree(state.workspacePath);
  });
  dom.btnCloseSidebar.addEventListener('click', () => {
    state.sidebarCollapsed = true;
    dom.sidebar.classList.add('collapsed');
  });
  dom.btnRefreshFiles.addEventListener('click', () => loadFileTree(state.workspacePath));
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

async function loadFileTree(dirPath) {
  const entries = await ompDesktop.listDir(dirPath);
  if (entries.error) {
    dom.fileTree.innerHTML = `<div class="file-tree-item" style="color:var(--danger)">${entries.error}</div>`;
    return;
  }
  dom.fileTree.innerHTML = '';
  renderFileEntries(dirPath, entries, dom.fileTree, 0);
}

function renderFileEntries(basePath, entries, container, depth) {
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = `file-tree-item ${entry.isDirectory ? 'directory' : ''}`;
    item.style.paddingLeft = `${12 + depth * 16}px`;
    const icon = entry.isDirectory ? 'D' : getFileIcon(entry.ext);
    const sizeHtml = (!entry.isDirectory && entry.size > 0) ? `<span class="file-tree-size">${formatFileSize(entry.size)}</span>` : '';
    item.innerHTML = `<span class="file-tree-icon">${icon}</span><span class="ft-name">${escapeHtml(entry.name)}</span>${sizeHtml}`;
    item.addEventListener('click', () => {
      if (entry.isDirectory) toggleDirectory(entry, item, depth);
      else openFilePreview(entry);
    });
    container.appendChild(item);
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function toggleDirectory(entry, item, depth) {
  const child = item.nextElementSibling;
  if (child && child.classList.contains('file-tree-children')) { child.remove(); return; }
  const entries = await ompDesktop.listDir(entry.path);
  if (entries.error) return;
  const filtered = entries.filter(e => {
    if (e.name.startsWith('.') && e.name !== '.omp') return false;
    if (['node_modules', '__pycache__', '.git', '.temp'].includes(e.name)) return false;
    return true;
  });
  const container = document.createElement('div');
  container.className = 'file-tree-children';
  renderFileEntries(entry.path, filtered, container, depth + 1);
  item.after(container);
}

function getFileIcon(ext) {
  const icons = { '.js': '{}', '.ts': '{}', '.py': '~', '.md': '#', '.json': '{}', '.yml': '-', '.yaml': '-', '.html': '<>', '.css': '#', '.bat': '>', '.txt': '~', '.log': '~', '.csv': '=', '.png': 'I', '.jpg': 'I', '.jpeg': 'I', '.gif': 'I', '.webp': 'I', '.pdf': 'P', '.docx': 'W', '.xlsx': 'X', '.pptx': 'S' };
  return icons[ext] || 'F';
}

async function openFilePreview(entry) {
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
  if (imageExts.includes(entry.ext)) {
    const result = await ompDesktop.readImage(entry.path);
    if (result.error) { addNotice('error', result.error); return; }
    addPreviewTab(entry.name, 'image', null, result);
  } else {
    const result = await ompDesktop.readFile(entry.path);
    if (result.error) { addNotice('error', result.error); return; }
    addPreviewTab(entry.name, 'code', entry.path, result);
  }
}

// ── Preview ──
function setupPreview() {
  dom.btnClosePreview.addEventListener('click', () => {
    state.previewTabs = [];
    state.activePreviewIndex = -1;
    renderPreviewTabs();
    dom.previewContent.innerHTML = '<div class="preview-empty">点击左侧文件预览</div>';
  });
}

function addPreviewTab(name, type, filePath, data) {
  if (state.sidebarCollapsed) { state.sidebarCollapsed = false; dom.sidebar.classList.remove('collapsed'); }
  const existing = state.previewTabs.findIndex(t => t.name === name);
  if (existing >= 0) { state.activePreviewIndex = existing; renderPreviewTabs(); renderPreviewContent(); return; }
  // 判断是否可预览（HTML/Markdown）
  const ext = data?.ext || path.extname(name || '');
  const previewable = ['.html', '.htm', '.md', '.markdown'].includes(ext);
  state.previewTabs.push({ name, type, filePath, data, ext, previewable, previewMode: 'code' });
  state.activePreviewIndex = state.previewTabs.length - 1;
  renderPreviewTabs();
  renderPreviewContent();
}

function renderPreviewTabs() {
  dom.previewTabs.innerHTML = '';
  state.previewTabs.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = `ptab ${i === state.activePreviewIndex ? 'active' : ''}`;
    btn.innerHTML = `${escapeHtml(tab.name)} <span class="ptab-close">x</span>`;
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('ptab-close')) {
        state.previewTabs.splice(i, 1);
        if (state.activePreviewIndex >= state.previewTabs.length)
          state.activePreviewIndex = Math.max(0, state.previewTabs.length - 1);
        renderPreviewTabs(); renderPreviewContent();
        if (state.previewTabs.length === 0) dom.previewContent.innerHTML = '<div class="preview-empty">点击左侧文件预览</div>';
      } else { state.activePreviewIndex = i; renderPreviewTabs(); renderPreviewContent(); }
    });
    dom.previewTabs.appendChild(btn);
  });
}

function renderPreviewContent() {
  const tab = state.previewTabs[state.activePreviewIndex];
  if (!tab) { dom.previewContent.innerHTML = '<div class="preview-empty">点击左侧文件预览</div>'; return; }

  // 代码/预览 切换按钮（仅可预览文件显示）
  let modeBar = '';
  if (tab.previewable) {
    const isPreview = tab.previewMode === 'preview';
    modeBar = `<div class="preview-mode-bar">
      <button class="preview-mode-btn ${!isPreview ? 'active' : ''}" data-mode="code">代码</button>
      <button class="preview-mode-btn ${isPreview ? 'active' : ''}" data-mode="preview">预览</button>
    </div>`;
  }

  let content = '';
  const mode = tab.previewable ? tab.previewMode : 'code';
  if (mode === 'preview') {
    content = renderHtmlPreview(tab);
  } else {
    content = renderCodeContent(tab);
  }

  dom.previewContent.innerHTML = modeBar + content;

  // 绑定切换按钮事件
  if (tab.previewable) {
    dom.previewContent.querySelectorAll('.preview-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tab.previewMode = btn.dataset.mode;
        renderPreviewContent();
      });
    });
  }
}

function renderCodeContent(tab) {
  const data = tab.data || {};
  const content = data.content || '';
  const ext = data.ext || tab.ext || path.extname(tab.name || '');
  const langMap = { '.js': 'javascript', '.ts': 'typescript', '.py': 'python', '.html': 'html', '.css': 'css', '.json': 'json', '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml', '.bat': 'bash', '.sh': 'bash', '.xml': 'xml', '.sql': 'sql', '.rs': 'rust', '.go': 'go', '.java': 'java', '.cpp': 'cpp', '.c': 'c', '.h': 'c' };
  const lang = langMap[ext] || '';
  let highlighted;
  try { highlighted = lang && ompDesktop.hljs.getLanguage(lang) ? ompDesktop.hljs.highlight(content, { language: lang }).value : ompDesktop.hljs.highlightAuto(content).value; }
  catch { highlighted = escapeHtml(content); }
  return `<div style="margin-bottom:8px;font-size:12px;color:var(--text-muted);">${escapeHtml(tab.name || '')} ${content.length > 0 ? `(${(content.length / 1024).toFixed(1)}KB)` : ''}</div><pre class="code-preview"><code class="hljs">${highlighted}</code></pre>`;
}

function renderHtmlPreview(tab) {
  const data = tab.data || {};
  const content = data.content || '';
  const ext = data.ext || tab.ext || '';
  // HTML 直接用 iframe srcdoc 渲染
  if (ext === '.html' || ext === '.htm') {
    return `<iframe class="html-preview-frame" srcdoc="${escapeHtml(content)}" sandbox="allow-scripts allow-same-origin"></iframe>`;
  }
  // Markdown 渲染为基本 HTML（简易版）
  if (ext === '.md' || ext === '.markdown') {
    const html = simpleMarkdownRender(content);
    return `<iframe class="html-preview-frame" srcdoc="${escapeHtml(html)}" sandbox="allow-scripts allow-same-origin"></iframe>`;
  }
  return `<div style="padding:12px;color:var(--text-muted);">不支持此格式预览</div>`;
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

function setupPreviewDivider() {
  const divider = dom.previewDivider;
  const treeSection = dom.sidebarTreeSection;
  const previewSection = dom.sidebarPreview;
  let dragging = false, startY, startTreeH, startPreviewH;
  divider.addEventListener('mousedown', (e) => {
    if (dom.sidebar.classList.contains('collapsed')) return;
    dragging = true; startY = e.clientY; startTreeH = treeSection.offsetHeight; startPreviewH = previewSection.offsetHeight;
    divider.classList.add('dragging');
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = e.clientY - startY;
    treeSection.style.flex = '0 0 ' + Math.max(80, startTreeH + delta) + 'px';
    previewSection.style.flex = '0 0 ' + Math.max(80, startPreviewH - delta) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return; dragging = false; divider.classList.remove('dragging');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
  });
}

// ── Session Tab Context Menu ──

function showSessionTabContextMenu(e, session) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
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
  const menuWidth = 160, menuHeight = 160;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  activeContextMenu = { menu, session };

  menu.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.context-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    closeContextMenu();
    if (action === 'branch') await branchSession(session);
    else if (action === 'export-html') await exportSessionHtml(session);
    else if (action === 'archive') await archiveSessionFromTab(session);
    else if (action === 'delete') await deleteSessionFromTab(session);
  });

  setTimeout(() => {
    document.addEventListener('click', closeContextMenuOnClick, { once: true });
  }, 0);
}

async function archiveSessionFromTab(session) {
  const result = await ompDesktop.archiveSession(session.path);
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
  if (!confirm(`确定要删除对话「${title}」吗？删除后无法恢复。`)) return;
  const result = await ompDesktop.deleteSession(session.path);
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
      }
    }
    await loadSessions(state.activeProjectDirName);
    updateInputState();
  } else {
    addNotice('error', `删除失败: ${result.error || '未知错误'}`);
  }
}

// ── 分支功能 ──
async function branchSession(session) {
  if (!session || !session.path) return;
  try {
    const result = await ompDesktop.getUserEntries(session.path);
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
        await ompDesktop.command('branch', { entryId: msgId });
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
    const result = await ompDesktop.exportSessionHtml(session.path);
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

function scrollToBottom() {
  requestAnimationFrame(() => {
    // 粘底滚动：仅在用户已接近底部时自动滚动，不抢用户翻页
    const el = dom.messages;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
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
    const result = await ompDesktop.getXmlTranslationStatus();
    if (result && result.enabled) {
      state.xmlTranslationEnabled = true;
      dom.btnXmlTranslation.classList.add('active');
    }
  } catch {}

  dom.btnXmlTranslation.addEventListener('click', async () => {
    state.xmlTranslationEnabled = !state.xmlTranslationEnabled;
    try {
      await ompDesktop.toggleXmlTranslation(state.xmlTranslationEnabled);
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
  ompDesktop.writeApprovalMode(state.approvalMode).then(result => {
    if (!result?.success) console.warn('[审批] 写入 config.yml 失败:', result?.error);
  }).catch(() => {});
  // 通知 omp（当前会话通过 steer 告知）
  if (state.agentRunning) {
    try { ompDesktop.command('steer', { message: `[system] 用户切换审批模式为: ${state.approvalMode}（${APPROVAL_MODE_LABELS[state.approvalMode]}）` }); } catch {}
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
  ompDesktop.writeApprovalMode(state.approvalMode).catch(() => {});
}

// ── Settings ──
function setupSettings() {
  dom.btnSettings.addEventListener('click', () => {
    dom.settingsOverlay.classList.toggle('hidden');
    if (!dom.settingsOverlay.classList.contains('hidden')) { loadConstraintsPreview(); loadModelConfig(); loadModelList(); renderThemePresets(); }
  });
  dom.btnCloseSettings.addEventListener('click', () => dom.settingsOverlay.classList.add('hidden'));
  dom.settingsOverlay.addEventListener('click', (e) => { if (e.target === dom.settingsOverlay) dom.settingsOverlay.classList.add('hidden'); });
  dom.btnOpenConstraints.addEventListener('click', async () => { ompDesktop.openPath((await ompDesktop.getRootPath()) + '\\data\\memory\\constraints.md'); });
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
        const cfgResult = await ompDesktop.readModelsYml();
        if (cfgResult && !cfgResult.error) modelsConfigData = cfgResult.data;
      } catch {}
    }
    const result = await ompDesktop.getModels();
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
    const root = await ompDesktop.getRootPath();
    const result = await ompDesktop.readFile(root + '\\data\\agent\\hidden-models.json');
    if (result && result.content) {
      hiddenModels = new Set(JSON.parse(result.content));
    }
  } catch { hiddenModels = new Set(); }
}

async function saveHiddenModels() {
  try {
    const root = await ompDesktop.getRootPath();
    await ompDesktop.writeFile(root + '\\data\\agent\\hidden-models.json', JSON.stringify([...hiddenModels]));
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
      // 只保留 models.yml 中定义的模型，以及 home-models（omp config.yml 中的本地模型）
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

async function switchModel(provider, modelId) {
  try {
    await ompDesktop.setModel(provider, modelId);
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
}

// 从 omp 获取当前模型名并更新顶栏显示
async function fetchCurrentModel() {
  try {
    const result = await ompDesktop.getModels();
    if (result && result.models && result.models.length > 0) {
      const first = result.models[0];
      const name = first.name || first.id || '';
      if (name) {
        state.currentModel = name;
        state.currentProvider = first.provider || '';
        dom.currentModel.textContent = name;
      }
      // lastModel 兜底恢复：仅在当前会话无 sessionModelMap 记录时才使用全局 lastModel
      // 避免 lastModel 覆盖 selectProject/switchToSession 已恢复的每会话模型
      try {
        const activePath = state.activeSessionPath;
        const hasSessionModel = activePath && state.sessionModelMap[activePath];
        if (!hasSessionModel) {
          const saved = localStorage.getItem('tiffa-lastModel');
          if (saved) {
            const last = JSON.parse(saved);
            if (last && last.modelId && last.modelId !== state.currentModel && last.provider) {
              try {
                await ompDesktop.setModel(last.provider, last.modelId);
                state.currentModel = last.modelId;
                state.currentProvider = last.provider;
                dom.currentModel.textContent = last.modelId;
              } catch {}
            }
          }
        }
      } catch {}
    }
  } catch {}
}

async function loadConstraintsPreview() {
  try {
    const result = await ompDesktop.readFile((await ompDesktop.getRootPath()) + '\\data\\memory\\constraints.md');
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
        const cfgResult = await ompDesktop.readModelsYml();
        if (cfgResult && !cfgResult.error) modelsConfigData = cfgResult.data;
      } catch {}
    }
    const result = await ompDesktop.getModels();
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
  document.getElementById('btnRestartOmp').addEventListener('click', async () => {
    const s = document.querySelector('.config-status');
    if (s) { s.textContent = '重启中...'; s.className = 'config-status loading'; }
    try {
      const r = await ompDesktop.restartOmp();
      if (s) { s.textContent = r.success ? '已重启' : '重启失败'; s.className = r.success ? 'config-status saved' : 'config-status error'; }
    } catch (err) { if (s) { s.textContent = '重启失败: ' + err.message; s.className = 'config-status error'; } }
    setTimeout(() => { if (s) s.textContent = ''; }, 5000);
  });
}

async function loadModelConfig() {
  const container = document.getElementById('modelConfig');
  container.innerHTML = '<div class="model-item loading">加载中...</div>';
  try {
    const result = await ompDesktop.readModelsYml();
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
    const result = await ompDesktop.deleteOmpProvider(provKey);
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
    const result = await ompDesktop.fetchProviderModels(baseUrl, apiKey);
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
      for (const id of toAdd) {
        modelsConfigData.providers[provKey].models.push({ id, name: id, reasoning: false, input: ['text'], supportsTools: true, contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
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
    <input id="dlgModelMax" type="number" style="width:100%;padding:6px 10px;margin:4px 0 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" value="8192">
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
    if (!modelsConfigData.providers[provKey].models) modelsConfigData.providers[provKey].models = [];
    modelsConfigData.providers[provKey].models.push({ id, name, reasoning: false, input: ['text'], supportsTools: true, contextWindow: ctx, maxTokens: max, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
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
  div.innerHTML = `<span class="model-entry-id">${escapeHtml(model.id || '')}</span><span class="model-entry-meta">${escapeHtml(model.name || '')} | ${model.contextWindow || '?'}ctx</span>`;
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
  ];
  const inputs = {};
  for (const f of fields) {
    const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:6px;';
    row.innerHTML = `<label style="width:60px;font-size:11px;color:var(--text-muted);flex-shrink:0;">${escapeHtml(f.label)}</label>`;
    const inp = document.createElement('input'); inp.type = f.type === 'number' ? 'number' : 'text'; inp.value = f.value;
    inp.style.cssText = 'flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;';
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
    if (onDone) onDone();
    document.getElementById('modelConfig').innerHTML = ''; renderModelConfig();
    await saveModelConfig();
  });
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'settings-btn'; cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'font-size:12px;padding:3px 10px;';
  cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); if (onDone) onDone(); document.getElementById('modelConfig').innerHTML = ''; renderModelConfig(); });
  btnRow.appendChild(saveBtn); btnRow.appendChild(cancelBtn); container.appendChild(btnRow);
}

// ── 供应商预设库（37 个预设，来自 omp 17.x 源码） ──
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
    const root = await ompDesktop.getRootPath();
    const result = await ompDesktop.readFile(root + '\\data\\agent\\' + ENABLED_MODELS_FILE);
    if (result && result.content) {
      const arr = JSON.parse(result.content);
      // 空数组等同于未配置白名单，避免误操作导致看不到任何模型
      if (Array.isArray(arr) && arr.length > 0) enabledModels = arr;
    }
  } catch { enabledModels = undefined; }
}

async function saveEnabledModels() {
  try {
    const root = await ompDesktop.getRootPath();
    await ompDesktop.writeFile(root + '\\data\\agent\\' + ENABLED_MODELS_FILE, JSON.stringify(enabledModels || []));
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
      if (preset && preset.authUrl) modal.querySelector('#authUrlBtn')?.addEventListener('click', () => ompDesktop.openExternal(preset.authUrl));

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
      const result = await ompDesktop.writeOmpProvider(pid.trim(), cfg);
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
      const result = await ompDesktop.writeOmpProvider(pid.trim(), cfg);
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
    ompDesktop.getModels().then(result => {
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
    const result = await ompDesktop.writeModelsYml(yaml);
    if (result.success) { if (s) { s.textContent = '已保存'; s.className = 'config-status saved'; } }
    else { if (s) { s.textContent = '保存失败: ' + (result.error || ''); s.className = 'config-status error'; } }
  } catch (err) { if (s) { s.textContent = '保存失败: ' + err.message; s.className = 'config-status error'; } }
  setTimeout(() => { if (s) s.textContent = ''; }, 8000);
}

function serializeModelsYaml(data) {
  const lines = ['# omp models.yml', ''];
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
