/**
 * useChatStore — textDelta 立即渲染回归测试
 *
 * 背景（2026-08-11）：旧实现把 textDelta 累积进 textBuffer，80ms 节流后才整段写入
 * TextPart，导致正式回复"小范围刷字"（思考块走 thinkingDelta 每 delta 立即渲染所以平滑）。
 * 修复：移除节流，textDelta 立即追加。本测试防止该行为回归（再次出现"刷字"）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from './useChatStore';

const PATH = 'test-session';

beforeEach(() => {
  useChatStore.setState({ messagesMap: {}, streaming: {} });
});

describe('textDelta 立即渲染', () => {
  it('无 streaming 状态时静默忽略', () => {
    useChatStore.getState().textDelta(PATH, 'hello');
    expect(useChatStore.getState().messagesMap[PATH]).toBeUndefined();
  });

  it('空 path / 空 delta 均忽略', () => {
    useChatStore.getState().beginAssistantMessage(PATH);
    useChatStore.getState().textDelta('', 'x');
    useChatStore.getState().textDelta(PATH, '');
    const messages = useChatStore.getState().messagesMap[PATH] ?? [];
    expect(messages.length).toBe(1);
    const last = messages[messages.length - 1];
    expect(last.parts.filter((p) => p.kind === 'text')).toHaveLength(0);
  });

  it('多次 delta 立即累加进同一 TextPart（不等待节流）', () => {
    useChatStore.getState().beginAssistantMessage(PATH);
    useChatStore.getState().textDelta(PATH, '你');
    useChatStore.getState().textDelta(PATH, '好');
    useChatStore.getState().textDelta(PATH, '世');
    useChatStore.getState().textDelta(PATH, '界');
    const messages = useChatStore.getState().messagesMap[PATH]!;
    const last = messages[messages.length - 1];
    expect(last.streaming).toBe(true);
    const text = last.parts
      .filter((p) => p.kind === 'text')
      .map((p) => (p as { kind: 'text'; text: string }).text)
      .join('');
    expect(text).toBe('你好世界');
    // streaming 缓冲也应同步（供 finalize 兜底）
    const st = useChatStore.getState().streaming[PATH];
    expect(st?.textBuffer).toBe('你好世界');
  });

  it('消息流结束后 textDelta 不再写入（streaming 已清）', () => {
    useChatStore.getState().beginAssistantMessage(PATH);
    useChatStore.getState().finalizeAssistant(PATH);
    useChatStore.getState().textDelta(PATH, '迟到文本');
    const messages = useChatStore.getState().messagesMap[PATH]!;
    const last = messages[messages.length - 1];
    const text = last.parts
      .filter((p) => p.kind === 'text')
      .map((p) => (p as { kind: 'text'; text: string }).text)
      .join('');
    expect(text).toBe('');
  });
});
