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

/** 替换 sendRaw，收集发往内核的帧（不依赖真实子进程） */
function stubSendRaw(inst: TiffaInstance): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  (inst as unknown as { sendRaw: (f: Record<string, unknown>) => void }).sendRaw = (f) => {
    sent.push(f);
  };
  return sent;
}

describe('TiffaInstance 卡死恢复', () => {
  afterEach(() => {
    setMainWindow(null);
  });

  it('isUnattended 只认调度器起的任务会话', () => {
    expect(new TiffaInstance('C:\\proj', 'sched-daily').isUnattended).toBe(true);
    expect(new TiffaInstance('C:\\proj', 'uuid-123').isUnattended).toBe(false);
    expect(new TiffaInstance('C:\\proj', null).isUnattended).toBe(false);
  });

  it('cancelPendingAsks 对每个挂起审批应答 cancelled 并清空，重复调用返回 0', () => {
    const inst = new TiffaInstance('C:\\proj', 'sched-x');
    const sent = stubSendRaw(inst);
    inst._pendingAskIds.add('a1');
    inst._pendingAskIds.add('a2');

    expect(inst.cancelPendingAsks('test')).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent.every((f) => f.type === 'extension_ui_response' && f.cancelled === true)).toBe(true);
    expect(inst._pendingAskIds.size).toBe(0);
    expect(inst.cancelPendingAsks('test')).toBe(0);
  });

  it('forceReset 连 prewarm/恢复窗口一起清掉（否则合成 agent_end 会被事件过滤器吞掉）', () => {
    const inst = new TiffaInstance('C:\\proj', 'sched-x');
    stubSendRaw(inst);
    inst.agentRunning = true;
    inst.userPromptInFlight = true;
    inst.isPrewarming = true;
    inst._restoringContext = true;

    inst.forceReset('test');

    expect(inst.agentRunning).toBe(false);
    expect(inst.userPromptInFlight).toBe(false);
    expect(inst.isPrewarming).toBe(false);
    expect(inst._restoringContext).toBe(false);
  });

  it('看门狗不被 forceReset 骗过：本地标志复位 ≠ 内核空闲', () => {
    vi.useFakeTimers();
    try {
      const inst = new TiffaInstance('C:\\proj', 'sched-x');
      stubSendRaw(inst);
      inst.agentRunning = true;
      let gaveUp = 0;
      inst.armAbortWatchdog(() => {
        gaveUp++;
      });

      vi.advanceTimersByTime(9000); // 越过 grace：强制复位本地运行态
      expect(inst.agentRunning).toBe(false);
      expect(gaveUp).toBe(0);

      vi.advanceTimersByTime(20000); // 累计 29s，越过 kill 阈值
      expect(gaveUp).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('看门狗在收到真实 agent_end 后自行退出，不误杀实例', () => {
    vi.useFakeTimers();
    try {
      const inst = new TiffaInstance('C:\\proj', 'sched-x');
      stubSendRaw(inst);
      inst.agentRunning = true;
      let gaveUp = 0;
      inst.armAbortWatchdog(() => {
        gaveUp++;
      });

      inst._lastRealAgentEndAt = Date.now();
      vi.advanceTimersByTime(30000);

      expect(gaveUp).toBe(0);
      expect(inst._abortWatchdog).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('合成 agent_end 必须带上 _resetReason（渲染层靠它区分「引擎没响应」与「前端状态卡住」）', () => {
    const sent: Array<Record<string, unknown>> = [];
    setMainWindow({
      isDestroyed: () => false,
      webContents: {
        send: (_ch: string, payload: Record<string, unknown>) => {
          sent.push(payload);
        },
      },
    } as unknown as Parameters<typeof setMainWindow>[0]);
    try {
      const inst = new TiffaInstance('C:\\proj', 'sched-x');
      stubSendRaw(inst);

      inst.forceReset('abort-idle');

      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('agent_end');
      expect(sent[0]._synthetic).toBe(true);
      expect(sent[0]._resetReason).toBe('abort-idle');
    } finally {
      setMainWindow(null);
    }
  });
});
