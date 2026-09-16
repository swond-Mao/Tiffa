/**
 * previewBridge — 渲染层访问主进程预览能力的唯一入口
 *
 * 为什么单独一个文件：预览的 IPC 成员是本轮新增的，preload 与 tiffaDesktop.d.ts
 * 要到维护态窗口才落。若各组件直接写 `window.tiffaDesktop?.previewX`，能力探测的
 * 分支会散落多处，类型声明补齐后还得逐个回改。这里把「可能尚未注入的可选方法」的
 * 探测收敛到一处，组件侧只看到具名函数与真实类型。
 *
 * 契约对齐 electron/modules/preview-server.ts（既有实现，勿另起炉灶）：
 *   - registerPreview(abs) → {ok:true,id,url,file,rev} | {ok:false,error}
 *     回环地址由服务端算好并直接下发，前端不再自己拼 `/p/<id>`；
 *   - fs.watch 在 registerPreview 内部挂上（按 id 去重），所以**没有**独立的
 *     watch 调用，只有 release（unregisterPreview）用来撤监听；
 *   - 变更事件 `preview:changed` 载荷是 {id,file,rev}，没有 gone 字段。
 * title / sessionPath 服务端不认识，由前端自己持有 —— 见 PreviewItem。
 */
import type { TiffaDesktopApi } from '../types/tiffaDesktop';

/** 主进程回环服务信息；服务未起时 IPC 返回 null */
export interface PreviewInfo {
  /** 形如 http://127.0.0.1:18890（端口被占时服务端会自增，故必须回查不能猜） */
  origin: string;
}

/** preview:register 的回包（透传 preview-server 的 PreviewRegisterResult） */
export interface PreviewRegisterReply {
  ok: boolean;
  id?: string;
  url?: string;
  file?: string;
  rev?: number;
  error?: string;
}

export interface PreviewChangedEvent {
  id: string;
  file: string;
  rev: number;
}

/** 本轮新增、可能尚未进 TiffaDesktopApi 声明的可选成员 */
interface PreviewDesktopApi {
  previewRegister?: (
    filePath: string,
    meta?: { title?: string; sessionPath?: string | null },
  ) => Promise<PreviewRegisterReply>;
  previewInfo?: () => Promise<PreviewInfo | null>;
  previewRelease?: (id: string) => Promise<boolean>;
  onPreviewChanged?: (cb: (e: PreviewChangedEvent) => void) => (() => void) | undefined;
}

type DesktopWithPreview = TiffaDesktopApi & PreviewDesktopApi;

/**
 * window.tiffaDesktop 由 preload 注入并在 types/tiffaDesktop.d.ts 全局声明，
 * 但运行时能力集合可能比声明更新（preload 已改、d.ts 未合入的过渡期），
 * 也可能整个桥都不在（浏览器里直接跑 renderer）。这里集中做一次收窄，
 * 对外一律暴露具名函数 + 类型守卫。
 */
function desktop(): DesktopWithPreview | null {
  const api: Partial<DesktopWithPreview> | undefined = window.tiffaDesktop;
  return api ? (api as DesktopWithPreview) : null;
}

function optMethod<K extends keyof PreviewDesktopApi>(name: K): PreviewDesktopApi[K] | null {
  const api = desktop();
  if (!api) return null;
  const fn = api[name];
  if (typeof fn !== 'function') return null;
  // 已由 typeof 确认是函数，仅丢调用签名（保留运行时检查的语义）
  return fn as unknown as NonNullable<PreviewDesktopApi[K]>;
}

/** 通道全不通时的原因文案：让用户知道是「没重启」而不是「坏了」 */
export function previewUnavailableReason(): string | null {
  if (!desktop()) return '非 Tiffa 桌面环境（缺少 tiffaDesktop 桥）';
  if (!optMethod('previewRegister')) return '预览通道未就绪：需重启应用以加载新的 preload/主进程';
  return null;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 把 IPC 回包收成 {ok:true,...} 或 {ok:false,error}。
 * 手写在前的原因：回包来自主进程（跨进程边界），字段类型不可信，必须逐字段核。
 */
function narrowRegister(r: unknown): PreviewRegisterReply {
  if (!r || typeof r !== 'object' || !('ok' in r)) return { ok: false, error: '主进程未返回预览登记结果' };
  const o = r as Record<string, unknown>;
  if (o.ok !== true) {
    return { ok: false, error: typeof o.error === 'string' && o.error ? o.error : '登记失败' };
  }
  if (typeof o.id !== 'string' || typeof o.url !== 'string') return { ok: false, error: '登记结果缺少 id/url' };
  return {
    ok: true,
    id: o.id,
    url: o.url,
    file: typeof o.file === 'string' ? o.file : undefined,
    rev: typeof o.rev === 'number' ? o.rev : undefined,
  };
}

/**
 * 登记一个文件用于预览。成功后服务端已挂好文件监听。
 * 同一路径重复登记返回同一 id（服务端幂等），调用方直接 push 即可顶到同一条目。
 */
export async function registerPreviewFile(
  file: string,
  meta?: { title?: string; sessionPath?: string | null },
): Promise<PreviewRegisterReply> {
  const fn = optMethod('previewRegister');
  if (!fn) return { ok: false, error: previewUnavailableReason() || '预览通道不可用' };
  try {
    return narrowRegister(await fn(file, meta));
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 撤掉某条目的主进程监听（关闭条目 / store 裁剪溢出时都要调，否则 watcher 只增不减） */
export function previewRelease(id: string): void {
  const fn = optMethod('previewRelease');
  if (fn) void fn(id).catch(() => { /* 撤监听失败不影响 UI，重启即清 */ });
}

/** 回环服务地址；未起时 null（调用方给可解释空态而不是白框） */
export async function getPreviewInfo(): Promise<PreviewInfo | null> {
  const fn = optMethod('previewInfo');
  if (!fn) return null;
  try {
    const r: unknown = await fn();
    if (!r || typeof r !== 'object' || !('origin' in r)) return null;
    const o = r as Record<string, unknown>;
    return typeof o.origin === 'string' ? { origin: o.origin } : null;
  } catch {
    return null;
  }
}

function isChangedEvent(e: unknown): e is PreviewChangedEvent {
  if (!e || typeof e !== 'object' || !('id' in e)) return false;
  const o = e as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.rev === 'number';
}

/** 订阅文件变更；无该通道时返回空清理函数，调用方无需分支 */
export function subscribePreviewChanged(cb: (e: PreviewChangedEvent) => void): () => void {
  const fn = optMethod('onPreviewChanged');
  if (!fn) return () => { /* noop */ };
  const off = fn((e) => {
    if (isChangedEvent(e)) cb(e);
  });
  return typeof off === 'function' ? off : () => { /* noop */ };
}

/**
 * 在系统浏览器打开当前预览。
 * 必须用服务端下发的 url 原值（含真实端口），不能拿 info.origin 再拼一次路径 ——
 * 拼错一段就是 404，而 404 页在外部浏览器里比在面板里更难解释。
 */
export function openPreviewExternally(url: string): void {
  void desktop()?.openExternal(url).catch(() => { /* 外部打开失败无副作用 */ });
}

/** iframe 地址：服务端 url + ?v=rev 击穿缓存 */
export function previewFrameSrc(url: string, rev: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${rev}`;
}
