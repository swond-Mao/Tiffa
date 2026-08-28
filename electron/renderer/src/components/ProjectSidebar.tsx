/**
 * ProjectSidebar — 左侧项目面板（等价旧版 renderProjects + 会话树 + 归档区 + resizer）
 *
 * - 项目列表：active 高亮 / 展开箭头（懒加载会话树）/ 首字母图标 / 会话数徽标
 * - 会话树：活跃 tab 置顶、≤8 条折叠 + 展开入口、active/open/pending-ask 态、
 *   相对时间、点击打开、右键复用 tab 菜单
 * - 归档区：折叠头部 + 归档项目列表（右键恢复/永久删除）
 * - 右键菜单：打开文件管理器 / 归档 / 删除（项目）
 * - resizer：拖拽调宽（localStorage 持久化，160~420px）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectsStore } from '../stores/useProjectsStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useProcStore } from '../stores/useProcStore';
import { useUiStore, hasPendingAsk } from '../stores/useUiStore';
import { selectProject, loadProjects } from '../services/sessionController';
import {
  openNewProjectFolder,
  archiveProject,
  deleteProject,
  restoreArchivedProject,
  hardDeleteArchivedProject,
  openSessionFromTree,
  toggleExpandProject,
  loadArchivedSessions,
  restoreArchivedSession,
  hardDeleteArchivedSession,
} from '../services/projectActions';
import { relTime, extractSessionId, escapeHtml } from '../services/utils';
import { useTabContextMenu } from '../hooks/useTabContextMenu';
import ThemeToggleButton from './ThemeToggleButton';
import ThemeCycleButton from './ThemeCycleButton';
import type { TiffaProjectSummary, TiffaSessionSummary } from '../types/tiffaDesktop';
import { SESSION_TREE_LIMIT } from '../stores/useSessionsStore';

const PANEL_MIN_WIDTH = 160;
const PANEL_MAX_WIDTH = 420;
const PANEL_WIDTH_KEY = 'tiffa:projectPanelWidth';
const INTERACTION_WINDOW_MS = 30 * 60 * 1000; // 对话真实交互后圆点保持点亮时长

/** 右键菜单 item 构建（等价旧版 context-menu HTML） */
function menuItem(action: string, label: string, svg: string, danger = false): string {
  return `<div class="context-menu-item${danger ? ' danger' : ''}" data-action="${action}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px">${svg}</svg>${label}
  </div>`;
}

const PROJECT_MENU = [
  menuItem(
    'open-explorer',
    '在文件管理器中打开',
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  ),
  '<div class="context-menu-divider"></div>',
  menuItem('archive', '归档项目', '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>'),
  '<div class="context-menu-divider"></div>',
  menuItem(
    'delete',
    '删除项目',
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    true,
  ),
].join('');

