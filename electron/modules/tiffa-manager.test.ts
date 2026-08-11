/**
 * tiffa-manager 单测
 *
 * 用假实例注入验证管理器逻辑（不 spawn 真实进程），对标 main.test.js：
 * key 生成、migrateSessionId、LRU 淘汰（跳过 active/运行中/待审批）、保活窗口、closeAll。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TiffaInstanceManager } from './tiffa-manager';
import { TiffaInstance } from './tiffa-instance';

function fakeInst(overrides: Partial<TiffaInstance> = {}): TiffaInstance {
  const inst = new TiffaInstance('C:\\proj', null);
  Object.assign(inst, {
    cwd: 'C:\\proj',
    sessionId: null,
    ready: true,
    agentRunning: false,
    _pendingAskIds: new Set(),
    lastActiveTime: Date.now(),
    process: { pid: 1000 + Math.floor(Math.random() * 1000) } as never,
    sessionFilePath: null,
    crashCount: 0,
    maxCrashRestart: 3,
    userKilled: false,
    kill: vi.fn(),
  }, overrides);
  return inst;
}

describe('TiffaInstanceManager._key', () => {
  it('项目级 key = cwd#project', () => {
    const mgr = new TiffaInstanceManager();
    expect(mgr._key('C:\\proj', null)).toBe('C:\\proj#project');
  });

  it('对话级 key = cwd#sessionId', () => {
    const mgr = new TiffaInstanceManager();
    expect(mgr._key('C:\\proj', 'uuid-123')).toBe('C:\\proj#uuid-123');
  });
});

describe('TiffaInstanceManager.migrateSessionId', () => {
  it('从旧 key 迁到新 key，activeKey 同步', () => {
    const mgr = new TiffaInstanceManager();
    const inst = fakeInst({ sessionId: 'old-id' });
    mgr.instances.set(mgr._key('C:\\proj', 'old-id'), inst);
    mgr.activeKey = mgr._key('C:\\proj', 'old-id');
    const ok = mgr.migrateSessionId('C:\\proj', 'old-id', 'new-id');
    expect(ok).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'old-id'))).toBe(false);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'new-id'))).toBe(true);
    expect(mgr.activeKey).toBe(mgr._key('C:\\proj', 'new-id'));
  });

  it('目标 key 已存在：仅删旧 key 不覆盖', () => {
    const mgr = new TiffaInstanceManager();
    const oldInst = fakeInst({ sessionId: 'old-id' });
    const newInst = fakeInst({ sessionId: 'new-id' });
    mgr.instances.set(mgr._key('C:\\proj', 'old-id'), oldInst);
    mgr.instances.set(mgr._key('C:\\proj', 'new-id'), newInst);
    const ok = mgr.migrateSessionId('C:\\proj', 'old-id', 'new-id');
    expect(ok).toBe(false);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'old-id'))).toBe(false);
    expect(mgr.instances.get(mgr._key('C:\\proj', 'new-id'))).toBe(newInst);
  });

  it('实例不存在时返回 false 不抛错', () => {
    const mgr = new TiffaInstanceManager();
    expect(mgr.migrateSessionId('C:\\proj', 'ghost', 'new')).toBe(false);
  });
});

describe('TiffaInstanceManager LRU 淘汰', () => {
  let mgr: TiffaInstanceManager;

  beforeEach(() => {
    mgr = new TiffaInstanceManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('淘汰 lastActiveTime 最旧的实例', () => {
    const old = fakeInst({ sessionId: 'old', lastActiveTime: Date.now() - 600000 });
    const fresh = fakeInst({ sessionId: 'fresh', lastActiveTime: Date.now() });
    mgr.instances.set(mgr._key('C:\\proj', 'old'), old);
    mgr.instances.set(mgr._key('C:\\proj', 'fresh'), fresh);
    mgr.activeKey = mgr._key('C:\\proj', 'fresh'); // 活跃的是 fresh
    const ok = mgr._evictLRU();
    expect(ok).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'old'))).toBe(false);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'fresh'))).toBe(true);
  });

  it('跳过当前活跃实例', () => {
    const active = fakeInst({ sessionId: 'active', lastActiveTime: Date.now() - 600000 });
    const other = fakeInst({ sessionId: 'other', lastActiveTime: Date.now() - 600000 });
    mgr.instances.set(mgr._key('C:\\proj', 'active'), active);
    mgr.instances.set(mgr._key('C:\\proj', 'other'), other);
    mgr.activeKey = mgr._key('C:\\proj', 'active');
    const ok = mgr._evictLRU();
    expect(ok).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'active'))).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'other'))).toBe(false);
  });

  it('跳过 agentRunning 的实例', () => {
    const running = fakeInst({ sessionId: 'run', agentRunning: true, lastActiveTime: Date.now() - 600000 });
    const idle = fakeInst({ sessionId: 'idle', lastActiveTime: Date.now() - 600000 });
    mgr.instances.set(mgr._key('C:\\proj', 'run'), running);
    mgr.instances.set(mgr._key('C:\\proj', 'idle'), idle);
    mgr.activeKey = mgr._key('C:\\proj', 'run');
    const ok = mgr._evictLRU();
    expect(ok).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'run'))).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'idle'))).toBe(false);
  });

  it('跳过有未应答 ask 的实例（pin 保护）', () => {
    const askInst = fakeInst({ sessionId: 'ask', lastActiveTime: Date.now() - 600000 });
    askInst._pendingAskIds.add('ask-1');
    const other = fakeInst({ sessionId: 'other', lastActiveTime: Date.now() - 600000 });
    mgr.instances.set(mgr._key('C:\\proj', 'ask'), askInst);
    mgr.instances.set(mgr._key('C:\\proj', 'other'), other);
    mgr.activeKey = mgr._key('C:\\proj', 'ask');
    const ok = mgr._evictLRU();
    expect(ok).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'ask'))).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'other'))).toBe(false);
  });

  it('全部不可淘汰时返回 false', () => {
    const a = fakeInst({ sessionId: 'a', agentRunning: true });
    const b = fakeInst({ sessionId: 'b', agentRunning: true });
    mgr.instances.set(mgr._key('C:\\proj', 'a'), a);
    mgr.instances.set(mgr._key('C:\\proj', 'b'), b);
    mgr.activeKey = mgr._key('C:\\proj', 'a');
    const ok = mgr._evictLRU();
    expect(ok).toBe(false);
  });

  it('保活窗口内的实例不优先淘汰', () => {
    const recent = fakeInst({ sessionId: 'recent', lastActiveTime: Date.now() - 1000 });
    const older = fakeInst({ sessionId: 'older', lastActiveTime: Date.now() - 600000 });
    mgr.instances.set(mgr._key('C:\\proj', 'recent'), recent);
    mgr.instances.set(mgr._key('C:\\proj', 'older'), older);
    mgr.activeKey = mgr._key('C:\\proj', 'recent');
    const ok = mgr._evictLRU();
    expect(ok).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'recent'))).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'older'))).toBe(false);
  });

  it('池满且全部在保活窗口内时，回退淘汰最旧的', () => {
    const a = fakeInst({ sessionId: 'a', lastActiveTime: Date.now() - 5000 });
    const b = fakeInst({ sessionId: 'b', lastActiveTime: Date.now() - 60000 });
    mgr.instances.set(mgr._key('C:\\proj', 'a'), a);
    mgr.instances.set(mgr._key('C:\\proj', 'b'), b);
    mgr.activeKey = mgr._key('C:\\proj', 'a');
    const ok = mgr._evictLRU();
    expect(ok).toBe(true);
    expect(mgr.instances.has(mgr._key('C:\\proj', 'b'))).toBe(false);
  });
});

describe('TiffaInstanceManager 其他操作', () => {
  it('closeByKey 关闭后删除实例并清空 activeKey', () => {
    const mgr = new TiffaInstanceManager();
    const inst = fakeInst();
    inst.kill = vi.fn();
    const key = mgr._key('C:\\proj', null);
    mgr.instances.set(key, inst);
    mgr.activeKey = key;
    mgr.activeCwd = 'C:\\proj';
    mgr.closeByKey(key);
    expect(mgr.instances.has(key)).toBe(false);
    expect(mgr.activeKey).toBeNull();
    expect(inst.kill).toHaveBeenCalled();
  });

  it('getBySessionIdAnywhere 全池扫描命中', () => {
    const mgr = new TiffaInstanceManager();
    const a = fakeInst({ sessionId: 'sid-a' });
    const b = fakeInst({ sessionId: 'sid-b' });
    mgr.instances.set(mgr._key('C:\\a', 'sid-a'), a);
    mgr.instances.set(mgr._key('C:\\b', 'sid-b'), b);
    expect(mgr.getBySessionIdAnywhere('sid-b')).toBe(b);
    expect(mgr.getBySessionIdAnywhere('ghost')).toBeNull();
  });

  it('getStatus 上报各实例状态字段', () => {
    const mgr = new TiffaInstanceManager();
    const inst = fakeInst({ sessionId: 'sid', sessionFilePath: 'C:\\s.jsonl' });
    const key = mgr._key('C:\\proj', 'sid');
    mgr.instances.set(key, inst);
    mgr.activeKey = key;
    const status = mgr.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0].sessionId).toBe('sid');
    expect(status[0].active).toBe(true);
    expect(status[0].ready).toBe(true);
  });
});
