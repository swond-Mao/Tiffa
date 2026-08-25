/**
 * AskModal — 全局 ask 队列模态框（等价旧版 displayUiRequest + extModal）
 *
 * - 订阅 uiStore.uiQueue，队列头常显（切会话不丢；后台 ask 也会弹出）
 * - 支持 confirm / select / input / editor / askDialog 五种交互型
 *   （askDialog：内核 ask 工具整批问题一次下发，同屏逐题作答、一次提交）
 * - 应答走 extensionResponse(id, value, sessionId) + 出队
 * - 同时注册 showModalInput 处理器（rename 等本地输入复用同一抽屉样式）
 */
import { useEffect, useRef, useState } from 'react';
import { useUiStore, type AskItem, type AskQuestion } from '../stores/useUiStore';
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
  const src = sourceNameOf(head);
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

  // ── askDialog：内核 ask 工具整批问题一次下发（多问题同屏作答，一次提交）──
  if (method === 'askDialog') {
    return <AskDialogPanel key={id} head={head} src={src} done={done} />;
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

/** 队列头来源会话名：本会话/后台会话统一解析（找不到时回退「当前会话」） */
function sourceNameOf(event: AskItem): string {
  const st = useSessionsStore.getState();
  const sp = event._sessionPath || st.activeSessionPath;
  if (!sp) return '当前会话';
  const sess = st.sessions.find((s) => s.path === sp);
  const meta = st.activeTabMeta[sp];
  return (
    (sess && (sess.title || sess.firstMessage)) ||
    (meta && meta.title) ||
    '当前会话'
  );
}

// ── askDialog 多题对话框 ──

interface AskAnswer {
  /** 已选选项 label（单选至多 1 个；multi 可多个） */
  selected: string[];
  /** 「其他（手动输入）」文本 */
  custom: string;
  /** 「其他」是否激活（激活时选项清空，答案取 custom） */
  useCustom: boolean;
}

const emptyAnswer = (): AskAnswer => ({ selected: [], custom: '', useCustom: false });

/**
 * 多问题同屏对话框：每个问题独立作答区（选项单选/多选 + 其他手动输入），
 * 全部作答后一次提交。载荷与内核 ask 工具 askDialog 分支的 results 校验对齐：
 * {kind:'submit', results:[{id, selectedOptions, customInput?}]}（id/顺序必须与问题一致）。
 */
function AskDialogPanel({
  head,
  src,
  done,
}: {
  head: AskItem;
  /** 来源会话名（始终显示，本会话/后台会话统一） */
  src: string;
  done: (payload: unknown) => void;
}) {
  const questions: AskQuestion[] = Array.isArray(head.questions)
    ? head.questions.filter(
        (q): q is AskQuestion =>
          !!q && typeof q.id === 'string' && typeof q.question === 'string' && Array.isArray(q.options),
      )
    : [];
  const [answers, setAnswers] = useState<Record<string, AskAnswer>>({});
  const [collapsed, setCollapsed] = useState(false); // 收起成右下角小药丸，方便阅读聊天正文

  if (questions.length === 0) return null; // 载荷异常兜底：不弹空框（内核侧会按无 UI 处理）

  const ansOf = (qid: string): AskAnswer => answers[qid] ?? emptyAnswer();
  const patch = (qid: string, p: Partial<AskAnswer>): void => {
    setAnswers((prev) => ({ ...prev, [qid]: { ...emptyAnswer(), ...prev[qid], ...p } }));
  };

  const pickOption = (q: AskQuestion, label: string): void => {
    const cur = ansOf(q.id);
    if (q.multi) {
      const next = cur.selected.includes(label)
        ? cur.selected.filter((l) => l !== label)
        : [...cur.selected, label];
      // 重新选了选项 → 退出「其他」模式（与 TUI 语义一致）
      patch(q.id, { selected: next, useCustom: next.length === 0 ? cur.useCustom : false });
    } else {
      // 单选：点已选项 = 取消
      const next = cur.selected[0] === label ? [] : [label];
      patch(q.id, { selected: next, useCustom: next.length === 0 ? cur.useCustom : false });
    }
  };

  const toggleCustom = (q: AskQuestion): void => {
    const cur = ansOf(q.id);
    if (cur.useCustom) {
      // 已有输入时不收起（防误触丢答案），空输入才收起
      if (cur.custom.trim() === '') patch(q.id, { useCustom: false });
    } else {
      patch(q.id, { useCustom: true, selected: [] });
    }
  };

  const isAnswered = (q: AskQuestion): boolean => {
    const a = ansOf(q.id);
    return a.useCustom ? a.custom.trim().length > 0 : a.selected.length > 0;
  };
  const answeredCount = questions.filter(isAnswered).length;
  const allAnswered = answeredCount === questions.length;

  if (collapsed) {
    // 收起态：透明遮罩 + 右下角小药丸，聊天区完全可读可滚
    return (
      <div id="extModal" className="overlay ext-ask-min">
        <button type="button" className="ext-ask-min-pill" onClick={() => setCollapsed(false)}>
          <span className="ext-ask-min-dot" aria-hidden="true" />
          请回答以下问题 · 已答 {answeredCount}/{questions.length} · 点击展开
        </button>
      </div>
    );
  }

  const submit = (): void => {
    if (!allAnswered) return;

    const results = questions.map((q) => {
      const a = ansOf(q.id);
      const r: { id: string; selectedOptions: string[]; customInput?: string } = {
        id: q.id,
        selectedOptions: a.useCustom ? [] : [...a.selected],
      };
      if (a.useCustom && a.custom.trim()) r.customInput = a.custom.trim();
      return r;
    });
    done({ value: { kind: 'submit', results } });
  };

  return (
    <div id="extModal" className="overlay">
      <div className="ext-modal-panel ext-modal-ask">
        <div className="ext-ask-title-row">
          <div className="ext-modal-title">
            请回答以下问题{questions.length > 1 ? `（共 ${questions.length} 题）` : ''}
            {src ? <span className="ext-ask-src">来自「{src}」的提问</span> : null}
          </div>
          <button type="button" className="ext-ask-collapse-btn" onClick={() => setCollapsed(true)}>
            收起看正文
          </button>
        </div>
        <div className="ext-modal-body">
          {questions.map((q, qi) => {
            const a = ansOf(q.id);
            return (
              <div className="ext-ask-question" key={q.id}>
                <div className="ext-ask-qhead">
                  {questions.length > 1 && <span className="ext-ask-qnum">{qi + 1}</span>}
                  {q.header && q.header.trim() ? (
                    <span className="ext-ask-qtag">{q.header}</span>
                  ) : null}
                </div>
                <div className="ext-ask-qtext">{q.question}</div>
                <div className="ext-ask-options">
                  {q.options.map((opt, oi) => {
                    const on = !a.useCustom && a.selected.includes(opt.label);
                    return (
                      <div className="ext-ask-optrow" key={`${opt.label}-${oi}`}>
                        <button
                          type="button"
                          className={`ext-ask-opt${on ? ' on' : ''}`}
                          onClick={() => pickOption(q, opt.label)}
                        >
                          <span className="ext-ask-opt-mark" aria-hidden="true">
                            {q.multi ? (on ? '☑' : '☐') : on ? '◉' : '○'}
                          </span>
                          <span className="ext-ask-opt-label">{opt.label}</span>
                          {q.recommended === oi ? <span className="ext-ask-opt-rec">推荐</span> : null}
                        </button>
                        {opt.description && opt.description.trim() ? (
                          <div className="ext-ask-opt-desc">{opt.description}</div>
                        ) : null}
                      </div>
                    );
                  })}
                  <div className="ext-ask-optrow">
                    <button
                      type="button"
                      className={`ext-ask-opt${a.useCustom ? ' on' : ''}`}
                      onClick={() => toggleCustom(q)}
                    >
                      <span className="ext-ask-opt-mark" aria-hidden="true">✎</span>
                      <span className="ext-ask-opt-label">其他（手动输入）</span>
                    </button>
                    {a.useCustom ? (
                      <input
                        type="text"
                        className="ext-ask-custom-input"
                        value={a.custom}
                        placeholder="输入你的回答，Enter 提交（需全部作答）"
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => patch(q.id, { custom: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && allAnswered) submit();
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="ext-modal-actions">
          <button
            type="button"
            className="settings-btn"
            style={{ marginRight: 'auto' }}
            onClick={() => setCollapsed(true)}
          >
            收起看正文
          </button>
          <button type="button" className="settings-btn" onClick={() => done({ cancelled: true })}>
            取消
          </button>
          <button
            type="button"
            className="settings-btn"
            style={{
              background: allAnswered ? 'var(--accent)' : undefined,
              color: allAnswered ? 'white' : undefined,
              borderColor: allAnswered ? 'var(--accent)' : undefined,
              opacity: allAnswered ? 1 : 0.55,
            }}
            disabled={!allAnswered}
            onClick={submit}
          >
            {allAnswered ? '提交' : `请先答完全部问题（${answeredCount}/${questions.length}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
