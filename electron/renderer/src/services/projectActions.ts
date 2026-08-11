/**
 * projectActions — 项目面板动作层（等价旧版 openNewProjectFolder / archiveProject /
 * deleteProject / restoreArchivedProject / hardDeleteArchivedProject）
 *
 * - 打开新项目文件夹（openFolderDialog + activateInstance）
 * - 归档/删除项目：确认 → IPC → 清理该项目全局 tab → 切走/回欢迎页 → 刷新列表
 * - 归档项目恢复 / 永久删除
 */
import { useSessionsStore } from '../stores/useSessionsStore';
import { useProjectsStore } from '../stores/useProjectsStore';
import { useChatStore } from '../stores/useChatStore';
import { useProcStore } from '../stores/useProcStore';
import { useUiStore } from '../stores/useUiStore';
import { loadProjects, selectProject, switchToSession, loadSessions } from './sessionController';
import { showModalConfirm } from './tabActions';
import { dirNameFromSessionPath, extractSessionId } from './utils';
import type { TiffaProjectSummary } from '../types/tiffaDesktop';

/** 清理某项目的全局 tab（其他项目不受影响） */
function cleanupProjectTabs(dirName: string): void {
  const sessions = useSessionsStore.getState();
  const tabs = Object.entries(sessions.activeTabMeta).filter(([, m]) => m.dirName === dirName);
  for (const [p] of tabs) {
    sessions.closeTab(p);
  }
  const projects = useProjectsStore.getState();
  const list = projects.projectSessions[dirName];
  if (list) {
    useProjectsStore.setState((s) => {
      const projectSessions = { ...s.projectSessions };
      delete projectSessions[dirName];
      return { projectSessions };
    });
  }
  return undefined;
}

/** 若当前活跃会话属于该项目：切到剩余最后一个 tab，否则回欢迎页 */
async function switchAwayIfActive(dirName: string): Promise<void> {
  const sessions = useSessionsStore.getState();
  const active = sessions.activeSessionPath;
  if (active && sessions.activeTabMeta[active] && sessions.activeTabMeta[active].dirName === dirName) {
    const remaining = sessions.activeSessionPaths.filter((p) => p !== active);
    const last = remaining[remaining.length - 1];
    if (last) {
      await switchToSession(last);
    } else {
      useSessionsStore.setState({ activeSessionPath: null, activeSessionId: null });
      useChatStore.getState().setWelcomePhase('showing');
    }
  }
}

// ── 打开新项目文件夹（等价旧版 openNewProjectFolder）──

export async function openNewProjectFolder(): Promise<void> {
  const ui = useUiStore.getState();
  const projects = useProjectsStore.getState();
  const proc = useProcStore.getState();
  try {
    // 保存旧实例状态
    if (projects.workspacePath) {
      const active = useSessionsStore.getState().activeSessionPath;
      const running = active ? proc.procStateMap[active]?.agentRunning : false;
      proc.setInstanceRunning(projects.workspacePath, !!running);
    }

    const result = (await window.tiffaDesktop.openFolderDialog()) as { canceled?: boolean; error?: string; path?: string } | undefined;
    if (!result || result.canceled) return;
    if (result.error) {
      ui.addToast('error', `打开文件夹失败: ${result.error}`);
      return;
    }
    const folderPath = result.path;
    if (!folderPath) return;
    ui.setStatusText('切换项目...');
    const changeResult = (await window.tiffaDesktop.activateInstance(folderPath)) as { error?: string } | undefined;
    if (changeResult && changeResult.error) {
      ui.addToast('error', `切换项目失败: ${changeResult.error}`);
      ui.setStatusText('就绪');
      return;
    }
    projects.setWorkspacePath(folderPath);
    useProjectsStore.setState({ activeProjectDirName: null });
    useSessionsStore.setState({ activeSessionPath: null, activeSessionId: null });
    proc.setReady(true);

    // 恢复新实例状态
    try {
      const instances = (await window.tiffaDesktop.getInstances()) as Array<{ cwd: string; agentRunning?: boolean }>;
      const current = instances.find((i) => i.cwd === folderPath);
      if (current) {
        proc.setInstanceRunning(folderPath, !!current.agentRunning);
      }
    } catch {
      /* ignore */
    }

    useChatStore.getState().setWelcomePhase('showing');
    ui.setStatusText('就绪');
    // 重新加载项目列表（新 cwd 会在 Tiffa 发消息后自动出现）
    await loadProjects();
    ui.addToast('info', `已切换到: ${folderPath}`);
  } catch (err) {
    ui.addToast('error', `切换项目失败: ${(err as Error).message}`);
    ui.setStatusText('就绪');
  }
}

// ── 归档 / 删除项目 ──

