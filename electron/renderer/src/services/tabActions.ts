/**
 * tabActions — 会话 tab 的动作层（等价旧版 closeTab 流程 + tab 右键菜单）
 *
 * - closeTab：__new__ 兜底迁移 / preparing 锁释放 / 活跃 tab 关闭后切回剩余最后一个
 * - 右键菜单：AI 重命名 / 手动重命名 / 分支 / 导出 HTML / 归档 / 删除
 * - showModalConfirm / showBranchPicker：DOM 模态框（复用 styles.css 现成选择器）
 */
import { useSessionsStore, type TabMeta } from '../stores/useSessionsStore';
import { useProjectsStore } from '../stores/useProjectsStore';
import { useChatStore } from '../stores/useChatStore';
import { useProcStore } from '../stores/useProcStore';
import { useUiStore } from '../stores/useUiStore';
import { switchToSession, loadSessions, showModalInput } from './sessionController';
import { extractRecentMessages, buildRenamePrompt } from './historyService';
import { dirNameFromSessionPath, extractSessionId, escapeHtml } from './utils';

/** 右键菜单 / 分支等动作使用的会话摘要（TabMeta 兼容） */
export interface TabSession extends TabMeta {
  path: string;
}

// ── 内存清理（归档/删除后调用，等价旧版 cleanupSessionMemory）──

function cleanupSessionMemory(sessionPath: string): void {
  const sessions = useSessionsStore.getState();
  sessions.removeSessionModel(sessionPath);
  sessions.closeTab(sessionPath);
  useProcStore.setState((s) => {
    const procStateMap = { ...s.procStateMap };
    delete procStateMap[sessionPath];
    return { procStateMap };
  });
  useChatStore.setState((s) => {
    const messagesMap = { ...s.messagesMap };
    const streaming = { ...s.streaming };
    const sessionMessageCache = { ...s.sessionMessageCache };
    const sessionCacheFresh = { ...s.sessionCacheFresh };
    const history = { ...s.history };
    delete messagesMap[sessionPath];
    delete streaming[sessionPath];
    delete sessionMessageCache[sessionPath];
    delete sessionCacheFresh[sessionPath];
    delete history[sessionPath];
    return { messagesMap, streaming, sessionMessageCache, sessionCacheFresh, history };
  });
  // 立即从项目会话缓存移除（树不残留已删会话）
  const dir = dirNameFromSessionPath(sessionPath) || useProjectsStore.getState().activeProjectDirName;
  if (dir) {
    const projects = useProjectsStore.getState();
    const list = projects.projectSessions[dir];
    if (list) {
      projects.setProjectSessions(
        dir,
        list.filter((s) => s.path !== sessionPath),
      );
    }
  }
}

/** 活跃 tab 被移除后的收尾：切回剩余最后一个，否则清空回欢迎页 */
function afterActiveTabRemoved(): void {
  const sessions = useSessionsStore.getState();
  useSessionsStore.setState({ activeSessionPath: null, activeSessionId: null });
  const remaining = sessions.activeSessionPaths.filter((p) => p !== sessions.activeSessionPath);
  const last = remaining[remaining.length - 1];
  if (last) {
    void switchToSession(last);
  } else {
    useChatStore.getState().setMessages(null, []);
    useChatStore.getState().setWelcomePhase('showing');
  }
}

// ── 关闭 tab（等价旧版 session-tab-close 分支）──

/** 关闭 tab：__new__ 兜底迁移后移除，活跃则切回剩余最后一个 */
export async function closeTab(path: string, meta: TabMeta): Promise<void> {
  const sessions = useSessionsStore.getState();

  // __new__ 兜底迁移：session_switch 可能还没到达，但内核可能已写盘 JSONL。
  // 用实例 sessionFilePath 查找真实路径，已写盘则保留对话（迁移到真实路径）。
  if (path.startsWith('__new__') && meta.sessionId) {
    try {
      const instances = (await window.tiffaDesktop.getInstances()) as
        | Array<{ sessionId?: string; cwd?: string; sessionFilePath?: string }>
        | undefined;
      if (instances && Array.isArray(instances)) {
        const inst =
          instances.find((i) => i.sessionId === meta.sessionId) ||
          instances.find(
            (i) => i.cwd === useProjectsStore.getState().workspacePath && i.sessionFilePath,
          );
        if (inst && inst.sessionFilePath) {
          const newPath = inst.sessionFilePath;
          if (!sessions.activeTabMeta[newPath]) {
            sessions.openTab(newPath, {
              ...meta,
              sessionId: extractSessionId(newPath) || meta.sessionId,
            });
          }
          // 刷新左侧树让用户看到这个对话
          const dir = dirNameFromSessionPath(newPath) || useProjectsStore.getState().activeProjectDirName;
          if (dir) void loadSessions(dir);
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 释放该 tab 的准备阶段锁
  if (sessions.preparingNewSessions[path]) {
    sessions.clearPreparing(path);
  }

  sessions.closeTab(path);
  const isActive = sessions.activeSessionPath === path;
  if (isActive) afterActiveTabRemoved();
  sessions.saveOpenTabs();
}

// ── 确认对话框（等价旧版 showModalConfirm）──

/**
 * 动态创建 extModal 结构（复用 styles.css 的 #extModal / .ext-modal-* 选择器）。
 * 返回 Promise<boolean>；遮罩不拦截点击（pointer-events 在 CSS 中已处理）。
 */
export function showModalConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'extModal';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="ext-modal-panel">
        <div class="ext-modal-title">${escapeHtml(title || '确认')}</div>
        <div class="ext-modal-body"><div style="color:var(--text-secondary);white-space:pre-wrap;">${escapeHtml(message || '')}</div></div>
        <div class="ext-modal-actions">
          <button type="button" class="settings-btn" data-role="cancel">取消</button>
          <button type="button" class="settings-btn" data-role="ok" style="background:var(--accent);color:white;border-color:var(--accent)">确认</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const cleanup = () => overlay.remove();
    const onOk = () => {
      cleanup();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    overlay.querySelector('[data-role="ok"]')?.addEventListener('click', onOk);
    overlay.querySelector('[data-role="cancel"]')?.addEventListener('click', onCancel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) onCancel();
    });
  });
}

