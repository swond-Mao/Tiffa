/**
 * Minimap — 消息密度滚动条（等价旧版 minimap 对象）
 *
 * - canvas 绘制：消息色块（user 宽/亮、assistant 窄/暗）+ 视口指示框
 * - 尺寸跟随 messages（ResizeObserver）、内容增删重绘（MutationObserver）、滚动重绘
 * - 点击/拖拽跳转：临时切 scrollBehavior=auto，交出跟随权（onNavigate）
 * - 可滚动性判定：scrollHeight > clientHeight + 40 才显示
 */
import { useEffect, useRef } from 'react';

interface MinimapProps {
  messagesRef: React.RefObject<HTMLDivElement>;
  /** 用户主动定位（点击/拖拽）→ 交出滚动跟随权 */
  onNavigate: () => void;
}

export default function Minimap({ messagesRef, onNavigate }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const msgs = messagesRef.current;
    const canvas = canvasRef.current;
    if (!msgs || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cssW = 14;
    let cssH = 0;
    let redrawPending = false;
    let dragging = false;
    let rafId = 0;
    let timerId = 0;
    // 色块层最后全量刷新时间：流式增长时 MO 不触发，滚动路径每 500ms 顺带全量一次
    let lastFull = 0;
    let accent = '';
    let neutral = '';
    // 离屏色块层：滚动时只 drawImage + 视口框（零布局查询），色块重绘集中在内容变化路径
    const off = document.createElement('canvas');
    const offCtx = off.getContext('2d');

    const readColors = () => {
      const styles = getComputedStyle(document.documentElement);
      accent = styles.getPropertyValue('--accent-main-000').trim();
      neutral = styles.getPropertyValue('--text-400').trim();
    };

    const drawBlocks = () => {
      // 可滚动性判定（布局属性读取集中在内容重绘路径，滚动路径不重复）
      const scrollable = msgs.scrollHeight > msgs.clientHeight + 40;
      canvas.style.display = scrollable ? 'block' : 'none';
      msgs.classList.toggle('minimap-active', scrollable);
      const w = cssW || 14;
      const h = cssH || msgs.clientHeight;
      if (h <= 0 || !offCtx) return;
      readColors();
      lastFull = Date.now();
      const dpr = window.devicePixelRatio || 1;
      off.width = Math.round(w * dpr);
      off.height = Math.round(h * dpr);
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      offCtx.clearRect(0, 0, w, h);
      const scale = h / msgs.scrollHeight;
      const userColor = accent ? `hsl(${accent})` : 'rgba(100,150,250,0.9)';
      const assistantColor = neutral ? `hsl(${neutral} / 0.45)` : 'rgba(140,140,140,0.45)';
      // 消息色块：位置/高度按 scrollContent 坐标等比映射
      const base = msgs.offsetTop;
      for (const el of Array.from(msgs.children)) {
        if (!(el instanceof HTMLElement) || !el.classList || !el.classList.contains('message')) continue;
        const y = (el.offsetTop - base) * scale;
        const bh = Math.max(el.offsetHeight * scale, 2);
        const isUser = el.classList.contains('user');
        offCtx.fillStyle = isUser ? userColor : assistantColor;
        const bw = isUser ? 8 : 6;
        offCtx.fillRect((w - bw) / 2, y, bw, bh);
      }
    };

    const draw = () => {
      const w = cssW || 14;
      const h = cssH || msgs.clientHeight;
      if (h <= 0) return;
      // 色块层节流刷新：流式增长期间滚动事件高频，但色块只需周期性重算
      if (Date.now() - lastFull > 500) drawBlocks();
      // 视口指示框：只依赖 scrollTop/scrollHeight（2 次布局读取），不遍历消息 DOM
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(off, 0, 0, w, h);
      const scale = h / msgs.scrollHeight;
      const vy = msgs.scrollTop * scale;
      const vh = Math.max(msgs.clientHeight * scale, 6);
      ctx.fillStyle = accent ? `hsl(${accent} / 0.10)` : 'rgba(100,150,250,0.10)';
      ctx.fillRect(0, vy, w, vh);
      ctx.strokeStyle = accent ? `hsl(${accent} / 0.35)` : 'rgba(100,150,250,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, vy + 0.5, w - 1, vh - 1);
    };

    const scheduleRedraw = () => {
      if (redrawPending) return;
      redrawPending = true;
      const run = () => {
        redrawPending = false;
        draw();
      };
      // 先清旧句柄再排新：避免卸载后幽灵定时器/rAF 仍对已移除的 canvas 执行 draw
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
      rafId = requestAnimationFrame(run);
      timerId = window.setTimeout(run, 100); // 兜底：rAF 在后台/隐藏页面可能不触发
    };

    const syncSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = 14;
      const h = msgs.clientHeight;
      cssW = w;
      cssH = h;
      canvas.style.top = `${msgs.offsetTop}px`;
      canvas.style.height = `${h}px`;
      canvas.style.width = `${w}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastFull = 0; // canvas 已清空：强制下一帧重画色块层
      scheduleRedraw();
    };

    const jump = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      // .messages 有 scroll-behavior: smooth，拖拽时会被动画抢，临时切 instant
      const prev = msgs.style.scrollBehavior;
      msgs.style.scrollBehavior = 'auto';
      msgs.scrollTop = ratio * (msgs.scrollHeight - msgs.clientHeight);
      msgs.style.scrollBehavior = prev;
      // 拖 minimap 也是用户主动定位 → 交出跟随权（拖到底时 scroll 监听会自动恢复）
      onNavigate();
    };

    const ro = new ResizeObserver(() => syncSize());
    ro.observe(msgs);
    const mo = new MutationObserver(() => {
      lastFull = 0; // 内容增删：下一帧全量重画色块层
      scheduleRedraw();
    });
    mo.observe(msgs, { childList: true });
    // 主题切换（documentElement class/style 变化）→ 颜色缓存失效，强制重画色块层
    const themeMo = new MutationObserver(() => {
      lastFull = 0;
      scheduleRedraw();
    });
    themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    msgs.addEventListener('scroll', scheduleRedraw, { passive: true });
    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      jump(e);
      e.preventDefault();
    });
    const onMove = (e: MouseEvent) => {
      if (dragging) jump(e);
    };
    const onUp = () => {
      dragging = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    syncSize();

    return () => {
      ro.disconnect();
      mo.disconnect();
      themeMo.disconnect();
      msgs.removeEventListener('scroll', scheduleRedraw);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas id="minimap" ref={canvasRef} />;
}
