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
import { useProcStore } from '../stores/useProcStore';
import { switchModel } from '../services/sessionController';
import type { TiffaModelInfo, TiffaModelsConfig } from '../types/tiffaDesktop';

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
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
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
    // 动态定位：显示在触发按钮上方（输入条附近场景），右对齐输入条右缘（而非视口右缘）
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const maxH = Math.min(SWITCHER_MAX_HEIGHT, window.innerHeight * 0.6);
      let top = rect.top - maxH - 8;
      if (top < 8) top = rect.bottom + 6; // 上方空间不足则从按钮下方展开
      const inputArea = document.getElementById('inputArea');
      const anchorRight = inputArea ? inputArea.getBoundingClientRect().right : window.innerWidth;
      let left = anchorRight - SWITCHER_WIDTH - 8;
      if (left < 8) left = 8;
      setPos({ left, top });
    }
    setOpen(true);
    setQuery('');
    setModels(null);
    void loadModelList();
  };

  // ── 加载模型列表（等价旧版 loadModelSwitcherList + renderModelSwitcherList 过滤）──

  const loadModelList = async () => {
    try {
      // hidden-models.json
      let hidden = new Set<string>();
      try {
        const root = (await window.tiffaDesktop.getRootPath()) as string;
        const res = (await window.tiffaDesktop.readFile(`${root}\\data\\agent\\hidden-models.json`)) as { content?: string } | undefined;
        if (res && res.content) {
          const arr = JSON.parse(res.content);
          if (Array.isArray(arr)) hidden = new Set(arr);
        }
      } catch {
        /* ignore */
      }
      // enabled-models.json 白名单（undefined = 未配置）
      let enabledModels: string[] | undefined;
      try {
        const root = (await window.tiffaDesktop.getRootPath()) as string;
        const res = (await window.tiffaDesktop.readFile(`${root}\\data\\agent\\enabled-models.json`)) as { content?: string } | undefined;
        if (res && res.content) {
          const arr = JSON.parse(res.content);
          if (Array.isArray(arr) && arr.length > 0) enabledModels = arr;
        }
      } catch {
        enabledModels = undefined;
      }
      // models.yml 用户配置
      let modelsConfigData: TiffaModelsConfig | null = null;
      try {
        const cfg = await window.tiffaDesktop.readModelsYml();
        if (cfg && !cfg.error && cfg.data) modelsConfigData = cfg.data;
      } catch {
        /* ignore */
      }

      // 引擎未就绪（含崩溃后停止重启）不调 getModels：主进程 handler 无实例会 throw
      if (!useProcStore.getState().tiffaReady) {
        setModels([]);
        return;
      }
      const result = await window.tiffaDesktop.getModels(useSessionsStore.getState().activeSessionId);
      if (!result || !result.models) {
        setModels([]);
        return;
      }
      let filtered = result.models.filter((m) => !hidden.has(m.id));
      // 白名单优先；否则按 models.yml 用户配置的模型过滤
      if (enabledModels) {
        const isCurrent = (m: TiffaModelInfo) => currentModel === m.id || currentModel === m.name;
        filtered = filtered.filter((m) => enabledModels!.includes(`${m.provider}/${m.id}`) || isCurrent(m));
      } else if (modelsConfigData && modelsConfigData.providers) {
        const userModelIds = new Set<string>();
        for (const prov of Object.values(modelsConfigData.providers)) {
          if (prov.models) for (const m of prov.models) userModelIds.add(m.id);
        }
        if (userModelIds.size > 0) {
          const currentId = currentModel;
          filtered = filtered.filter((m) => userModelIds.has(m.id) || m.id === currentId || m.name === currentId);
        }
      }
      setModels(filtered);
    } catch {
      setModels([]);
    }
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

  // 所有 hooks 已执行完毕，此条件 return 不影响 hooks 数量
  if (!label) return null;

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
        {label.length > 18 ? `${label.substring(0, 18)}…` : label}
      </button>
      {open &&
        createPortal(
          <div id="modelSwitcher" className="model-switcher" style={pos ? { left: pos.left, top: pos.top } : undefined}>
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