// ── 分支选择器（等价旧版 showBranchPicker）──

interface BranchEntry {
  id: string;
  text?: string;
}

function showBranchPicker(session: TabSession, entries: BranchEntry[]): void {
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
      <button type="button" class="settings-close" data-role="close">&times;</button>
    </div>
    <div class="branch-list">${listHtml}</div>
    <div class="branch-hint">点击选择分支点</div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  modal.querySelector('[data-role="close"]')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  modal.querySelectorAll('.branch-entry').forEach((el) => {
    el.addEventListener('click', async () => {
      const msgId = (el as HTMLElement).dataset.id || '';
      const text = entries.find((e) => e.id === msgId)?.text || '';
      close();
      try {
        await window.tiffaDesktop.command('branch', { entryId: msgId }, useSessionsStore.getState().activeSessionId);
        useChatStore.getState().setDraftInput(text);
        useUiStore.getState().addToast('info', '已创建分支，输入框已预填原始消息');
        const dir = dirNameFromSessionPath(session.path) || useProjectsStore.getState().activeProjectDirName;
        if (dir) void loadSessions(dir);
      } catch (err) {
        useUiStore.getState().addToast('error', `分支失败: ${(err as Error).message}`);
      }
    });
  });
}

// ── 手动重命名（等价旧版 renameSession）──

export async function renameTabSession(session: TabSession): Promise<void> {
  const ui = useUiStore.getState();
  if (!session || !session.path) return;
  const currentTitle = session.title || session.firstMessage || '新对话';
  const newTitle = await showModalInput('请输入新的对话名称：', currentTitle);
  if (newTitle === null) return;
  const trimmedTitle = newTitle.trim();
  if (!trimmedTitle) {
    ui.addToast('warning', '对话名称不能为空');
    return;
  }
  // __new__ 临时会话还没写盘，不调用后端
  if (session.path.startsWith('__new__')) {
    useSessionsStore.getState().updateTabMeta(session.path, { title: trimmedTitle });
    useSessionsStore.getState().markAutoNamed(session.path);
    useSessionsStore.getState().saveOpenTabs();
    return;
  }
  const result = (await window.tiffaDesktop.renameSession(session.path, trimmedTitle)) as { success?: boolean; error?: string } | undefined;
  if (result && result.success !== false && !result?.error) {
    useSessionsStore.getState().updateTabMeta(session.path, { title: trimmedTitle });
    useSessionsStore.getState().markAutoNamed(session.path);
    useSessionsStore.getState().saveOpenTabs();
    const dir = dirNameFromSessionPath(session.path);
    if (dir) void loadSessions(dir);
    ui.addToast('success', '对话已重命名');
  } else {
    ui.addToast('error', `重命名失败: ${(result && result.error) || '未知错误'}`);
  }
}

// ── AI 重命名（等价旧版 aiRenameSession）──

