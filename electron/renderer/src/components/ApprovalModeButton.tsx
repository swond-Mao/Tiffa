/**
 * ApprovalModeButton — 审批模式循环切换按钮（等价旧版 renderApprovalModeIndicator + cycleApprovalMode）
 *
 * normal = 逐条确认 / auto = 自动批准读、确认写 / yolo = 全自动
 * 点击循环切换：localStorage per-workspace 持久化 → writeApprovalMode →
 * agent 空闲时重启当前实例立即生效（运行中则提示下次生效）
 */
import { useUiStore, type ApprovalMode } from '../stores/useUiStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useProjectsStore } from '../stores/useProjectsStore';
import { useProcStore } from '../stores/useProcStore';
import { cwdKey } from '../services/utils';

const APPROVAL_MODES: ApprovalMode[] = ['normal', 'auto', 'yolo'];
const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  normal: '审批：确认',
  auto: '审批：半自动',
  yolo: '审批：全自动',
};

export default function ApprovalModeButton() {
  const approvalMode = useUiStore((s) => s.approvalMode);

  const cycle = async () => {
    const ui = useUiStore.getState();
    const sessions = useSessionsStore.getState();
    const projects = useProjectsStore.getState();
    const proc = useProcStore.getState();
    const idx = APPROVAL_MODES.indexOf(approvalMode);
    const next = APPROVAL_MODES[(idx + 1) % APPROVAL_MODES.length];
    ui.setApprovalMode(next);
    // 持久化到 per-workspace + 默认
    const key = 'tiffa-approvalMode-' + cwdKey(projects.workspacePath || '');
    try {
      localStorage.setItem(key, next);
      localStorage.setItem('tiffa-approvalMode-default', next);
    } catch {
      /* ignore */
    }
    ui.addToast('info', `审批模式: ${APPROVAL_MODE_LABELS[next]}`);
    // 写入 config.yml + 重启当前会话实例让审批模式立即生效
    try {
      const result = await window.tiffaDesktop.writeApprovalMode(next);
      if (result && result.success === false) {
        return;
      }
      const activePath = sessions.activeSessionPath;
      const running = activePath ? proc.procStateMap[activePath]?.agentRunning : false;
      // agent 运行中不重启（避免中断任务），配置在下次新对话或手动重启时生效
      if (running) {
        ui.addToast('info', '审批模式将在下次新对话时生效');
        return;
      }
      // 重启当前会话实例
      if (sessions.activeSessionId && projects.workspacePath) {
        ui.setApprovalModeRestarting(true);
        try {
          proc.setReady(false);
          ui.setStatusText('重启中...');
          await window.tiffaDesktop.closeSession(projects.workspacePath, sessions.activeSessionId);
          await window.tiffaDesktop.activateSession(projects.workspacePath, sessions.activeSessionId);
          // ready 事件会自动设置 tiffaReady=true 和恢复模型
        } catch {
          proc.setReady(true);
          ui.setStatusText('就绪');
        } finally {
          ui.setApprovalModeRestarting(false);
        }
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      id="approvalModeBtn"
      className={`titlebar-btn approval-mode-btn mode-${approvalMode}`}
      title="工具审批模式：点击切换"
      onClick={() => void cycle()}
    >
      {APPROVAL_MODE_LABELS[approvalMode] || '确认'}
    </button>
  );
}
