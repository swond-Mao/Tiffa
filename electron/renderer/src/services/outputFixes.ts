/**
 * 输出后处理修正（自 app.js 迁移）：修复裸 URL / Windows 路径链接 / 代码块语言推断
 *
 * 重要边界：路径链接化（fixBareUrls）**只作用于正文 prose**，代码块
 * （``` 围栏 / 4 空格缩进）内的内容一律原样保留——否则代码块里的
 * `cd /d C:\hospAI\SmartReview` 这类命令会被改写成 Markdown 链接语法，
 * 复制出来无法直接运行（2026-08-23 事故修复）。
 */

/** 推断未标注语言的代码块语言 */
export function inferCodeLanguage(code: string): string {
  if (/^\s*(function|const|let|var|import|export|require)\s/m.test(code)) {
    if (/\bReact\b|jsx|tsx|<\w+\s/.test(code)) return 'jsx';
    return 'javascript';
  }
  if (/^\s*(def |class |import |from |if __name__)/m.test(code)) return 'python';
  if (/^\s*<(!DOCTYPE|html|[a-z])/im.test(code)) return 'html';
  if (/^\s*[.#@[]|\{[\s\S]*:[\s\S]*\}/m.test(code)) return 'css';
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\s/im.test(code)) return 'sql';
  if (/^\s*(package |import |func |type |var )/m.test(code)) return 'go';
  if (/^\s*(fn |let |mut |impl |use )/m.test(code)) return 'rust';
  if (/^\s*<\?xml/m.test(code)) return 'xml';
  if (/^\s*\[/.test(code) && /=/.test(code)) return 'toml';
  if (/^\s*[\w.-]+\s*:/m.test(code) && !/[{;]/.test(code.slice(0, 200))) return 'yaml';
  return '';
}

export function fixCodeBlockLanguages(text: string): string {
  return text.replace(/(^|\n)```\s*\n([\s\S]*?)```/g, (match, prefix: string, content: string) => {
    const lang = inferCodeLanguage(content);
    return `${prefix}\`\`\`${lang}\n${content}\`\`\``;
  });
}

/** 裸链接 / 本地路径链接化（tiffa-local:// 协议，点击由 handleMessageLinkClick 处理） */
export function fixBareUrls(text: string): string {
  const protectedLinks: string[] = [];
  let result = text.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (m, label: string, url: string) => {
    const idx = protectedLinks.length;
    protectedLinks.push(m);
    return `\x00LINK${idx}\x00`;
  });
  // 转换 file:/// Markdown 链接 [文字](file:///X:/path) → tiffa-local://（反斜杠转正斜杠）
  result = result.replace(/\[([^\]]*)\]\(file:\/\/\/([^\s)]+)\)/g, (m, label: string, filePath: string) => {
    const decoded = decodeURIComponent(filePath).replace(/\\/g, '/');
    return `[${label}](tiffa-local://${decoded})`;
  });
  result = result.replace(
    /(^|[\s(\uff08])(https?:\/\/([\w.-]+\.[\w]{2,}(?:\/[\w./?#&=+%@!~:*-]*)?))(?=[\s),，;；。！？）"'\\u4e00-\\u9fff]|$)/gm,
    (match, prefix: string, url: string, domain: string) => `${prefix}[${domain}](${url})`,
  );
  // 自动链接化 Windows 本地路径：X:\path（允许中文目录名，反斜杠转正斜杠放 URL）
  result = result.replace(
    /(^|[\s(\uff08\uff0c，;；。！？）"])([A-Z]:[\\/][^\s)\]'",;；，。！？]+)/gm,
    (match, prefix: string, path: string) => {
      const urlPath = path.replace(/\\/g, '/');
      return `${prefix}[${path}](tiffa-local://${urlPath})`;
    },
  );
  result = result.replace(/\x00LINK(\d+)\x00/g, (m, idx: string) => protectedLinks[parseInt(idx, 10)]);
  return result;
}

/** 围栏代码块起始行（≤3 空格缩进 + ≥3 个 ` 或 ~） */
const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
/** 围栏代码块结束行（仅围栏符号 + 空白） */
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/;

/**
 * 只对正文（prose）行执行 fixBareUrls，围栏代码块内的行原样保留。
 *
 * 逐行状态机实现（不依赖"围栏必须闭合"）：流式输出中开围栏后到消息结束
 * 的所有行都受保护，天然兼容未闭合的 ``` 片段。fixBareUrls 内部正则均为
 * 单行匹配（^/$ + m 标志），逐行调用与整段调用结果等价。
 */
export function fixBareUrlsOutsideCodeBlocks(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    if (!inFence) {
      const open = line.match(FENCE_OPEN);
      if (open) {
        inFence = true;
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        out.push(line);
        continue;
      }
      out.push(fixBareUrls(line));
    } else {
      const close = line.match(FENCE_CLOSE);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        inFence = false;
      }
      out.push(line);
    }
  }
  return out.join('\n');
}

/** 完整输出修正管线 */
export function applyOutputFixes(text: string): string {
  let result = text;
  try {
    result = fixBareUrlsOutsideCodeBlocks(result);
  } catch {
    /* ignore */
  }
  try {
    // 仅改围栏 info 行（补语言标注），不动代码内容，可作用于全文
    result = fixCodeBlockLanguages(result);
  } catch {
    /* ignore */
  }
  return result;
}
