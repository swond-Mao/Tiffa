/**
 * ThemeToggleButton — 左下角主题循环按钮（等价旧版 setupThemeToggle + updateThemeIcons + updateHljsTheme）
 *
 * 点击循环：system → 切到 dark（脱离 system）/ dark → light / light → dark
 * 同时切换 hljs 双主题（hljs-dark/hljs-light 的 disabled）
 */
import { useState } from 'react';

const LS_MODE_KEY = 'tiffa-theme-mode';

/** 切换 hljs 双主题（等价旧版 updateHljsTheme） */
function updateHljsTheme(resolvedMode: string): void {
  const dark = document.getElementById('hljs-dark') as HTMLLinkElement | null;
  const light = document.getElementById('hljs-light') as HTMLLinkElement | null;
  if (dark) dark.disabled = resolvedMode !== 'dark';
  if (light) light.disabled = resolvedMode !== 'light';
}

/** 切换月亮/太阳图标（等价旧版 updateThemeIcons） */
function updateThemeIcons(resolvedMode: string): void {
  const moon = document.querySelector('.icon-moon') as HTMLElement | null;
  const sun = document.querySelector('.icon-sun') as HTMLElement | null;
  if (moon) moon.style.display = resolvedMode === 'dark' ? '' : 'none';
  if (sun) sun.style.display = resolvedMode === 'light' ? '' : 'none';
}

export default function ThemeToggleButton() {
  const [, force] = useState(0);

  const cycle = () => {
    const win = window as unknown as {
      resolveMode?: (mode: string) => string;
      setThemeMode?: (mode: string) => void;
    };
    let currentMode = 'system';
    try {
      currentMode = localStorage.getItem(LS_MODE_KEY) || 'system';
    } catch {
      /* ignore */
    }
    // 快速按钮行为：system → 切到 dark（脱离 system）/ dark → light / light → dark
    let next: string;
    if (currentMode === 'system') {
      next = win.resolveMode && win.resolveMode('system') === 'dark' ? 'light' : 'dark';
    } else {
      next = currentMode === 'light' ? 'dark' : 'light';
    }
    win.setThemeMode?.(next);
    const resolved = win.resolveMode ? win.resolveMode(next) : next;
    updateThemeIcons(resolved);
    updateHljsTheme(resolved);
    force((x) => x + 1);
  };

  return (
    <button type="button" className="project-btn footer-btn" id="btnTheme" title="切换主题" onClick={cycle}>
      <svg className="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      <svg className="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'none' }}>
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    </button>
  );
}
