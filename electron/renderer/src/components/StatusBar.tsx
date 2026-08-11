/**
 * StatusBar — 标题栏右侧状态区（等价旧版 #statusText + 右侧按钮组）
 *
 * 布局：审批模式按钮 → 设置 → 状态文本 → 文件浏览（最右）。
 * 模型标签已移至输入条 ModelPicker（每会话模型记忆逻辑内置于该组件）。
 */
import { useUiStore } from '../stores/useUiStore';
import ApprovalModeButton from './ApprovalModeButton';

export default function StatusBar() {
  const statusText = useUiStore((s) => s.statusText);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <div className="titlebar-right">
      <ApprovalModeButton />
      <span id="statusText" style={{ fontSize: 12, color: 'hsl(var(--text-400))' }}>
        {statusText || '就绪'}
      </span>
      <button
        type="button"
        className="titlebar-btn"
        id="btnFiles"
        title="文件浏览"
        style={{ color: sidebarOpen ? 'hsl(var(--accent-main-000))' : undefined }}
        onClick={toggleSidebar}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
      </button>
    </div>
  );
}
