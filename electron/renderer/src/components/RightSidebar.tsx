/**
 * RightSidebar — 右侧面板（等价旧版 setupSidebar + 双 Tab + 文件抽屉 + resizer）
 *
 * - 概要 Tab：Todo 面板（todoPhases）+ 项目记忆（PROJECT.md，按 h3 分组过滤 + 全局召回）
 * - 文件 Tab：listDir 文件树（列表/网格视图、上一级导航、目录进入）
 * - 抽屉：图片（readImage）/ HTML（iframe）/ Markdown / 代码（hljs 高亮）
 * - resizer：拖拽调宽（200 ~ 60vw）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUiStore } from '../stores/useUiStore';
import { useProjectsStore } from '../stores/useProjectsStore';
import { escapeHtml, sanitizeHtml } from '../services/utils';

// ── 常量（等价旧版）──

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
const LANG_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.ts': 'typescript',
  '.py': 'python',
  '.css': 'css',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.bat': 'bash',
  '.sh': 'bash',
  '.xml': 'xml',
  '.sql': 'sql',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
};
const FILE_ICONS: Record<string, string> = {
  '.js': '{}',
  '.ts': '{}',
  '.py': '~',
  '.md': '#',
  '.json': '{}',
  '.yml': '-',
  '.yaml': '-',
  '.html': '<>',
  '.css': '#',
  '.bat': '>',
  '.txt': '~',
  '.log': '~',
  '.csv': '=',
  '.png': 'I',
  '.jpg': 'I',
  '.jpeg': 'I',
  '.gif': 'I',
  '.webp': 'I',
  '.pdf': 'P',
  '.docx': 'W',
  '.xlsx': 'X',
  '.pptx': 'S',
};

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  ext?: string;
  size?: number;
}

const thumbCache = new Map<string, string>();

function isImageFile(ext?: string): boolean {
  return !!ext && IMAGE_EXTS.includes(ext.toLowerCase());
}

function getFileIcon(ext?: string): string {
  return FILE_ICONS[(ext || '').toLowerCase()] || 'F';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Todo 面板 ──

function TodoPanel() {
  const todoPhases = useUiStore((s) => s.todoPhases);
  const total = todoPhases.reduce<number>((sum, p) => sum + (((p as { tasks?: unknown[] }).tasks)?.length || 0), 0);

  if (todoPhases.length === 0) {
    return (
      <>
        <div className="overview-section-title">
          Todo <span className="todo-count" />
        </div>
        <div className="todo-list">
          <div className="todo-empty">暂无待办</div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="overview-section-title">
        Todo <span className="todo-count">{total > 0 ? `${total} 项` : ''}</span>
      </div>
      <div className="todo-list">
        {todoPhases.map((phase, i) => {
          const name = (phase as { name?: string }).name || '未命名阶段';
          const tasks = ((phase as { tasks?: Array<{ status?: string; content?: string }> }).tasks || []);
          return (
            <div className="todo-phase" key={`${name}-${i}`}>
              <div className="todo-phase-title">{name}</div>
              {tasks.length === 0 ? (
                <div className="todo-item todo-empty-phase">(空)</div>
              ) : (
                tasks.map((task, j) => {
                  const status = task.status || '';
                  let icon = '○';
                  let cls = 'todo-pending';
                  if (status === 'completed' || status === 'done') {
                    icon = '✓';
                    cls = 'todo-done';
                  } else if (status === 'in_progress' || status === 'active') {
                    icon = '◎';
                    cls = 'todo-active';
                  } else if (status === 'blocked' || status === 'failed' || status === 'abandoned') {
                    icon = '✗';
                    cls = 'todo-blocked';
                  }
                  return (
                    <div className="todo-item" key={j}>
                      <span className={cls}>{icon}</span>
                      <span className="todo-text">{task.content}</span>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── 记忆面板（PROJECT.md + 搜索过滤 + 全局召回）──

function MemoryPanel() {
  const workspacePath = useProjectsStore((s) => s.workspacePath);
  const recallMode = useUiStore((s) => s.recallMode);
  const setRecallMode = useUiStore((s) => s.setRecallMode);
  const [content, setContent] = useState<string>('');
  const [rawMd, setRawMd] = useState('');
  const [query, setQuery] = useState('');
  const [recallResults, setRecallResults] = useState<Array<{ content: string; timestamp?: string; bank?: string; source?: string }> | null>(null);
  const [searching, setSearching] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadMemory = useCallback(async () => {
    setQuery('');
    setRecallResults(null);
    setRecallMode(false);
    try {
      if (workspacePath) {
        const proj = (await window.tiffaDesktop.readFile(`${workspacePath}\\PROJECT.md`)) as { content?: string } | undefined;
        if (proj && proj.content) {
          setRawMd(proj.content);
          setContent(proj.content);
          return;
        }
      }
      setRawMd('');
      setContent('');
    } catch {
      setRawMd('');
      setContent('');
    }
  }, [workspacePath, setRecallMode]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  // 刷新按钮：重新加载项目记忆
  useEffect(() => {
    const onRefresh = () => void loadMemory();
    window.addEventListener('tiffa-refresh-files', onRefresh);
    return () => window.removeEventListener('tiffa-refresh-files', onRefresh);
  }, [loadMemory]);

  // 渲染后按 h3 分组（等价旧版 wrapMemorySections）
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !rawMd) return;
    const children = Array.from(container.children);
    let currentSection: HTMLDivElement | null = null;
    for (const el of children) {
      if (el.tagName === 'H3') {
        currentSection = document.createElement('div');
        currentSection.className = 'memory-section';
        currentSection.dataset.section = el.textContent?.trim() || '';
        container.insertBefore(currentSection, el);
        currentSection.appendChild(el);
      } else if (el.tagName === 'H2') {
        currentSection = null;
      } else if (currentSection) {
        currentSection.appendChild(el);
      }
    }
  }, [rawMd]);

  // 搜索过滤
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const sections = container.querySelectorAll('.memory-section');
    const q = query.trim().toLowerCase();
    sections.forEach((s) => {
      const sec = s as HTMLElement;
      sec.style.display =
        !q ||
        (sec.dataset.section || '').toLowerCase().includes(q) ||
        sec.textContent?.toLowerCase().includes(q)
          ? ''
          : 'none';
    });
  }, [query]);

  const performRecall = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const result = (await window.tiffaDesktop.recallMemory(q)) as {
        error?: string;
        results?: Array<{ content: string; timestamp?: string; bank?: string; source?: string }>;
      };
      if (result.error) {
        setRecallResults([]);
        setSearching(false);
        return;
      }
      setRecallResults(result.results || []);
    } catch {
      setRecallResults([]);
    }
    setSearching(false);
  };

  return (
    <div className="overview-memory-section">
      <div className="overview-section-title">
        <span>项目记忆</span>
        <input
          ref={searchRef}
          type="text"
          className="memory-search"
          placeholder={recallMode ? '输入关键词，回车搜索全局记忆…' : '搜索记忆…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!recallMode) setRecallResults(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && recallMode) {
              e.preventDefault();
              void performRecall();
            }
            if (e.key === 'Escape' && recallMode) {
              void loadMemory();
            }
          }}
        />
        <button
          type="button"
          className={`memory-recall-btn${recallMode ? ' active' : ''}`}
          title="全局记忆召回"
          onClick={() => {
            if (recallMode) {
              void loadMemory();
            } else {
              setRecallMode(true);
              setQuery('');
              setRecallResults(null);
              requestAnimationFrame(() => searchRef.current?.focus());
            }
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>
      {recallMode ? (
        searching ? (
          <div className="memory-content">
            <div className="memory-recall-loading">搜索中…</div>
          </div>
        ) : recallResults ? (
          <div className="memory-content">
            {recallResults.length === 0 ? (
              <div className="memory-recall-empty">未找到与「{escapeHtml(query)}」相关的记忆</div>
            ) : (
              <>
                <div className="memory-recall-back" onClick={() => void loadMemory()}>
                  ← 返回项目记忆
                </div>
                <div className="memory-recall-results">
                  {recallResults.map((item, i) => {
                    const time = item.timestamp
                      ? new Date(item.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '';
                    return (
                      <div className="memory-recall-item" key={i} title={item.content}>
                        <div className="memory-recall-item-content">{item.content}</div>
                        <div className="memory-recall-item-meta">
                          {item.bank && <span className="memory-recall-item-bank">{item.bank}</span>}
                          {item.source && <span>{item.source}</span>}
                          {time && <span>{time}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="memory-content">
            <div className="memory-recall-empty">输入关键词后按回车，搜索所有项目的记忆</div>
          </div>
        )
      ) : (
        <div ref={contentRef} className="memory-content markdown-body">
          {rawMd ? <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(window.tiffaDesktop.marked(rawMd)) }} /> : '暂无 PROJECT.md'}
        </div>
      )}
    </div>
  );
}

// ── 文件树 + 抽屉 ──

interface DrawerState {
  name: string;
  ext?: string;
  kind: 'loading' | 'image' | 'html' | 'md' | 'code';
  src?: string;
  codeHtml?: string;
}

function FilePanel() {
  const workspacePath = useProjectsStore((s) => s.workspacePath);
  const fileViewMode = useUiStore((s) => s.fileViewMode);
  const setFileViewMode = useUiStore((s) => s.setFileViewMode);
  const [root, setRoot] = useState<string>('');
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    if (menuRef.current) {
      menuRef.current.remove();
      menuRef.current = null;
    }
  }, []);

  const showFileMenu = useCallback(
    (e: React.MouseEvent, entry: DirEntry) => {
      e.preventDefault();
      closeMenu();
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.innerHTML = [
        `<div class="context-menu-item" data-action="open-windows">`,
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="4 17 10 11 4 7"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
        `在 Windows 中打开`,
        `</div>`,
        `<div class="context-menu-divider"></div>`,
        `<div class="context-menu-item" data-action="show-in-folder">`,
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
        `在文件夹中显示`,
        `</div>`,
      ].join('');
      document.body.appendChild(menu);
      menuRef.current = menu;

      let x = e.clientX;
      let y = e.clientY;
      const mw = 200, mh = 90;
      if (x + mw > window.innerWidth) x = window.innerWidth - mw - 4;
      if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;

      menu.addEventListener('click', (ev) => {
        const item = (ev.target as HTMLElement).closest('.context-menu-item') as HTMLElement | null;
        if (!item) return;
        const action = item.dataset.action;
        closeMenu();
        if (action === 'open-windows') void window.tiffaDesktop.openPath(entry.path);
        else if (action === 'show-in-folder') void window.tiffaDesktop.showItemInFolder(entry.path);
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

  const loadTree = useCallback(
    async (dirPath?: string) => {
      const target = dirPath || root || workspacePath;
      if (!target) return;
      setRoot(target);
      setError('');
      setEntries(null);
      try {
        const res = (await window.tiffaDesktop.listDir(target)) as { error?: string } | DirEntry[];
        if (!Array.isArray(res)) {
          setError((res as { error?: string }).error || '加载失败');
          return;
        }
        setEntries(res as DirEntry[]);
      } catch {
        setError('加载失败');
      }
    },
    [root, workspacePath],
  );

  useEffect(() => {
    if (workspacePath && !root) void loadTree(workspacePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // 刷新按钮：重新加载当前目录
  useEffect(() => {
    const onRefresh = () => void loadTree();
    window.addEventListener('tiffa-refresh-files', onRefresh);
    return () => window.removeEventListener('tiffa-refresh-files', onRefresh);
  }, [loadTree]);

  const openPreview = async (entry: DirEntry) => {
    setDrawer({ name: entry.name, ext: entry.ext, kind: 'loading' });
    if (isImageFile(entry.ext)) {
      try {
        const result = (await window.tiffaDesktop.readImage(entry.path)) as { error?: string; mimeType?: string; base64?: string };
        if (result.error) {
          setDrawer({ name: entry.name, kind: 'code', codeHtml: `<div class="preview-empty">${escapeHtml(result.error)}</div>` });
          return;
        }
        setDrawer({ name: entry.name, kind: 'image', src: `data:${result.mimeType};base64,${result.base64}` });
      } catch {
        setDrawer({ name: entry.name, kind: 'code', codeHtml: '<div class="preview-empty">加载失败</div>' });
      }
      return;
    }
    try {
      const result = (await window.tiffaDesktop.readFile(entry.path)) as { error?: string; content?: string; ext?: string } | undefined;
      if (!result || result.error) {
        setDrawer({ name: entry.name, kind: 'code', codeHtml: `<div class="preview-empty">${escapeHtml(result?.error || '加载失败')}</div>` });
        return;
      }
      const ext = result.ext || entry.ext || '';
      const content = result.content || '';
      if (ext === '.html' || ext === '.htm') {
        setDrawer({ name: entry.name, kind: 'html', src: content });
      } else if (ext === '.md' || ext === '.markdown') {
        setDrawer({ name: entry.name, kind: 'md', src: content });
      } else {
        const lang = LANG_MAP[ext.toLowerCase()] || '';
        let highlighted = '';
        try {
          highlighted =
            lang && window.tiffaDesktop.hljs.getLanguage(lang)
              ? window.tiffaDesktop.hljs.highlight(content, { language: lang }).value
              : window.tiffaDesktop.hljs.highlightAuto(content).value;
        } catch {
          highlighted = escapeHtml(content);
        }
        setDrawer({ name: entry.name, kind: 'code', codeHtml: `<pre class="code-preview"><code class="hljs">${highlighted}</code></pre>` });
      }
    } catch {
      setDrawer({ name: entry.name, kind: 'code', codeHtml: '<div class="preview-empty">加载失败</div>' });
    }
  };

  const goUp = () => {
    const wsRoot = workspacePath;
    if (!wsRoot || root === wsRoot || !root.startsWith(wsRoot)) return;
    const parent = root.replace(/[\\/][^\\/]+$/, '') || wsRoot;
    const safeParent = parent.length >= wsRoot.length ? parent : wsRoot;
    void loadTree(safeParent);
  };

  const renderThumb = async (entry: DirEntry, el: HTMLElement | null) => {
    if (!el) return;
    if (thumbCache.has(entry.path)) {
      el.innerHTML = `<img src="${thumbCache.get(entry.path)}" alt="">`;
      return;
    }
    try {
      const result = (await window.tiffaDesktop.readImage(entry.path)) as { error?: string; mimeType?: string; base64?: string };
      if (result.error) {
        el.innerHTML = '<span class="file-grid-thumb-err">!</span>';
        return;
      }
      const src = `data:${result.mimeType};base64,${result.base64}`;
      if (thumbCache.size > 100) {
        const firstKey = thumbCache.keys().next().value;
        if (firstKey) thumbCache.delete(firstKey);
      }
      thumbCache.set(entry.path, src);
      el.innerHTML = `<img src="${src}" alt="">`;
    } catch {
      el.innerHTML = '<span class="file-grid-thumb-err">!</span>';
    }
  };

  if (!workspacePath) return <div id="fileTree" className="file-tree" />;

  const wsRoot = workspacePath;
  const showUp = root !== wsRoot && root.startsWith(wsRoot);

  return (
    <>
      <div id="fileTree" className={`file-tree${fileViewMode === 'grid' ? ' grid-view' : ''}`}>
        {showUp && (
          <div className="file-tree-item file-tree-up" onClick={goUp}>
            <span className="file-tree-icon">←</span>
            <span className="ft-name">..</span>
          </div>
        )}
        {error && <div className="file-tree-item" style={{ color: 'var(--danger)' }}>{error}</div>}
        {entries === null && !error && <div className="file-tree-item">加载中…</div>}
        {entries?.map((entry) => {
          if (fileViewMode === 'grid') {
            const img = isImageFile(entry.ext);
            return (
              <div
                key={entry.path}
                className={`file-grid-item${img ? ' image' : ''}`}
                onClick={() => void openPreview(entry)}
                onContextMenu={(e) => showFileMenu(e, entry)}
              >
                {img ? (
                  <div
                    className="file-grid-thumb"
                    ref={(el) => {
                      if (el) void renderThumb(entry, el);
                    }}
                  >
                    <div className="file-grid-thumb-loading">…</div>
                  </div>
                ) : (
                  <div className="file-grid-thumb file-grid-thumb-icon">
                    <span>{getFileIcon(entry.ext)}</span>
                  </div>
                )}
                <div className="file-grid-info">
                  <span className="file-grid-name" title={entry.name}>
                    {entry.name}
                  </span>
                  {!!entry.size && entry.size > 0 && <span className="file-grid-size">{formatFileSize(entry.size)}</span>}
                </div>
              </div>
            );
          }
          return (
            <div
              key={entry.path}
              className={`file-tree-item${entry.isDirectory ? ' directory' : ''}`}
              onClick={() => {
                if (entry.isDirectory) void loadTree(entry.path);
                else void openPreview(entry);
              }}
              onContextMenu={(e) => showFileMenu(e, entry)}
            >
              <span className="file-tree-icon">{entry.isDirectory ? 'D' : getFileIcon(entry.ext)}</span>
              <span className="ft-name">{entry.name}</span>
              {!entry.isDirectory && !!entry.size && entry.size > 0 && (
                <span className="file-tree-size">{formatFileSize(entry.size)}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── 抽屉预览 ── */}
      <div className="drawer-gap" id="drawerGap" style={drawer ? { display: 'block' } : undefined} onClick={() => setDrawer(null)} />
      <div className={`file-drawer${drawer ? ' open' : ''}`} id="fileDrawer">
        <div className="drawer-header">
          <span className="drawer-title" id="drawerTitle">
            {drawer?.name || ''}
          </span>
          <button type="button" className="sidebar-btn" id="btnCloseDrawer" title="关闭预览" onClick={() => setDrawer(null)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div
          className="drawer-body"
          id="drawerBody"
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t === e.currentTarget || t.classList.contains('image-preview-full') || t.classList.contains('preview-empty')) {
              setDrawer(null);
            }
          }}
        >
          {drawer?.kind === 'loading' && <div className="preview-empty">加载中…</div>}
          {drawer?.kind === 'image' && drawer.src && (
            <div className="image-preview-full">
              <img src={drawer.src} alt={drawer.name} />
            </div>
          )}
          {drawer?.kind === 'html' && drawer.src && (
            <iframe srcDoc={drawer.src} sandbox="allow-scripts allow-same-origin" title={drawer.name} />
          )}
          {drawer?.kind === 'md' && drawer.src && (
            <iframe srcDoc={simpleMarkdownRender(drawer.src)} sandbox="allow-scripts allow-same-origin" title={drawer.name} />
          )}
          {drawer?.kind === 'code' && drawer.codeHtml && <div dangerouslySetInnerHTML={{ __html: drawer.codeHtml }} />}
        </div>
      </div>
    </>
  );
}

