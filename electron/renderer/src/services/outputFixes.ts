/**
 * 输出后处理修正（自 app.js 迁移）：修复裸 URL / Windows 路径链接 / 代码块语言推断
 *
 * 重要边界：路径链接化（fixBareUrls）**只作用于正文 prose**，代码块
 * （``` 围栏 / 4 空格缩进）内的内容一律原样保留——否则代码块里的
 * `cd /d C:\hospAI\SmartReview` 这类命令会被改写成 Markdown 链接语法，
 * 复制出来无法直接运行（2026-08-23 事故修复）。
 *
 * 裸命令块问题（2026-08-23 二修）：模型有时把多行命令写成**裸正文**
 * （不带 ``` 围栏）。Markdown 软换行会把连续两行合并成一行显示，命令
 * 就糊成一坨。fenceBareCommandBlocks 在链接化之前把 ≥2 行连续命令
 * 自动包进围栏（保留换行 + 免于链接化 + 可整体复制）；孤立的单行命令
 * 不包围栏（避免误伤以 cd/set 等词开头的中文散文），但同样豁免链接化。
 */

/** 推断未标注语言的代码块语言 */
export function inferCodeLanguage(code: string): string {
  if (/^\s*(function|const|let|var|import|export|require)\s/m.test(code)) {
    if (/\bReact\b|jsx|tsx|<\w+\s/.test(code)) return 'jsx';
    return 'javascript';
  }
  if (/^\s*(def |class |import |from |if __name__)/m.test(code)) return 'python';
  if (/^\s*<(!DOCTYPE|html|[a-z])/im.test(code)) return 'html';
  // CMD/批处理：.exe/.bat 调用，或整行 CMD 内联命令。
  // 必须在 css 之前——否则 `..\python\python.exe` 行首的 `.` 会被 css 正则吞掉
  if (
    /\.(exe|bat|cmd)\b/i.test(code) ||
    /^\s*(cd|dir|set|pause|cls|taskkill|tasklist|netstat|findstr|xcopy|pushd|popd|md|rd|type|net)\s*(\S.*)?$/m.test(code)
  ) {
    return 'bat';
  }
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
      // 命令行豁免链接化（孤立单行命令未包围栏，路径仍需原样保留可复制）
      out.push(isWindowsCommandLine(line) ? line : fixBareUrls(line));
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

// ── 裸命令块检测（2026-08-23 二修：两行命令被 Markdown 软换行合并）──

/**
 * 行首命令动词（CMD/PowerShell/git/包管理器等，词边界后跟参数）。
 * 参数首字符只认 ASCII（字母数字/路径/引号/开关/管道重定向符），
 * 中文开头（"cd 这个…"）不视为命令，避免散文误报。
 */
const CMD_VERB =
  /^(?:cd|dir|type|set|pause|cls|taskkill|tasklist|netstat|net|findstr|find|pushd|popd|copy|xcopy|move|md|mkdir|rd|rmdir|echo|ping|tracert|ipconfig|git|npm|npx|node|pnpm|yarn|bun|python|py|pip|bash|sh|powershell|pwsh|curl|wget|ls|cat)\b\s+[A-Za-z0-9_"'`(\\\/.&|>;?~-]/iu;

/** 命令行强信号（散文不会碰巧出现）：.exe/.bat、..\..\ 相对路径、X:\ 盘符路径 */
const CMD_STRONG_SIGNAL = /\.(exe|bat|cmd)\b|\.{1,2}[\\\/]|[A-Za-z]:[\\\/]/i;

/** 可独立成行的命令（无参数也成立） */
const CMD_STANDALONE = /^(?:pause|cls|exit|cd|dir|pwd|whoami|clear)\b$/i;

/** 行首为 Windows 盘符/相对路径：C:\x、D:/x、..\x、.\x */
const CMD_PATH_START = /^[A-Za-z]:[\\\/]|^\.{1,2}[\\\/]/;

const isWindowsCommandLine = (line: string): boolean => {
  const t = line.trim();
  if (!t || t.includes('`')) return false;
  if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\|)/.test(t)) return false; // Markdown 结构
  return CMD_STANDALONE.test(t) || CMD_VERB.test(t) || CMD_PATH_START.test(t);
};

/**
 * 裸命令块自动围栏化。
 *
 * 围栏代码块之外的连续命令行（isWindowsCommandLine）：
 * - 连续 ≥2 行 → 包进 ``` 围栏（换行保留，复制即可运行）；
 *   成块要求"至少一行含强信号"（.exe / ..\ / .\ / 盘符），避免误伤散文
 * - 孤立单行 → 不包围栏（单行"命令"误伤中文散文的风险高），但豁免路径链接化
 *
 * 必须在 fixBareUrlsOutsideCodeBlocks 之前执行——先围栏化，
 * 后续链接化自然跳过围栏内内容。逐行调用等价（正则均单行匹配）。
 */
export function fenceBareCommandBlocks(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  const flush = (buf: string[]) => {
    const hasSignal = buf.some(
      (l) => CMD_STRONG_SIGNAL.test(l) || CMD_PATH_START.test(l.trim()),
    );
    if (buf.length >= 2 && hasSignal) {
      out.push('```', ...buf, '```');
    } else {
      out.push(...buf);
    }
  };

  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let buf: string[] = [];

  for (const line of lines) {
    if (!inFence) {
      const open = line.match(FENCE_OPEN);
      if (open) {
        flush(buf);
        buf = [];
        inFence = true;
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        out.push(line);
        continue;
      }
      if (isWindowsCommandLine(line)) {
        buf.push(line);
        continue;
      }
    } else {
      out.push(line);
      const close = line.match(FENCE_CLOSE);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        inFence = false;
      }
      continue;
    }
    flush(buf);
    buf = [];
    out.push(line);
  }
  flush(buf);
  return out.join('\n');
}

/** 完整输出修正管线 */
export function applyOutputFixes(text: string): string {
  let result = text;
  try {
    // 先围栏化裸命令块（两行命令被软换行合并的问题），再跳过围栏做链接化
    result = fenceBareCommandBlocks(result);
  } catch {
    /* ignore */
  }
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
