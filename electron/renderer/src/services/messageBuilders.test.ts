/**
 * messageBuilders — 历史消息稳定 id 回归测试
 *
 * 放置位置：electron/renderer/src/services/messageBuilders.test.ts
 * （基础目录禁止 AI 直接新建文件，请手动复制到该路径后跑 `npm run test:renderer`）
 *
 * 背景（2026-08-18）：主进程 parseSessionLines 不产出消息 id，旧代码 `id: msg.id`
 * 导致所有历史消息 id 为 undefined → ChatView 渲染 key 全部退化成同一个 `m-0`
 * （重复 key）→ React 18 跨会话 diff 错乱、旧会话气泡 DOM 不卸载（日志实锤
 * n=0 sh=12233：0 条消息却 12000+px 内容高度，即其他会话残留 DOM）。
 * 修复：buildHistoryMessage 对无 id 消息生成内容哈希稳定 id。本测试防回归。
 */
import { describe, expect, it } from 'vitest';
import { buildHistoryMessage, buildHistoryMessages } from './messageBuilders';

describe('buildHistoryMessage 稳定 id', () => {
  it('无 id 消息生成非空 hist- 前缀 id（不再为 undefined）', () => {
    const cm = buildHistoryMessage({ role: 'user', text: '你好' });
    expect(cm).not.toBeNull();
    expect(cm!.id).toMatch(/^hist-/);
  });

  it('同内容重复解析 id 不变（稳定）', () => {
    const a = buildHistoryMessage({ role: 'user', text: '你好', timestamp: '2026-08-18T10:00:00Z' });
    const b = buildHistoryMessage({ role: 'user', text: '你好', timestamp: '2026-08-18T10:00:00Z' });
    expect(a!.id).toBe(b!.id);
  });

  it('不同内容 id 不同（跨会话不冲突）', () => {
    const a = buildHistoryMessage({ role: 'user', text: '会话A的问题', timestamp: '2026-08-18T10:00:00Z' });
    const b = buildHistoryMessage({ role: 'user', text: '会话B的问题', timestamp: '2026-08-18T11:00:00Z' });
    expect(a!.id).not.toBe(b!.id);
  });

  it('assistant 消息（text/thinking/toolCalls）均有稳定 id', () => {
    const withText = buildHistoryMessage({ role: 'assistant', text: '回答' });
    const withThinking = buildHistoryMessage({ role: 'assistant', thinking: '思考中' });
    const withTool = buildHistoryMessage({
      role: 'assistant',
      toolCalls: [{ name: 'bash', input: { command: 'ls' }, result: 'ok' }],
    });
    expect(withText!.id).toMatch(/^hist-/);
    expect(withThinking!.id).toMatch(/^hist-/);
    expect(withTool!.id).toMatch(/^hist-/);
    expect(new Set([withText!.id, withThinking!.id, withTool!.id]).size).toBe(3);
  });

  it('上游已带 id 时原样保留（不覆盖）', () => {
    const cm = buildHistoryMessage({ id: 'from-kernel-1', role: 'user', text: 'x' });
    expect(cm!.id).toBe('from-kernel-1');
  });

  it('同一会话批量转换后 id 互不重复（React key 唯一性前提）', () => {
    const raw = [
      { role: 'user', text: '第一问' },
      { role: 'assistant', text: '第一答' },
      { role: 'user', text: '第二问' },
      { role: 'assistant', thinking: '第二答思考' },
      { role: 'user', text: '第三问' },
    ];
    const out = buildHistoryMessages(raw);
    expect(out).toHaveLength(5);
    const ids = out.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/** 与 ChatView makeKey 兜底逻辑一致：重复 key 追加序号，保证列表内唯一 */
function dedupeKeys(items: { id?: string; idx: number }[]): string[] {
  const keySeen = new Map<string, number>();
  return items.map(({ id, idx }) => {
    const base = id || `m-${idx}`;
    const n = keySeen.get(base);
    if (n === undefined) {
      keySeen.set(base, 1);
      return base;
    }
    keySeen.set(base, n + 1);
    return `${base}#${n}`;
  });
}

describe('key 去重兜底（ChatView makeKey 等价逻辑）', () => {
  it('全部无 id 时回退位置索引且唯一', () => {
    const keys = dedupeKeys([{ idx: 0 }, { idx: 1 }, { idx: 2 }]);
    expect(keys).toEqual(['m-0', 'm-1', 'm-2']);
  });

  it('id 重复时追加序号保证唯一（防 React 重复 key 崩溃/DOM 残留）', () => {
    const keys = dedupeKeys([{ id: 'x', idx: 0 }, { id: 'x', idx: 1 }, { id: 'x', idx: 2 }]);
    expect(keys).toEqual(['x', 'x#1', 'x#2']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('正常 id 不触发兜底', () => {
    const keys = dedupeKeys([{ id: 'a', idx: 0 }, { id: 'b', idx: 1 }]);
    expect(keys).toEqual(['a', 'b']);
  });
});