/** 简易 Markdown → HTML（等价旧版 simpleMarkdownRender） */
function simpleMarkdownRender(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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

// ── 主组件 ──

export default function RightSidebar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setFileViewMode = useUiStore((s) => s.setFileViewMode);
  const fileViewMode = useUiStore((s) => s.fileViewMode);
  const [activeTab, setActiveTab] = useState<'overview' | 'files'>('overview');
  const sidebarRef = useRef<HTMLElement>(null);

  const switchTab = (tab: 'overview' | 'files') => {
    setActiveTab(tab);
  };

  // ── resizer（等价旧版 setupSidebarResize）──

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const handle = document.getElementById('sidebarResizeHandle') as HTMLElement | null;
    if (!sidebar || !handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const onMouseDown = (e: MouseEvent) => {
      if (sidebar.classList.contains('collapsed')) return;
      dragging = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const newWidth = Math.max(200, Math.min(window.innerWidth * 0.6, startWidth + (startX - e.clientX)));
      sidebar.style.width = `${newWidth}px`;
    };
    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <>
      <div className="sidebar-resize-handle" id="sidebarResizeHandle" />
      <aside ref={sidebarRef} id="sidebar" className={sidebarOpen ? '' : 'collapsed'}>
        <div className="sidebar-inner">
          <div className="sidebar-tab-bar">
            <button
              type="button"
              className={`sidebar-tab${activeTab === 'overview' ? ' active' : ''}`}
              data-tab="overview"
              onClick={() => switchTab('overview')}
            >
              概要
            </button>
            <button
              type="button"
              className={`sidebar-tab${activeTab === 'files' ? ' active' : ''}`}
              data-tab="files"
              onClick={() => switchTab('files')}
            >
              文件
            </button>
            <div className="sidebar-tab-actions">
              <button
                type="button"
                className={`sidebar-btn view-toggle${fileViewMode !== 'grid' ? ' active' : ''}`}
                id="btnViewList"
                title="列表视图"
                onClick={() => setFileViewMode('list')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </button>
              <button
                type="button"
                className={`sidebar-btn view-toggle${fileViewMode === 'grid' ? ' active' : ''}`}
                id="btnViewGrid"
                title="缩略图视图"
                onClick={() => setFileViewMode('grid')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </button>
              <button
                type="button"
                className="sidebar-btn"
                id="btnRefreshFiles"
                title="刷新"
                onClick={() => window.dispatchEvent(new CustomEvent('tiffa-refresh-files'))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
              <button type="button" className="sidebar-btn" id="btnCloseSidebar" title="关闭面板" onClick={toggleSidebar}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div className="sidebar-panel" id="panelOverview" style={activeTab === 'overview' ? undefined : { display: 'none' }}>
            <div className="overview-todo-section">
              <TodoPanel />
            </div>
            <MemoryPanel />
          </div>
          <div className="sidebar-panel" id="panelFiles" style={activeTab === 'files' ? undefined : { display: 'none' }}>
            <FilePanel />
          </div>
        </div>
      </aside>
    </>
  );
}
