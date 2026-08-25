/**
 * MessageBubble — 单条消息渲染（等价旧版 createMessageElement / createHistory*Message）
 *
 * - 用户消息：.message.user（steered/queued 标记），纯文本 + 图片，不渲染 markdown
 * - 助手消息：.message.assistant，parts 依次渲染：
 *   thinking（<details> 折叠，live 默认展开，纯思考消息最终自动展开）、
 *   tool call 卡片（默认折叠、出错自动展开、含 diff 时渲染 DiffView）、
 *   text（Markdown 正文）
 * - 消息头：角色标签（你 / ⟳ 引导 / ⏳ 排队 / AI 名）+ 模型 tag + 时间 + 复制按钮
 */
import { memo, useEffect, useMemo, useState } from 'react';
import type { ChatMessage, MessagePart, ThinkingPart, ToolPart } from '../types/messages';
import { useUiStore } from '../stores/useUiStore';
import { summarizeToolCall } from '../services/messageBuilders';
import { copyText } from '../services/utils';
import Markdown from './Markdown';

// ── Thinking 块（<details> 折叠）──

function ThinkingBlock({ part, autoOpen }: { part: ThinkingPart; autoOpen: boolean }) {
  const live = !!part.live;
  const [open, setOpen] = useState(live || autoOpen);

  // live 结束：收起保持整洁；纯思考消息最终化：展开显示"模型回复（思考过程 N 字）"
  useEffect(() => {
    if (live) setOpen(true);
    else if (autoOpen) setOpen(true);
    else setOpen(false);
  }, [live, autoOpen]);

  const len = part.text.length;
  const summary = live
    ? `思考中... ${len} 字`
    : autoOpen
      ? `模型回复（思考过程 ${len} 字）`
      : len > 0
        ? `思考过程 (${len} 字)`
        : '思考过程';

  return (
    <div className="thinking-block">
      <details open={open}>
        <summary onClick={(e) => { e.preventDefault(); setOpen(!open); }}>{summary}</summary>
        <div className="thinking-content">{part.text}</div>
      </details>
    </div>
  );
}

// ── Diff 视图（unified diff 着色行）──

export function DiffView({ diffText }: { diffText: string }) {
  const lines = diffText.split('\n');
  return (
    <div className="diff">
      {lines.map((ln, i) => {
        let cls = 'diff-ctx';
        if (ln.startsWith('@@')) cls = 'diff-hunk';
        else if (ln.startsWith('+') && !ln.startsWith('+++')) cls = 'diff-add';
        else if (ln.startsWith('-') && !ln.startsWith('---')) cls = 'diff-del';
        else if (ln.startsWith('+++') || ln.startsWith('---')) cls = 'diff-hunk';
        return (
          <div key={i} className={`diff-line ${cls}`}>
            {ln || ' '}
          </div>
        );
      })}
    </div>
  );
}

// ── Tool Call 卡片 ──

function ToolCallCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(!!part.expanded);

  const summary = useMemo(() => {
    let args: unknown = null;
    try {
      args = part.args ? JSON.parse(part.args) : null;
    } catch {
      args = null;
    }
    return summarizeToolCall(part.toolName, args);
  }, [part.toolName, part.args]);

  const statusLabel = part.status === 'running' ? '执行中' : part.status === 'error' ? '出错' : '完成';
  const argText = part.args || '';
  const hasDiff = part.hasDiff && !!part.result;

  return (
    <div className="tool-call">
      <div className="tool-call-header" onClick={() => setOpen(!open)}>
        <span className="tool-call-name">{part.toolName}</span>
        {summary && <span className="tool-call-summary">{summary}</span>}
        <span className={`tool-call-status ${part.status}`}>{statusLabel}</span>
      </div>
      <div className={`tool-call-body${open ? '' : ' collapsed'}`}>
        {hasDiff ? (
          <>
            {argText && <div>{argText}</div>}
            <DiffView diffText={part.result as string} />
          </>
        ) : (
          <div>{argText + (part.result ? `\n\n结果:\n${part.result}` : '')}</div>
        )}
      </div>
    </div>
  );
}

// ── 消息正文文本（消息级复制用，等价旧版 body.innerText）──

