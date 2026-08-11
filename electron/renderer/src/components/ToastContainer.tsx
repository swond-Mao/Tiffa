/**
 * ToastContainer — 全局浮动通知渲染层（等价旧版 showToast + #toastContainer）
 *
 * 订阅 useUiStore.toasts 数组渲染。修复：此前 toasts 只被 addToast/removeToast
 * 写入/删除，没有任何组件订阅渲染，导致所有 addToast 提示（压缩完成/链路、
 * 模型错误、设置保存等）在 UI 上完全不显示。这里补上唯一渲染挂载点，
 * 挂到 App.tsx 根部（与 html 中 #toastContainer 的 fixed 定位脱耦，由 React 渲染）。
 */
import { useUiStore } from '../stores/useUiStore';

const MISSING_ICON = (
  <circle cx="12" cy="12" r="10" />
);

const TOAST_ICONS: Record<string, JSX.Element> = {
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  success: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  warning: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </>
  ),
};

const LEVEL_COLOR: Record<string, string> = {
  info: '217 91% 60%',
  success: '142 71% 45%',
  warning: '38 92% 50%',
  error: '0 84% 60%',
};

export default function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);
  if (!toasts || toasts.length === 0) return null;
  return (
    <div id="toastContainer" className="toast-container-react">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`} data-id={t.id}>
          <span
            className="toast-icon"
            style={{ color: LEVEL_COLOR[t.level] ? `hsl(${LEVEL_COLOR[t.level]})` : undefined }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {TOAST_ICONS[t.level] || MISSING_ICON}
            </svg>
          </span>
          <div className="toast-body">{t.message}</div>
          <button type="button" className="toast-close" onClick={() => removeToast(t.id)}>
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