export async function archiveProject(project: TiffaProjectSummary): Promise<void> {
  const ui = useUiStore.getState();
  const ok = await showModalConfirm(
    '归档项目',
    `归档项目「${project.title || project.dirName}」？\n\n项目会话将移至归档区，可随时恢复。`,
  );
  if (!ok) return;
  try {
    const result = (await window.tiffaDesktop.archiveProject(project.dirName, project.cwd || '')) as { error?: string } | undefined;
    if (result && result.error) {
      ui.addToast('error', `归档失败: ${result.error}`);
      return;
    }
    cleanupProjectTabs(project.dirName);
    await switchAwayIfActive(project.dirName);
    const projects = useProjectsStore.getState();
    if (project.dirName === projects.activeProjectDirName) {
      useProjectsStore.setState({ activeProjectDirName: null });
      useSessionsStore.setState({ activeSessionPath: null, activeSessionId: null });
      if (Object.keys(useSessionsStore.getState().activeTabMeta).length === 0) {
        useChatStore.getState().setWelcomePhase('showing');
      }
    }
    useSessionsStore.getState().saveOpenTabs();
    ui.addToast('info', `已归档: ${project.title || project.dirName}`);
    await loadProjects();
  } catch (err) {
    ui.addToast('error', `归档失败: ${(err as Error).message}`);
  }
}

export async function deleteProject(project: TiffaProjectSummary): Promise<void> {
  const ui = useUiStore.getState();
  const ok = await showModalConfirm(
    '删除项目',
    `永久删除项目「${project.title || project.dirName}」？\n\n所有会话记录将丢失，无法恢复！`,
  );
  if (!ok) return;
  const doubleCheck = await showModalConfirm(
    '再次确认',
    `删除「${project.title || project.dirName}」的全部数据？此操作不可撤销。`,
  );
  if (!doubleCheck) return;
  try {
    const result = (await window.tiffaDesktop.deleteProject(project.dirName, project.cwd || '')) as { error?: string } | undefined;
    if (result && result.error) {
      ui.addToast('error', `删除失败: ${result.error}`);
      return;
    }
    // 加入 removedCwds 防止 discoverWorkspaceProjects 让它复活
    if (project.cwd) {
      try {
        await window.tiffaDesktop.addRemovedCwd(project.cwd);
      } catch {
        /* ignore */
      }
    }
    cleanupProjectTabs(project.dirName);
    await switchAwayIfActive(project.dirName);
    if (project.dirName === useProjectsStore.getState().activeProjectDirName) {
      useProjectsStore.setState({ activeProjectDirName: null });
    }
    useSessionsStore.getState().saveOpenTabs();
    ui.addToast('info', `已删除: ${project.title || project.dirName}`);
    await loadProjects();
  } catch (err) {
    ui.addToast('error', `删除失败: ${(err as Error).message}`);
  }
}

// ── 归档项目：恢复 / 永久删除 ──

export async function restoreArchivedProject(project: TiffaProjectSummary): Promise<void> {
  const ui = useUiStore.getState();
  try {
    const result = (await window.tiffaDesktop.restoreProject(project.dirName)) as { error?: string } | undefined;
    if (result && result.error) {
      ui.addToast('error', `恢复失败: ${result.error}`);
      return;
    }
    ui.addToast('info', `已恢复: ${project.title || project.dirName}`);
    await loadProjects();
  } catch (err) {
    ui.addToast('error', `恢复失败: ${(err as Error).message}`);
  }
}

export async function hardDeleteArchivedProject(project: TiffaProjectSummary): Promise<void> {
  const ui = useUiStore.getState();
  const ok = await showModalConfirm(
    '永久删除归档项目',
    `永久删除归档项目「${project.title || project.dirName}」？\n\n所有数据将丢失，无法恢复！`,
  );
  if (!ok) return;
  try {
    const result = (await window.tiffaDesktop.deleteProject(project.dirName, project.cwd || '')) as { error?: string } | undefined;
    if (result && result.error) {
      ui.addToast('error', `删除失败: ${result.error}`);
      return;
    }
    if (project.cwd) {
      try {
        await window.tiffaDesktop.addRemovedCwd(project.cwd);
      } catch {
        /* ignore */
      }
    }
    ui.addToast('info', `已永久删除: ${project.title || project.dirName}`);
    await loadProjects();
  } catch (err) {
    ui.addToast('error', `删除失败: ${(err as Error).message}`);
  }
}

/** 从树中打开会话（等价旧版 openSessionFromTree：先建 meta 再切换） */
export async function openSessionFromTree(sessionPath: string): Promise<void> {
  if (!sessionPath) return;
  const sessions = useSessionsStore.getState();
  if (!sessions.activeTabMeta[sessionPath]) {
    const dir = dirNameFromSessionPath(sessionPath) || useProjectsStore.getState().activeProjectDirName;
    const list = (dir && useProjectsStore.getState().projectSessions[dir]) || [];
    const sess = list.find((s) => s.path === sessionPath);
    sessions.openTab(sessionPath, {
      dirName: dir || '',
      title: (sess && (sess.title || sess.firstMessage)) || '新对话',
      firstMessage: (sess && sess.firstMessage) || '',
      messageCount: (sess && sess.messageCount) || 0,
      sessionId: (sess && sess.sessionId) || extractSessionId(sessionPath) || undefined,
      lastActiveAt: Date.now(),
    });
  }
  await switchToSession(sessionPath);
}

/** 展开/折叠项目（懒加载会话） */
export async function toggleExpandProject(dirName: string, forceOpen?: boolean): Promise<void> {
  const projects = useProjectsStore.getState();
  const willOpen = forceOpen === true ? true : forceOpen === false ? false : !projects.expandedProjects[dirName];
  if (willOpen) {
    useProjectsStore.getState().toggleExpandedProject(dirName);
    if (!projects.projectSessions[dirName]) {
      await loadSessions(dirName);
    }
  } else {
    useProjectsStore.getState().toggleExpandedProject(dirName);
  }
}

