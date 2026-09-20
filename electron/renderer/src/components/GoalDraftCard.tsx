/**
 * GoalDraftCard — 目标模式的「人审闸门」卡片（渲染在输入区上方）
 *
 * Qoder 式流程：输入框旁打开「目标」开关 → 发需求 → 模型**只转写**成可验收方案
 * （外挂草稿阶段会拦掉所有写类工具）→ 这里展示方案等人审 → 点「开始执行」才真正干活。
 *
 * 状态推进：主进程写 pending → 外挂在 agent_end 解析 ```tiffa-goal 块 → ready/error。
 * 前端轮询 goal:draftStatus（草稿只在会话内异步产出，没有 IPC 主动推送）。
 */
import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../stores/useUiStore';
import { useSessionsStore } from '../stores/useSessionsStore';

const POLL_MS = 2000;
const POLL_MAX = 900; // 30 分钟。实测出现过**请求 200 秒才到达模型**的情况（切模型重载 / 单槽位排队），
// 原来的 90 次（3 分钟）会在方案产出前就停掉轮询 —— 用户白等一场，方案却永远不显示。
/** 超过这个秒数还停在 pending，就不再让用户干等：按主进程的自诊断说明「卡在哪」 */
const STALL_SEC = 45;

export default function GoalDraftCard() {
  const draft = useUiStore((s) => s.goalDraft);
  const setGoalDraft = useUiStore((s) => s.setGoalDraft);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);

  const [objective, setObjective] = useState('');
  const [criteria, setCriteria] = useState<string[]>([]);
  const [todos, setTodos] = useState<string[]>([]);
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // 自动续跑：长任务勾选后，模型每轮结束会被自动拉起下一回合（护栏在设置里配，这里给默认 30 轮 / 240 分钟）
  const [autoResume, setAutoResume] = useState(false);
  const [waited, setWaited] = useState(0);
  const pollRef = useRef<number | null>(null);
  const pollsRef = useRef(0);

  // 草稿属于别的会话就当没有：切对话后不该继续显示上一个对话的方案。
  // ⚠️ 归属匹配优先用 uiSessionId —— 会话 id 在「新对话首条消息」时会迁移，主进程按实例 id 写、
  // 外挂按 hook id 写、这里按渲染层 id 读，三方不一致时用 sessionId 判断会把卡片整块隐藏：
  // 方案明明已经产出，用户却只看到"模型正在转写…"一直转圈。
  const owner = draft?.uiSessionId || draft?.sessionId;
  const mine =
    draft && draft.objective !== undefined
      ? !activeSessionId || !owner || owner === activeSessionId
        ? draft
        : null
      : draft;

  // 草稿就绪时把内容灌进可编辑表单（只灌一次，之后用户可以随便改）
  const loadedKey = useRef('');
  useEffect(() => {
    if (!mine || mine.status !== 'ready') return;
    const key = `${mine.sessionId}|${mine.ts ?? 0}|${mine.objective ?? ''}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    setObjective(mine.objective ?? '');
    setCriteria(mine.criteria ?? []);
    setTodos(mine.todos ?? []);
  }, [mine]);

  // 等待计时：pending 状态是前端自己置的，不能证明模型真在跑 —— 超时就得把话说清楚
  useEffect(() => {
    if (!mine || mine.status !== 'pending') {
      setWaited(0);
      return;
    }
    const t = window.setInterval(() => setWaited((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [mine?.status, mine?.sessionId]);

  // 轮询推进 pending → ready/error（外挂在 agent_end 落盘，没有事件通道）
  useEffect(() => {
    if (!mine || mine.status !== 'pending') return;
    pollsRef.current = 0;
    const tick = async () => {
      pollsRef.current++;
      try {
        const r = await window.tiffaDesktop.goalDraftStatus(activeSessionId ?? null);
        const d = r?.draft;
        if (d && d.status !== 'pending') {
          setGoalDraft({ ...d, sessionId: d.sessionId ?? activeSessionId ?? '' } as never);
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          return;
        }
        // 仍是 pending：把主进程 4 秒时写回的自诊断（diag）与模型名同步进卡片。
        // 否则「卡在内核排队」和「卡在模型端」两种完全不同的处境长得一模一样，
        // 用户只能盯着秒表猜 —— 实测那两种情况的等待时间都可能到 200 秒级。
        const cur = useUiStore.getState().goalDraft;
        if (d && (d.diag?.atSec !== cur?.diag?.atSec || (d.model && d.model !== cur?.model))) {
          setGoalDraft({ ...(cur ?? {}), ...d, sessionId: cur?.sessionId ?? d.sessionId ?? activeSessionId ?? '' } as never);
        }
      } catch {
        /* 读不到就下一轮再试 */
      }
      if (pollsRef.current > POLL_MAX && pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
        setNote('已等待 30 分钟仍没有方案。请求可能一直卡在队列里 —— 点「停止」后重发，或到「设置 → 目标模式」手动填写目标。');
      }
    };
    pollRef.current = window.setInterval(tick, POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [mine?.status, mine?.sessionId, activeSessionId, setGoalDraft]);

  if (!mine) return null;

  const close = async () => {
    await window.tiffaDesktop.goalDraftCancel(activeSessionId ?? null);
    setGoalDraft(null);
    loadedKey.current = '';
  };

  /** 转写失败后的「重发一次」：用原始需求重新下发，卡片回到 pending 继续等方案 */
  const retry = async () => {
    const text = (mine?.request ?? '').trim();
    if (!text) {
      setNote('原始需求为空，无法自动重发。请到「设置 → 目标模式」手动填写目标。');
      return;
    }
    setBusy(true);
    setNote('');
    // 先置本地下 pending（卡片立刻回到转写态），再下发；失败则回退清空
    useUiStore.getState().setGoalDraft({
      sessionId: mine?.sessionId ?? activeSessionId ?? '',
      ts: Date.now(),
      status: 'pending',
      request: text,
      objective: '',
      criteria: [],
      todos: [],
      model: '',
    } as never);
    const r = await window.tiffaDesktop.goalDraft(text, activeSessionId ?? null);
    setBusy(false);
    if (!r?.ok) {
      useUiStore.getState().setGoalDraft(null);
      setNote(r?.error || '重发失败');
      return;
    }
    const label = r.model ? `${r.model.provider} / ${r.model.modelId}`.trim() : '';
    if (label && label !== '/') {
      const cur = useUiStore.getState().goalDraft;
      if (cur) useUiStore.getState().setGoalDraft({ ...cur, model: label } as never);
    }
  };

  const start = async () => {
    const text = objective.trim();
    if (!text) {
      setNote('目标描述不能为空');
      return;
    }
    setBusy(true);
    const b = Number(budget);
    const r = await window.tiffaDesktop.goalDraftApply(
      { objective: text, criteria: criteria.filter((s) => s.trim()), todos: todos.filter((s) => s.trim()) },
      Number.isFinite(b) && b > 0 ? b : null,
      activeSessionId ?? null,
      autoResume ? { enabled: true, maxTurns: 30, maxMinutes: 240, minIntervalMs: 800 } : null,
    );
    setBusy(false);
    if (!r?.ok) {
      setNote(r?.error || '开始执行失败');
      return;
    }
    useUiStore.getState().addToast('success', autoResume ? '目标已开始执行（自动续跑已开启）' : '目标已开始执行');
    setGoalDraft(null);
    loadedKey.current = '';
  };

  const setAt = (list: string[], set: (v: string[]) => void, i: number, v: string) => {
    const next = [...list];
    next[i] = v;
    set(next);
  };

  return (
    <div className="goal-draft-card">
      <div className="goal-draft-head">
        <span className="goal-draft-title">目标方案（待确认）</span>
        {mine.status === 'pending' ? (
          <span className="goal-draft-badge pending">
            {mine.model ? `正在用 ${mine.model} 转写…` : '模型正在转写…'}
          </span>
        ) : null}
        <button type="button" className="goal-draft-close" title="放弃这份方案" onClick={() => void close()}>
          ✕
        </button>
      </div>

      {mine.request ? <div className="goal-draft-request">原始需求：{mine.request}</div> : null}

      {mine.status === 'pending' ? (
        <div className="goal-draft-hint">
          模型正在把你的需求转写成可验收的目标方案（这一轮它只读代码、不会动手改任何东西）。方案出来后在这里等你确认。
          {mine.model ? ` 本次转写用的是当前会话的模型：${mine.model}。` : ''}
          {waited >= STALL_SEC ? (
            <div className="goal-draft-error" style={{ marginTop: 8 }}>
              {mine.diag?.invoked === true ? (
                <>
                  已等待 {waited} 秒：请求<b>已经交给模型</b>了（内核起了回合），慢在模型侧 ——
                  常见于模型服务被别的会话占着排队、刚切换模型需要重载权重、或首包本来就慢。
                  继续等通常能出；也可以点「停止」后到「设置 → 目标模式」换个更快的转写模型重发。
                </>
              ) : mine.diag?.invoked === false ? (
                <>
                  已等待 {waited} 秒：内核<b>受理了但没起回合</b>，请求排在内核任务队列后面（上一条命令没收尾
                  {mine.diag.pendingAsks > 0 ? `；当前有 ${mine.diag.pendingAsks} 个确认框在等你答复` : ''}
                  ）。点「停止」再重发一次。
                </>
              ) : (
                <>已等待 {waited} 秒，正在确认请求究竟走到了哪一步…</>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {mine.status === 'error' ? (
        <div className="goal-draft-error">
          {mine.error || '模型没有按规定格式输出方案。'}
          <div className="goal-draft-actions" style={{ marginTop: 8 }}>
            <button type="button" className="goal-draft-primary" disabled={busy} onClick={() => void retry()}>
              {busy ? '重发中…' : '重发一次'}
            </button>
            <span className="goal-draft-note">用原始需求重新转写；也可到「设置 → 目标模式」手动填写目标</span>
          </div>
        </div>
      ) : null}

      {mine.status === 'ready' ? (
        <>
          <label className="goal-draft-label">目标（做完了是什么样子）</label>
          <textarea
            className="goal-draft-objective"
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />

          {criteria.length ? (
            <>
              <label className="goal-draft-label">验收标准</label>
              <ul className="goal-draft-list">
                {criteria.map((c, i) => (
                  <li key={`c${i}`}>
                    <input value={c} onChange={(e) => setAt(criteria, setCriteria, i, e.target.value)} />
                    <button type="button" onClick={() => setCriteria(criteria.filter((_, k) => k !== i))} title="删除">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {todos.length ? (
            <>
              <label className="goal-draft-label">执行步骤</label>
              <ul className="goal-draft-list">
                {todos.map((t, i) => (
                  <li key={`t${i}`}>
                    <input value={t} onChange={(e) => setAt(todos, setTodos, i, e.target.value)} />
                    <button type="button" onClick={() => setTodos(todos.filter((_, k) => k !== i))} title="删除">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="goal-draft-row">
            <label className="goal-draft-label inline">token 预算（可选）</label>
            <input
              className="goal-draft-budget"
              type="number"
              min={0}
              placeholder="留空=不限"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>

          <label className="goal-draft-label" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
            <input type="checkbox" checked={autoResume} onChange={(e) => setAutoResume(e.target.checked)} />
            自动续跑到目标完成（默认上限 30 轮 / 240 分钟）
          </label>

          <div className="goal-draft-actions">
            <button type="button" className="goal-draft-primary" disabled={busy} onClick={() => void start()}>
              {busy ? '启动中…' : '开始执行'}
            </button>
            <button type="button" onClick={() => void close()} disabled={busy}>
              放弃
            </button>
            <span className="goal-draft-note">确认后目标才会真正创建，模型随即开始动手</span>
          </div>
        </>
      ) : null}

      {note ? <div className="goal-draft-note">{note}</div> : null}
    </div>
  );
}
