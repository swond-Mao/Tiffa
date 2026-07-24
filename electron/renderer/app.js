/**
 * omp Desktop - Renderer Application v1.3
 * 
 * Layout: Left project panel + Top session tabs + Chat + File sidebar
 */

// ── 输出后处理修正 ──

function fixBareUrls(text) {
  const protectedLinks = [];
  let result = text.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => {
    const idx = protectedLinks.length;
    protectedLinks.push(m);
    return `\x00LINK${idx}\x00`;
  });
  // 转换 file:/// Markdown 链接 [文字](file:///X:/path) → omp-local://
  result = result.replace(/\[([^\]]*)\]\(file:\/\/\/([^\s)]+)\)/g, (m, label, filePath) => {
    const decoded = decodeURIComponent(filePath);
    return `[${label}](omp-local://${decoded})`;
  });
  result = result.replace(
    /(^|[\s(\uff08])(https?:\/\/([\w.-]+\.[\w]{2,}(?:\/[\w./?#&=+%@!~:*-]*)?))(?=[\s),，;；。！？）\"'\u4e00-\u9fff]|$)/gm,
    (match, prefix, url, domain) => `${prefix}[${domain}](${url})`
  );
  // 自动链接化 Windows 本地路径：X:\path 或 X:/path（不在代码块内、未被 Markdown 链接包装的）
  result = result.replace(
    /(^|[\s(\uff08\uff0c，;；。！？）"])([A-Z]:[\\\/][^\s)\]'",;；，。！？\u4e00-\u9fff]+)/gm,
    (match, prefix, path) => `${prefix}[${path}](omp-local://${path})`
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
  closedSessionPaths: new Set(),  // 本次运行中关闭过的对话（不自动恢复）
  historyCollapsed: true,         // 历史对话面板折叠状态
  workspacePath: '',
  // 每个对话记住的模型 { provider, modelId }
  sessionModelMap: {},
  // XML 翻译开关
  xmlTranslationEnabled: false,
  // 每个实例(cwd)的 agentRunning 状态，切换项目时保存/恢复
  instanceAgentRunning: new Map(),
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
  input: document.getElementById('messageInput'),
  btnSend: document.getElementById('btnSend'),
  btnAbort: document.getElementById('btnAbort'),
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
    // omp-local://X:\path 格式（由 fixBareUrls 生成）
    if (href.startsWith('omp-local://')) {
      e.preventDefault();
      const filePath = href.replace('omp-local://', '');
      ompDesktop.openPath(filePath);
      return;
    }
    // file:/// 协议链接（模型可能直接输出）
    if (href.startsWith('file:///')) {
      e.preventDefault();
      const filePath = decodeURIComponent(href.replace('file:///', ''));
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
  showWelcome();
  await loadModelMap();
  loadProjects();

  const ready = await ompDesktop.isReady();
  if (ready) {
    state.ompReady = true;
    updateStatus('就绪');
    fetchCurrentModel();
  }
}

// ── Event Handler ──
function handleEvent(event) {
  // 记录事件时间，用于卡住检测
  state.lastEventTime = Date.now();

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
      startStallCheck();
      updateInputState();
      break;
    case 'agent_end':
      state.agentRunning = false;
      state.instanceAgentRunning.set(state.workspacePath, false);
      stopStallCheck();
      finalizeAssistantMessage();
      updateInputState();
      updateStatus('就绪');
      if (state.activeProjectDirName) loadSessions(state.activeProjectDirName);
      break;
    case 'turn_end':
      finalizeAssistantMessage();
      break;
    case 'message_start':
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
        document.title = `omp Desktop - ${event.title}`;
        updateSessionTabTitle(event.title);
      }
      break;
    case 'notice':
      addNotice(event.level, event.message);
      break;
    case 'auto_retry_start':
      updateStatus(`重试中 (${event.attempt}/${event.maxAttempts})...`);
      break;
    case 'auto_retry_end':
      updateStatus(event.success ? '就绪' : '重试失败');
      break;
    case 'session_switch':
      if (event.sessionPath) {
        // 新对话创建后，omp 返回真实路径，需要把 __new__ 的模型映射迁移过来
        const newPath = event.sessionPath;
        const oldPath = state.activeSessionPath;
        if (oldPath && oldPath.startsWith('__new__') && state.sessionModelMap[oldPath]) {
          state.sessionModelMap[newPath] = state.sessionModelMap[oldPath];
          delete state.sessionModelMap[oldPath];
          saveModelMap();
          // 更新 sessions 列表中的路径
          const ns = state.sessions.find(s => s.path === oldPath);
          if (ns) ns.path = newPath;
        }
        state.activeSessionPath = newPath;
        state.activeSessionPaths.add(newPath);
        renderSessionTabs();
      }
      break;
  }
}

// ── 卡住检测 ──
// 如果 120 秒没收到任何事件且 agent 仍在运行，提示可能卡住
const STALL_TIMEOUT_MS = 120000; // 2 分钟

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

function handleExited(data) {
  // 多实例：只处理当前活跃实例的退出
  if (data.cwd && state.workspacePath && data.cwd !== state.workspacePath) {
    return; // 非活跃实例退出，忽略
  }
  state.ompReady = false;
  state.agentRunning = false;
  updateInputState();
  updateStatus(`已断开 (code: ${data.code})`);
}

// ── Welcome Screen ──
function showWelcome() {
  if (dom.messages.children.length > 0) return;
  dom.messages.innerHTML = `
    <div class="welcome-screen">
      <div class="welcome-logo">omp</div>
      <div class="welcome-title">omp 桌面版</div>
      <div class="welcome-desc">AI 辅助编码助手 · 知识是基座，模型是执行器</div>
      <div class="welcome-tips">
        <div class="welcome-tip">左侧栏切换项目，顶栏切换对话</div>
        <div class="welcome-tip">点击右上角 📂 浏览工作目录文件</div>
        <div class="welcome-tip">点击模型名称快速切换 AI 模型</div>
        <div class="welcome-tip">输入消息开始对话</div>
      </div>
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
        try {
          await ompDesktop.switchSession(latest.path);
          dom.messages.innerHTML = '';
          await loadAndRenderHistory(latest.path);
        } catch (err) {
          // 恢复失败不影响使用
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
    return;
  }
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

// ── Project Context Menu ──
let activeContextMenu = null;

function showProjectContextMenu(e, project) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="archive">
      <span class="context-menu-icon">📦</span>归档项目
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" data-action="delete">
      <span class="context-menu-icon">🗑</span>删除项目
    </div>
  `;
  document.body.appendChild(menu);

  // 定位
  const rect = dom.projectList.getBoundingClientRect();
  let x = e.clientX;
  let y = e.clientY;
  // 确保不超出视口
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
    if (action === 'archive') await archiveProject(project);
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
    // 如果归档的是当前项目，清空聊天区
    if (project.dirName === state.activeProjectDirName) {
      state.activeProjectDirName = null;
      state.activeSessionPath = null;
      dom.messages.innerHTML = '';
      showWelcome();
    }
    addNotice('info', `已归档: ${project.displayName}`);
    await loadProjects();
  } catch (err) {
    addNotice('error', `归档失败: ${err.message}`);
  }
}

async function deleteProject(project) {
  const confirmed = confirm(`⚠️ 永久删除项目「${project.displayName || project.cwd}」？\n\n所有会话记录将丢失，无法恢复！`);
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
      state.ompReady = true;
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
        try {
          await ompDesktop.switchSession(latest.path);
          // 切换会话后恢复该对话之前使用的模型
          const saved = state.sessionModelMap[latest.path];
          if (saved && saved.provider && saved.modelId) {
            try {
              await ompDesktop.setModel(saved.provider, saved.modelId);
              state.currentModel = saved.modelId;
              state.currentProvider = saved.provider;
              dom.currentModel.textContent = saved.modelId;
            } catch {}
          }
          dom.messages.innerHTML = '';
          await loadAndRenderHistory(latest.path);
        } catch (err) {
          showWelcome();
        }
      }
    }
  } else {
    dom.messages.innerHTML = '';
    showWelcome();
  }
}

async function loadSessions(dirName) {
  const result = await ompDesktop.listSessions(dirName);
  if (result.error) {
    state.sessions = [];
  } else {
    state.sessions = result;
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
        html += `<div class="history-item" data-path="${escapeHtml(session.path)}">
          <div class="history-item-info" data-path="${escapeHtml(session.path)}">
            <span class="history-item-title">${escapeHtml(title.length > 25 ? title.substring(0, 25) + '...' : title)}</span>
            <span class="history-item-count">${msgCount}条</span>
          </div>
          <div class="history-item-actions">
            <button class="history-btn history-btn-archive" data-path="${escapeHtml(session.path)}" title="归档">&#128451;</button>
            <button class="history-btn history-btn-delete" data-path="${escapeHtml(session.path)}" title="删除">&#128465;</button>
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
    const target = e.target;

    // 归档按钮
    if (target.classList.contains('history-btn-archive')) {
      e.stopPropagation();
      const sessionPath = target.dataset.path;
      if (sessionPath) {
        const result = await ompDesktop.archiveSession(sessionPath);
        if (result.success) {
          addNotice('info', '对话已归档');
          state.activeSessionPaths.delete(sessionPath);
          // 如果归档的是当前活跃对话，切换到其他对话或欢迎页
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
    if (target.classList.contains('history-btn-delete')) {
      e.stopPropagation();
      const sessionPath = target.dataset.path;
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
    const itemInfo = target.closest('.history-item-info');
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
      await ompDesktop.newSession();
      // 新会话会重置为默认模型，把当前模型设回去（继承之前的模型）
      if (state.currentProvider && state.currentModel && state.currentModel !== '--') {
        try { await ompDesktop.setModel(state.currentProvider, state.currentModel); } catch {}
      }
      // 直接在 UI 上创建新 tab，不依赖磁盘刷新
      const newSession = {
        path: '__new__' + Date.now(),
        title: '新对话',
        firstMessage: '',
        messageCount: 0,
      };
      state.sessions.push(newSession);
      state.activeSessionPath = newSession.path;
      state.activeSessionPaths.add(newSession.path);
      // 记住新对话使用的模型
      if (state.currentProvider && state.currentModel) {
        state.sessionModelMap[newSession.path] = { provider: state.currentProvider, modelId: state.currentModel };
        saveModelMap();
      }
      renderSessionTabs();
      dom.messages.innerHTML = '';
      showWelcome();
      updateStatus('就绪');
      // 后台异步刷新真实会话列表（文件写入后）
      setTimeout(async () => {
        if (state.activeProjectDirName) {
          await loadSessions(state.activeProjectDirName);
          // 自动选中最新会话
          if (state.sessions.length > 0) {
            const latest = state.sessions[state.sessions.length - 1];
            state.activeSessionPath = latest.path;
            state.activeSessionPaths.add(latest.path);
            renderSessionTabs();
          }
        }
      }, 2000);
    } catch (err) {
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
    // 先通知 omp 切换会话上下文
    await ompDesktop.switchSession(sessionPath);
    // 切换会话后 omp 会重置模型到默认值，需要恢复该对话之前使用的模型
    const saved = state.sessionModelMap[sessionPath];
    if (saved && saved.provider && saved.modelId) {
      try {
        await ompDesktop.setModel(saved.provider, saved.modelId);
        state.currentModel = saved.modelId;
        state.currentProvider = saved.provider;
        dom.currentModel.textContent = saved.modelId;
      } catch (e) {
        console.warn('[渲染] 切换会话后恢复模型失败:', e);
      }
    }
    // 清空当前消息，准备加载历史
    dom.messages.innerHTML = '';
    // 加载并渲染历史消息
    await loadAndRenderHistory(sessionPath);
  } catch (err) {
    addNotice('error', `切换对话失败: ${err.message}`);
  }
}

async function loadAndRenderHistory(sessionPath) {
  try {
    const result = await ompDesktop.loadSessionHistory(sessionPath);
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
    addNotice('warning', `加载历史失败: ${err.message}`);
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

  // 思考过程（折叠）
  if (thinking) {
    const thinkDiv = document.createElement('div');
    thinkDiv.className = 'thinking-block';
    const thinkPreview = thinking.length > 80 ? thinking.substring(0, 80) + '...' : thinking;
    thinkDiv.innerHTML = `<div class="thinking-toggle">展开思考</div><div class="thinking-content" style="display:none;">${escapeHtml(thinking)}</div>`;
    const toggle = thinkDiv.querySelector('.thinking-toggle');
    const thinkContent = thinkDiv.querySelector('.thinking-content');
    toggle.addEventListener('click', () => {
      const visible = thinkContent.style.display !== 'none';
      thinkContent.style.display = visible ? 'none' : 'block';
      toggle.textContent = visible ? '展开思考' : '收起思考';
    });
    body.appendChild(thinkDiv);
  }

  // 工具调用（折叠摘要）
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      const tcDiv = document.createElement('div');
      tcDiv.className = 'tool-call';
      const tcHeader = document.createElement('div');
      tcHeader.className = 'tool-call-header';
      tcHeader.innerHTML = `<span class="tool-call-name">${escapeHtml(tc.name || 'tool')}</span><span class="tool-call-status done">完成</span>`;
      const tcBody = document.createElement('div');
      tcBody.className = 'tool-call-body collapsed';
      tcBody.textContent = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2);
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

  // 代码块复制按钮
  body.querySelectorAll('pre').forEach(pre => {
    if (!pre.querySelector('.copy-btn')) {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '复制';
      btn.style.cssText = 'position:absolute;top:4px;right:4px;padding:2px 8px;font-size:11px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:var(--text-secondary);cursor:pointer;';
      btn.onclick = () => {
        try {
          ompDesktop.clipboardWriteText(pre.textContent);
          btn.textContent = '已复制!';
          setTimeout(() => btn.textContent = '复制', 2000);
        } catch {
          navigator.clipboard.writeText(pre.textContent).then(() => {
            btn.textContent = '已复制!';
            setTimeout(() => btn.textContent = '复制', 2000);
          });
        }
      };
      pre.style.position = 'relative';
      pre.appendChild(btn);
    }
  });

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
      if (state.currentThinkingEl) {
        const c = state.currentThinkingEl.querySelector('.thinking-content');
        if (c) {
          c.textContent += assistantEvent.delta;
        }
      }
      break;
    case 'thinking_end':
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
  body.querySelectorAll('pre').forEach(pre => {
    if (!pre.querySelector('.copy-btn')) {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '复制';
      btn.style.cssText = 'position:absolute;top:4px;right:4px;padding:2px 8px;font-size:11px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:var(--text-secondary);cursor:pointer;';
      btn.onclick = () => {
        try {
          ompDesktop.clipboardWriteText(pre.textContent);
          btn.textContent = '已复制!';
          setTimeout(() => btn.textContent = '复制', 2000);
        } catch {
          navigator.clipboard.writeText(pre.textContent).then(() => {
            btn.textContent = '已复制!';
            setTimeout(() => btn.textContent = '复制', 2000);
          });
        }
      };
      pre.style.position = 'relative';
      pre.appendChild(btn);
    }
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
  const div = document.createElement('div');
  div.className = 'thinking-block';
  div.innerHTML = `<div class="thinking-toggle">思考中...</div><div class="thinking-content" style="display:none;"></div>`;
  const toggle = div.querySelector('.thinking-toggle');
  const content = div.querySelector('.thinking-content');
  toggle.addEventListener('click', () => {
    const visible = content.style.display !== 'none';
    content.style.display = visible ? 'none' : 'block';
    toggle.textContent = visible ? '展开思考' : '收起思考';
  });
  return div;
}

// ── Tool Call Rendering ──

function handleToolStart(toolCallId, toolName, args) {
  updateStatus(`执行: ${toolName}`);
  const div = document.createElement('div');
  div.className = 'tool-call';
  div.id = `tool-${toolCallId}`;
  const header = document.createElement('div');
  header.className = 'tool-call-header';
  header.innerHTML = `<span class="tool-call-name">${escapeHtml(toolName)}</span>
    <span class="tool-call-status running">执行中</span>`;
  header.addEventListener('click', () => div.querySelector('.tool-call-body').classList.toggle('collapsed'));
  const body = document.createElement('div');
  body.className = 'tool-call-body collapsed';
  if (args) body.textContent = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
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
    body.textContent = r.substring(0, 10000);
  }
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
      document.title = `omp Desktop - ${event.title || ''}`;
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
      if (event.text) dom.input.value = event.text;
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  dom.input.addEventListener('input', () => {
    dom.input.style.height = 'auto';
    dom.input.style.height = Math.min(dom.input.scrollHeight, 150) + 'px';
  });
  dom.btnSend.addEventListener('click', sendMessage);
  dom.btnAbort.addEventListener('click', abortMessage);
}

async function sendMessage() {
  const message = dom.input.value.trim();
  if (!message) return;
  if (!state.ompReady) { addNotice('warning', 'omp 尚未就绪'); return; }
  // Clear welcome screen on first message
  const welcome = dom.messages.querySelector('.welcome-screen');
  if (welcome) welcome.remove();
  dom.input.value = '';
  dom.input.style.height = 'auto';
  try { await ompDesktop.send(message); }
  catch (err) { addNotice('error', `发送失败: ${err.message}`); }
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
  if (!state.agentRunning) dom.input.focus();
}

function updateStatus(text) { dom.statusText.textContent = text; }

function addNotice(level, message) {
  const div = document.createElement('div');
  div.className = `notice ${level}`;
  div.textContent = message;
  dom.messages.appendChild(div);
  scrollToBottom();
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
    item.innerHTML = `<span class="file-tree-icon">${icon}</span>${escapeHtml(entry.name)}`;
    item.addEventListener('click', () => {
      if (entry.isDirectory) toggleDirectory(entry, item, depth);
      else openFilePreview(entry);
    });
    container.appendChild(item);
  }
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
  const title = session.title || session.firstMessage || '新对话';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="archive">
      <span class="context-menu-icon">&#128451;</span>归档对话
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" data-action="delete">
      <span class="context-menu-icon">&#128465;</span>删除对话
    </div>
  `;
  document.body.appendChild(menu);

  // 定位
  let x = e.clientX;
  let y = e.clientY;
  const menuWidth = 150, menuHeight = 80;
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
    if (action === 'archive') await archiveSessionFromTab(session);
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

// ── Utilities ──
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function scrollToBottom() {
  requestAnimationFrame(() => { dom.messages.scrollTop = dom.messages.scrollHeight; });
}
const path = {
  basename: (p) => (p || '').split(/[\\/]/).pop(),
  extname: (p) => { const name = path.basename(p); const dot = name.lastIndexOf('.'); return dot > 0 ? name.substring(dot) : ''; },
};

// ── Theme Toggle ──
function setupThemeToggle() {
  // 从 localStorage 恢复主题
  const saved = localStorage.getItem('omp-theme') || 'dark';
  applyTheme(saved);

  if (dom.btnTheme) {
    dom.btnTheme.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('omp-theme', next);
    });
  }
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  // 切换图标：暗色时显示月亮，亮色时显示太阳
  const moonIcon = document.querySelector('.icon-moon');
  const sunIcon = document.querySelector('.icon-sun');
  if (moonIcon && sunIcon) {
    moonIcon.style.display = theme === 'dark' ? '' : 'none';
    sunIcon.style.display = theme === 'light' ? '' : 'none';
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

// ── Settings ──
function setupSettings() {
  dom.btnSettings.addEventListener('click', () => {
    dom.settingsOverlay.classList.toggle('hidden');
    if (!dom.settingsOverlay.classList.contains('hidden')) { loadConstraintsPreview(); loadModelConfig(); loadModelList(); }
  });
  dom.btnCloseSettings.addEventListener('click', () => dom.settingsOverlay.classList.add('hidden'));
  dom.settingsOverlay.addEventListener('click', (e) => { if (e.target === dom.settingsOverlay) dom.settingsOverlay.classList.add('hidden'); });
  dom.btnOpenConstraints.addEventListener('click', async () => { ompDesktop.openPath((await ompDesktop.getRootPath()) + '\\data\\memory\\constraints.md'); });
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
  } catch (err) { addNotice('error', `切换模型失败: ${err.message}`); }
}

// 从 omp 获取当前模型名并更新顶栏显示
async function fetchCurrentModel() {
  try {
    const result = await ompDesktop.getModels();
    if (result && result.models && result.models.length > 0) {
      // 取第一个模型作为当前模型（omp 默认加载的）
      const first = result.models[0];
      const name = first.name || first.id || '';
      if (name) {
        state.currentModel = name;
        dom.currentModel.textContent = name;
      }
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

// ── Model Switcher ──
function setupModelSwitcher() {
  dom.currentModel.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.modelSwitcher.classList.toggle('hidden');
    if (!dom.modelSwitcher.classList.contains('hidden')) loadModelSwitcherList();
  });
  document.addEventListener('click', (e) => {
    if (!dom.modelSwitcher.contains(e.target) && e.target !== dom.currentModel) dom.modelSwitcher.classList.add('hidden');
  });
}

async function loadModelSwitcherList() {
  dom.modelSwitcherList.innerHTML = '<div class="model-item loading">加载中...</div>';
  try {
    await loadHiddenModels();
    const result = await ompDesktop.getModels();
    if (result && result.models) {
      dom.modelSwitcherList.innerHTML = '';
      const visible = result.models.filter(m => !hiddenModels.has(m.id));
      for (const model of visible) {
        const div = document.createElement('div');
        div.className = 'model-item';
        if (state.currentModel === model.id || state.currentModel === model.name) div.classList.add('active');
        div.textContent = model.name || model.id;
        div.addEventListener('click', () => { switchModel(model.provider, model.id); dom.modelSwitcher.classList.add('hidden'); });
        dom.modelSwitcherList.appendChild(div);
      }
    } else dom.modelSwitcherList.innerHTML = '<div class="model-item empty">暂无模型</div>';
  } catch { dom.modelSwitcherList.innerHTML = '<div class="model-item empty">加载失败</div>'; }
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
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); if (confirm(`确定删除供应商 "${provKey}"？`)) { delete modelsConfigData.providers[provKey]; card.remove(); } });
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

function addProviderUI() {
  // 使用 position: fixed 挂到 body，避免 settings-panel overflow:hidden 导致输入框无法交互
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1100;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:20px;width:400px;max-height:80vh;overflow-y:auto;';
  box.innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:12px;">添加供应商</div>
    <label style="font-size:12px;color:var(--text-muted);">供应商名称</label>
    <input id="addProvName" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);" placeholder="my-provider">
    <label style="font-size:12px;color:var(--text-muted);">API 地址</label>
    <input id="addProvUrl" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);" value="https://api.example.com/v1">
    <label style="font-size:12px;color:var(--text-muted);">API Key</label>
    <input id="addProvKey" type="password" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);" placeholder="sk-xxx">
    <button id="addProvFetch" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px dashed var(--border);border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer;">从服务器拉取模型列表</button>
    <div id="addProvFetchStatus" style="font-size:11px;color:var(--text-muted);margin-bottom:6px;display:none;"></div>
    <div id="addProvModelList" style="display:none;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-bottom:12px;"></div>
    <div style="font-size:12px;color:var(--text-muted);margin:8px 0 4px;border-top:1px solid var(--border);padding-top:10px;">添加模型</div>
    <div style="display:flex;gap:4px;margin-bottom:4px;">
      <input id="addModelId" style="flex:2;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;" placeholder="模型 ID">
      <input id="addModelName" style="flex:2;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;" placeholder="显示名称">
      <input id="addModelCtx" type="number" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;" placeholder="上下文" value="128000">
      <button id="addModelBtn" style="padding:6px 10px;border:1px solid var(--accent);border-radius:4px;background:var(--accent);color:white;cursor:pointer;font-size:12px;white-space:nowrap;">+</button>
    </div>
    <div id="addProvManualModels" style="margin-bottom:12px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="addProvCancel" style="padding:6px 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">取消</button>
      <button id="addProvOk" style="padding:6px 16px;border:none;border-radius:4px;background:var(--accent);color:white;cursor:pointer;">确认添加</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const nameInput = box.querySelector('#addProvName');
  const urlInput = box.querySelector('#addProvUrl');
  const keyInput = box.querySelector('#addProvKey');
  const fetchBtn = box.querySelector('#addProvFetch');
  const fetchStatus = box.querySelector('#addProvFetchStatus');
  const modelListDiv = box.querySelector('#addProvModelList');
  const manualModelsDiv = box.querySelector('#addProvManualModels');
  setTimeout(() => nameInput.focus(), 50);

  const selectedModels = new Map();
  const manualModels = [];

  // 从服务器拉取
  fetchBtn.addEventListener('click', async () => {
    const baseUrl = urlInput.value.trim();
    const apiKey = keyInput.value.trim();
    if (!baseUrl) { addNotice('error', '请先填写 API 地址'); return; }
    fetchStatus.style.display = 'block';
    fetchStatus.textContent = '正在拉取...';
    fetchBtn.disabled = true;
    const result = await ompDesktop.fetchProviderModels(baseUrl, apiKey);
    fetchBtn.disabled = false;
    if (result.error) {
      fetchStatus.textContent = '拉取失败: ' + result.error;
      fetchStatus.style.color = 'var(--danger)';
      return;
    }
    const models = result.models || [];
    if (models.length === 0) {
      fetchStatus.textContent = '服务器返回空列表';
      return;
    }
    fetchStatus.textContent = `找到 ${models.length} 个模型，勾选需要的：`;
    fetchStatus.style.color = 'var(--text-muted)';
    modelListDiv.style.display = 'block';
    modelListDiv.innerHTML = '';
    for (const m of models) {
      selectedModels.set(m.id, { id: m.id, name: m.name, checked: false });
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;cursor:pointer;font-size:12px;color:var(--text-secondary);';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => { selectedModels.get(m.id).checked = cb.checked; });
      row.appendChild(cb);
      row.appendChild(document.createTextNode(m.id));
      modelListDiv.appendChild(row);
    }
  });

  // 手动添加模型
  box.querySelector('#addModelBtn').addEventListener('click', () => {
    const id = box.querySelector('#addModelId').value.trim();
    if (!id) return;
    const name = box.querySelector('#addModelName').value.trim() || id;
    const ctx = parseInt(box.querySelector('#addModelCtx').value) || 128000;
    manualModels.push({ id, name, contextWindow: ctx });
    box.querySelector('#addModelId').value = '';
    box.querySelector('#addModelName').value = '';
    renderManualModels();
  });

  // 回车也添加
  box.querySelector('#addModelId').addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector('#addModelBtn').click(); });
  box.querySelector('#addModelName').addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector('#addModelBtn').click(); });

  function renderManualModels() {
    manualModelsDiv.innerHTML = '';
    for (let i = 0; i < manualModels.length; i++) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;color:var(--text-secondary);';
      row.textContent = `${manualModels[i].id} — ${manualModels[i].name} (${manualModels[i].contextWindow}K)`;
      const del = document.createElement('button');
      del.textContent = 'x';
      del.style.cssText = 'margin-left:auto;border:none;background:none;color:var(--danger);cursor:pointer;font-size:12px;';
      del.addEventListener('click', () => { manualModels.splice(i, 1); renderManualModels(); });
      row.appendChild(del);
      manualModelsDiv.appendChild(row);
    }
  }

  const close = () => overlay.remove();
  box.querySelector('#addProvCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  box.querySelector('#addProvOk').addEventListener('click', () => {
    const raw = nameInput.value.trim();
    const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!clean) { addNotice('error', '名称无效'); close(); return; }
    if (modelsConfigData.providers[clean]) { addNotice('error', '已存在'); close(); return; }
    const baseUrl = urlInput.value.trim() || 'https://api.example.com/v1';
    const apiKey = keyInput.value.trim();
    const allModels = [];
    for (const m of selectedModels.values()) {
      if (m.checked) allModels.push({ id: m.id, name: m.name, reasoning: false, input: ['text'], supportsTools: true, contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    }
    for (const m of manualModels) {
      allModels.push({ id: m.id, name: m.name, reasoning: false, input: ['text'], supportsTools: true, contextWindow: m.contextWindow || 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    }
    if (allModels.length === 0) {
      addNotice('error', '请至少添加一个模型');
      return;
    }
    modelsConfigData.providers[clean] = { baseUrl, apiKey: apiKey || 'none', api: 'custom-openai', models: allModels };
    close();
    document.getElementById('modelConfig').innerHTML = ''; renderModelConfig();
  });
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
