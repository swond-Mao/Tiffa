/**
 * outputFixes — 代码块保护回归测试
 *
 * 背景（2026-08-23）：fixBareUrls 会把正文中的 Windows 路径自动链接化
 * （[C:\path](tiffa-local://...)），但未排除代码块——代码块里的
 * `cd /d C:\hospAI\SmartReview ..\python\python.exe server.py` 也被改写成
 * Markdown 链接语法，用户点"复制"复制出来的命令无法直接运行。
 * 修复：路径链接化只作用于围栏代码块之外的正文。本测试防止该行为回归。
 */
import { describe, expect, it } from 'vitest';
import { applyOutputFixes, fixBareUrls, fixBareUrlsOutsideCodeBlocks } from './outputFixes';

describe('fixBareUrlsOutsideCodeBlocks — 代码块保护', () => {
  it('围栏代码块内的 Windows 路径保持原样（复制即可运行）', () => {
    const input = [
      '启动命令如下：',
      '```',
      'cd /d C:\\hospAI\\SmartReview ..\\python\\python.exe server.py',
      '```',
    ].join('\n');
    const out = fixBareUrlsOutsideCodeBlocks(input);
    expect(out).toContain('cd /d C:\\hospAI\\SmartReview ..\\python\\python.exe server.py');
    expect(out).not.toContain('tiffa-local:');
  });

  it('带语言标注的围栏同样受保护', () => {
    const input = '```bash\ncd /d D:\\work\\app && python run.py\n```';
    const out = fixBareUrlsOutsideCodeBlocks(input);
    expect(out).toBe(input);
  });

  it('波浪号围栏（~~~）同样受保护', () => {
    const input = '~~~\ncd /d E:\\data\n~~~';
    const out = fixBareUrlsOutsideCodeBlocks(input);
    expect(out).toBe(input);
  });

  it('正文中的路径仍然链接化', () => {
    const out = fixBareUrlsOutsideCodeBlocks('请进入 C:\\hospAI\\SmartReview 目录运行。');
    expect(out).toContain('[C:\\hospAI\\SmartReview](tiffa-local://C:/hospAI/SmartReview)');
  });

  it('代码块之后的正文仍链接化（状态机正确复位）', () => {
    const input = [
      '先看 C:\\a\\b，',
      '```',
      'cd /d C:\\a\\b',
      '```',
      '再看 D:\\c\\d。',
    ].join('\n');
    const out = fixBareUrlsOutsideCodeBlocks(input);
    expect(out).toContain('[C:\\a\\b](tiffa-local://C:/a/b)'); // 块前
    expect(out).toContain('cd /d C:\\a\\b'); // 块内原样
    expect(out).toContain('[D:\\c\\d](tiffa-local://D:/c/d)'); // 块后
    const inside = out.split('```')[1];
    expect(inside).not.toContain('tiffa-local:');
  });

  it('未闭合围栏：其后所有行受保护（流式中途状态）', () => {
    const input = '正文 C:\\x\\y\n```\ncd /d C:\\x\\y';
    const out = fixBareUrlsOutsideCodeBlocks(input);
    expect(out).toContain('[C:\\x\\y](tiffa-local://C:/x/y)\n```\ncd /d C:\\x\\y');
  });

  it('四重围栏需要四重以上才能闭合', () => {
    const input = '````\ncd /d C:\\x\\y\n```\nstill inside C:\\x\\y\n````\nafter C:\\x\\y';
    const out = fixBareUrlsOutsideCodeBlocks(input);
    const seg = out.split('\n');
    // 3 个反引号的行是内容，不受保护也不闭合
    expect(seg[2]).toBe('```');
    expect(seg[3]).toContain('still inside C:\\x\\y'); // 块内不链接
    expect(seg[5]).toContain('[C:\\x\\y](tiffa-local://C:/x/y)'); // 闭合后恢复
  });

  it('4 空格缩进的 ``` 不是围栏（Markdown 语义），仍按正文处理', () => {
    const input = '    ```\ncd /d C:\\x\\y\n    ```';
    const out = fixBareUrlsOutsideCodeBlocks(input);
    expect(out).toContain('[C:\\x\\y](tiffa-local://C:/x/y)');
  });
});

describe('applyOutputFixes — 端到端管线', () => {
  it('代码块语言推断保留，但代码内容不被链接化', () => {
    const input = [
      '运行：',
      '```',
      'cd /d C:\\hospAI\\SmartReview ..\\python\\python.exe server.py',
      '```',
      '文件在 C:\\hospAI\\server.py。',
    ].join('\n');
    const out = applyOutputFixes(input);
    expect(out).toContain('cd /d C:\\hospAI\\SmartReview ..\\python\\python.exe server.py');
    expect(out.split('\n').slice(2, 3).join('\n')).not.toContain('tiffa-local:');
    expect(out).toContain('[C:\\hospAI\\server.py](tiffa-local://C:/hospAI/server.py)');
  });

  it('空字符串不抛错', () => {
    expect(applyOutputFixes('')).toBe('');
  });
});

describe('fixBareUrls — 单行原语行为不变', () => {
  it('http 链接化 + 路径链接化（原逻辑）', () => {
    const out = fixBareUrls('见 https://example.com/a 和 C:\\tmp\\x.txt');
    expect(out).toContain('[example.com/a](https://example.com/a)');
    expect(out).toContain('[C:\\tmp\\x.txt](tiffa-local://C:/tmp/x.txt)');
  });
});
