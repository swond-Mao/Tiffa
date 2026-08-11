/**
 * StartupRitual — 启动剧本（等价旧版 init 中的遮罩控制段）
 *
 * - 剧本固定 11.5s 播完：4 句字幕各按时间轴切换，进度条匀速到 95%
 * - 末句停留 0.8s 后主题词渐显（.revealed）
 * - 真实加载：isReady 轮询（最多 20s），未就绪字幕「棋局未启，请稍候…」
 * - 加载完成（或超时兜底）→ 进度条 100% → fade-out → 1.4s 后移除
 * - 兜底：加载再快也得等剧本播完（含主题词浮现）才淡出
 * - 完成后：恢复 lastModel + 聚焦输入框（等价旧版 init 收尾）
 */
import { useEffect } from 'react';
import { restoreLastModelIfNeeded } from '../services/sessionController';

/** 启动剧本：字幕 + 进度条按固定节奏播放，与真实加载完全解耦 */
const SCRIPT = [
  { label: '夜色将尽，晨光初透', end: 2000 },
  { label: '静水深流，暗涌潜行', end: 4000 },
  { label: '行囊在肩，天地为卷', end: 6000 },
  { label: '灯火已明，门扉待启', end: 8500 },
];
const SCRIPT_DURATION = 11500;
const TITLE_REVEAL_DELAY = 800;
const MAX_READY_WAIT = 20000;
const FADE_OUT_WAIT = 1400;

export default function StartupRitual() {
  useEffect(() => {
    const overlay = document.getElementById('startupOverlay');
    if (!overlay) return;
    const t0 = Date.now();
    const progressBar = document.getElementById('startupProgressBar') as HTMLElement | null;
    const statusEl = document.getElementById('startupStatus') as HTMLElement | null;
    const titleEl = document.querySelector('.startup-title') as HTMLElement | null;
    let titleRevealed = false;
    let scriptIdx = 0;
    let disposed = false;

    // 剧本播放器：每 100ms 按固定时间轴推进字幕与进度条（封顶 95%）
    const ticker = setInterval(() => {
      if (!overlay.isConnected || disposed) {
        clearInterval(ticker);
        return;
      }
      const elapsed = Date.now() - t0;
      const pct = Math.min(95, (elapsed / SCRIPT_DURATION) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
      while (scriptIdx < SCRIPT.length && elapsed >= SCRIPT[scriptIdx].end) {
        if (statusEl) statusEl.textContent = SCRIPT[scriptIdx].label;
        scriptIdx++;
      }
      if (!titleRevealed && elapsed >= SCRIPT[SCRIPT.length - 1].end + TITLE_REVEAL_DELAY) {
        titleRevealed = true;
        if (titleEl) titleEl.classList.add('revealed');
        // 末句舒缓淡出，与主题词交接：先冻结 opacity，下一帧置 0 触发过渡
        if (statusEl) {
          const curOpacity = getComputedStyle(statusEl).opacity;
          statusEl.style.opacity = curOpacity;
          statusEl.classList.add('fading');
          setTimeout(() => {
            statusEl.style.opacity = '0';
          }, 30);
        }
      }
      if (elapsed >= SCRIPT_DURATION) clearInterval(ticker);
    }, 100);

    // ── 遮罩收尾：淡出时机 = 真实加载完成，剧本只是背景演出 ──
    void (async () => {
      // 内核未就绪：轮询等待（最多 20 秒），字幕提示，不无限卡死
      let ready = false;
      try {
        ready = await window.tiffaDesktop.isReady(null);
      } catch {
        ready = false;
      }
      if (!ready && !disposed) {
        if (statusEl) statusEl.textContent = '棋局未启，请稍候…';
        const start = Date.now();
        while (!ready && Date.now() - start < MAX_READY_WAIT && !disposed) {
          await new Promise((r) => setTimeout(r, 300));
          try {
            ready = await window.tiffaDesktop.isReady(null);
          } catch {
            ready = false;
          }
        }
      }

      // 兜底：加载再快，也得等启动剧本全部播完（含主题词浮现）才淡出
      const scriptElapsed = Date.now() - t0;
      if (scriptElapsed < SCRIPT_DURATION) {
        await new Promise((r) => setTimeout(r, SCRIPT_DURATION - scriptElapsed));
      }
      if (disposed || !overlay.isConnected) return;

      if (progressBar) progressBar.style.width = '100%';
      overlay.classList.add('fade-out');
      // 等遮罩过渡(1s)与星光溶出(1.2s)都走完再移除
      await new Promise((r) => setTimeout(r, FADE_OUT_WAIT));
      if (disposed) return;
      overlay.remove();

      // 收尾：恢复 lastModel + 聚焦输入框
      if (ready) void restoreLastModelIfNeeded();
      requestAnimationFrame(() => {
        const ta = document.querySelector('#inputArea textarea') as HTMLElement | null;
        if (ta) ta.focus();
      });
    })();

    return () => {
      disposed = true;
      clearInterval(ticker);
    };
  }, []);

  return null;
}