function messageBodyText(msg: ChatMessage): string {
  return msg.parts
    .map((p) => {
      if (p.kind === 'text') return p.text;
      if (p.kind === 'thinking') return p.text;
      if (p.kind === 'tool') {
        const args = p.args || '';
        const result = p.result ? `\n结果:\n${p.result}` : '';
        return `${args}${result}`;
      }
      return '';
    })
    .join('\n');
}

// ── 用户消息体：纯文本（等价 textContent，不渲染 markdown）+ 图片 ──

function UserBody({ msg }: { msg: ChatMessage }) {
  const content = msg.parts
    .filter((p): p is Extract<MessagePart, { kind: 'text' }> => p.kind === 'text')
    .map((t) => t.text)
    .join('\n');
  return (
    <>
      {content && <div>{content}</div>}
      {msg.images && msg.images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {msg.images.map((im, i) => (
            <img
              key={i}
              src={`data:${im.mimeType};base64,${im.data}`}
              alt={im.name || 'image'}
              title={im.name}
              style={{ maxWidth: 280, maxHeight: 200, borderRadius: 8, objectFit: 'cover' }}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── 流式期间的 mermaid 占位（结束后由 Markdown 渲染成图）──

/** 把流式文本中的 mermaid 围栏（含未闭合的尾部）折叠成单行占位 */
function collapseMermaidBlocks(text: string): string {
  return text
    .replace(/```mermaid[\s\S]*?```/g, '\n（图表生成中…）')
    .replace(/```mermaid[\s\S]*$/g, '\n（图表生成中…）');
}

// ── 助手消息体：thinking / tool / text 顺序渲染 ──

function AssistantBody({ msg }: { msg: ChatMessage }) {
  const hasText = msg.parts.some((p) => p.kind === 'text' && p.text.length > 0);
  // 纯思考消息（最终化后仍无正文）→ thinking 自动展开
  const autoOpenThinking = msg.parts.some((p) => p.kind === 'thinking') && !hasText && !msg.streaming;
  return (
    <>
      {msg.parts.map((part, i) => {
        if (part.kind === 'thinking') return <ThinkingBlock key={i} part={part} autoOpen={autoOpenThinking} />;
        if (part.kind === 'tool') return <ToolCallCard key={part.toolCallId || i} part={part} />;
        if (msg.streaming) {
          // 流式期间用纯文本渲染（white-space:pre-wrap）：react-markdown 全量解析长文本
          // 每次 80ms 超过帧预算、主线程卡顿（用户实测：思考块/代码块纯文本不卡、正式回复卡）。
          // 流式结束再切换回完整 Markdown（代码块/链接/高亮）。
          return (
            <div key={i} className="streaming-plain">
              {collapseMermaidBlocks(part.text)}
            </div>
          );
        }
        return <Markdown key={i} text={part.text} />;
      })}
    </>
  );
}

// ── 主组件 ──

interface MessageBubbleProps {
  msg: ChatMessage;
}

const MessageBubble = memo(function MessageBubble({ msg }: MessageBubbleProps) {
  const aiName = useUiStore((s) => s.aiName);
  const [copied, setCopied] = useState(false);

  const roleLabel =
    msg.role === 'user' ? (msg.steered ? '⟳ 引导' : msg.queued ? '⏳ 排队' : '你') : aiName || '助手';
  const bodyText = messageBodyText(msg);

  const handleCopy = () => {
    if (!bodyText) return;
    copyText(bodyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`message ${msg.role}${msg.steered ? ' steered' : ''}${msg.queued ? ' queued' : ''}${msg.streaming ? ' streaming' : ''}`}>
      <div className="message-header">
        <span className={`message-role ${msg.role}`}>{roleLabel}</span>
        {msg.role === 'assistant' && msg.modelTag && <span className="message-model">{msg.modelTag}</span>}
        {msg.time && <span className="message-time">{msg.time}</span>}
        <button type="button" className="copy-btn" title="复制内容" onClick={handleCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className={`message-body${msg.role === 'assistant' ? ' markdown-body' : ''}`}>
        {msg.role === 'user' ? <UserBody msg={msg} /> : <AssistantBody msg={msg} />}
        {msg.error && (
          <div
            className="message-error"
            style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
          >
            ⚠ {msg.error}
          </div>
        )}
      </div>
    </div>
  );
});

export default MessageBubble;
