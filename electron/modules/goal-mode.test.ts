/**
 * goal-mode 单元测试。
 *
 * 覆盖的是**2026-09-19 实际踩过的坑**，不是覆盖率：
 *  ① 运行态必须按会话分文件（`goal-state.<sessionId>.json`）—— 内核 task 子代理会在同一进程内
 *     再加载一次外挂，子会话也收 goal_updated；共用一个全局文件会被子代理覆盖，
 *     表现为前端「目标突然没了」+ 每轮注入的目标上下文消失。
 *  ② `clearGoalState` 只能清本会话，**不能误删**属于别的会话的旧版全局文件。
 *  ③ `/force goal` 指令必须逐字带上用户目标原文（目标漂移是弱模型最常见的失效原因）。
 *
 * AGENT_DIR 用 `vi.mock` 换成临时目录，避免动到真实的 data/agent。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// vi.mock 的工厂会被提升到 import 之前，所以这里用 vi.hoisted 先算出临时目录
const { TMP } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const _fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const _os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const _path = require('path');
  return { TMP: _fs.mkdtempSync(_path.join(_os.tmpdir(), 'goal-mode-test-')) };
});

vi.mock('./constants', () => ({ AGENT_DIR: TMP }));

import {
  GOAL_ARM_PATH,
  GOAL_STATE_PATH,
  goalStatePath,
  readGoalArm,
  writeGoalArm,
  readGoalState,
  clearGoalState,
  goalDraftPath,
  readGoalDraft,
  writeGoalDraft,
  clearGoalDraft,
  composeObjective,
  buildDraftCommand,
  isForceCapable,
  buildCreateCommand,
  buildSoftCreateMessage,
  buildCloseCommand,
} from './goal-mode';

const SID_A = 'sid-aaaa-1111';
const SID_B = 'sid-bbbb-2222';

function writeJson(p: string, data: unknown): void {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function wipe(): void {
  for (const f of fs.readdirSync(TMP)) {
    try { fs.unlinkSync(path.join(TMP, f)); } catch { /* ignore */ }
  }
}

beforeEach(wipe);

describe('运行态按会话分文件', () => {
  it('goalStatePath 带 sessionId 时是专属文件，不带时退回全局文件', () => {
    expect(goalStatePath(SID_A)).toBe(path.join(TMP, `goal-state.${SID_A}.json`));
    expect(goalStatePath(null)).toBe(GOAL_STATE_PATH);
    expect(goalStatePath('')).toBe(GOAL_STATE_PATH);
  });

  it('A 会话的运行态不会被 B 会话读到（子代理覆盖场景）', () => {
    writeJson(goalStatePath(SID_A), {
      sessionId: SID_A, enabled: true, status: 'active', objective: 'A 的目标',
    });
    expect(readGoalState(SID_A)?.objective).toBe('A 的目标');
    expect(readGoalState(SID_B)).toBeNull();
  });

  it('两个会话各自的状态互不干扰', () => {
    writeJson(goalStatePath(SID_A), { sessionId: SID_A, enabled: true, status: 'active', objective: 'A' });
    writeJson(goalStatePath(SID_B), { sessionId: SID_B, enabled: true, status: 'active', objective: 'B' });
    expect(readGoalState(SID_A)?.objective).toBe('A');
    expect(readGoalState(SID_B)?.objective).toBe('B');
  });

  it('旧版全局文件作只读兜底：归属本会话才认', () => {
    writeJson(GOAL_STATE_PATH, { sessionId: SID_A, enabled: true, status: 'active', objective: '旧文件' });
    expect(readGoalState(SID_A)?.objective).toBe('旧文件');
    expect(readGoalState(SID_B)).toBeNull();
  });

  it('专属文件优先于全局文件', () => {
    writeJson(GOAL_STATE_PATH, { sessionId: SID_A, enabled: true, status: 'active', objective: '旧' });
    writeJson(goalStatePath(SID_A), { sessionId: SID_A, enabled: true, status: 'active', objective: '新' });
    expect(readGoalState(SID_A)?.objective).toBe('新');
  });
});

describe('clearGoalState', () => {
  it('清掉本会话专属文件', () => {
    writeJson(goalStatePath(SID_A), { sessionId: SID_A, objective: 'A' });
    clearGoalState(SID_A);
    expect(fs.existsSync(goalStatePath(SID_A))).toBe(false);
  });

  it('不碰别的会话的专属文件', () => {
    writeJson(goalStatePath(SID_A), { sessionId: SID_A, objective: 'A' });
    writeJson(goalStatePath(SID_B), { sessionId: SID_B, objective: 'B' });
    clearGoalState(SID_A);
    expect(fs.existsSync(goalStatePath(SID_A))).toBe(false);
    expect(readGoalState(SID_B)?.objective).toBe('B');
  });

  it('全局文件装着别的会话时不动它', () => {
    writeJson(GOAL_STATE_PATH, { sessionId: SID_B, objective: 'B' });
    clearGoalState(SID_A);
    expect(fs.existsSync(GOAL_STATE_PATH)).toBe(true);
  });

  it('全局文件属于本会话时一并清掉', () => {
    writeJson(GOAL_STATE_PATH, { sessionId: SID_A, objective: 'A' });
    clearGoalState(SID_A);
    expect(fs.existsSync(GOAL_STATE_PATH)).toBe(false);
  });
});

