/**
 * ThemeCycleButton — 左下角主题预设循环按钮
 *
 * 点击循环切换 7 套主题预设（eucalyptus → claude → breeze → sakura → ocean → dracula → obsidian），
 * 调用 themes.js 的 setThemePreset（内部 applyThemeToDOM 会重建 style 到 head 末尾，保证生效）。
 * 按钮显示当前预设名的首字母缩写。
 */
import { useState } from 'react';

interface ThemePresetMeta {
  id: string;
  name: string;
}

export default function ThemeCycleButton() {
  const [, force] = useState(0);

  const cycle = () => {
    const win = window as unknown as {
      THEME_PRESETS?: ThemePresetMeta[];
      setThemePreset?: (id: string) => void;
      getCurrentTheme?: () => { presetId: string };
    };
    const presets = win.THEME_PRESETS || [];
    if (presets.length === 0 || !win.setThemePreset) return;
    const current = win.getCurrentTheme ? win.getCurrentTheme().presetId : '';
    const idx = presets.findIndex((p) => p.id === current);
    const next = presets[(idx + 1) % presets.length];
    win.setThemePreset(next.id);
    force((x) => x + 1);
  };

  const current = (window as unknown as { getCurrentTheme?: () => { presetId: string; name?: string } })
    .getCurrentTheme?.().presetId || '';
  const presets = (window as unknown as { THEME_PRESETS?: ThemePresetMeta[] }).THEME_PRESETS || [];
  const cur = presets.find((p) => p.id === current);
  const label = cur ? cur.name.substring(0, 1).toUpperCase() : 'T';

  return (
    <button
      type="button"
      className="project-btn footer-btn"
      id="btnThemeCycle"
      title={`主题循环（当前：${cur ? cur.name : 'Eucalyptus'}）`}
      onClick={cycle}
    >
      <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
    </button>
  );
}
