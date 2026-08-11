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
} from './generationGuard';
import { flushPendingQueue, loadSessions, restoreTodoPhases, applySessionMigration } from './sessionController';
import { autoRenameWithLightModel } from './historyService';
import { findSessionPathById, extractSessionId, dirNameFromSessionPath, dbgLog } from './utils';
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
        if (event.type === 'agent_start' || event.type === 'prompt_result') {
          const bgPath = findSessionPathById(
            event._sessionId,
            sessions.activeSessionId,
            sessions.activeSessionPath,
            sessions.activeSessionPaths,
          );
          if (bgPath) {
            proc.setSessionRunning(bgPath, true);
          }
        } else if (event.type === 'agent_end') {
          const bgPath = findSessionPathById(
            event._sessionId,
            sessions.activeSessionId,
            sessions.activeSessionPath,
            sessions.activeSessionPaths,
          );
          if (bgPath) {
            proc.setSessionRunning(bgPath, false);
            // 后台对话结束也触发自动重命名
            const bgSess = useSessionsStore.getState().sessions.find((s) => s.path === bgPath);
            if (bgSess && !bgPath.startsWith('__new__') && !useSessionsStore.getState().autoNamedSessions[bgPath]) {
              autoRenameWithLightModel(bgSess).catch(() => {});
            }
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

  proc.touch();

  switch (event.type) {
    case 'ready': {
      // 后台实例（非当前活跃会话）的 ready 不处理 UI 状态：避免用活跃会话的模型记录
      // 错误恢复后台实例、或把就绪/模型显示错置（启动阶段 activeSessionId 为空时放行）
      if (event._sessionId && sessions.activeSessionId && event._sessionId !== sessions.activeSessionId) break;
      proc.setReady(true);
      ui.setStatusText('就绪');
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
      const path = sessions.activeSessionPath;
      const running = path ? proc.procStateMap[path]?.agentRunning : false;
      if (running && !proc.receivedFirstResponse) {
        // 首响前报错 → 复位
        stopStallCheck();
        stopFirstResponseCheck();
        proc.setSessionRunning(path, false);
        proc.setInstanceRunning(projects.workspacePath, false);
        chat.finalizeAssistant(path);
        ui.setStatusText(netHint ? '出错（服务器不可达）' : '出错');
        const errMsg = `模型出错: ${reason}${netHint}${modelInfo}`;
        ui.addToast('error', errMsg);
        // 失败原因透传到消息区（空响应处直接可见）
        chat.injectAssistantError(path, errMsg);
      } else {
        ui.addToast('error', `代理出错: ${reason}${netHint}${modelInfo}`);
      }
      break;
    }
    case 'prompt_result':
      if (event.agentInvoked) {
        proc.setSessionRunning(sessions.activeSessionPath, true);
        proc.setInstanceRunning(projects.workspacePath, true);
        startStallCheck();
        ui.setStatusText('思考中...');
      }
      break;
    case 'agent_start':
      proc.setSessionRunning(sessions.activeSessionPath, true);
      proc.setInstanceRunning(projects.workspacePath, true);
      // 新一轮生成：缓存快照可能落后，标记不新鲜
      chat.markCacheFresh(sessions.activeSessionPath, false);
      markFirstResponseReceived();
      startStallCheck();
      ui.setStatusText('思考中...');
      break;
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
      proc.setSessionRunning(sessions.activeSessionPath, false);
      proc.setInstanceRunning(projects.workspacePath, false);
      ui.setPendingSteerMarker(false);
      stopStallCheck();
      stopFirstResponseCheck();
      chat.finalizeAssistant(sessions.activeSessionPath);
      // 空回复检测：模型不可达/出错时内核不发 error 事件（只发 notice/message_end），
      // 用户看到"模型不回复"却没有原因。agent_end 时检查最后一条 assistant 是否真的产出了内容。
      const ap = sessions.activeSessionPath;
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
      // agent_end flush 缓存并标记新鲜
      const path = sessions.activeSessionPath;
      if (path && !path.startsWith('__new__')) {
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
      const sess = useSessionsStore.getState().sessions.find((s) => s.path === sessions.activeSessionPath);
      if (sess && !useSessionsStore.getState().autoNamedSessions[sess.path]) {
        if (sess.path.startsWith('__new__')) {
          // 临时路径：轮询等迁移（最多 10s，每 1.5s 查一次）
          let attempts = 0;
          const poll = () => {
            attempts++;
            const s2 = useSessionsStore.getState().sessions.find((x) => x.path === useSessionsStore.getState().activeSessionPath);
            if (s2 && !s2.path.startsWith('__new__') && !useSessionsStore.getState().autoNamedSessions[s2.path]) {
              autoRenameWithLightModel(s2).catch(() => {});
            } else if (s2 && s2.path.startsWith('__new__') && attempts < 6) {
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
    case 'turn_end':
      chat.finalizeAssistant(sessions.activeSessionPath);
      break;
    case 'message_start': {
      const msg = event.message as { role?: string; content?: unknown };
      if (!msg) break;
      if (msg.role === 'user') {
        // 用户消息已在 sendMessage 提前渲染，或 AI 重命名模式 → 跳过
        const running = sessions.activeSessionPath
          ? proc.procStateMap[sessions.activeSessionPath]?.agentRunning
          : false;
        if (running || ui.aiRenameSession) break;
        const isSteered = !!(msg as { steering?: boolean }).steering || ui.pendingSteerMarker;
        const isQueued = !!(msg as { follow_up?: boolean }).follow_up || ui.pendingFollowUpMarker;
        if (ui.pendingSteerMarker) ui.setPendingSteerMarker(false);
        if (ui.pendingFollowUpMarker) ui.setPendingFollowUpMarker(false);
        const text = normalizeUserContent(msg.content);
        chat.appendUserMessage(sessions.activeSessionPath, {
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
        markFirstResponseReceived();
        chat.beginAssistantMessage(sessions.activeSessionPath);
      }
      break;
    }
    case 'message_update': {
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
      const path = sessions.activeSessionPath;
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
        chat.finalizeAssistant(sessions.activeSessionPath);
      }
      break;
    }
    case 'tool_execution_start':
      if (event.toolCallId && event.toolName) {
        chat.toolStart(sessions.activeSessionPath, event.toolCallId, event.toolName, event.args);
      }
      // ask 工具等用户回复：暂停卡住检测
      if (event.toolName === 'ask') stopStallCheck();
      break;
    case 'tool_execution_update':
      // 增量结果：React 版暂不渲染（等价 handleToolUpdate no-op）
      break;
    case 'tool_execution_end': {
      if (event.toolCallId && event.toolName) {
        chat.toolEnd(sessions.activeSessionPath, event.toolCallId, event.toolName, event.result, !!event.isError);
      }
      if (event.toolName === 'ask') {
        const running = sessions.activeSessionPath
          ? proc.procStateMap[sessions.activeSessionPath]?.agentRunning
          : false;
        if (running) startStallCheck();
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
        ui.enqueueAsk(event as unknown as AskItem);
        break;
      }
      // 非交互型：即时处理，不入队、不弹窗
      switch (method) {
        case 'setWidget':
          // 终端 UI 控件展示（ask 工具的交互面板等），桌面端不需要渲染，直接确认
          resp({ confirmed: true });
          break;
        case 'notify':
          ui.addToast(event.notifyType === 'error' ? 'error' : event.notifyType === 'warning' ? 'warning' : 'info', String(event.message || ''));
          resp({ confirmed: true });
          break;
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
    case 'notice':
      ui.addToast(
        event.level === 'error' ? 'error' : event.level === 'warning' ? 'warning' : 'info',
        String(event.message || ''),
      );
      // error/warning 级 notice 同步到状态栏（toast 会消失，状态栏常驻直到下次状态更新）
      if (event.level === 'error' || event.level === 'warning') {
        const nm = String(event.message || '');
        ui.setStatusText(event.level === 'error' ? `出错: ${nm}` : nm);
      }
      break;
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
        const activeNewObj = useSessionsStore.getState().sessions.find((s) => s.path === sessions.activeSessionPath);
        const expectedTempId = (activeNewObj && activeNewObj.sessionId) || sessions.activeSessionId;
        if (event._sessionId && expectedTempId && event._sessionId !== expectedTempId) break;
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
      // 后台 __new__ 补齐迁移
      if (useSessionsStore.getState().sessions.some((s) => s.path.startsWith('__new__') && s.path !== useSessionsStore.getState().activeSessionPath)) {
        import('./sessionController').then((sc) => sc.migrateStuckNewTabs()).catch(() => {});
      }
      break;
    }
    default:
      dbgLog('event', `未处理事件: ${event.type}`);
      break;
  }
}

/** 定向树刷新（带重试：JSONL 写盘可能晚于 session_switch 事件） */
async function refreshSessionTreeWithRetry(dirName: string, expectPath: string, attempt = 0): Promise<void> {
  const RETRY_DELAYS = [300, 800, 1500, 3000];
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
  // 多实例严格过滤
  if (sessions.activeSessionId) {
    if (data.sessionId !== sessions.activeSessionId) return;
  } else if (data.cwd && projects.workspacePath && data.cwd !== projects.workspacePath) {
    return;
  }
  // 审批模式切换触发的有计划重启：旧进程 exit 事件在新进程 ready 之前到达，
  // 属正常预期，不显示"已断开"，保持"重启中..."状态等 ready 事件恢复。
  if (ui.approvalModeRestarting) return;
  // 自动重启：标记未就绪禁止发送
  if (data.autoRestarting) {
    proc.setReady(false);
    ui.setStatusText(`重启中 (第${data.crashCount}次)...`);
    ui.addToast(
      'warning',
      `内核进程异常退出（code ${data.code}），正在自动重启（第${data.crashCount}次）…请稍候，就绪后可继续发送。`,
    );
    return;
  }
  proc.setReady(false);
  proc.setSessionRunning(sessions.activeSessionPath, false);
  ui.setPendingSteerMarker(false);
  chat.finalizeAssistant(sessions.activeSessionPath);
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
}

export { finalizeStreamText };
