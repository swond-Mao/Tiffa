/**
 * generationGuard — 生成守卫（卡住检测 / 首响超时）
 *
 * 独立服务避免 eventRouter 与 sessionController 循环依赖。
 * 定时器句柄在模块级（非响应式状态）。
 */
import { useProcStore } from '../stores/useProcStore';
import { useUiStore } from '../stores/useUiStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useChatStore } from '../stores/useChatStore';

export const STALL_TIMEOUT_MS = 120000; // 2 分钟（深度卡住检测）
export const FIRST_RESPONSE_TIMEOUT_MS = 30000; // 30 秒无首次响应

let stallTimer: number | null = null;
let firstResponseTimer: number | null = null;

/** 当前模型标签（首响超时诊断用） */
export function currentModelLabel(): string | null {
  const sessPath = useSessionsStore.getState().activeSessionPath;
  const ui = useUiStore.getState();
  const m = sessPath ? useSessionsStore.getState().sessionModelMap[sessPath] : null;
  if (m && m.provider && m.modelId) return `${m.provider}/${m.modelId}`;
  if (ui.currentProvider && ui.currentModel && ui.currentModel !== '--') return `${ui.currentProvider}/${ui.currentModel}`;
  return null;
}

export function startStallCheck(): void {
  stopStallCheck();
  useProcStore.getState().touch();
  stallTimer = window.setInterval(() => {
    const proc = useProcStore.getState();
    const sessions = useSessionsStore.getState();
    const path = sessions.activeSessionPath;
    const running = path ? proc.procStateMap[path]?.agentRunning : false;
    if (!running) {
      stopStallCheck();
      return;
    }
    const elapsed = Date.now() - proc.lastEventTime;
    if (elapsed > STALL_TIMEOUT_MS) {
      useUiStore.getState().setStatusText('可能卡住了 (2分钟无事件)，点击停止可恢复');
      useUiStore.getState().addToast('warning', '代理可能卡住了 — 2 分钟未收到任何事件。可以点击"停止"按钮恢复。');
      stopStallCheck();
    }
  }, 5000);
}

export function stopStallCheck(): void {
  if (stallTimer !== null) {
    clearInterval(stallTimer);
    stallTimer = null;
  }
}

export function startFirstResponseCheck(): void {
  stopFirstResponseCheck();
  useProcStore.getState().setReceivedFirstResponse(false);
  firstResponseTimer = window.setTimeout(async () => {
    const proc = useProcStore.getState();
    const sessions = useSessionsStore.getState();
    const path = sessions.activeSessionPath;
    const running = path ? proc.procStateMap[path]?.agentRunning : false;
    if (running && !proc.receivedFirstResponse) {
      const modelLabel = currentModelLabel();
      // 拉取该会话实例的诊断信息：内核是否还活着
      let alive = '';
      try {
        const diag = await window.tiffaDesktop.diagnostics();
        if (diag && Array.isArray(diag.instances)) {
          const sid = sessions.activeSessionId;
          const mine = sid ? diag.instances.find((i) => i.sessionId === sid) : null;
          if (mine) {
            alive = `内核${mine.ready ? '就绪' : '未就绪'}、agent ${mine.agentRunning ? '运行中' : '空闲'}${mine.pid ? ' (pid=' + mine.pid + ')' : ''}`;
          }
        }
      } catch {
        /* ignore */
      }
      const modelInfo = modelLabel ? ` 当前模型: ${modelLabel}。` : '';
      const aliveInfo = alive ? ` 后台状态: ${alive}。` : '';
      const reason =
        `30 秒未收到模型响应。${modelInfo}${aliveInfo}` +
        `常见原因：模型服务未启动、API 密钥无效或余额不足、网络不通、模型名配置错误。可点击"停止"取消，或切换模型后重试。`;
      useUiStore.getState().setStatusText('模型可能不可达，正在等待响应...');
      useUiStore.getState().addToast('warning', reason);
      // 失败原因透传到消息区（空响应处直接可见，不再只靠 toast）
      useChatStore.getState().injectAssistantError(path, reason);
    }
  }, FIRST_RESPONSE_TIMEOUT_MS);
}

export function stopFirstResponseCheck(): void {
  if (firstResponseTimer !== null) {
    clearTimeout(firstResponseTimer);
    firstResponseTimer = null;
  }
}

/** 收到首次 agent 响应（message_start assistant / agent_start） */
export function markFirstResponseReceived(): void {
  const proc = useProcStore.getState();
  if (!proc.receivedFirstResponse) {
    proc.setReceivedFirstResponse(true);
    stopFirstResponseCheck();
  }
}
