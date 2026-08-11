/**
 * AskModal — 全局 ask 队列模态框（等价旧版 displayUiRequest + extModal）
 *
 * - 订阅 uiStore.uiQueue，队列头常显（切会话不丢；后台 ask 也会弹出）
 * - 支持 confirm / select / input / editor 四种交互型
 * - 应答走 extensionResponse(id, value, sessionId) + 出队
 * - 同时注册 showModalInput 处理器（rename 等本地输入复用同一抽屉样式）
 */
import { useEffect, useRef, useState } from 'react';
import { useUiStore, type AskItem } from '../stores/useUiStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { setAskInputHandler } from '../services/sessionController';

interface LocalInputReq {
  title: string;
  prefill: string;
  resolve: (v: string | null) => void;
}

function defaultTitle(method: string): string {
  if (method === 'confirm') return '确认';
  if (method === 'select') return '请选择';
  return '请输入';
}

export default function AskModal() {
  const uiQueue = useUiStore((s) => s.uiQueue);
  const head: AskItem | undefined = uiQueue[0];
  const [localInput, setLocalInput] = useState<LocalInputReq | null>(null);
  // 本地输入框内容（与队列头 input 共用状态避免闪烁）
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // ── 注册 showModalInput（本地输入：重命名等）──

  useEffect(() => {
    setAskInputHandler((title, prefill) =>
      new Promise<string | null>((resolve) => {
        setInputText(prefill);
        setLocalInput({ title, prefill, resolve });
      }),
    );
    return () => setAskInputHandler(null);
  }, []);

  // ── 焦点管理 ──

  useEffect(() => {
    if (localInput) {
      requestAnimationFrame(() => {
        if (head?.method === 'editor') editorRef.current?.focus();
        else inputRef.current?.focus();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localInput, !!head]);

  // ── 应答 ──

  const respond = (id: string, value: unknown, sessionId: string | null | undefined) => {
    void window.tiffaDesktop.extensionResponse(id, value, sessionId || null);
    useUiStore.getState().dequeueAsk(id);
  };

  // ── 本地输入模态（底部抽屉样式，等价旧版 showModalInput）──

  if (localInput) {
    const submit = () => {
      const v = localInput.resolve;
      setLocalInput(null);
      v(inputText);
    };
    const cancel = () => {
      const v = localInput.resolve;
      setLocalInput(null);
      v(null);
    };
    return (
      <div id="extModal" className="overlay">
        <div className="ext-modal-panel">
          <div className="ext-modal-title">{localInput.title}</div>
          <div className="ext-modal-body">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              placeholder={localInput.prefill}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') cancel();
              }}
            />
          </div>
          <div className="ext-modal-actions">
            <button type="button" className="settings-btn" onClick={cancel}>
              取消
            </button>
            <button
              type="button"
              className="settings-btn"
              style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}
              onClick={submit}
            >
              确认
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 队列头渲染（等价旧版 displayUiRequest）──

  if (!head) return null;

  const { id, method } = head;
  const ssid = head._sessionId || null;
  const tag = sessionTagOf(head);
  const title = `${tag ? tag + ' ' : ''}${head.title || defaultTitle(method || '')}`;

  const done = (payload: unknown) => respond(id, payload, ssid);

  if (method === 'confirm') {
    return (
      <div id="extModal" className="overlay">
        <div className="ext-modal-panel">
          <div className="ext-modal-title">{title}</div>
          <div className="ext-modal-body">
            <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{head.message}</div>
          </div>
          <div className="ext-modal-actions">
            <button type="button" className="settings-btn" onClick={() => done({ cancelled: true })}>
              取消
            </button>
            <button
              type="button"
              className="settings-btn"
              style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}
              onClick={() => done({ confirmed: true })}
            >
              确认
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (method === 'select') {
    const options: string[] = Array.isArray(head.options) ? head.options : [];
    return (
      <div id="extModal" className="overlay">
        <div className="ext-modal-panel">
          <div className="ext-modal-title">{title}</div>
          <div className="ext-modal-body">
            {head.message && <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginBottom: 10 }}>{head.message}</div>}
            <div className="ext-modal-options">
              {options.map((opt, i) => (
                <button
                  type="button"
                  key={`${opt}-${i}`}
                  className="ext-modal-option"
                  onClick={() => done({ value: opt })}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="ext-modal-actions">
            <button type="button" className="settings-btn" onClick={() => done({ cancelled: true })}>
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  // input / editor
  const isEditor = method === 'editor';
  return (
    <div id="extModal" className="overlay">
      <div className="ext-modal-panel">
        <div className="ext-modal-title">{title}</div>
        <div className="ext-modal-body">
          {isEditor ? (
            <textarea
              ref={editorRef}
              value={inputText}
              placeholder={head.placeholder || ''}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') done({ cancelled: true });
              }}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              placeholder={head.placeholder || ''}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') done({ value: inputText });
                if (e.key === 'Escape') done({ cancelled: true });
              }}
            />
          )}
        </div>
        <div className="ext-modal-actions">
          <button type="button" className="settings-btn" onClick={() => done({ cancelled: true })}>
            取消
          </button>
          <button
            type="button"
            className="settings-btn"
            style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}
            onClick={() => done({ value: inputText })}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

/** 队列头来源会话标注：非当前会话的 ask 加【来自「会话名」】 */
function sessionTagOf(event: AskItem): string {
  const sp = event._sessionPath;
  if (!sp) return '';
  const active = useSessionsStore.getState().activeSessionPath;
  if (active === sp) return '';
  const sessions = useSessionsStore.getState().sessions;
  const sess = sessions.find((s) => s.path === sp);
  const meta = useSessionsStore.getState().activeTabMeta[sp];
  const title = (sess && (sess.title || sess.firstMessage)) || (meta && meta.title) || '';
  return title ? `【来自「${title}」】` : '';
}
