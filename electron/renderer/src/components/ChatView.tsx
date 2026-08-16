/**
 * ChatView — 消息列表（等价旧版 doLoad 渲染 + followScroll + loadEarlierBatch）
 *
 * - 订阅当前活跃会话的 messages / welcomePhase / history（懒加载游标）
 * - 滚动跟随：流式内容变化自动贴底；用户上滚/拖滚动条/翻页键脱离跟随；
 *   到底自动恢复；脱离且距底>80px 显示 #scrollToBottomBtn（生成中有提示点）
 * - 会话切换：有 DOM 缓存（sessionMessageCache）恢复滚动位置 + sync 跟随状态；
 *   无缓存置为跟随（历史加载完成后自动贴底）
 * - 顶部「加载更早」按钮 + 滚到顶部附近自动懒加载（120px + 300ms 节流），
 *   插入后补偿滚动位置不跳视口
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useProcStore } from '../stores/useProcStore';
import { loadEarlierBatch } from '../services/historyService';
import MessageBubble from './MessageBubble';
import WelcomeScreen from './WelcomeScreen';
import Minimap from './Minimap';
import { dbgLog } from '../services/utils';

// 常量（等价旧版 followScroll）
const RESUME_EPS = 60;
const BTN_SHOW = 80;
const TOP_LAZY_SCROLL = 120;
const TOP_LAZY_THROTTLE = 300;
// 流式中用户 detach（上滚/翻页看历史）后，若持续无滚动操作超过此时长，自动恢复跟随。
// 根治「窗口静止、文字在下面刷」：用户等待输出时翻过历史 → followRef=false →
// 正式回复增长时不跟随，且 onScroll 恢复需要用户主动滚到底才触发（永不触发）。
// 用户持续滚动（读历史）会不断刷新时间戳，不会被打扰；停下超阈值即回到底部。
// 阈值：3s 实测太敏感（翻历史稍一停顿就被拉回底部，打断阅读），改为 15s；
// 用户随时可用 #scrollToBottomBtn 立即回底。
const AUTO_RESUME_MS = 15000;
// 滚动诊断日志节流间隔（落 data/logs/renderer.log，仅排查用，不影响 UI）
const DIAG_INTERVAL = 500;

// 固定窗口虚拟化（对标 dim 项目 oh-my-pi-UI/ChatView）：
// 只渲染最近 WINDOW_SIZE 条，向上滚动时窗口前移（替换而非增长），DOM 恒定。
// 窗口化禁用的历史教训：窗口未钉到最新时，最新消息（尾巴）从渲染中消失——用户感知
// 为“尾巴掉了”。恢复窗口化时用「流式中窗口钉最新」保证：streaming 期间 startIdx 强制
// 为 total - WINDOW_SIZE（无视用户上滚的 windowStart），最新消息恒在窗口内，尾巴不掉；
// 流式结束后恢复 windowStart 语义（用户上滚位置）。
// 窗口化（≥300 条）时 Minimap 的全局密度语义与窗口渲染冲突，一并隐藏（色块在 300 条
// 以上本就糊成一团，滚动条足够定位）。
const WINDOW_SIZE = 100;
const WINDOW_THRESHOLD = 300;
const LOAD_MORE = 40;

const EMPTY_MSGS: never[] = [];

export default function ChatView() {
  const activeSessionPath = useSessionsStore((s) => s.activeSessionPath);
  const messages = useChatStore((s) => (activeSessionPath ? s.messagesMap[activeSessionPath] : undefined)) || EMPTY_MSGS;
  const welcomePhase = useChatStore((s) => s.welcomePhase);
  const history = useChatStore((s) => (activeSessionPath ? s.history[activeSessionPath] : undefined));
  const agentRunning = useProcStore((s) => (activeSessionPath ? s.procStateMap[activeSessionPath]?.agentRunning : false));
  // 当前会话是否流式中（布尔选择器，细粒度；窗口计算依赖它钉最新）
  const streamingActive = useChatStore((s) => (activeSessionPath ? !!s.streaming[activeSessionPath] : false));

  const messagesRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const followRef = useRef(true);
  const pendingRafRef = useRef(false);
  const lastLazyLoadRef = useRef(0);
  const lastUserScrollRef = useRef(0); // 用户最后一次主动滚动/导航时间戳（自动恢复跟随判定）
  const lastDiagRef = useRef(0); // 诊断日志节流时间戳
  const isStreamingRef = useRef(false); // 当前会话是否有流式消息（tick 闭包内读取）
  const prevStreamingRef = useRef(false); // 上一帧是否在流式（finalize 瞬间补钉底）
  // 当前会话最近的真实滚动位置（onScroll/跳底时更新；切走时写回缓存，
  // 修复 sessionController.cacheSnapshot 恒传 0 → 切回会话停在顶部/中间看不到尾部）
  const scrollPosRef = useRef(0);
  // 上一个活跃会话路径（切走时用它把真实滚动位置写回缓存）
  const prevSessionPathRef = useRef<string | null>(null);

  // 同步流式状态到 ref（mount effect 的闭包固化，不能直接读渲染期变量；
  // 直接查 streaming map（O(1)），避免每 delta 对全量 messages 做 some 遍历）
  useEffect(() => {
    isStreamingRef.current = !!useChatStore.getState().streaming[activeSessionPath || ''];
  }, [messages, activeSessionPath]);
  const [btnVisible, setBtnVisible] = useState(false);
  const [btnHasNew, setBtnHasNew] = useState(false);

  // ── 固定窗口虚拟化（对标 dim）：只渲染最近 WINDOW_SIZE 条，窗口前移替换 ──
  const total = messages.length;
  const [windowStart, setWindowStart] = useState(() => Math.max(0, total - WINDOW_SIZE));
  // 会话切换：重置窗口起点到最新。否则 windowStart 沿用旧会话的滚动位置，
  // 切到新会话（≥300 条）时从中间段开始显示——「从中间截断，尾部在窗口外」。
  useEffect(() => {
    const len = (useChatStore.getState().messagesMap[activeSessionPath || ''] || []).length;
    setWindowStart(Math.max(0, len - WINDOW_SIZE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionPath]);
  const windowed = total > WINDOW_THRESHOLD;
  const maxStart = Math.max(0, total - WINDOW_SIZE);
  // 流式中窗口钉最新：startIdx 强制为 maxStart（无视用户上滚的 windowStart），
  // 最新消息（含流式尾巴）恒在窗口内——窗口化不再丢尾巴。
  const effectiveStart = streamingActive ? maxStart : windowStart;
  const startIdx = windowed ? Math.max(0, Math.min(effectiveStart, maxStart)) : 0;
  const visible = windowed ? messages.slice(startIdx, startIdx + WINDOW_SIZE) : messages;
  const windowHasMore = startIdx > 0;

  const agentRunningRef = useRef(agentRunning);
  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  const hasEarlier = !!(history && (history.pending.length > 0 || history.hasMore));
  const remaining = history
    ? history.pending.length > 0
      ? history.pending.length
      : history.hasMore
        ? -1
        : 0
    : 0;
  const hasEarlierRef = useRef(hasEarlier);
  useEffect(() => {
    hasEarlierRef.current = hasEarlier;
  }, [hasEarlier]);

  const windowedRef = useRef(windowed);
  useEffect(() => {
    windowedRef.current = windowed;
  }, [windowed]);

  // onScroll 在 mount effect 里注册一次，闭包固化；用 ref 读最新窗口值
  const windowHasMoreRef = useRef(windowHasMore);
  useEffect(() => {
    windowHasMoreRef.current = windowHasMore;
  }, [windowHasMore]);
  const maxStartRef = useRef(maxStart);
  useEffect(() => {
    maxStartRef.current = maxStart;
  }, [maxStart]);

  // ── 滚动跟随（等价旧版 followScroll）──

  const distance = () => {
    const el = messagesRef.current;
    return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
  };

  const jumpToBottom = () => {
    const el = messagesRef.current;
    if (!el) return;
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = el.scrollHeight;
    scrollPosRef.current = el.scrollTop;
    el.style.scrollBehavior = prev;
  };

  const updateBtn = () => {
    const far = distance() > BTN_SHOW;
    setBtnVisible(!followRef.current && far);
    setBtnHasNew(!followRef.current && far && !!agentRunningRef.current);
  };

  const tick = () => {
    // 恢复 MutationObserver 驱动的跳底（“尾巴不掉”版的关键）：
    // DOM 变化（消息追加/历史加载/流式更新）都触发 schedule → tick → 若在底部则跳底。
    // 之前改成“不在 tick 跳底、只靠下方 useEffect”，导致某些消息变化路径不触发跟随，
    // 表现为“尾巴掉了”。保留 updateBtn 更新按钮。
    if (followRef.current) {
      jumpToBottom();
    } else if (isStreamingRef.current && Date.now() - lastUserScrollRef.current >= AUTO_RESUME_MS) {
      // 流式中且用户已持续无滚动操作 → 自动恢复跟随（根治“窗口静止、文字在下面刷”：
      // 用户等待输出时翻过历史导致 detach，正式回复增长时 tick/useLayoutEffect 都被
      // followRef=false 挡住；onScroll 恢复需用户手动滚到底，不滚动则永不恢复）
      attach();
    }
    updateBtn();
  };

  const schedule = () => {
    if (pendingRafRef.current) return;
    pendingRafRef.current = true;
    requestAnimationFrame(() => {
      pendingRafRef.current = false;
      tick();
    });
  };

  const markUserScroll = () => {
    lastUserScrollRef.current = Date.now();
  };

  const detach = () => {
    if (!followRef.current) return;
    followRef.current = false;
    markUserScroll();
    updateBtn();
    dbgLog('scroll', `detach dist=${Math.round(distance())}`);
  };

  const attach = () => {
    followRef.current = true;
    jumpToBottom();
    updateBtn();
    dbgLog('scroll', 'attach');
  };

  const syncPos = () => {
    const el = messagesRef.current;
    const btn = btnRef.current;
    if (!el || !btn) return;
    btn.style.top = `${el.offsetTop + el.clientHeight - 46}px`;
  };

  // ── 挂载：事件监听 + 观察器（一次）──

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;

    const onScroll = () => {
      markUserScroll();
      const el0 = messagesRef.current;
      if (el0) scrollPosRef.current = el0.scrollTop;
      if (distance() <= RESUME_EPS) {
        followRef.current = true;
        // 窗口化：用户滚到底部时窗口前移到最新，让尾部消息进入窗口。
        // 否则窗口停在旧位置，最新消息永远在窗口外——「下滚看不到对话尾部」
        if (windowedRef.current && windowHasMoreRef.current) {
          setWindowStart(Math.max(0, maxStartRef.current));
        }
      }
      updateBtn();
      // 顶部懒加载：先窗口前移（store 里还有更早消息未渲染），窗口到起点后走文件懒加载
      if (el.scrollTop > TOP_LAZY_SCROLL) return;
      if (!windowHasMoreRef.current && !hasEarlierRef.current) return;
      const now = Date.now();
      if (now - lastLazyLoadRef.current < TOP_LAZY_THROTTLE) return;
      lastLazyLoadRef.current = now;
      if (windowHasMoreRef.current) {
        // React 层窗口前移（替换而非增长）：补偿滚动位置不跳视口
        const prevSH = el.scrollHeight;
        const prevST = el.scrollTop;
        setWindowStart((w) => Math.max(0, Math.min(w - LOAD_MORE, maxStartRef.current)));
        requestAnimationFrame(() => {
          const e2 = messagesRef.current;
          if (e2) e2.scrollTop = prevST + (e2.scrollHeight - prevSH);
        });
      } else if (hasEarlierRef.current) {
        void handleLoadEarlier();
      }
    };
    const onWheel = (e: WheelEvent) => {
      // 鼠标智能跟随：只在“已明确滚离底部”时才脱离跟随；底部附近向上滚（deltaY<0）
      // 不打断自动跟随，避免流式中轻轻向上滚一下就把 followRef 置 false 永久不跟随。
      markUserScroll();
      if (e.deltaY < 0 && distance() > AUTO_FOLLOW_GAP) detach();
    };
    const onMouseDown = (e: MouseEvent) => {
      // 点击滚动条区域（offsetX 超出内容宽度）且已滚离底部才脱离；点消息正文不打断跟随
      markUserScroll();
      if (e.offsetX > el.clientWidth && distance() > AUTO_FOLLOW_GAP) detach();
    };
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) touchYRef.current = t.clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      markUserScroll();
      if (t.clientY > touchYRef.current + 2) detach();
      touchYRef.current = t.clientY;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      markUserScroll();
      if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home') detach();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('keydown', onKeyDown);

    const mo = new MutationObserver(() => schedule());
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('load', schedule, true);
    const ro = new ResizeObserver(() => {
      syncPos();
      schedule();
    });
    ro.observe(el);

    syncPos();
    updateBtn();

    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('load', schedule, true);
      mo.disconnect();
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 会话切换：保存旧会话滚动位置 / 恢复滚动位置 / 复位跟随 ──

  useEffect(() => {
    const el = messagesRef.current;
    // 切走：把真实滚动位置写回缓存（此前 cacheSnapshot 恒传 0，切回时恢复 0 →
    // 停在顶部/中间、看不到尾部——「游标不在对话尾端」根因）。用 scrollPosRef
    // 记录的值，避免 useEffect 在 DOM 更新后才执行、直接读 el.scrollTop 被 clamp。
    const prevPath = prevSessionPathRef.current;
    prevSessionPathRef.current = activeSessionPath;
    if (prevPath && prevPath !== activeSessionPath) {
      const prevMsgs = useChatStore.getState().messagesMap[prevPath];
      if (prevMsgs && prevMsgs.length > 0) {
        useChatStore.getState().cacheSnapshot(prevPath, scrollPosRef.current);
      }
    }
    if (!el || !activeSessionPath) return;
    // 窗口虚拟化：切到新会话先钉到最新窗口（窗口化后精确 scrollPos 恢复不可靠）
    const sessTotal = (useChatStore.getState().messagesMap[activeSessionPath] || []).length;
    setWindowStart(Math.max(0, sessTotal - WINDOW_SIZE));
    if (windowedRef.current) {
      // 窗口化：直接跟随底部，历史位置由窗口自动承载
      followRef.current = true;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
        scrollPosRef.current = el.scrollTop;
        syncPos();
        updateBtn();
      });
      return;
    }
    const cached = useChatStore.getState().sessionMessageCache[activeSessionPath];
    if (cached && cached.messages.length > 0) {
      // 缓存命中：恢复历史位置，停在底部才继续跟随
      const pos = cached.scrollPos;
      // 无效缓存位置（历史 bug：cacheSnapshot 恒写 0）→ 直接贴底跟随，
      // 避免恢复 0 后停在顶部/中间看不到尾部
      const posInvalid = pos <= 0;
      requestAnimationFrame(() => {
        el.scrollTop = posInvalid ? el.scrollHeight : pos;
        scrollPosRef.current = el.scrollTop;
        followRef.current = posInvalid || distance() <= RESUME_EPS;
        syncPos();
        updateBtn();
        dbgLog(
          'scroll',
          `switch-restore pos=${pos}${posInvalid ? '(无效→贴底)' : ''} follow=${followRef.current} dist=${Math.round(distance())} n=${useChatStore.getState().messagesMap[activeSessionPath]?.length || 0}`,
        );
      });
    } else {
      // 无缓存：无条件跟随并直接贴底（不能只置 followRef 等 DOM 变化触发 tick——
      // 消息已渲染完成时没有 DOM 变化，tick 不跑，永远不跳底）
      followRef.current = true;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
        scrollPosRef.current = el.scrollTop;
        syncPos();
        updateBtn();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionPath]);

  // ── 窗口跟随：流式增长/用户贴底时窗口保持最近（对标 dim）──
  useEffect(() => {
    if (!windowed) return;
    if (followRef.current && total > 0) {
      // 正在底部跟随 → 窗口钉到最新；否则（用户上滚中）不移动窗口
      setWindowStart(Math.max(0, total - WINDOW_SIZE));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, total]);

  // ── 流式期间强制跟随到底（“尾巴有了”版）：useLayoutEffect 在 DOM commit 后同步跳底，
  //   再排一帧 rAF 二次校正补齐 markdown 异步测量。tick（MutationObserver）也负责跳底，
  //   双路径保证消息追加/历史加载/流式都能跟随到底，尾巴不掉。
  const AUTO_FOLLOW_GAP = 200;
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isStreaming = !!useChatStore.getState().streaming[activeSessionPath || ''];
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 诊断日志（节流）：记录跟随状态与滚动几何，排查“刷字”用
    const now = Date.now();
    if (now - lastDiagRef.current >= DIAG_INTERVAL) {
      lastDiagRef.current = now;
      dbgLog(
        'scroll',
        `effect follow=${followRef.current} streaming=${isStreaming} dist=${Math.round(dist)} ` +
          `st=${el.scrollTop} sh=${el.scrollHeight} cl=${el.clientHeight} n=${messages.length}`,
      );
    }
    if (isStreaming) {
      prevStreamingRef.current = true;
      if (dist > AUTO_FOLLOW_GAP && !followRef.current) return;
      el.scrollTop = el.scrollHeight;
      scrollPosRef.current = el.scrollTop;
      // 二次校正：不 cancel，保证执行（markdown 测量补全后补到真实底部）
      const raf = requestAnimationFrame(() => {
        const e2 = messagesRef.current;
        if (e2) {
          e2.scrollTop = e2.scrollHeight;
          scrollPosRef.current = e2.scrollTop;
          updateBtn();
        }
      });
    } else if (prevStreamingRef.current) {
      // 流式结束瞬间（streaming-plain → Markdown 切换，高度可能变化）：补一次钉底，
      // 防止“输出完了但视口停在半路”（isStreaming=false 时上方分支不再执行）
      prevStreamingRef.current = false;
      // 窗口化：流式期间 effectiveStart 被强制钉最新（无视用户上滚），结束时若回退到
      // 旧 windowStart，视口会从尾部跳回中间——「光标飘到中间、下滚看不到尾部」根因。
      // 结束瞬间把窗口钉到最新，保持流式期间的连续视觉。
      if (windowed) {
        setWindowStart(Math.max(0, total - WINDOW_SIZE));
      }
      if (followRef.current) {
        el.scrollTop = el.scrollHeight;
        scrollPosRef.current = el.scrollTop;
        dbgLog('scroll', `finalize-stick st=${el.scrollTop} sh=${el.scrollHeight}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, total, activeSessionPath]);

  // ── 加载更早（按钮 / 滚动顶部共用）──

  const handleLoadEarlier = async () => {
    const el = messagesRef.current;
    if (!el) return;
    const beforeHeight = el.scrollHeight;
    await loadEarlierBatch();
    requestAnimationFrame(() => {
      // 补偿滚动位置：新内容撑高部分不让视口跳走
      el.scrollTop += el.scrollHeight - beforeHeight;
    });
  };

  // ── 渲染 ──

  const showWelcome = messages.length === 0 && welcomePhase === 'showing';

  // #chatPanel 由 App 组装提供（含 #inputArea / #minimap 等兄弟节点）
  return (
    <>
      <div ref={messagesRef} id="messages" className="messages">
        {hasEarlier && (
          <button type="button" className="load-earlier-btn" onClick={() => void handleLoadEarlier()}>
            {remaining < 0 ? '加载更早消息' : `加载更早消息（剩余 ${remaining} 条）`}
          </button>
        )}
        {showWelcome && <WelcomeScreen />}
        {visible.map((m) => (
          <MessageBubble key={m.id || `m-${startIdx}`} msg={m} />
        ))}
      </div>
      <button
        ref={btnRef}
        id="scrollToBottomBtn"
        type="button"
        title="回到最新消息"
        aria-label="回到最新消息"
        className={`${btnVisible ? 'visible' : ''}${btnHasNew ? ' has-new' : ''}`}
        onClick={attach}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="4" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
        </button>
      {!windowed && <Minimap messagesRef={messagesRef} onNavigate={detach} />}
    </>
  );
}

// 触摸跟随判定用的起始 Y（模块级即可，组件单实例）
const touchYRef: { current: number } = { current: 0 };
