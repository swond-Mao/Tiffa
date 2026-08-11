/**
 * 输出后处理修正（自 app.js 迁移）：修复裸 URL / Windows 路径链接 / 代码块语言推断
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

/** 完整输出修正管线 */
export function applyOutputFixes(text: string): string {
  let result = text;
  try {
    result = fixBareUrls(result);
  } catch {
    /* ignore */
  }
  try {
    result = fixCodeBlockLanguages(result);
  } catch {
    /* ignore */
  }
  return result;
}
