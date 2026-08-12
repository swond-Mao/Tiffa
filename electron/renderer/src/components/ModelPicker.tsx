/**
 * ModelPicker — 模型快速切换下拉（等价旧版 setupModelSwitcher + renderModelSwitcherList）
 *
 * - 触发按钮内部计算当前模型标签（sessionModelMap 优先），可自定义 className
 *   （顶栏 titlebar-model / 输入条 input-btn 均可）
 * - 点击展开：搜索框自动聚焦，Esc/外部点击关闭；下拉显示在触发按钮上方
 * - 过滤链：hidden-models.json → enabled-models.json 白名单（配置时）
 *   → models.yml 用户配置模型 → 搜索词
 * - 按供应商分组渲染，当前模型高亮；点击调用 switchModel（每会话记忆）
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useUiStore } from '../stores/useUiStore';
import { switchModel, getModelListCached } from '../services/sessionController';
import type { TiffaModelInfo } from '../types/tiffaDesktop';

const SWITCHER_WIDTH = 320;
const SWITCHER_MAX_HEIGHT = 420;

interface ModelPickerProps {
  /** 触发器类名（默认 titlebar-model；输入条场景传 input-btn） */
  className?: string;
}

export default function ModelPicker({ className }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<TiffaModelInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeSessionPath = useSessionsStore((s) => s.activeSessionPath);
  const sessionModelMap = useSessionsStore((s) => s.sessionModelMap);
  const currentModel = useUiStore((s) => s.currentModel);
  const currentProvider = useUiStore((s) => s.currentProvider);

  // 每会话模型记忆优先（等价旧版 renderModelLabel 的 sessionModelMap 分支）
  const remembered = activeSessionPath ? sessionModelMap[activeSessionPath] : null;
  const label = remembered
    ? remembered.modelId
    : currentModel && currentModel !== '--'
      ? currentModel
      : '';
  const provider = remembered ? remembered.provider : currentProvider;

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    // 动态定位：优先在触发按钮上方展开（输入条在底部时自然向上），
    // 按钮贴近视口顶部时才改为向下展开。用 bottom/top 直接贴住按钮，
    // 菜单高度自适应内容（maxHeight 仅作上限），避免固定高度导致的悬空/溢出。
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const vh = window.innerHeight;
      const margin = 8;
      const spaceAbove = rect.top - margin;
      const spaceBelow = vh - rect.bottom - margin;
      const maxH = Math.min(SWITCHER_MAX_HEIGHT, window.innerHeight * 0.6);
      const inputArea = document.getElementById('inputArea');
      const anchorRight = inputArea ? inputArea.getBoundingClientRect().right : window.innerWidth;
      let left = anchorRight - SWITCHER_WIDTH - 8;
      if (left < 8) left = 8;
      if (spaceAbove >= 220 || spaceAbove >= spaceBelow) {
        // 向上展开：菜单底边贴按钮顶边，向上生长
        setPos({ left, bottom: vh - rect.top + margin, maxHeight: Math.min(maxH, spaceAbove) });
      } else {
        // 向下展开：菜单顶边贴按钮底边，向下生长
        setPos({ left, top: rect.bottom + margin, maxHeight: Math.min(maxH, spaceBelow) });
      }
    }
    setOpen(true);
    setQuery('');
    setModels(null);
    // 死列表缓存（sessionController）：命中秒回；首次无缓存才触发一次加载（in-flight 去重）
    void getModelListCached().then((list) => setModels(list ?? []));
  };

  // ── 外部点击 / Esc 关闭 ──

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      const sw = document.getElementById('modelSwitcher');
      if (sw && sw.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    // 搜索框聚焦（延迟到下拉渲染后）
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // ── 搜索过滤 + 分组 ──

  const q = query.trim().toLowerCase();
  const visible = models
    ? q
      ? models.filter((m) => {
          const name = (m.name || m.id || '').toLowerCase();
          const prov = (m.provider || '').toLowerCase();
          return name.includes(q) || prov.includes(q);
        })
      : models
    : null;

  const groups: Array<{ provider: string; models: TiffaModelInfo[] }> = [];
  if (visible) {
    const map: Record<string, TiffaModelInfo[]> = {};
    for (const m of visible) {
      const prov = m.provider || '其他';
      if (!map[prov]) map[prov] = [];
      map[prov].push(m);
    }
    for (const [provider, list] of Object.entries(map)) groups.push({ provider, models: list });
  }

  const activeKey = `${provider || ''}/${currentModel}`;

  // 按钮总是显示（有活动会话即可）：指针优先，无记忆/未就绪时显示“选择模型”占位，发送时才物化。
  // 原条件 `!label && tiffaReady` 会误隐藏：tiffaReady 是“任意实例就绪”，
  // 切到无记忆会话时 label 为空但别的实例已就绪 → 按钮消失（用户反馈的 bug）。
  if (!activeSessionPath) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        id="currentModel"
        className={className || 'titlebar-model'}
        title={provider ? `${provider} / ${label}` : label}
        onClick={(e) => {
          e.stopPropagation();
          void toggle();
        }}
      >
        {label.length > 18 ? `${label.substring(0, 18)}…` : label || '选择模型'}
      </button>
      {open &&
        createPortal(
          <div id="modelSwitcher" className="model-switcher" style={pos ? { left: pos.left, top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', maxHeight: pos.maxHeight } : undefined}>
            <div className="model-switcher-header">切换模型</div>
            <div className="model-switcher-search">
              <input
                ref={searchRef}
                type="text"
                placeholder="搜索模型..."
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const first = document.querySelector('#modelSwitcher .model-item:not(.empty)') as HTMLElement | null;
                    if (first) first.click();
                  }
                }}
              />
            </div>
            <div className="model-switcher-list">
              {models === null && <div className="model-item loading">加载中...</div>}
              {models !== null && visible && visible.length === 0 && <div className="model-item empty">无匹配模型</div>}
              {groups.map((g) => (
                <div key={g.provider}>
                  <div className="model-switcher-group-header">{g.provider}</div>
                  {g.models.map((m) => {
                    const isActive = activeKey === `${m.provider || ''}/${m.id}` || currentModel === m.name;
                    return (
                      <div
                        key={`${g.provider}/${m.id}`}
                        className={`model-item${isActive ? ' active' : ''}`}
                        onClick={() => {
                          void switchModel(m.provider || '', m.id);
                          setOpen(false);
                        }}
                      >
                        {m.name || m.id}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
