/**
 * eventRouter — 事件路由服务
 *
 * - onEvent 订阅 + 严格路由守卫（后台帧只同步 sessionAgentRunning / 后台自动重命名）
 * - handleEvent 全部分支分发到各 store（等价 app.js handleEvent）
 * - onExited 处理
 */
import type { TiffaEventFrame } from '../types/tiffaDesktop';
import { useProcStore } from '../stores/useProcStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useChatStore } from '../stores/useChatStore';
import { useUiStore, type AskItem } from '../stores/useUiStore';
import { useProjectsStore } from '../stores/useProjectsStore';
import {
  startStallCheck, stopStallCheck,
  startFirstResponseCheck, stopFirstResponseCheck,
  markFirstResponseReceived, currentModelLabel,
  touchGuard, hasReceivedFirstResponse,
} from './generationGuard';
import { flushPendingQueue, loadSessions, restoreTodoPhases, applySessionMigration, migrateStuckNewTabs, invalidateModelListCache } from './sessionController';
import { autoRenameWithLightModel } from './historyService';
import { findSessionPathById, extractSessionId, dirNameFromSessionPath, dbgLog, localizeKernelMessage } from './utils';
import { normalizeUserContent } from './messageBuilders';
import { finalizeStreamText } from '../stores/useChatStore';

// ── 后台路由守卫 ──

interface StreamToolCallInfo {
  id?: string;
  name?: string;
  args?: unknown;
}

/** 从 message_update 的 partial.content[contentIndex] 提取工具调用信息（类型守卫，不内联 cast） */
function extractToolCallFromPartial(partial: unknown, contentIndex: number): StreamToolCallInfo {
  if (!partial || typeof partial !== 'object') return {};
  if (!('content' in partial) || !Array.isArray(partial.content)) return {};
  const item = partial.content[contentIndex];
  if (!item || typeof item !== 'object') return {};
  if (!('id' in item) || !('name' in item)) return {};
  const info: StreamToolCallInfo = {};
  if (typeof item.id === 'string') info.id = item.id;
  if (typeof item.name === 'string') info.name = item.name;
  if ('partialArgs' in item) info.args = item.partialArgs;
  else if ('arguments' in item) info.args = item.arguments;
  return info;
}

/** 从 sessionId 解析会话路径：优先 tab 匹配，回退会话列表扫描（tab 被关/LRU 淘汰后，
 *  后台 agent_end 仍能复位 agentRunning，避免切回时误判“agent 运行中”而跳过刷新 */
function resolveBgPath(
  sessionId: string,
  sessions: ReturnType<typeof useSessionsStore.getState>,
): string | null {
  const fromTabs = findSessionPathById(sessionId, sessions.activeSessionPaths);
  if (fromTabs) return fromTabs;
  // __new__ tab 的 path 提取不出 sessionId，但 tab meta 里存了临时 sessionId——
  // 跨项目/新建对话切走时，后台 agent_end 靠它才能复位 agentRunning 并标记缓存不新鲜
  // （否则发送按钮卡“运行中”、切回后跳过磁盘校正显示旧尾部）。
  for (const [p, m] of Object.entries(sessions.activeTabMeta)) {
    if (m.sessionId === sessionId) return p;
  }
  const sess = sessions.sessions.find((s) => s.sessionId === sessionId);
  return sess ? sess.path : null;
}

/** 消息事件的归属写入路径：_sessionId 匹配当前活跃会话 → activeSessionPath；
 *  否则解析到归属 tab（含 __new__ 临时 tab）→ 写入其缓冲——后台/临时会话回复期间
 *  内容照常积累（对齐 oh-my-pi-UI 的 __sessionPath 路由），agent_end 迁移后不丢；
 *  找不到归属（不属于任何已知会话）→ null（丢弃）。 */
function resolveEventWritePath(
  event: TiffaEventFrame,
  sessions: ReturnType<typeof useSessionsStore.getState>,
): string | null {
  const evSid = (event as { _sessionId?: string | null })._sessionId;
  if (!evSid || !sessions.activeSessionId || evSid === sessions.activeSessionId) {
    // activeSessionPath 可能因切换中断/竞态停留在上一个会话（activeSessionId 已更新）——
    // 仅凭 evSid===activeSessionId 会把当前会话内容写进错误视图（跨会话流出的根因）。
    // 校验路径归属：不一致时按 evSid 解析真实归属。
    const ap = sessions.activeSessionPath;
    if (evSid && ap) {
      const pathSid =
        extractSessionId(ap) ||
        (ap.startsWith('__new__') ? (sessions.activeTabMeta[ap]?.sessionId ?? null) : null);
      if (pathSid !== evSid) {
        const bg = resolveBgPath(evSid, sessions);
        if (bg) return bg;
      }
    }
    return ap;
  }
  return resolveBgPath(evSid, sessions);
}

/** 主动兜底迁移 __new__ tab，迁移成功后补发自动重命名（幂等：已迁移的 tab 不会
 *  再出现在 migrateStuckNewTabs 的待迁列表；autoRenameWithLightModel 有防重） */