const ARCHIVED_MENU = [
  menuItem('restore', '恢复项目', '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
  '<div class="context-menu-divider"></div>',
  menuItem(
    'hard-delete',
    '永久删除',
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    true,
  ),
].join('');

function SessionTree({ dirName }: { dirName: string }) {
  const sessions = useProjectsStore((s) => s.projectSessions[dirName]);
  const activeSessionPath = useSessionsStore((s) => s.activeSessionPath);
  const activeSessionPaths = useSessionsStore((s) => s.activeSessionPaths);
  const expandedSessionTrees = useSessionsStore((s) => s.expandedSessionTrees);
  // 正在运行的会话集合：左侧圆点只对「AI 正在回复/运行中」的对话显示。
  // 空闲对话（即使实例已就绪 .ready）一律不点亮——点开历史对话不亮，只高亮整行。
  // 选中（active）不点亮，避免与运行态指示重复。
  const procStateMap = useProcStore((s) => s.procStateMap);
  const lastInteractionMap = useProcStore((s) => s.lastInteractionMap);
  const uiQueue = useUiStore((s) => s.uiQueue);
  void uiQueue;

  const { showTabMenu } = useTabContextMenu();

  const real = (sessions || []).filter((s) => !s.path.startsWith('__new__'));
  if (real.length === 0) {
    // 无活跃对话也要渲染归档分组（否则"只归档过对话的项目"永远看不到已归档内容）
    return (
      <div className="session-tree" data-dirname={dirName}>
        <ArchivedSessionsGroup dirName={dirName} />
      </div>
    );
  }

  // 活跃（已打开 tab）的会话排前面，避免被折叠隐藏；其余保持原序（稳定排序）
  const sorted = [...real].sort((a, b) => {
    const ao = activeSessionPaths.includes(a.path) ? 0 : 1;
    const bo = activeSessionPaths.includes(b.path) ? 0 : 1;
    return ao - bo;
  });
  const expanded = !!expandedSessionTrees[dirName];
  const overflow = real.length > SESSION_TREE_LIMIT;
  const visible = overflow && !expanded ? sorted.slice(0, SESSION_TREE_LIMIT) : sorted;

  return (
    <div className="session-tree" data-dirname={dirName}>
      {visible.map((session) => {
        const title = session.title || session.firstMessage || '新对话';
        const ts = session.lastActiveAt || (session as TiffaSessionSummary & { modified?: number; mtime?: number }).modified;
        const timeStr = ts ? relTime(ts) : '';
        const isTab = activeSessionPaths.includes(session.path);
        const isRunning = !!procStateMap[session.path]?.agentRunning;
        const lastInter = lastInteractionMap[session.path];
        const isFreshInteraction = isTab && !!lastInter && Date.now() - lastInter < INTERACTION_WINDOW_MS;
        const cls = [
          'session-item',
          isTab && (isRunning || isFreshInteraction) ? 'open' : '',
          session.path === activeSessionPath ? 'active' : '',
          isRunning ? 'running' : '',
          hasPendingAsk(session.sessionId) || hasPendingAsk(extractSessionId(session.path)) ? 'pending-ask' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={session.path}
            className={cls}
            data-path={session.path}
            data-sessionid={session.sessionId || ''}
            title={title}
            onClick={() => void openSessionFromTree(session.path)}
            onContextMenu={(e) =>
              showTabMenu(e, {
                path: session.path,
                dirName,
                title: session.title,
                firstMessage: session.firstMessage,
                messageCount: session.messageCount,
                sessionId: session.sessionId,
              })
            }
          >
            <span className="session-item-dot" />
            <span className="session-item-title">{title.length > 18 ? `${title.substring(0, 18)}...` : title}</span>
            {timeStr && <span className="session-item-meta">{timeStr}</span>}
          </div>
        );
      })}
      {overflow && (
        <div
          className="session-tree-more"
          onClick={() => useSessionsStore.getState().toggleExpandedTree(dirName)}
        >
          {expanded ? '收起对话列表' : `展开剩余 ${real.length - SESSION_TREE_LIMIT} 条对话`}
        </div>
      )}
      <ArchivedSessionsGroup dirName={dirName} />
    </div>
  );
}

/** 项目树内的"已归档对话"折叠分组：懒加载 + 灰显条目 + 右键恢复/永久删除 */
function ArchivedSessionsGroup({ dirName }: { dirName: string }) {
  const archived = useProjectsStore((s) => s.archivedSessions[dirName]);
  const expanded = useProjectsStore((s) => !!s.expandedArchivedTrees[dirName]);

  const toggle = useCallback(() => {
    const store = useProjectsStore.getState();
    const willOpen = !store.expandedArchivedTrees[dirName];
    store.toggleExpandedArchivedTree(dirName);
    if (willOpen && !store.archivedSessions[dirName]) {
      void loadArchivedSessions(dirName);
    }
  }, [dirName]);

  return (
    <>
      <div className="archived-sessions-toggle" onClick={toggle}>
        <span className={`project-item-arrow${expanded ? ' expanded' : ''}`}>{expanded ? '▾' : '▸'}</span>
        <span>已归档对话</span>
        {archived && archived.length > 0 && <span className="archive-count">{archived.length}</span>}
      </div>
      {expanded && (
        <div className="archived-sessions-list">
          {archived === undefined ? (
            <div className="session-tree-empty">加载中...</div>
          ) : archived.length === 0 ? (
            <div className="session-tree-empty">无归档对话</div>
          ) : (
            archived.map((s) => {
              const title = s.title || s.firstMessage || '归档对话';
              const ts = s.lastActiveAt;
              const timeStr = ts ? relTime(ts) : '';
              return (
                <div
                  key={s.path}
                  className="session-item archived-session"
                  title={title}
                  onContextMenu={(e) => showArchivedSessionMenu(e, s, dirName)}
                >
                  <span className="session-item-title">{title.length > 18 ? `${title.substring(0, 18)}...` : title}</span>
                  {timeStr && <span className="session-item-meta">{timeStr}</span>}
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

/** 归档对话右键菜单：恢复 / 永久删除（DOM 方式，复用 .context-menu 样式） */
function showArchivedSessionMenu(e: React.MouseEvent, session: TiffaSessionSummary, dirName: string): void {
  e.preventDefault();
  document.querySelector('.context-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = [
    menuItem(
      'restore',
      '恢复对话',
      '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    ),
    '<div class="context-menu-divider"></div>',
    menuItem(
      'hard-delete',
      '永久删除',
      '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
      true,
    ),
  ].join('');
  document.body.appendChild(menu);
  let x = e.clientX;
  let y = e.clientY;
  if (x + 160 > window.innerWidth) x = window.innerWidth - 164;
  if (y + 120 > window.innerHeight) y = window.innerHeight - 124;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.addEventListener('click', (ev) => {
    const item = (ev.target as HTMLElement).closest('.context-menu-item') as HTMLElement | null;
    if (!item) return;
    const action = item.dataset.action;
    menu.remove();
    if (action === 'restore') void restoreArchivedSession(session.path);
    else if (action === 'hard-delete') void hardDeleteArchivedSession(session.path);
  });
  setTimeout(() => {
    document.addEventListener(
      'click',
      (ev) => {
        if (!menu.contains(ev.target as Node)) menu.remove();
      },
      { once: true },
    );
  }, 0);
}

function ProjectItem({ project, showMenu }: { project: TiffaProjectSummary; showMenu: (e: React.MouseEvent, p: TiffaProjectSummary) => void }) {
  const dirName = project.dirName;
  const activeProjectDirName = useProjectsStore((s) => s.activeProjectDirName);
  const expanded = useProjectsStore((s) => !!s.expandedProjects[dirName]);
  const isActive = dirName === activeProjectDirName;
  const initial = (project.title || '?')[0].toUpperCase();
  const name = project.title || '未知项目';
  const count = project.sessionCount || 0;

  return (
    <>
      <div
        className={`project-item${isActive ? ' active' : ''}`}
        data-dirname={dirName}
        title={project.path || project.title}
        onClick={() => void selectProject(dirName)}
        onContextMenu={(e) => showMenu(e, project)}
      >
        <span
          className={`project-item-arrow${expanded ? ' expanded' : ''}`}
          title={expanded ? '折叠' : '展开'}
          onClick={(e) => {
            // 箭头 = 纯展开/折叠开关；不触发外层的 selectProject（切项目/切会话）
            e.stopPropagation();
            void toggleExpandProject(dirName);
          }}
        >
          {expanded ? '▾' : '▸'}
        </span>
        <span className="project-item-icon">{escapeHtml(initial)}</span>
        <span className="project-item-name">{escapeHtml(name)}</span>
        {count > 0 && <span className="project-item-sessioncount">{count}</span>}
      </div>
      {expanded && <SessionTree dirName={dirName} />}
    </>
  );
}

export default function ProjectSidebar() {
  const projects = useProjectsStore((s) => s.projects);
  const archivedProjects = useProjectsStore((s) => s.archivedProjects);
  const archiveCollapsed = useProjectsStore((s) => s.archiveCollapsed);
  const setArchiveCollapsed = useProjectsStore((s) => s.setArchiveCollapsed);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 挂载时按当前主题模式初始化左下角按钮图标（等价旧版 setupThemeToggle 首行）
  useEffect(() => {
    const win = window as unknown as { resolveMode?: (m: string) => string };
    let mode = 'system';
    try {
      mode = localStorage.getItem('tiffa-theme-mode') || 'system';
    } catch {
      /* ignore */
    }
    const resolved = win.resolveMode ? win.resolveMode(mode) : mode;
    const moon = document.querySelector('.icon-moon') as HTMLElement | null;
    const sun = document.querySelector('.icon-sun') as HTMLElement | null;
    if (moon) moon.style.display = resolved === 'dark' ? '' : 'none';
    if (sun) sun.style.display = resolved === 'light' ? '' : 'none';
    const dark = document.getElementById('hljs-dark') as HTMLLinkElement | null;
    const light = document.getElementById('hljs-light') as HTMLLinkElement | null;
    if (dark) dark.disabled = resolved !== 'dark';
    if (light) light.disabled = resolved !== 'light';
  }, []);

  const closeMenu = useCallback(() => {
    if (menuRef.current) {
      menuRef.current.remove();
      menuRef.current = null;
    }
  }, []);

  /** 通用右键菜单（等价旧版 showProjectContextMenu / showArchivedProjectContextMenu） */
  const showMenu = useCallback(
    (e: React.MouseEvent, project: TiffaProjectSummary, html: string, actions: Record<string, () => void>) => {
      e.preventDefault();
      closeMenu();
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.innerHTML = html;
      document.body.appendChild(menu);
      menuRef.current = menu;

      // 定位（防溢出视口）
      let x = e.clientX;
      let y = e.clientY;
      const menuWidth = 220;
      const menuHeight = 120;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;

      menu.addEventListener('click', (ev) => {
        const item = (ev.target as HTMLElement).closest('.context-menu-item') as HTMLElement | null;
        if (!item) return;
        const action = item.dataset.action;
        closeMenu();
        if (action) actions[action]?.();
      });

      setTimeout(() => {
        document.addEventListener(
          'click',
          (ev) => {
            if (menuRef.current && !menuRef.current.contains(ev.target as Node)) closeMenu();
          },
          { once: true },
        );
      }, 0);
    },
    [closeMenu],
  );

  const showProjectMenu = (e: React.MouseEvent, p: TiffaProjectSummary) =>
    showMenu(e, p, PROJECT_MENU, {
      'open-explorer': () => {
        if (p.path) void window.tiffaDesktop.openPath(p.path);
      },
      archive: () => void archiveProject(p),
      delete: () => void deleteProject(p),
    });

  const showArchivedMenu = (e: React.MouseEvent, p: TiffaProjectSummary) =>
    showMenu(e, p, ARCHIVED_MENU, {
      restore: () => void restoreArchivedProject(p),
      'hard-delete': () => void hardDeleteArchivedProject(p),
    });

  // ── resizer（等价旧版 setupProjectPanelResizer）──

  useEffect(() => {
    const panel = panelRef.current;
    const resizer = document.getElementById('projectPanelResizer') as HTMLElement | null;
    if (!panel || !resizer) return;
    // 恢复持久化宽度
    try {
      const saved = parseInt(localStorage.getItem(PANEL_WIDTH_KEY) || '', 10);
      if (saved && !isNaN(saved)) {
        panel.style.width = `${Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, saved))}px`;
      }
    } catch {
      /* ignore */
    }
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      resizer.classList.add('dragging');
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      const onMove = (ev: MouseEvent) => {
        const w = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, startW + (ev.clientX - startX)));
        panel.style.width = `${w}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        resizer.classList.remove('dragging');
        try {
          localStorage.setItem(PANEL_WIDTH_KEY, String(parseInt(panel.style.width, 10) || PANEL_MIN_WIDTH));
        } catch {
          /* ignore */
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    resizer.addEventListener('mousedown', onMouseDown);
    return () => resizer.removeEventListener('mousedown', onMouseDown);
  }, []);

  return (
    <>
      <aside ref={panelRef} id="projectPanel">
        <div className="project-header">
          <span className="project-logo">Tiffa</span>
          <span className="project-header-text">项目</span>
        </div>
        <div className="project-toolbar">
          <button type="button" className="project-btn" id="btnNewProject" title="打开文件夹" onClick={() => void openNewProjectFolder()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <button type="button" className="project-btn" id="btnRefreshProjects" title="刷新项目列表" onClick={() => void loadProjects()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
        <div id="projectList" className="project-list">
          {projects.length === 0 ? (
            <div className="project-loading" style={{ cursor: 'pointer' }} title="点击选择项目文件夹" onClick={() => void openNewProjectFolder()}>
              暂无项目，点击＋打开文件夹
            </div>
          ) : (
            projects.map((p) => <ProjectItem key={p.dirName} project={p} showMenu={showProjectMenu} />)
          )}

          {/* ── 归档项目区域 ── */}
          {archivedProjects.length > 0 && (
            <>
              <div className="archive-divider" />
              <div
                className="archive-header"
                onClick={() => setArchiveCollapsed(!archiveCollapsed)}
              >
                <svg className={`archive-toggle-icon${archiveCollapsed ? '' : ' open'}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span>归档</span>
                <span className="archive-count">{archivedProjects.length}</span>
              </div>
              {!archiveCollapsed && (
                <div className="archive-list">
                  {archivedProjects.map((p) => {
                    const initial = (p.title || '?')[0].toUpperCase();
                    return (
                      <div
                        key={p.dirName}
                        className="project-item archived"
                        title={p.path || p.title}
                        onContextMenu={(e) => showArchivedMenu(e, p)}
                      >
                        <span className="project-item-icon">{escapeHtml(initial)}</span>
                        <span className="project-item-name">{escapeHtml(p.title || '未知项目')}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
        <div className="project-footer">
          <button
            type="button"
            className="project-btn footer-btn"
            id="btnSettings"
            title="设置"
            onClick={() => useUiStore.getState().toggleSettings()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <ThemeCycleButton />
          <ThemeToggleButton />
          <XmlTranslationButton />
        </div>
      </aside>
      <div id="projectPanelResizer" className="panel-resizer" />
    </>
  );
}

/**
 * XmlTranslationButton — XML 翻译开关（等价旧版 setupXmlTranslation）。
 * 挂载时经 IPC 读取开关文件恢复状态；点击切换并写回开关文件。
 */
function XmlTranslationButton() {
  const enabled = useUiStore((s) => s.xmlTranslationEnabled);
  const setEnabled = useUiStore((s) => s.setXmlTranslationEnabled);

  // 挂载时从开关文件恢复状态
  useEffect(() => {
    void (async () => {
      try {
        const r = await window.tiffaDesktop.getXmlTranslationStatus();
        if (r && typeof r.enabled === 'boolean') setEnabled(r.enabled);
      } catch {
        /* ignore */
      }
    })();
  }, [setEnabled]);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await window.tiffaDesktop.toggleXmlTranslation(next);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      className={`project-btn footer-btn${enabled ? ' active' : ''}`}
      id="btnXmlTranslation"
      title={enabled ? 'XML 翻译：开（点击关闭）' : 'XML 翻译：关（点击开启）'}
      onClick={() => void toggle()}
      style={enabled ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' } : undefined}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 8 6 6" />
        <path d="m4 14 6-6 2-3" />
        <path d="M2 5h12" />
        <path d="M7 2h1" />
        <path d="m22 22-5-10-5 10" />
        <path d="M14 18h6" />
      </svg>
    </button>
  );
}

