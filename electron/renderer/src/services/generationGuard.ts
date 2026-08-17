/**
 * generationGuard — 生成守卫（卡住检测 / 首响超时）
 *
 * per-session 化：每个会话独立维护 stallTimer / firstResponseTimer /
 * receivedFirstResponse / lastEventTime，多对话并行时互不干扰。
 * 修复竞态：会话 B 发送时 startFirstResponseCheck 重置全局首响标志，
 * 导致会话 A（运行中）收到 error 被误判"首响前报错"而强制复位（自动停止）。
 */
import { useProcStore } from '../stores/useProcStore';
import { useUiStore } from '../stores/useUiStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useChatStore } from '../stores/useChatStore';
import { extractSessionId } from './utils';

export const STALL_TIMEOUT_MS = 120000; // 2 分钟（深度卡住检测）
export const FIRST_RESPONSE_TIMEOUT_MS = 30000; // 30 秒无首次响应

interface GuardEntry {
  stallTimer: number | null;
  firstResponseTimer: number | null;
  receivedFirstResponse: boolean;
  lastEventTime: number;
}

/** per-session 守卫状态（模块级，非响应式） */
const guards = new Map<string, GuardEntry>();

/** 获取或创建会话守卫（只有"启动检测"才创建；stop/mark 不创建，避免空条目堆积） */
function entryFor(path: string | null | undefined): GuardEntry | null {
  if (!path) return null;
  let e = guards.get(path);
  if (!e) {
    e = { stallTimer: null, firstResponseTimer: null, receivedFirstResponse: false, lastEventTime: Date.now() };
    guards.set(path, e);
  }
  return e;
}

/** 会话收到事件时刷新其卡死计时 */
export function touchGuard(path: string | null | undefined): void {
  const e = entryFor(path);
  if (e) e.lastEventTime = Date.now();
}

/** 某会话是否已收到首次响应（error 复位判定用）。
 *  无归属或从未启动检测 → 视为已首响（保守：不触发误复位）。 */
export function hasReceivedFirstResponse(path: string | null | undefined): boolean {
  if (!path) return true;
  const e = guards.get(path);
  if (!e) return true;
  return e.receivedFirstResponse;
}

/** 当前模型标签（首响超时诊断用） */
export function currentModelLabel(path?: string | null): string | null {
  const sessPath = path || useSessionsStore.getState().activeSessionPath;
  const ui = useUiStore.getState();
  const m = sessPath ? useSessionsStore.getState().sessionModelMap[sessPath] : null;
  if (m && m.provider && m.modelId) return `${m.provider}/${m.modelId}`;
  if (ui.currentProvider && ui.currentModel && ui.currentModel !== '--') return `${ui.currentProvider}/${ui.currentModel}`;
  return null;
}

/** 启动该会话的卡住检测（2 分钟无事件 → 提示） */
export function startStallCheck(path: string | null | undefined): void {
  stopStallCheck(path);
  const e = entryFor(path);
  if (!e) return;
  e.lastEventTime = Date.now();
  e.stallTimer = window.setInterval(() => {
    const cur = guards.get(path || '');
    if (!cur) return;
    const running = path ? useProcStore.getState().procStateMap[path]?.agentRunning : false;
    if (!running) {
      stopStallCheck(path);
      return;
    }
    const elapsed = Date.now() - cur.lastEventTime;
    if (elapsed > STALL_TIMEOUT_MS) {
      useUiStore.getState().setStatusText('可能卡住了 (2分钟无事件)，点击停止可恢复');
      useUiStore.getState().addToast('warning', '代理可能卡住了 — 2 分钟未收到任何事件。可以点击"停止"按钮恢复。');
      stopStallCheck(path);
    }
  }, 5000);
}

export function stopStallCheck(path: string | null | undefined): void {
  if (!path) return;
  const e = guards.get(path);
  if (!e || e.stallTimer === null) return;
  clearInterval(e.stallTimer);
  e.stallTimer = null;
}

/** 启动该会话的首响超时检测（30 秒无首次响应 → 警告） */
export function startFirstResponseCheck(path: string | null | undefined): void {
  stopFirstResponseCheck(path);
  const e = entryFor(path);
  if (!e) return;
  e.receivedFirstResponse = false;
  e.firstResponseTimer = window.setTimeout(async () => {
    const cur = guards.get(path || '');
    if (!cur) return;
    const running = path ? useProcStore.getState().procStateMap[path]?.agentRunning : false;
    if (running && !cur.receivedFirstResponse) {
      const modelLabel = currentModelLabel(path);
      // 拉取该会话实例的诊断信息：内核是否还活着
      let alive = '';
      try {
        const diag = await window.tiffaDesktop.diagnostics();
        if (diag && Array.isArray(diag.instances)) {
          const sid = sessionIdFromPath(path);
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
      if (path) {
        useUiStore.getState().setStatusText('模型可能不可达，正在等待响应...');
        useUiStore.getState().addToast('warning', reason);
        // 失败原因透传到消息区（空响应处直接可见，不再只靠 toast）
        useChatStore.getState().injectAssistantError(path, reason);
      }
    }
  }, FIRST_RESPONSE_TIMEOUT_MS);
}

export function stopFirstResponseCheck(path: string | null | undefined): void {
  if (!path) return;
  const e = guards.get(path);
  if (!e || e.firstResponseTimer === null) return;
  clearTimeout(e.firstResponseTimer);
  e.firstResponseTimer = null;
}

/** 收到首次 agent 响应（message_start assistant / agent_start） */
export function markFirstResponseReceived(path: string | null | undefined): void {
  if (!path) return;
  const e = guards.get(path);
  if (!e || e.receivedFirstResponse) return;
  e.receivedFirstResponse = true;
  stopFirstResponseCheck(path);
}

/** 停止全部会话的检测器并清空守卫表（切项目时调用） */
export function stopAllGuards(): void {
  for (const [, e] of guards) {
    if (e.stallTimer !== null) clearInterval(e.stallTimer);
    if (e.firstResponseTimer !== null) clearTimeout(e.firstResponseTimer);
    e.stallTimer = null;
    e.firstResponseTimer = null;
  }
  guards.clear();
}

/** path → sessionId（诊断用；__new__ 临时 tab 从 tab meta 取） */
function sessionIdFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const sid = extractSessionId(path);
  if (sid) return sid;
  if (path.startsWith('__new__')) {
    const meta = useSessionsStore.getState().activeTabMeta[path];
    return (meta && meta.sessionId) || null;
  }
  return null;
}