describe('武装文件（前端开关）', () => {
  it('写读往返保留 sessionId 与预算', () => {
    writeGoalArm({ enabled: true, objective: '把 README 改对', tokenBudget: 200000, sessionId: SID_A });
    const arm = readGoalArm();
    expect(arm.enabled).toBe(true);
    expect(arm.objective).toBe('把 README 改对');
    expect(arm.tokenBudget).toBe(200000);
    expect(arm.sessionId).toBe(SID_A);
  });

  it('文件缺失时按「未开启」处理（fail-closed，不会误放行 create）', () => {
    expect(readGoalArm().enabled).toBe(false);
  });

  it('文件损坏时也不抛错，按未开启处理', () => {
    fs.writeFileSync(GOAL_ARM_PATH, '{ 坏 json', 'utf8');
    expect(readGoalArm().enabled).toBe(false);
  });
});

describe('provider 能力判定', () => {
  it('支持命名 tool_choice 的 api 才返回 true', () => {
    expect(isForceCapable('openai-completions')).toBe(true);
    expect(isForceCapable('anthropic-messages')).toBe(true);
    expect(isForceCapable('ollama-chat')).toBe(true);
  });

  it('未知 / 缺失一律 false（走软路径，不当成可用）', () => {
    expect(isForceCapable('some-new-api')).toBe(false);
    expect(isForceCapable(undefined)).toBe(false);
    expect(isForceCapable(null)).toBe(false);
  });
});

describe('指令构造', () => {
  it('创建指令走 /force goal，并逐字带目标原文', () => {
    const obj = '核对目标模式端到端链路是否打通';
    const cmd = buildCreateCommand(obj, 50000);
    expect(cmd.startsWith('/force goal ')).toBe(true);
    expect(cmd).toContain(obj);
    expect(cmd).toContain('token_budget 用 50000');
  });

  it('不传预算时不出现 token_budget 行', () => {
    expect(buildCreateCommand('x', null)).not.toContain('token_budget');
    expect(buildCreateCommand('x', 0)).not.toContain('token_budget');
  });

  it('软路径只发目标原文（靠外挂注入指令兜底）', () => {
    expect(buildSoftCreateMessage('目标原文')).toBe('目标原文');
  });

  it('收尾指令区分 complete / drop，且 complete 要求先核对真实状态', () => {
    const c = buildCloseCommand('complete');
    expect(c).toContain('/force goal');
    expect(c).toContain('"complete"');
    expect(c).toContain('核对');
    const d = buildCloseCommand('drop');
    expect(d).toContain('"drop"');
    expect(d).not.toContain('"complete"');
  });
});

describe('目标草稿：转写 + 人审闸门', () => {
  beforeEach(() => {
    for (const f of fs.readdirSync(TMP)) {
      if (f.startsWith('goal-draft')) fs.unlinkSync(path.join(TMP, f));
    }
  });

  it('草稿按会话分文件，A 的草稿不被 B 读到', () => {
    writeGoalDraft({ sessionId: SID_A, ts: 1, status: 'ready', request: 'A 的需求', objective: 'A 的目标', criteria: [], todos: [] });
    expect(goalDraftPath(SID_A)).not.toBe(goalDraftPath(SID_B));
    expect(readGoalDraft(SID_A)?.objective).toBe('A 的目标');
    expect(readGoalDraft(SID_B)).toBeNull();
  });

  it('pending 草稿只属于本会话：外挂据此进入草稿闸门（拦写类工具）', () => {
    writeGoalDraft({ sessionId: SID_A, ts: 1, status: 'pending', request: 'q', objective: '', criteria: [], todos: [] });
    expect(readGoalDraft(SID_A)?.status).toBe('pending');
    // 别的会话读到 pending 会误以为自己也处于草稿阶段 → 必须读不到
    expect(readGoalDraft(SID_B)?.status).toBeUndefined();
    expect(readGoalDraft(SID_B)).toBeNull();
  });

  it('clearGoalDraft 只清本会话，不动别的会话的草稿', () => {
    writeGoalDraft({ sessionId: SID_A, ts: 1, status: 'ready', request: 'a', objective: 'A', criteria: [], todos: [] });
    writeGoalDraft({ sessionId: SID_B, ts: 1, status: 'pending', request: 'b', objective: '', criteria: [], todos: [] });
    clearGoalDraft(SID_A);
    expect(readGoalDraft(SID_A)).toBeNull();
    expect(readGoalDraft(SID_B)?.status).toBe('pending');
  });

  it('composeObjective 把验收标准与步骤一起钉进目标（只留摘要会让「完成」退化成主观判断）', () => {
    const obj = composeObjective({
      objective: 'npm test 从 47 个失败降到 0',
      criteria: ['跑 npm test 全绿', '没有新增 skip'],
      todos: ['跑一遍收集失败清单', '按模块逐个修'],
    });
    expect(obj).toContain('npm test 从 47 个失败降到 0');
    expect(obj).toContain('验收标准');
    expect(obj).toContain('1. 跑 npm test 全绿');
    expect(obj).toContain('执行步骤');
    expect(obj).toContain('1. 跑一遍收集失败清单');
  });

  it('composeObjective 过滤空项，objective 为空串时结果为空（调用方据此报错）', () => {
    // 空 objective + 只留一条非空标准 → 只剩标准段（调用方靠空串判断是否可开始）
    expect(composeObjective({ objective: '   ', criteria: ['', 'x'], todos: [] })).toBe('验收标准：\n1. x');
    expect(composeObjective({ objective: '', criteria: [], todos: [] })).toBe('');
  });

  it('草稿指令要求「只转写不动手」并给出 tiffa-goal 代码块格式', () => {
    const cmd = buildDraftCommand('把所有 TODO 处理掉');
    expect(cmd).toContain('不要动手执行');
    expect(cmd).toContain('把所有 TODO 处理掉');
    expect(cmd).toContain('```tiffa-goal');
    expect(cmd).toContain('"objective"');
    expect(cmd).toContain('禁止');
  });
});