async function migrateAndRenameNewTab(tempPath: string): Promise<void> {
  try {
    const map = await migrateStuckNewTabs();
    const newPath = map[tempPath];
    if (newPath && !useSessionsStore.getState().autoNamedSessions[newPath]) {
      const s2 = useSessionsStore.getState().sessions.find((x) => x.path === newPath);
      autoRenameWithLightModel(s2 || { path: newPath }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function routeBackgroundEvent(event: TiffaEventFrame): boolean {
  const sessions = useSessionsStore.getState();
  const projects = useProjectsStore.getState();
  const proc = useProcStore.getState();
  const ui = useUiStore.getState();
  if (sessions.activeSessionId != null) {
    // session_switch / extension_ui_request 必须透传
    if (
      event._sessionId !== sessions.activeSessionId &&
      event.type !== 'session_switch' &&
      event.type !== 'extension_ui_request'
    ) {
      if (event._sessionId != null) {
        if (event.type === 'ready') {
          // 后台实例就绪：点亮该会话圆点（活跃会话的 ready 由 handleEvent 记录）
          const bgPath = resolveBgPath(event._sessionId, useSessionsStore.getState());
          if (bgPath) proc.setSessionReady(bgPath, true);
        } else if (event.type === 'agent_start' || event.type === 'prompt_result') {
          const bgPath = resolveBgPath(event._sessionId, useSessionsStore.getState());
          if (bgPath) {
            proc.setSessionRunning(bgPath, true);
            // 新一轮生成开始：旧快照作废（agent 运行中切回时避免显示上一轮旧尾部）
            useChatStore.getState().markCacheFresh(bgPath, false);
            // 后台首响也要标记并清定时器：发送时启动的首响检测依赖 agent_start/
            // message_start，否则后台会话 30s 后误报“未收到模型响应”
            if (event.type === 'agent_start') markFirstResponseReceived(bgPath);
            startStallCheck(bgPath);
          }
        } else if (event.type === 'agent_end') {
          const bgPath = resolveBgPath(event._sessionId, useSessionsStore.getState());
          if (bgPath) {
            proc.setSessionRunning(bgPath, false);
            // 只停本会话检测器：并行会话的卡住/首响检测互不干扰
            stopStallCheck(bgPath);
            stopFirstResponseCheck(bgPath);
            // 后台对话结束也触发自动重命名。__new__ 先兜底迁移再命名：切走时
            // session_switch 主分支被跳过，迁移悬置；原条件直接排除 __new__，
            // 导致新建对话在后台跑完也永不重命名。
            if (!bgPath.startsWith('__new__')) {
              const bgSess = useSessionsStore.getState().sessions.find((s) => s.path === bgPath);
              if (bgSess && !useSessionsStore.getState().autoNamedSessions[bgPath]) {
                autoRenameWithLightModel(bgSess).catch(() => {});
              }
            } else {
              void migrateAndRenameNewTab(bgPath);
            }
            // 后台结束：缓冲已按归属路由积累完整内容（含 __new__ 临时会话），
            // 落快照并标记新鲜——内核 JSONL 延迟批量写盘（agent_end 后才 flush）时，
            // 切回优先显示内存快照，避免读到不完整磁盘内容而「回复消失/前台不刷新」。
            useChatStore.getState().cacheSnapshot(bgPath, 0);
            useChatStore.getState().markCacheFresh(bgPath, true);
          }
        } else if (event.type === 'message_start') {
          // 后台 assistant 首响：标记该会话已收到首响（清其首响超时定时器）
          const bgMsg = event.message as { role?: string } | undefined;
          if (bgMsg && bgMsg.role === 'assistant') {
            const bgPath = resolveBgPath(event._sessionId, useSessionsStore.getState());
            if (bgPath) markFirstResponseReceived(bgPath);
          }
        }
      }
      return true;
    }
    return false;
  }
  // 无活跃会话：按 cwd 过滤，只接受项目级事件
  if (event._cwd && projects.workspacePath && event._cwd !== projects.workspacePath && event.type !== 'extension_ui_request') {
    return true;
  }
  void ui;
  return false;
}

// ── 事件分发 ──

function handleEvent(event: TiffaEventFrame): void {
  const proc = useProcStore.getState();
  const sessions = useSessionsStore.getState();
  const chat = useChatStore.getState();
  const ui = useUiStore.getState();
  const projects = useProjectsStore.getState();

  // per-session 卡死计时：按事件归属路径 touch（无归属时回退活跃会话）
  touchGuard(resolveEventWritePath(event, sessions) || sessions.activeSessionPath);

  switch (event.type) {
    case 'ready': {
      // 记录实例就绪态（无论是否活跃会话）：对话树左侧圆点据此显示活动对话
      const readyPath = event._sessionId ? resolveBgPath(event._sessionId, sessions) : sessions.activeSessionPath;
      if (readyPath) proc.setSessionReady(readyPath, true);
      // 后台实例（非当前活跃会话）的 ready 不处理 UI 状态：避免用活跃会话的模型记录
      // 错误恢复后台实例、或把就绪/模型显示错置（启动阶段 activeSessionId 为空时放行）
      if (event._sessionId && sessions.activeSessionId && event._sessionId !== sessions.activeSessionId) break;
      proc.setReady(true);
      ui.setStatusText('就绪');
      // 实例重启/新就绪：清死列表缓存，让模型校验走新实例的真实列表（后续调用自然重载）
      invalidateModelListCache();
      // 模型恢复优先于 fetchCurrentModel
      const saved = sessions.activeSessionPath ? sessions.sessionModelMap[sessions.activeSessionPath] : null;
      if (saved && saved.provider && saved.modelId) {
        import('./sessionController')
          .then((sc) =>
            sc.restoreModelIfAvailable(saved.provider, saved.modelId, sessions.activeSessionId, sessions.activeSessionPath || ''),
          )
          .catch(() => {});
      } else {
        import('./sessionController').then((sc) => sc.fetchCurrentModel()).catch(() => {});
      }
      restoreTodoPhases().catch(() => {});
      break;
    }
    case 'error': {
      const reason = event.message || event.error || event.reason || event.detail || '未知错误';
      const loc = localizeKernelMessage(String(reason));
      // 网络/服务类错误：明确提示"可能是服务器不可达"，避免用户以为 Tiffa 卡死
      const netHint = /ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|502|503|504|connection (refused|closed|reset)|network error|server (error|unreachable)/i.test(
        String(reason),
      )
        ? '（可能是服务器不可达/未启动，或服务异常）'
        : '';
      const modelInfo = (() => {
        const ml = currentModelLabel();
        return ml ? ` [${ml}]` : '';
      })();
      const path = resolveEventWritePath(event, sessions) || sessions.activeSessionPath;
      const running = path ? proc.procStateMap[path]?.agentRunning : false;
      // 首响判定 per-session：只有“确实首响前”才复位——避免其他会话发送重置全局
      // 首响标志后，本会话收到 error 被误判“首响前报错”而强制停止（并行对话自动停止根因）
      if (running && !hasReceivedFirstResponse(path)) {
        // 首响前报错 → 复位（只停本会话检测器，不影响并行会话）
        stopStallCheck(path);
        stopFirstResponseCheck(path);
        proc.setSessionRunning(path, false);
        proc.setInstanceRunning(projects.workspacePath, false);
        chat.finalizeAssistant(path);
        ui.setStatusText(netHint ? '出错（服务器不可达）' : '出错');
        // 内容过短等非真错误：info 级且不注入消息区错误块
        const errMsg = loc.isTooShort ? loc.text : `模型出错: ${loc.text}${netHint}${modelInfo}`;
        ui.addToast(loc.level || 'error', errMsg);
        // 失败原因透传到消息区（空响应处直接可见）
        if (!loc.isTooShort) chat.injectAssistantError(path, errMsg);
      } else {
        ui.addToast(loc.level || 'error', loc.isTooShort ? loc.text : `代理出错: ${loc.text}${netHint}${modelInfo}`);
      }
      break;
    }
    case 'prompt_result': {
      const pathPr = resolveEventWritePath(event, sessions) || sessions.activeSessionPath;
      if (event.agentInvoked) {
        proc.setSessionRunning(pathPr, true);
        proc.setInstanceRunning(projects.workspacePath, true);
        startStallCheck(pathPr);
        ui.setStatusText('思考中...');
      }
      break;
    }
    case 'agent_start': {
      const pathAs = resolveEventWritePath(event, sessions) || sessions.activeSessionPath;
      proc.setSessionRunning(pathAs, true);
      proc.setInstanceRunning(projects.workspacePath, true);
      // 新一轮生成：缓存快照可能落后，标记不新鲜
      chat.markCacheFresh(pathAs, false);
      markFirstResponseReceived(pathAs);
      startStallCheck(pathAs);
      ui.setStatusText('思考中...');
      break;
    }
    case 'agent_end': {
      // AI 重命名模式：提取标题并应用
      if (ui.aiRenameSession) {
        const targetSession = ui.aiRenameSession as { path: string; title?: string };
        const title = chat.aiRenameText.trim().replace(/^["'“”《]+|["'“”》]+$/g, '').substring(0, 30);
        ui.setAiRenameSession(null);
        chat.setAiRenameText('');
        proc.setSessionRunning(sessions.activeSessionPath, false);
        ui.setStatusText('就绪');
        if (title) {
          sessions.upsertSession({ path: targetSession.path, title });
          sessions.updateTabMeta(targetSession.path, { title });
          if (!targetSession.path.startsWith('__new__')) {
            window.tiffaDesktop.renameSession(targetSession.path, title).catch(() => {});
          }
          sessions.saveOpenTabs();
          ui.addToast('info', `已重命名：${title}`);
        } else {
          ui.addToast('warning', 'AI 未能生成标题');
        }
        break;
      }
      const pathAe = resolveEventWritePath(event, sessions) || sessions.activeSessionPath;
      proc.setSessionRunning(pathAe, false);
      proc.setInstanceRunning(projects.workspacePath, false);
      ui.setPendingSteerMarker(false);
      // per-session：只停本会话检测器（不误清并行会话的检测）
      stopStallCheck(pathAe);
      stopFirstResponseCheck(pathAe);
      chat.finalizeAssistant(pathAe);
      // 空回复检测：模型不可达/出错时内核不发 error 事件（只发 notice/message_end），
      // 用户看到"模型不回复"却没有原因。agent_end 时检查最后一条 assistant 是否真的产出了内容。
      const ap = pathAe;
      if (ap) {
        const msgs = useChatStore.getState().messagesMap[ap] || [];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.error) {
          const hasText = (lastMsg.parts || []).some((p) => p.kind === 'text' && p.text && String(p.text).trim().length > 0);
          const hasTool = (lastMsg.parts || []).some((p) => p.kind === 'tool');
          if (!hasText && !hasTool) {
            ui.setStatusText('模型未返回内容');
            ui.addToast('warning', '模型未返回任何内容（可能是服务器不可达、模型报错，或模型配置问题）');
          }
        }
      }
      // agent_end flush 缓存并标记新鲜（__new__ 也缓存：迁移时快照随 migrateChatKey 一起走）
      const path = pathAe;
      if (path) {
        chat.cacheSnapshot(path, 0);
        chat.markCacheFresh(path, true);
      }
      ui.setStatusText('就绪');
      // agent 结束后自动发送排队消息（300ms 延迟）
      setTimeout(() => flushPendingQueue(), 300);
      // 延迟刷新会话列表（1.5s 快路径 / 7s 兜底）
      const dirName = projects.activeProjectDirName;
      if (dirName) {
        setTimeout(() => {
          loadSessions(dirName).then(() => useSessionsStore.getState().saveOpenTabs()).catch(() => {});
        }, 1500);
        setTimeout(() => {
          loadSessions(dirName).then(() => useSessionsStore.getState().saveOpenTabs()).catch(() => {});
        }, 7000);
      }
      // 自动重命名（每会话一次）
      const stNow = useSessionsStore.getState();
      let sess = stNow.sessions.find((s) => s.path === sessions.activeSessionPath);
      // sessions.sessions 只含磁盘列表，__new__ 临时 tab 不在其中——从 tab meta 兜底，
      // 否则新建对话结束（session_switch 未达）时整个重命名分支被跳过，永不命名。
      if (!sess && sessions.activeSessionPath) {
        const meta = stNow.activeTabMeta[sessions.activeSessionPath];
        if (meta) sess = { path: sessions.activeSessionPath, title: meta.title, firstMessage: meta.firstMessage };
      }
      if (sess && !stNow.autoNamedSessions[sess.path]) {
        if (sess.path.startsWith('__new__')) {
          // 临时路径：先主动兜底迁移（幂等，覆盖 session_switch 迟到/丢失），再轮询等迁移。
          // 锚点固定为初始 tempPath——用户切走后 activeSessionPath 已变，按它查找
          // 会找到别的会话（串台重命名）或找不到（静默放弃）。
          const tempPath = sess.path;
          void migrateAndRenameNewTab(tempPath);
          let attempts = 0;
          const poll = () => {
            attempts++;
            const st = useSessionsStore.getState();
            // 迁移完成标志：tab meta 中 tempPath 的 key 已被 migrateTabPath 换成真实路径
            if (!st.activeTabMeta[tempPath]) {
              const np =
                st.activeSessionPath && !st.activeSessionPath.startsWith('__new__') ? st.activeSessionPath : null;
              if (np && !st.autoNamedSessions[np]) {
                const s2 = st.sessions.find((x) => x.path === np);
                autoRenameWithLightModel(s2 || { path: np }).catch(() => {});
              }
            } else if (attempts < 20) {
              if (attempts % 3 === 0) void migrateAndRenameNewTab(tempPath);
              setTimeout(poll, 1500);
            }
          };
          setTimeout(poll, 1500);
        } else {
          autoRenameWithLightModel(sess).catch(() => {});
        }
      }
      break;
    }
    case 'turn_end': {
      const wpTurn = resolveEventWritePath(event, sessions);
      if (wpTurn) chat.finalizeAssistant(wpTurn);
      break;
    }
    case 'message_start': {
      // 事件按归属路由：后台/临时会话的消息写入自己的缓冲（回复期间内容不丢），
      // 只有找不到归属的事件才丢弃——不写入 activeSessionPath，杜绝尾巴拼进当前视图。
      const writePath = resolveEventWritePath(event, sessions);
      if (!writePath) break;
      const msg = event.message as { role?: string; content?: unknown };
      if (!msg) break;
      if (msg.role === 'user') {
        // 用户消息已在 sendMessage 提前渲染；后台会话（归属 ≠ 活跃）不重复添加。
        if (writePath !== sessions.activeSessionPath) break;
        // AI 重命名模式 → 跳过
        const running = writePath ? proc.procStateMap[writePath]?.agentRunning : false;
        if (running || ui.aiRenameSession) break;
        const isSteered = !!(msg as { steering?: boolean }).steering || ui.pendingSteerMarker;
        const isQueued = !!(msg as { follow_up?: boolean }).follow_up || ui.pendingFollowUpMarker;
        if (ui.pendingSteerMarker) ui.setPendingSteerMarker(false);
        if (ui.pendingFollowUpMarker) ui.setPendingFollowUpMarker(false);
        const text = normalizeUserContent(msg.content);
        chat.appendUserMessage(writePath, {
          id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          parts: [{ kind: 'text', text }],
          steered: isSteered,
          queued: isQueued,
          time: new Date().toLocaleTimeString(),
        });
      } else if (msg.role === 'assistant') {
        if (ui.aiRenameSession) {
          chat.setAiRenameText('');
          break;
        }
        markFirstResponseReceived(writePath);
        chat.beginAssistantMessage(writePath);
      }
      break;
    }
    case 'message_update': {
      const path = resolveEventWritePath(event, sessions);
      if (!path) break;
      const ast = event.assistantMessageEvent as
        | {
            type?: string;
            contentIndex?: number;
            delta?: string;
            content?: string;
            toolCall?: { id?: string; name?: string; args?: unknown };
            partial?: unknown;
          }
        | undefined;
      if (!ast) break;
      switch (ast.type) {
        case 'text_start':
          chat.textStart(path);
          break;
        case 'text_delta':
          if (ui.aiRenameSession) {
            chat.setAiRenameText(chat.aiRenameText + (ast.delta || ''));
            break;
          }
          chat.textDelta(path, ast.delta || '');
          break;
        case 'text_end':
          chat.textEnd(path, ast.content !== undefined ? ast.content : undefined);
          break;
        case 'thinking_start':
          chat.thinkingStart(path);
          break;
        case 'thinking_delta':
          chat.thinkingDelta(path, ast.delta || '');
          break;
        case 'thinking_end':
          chat.thinkingEnd(path);
          break;
        case 'toolcall_start': {
          // 内核协议：{ type:'toolcall_start', contentIndex, partial }，工具信息在
          // partial.content[contentIndex]（{ id, name, partialArgs }），不在 ast.toolCall。
          const tc = extractToolCallFromPartial(ast.partial, ast.contentIndex ?? -1);
          if (tc.id && tc.name) {
            chat.toolStart(path, tc.id, tc.name, tc.args);
          }
          break;
        }
        case 'toolcall_delta': {
          // 内核协议：{ type:'toolcall_delta', contentIndex, delta, partial }。
          // partial.content[contentIndex].partialArgs 是最新参数快照，用它更新已存在 tool part。
          const tc = extractToolCallFromPartial(ast.partial, ast.contentIndex ?? -1);
          if (tc.id) {
            chat.toolArgsUpdate(path, tc.id, tc.args);
          }
          break;
        }
        case 'toolcall_end': {
          // 内核协议：{ type:'toolcall_end', contentIndex, toolCall:{ id, name, arguments } }
          const tce = ast.toolCall || {};
          const id = typeof tce.id === 'string' ? tce.id : undefined;
          const name = typeof tce.name === 'string' ? tce.name : undefined;
          if (id && name) {
            // 内联 toolcall_end 无结果：标记为 done（真实结果由 tool_execution_end 提供）
            chat.toolEnd(path, id, name, null, false);
          }
          break;
        }
        case 'error':
          ui.addToast('error', `代理出错: ${event.message || event.error || '未知错误'}`);
          break;
      }
      break;
    }
    case 'message_end': {
      const msg = event.message as { role?: string } | undefined;
      if (msg && msg.role === 'assistant') {
        const wpEnd = resolveEventWritePath(event, sessions);
        if (wpEnd) chat.finalizeAssistant(wpEnd);
      }
      break;
    }
    case 'tool_execution_start': {
      const wpTool = resolveEventWritePath(event, sessions);
      if (event.toolCallId && event.toolName && wpTool) {
        chat.toolStart(wpTool, event.toolCallId, event.toolName, event.args);
      }
      // ask 工具等用户回复：暂停卡住检测（仅本会话）
      if (event.toolName === 'ask') stopStallCheck(wpTool);
      break;
    }
    case 'tool_execution_update':
      // 增量结果：React 版暂不渲染（等价 handleToolUpdate no-op）
      break;
    case 'tool_execution_end': {
      const wpToolEnd = resolveEventWritePath(event, sessions);
      if (event.toolCallId && event.toolName && wpToolEnd) {
        chat.toolEnd(wpToolEnd, event.toolCallId, event.toolName, event.result, !!event.isError);
      }
      if (event.toolName === 'ask') {
        const running = wpToolEnd ? proc.procStateMap[wpToolEnd]?.agentRunning : false;
        if (running) startStallCheck(wpToolEnd);
      }
      // todo 工具结果包含 phases
      if (event.toolName === 'todo' && event.result) {
        try {
          const result = typeof event.result === 'string' ? JSON.parse(event.result) : event.result;
          const details = result && result.details ? result.details : result;
          if (details && Array.isArray(details.phases)) {
            ui.setTodoPhases(details.phases);
          }
        } catch {
          /* ignore */
        }
      }
      break;
    }
    case 'extension_ui_request': {
      const { id, method } = event;
      const ssid = event._sessionId || null;
      const ui = useUiStore.getState();
      const resp = (value: unknown) => window.tiffaDesktop.extensionResponse(id, value, ssid);
      if (method === 'cancel') {
        // cancel：关闭/移除对应请求（可能已在队列里，也可能 targetId 指向其它）
        ui.dequeueAsk(event.targetId || id);
        ui.dequeueAsk(id);
        break;
      }
      const INTERACTIVE = ['editor', 'select', 'confirm', 'input'];
      if (INTERACTIVE.includes(method)) {
        // 所有会话的 ask 统一入全局队列——不再隐藏后台 ask，队列头常显
        dbgLog('ask', `enqueueAsk method=${method} sid=${ssid ?? 'null'} active=${sessions.activeSessionId ?? 'null'} bg=${ssid && sessions.activeSessionId ? ssid !== sessions.activeSessionId : 'n/a'}`);
        ui.enqueueAsk(event as unknown as AskItem);
        break;
      }
      // 非交互型：即时处理，不入队、不弹窗
      switch (method) {
        case 'setWidget':
          // 终端 UI 控件展示（ask 工具的交互面板等），桌面端不需要渲染，直接确认
          resp({ confirmed: true });
          break;
        case 'notify': {
          const loc = localizeKernelMessage(String(event.message || ''));
          ui.addToast(loc.level || (event.notifyType === 'error' ? 'error' : event.notifyType === 'warning' ? 'warning' : 'info'), loc.text);
          resp({ confirmed: true });
          break;
        }
        case 'setStatus':
          // 仅当前活跃会话的状态字符串写入全局标签，避免后台会话的 setStatus 污染当前视图
          if (!ssid || !sessions.activeSessionId || ssid === sessions.activeSessionId) {
            ui.setStatusText(String(event.statusText || ''));
          }
          resp({ confirmed: true });
          break;
        case 'setTitle':
          document.title = `Tiffa - ${String(event.title || '')}`;
          resp({ confirmed: true });
          break;
        case 'open_url':
          if (event.url) void window.tiffaDesktop.openExternal(String(event.url));
          resp({ confirmed: true });
          break;
        case 'set_editor_text':
          // 设置 draftInput 而非直接写 textarea，避免与 InputBox 状态冲突
          if (event.text) {
            useChatStore.getState().setDraftInput(String(event.text));
          }
          resp({ confirmed: true });
          break;
        default:
          resp({ confirmed: true }); // 兜底响应，避免内核侧死等
      }
      break;
    }
    case 'config_update': {
      const m = event.model;
      if (m) {
        const sid = event._sessionId;
        if (!sid || !sessions.activeSessionId || sid === sessions.activeSessionId) {
          // event.model 是内核 session.model（Model 对象），不能 String() 整个对象（会得到 "[object Object]"）
          if (typeof m === 'object') {
            const name = m.name || m.id;
            if (name) ui.setCurrentModel(name, m.provider || '');
          } else if (typeof m === 'string') {
            ui.setCurrentModel(m);
          }
        }
      }
      break;
    }
    case 'model_changed':
      // 内核模型已改变（set_model/cycle_model/自动降级后），重新拉取当前模型同步 UI，
      // 避免"切换了模型但按钮/高亮仍是旧模型"的显示漂移。
      // 仅当前活跃会话的 model_changed 才同步（后台实例的模型变化不污染当前显示）
      if (event._sessionId && sessions.activeSessionId && event._sessionId !== sessions.activeSessionId) break;
      import('./sessionController')
        .then((sc) => sc.fetchCurrentModel())
        .catch(() => {});
      break;
    case 'thinking_level_changed': {
      // 内核思考档位已改变（set_thinking_level/cycle_thinking_level/自动降级后），同步 UI
      if (event._sessionId && sessions.activeSessionId && event._sessionId !== sessions.activeSessionId) break;
      const lv = (event as { thinkingLevel?: string }).thinkingLevel || (event as { level?: string }).level;
      if (lv && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(lv)) {
        ui.setThinkingLevelState(lv as never);
      }
      break;
    }
    case 'session_info_update': {
      if (event.title) {
        const sid = event._sessionId;
        if (!sid || !sessions.activeSessionId || sid === sessions.activeSessionId) {
          document.title = `Tiffa - ${event.title}`;
          if (sessions.activeSessionPath) {
            sessions.updateTabMeta(sessions.activeSessionPath, { title: String(event.title) });
          }
        }
        const session = useSessionsStore.getState().sessions.find((s) => s.sessionId === sid);
        if (session) {
          sessions.upsertSession({ path: session.path, title: String(event.title) });
        }
      }
      break;
    }
    case 'notice': {
      const loc = localizeKernelMessage(String(event.message || ''));
      const level = loc.level || (event.level === 'error' ? 'error' : event.level === 'warning' ? 'warning' : 'info');
      ui.addToast(level, loc.text);
      // error/warning 级 notice 同步到状态栏（toast 会消失，状态栏常驻直到下次状态更新）
      if (level === 'error' || level === 'warning') {
        ui.setStatusText(level === 'error' ? `出错: ${loc.text}` : loc.text);
      }
      break;
    }
    case 'set_todos':
      if (Array.isArray(event.phases)) {
        ui.setTodoPhases(event.phases);
      }
      break;
    case 'auto_retry_start':
      ui.setStatusText(`重试中 (${event.attempt}/${event.maxAttempts})...`);
      break;
    case 'auto_retry_end':
      if (event.success) {
        ui.setStatusText('就绪');
      } else {
        const retryErr = event.error || event.message;
        ui.setStatusText(retryErr ? `重试失败: ${retryErr}` : '重试失败');
        if (retryErr) ui.addToast('error', `重试失败: ${retryErr}`);
      }
      break;
    case 'auto_compaction_start':
      // 对话上下文过长自动压缩（内核触发）：提示已由右下角浮窗（toast）呈现，
      // 不再在右上角状态栏显示「正在压缩…」文本（避免与浮窗重复，用户已反馈不要）。
      if (event.reason === 'length') {
        ui.addToast('info', '对话过长，正在自动压缩…');
      }
      break;
    case 'auto_compaction_end':
      ui.setStatusText('就绪');
      ui.addToast('info', '对话压缩完成');
      break;
    case 'retry_fallback_applied':
      // 模型降级（怎么降的、从哪降到哪），旧版可见，新版补回
      ui.setStatusText(`模型降级：${event.to || ''}`);
      ui.addToast(
        'warning',
        `模型降级：${event.from || ''} → ${event.to || ''}${event.role ? `（${event.role}）` : ''}`,
      );
      break;
    case 'retry_fallback_succeeded':
      ui.setStatusText('就绪');
      if (event.model) ui.addToast('info', `模型已恢复：${event.model}`);
      break;
    case 'thinking_level_changed':
      // 思考级别变化（静默，仅状态栏轻提示）
      ui.setStatusText('思考中…');
      break;
    case 'extension_error':
      ui.addToast('error', `扩展错误: ${event.error || event.message || '未知'}`);
      break;
    case 'session_switch': {
      // 只处理当前 workspace 且当前活跃 tab 是 __new__ 的迁移
      if (
        event.sessionPath &&
        sessions.activeSessionPath &&
        sessions.activeSessionPath.startsWith('__new__') &&
        (!event._cwd || !projects.workspacePath || event._cwd === projects.workspacePath)
      ) {
        // 归属校验（关键防串味）：迁移事件必须来自当前活跃 __new__ 会话自己的实例。
        // 否则后台实例（崩溃重启/上下文恢复/会话加载中的旧对话）的 session_switch
        // 会把当前 __new__ tab 错迁到别的会话路径——sessionModelMap 随之迁移覆盖，
        // 后续在错迁 tab 里切模型会写进别人的路径，切回原对话时模型被"继承"污染
        // （表现为：切回原对话模型跟着变，旧模型连接未释放 + 新模型进程 → 双模型卡死）
        // ⚠️ 必须比 _sessionIdPrev（main 转发前的旧 id，新建对话时 = 前端临时 UUID）：
        // 比 event._sessionId 会恒不相等——main 进程转发前已把它更新为真实 id，
        // 导致所有新建对话的迁移被误杀（tab 永远 __new__，AI 重命名/切走卡"准备中"）。
        const activeNewObj = useSessionsStore.getState().sessions.find((s) => s.path === sessions.activeSessionPath);
        const expectedTempId = (activeNewObj && activeNewObj.sessionId) || sessions.activeSessionId;
        const prevSessionId = event._sessionIdPrev;
        dbgLog('switch', `归属校验 prev=${prevSessionId ?? 'null'} expected=${expectedTempId ?? 'null'} match=${!!(prevSessionId && expectedTempId && prevSessionId === expectedTempId)} oldPath=${sessions.activeSessionPath} newPath=${String(event.sessionPath)} activeSid=${sessions.activeSessionId}`);
        if (prevSessionId && expectedTempId && prevSessionId !== expectedTempId) break;
        const newPath = String(event.sessionPath);
        const oldPath = sessions.activeSessionPath;
        if (oldPath.startsWith('__new__')) {
          const realSid = extractSessionId(newPath);
          applySessionMigration(oldPath, newPath, realSid);
          useSessionsStore.setState({
            activeSessionPath: newPath,
            activeSessionId: realSid || sessions.activeSessionId,
          });
        }
        ui.setStatusText('就绪');
        sessions.saveOpenTabs();
        dbgLog('switch', `session_switch 迁移 ${oldPath} -> ${newPath}`);
        // 刷新左侧会话树（带重试）
        const dirName = projects.activeProjectDirName;
        if (dirName) {
          refreshSessionTreeWithRetry(dirName, newPath);
        }
      }
      // 后台 __new__ 补齐迁移（条件必须查 tab meta：sessions.sessions 是磁盘列表，
      // 不含 __new__ 临时 tab——原条件永远不成立，切走后的迁移悬置，树里迟迟不出现）
      if (Object.keys(useSessionsStore.getState().activeTabMeta).some((p) => p.startsWith('__new__'))) {
        void migrateStuckNewTabs().catch(() => {});
      }
      break;
    }
    default:
      dbgLog('event', `未处理事件: ${event.type}`);
      break;
  }
}

/** 定向树刷新（带重试：JSONL 写盘可能晚于 session_switch 事件；新建会话后内核
 *  异步写盘，首轮可能找不到文件，需要更长窗口的重试，否则左侧树延迟出现） */
async function refreshSessionTreeWithRetry(dirName: string, expectPath: string, attempt = 0): Promise<void> {
  const RETRY_DELAYS = [300, 800, 1500, 3000, 5000, 8000, 12000];
  try {
    const result = (await window.tiffaDesktop.listSessions(dirName)) as Array<Record<string, unknown>> & { error?: string };
    if (!result.error && Array.isArray(result)) {
      const norm = (p: unknown) => String(p || '').replace(/\//g, '\\').toLowerCase();
      const found = result.some((s) => norm(s.path) === norm(expectPath));
      if (found) {
        await loadSessions(dirName);
        return;
      }
    }
  } catch {
    /* ignore */
  }
  if (attempt < RETRY_DELAYS.length) {
    setTimeout(() => refreshSessionTreeWithRetry(dirName, expectPath, attempt + 1), RETRY_DELAYS[attempt]);
  }
}

// ── onExited ──

function handleExited(data: { sessionId?: string; cwd?: string; autoRestarting?: boolean; crashCount?: number; code?: number; signal?: string | null }): void {
  const sessions = useSessionsStore.getState();
  const projects = useProjectsStore.getState();
  const proc = useProcStore.getState();
  const chat = useChatStore.getState();
  const ui = useUiStore.getState();
  // 无论活跃/后台：实例退出即标记该会话未就绪（对话树圆点据此熄灭；重启后由 ready 事件重新点亮）
  const exitedPath = data.sessionId
    ? (resolveBgPath(data.sessionId, sessions) || sessions.activeSessionPath)
    : sessions.activeSessionPath;
  if (exitedPath) proc.setSessionReady(exitedPath, false);
  // 多实例严格过滤：只把“活跃会话”的退出当作全局事件。后台实例退出只复位其自身
  // 状态，不动全局 tiffaReady / 状态栏 / 检测器（否则并行对话 B 崩溃重启会把
  // 对话 A 的 UI 打成“未就绪”，且 A 的生成检测被误清）。
  const isActive = sessions.activeSessionId
    ? data.sessionId === sessions.activeSessionId
    : !data.sessionId && (!projects.workspacePath || data.cwd === projects.workspacePath);
  if (!isActive) {
    if (data.sessionId) {
      const bgPath = resolveBgPath(data.sessionId, sessions);
      if (bgPath) {
        // 后台实例退出：复位该会话 agentRunning 与检测器，避免切回时误判“运行中”
        proc.setSessionRunning(bgPath, false);
        stopStallCheck(bgPath);
        stopFirstResponseCheck(bgPath);
        chat.finalizeAssistant(bgPath);
        chat.cacheSnapshot(bgPath, 0);
        chat.markCacheFresh(bgPath, true);
      }
    }
    return;
  }
  // 审批模式切换触发的有计划重启：旧进程 exit 事件在新进程 ready 之前到达，
  // 属正常预期，不显示“已断开”，保持“重启中...”状态等 ready 事件恢复。
  if (ui.approvalModeRestarting) return;
  const activePath = sessions.activeSessionPath;
  // 自动重启：标记未就绪禁止发送
  if (data.autoRestarting) {
    proc.setReady(false);
    stopStallCheck(activePath);
    stopFirstResponseCheck(activePath);
    ui.setStatusText(`重启中 (第${data.crashCount}次)...`);
    ui.addToast(
      'warning',
      `内核进程异常退出（code ${data.code}），正在自动重启（第${data.crashCount}次）…请稍候，就绪后可继续发送。`,
    );
    return;
  }
  proc.setReady(false);
  proc.setSessionRunning(activePath, false);
  stopStallCheck(activePath);
  stopFirstResponseCheck(activePath);
  ui.setPendingSteerMarker(false);
  chat.finalizeAssistant(activePath);
  if (data.crashCount && data.crashCount > 0) {
    const codeInfo = data.code !== undefined && data.code !== null ? `（退出码 ${data.code}${data.signal ? `, signal ${data.signal}` : ''}）` : '';
    ui.setStatusText(`连续崩溃 ${data.crashCount} 次，已停止自动重启${codeInfo}`);
    ui.addToast(
      'error',
      `Tiffa 连续崩溃 ${data.crashCount} 次，已停止自动续行${codeInfo}。请检查模型服务是否正常（终端 [tiffa:stderr] 输出可看具体原因），然后手动发消息继续。`,
    );
  } else {
    ui.setStatusText(`已断开 (code: ${data.code})`);
  }
}

// ── 订阅 ──

let subscribed = false;

export function initEventRouter(): void {
  if (subscribed) return;
  subscribed = true;
  window.tiffaDesktop.onEvent((event) => {
    if (routeBackgroundEvent(event)) return;
    handleEvent(event);
  });
  window.tiffaDesktop.onExited((data) =>
    handleExited(data as { sessionId?: string; cwd?: string; autoRestarting?: boolean; crashCount?: number; code?: number; signal?: string | null }),
  );

  // 兜底同步实例就绪态：启动恢复（实例已就绪但无 ready 事件）/事件丢失等场景，
  // 低频轮询 getInstances（sessionFilePath = 会话路径）保持对话树圆点准确；
  // 只做合并点亮，熄灭一律走 exited 事件，避免旧快照覆盖并发事件写入。
  const syncInstancesReady = async (): Promise<void> => {
    try {
      const instances = (await window.tiffaDesktop.getInstances()) as
        | Array<{ sessionFilePath?: string | null; ready?: boolean }>
        | undefined;
      if (!instances || !Array.isArray(instances)) return;
      const readyMap: Record<string, boolean> = {};
      for (const inst of instances) {
        if (!inst.sessionFilePath) continue;
        readyMap[String(inst.sessionFilePath)] = !!inst.ready;
      }
      if (Object.keys(readyMap).length > 0) {
        useProcStore.setState((s) => ({ sessionReadyMap: { ...s.sessionReadyMap, ...readyMap } }));
      }
    } catch {
      /* ignore */
    }
  };
  void syncInstancesReady();
  setInterval(() => void syncInstancesReady(), 15000);
}

export { finalizeStreamText };
