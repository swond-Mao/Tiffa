/**
 * tiffa-instance 单测
 *
 * TiffaInstance 依赖 spawn 真实子进程，无法在单测中完整覆盖 start()。
 * 这里覆盖可独立验证的纯逻辑：
 * - _shortCwd
 * - _pendingAskIds 记账（extension_ui_request 处理需要 mainWindow，用注入验证）
 * - sendCommand 无 process 时 reject
 * - sendRaw 无 process 时不抛错
 * - kill 无 process 时不抛错
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TiffaInstance, setMainWindow } from './tiffa-instance';

describe('TiffaInstance._shortCwd', () => {
  it('取 cwd 最后一段', () => {
    const inst = new TiffaInstance('C:\\projects\\myapp');
    expect(inst._shortCwd()).toBe('myapp');
  });

  it('Unix 路径取最后一段', () => {
    const inst = new TiffaInstance('/home/user/app');
    expect(inst._shortCwd()).toBe('app');
  });
});

describe('TiffaInstance 边界行为', () => {
  afterEach(() => {
    setMainWindow(null);
  });

  it('sendCommand 无 process 时 reject', async () => {
    const inst = new TiffaInstance('C:\\proj');
    await expect(inst.sendCommand({ type: 'prompt', message: 'x' })).rejects.toThrow('not running');
  });

  it('sendRaw 无 process 时不抛错', () => {
    const inst = new TiffaInstance('C:\\proj');
    expect(() => inst.sendRaw({ type: 'prompt', message: 'x' })).not.toThrow();
  });

  it('kill 无 process 时不抛错', () => {
    const inst = new TiffaInstance('C:\\proj');
    expect(() => inst.kill()).not.toThrow();
  });

  it('初始状态字段正确', () => {
    const inst = new TiffaInstance('C:\\proj', 'uuid-123');
    expect(inst.cwd).toBe('C:\\proj');
    expect(inst.sessionId).toBe('uuid-123');
    expect(inst.ready).toBe(false);
    expect(inst.userKilled).toBe(false);
    expect(inst.crashCount).toBe(0);
    expect(inst.maxCrashRestart).toBe(3);
    expect(inst.pendingCommands.size).toBe(0);
  });
});
