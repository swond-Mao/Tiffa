/**
 * usePreviewStore — 前端预览区状态
 *
 * 为什么单独一个 store：预览条目是「跨会话的展示队列」，既不属于聊天消息流
 * （不该进模型上下文、不该被历史持久化），也不属于 UI 开关域（它有自身的
 * 去重/裁剪/归属会话规则）。塞进 useUiStore 会让那个已经 250 行的接口继续膨胀。
 *
 * 条目 id 由主进程 preview-server 颁发（registerPreview），本 store 只持有
 * 展示态；文件变化通过 `preview:changed` IPC 回推 rev，不在此轮询。
 */
import { create } from 'zustand';
import { lsGet, lsSet } from '../services/utils';

export interface PreviewItem {
  /** 主进程登记 id（同文件重复登记返回同一 id，用于去重） */
  id: string;
  /** 被预览文件的绝对路径 */
  file: string;
  /** 展示标题（通常给文件名，也可由调用方指定） */
  title: string;
  /** iframe 直接可用的回环地址 */
  url: string;
  /** 版本号：文件每变一次 +1，拼进 ?v= 击穿缓存 */
  rev: number;
  /** 归属会话稳定路径：非当前会话的预览不自动抢屏，防多会话串台 */
  sessionPath: string | null;
  /** 最近一次推送/刷新时间戳 */
  ts: number;
}

/** 同时保留的预览条目上限：超过后裁最旧的（用户要的是"看在改哪个"，不是历史仓库） */
export const MAX_PREVIEW_ITEMS = 12;

const WIDTH_KEY = 'tiffa:preview-width';
const MIN_WIDTH = 260;
/** 上限留 20vw 给聊天区：全占满会把对话完全挤没，看不到"边改边说" */
const MAX_WIDTH_RATIO = 0.8;
const DEFAULT_WIDTH_RATIO = 0.45;

export interface PreviewState {
  items: PreviewItem[];
  activeId: string | null;
  /** 面板是否展开：抢屏推送到达时自动展开；用户点「收起」后下次推送再展开 */
  visible: boolean;
  width: number;

  /**
   * 推入一条预览。同 id 视为同一目标：就地更新 rev/url 并置为活跃（不新增条目）。
   * 返回裁剪后被移除的条目 id 列表，供调用方让主进程撤监听。
   */
  /**
   * claimScreen=false 时只入队不抢屏：保留用户正在看的条目，供后台会话推送用。
   * 缺省 true（同 id 就地更新、面板自动展开等原有手感不变）。
   */
  push: (item: PreviewItem, claimScreen?: boolean) => string[];
  /** 文件变化回推：仅递增 rev，不改顺序（避免用户正在看的条目被顶走） */
  bumpRev: (id: string, rev: number) => void;
  remove: (id: string) => string | null;
  clear: () => string[];
  setActive: (id: string) => void;
  setVisible: (v: boolean) => void;
  setWidth: (px: number) => void;
}

function clampWidth(px: number): number {
  const max = Math.round(window.innerWidth * MAX_WIDTH_RATIO);
  return Math.max(MIN_WIDTH, Math.min(max, px));
}

function initialWidth(): number {
  const saved = Number(lsGet(WIDTH_KEY));
  if (Number.isFinite(saved) && saved >= MIN_WIDTH) return clampWidth(saved);
  return clampWidth(Math.round(window.innerWidth * DEFAULT_WIDTH_RATIO));
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  items: [],
  activeId: null,
  visible: false,
  width: initialWidth(),

  push: (item, claimScreen = true) => {
    const dropped: string[] = [];
    set((s) => {
      const idx = s.items.findIndex((x) => x.id === item.id);
      if (idx >= 0) {
        const items = s.items.slice();
        items[idx] = item;
        // 不抢屏时：原本没有活跃条目才接管，否则维持用户正在看的那条
        return claimScreen
          ? { items, activeId: item.id, visible: true }
          : { items, activeId: s.activeId ?? item.id };
      }
      let items = [...s.items, item];
      while (items.length > MAX_PREVIEW_ITEMS) {
        const [gone, ...rest] = items;
        if (gone) {
          dropped.push(gone.id);
          items = rest;
        } else {
          break;
        }
      }
      // 后台推送：入队可手动切看，但不顶掉当前视图
      return claimScreen
        ? { items, activeId: item.id, visible: true }
        : { items, activeId: s.activeId ?? item.id };
    });
    return dropped;
  },

  bumpRev: (id, rev) => {
    set((s) => {
      const idx = s.items.findIndex((x) => x.id === id);
      if (idx < 0) return {};
      const it = s.items[idx];
      if (!it || it.rev >= rev) return {};
      const items = s.items.slice();
      items[idx] = { ...it, rev, ts: Date.now() };
      return { items };
    });
  },

  remove: (id) => {
    const s = get();
    const idx = s.items.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    const items = s.items.filter((x) => x.id !== id);
    const nextActive =
      s.activeId === id ? (items[idx] ?? items[idx - 1] ?? items[0] ?? null)?.id ?? null : s.activeId;
    set({ items, activeId: nextActive, visible: items.length > 0 && s.visible });
    return id;
  },

  clear: () => {
    const ids = get().items.map((x) => x.id);
    set({ items: [], activeId: null });
    return ids;
  },

  setActive: (id) => set({ activeId: id }),
  setVisible: (v) => set({ visible: v }),
  setWidth: (px) => {
    const w = clampWidth(px);
    lsSet(WIDTH_KEY, String(w));
    set({ width: w });
  },
}));

/** 供非组件环境（eventRouter）读取当前条目 id 集合 */
export function previewItemIds(): string[] {
  return usePreviewStore.getState().items.map((x) => x.id);
}