export async function aiRenameTabSession(session: TabSession): Promise<void> {
  const ui = useUiStore.getState();
  const sessions = useSessionsStore.getState();
  if (!session || !session.path) return;

  // 1. 取上下文：优先最近 N 条消息（主题可能漂移），回退 firstMessage
  let context = '';
  const oldTitle = session.title && session.title !== '新对话' ? session.title : null;
  try {
    if (!session.path.startsWith('__new__')) {
      const hist = await window.tiffaDesktop.loadSessionHistory(session.path, { tail: 100 });
      if (hist && !(hist as { error?: string }).error && (hist as { messages?: Array<Record<string, unknown>> }).messages) {
        context = extractRecentMessages((hist as { messages: Array<Record<string, unknown>> }).messages, 6);
      }
    }
  } catch {
    /* ignore */
  }
  if (!context.trim()) context = session.firstMessage || '';
  if (!context.trim()) {
    ui.addToast('warning', session.path.startsWith('__new__') ? '新建对话还在初始化，请稍候几秒再重命名' : '对话没有内容，无法生成标题');
    return;
  }

  ui.addToast('info', '正在生成标题…');

  // 2. 走轻量模型补全（旁路模型优先，降级到当前模型/豆包兜底）
  const prompt = buildRenamePrompt(context, oldTitle);
  let result: { text?: string; error?: string; model?: string } | undefined;
  try {
    result = (await window.tiffaDesktop.completeWithLightModel(prompt, 80, ui.currentProvider, ui.currentModel)) as {
      text?: string;
      error?: string;
      model?: string;
    };
  } catch (err) {
    ui.addToast('error', `AI 重命名失败: ${(err as Error).message}`);
    return;
  }
  if (result && result.error) {
    // 无可用模型时给出明确提示
    if (result.error.includes('无可用模型')) {
      ui.addToast('warning', 'AI 重命名需要配置模型：请在设置中配置旁路模型，或确保 models.yml 中至少有一个可用的 provider');
    } else {
      ui.addToast('error', `AI 重命名失败: ${result.error}`);
    }
    return;
  }
  const title = ((result && result.text) || '').trim().replace(/^["'“”《]+|["'“”》]+$/g, '').substring(0, 30);
  if (!title) {
    ui.addToast('warning', 'AI 未能生成标题');
    return;
  }

  // 3. 即时应用标题（不等 agent_end 异步流）
  sessions.updateTabMeta(session.path, { title });
  if (!session.path.startsWith('__new__')) {
    const r = (await window.tiffaDesktop.renameSession(session.path, title)) as { error?: string } | undefined;
    if (r && r.error) {
      ui.addToast('error', `保存标题失败: ${r.error}`);
      return;
    }
  }
  sessions.markAutoNamed(session.path);
  sessions.saveOpenTabs();
  const dir = dirNameFromSessionPath(session.path);
  if (dir) void loadSessions(dir);
  ui.addToast('success', `已重命名：${title}（${(result && result.model) || '当前模型'}）`);
}

// ── 分支 ──

export async function branchTabSession(session: TabSession): Promise<void> {
  const ui = useUiStore.getState();
  if (!session || !session.path) return;
  try {
    const result = (await window.tiffaDesktop.getUserEntries(session.path)) as { entries?: BranchEntry[]; error?: string } | undefined;
    if (!result || !result.entries || result.entries.length === 0) {
      ui.addToast('warning', '该对话没有可分支的用户消息');
      return;
    }
    showBranchPicker(session, result.entries);
  } catch (err) {
    ui.addToast('error', `获取对话记录失败: ${(err as Error).message}`);
  }
}

// ── 导出 HTML ──

export async function exportTabSessionHtml(session: TabSession): Promise<void> {
  const ui = useUiStore.getState();
  if (!session || !session.path) return;
  try {
    const result = (await window.tiffaDesktop.exportSessionHtml(session.path)) as { path?: string; error?: string } | undefined;
    if (result && result.path) ui.addToast('success', `已导出到: ${result.path}`);
    else if (result && result.error) ui.addToast('error', `导出失败: ${result.error}`);
    else ui.addToast('info', '导出完成');
  } catch (err) {
    ui.addToast('error', `导出失败: ${(err as Error).message}`);
  }
}

// ── 归档 / 删除（共享收尾）──

async function removeSessionFromTab(session: TabSession, op: 'archive' | 'delete'): Promise<void> {
  const ui = useUiStore.getState();
  const title = session.title || session.firstMessage || '新对话';
  if (op === 'delete') {
    const ok = await showModalConfirm('删除对话', `确定要删除对话「${title}」吗？删除后无法恢复。`);
    if (!ok) return;
  }
  const result =
    op === 'archive'
      ? ((await window.tiffaDesktop.archiveSession(session.path)) as { success?: boolean; error?: string } | undefined)
      : ((await window.tiffaDesktop.deleteSession(session.path)) as { success?: boolean; error?: string } | undefined);
  if (!result || result.success === false || result.error) {
    ui.addToast('error', `${op === 'archive' ? '归档' : '删除'}失败: ${(result && result.error) || '未知错误'}`);
    return;
  }
  ui.addToast('info', op === 'archive' ? '对话已归档' : '对话已删除');
  cleanupSessionMemory(session.path);
  if (useSessionsStore.getState().activeSessionPath === session.path) {
    afterActiveTabRemoved();
  }
  const dir = dirNameFromSessionPath(session.path);
  if (dir) void loadSessions(dir);
}

export function archiveTabSession(session: TabSession): Promise<void> {
  return removeSessionFromTab(session, 'archive');
}

export function deleteTabSession(session: TabSession): Promise<void> {
  return removeSessionFromTab(session, 'delete');
}
