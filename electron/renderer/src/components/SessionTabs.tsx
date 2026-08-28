/**
 * SessionTabs — 顶栏会话标签（等价旧版 renderSessionTabs）
 *
 * - 渲染 activeTabMeta（跨项目全局 tab，≤8）
 * - 每 tab 状态：active / running（agentRunning）/ preparing（准备中徽标）/
 *   pending-ask（待回复徽标，基于全局 ask 队列）
 * - 点击切换（switchToSession）；关闭走 closeTab 完整流程
 *   （__new__ 兜底迁移、preparing 锁释放、活跃关闭后切回剩余最后一个）
 * - 右键菜单复用 useTabContextMenu
 */
import { useSessionsStore, type TabMeta } from '../stores/useSessionsStore';
import { useProcStore } from '../stores/useProcStore';
import { useUiStore, hasPendingAsk } from '../stores/useUiStore';
import { switchToSession, newSession } from '../services/sessionController';
import { closeTab, type TabSession } from '../services/tabActions';
import { useTabContextMenu } from '../hooks/useTabContextMenu';
import { extractSessionId } from '../services/utils';

/** tab 标题截断长度（等价旧版 renderSessionTabs） */
const TITLE_MAX = 12;
const INTERACTION_WINDOW_MS = 30 * 60 * 1000; // 对话真实交互后 tab 指示条保持点亮时长

export default function SessionTabs() {
  const activeTabMeta = useSessionsStore((s) => s.activeTabMeta);
  // uiQueue 变化驱动 pending-ask 徽标重渲染（父组件订阅一次，传给各 tab）
  const uiQueue = useUiStore((s) => s.uiQueue);
  void uiQueue;

  const { showTabMenu } = useTabContextMenu();

  const tabs = Object.entries(activeTabMeta).map(([path, meta]) => ({ path, meta }));

  if (tabs.length === 0) {
    return (
      <>
        <div className="session-tabs" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <div className="session-tab" style={{ color: 'var(--text-muted)', fontStyle: 'italic', cursor: 'default' }}>
            暂无对话
          </div>
        </div>
        <button
          type="button"
          className="session-tab-new"
          id="btnNewSession"
          title="新建对话"
          onClick={() => void newSession()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </>
    );
  }

  return (
    <>
      <div className="session-tabs">
        {tabs.map(({ path, meta }: { path: string; meta: TabMeta }) => {
          // 徽标判定：会话（sessionId 或路径 UUID）在全局 ask 队列中有未应答即亮
          const pathId = path.startsWith('__new__') ? null : extractSessionId(path);
          const hasAsk = hasPendingAsk(meta.sessionId) || hasPendingAsk(pathId);
          return <TabItem key={path} path={path} meta={meta} hasAsk={hasAsk} showTabMenu={showTabMenu} />;
        })}
      </div>
      <button
        type="button"
        className="session-tab-new"
        id="btnNewSession"
        title="新建对话"
        onClick={() => void newSession()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </>
  );
}

/**
 * TabItem — 单个会话标签。细粒度订阅：active/running/preparing 均为布尔选择器，
 * 后台会话 running 翻转只重渲染对应 tab，不再重渲染整个标签栏。
 */
function TabItem({
  path,
  meta,
  hasAsk,
  showTabMenu,
}: {
  path: string;
  meta: TabMeta;
  hasAsk: boolean;
  showTabMenu: (e: React.MouseEvent, session: TabSession) => void;
}) {
  const isActive = useSessionsStore((s) => s.activeSessionPath === path);
  const isRunning = useProcStore((s) => !!s.procStateMap[path]?.agentRunning);
  const lastInter = useProcStore((s) => s.lastInteractionMap[path] || 0);
  const isFresh = Date.now() - lastInter < INTERACTION_WINDOW_MS;
  const isPreparing = useSessionsStore((s) => !!s.preparingNewSessions[path]);

  const title = meta.title || '新对话';
  const msgCount = meta.messageCount || 0;

  const cls = [
    'session-tab',
    isActive ? 'active' : '',
    isRunning ? 'running' : '',
    isFresh ? 'open' : '',
    hasAsk ? 'pending-ask' : '',
    isPreparing ? 'preparing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const session: TabSession = {
    path,
    dirName: meta.dirName,
    title: meta.title,
    firstMessage: meta.firstMessage,
    messageCount: meta.messageCount,
    sessionId: meta.sessionId,
  };

  return (
    <button
      type="button"
      className={cls}
      title={title}
      data-dirname={meta.dirName || ''}
      onClick={() => void switchToSession(path)}
      onContextMenu={(e) => showTabMenu(e, session)}
    >
      <span className="session-tab-name">{title.length > TITLE_MAX ? `${title.substring(0, TITLE_MAX)}…` : title}</span>
      {msgCount > 0 && <span className="session-tab-msgcount">{msgCount}</span>}
      {isPreparing && (
        <span className="session-tab-ask preparing-badge" title="新对话准备中">
          准备中
        </span>
      )}
      {hasAsk && (
        <span className="session-tab-ask" title="正在等待你的回复">
          待回复
        </span>
      )}
      <span
        className="session-tab-close"
        title="关闭标签（不删除对话）"
        role="button"
        aria-label="关闭标签"
        onClick={(e) => {
          e.stopPropagation();
          void closeTab(path, meta);
        }}
      >
        ✕
      </span>
    </button>
  );
}
