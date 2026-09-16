/**
 * PreviewPanel — 侧边栏常驻实时预览区
 *
 * 解决的具体问题：AI 在开发中产出的 HTML/截图，用户此前只能等它自己截图、
 * 自己看，推不到用户眼前。这里让「AI 改了什么」直接常驻上屏，并在文件变动时自动刷新。
 *
 * 位置：插在 #mainArea 与 .sidebar-resize-handle 之间，成为独立一栏
 * （不与 RightSidebar 抢空间 —— 概要/文件面板已有各自职责，预览是第三种信息）。
 *
 * ⚠️ iframe sandbox 只给 allow-scripts，**不给 allow-same-origin**：
 * 预览内容是 AI 产出的不可信 HTML。allow-same-origin 会让 iframe 与宿主同源，
 * 届时 sandbox 形同虚设（可拿 window.tiffaDesktop 走 IPC 读写本地文件）。
 * 既有 .file-drawer 正是这么写的（见 RightSidebar.tsx），属同类隐患。
 * 本面板走回环 http origin（preview-server），与 file:// 宿主天然跨源，
 * 因此去掉 allow-same-origin 后内联脚本仍能正常跑，只是拿不到宿主能力。
 *
 * 地址来源：条目里的 active.url 由主进程 registerPreview 下发（含真实端口）。
 * 面板不再自己拼 `/p/<id>` —— 端口被占时服务端会自增，猜一次就 404。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreviewStore, type PreviewItem } from '../stores/usePreviewStore';
import {
  openPreviewExternally,
  previewFrameSrc,
  previewRelease,
  subscribePreviewChanged,
} from '../services/previewBridge';

function relTime(ts: number): string {
  const d = Math.max(0, Date.now() - ts);
  if (d < 5_000) return '刚刚';
  if (d < 60_000) return `${Math.floor(d / 1000)} 秒前`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  return `${Math.floor(d / 3_600_000)} 小时前`;
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|bmp|ico)$/i;
const SVG_RE = /\.svg$/i;

export default function PreviewPanel() {
  const items = usePreviewStore((s) => s.items);
  const activeId = usePreviewStore((s) => s.activeId);
  const visible = usePreviewStore((s) => s.visible);
  const width = usePreviewStore((s) => s.width);
  const setActive = usePreviewStore((s) => s.setActive);
  const setVisible = usePreviewStore((s) => s.setVisible);
  const setWidth = usePreviewStore((s) => s.setWidth);
  const remove = usePreviewStore((s) => s.remove);
  const clear = usePreviewStore((s) => s.clear);

  /** iframe 强制重挂载计数：?v= 已能击穿缓存，手动「重载」按钮额外处理同 URL 情形 */
  const [reloadNonce, setReloadNonce] = useState(0);
  /** 加载态：换 src 时置起，避免停留在上一页面上误以为已更新 */
  const [loading, setLoading] = useState(false);
  /** 载入失败提示：回环服务挂了/文件被删时给一句话，不留白框 */
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  const active: PreviewItem | null = useMemo(
    () => items.find((x) => x.id === activeId) ?? items[items.length - 1] ?? null,
    [items, activeId],
  );

  // 订阅文件变更（热更新）：主进程 fs.watch → preview:changed → 换 ?v= 重载
  useEffect(() => subscribePreviewChanged((c) => {
    usePreviewStore.getState().bumpRev(c.id, c.rev);
  }), []);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
  }, [active?.id, active?.rev, reloadNonce]);

  // ── 拖拽改宽（与 #sidebarResizeHandle 同构） ──
  useEffect(() => {
    const panel = panelRef.current;
    const handle = document.getElementById('previewResizeHandle');
    if (!panel || !handle || !visible) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const onDown = (e: MouseEvent) => {
      dragging = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      setWidth(startWidth + (startX - e.clientX));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    handle.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      handle.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [visible, setWidth]);

  const closeItem = useCallback((id: string) => {
    const gone = remove(id);
    // 撤主进程监听，否则条目消失后 watcher 泄漏（上限 12 条会慢慢攒出一堆目录监听）
    if (gone) previewRelease(gone);
  }, [remove]);

  const clearAll = useCallback(() => {
    for (const id of clear()) previewRelease(id);
  }, [clear]);

  const onOpenExternal = useCallback(() => {
    if (active) openPreviewExternally(previewFrameSrc(active.url, active.rev));
  }, [active]);

  // 没有任何条目时不占版面（常驻 ≠ 常显：空栏会把聊天区挤窄）
  if (!visible || items.length === 0) return null;

  const src = active ? previewFrameSrc(active.url, active.rev) : '';
  // SVG 走 <img> 而非 iframe：它没有 document 生命周期，塞进 iframe 会白屏一片
  const asImage = !!active && (IMAGE_RE.test(active.file) || SVG_RE.test(active.file));

  return (
    <>
      <div className="preview-resize-handle" id="previewResizeHandle" />
      <aside ref={panelRef} id="previewPanel" style={{ width: `${width}px` }}>
        <header className="preview-head">
          <span className="preview-title">实时预览</span>
          <span className="preview-meta">{active ? relTime(active.ts) : ''}</span>
          <div className="preview-actions">
            <button
              type="button"
              className="preview-btn"
              title="重新载入当前预览"
              disabled={!src}
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              ⟳
            </button>
            <button
              type="button"
              className="preview-btn"
              title="在本机浏览器打开"
              disabled={!src}
              onClick={onOpenExternal}
            >
              ⧉
            </button>
            <button type="button" className="preview-btn" title="关闭全部预览" onClick={clearAll}>
              ✕
            </button>
          </div>
        </header>

        {items.length > 1 && (
          <div className="preview-tabs" role="tablist">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role="tab"
                aria-selected={it.id === active?.id}
                className={`preview-tab${it.id === active?.id ? ' active' : ''}`}
                title={it.file}
                onClick={() => setActive(it.id)}
              >
                <span className="preview-tab-name">{it.title}</span>
                {it.rev > 1 && <span className="preview-tab-rev">v{it.rev}</span>}
                <span
                  className="preview-tab-close"
                  role="button"
                  aria-label="关闭此预览"
                  onClick={(e) => { e.stopPropagation(); closeItem(it.id); }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="preview-body">
          {!active && <div className="preview-empty">没有选中的预览条目。</div>}
          {active && loading && <div className="preview-loading">载入中…</div>}
          {active && failed && (
            <div className="preview-empty">
              预览载入失败。
              <br />
              文件可能已被删除或移动，或预览服务已停止；让 AI 重新推送一次试试。
            </div>
          )}
          {active && (
            asImage ? (
              <img
                key={`${active.id}:${active.rev}:${reloadNonce}`}
                className="preview-image"
                src={src}
                alt={active.title}
                onLoad={() => setLoading(false)}
                onError={() => { setLoading(false); setFailed(true); }}
              />
            ) : (
              <iframe
                key={`${active.id}:${active.rev}:${reloadNonce}`}
                className="preview-frame"
                title={active.title}
                src={src}
                // 不给 allow-same-origin：见文件顶部说明
                sandbox="allow-scripts allow-popups allow-forms"
                onLoad={() => setLoading(false)}
                onError={() => { setLoading(false); setFailed(true); }}
              />
            )
          )}
        </div>

        <footer className="preview-foot">
          <span className="preview-file" title={active?.file}>{active?.file ?? ''}</span>
          <button
            type="button"
            className="preview-collapse"
            title="收起预览区（下次 AI 推送会重新展开）"
            onClick={() => setVisible(false)}
          >
            收起
          </button>
        </footer>
      </aside>
    </>
  );
}
