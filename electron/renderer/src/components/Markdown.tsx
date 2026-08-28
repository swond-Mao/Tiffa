/**
 * Markdown — react-markdown + remark-gfm 封装（等价旧版 marked + 代码块增强）
 *
 * - 文本先过 applyOutputFixes（裸链接 / Windows 路径链接化 / 代码块语言推断）
 * - 链接点击委托 handleMessageLinkClick（本地路径 openPath、外部 openExternal）
 * - 代码块：懒高亮（IntersectionObserver rootMargin 300px，进入视口才 hljs）、
 *   高度 >150px 自动折叠（.collapsible-pre-wrap + .code-toggle-btn）、复制按钮
 * - urlTransform 放行 http/https/tiffa-local/file/盘符绝对路径，其余协议（如
 *   javascript:）一律丢弃（等价旧版 sanitizeHtml 的链接消毒）
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { applyOutputFixes } from '../services/outputFixes';
import { copyText, handleMessageLinkClick } from '../services/utils';
import MermaidDiagram from './MermaidDiagram';
import DOMPurify from 'dompurify';

/** 链接协议白名单（等价旧版 sanitizeHtml 的 javascript: 拦截） */
function tiffaUrlTransform(url: string): string {
  if (!url) return '';
  if (/^(https?:|tiffa-local:|file:)/i.test(url)) return url;
  if (/^[A-Za-z]:[\\/]/.test(url)) return url;
  return '';
}

/** ReactNode → 纯文本（取 code 内容的文本） */
function stringifyNode(children: ReactNode): string {
  if (children == null) return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(stringifyNode).join('');
  return '';
}

const COPY_BTN_STYLE: CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  padding: '2px 8px',
  fontSize: 11,
  background: 'var(--bg-hover)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  zIndex: 2,
};

/**
 * 富 HTML 活渲染（```html / ```htm 代码块）：
 * DOMPurify 默认配置拦截 script / 事件属性 / javascript: 链接 / iframe 等 XSS，
 * 再叠加 CSS 守卫剥离内联 style 里的危险构造（expression / 外部 url 等——
 * 现代 Chromium 里本不执行，仍按防呆标准堵死）。
 */
function splitDeclarations(style: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote: string | null = null;
  let cur = '';
  for (const ch of style) {
    if (inQuote) { cur += ch; if (ch === inQuote) inQuote = null; continue; }
    if (ch === '"' || ch === "'") { inQuote = ch; cur += ch; continue; }
    if (ch === '(') { depth++; cur += ch; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); cur += ch; continue; }
    if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** 内联 style 二次消毒：剥离 expression / 外部 url / 危险协议，保留合法 CSS */
function cleanCssStyle(style: string): string {
  if (typeof style !== 'string') return style;
  return splitDeclarations(style)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      if (/expression\s*\(|behavior\s*:|javascript\s*:|vbscript\s*:/i.test(s)) return false;
      const m = s.match(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/i);
      if (m) {
        const arg = m[2].trim();
        if (/^(https?:|ftp:|file:|javascript:|vbscript:)/i.test(arg) || arg.startsWith('//')) return false;
      }
      return true;
    })
    .join('; ');
}

let _purify: any = null;
function getPurify(): any {
  if (typeof window === 'undefined') return null;
  if (!_purify) {
    _purify = DOMPurify(window);
    _purify.addHook('afterSanitizeAttributes', (node: Element) => {
      const style = node.getAttribute('style');
      if (!style) return;
      const cleaned = cleanCssStyle(style);
      if (cleaned) node.setAttribute('style', cleaned);
      else node.removeAttribute('style');
    });
  }
  return _purify;
}

function LiveHtml({ code }: { code: string }) {
  const html = useMemo(() => {
    const p = getPurify();
    if (!p) return '';
    try {
      return p.sanitize(code);
    } catch {
      return '';
    }
  }, [code]);
  if (!html) {
    // 无 DOM / 消毒失败：退化为代码显示（安全兜底）
    return <pre className="live-html-fallback"><code>{code}</code></pre>;
  }
  return <div className="tiffa-live-html" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * 代码块（pre 的自定义渲染）：
 * - 懒高亮：IntersectionObserver 进入视口（提前 300px）才执行 hljs；
 *   流式内容变化时清掉旧高亮回到纯文本，视口内自动重新高亮（与旧版行为一致）
 * - 高折叠：进入视口时测量，>150px 包 .collapsible-pre-wrap + 展开/收起按钮
 * - 复制按钮：右上角（code 块级复制）
 */
function PreBlock({ children }: { children?: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hl, setHl] = useState<{ raw: string; html: string } | null>(null);
  const [isTall, setIsTall] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const codeEl = children as ReactElement<{ className?: string; children?: ReactNode }> | null;
  const codeClass = codeEl?.props?.className || '';
  const rawText = stringifyNode(codeEl?.props?.children);
  const lang = (codeClass.match(/language-(\S+)/) || [])[1] || '';

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pre = wrap.querySelector('pre');
    const code = wrap.querySelector('code');
    if (!pre || !code) return;

    const highlight = () => {
      if (!rawText) return;
      try {
        const html =
          lang && window.tiffaDesktop.hljs.getLanguage(lang)
            ? window.tiffaDesktop.hljs.highlight(rawText, { language: lang }).value
            : window.tiffaDesktop.hljs.highlightAuto(rawText).value;
        setHl({ raw: rawText, html });
      } catch {
        /* 高亮失败保持原文 */
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        // 进入视口才测高折叠（避免与 content-visibility 冲突）
        if (pre.scrollHeight > 150) setIsTall(true);
        highlight();
      },
      { root: null, rootMargin: '300px' },
    );
    io.observe(pre);
    return () => {
      io.disconnect();
      setHl(null);
    };
  }, [rawText, lang]);

  const showHl = hl && hl.raw === rawText;

  // mermaid 代码块：交给图表组件渲染（失败时组件内兜底显示原始代码）
  if (lang === 'mermaid') {
    return <MermaidDiagram code={rawText} />;
  }

  // 富 HTML 代码块（```html / ```htm）：消毒后活渲染
  if (lang === 'html' || lang === 'htm') {
    return <LiveHtml code={rawText} />;
  }


  return (
    <div ref={wrapRef} className={isTall ? 'collapsible-pre-wrap' : undefined}>
      <pre
        className={isTall && !open ? 'collapsed' : undefined}
        style={{ position: 'relative' }}
      >
        <button
          type="button"
          className="copy-btn"
          style={COPY_BTN_STYLE}
          title="复制代码"
          onClick={(e) => {
            e.stopPropagation();
            if (!rawText) return;
            copyText(rawText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? '已复制!' : '复制'}
        </button>
        {showHl ? (
          <code className={codeClass} dangerouslySetInnerHTML={{ __html: hl.html }} />
        ) : (
          children
        )}
      </pre>
      {isTall && (
        <button type="button" className="code-toggle-btn" onClick={() => setOpen(!open)}>
          {open ? '收起代码' : '展开代码'}
        </button>
      )}
    </div>
  );
}

interface MarkdownProps {
  text: string;
  className?: string;
}

/**
 * Markdown 正文组件：memo 优化——流式期间 text 变化才重渲染。
 */
export default memo(function Markdown({ text, className }: MarkdownProps) {
  const fixed = useMemo(() => applyOutputFixes(text), [text]);
  return (
    <div className={className || 'markdown-body'} onClick={(e) => handleMessageLinkClick(e as unknown as MouseEvent)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={tiffaUrlTransform} components={{ pre: PreBlock }}>
        {fixed}
      </ReactMarkdown>
    </div>
  );
});
