/**
 * 通用工具函数（自 app.js 迁移）
 */

/** 从 sessionPath 提取 sessionId（UUID） */
export function extractSessionId(sessionPath?: string | null): string | null {
  if (!sessionPath) return null;
  const match = sessionPath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : null;
}

/** 反查：通过 sessionId 在活跃 tab 中找 sessionPath（后台事件路由用）。
 *  注意：不做 activeSessionId 短路——activeSessionPath 可能因切换中断/竞态与
 *  activeSessionId 不一致（残留），短路会把事件归属到错误视图（跨会话流出根因）。 */
export function findSessionPathById(sessionId: string, activeSessionPaths: string[]): string | null {
  if (!sessionId) return null;
  for (const p of activeSessionPaths) {
    if (extractSessionId(p) === sessionId) return p;
  }
  return null;
}

/** 从 sessionPath 提取所属项目的编码目录名（--E--...-- 段） */
export function dirNameFromSessionPath(sessionPath?: string | null): string | null {
  if (!sessionPath || sessionPath.startsWith('__new__')) return null;
  const parts = sessionPath.split(/[\\/]/);
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i];
    if (seg && seg.startsWith('--') && seg.endsWith('--')) return seg;
  }
  return null;
}

/** cwdKey：规范化路径用于比较（\→/，去尾 /，小写） */
export function cwdKey(p?: string | null): string {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** relTime：人性化相对时间 */
export function relTime(dateStr?: string | number | null): string {
  if (!dateStr) return '';
  const now = Date.now();
  let ts: number;
  if (typeof dateStr === 'number') ts = dateStr;
  else if (typeof dateStr === 'string') ts = new Date(dateStr).getTime();
  else return '';
  if (isNaN(ts)) return '';
  const diff = now - ts;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(month / 12)} 年前`;
}

export function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 简易 HTML 消毒：移除 script/危险标签、事件属性、javascript: URL */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const dangerous = tpl.content.querySelectorAll('script,style,link,meta,base,object,embed,form');
  dangerous.forEach((el) => el.remove());
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
  const toClean: Element[] = [];
  while (walker.nextNode()) toClean.push(walker.currentNode as Element);
  for (const el of toClean) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || attr.value.trim().toLowerCase().startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return tpl.innerHTML;
}

export const pathUtil = {
  basename: (p?: string | null): string => (p || '').split(/[\\/]/).pop() || '',
  extname: (p?: string | null): string => {
    const name = pathUtil.basename(p);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(dot) : '';
  },
};

/** 诊断日志：落 data/logs/renderer.log，静默失败不影响 UI */
export function dbgLog(tag: string, msg: unknown): void {
  try {
    window.tiffaDesktop.rendererLog(tag, String(msg));
  } catch {
    /* ignore */
  }
}

/** localStorage 安全读写 */
export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 复制到剪贴板（IPC 优先，降级 navigator.clipboard） */
export function copyText(text: string): void {
  try {
    window.tiffaDesktop.clipboardWriteText(text);
  } catch {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

/** 拦截消息区链接点击：本地路径 openPath、外部 http openExternal */
export function handleMessageLinkClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const link = target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href) return;
  if (href.startsWith('tiffa-local://')) {
    e.preventDefault();
    const raw = decodeURIComponent(href.replace('tiffa-local://', ''));
    window.tiffaDesktop.openPath(raw.replace(/\//g, '\\'));
    return;
  }
  if (href.startsWith('file:///')) {
    e.preventDefault();
    const raw = decodeURIComponent(href.replace('file:///', ''));
    window.tiffaDesktop.openPath(raw.replace(/\//g, '\\'));
    return;
  }
  if (/^[A-Z]:[\\/]/.test(href)) {
    e.preventDefault();
    window.tiffaDesktop.openPath(href);
    return;
  }
  if (href.startsWith('http://') || href.startsWith('https://')) {
    e.preventDefault();
    window.tiffaDesktop.openExternal(href);
  }
}

// ── 内核消息本地化 ──

/**
 * 内核英文提示 → 中文（渲染层统一过滤，不改主进程/内核）。
 * 返回 { text, level, isTooShort }：
 * - text：本地化后的文本（无法识别的保留原文）
 * - level：建议的 toast 级别（undefined = 保持原级别）
 * - isTooShort：是否为「内容过短无需压缩」类（应显示为 info 而非 error）
 */
export function localizeKernelMessage(raw: string): {
  text: string;
  level?: 'info' | 'warning' | 'error';
  isTooShort: boolean;
} {
  const msg = String(raw || '').trim();
  const low = msg.toLowerCase();
  // 1) 压缩「内容过短/无需压缩」类：不是错误，只是告知，必须 info 级
  const tooShortPattern =
    /(too short|too few|not enough|nothing to|nothing left|no (content|messages|history|text)|skip(ping)?)/i;
  if (/compact|compress|context|history|message/.test(low) && tooShortPattern.test(low)) {
    return { text: '对话内容较短，无需压缩', level: 'info', isTooShort: true };
  }
  if (/too short|too few|not enough|nothing to (compact|compress|summarize)|no (content|messages|history) to/.test(low)) {
    return { text: '对话内容较短，无需压缩', level: 'info', isTooShort: true };
  }
  // 2) MCP 准备/启动类
  if (/prepar.*mcp|mcp.*(prepar|start|connect|launch|initial)/i.test(low)) {
    return { text: '正在准备 MCP 服务…', isTooShort: false };
  }
  // 3) 模型切换类
  if (/switching (the )?model|changing model|model (switch|change)/i.test(low)) {
    return { text: '正在切换模型…', isTooShort: false };
  }
  // 4) 压缩失败类（保留原文信息，加中文前缀）
  if (/(compaction|compact).*(failed|error)|failed to (compact|compress)/i.test(low)) {
    return { text: `压缩失败：${msg}`, level: 'error', isTooShort: false };
  }
  return { text: msg, isTooShort: false };
}
