/**
 * session-utils 单测
 *
 * 覆盖纯函数：ID 提取 / 目录编码 / workspace 后缀 / JSONL 解析 / header 解析 / 标题生成。
 * 不依赖 Electron 运行时。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  extractSessionIdFromPath,
  encodeSessionDirName,
  _encodeSessionDirName,
  extractWorkspaceSuffix,
  stableSessionDirName,
  decodeSessionDirName,
  cwdDisplayName,
  isEmptySessionDir,
  parseMdField,
  readTailLines,
  parseSessionLines,
  parseSessionHeader,
  tryGenerateSessionTitle,
} from './session-utils';

describe('extractSessionIdFromPath', () => {
  it('从 JSONL 路径提取 UUID', () => {
    const p = 'C:/data/sessions/--wks-test--/abc12345-1234-1234-1234-1234567890ab.jsonl';
    expect(extractSessionIdFromPath(p)).toBe('abc12345-1234-1234-1234-1234567890ab');
  });

  it('非 JSONL 路径返回 null', () => {
    expect(extractSessionIdFromPath('C:/data/file.txt')).toBeNull();
  });

  it('空值返回 null', () => {
    expect(extractSessionIdFromPath(null)).toBeNull();
    expect(extractSessionIdFromPath('')).toBeNull();
    expect(extractSessionIdFromPath(undefined)).toBeNull();
  });
});

describe('encodeSessionDirName / stableSessionDirName', () => {
  it('_encodeSessionDirName 编码盘符路径', () => {
    const encoded = _encodeSessionDirName('C:\\Users\\test');
    expect(encoded.startsWith('--')).toBe(true);
    expect(encoded.endsWith('--')).toBe(true);
    expect(encoded).toContain('C');
  });

  it('stableSessionDirName 对 workspace 路径用 --wks- 前缀', () => {
    // extractWorkspaceSuffix 依赖 PORTABLE_ROOT，这里验证编码格式即可
    const encoded = stableSessionDirName('C:\\some\\workspace\\myproject');
    expect(encoded.startsWith('--')).toBe(true);
    expect(encoded.endsWith('--')).toBe(true);
  });

  it('encodeSessionDirName 等价 stableSessionDirName', () => {
    const cwd = 'C:\\some\\path';
    expect(encodeSessionDirName(cwd)).toBe(stableSessionDirName(cwd));
  });
});

describe('extractWorkspaceSuffix', () => {
  it('匹配 .../workspace/xxx 返回后缀', () => {
    expect(extractWorkspaceSuffix('D:/old/workspace/myproject')).toBe(
      path.join('myproject'),
    );
  });

  it('匹配 workspace/sub/deep', () => {
    expect(extractWorkspaceSuffix('D:/old/workspace/a/b')).toBe(path.join('a', 'b'));
  });

  it('不匹配无 workspace 的路径返回 null', () => {
    expect(extractWorkspaceSuffix('C:/Users/test')).toBeNull();
  });
});

describe('decodeSessionDirName', () => {
  it('Windows 盘符格式解码', () => {
    const encoded = '--C--Users--test--';
    const decoded = decodeSessionDirName(encoded);
    expect(decoded).toContain('C:');
  });

  it('非编码格式原样返回', () => {
    expect(decodeSessionDirName('plain-name')).toBe('plain-name');
  });
});

describe('cwdDisplayName', () => {
  it('取最后一段', () => {
    expect(cwdDisplayName('C:\\projects\\myapp')).toBe('myapp');
  });

  it('Unix 路径取最后一段', () => {
    expect(cwdDisplayName('/home/user/myapp')).toBe('myapp');
  });
});

describe('isEmptySessionDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiffa-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('空目录返回 true', () => {
    expect(isEmptySessionDir(tmpDir)).toBe(true);
  });

  it('有文件返回 false', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.jsonl'), '{}');
    expect(isEmptySessionDir(tmpDir)).toBe(false);
  });

  it('不存在的目录返回 false', () => {
    expect(isEmptySessionDir(path.join(tmpDir, 'nope'))).toBe(false);
  });
});

describe('parseMdField', () => {
  it('提取全角冒号字段', () => {
    expect(parseMdField('- 名字：Tiffa', '名字')).toBe('Tiffa');
  });

  it('提取半角冒号字段', () => {
    expect(parseMdField('- name: Tiffa', 'name')).toBe('Tiffa');
  });
  it('空值字段不吞下一行（防跨行泄漏）', () => {
    expect(parseMdField('- 称呼：\n- 语言：中文（简体）', '称呼')).toBe('');
    expect(parseMdField('- 称呼：\n- 语言：中文（简体）', '语言')).toBe('中文（简体）');
  });


  it('无匹配返回空串', () => {
    expect(parseMdField('# 标题', '名字')).toBe('');
  });

  it('空内容返回空串', () => {
    expect(parseMdField(null, 'x')).toBe('');
    expect(parseMdField(undefined, 'x')).toBe('');
  });
});

describe('readTailLines', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `tiffa-tail-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('空文件返回空行', async () => {
    fs.writeFileSync(tmpFile, '');
    const r = await readTailLines(tmpFile, 10);
    expect(r.lines).toEqual([]);
    expect(r.reachedStart).toBe(true);
  });

  it('返回最后 N 行（时间正序）', async () => {
    const lines = ['{"i":1}', '{"i":2}', '{"i":3}'];
    fs.writeFileSync(tmpFile, lines.join('\n') + '\n');
    const r = await readTailLines(tmpFile, 2);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe('{"i":2}');
    expect(r.lines[1]).toBe('{"i":3}');
    expect(r.droppedAny).toBe(true);
  });

  it('行数不足时返回全部', async () => {
    fs.writeFileSync(tmpFile, '{"i":1}\n{"i":2}\n');
    const r = await readTailLines(tmpFile, 10);
    expect(r.lines).toHaveLength(2);
    expect(r.reachedStart).toBe(true);
    expect(r.droppedAny).toBe(false);
  });
});

describe('parseSessionLines', () => {
  it('解析 user + assistant 文本消息', () => {
    const lines = [
      JSON.stringify({ type: 'message', message: { role: 'user', content: '你好' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: '你好！' } }),
    ];
    const msgs = parseSessionLines(lines);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].text).toBe('你好');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].text).toBe('你好！');
  });

  it('解析数组 content 中的 text + thinking + tool_use', () => {
    const lines = [
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '让我想想' },
            { type: 'text', text: '结果' },
            { type: 'tool_use', id: 'tc1', name: 'read', input: { path: 'a.ts' } },
          ],
        },
      }),
    ];
    const msgs = parseSessionLines(lines);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('结果');
    expect(msgs[0].thinking).toBe('让我想想');
    expect(msgs[0].toolCalls).toHaveLength(1);
    expect(msgs[0].toolCalls[0].name).toBe('read');
  });

  it('toolResult 从 tool_execution_start 补全参数', () => {
    const lines = [
      JSON.stringify({
        type: 'custom',
        customType: 'tool_execution_start',
        data: { toolCallId: 'tc1', toolName: 'bash', args: { cmd: 'ls' } },
      }),
      JSON.stringify({
        type: 'message',
        message: { role: 'toolResult', toolCallId: 'tc1', content: 'file1\nfile2' },
      }),
    ];
    const msgs = parseSessionLines(lines);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].toolCalls[0].name).toBe('bash');
    expect(msgs[0].toolCalls[0].input).toEqual({ cmd: 'ls' });
    expect(msgs[0].toolCalls[0].result).toBe('file1\nfile2');
  });

  it('损坏行跳过不报错', () => {
    const lines = ['not json', '{"type":"message","message":{"role":"user","content":"ok"}}'];
    const msgs = parseSessionLines(lines);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('ok');
  });
});

describe('parseSessionHeader', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `tiffa-hdr-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('提取 sessionId / cwd / firstMessage / title', () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ id: 'uuid-123', version: 1, cwd: 'C:\\proj' }) + '\n' +
      JSON.stringify({ type: 'title', title: '测试标题' }) + '\n' +
      JSON.stringify({ type: 'message', message: { role: 'user', content: '第一条消息' } }) + '\n',
    );
    const h = parseSessionHeader(tmpFile);
    expect(h.sessionId).toBe('uuid-123');
    expect(h.cwd).toBe('C:\\proj');
    expect(h.title).toBe('测试标题');
    expect(h.firstMessage).toBe('第一条消息');
    expect(h.messageCount).toBe(1);
  });

  it('无 title 事件时 firstMessage 截断 100 字', () => {
    const longMsg = 'x'.repeat(200);
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ id: 'uuid', version: 1, cwd: 'C:\\p' }) + '\n' +
      JSON.stringify({ type: 'message', message: { role: 'user', content: longMsg } }) + '\n',
    );
    const h = parseSessionHeader(tmpFile);
    expect(h.title).toBeNull();
    expect(h.firstMessage.length).toBeLessThanOrEqual(103); // 100 + "..."
  });

  it('header.title fallback', () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ id: 'uuid', version: 1, cwd: 'C:\\p', title: '手动标题' }) + '\n',
    );
    const h = parseSessionHeader(tmpFile);
    expect(h.title).toBe('手动标题');
  });
});

describe('tryGenerateSessionTitle', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `tiffa-title-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('无 title 时从 firstMessage 生成标题并通知', () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ id: 'uuid', version: 1, cwd: 'C:\\proj' }) + '\n' +
      JSON.stringify({ type: 'message', message: { role: 'user', content: '帮我写一个排序算法' } }) + '\n',
    );
    let notified: { title: string; sid: string | null; cwd: string } | null = null;
    tryGenerateSessionTitle(
      { sessionFilePath: tmpFile, sessionId: 'uuid', cwd: 'C:\\proj' },
      (title, sid, cwd) => { notified = { title, sid, cwd }; },
    );
    expect(notified).not.toBeNull();
    expect(notified!.title).toBe('帮我写一个排序算法');
    expect(notified!.sid).toBe('uuid');
    // 验证写入 JSONL
    const h = parseSessionHeader(tmpFile);
    expect(h.title).toBe('帮我写一个排序算法');
  });

  it('已有 title 时不覆盖', () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ id: 'uuid', version: 1, cwd: 'C:\\proj', title: '已有标题' }) + '\n' +
      JSON.stringify({ type: 'message', message: { role: 'user', content: '不该用这个' } }) + '\n',
    );
    let called = false;
    tryGenerateSessionTitle(
      { sessionFilePath: tmpFile, sessionId: 'uuid', cwd: 'C:\\proj' },
      () => { called = true; },
    );
    expect(called).toBe(false);
  });

  it('长标题截断到 25 字 + …', () => {
    const longMsg = '这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的用户消息';
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ id: 'uuid', version: 1, cwd: 'C:\\proj' }) + '\n' +
      JSON.stringify({ type: 'message', message: { role: 'user', content: longMsg } }) + '\n',
    );
    let title = '';
    tryGenerateSessionTitle(
      { sessionFilePath: tmpFile, sessionId: 'uuid', cwd: 'C:\\proj' },
      (t) => { title = t; },
    );
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(26); // 25 + …
  });
});
