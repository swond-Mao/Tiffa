/**
 * TiffaInstanceManager 单元测试（纯 node 运行，无需 Electron）
 *
 * 运行：node main.test.js
 *
 * 桩掉 electron 模块：main.js 在模块顶层调 app.setPath / app.whenReady 等，
 * 用 require.cache 注入一个假 electron，whenReady 永不 resolve，避免触发建窗/IPC。
 * 管理器用假实例注入测试（不 spawn 真实进程），覆盖从 dim 移植的并发逻辑：
 * key 生成、跨 cwd 扫描、sessionId 迁移、LRU 淘汰（跳过 active/运行中/待审批）。
 */

const assert = require('assert');

// ── 1) 桩 electron（必须在 require main.js 之前） ──
const fakeElectron = {
  app: {
    setPath() {},
    whenReady: () => new Promise(() => {}), // 永不 resolve → 不执行 setupIpc/createWindow
    on() {},
    quit() {},
    commandLine: { appendSwitch() {} },
    getPath: () => '',
  },
  ipcMain: { handle() {}, on() {} },
  BrowserWindow: function () {},
  shell: {},
  dialog: {},
  clipboard: {},
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true, exports: fakeElectron,
};

// ── 2) 加载 main.js（桩掉 electron 后，模块顶层不触碰真实 Electron API） ──
const { TiffaInstanceManager, readTailLines, parseSessionLines } = require('./main.js');

// ── 假实例工厂：只包含管理器逻辑需要的字段 ──
function fakeInst(overrides = {}) {
  return {
    sessionId: null,
    cwd: 'C:\\proj',
    ready: true,
    agentRunning: false,
    _pendingAskIds: new Set(),
    lastActiveTime: Date.now(),
    process: { pid: 1000 + Math.floor(Math.random() * 1000) },
    sessionFilePath: null,
    crashCount: 0,
    maxCrashRestart: 3,
    userKilled: false,
    _restartTimer: null,
    killed: false,
    kill() { this.killed = true; },
    ...overrides,
  };
}

let passed = 0;
const pendingTests = [];
function test(name, fn) {
  pendingTests.push({ name, fn });
}
async function runAll() {
  for (const { name, fn } of pendingTests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}\n    ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n结果: ${passed}/${pendingTests.length} 项通过${process.exitCode ? '（有失败）' : ''}`);
}

const CWD = 'C:\\code\\demo';
const SID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

console.log('\n[key 生成]');
test('对话级 key = cwd#sessionId', () => {
  const m = new TiffaInstanceManager();
  assert.strictEqual(m._key(CWD, SID_A), require('path').resolve(CWD) + '#' + SID_A);
});
test('项目级 key = cwd#project', () => {
  const m = new TiffaInstanceManager();
  assert.strictEqual(m._key(CWD, null), require('path').resolve(CWD) + '#project');
});

console.log('\n[getBySessionIdAnywhere 全池扫描]');
test('跨 cwd 按 sessionId 命中后台会话', () => {
  const m = new TiffaInstanceManager();
  const otherCwd = 'D:\\other\\ws';
  m.instances.set(m._key(otherCwd, SID_B), fakeInst({ cwd: otherCwd, sessionId: SID_B }));
  const inst = m.getBySessionIdAnywhere(SID_B);
  assert.ok(inst, '应命中后台 cwd 的实例');
  assert.strictEqual(inst.sessionId, SID_B);
});
test('未命中返回 null', () => {
  const m = new TiffaInstanceManager();
  assert.strictEqual(m.getBySessionIdAnywhere('no-such-id'), null);
});

console.log('\n[migrateSessionId 会话迁移]');
test('实例从旧 key 迁到新 key，activeKey 同步', () => {
  const m = new TiffaInstanceManager();
  const inst = fakeInst({ cwd: CWD, sessionId: SID_A });
  const oldKey = m._key(CWD, SID_A);
  m.instances.set(oldKey, inst);
  m.activeKey = oldKey;
  const ok = m.migrateSessionId(CWD, SID_A, SID_B);
  assert.strictEqual(ok, true);
  assert.ok(!m.instances.has(oldKey), '旧 key 应删除');
  assert.ok(m.instances.has(m._key(CWD, SID_B)), '新 key 应存在');
  assert.strictEqual(m.activeKey, m._key(CWD, SID_B), 'activeKey 应跟随迁移');
});
test('spawning map 同步迁移', () => {
  const m = new TiffaInstanceManager();
  const inst = fakeInst({ cwd: CWD, sessionId: SID_A });
  const oldKey = m._key(CWD, SID_A);
  m.instances.set(oldKey, inst);
  const p = Promise.resolve({ inst, ready: true });
  m.spawning.set(oldKey, p);
  m.migrateSessionId(CWD, SID_A, SID_B);
  assert.ok(!m.spawning.has(oldKey), '旧 spawning key 应删除');
  assert.strictEqual(m.spawning.get(m._key(CWD, SID_B)), p, '新 spawning key 应指向同一 Promise');
});
test('目标 key 已存在：仅删旧 key 不覆盖', () => {
  const m = new TiffaInstanceManager();
  m.instances.set(m._key(CWD, SID_A), fakeInst({ cwd: CWD, sessionId: SID_A }));
  const existing = fakeInst({ cwd: CWD, sessionId: SID_B });
  m.instances.set(m._key(CWD, SID_B), existing);
  const ok = m.migrateSessionId(CWD, SID_A, SID_B);
  assert.strictEqual(ok, false);
  assert.ok(!m.instances.has(m._key(CWD, SID_A)), '旧 key 应删除');
  assert.strictEqual(m.instances.get(m._key(CWD, SID_B)), existing, '既有实例应保留');
});
test('实例不存在时返回 false 不抛错', () => {
  const m = new TiffaInstanceManager();
  assert.strictEqual(m.migrateSessionId(CWD, SID_A, SID_B), false);
});

console.log('\n[LRU 淘汰]');
test('淘汰 lastActiveTime 最旧的实例', () => {
  const m = new TiffaInstanceManager();
  m.instances.set(m._key(CWD, SID_A), fakeInst({ cwd: CWD, sessionId: SID_A, lastActiveTime: 100 }));
  m.instances.set(m._key(CWD, SID_B), fakeInst({ cwd: CWD, sessionId: SID_B, lastActiveTime: 200 }));
  const ok = m._evictLRU();
  assert.strictEqual(ok, true);
  assert.ok(!m.instances.has(m._key(CWD, SID_A)), '最旧的 A 应被淘汰');
  assert.ok(m.instances.has(m._key(CWD, SID_B)), '较新的 B 应保留');
});
test('跳过当前活跃实例', () => {
  const m = new TiffaInstanceManager();
  const activeKey = m._key(CWD, SID_A);
  m.instances.set(activeKey, fakeInst({ cwd: CWD, sessionId: SID_A, lastActiveTime: 0 }));
  m.instances.set(m._key(CWD, SID_B), fakeInst({ cwd: CWD, sessionId: SID_B, lastActiveTime: 200 }));
  m.activeKey = activeKey;
  const ok = m._evictLRU();
  assert.strictEqual(ok, true);
  assert.ok(m.instances.has(activeKey), '活跃实例不得被淘汰');
  assert.ok(!m.instances.has(m._key(CWD, SID_B)), '应淘汰非活跃的 B');
});
test('跳过 agentRunning 的实例', () => {
  const m = new TiffaInstanceManager();
  m.instances.set(m._key(CWD, SID_A), fakeInst({ cwd: CWD, sessionId: SID_A, lastActiveTime: 0, agentRunning: true }));
  m.instances.set(m._key(CWD, SID_B), fakeInst({ cwd: CWD, sessionId: SID_B, lastActiveTime: 200 }));
  const ok = m._evictLRU();
  assert.strictEqual(ok, true);
  assert.ok(m.instances.has(m._key(CWD, SID_A)), '运行中的 A 不得被淘汰');
  assert.ok(!m.instances.has(m._key(CWD, SID_B)), '应淘汰空闲的 B');
});
test('跳过有未应答 ask 的实例（pin 保护）', () => {
  const m = new TiffaInstanceManager();
  const pinned = fakeInst({ cwd: CWD, sessionId: SID_A, lastActiveTime: 0 });
  pinned._pendingAskIds.add('ask-1');
  m.instances.set(m._key(CWD, SID_A), pinned);
  m.instances.set(m._key(CWD, SID_B), fakeInst({ cwd: CWD, sessionId: SID_B, lastActiveTime: 200 }));
  const ok = m._evictLRU();
  assert.strictEqual(ok, true);
  assert.ok(m.instances.has(m._key(CWD, SID_A)), '待审批的 A 不得被淘汰');
  assert.ok(!m.instances.has(m._key(CWD, SID_B)), '应淘汰 B');
});
test('全部不可淘汰时返回 false', () => {
  const m = new TiffaInstanceManager();
  m.instances.set(m._key(CWD, SID_A), fakeInst({ cwd: CWD, sessionId: SID_A, lastActiveTime: 0, agentRunning: true }));
  m.activeKey = m._key(CWD, SID_A);
  assert.strictEqual(m._evictLRU(), false);
});
test('保活窗口内的实例不被优先淘汰', () => {
  const m = new TiffaInstanceManager();
  const now = Date.now();
  // A 刚活跃（1 分钟内，保活窗口内）；B 很久没活跃
  m.instances.set(m._key(CWD, SID_A), fakeInst({ cwd: CWD, sessionId: SID_A, lastActiveTime: now - 60 * 1000 }));
  m.instances.set(m._key(CWD, SID_B), fakeInst({ cwd: CWD, sessionId: SID_B, lastActiveTime: now - 10 * 60 * 1000 }));
  const ok = m._evictLRU();
  assert.strictEqual(ok, true);
  assert.ok(m.instances.has(m._key(CWD, SID_A)), '保活窗口内的 A 应保留');
  assert.ok(!m.instances.has(m._key(CWD, SID_B)), '应淘汰很久未活跃的 B');
});
test('池满且全部在保活窗口内时，回退淘汰最旧的', () => {
  const m = new TiffaInstanceManager();
  const now = Date.now();
  m.instances.set(m._key(CWD, SID_A), fakeInst({ cwd: CWD, sessionId: SID_A, lastActiveTime: now - 60 * 1000 }));
  m.instances.set(m._key(CWD, SID_B), fakeInst({ cwd: CWD, sessionId: SID_B, lastActiveTime: now - 30 * 1000 }));
  const ok = m._evictLRU();
  assert.strictEqual(ok, true, '池满必须腾位，应回退淘汰最旧的');
  assert.ok(!m.instances.has(m._key(CWD, SID_A)), '应回退淘汰保活窗口内最旧的 A');
});

console.log('\n[closeByKey]');
test('关闭后删除实例并清空 activeKey', () => {
  const m = new TiffaInstanceManager();
  const key = m._key(CWD, SID_A);
  const inst = fakeInst({ cwd: CWD, sessionId: SID_A });
  m.instances.set(key, inst);
  m.activeKey = key;
  m.closeByKey(key);
  assert.strictEqual(inst.killed, true, '应调用 kill()');
  assert.ok(!m.instances.has(key), '实例应被移除');
  assert.strictEqual(m.activeKey, null, 'activeKey 应清空');
});

console.log('\n[getStatus]');
test('上报各实例状态字段', () => {
  const m = new TiffaInstanceManager();
  const key = m._key(CWD, SID_A);
  m.instances.set(key, fakeInst({ cwd: CWD, sessionId: SID_A }));
  m.activeKey = key;
  const status = m.getStatus();
  assert.strictEqual(status.length, 1);
  const s = status[0];
  assert.strictEqual(s.key, key);
  assert.strictEqual(s.sessionId, SID_A);
  assert.strictEqual(s.ready, true);
  assert.strictEqual(s.active, true);
  assert.strictEqual(typeof s.lastActiveTime, 'number');
});

console.log('\n[readTailLines 尾部增量读取]');
test('返回文件最后 N 条完整行（时间正序）', async () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), `tiffa-tail-test-${Date.now()}.jsonl`);
  const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ type: 'message', id: `m${i}`, message: { role: 'user', content: `msg ${i}` } }));
  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  try {
    const r = await readTailLines(tmp, 3);
    assert.strictEqual(r.lines.length, 3);
    assert.strictEqual(JSON.parse(r.lines[0]).id, 'm97', '时间正序：最旧在前');
    assert.strictEqual(JSON.parse(r.lines[2]).id, 'm99', '最新在最后');
    assert.strictEqual(r.reachedStart, false, '文件还有更多行 → reachedStart=false');
  } finally { fs.unlinkSync(tmp); }
});
test('文件行数不足时返回全部并标记 reachedStart', async () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), `tiffa-tail-test-${Date.now()}.jsonl`);
  const lines = [JSON.stringify({ type: 'message', id: 'a', message: { role: 'user', content: 'hi' } })];
  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  try {
    const r = await readTailLines(tmp, 5);
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(JSON.parse(r.lines[0]).id, 'a');
    assert.strictEqual(r.reachedStart, true, '读到文件头 → reachedStart=true');
  } finally { fs.unlinkSync(tmp); }
});

console.log('\n[parseSessionLines 消息解析]');
test('解析消息 + toolResult 补全参数', () => {
  const lines = [
    JSON.stringify({ type: 'custom', customType: 'tool_execution_start', data: { toolCallId: 'tc1', toolName: 'read', args: { file: 'a.ts' } } }),
    JSON.stringify({ type: 'message', message: { role: 'user', content: '请读文件' } }),
    JSON.stringify({ type: 'message', message: { role: 'toolResult', toolCallId: 'tc1', content: [{ type: 'text', text: 'OK' }] } }),
  ];
  const msgs = parseSessionLines(lines);
  assert.strictEqual(msgs.length, 2, 'tool_execution_start 不产生消息');
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[1].role, 'assistant', 'toolResult 合并为 assistant');
  assert.strictEqual(msgs[1].toolCalls[0].name, 'read', '从 tool_execution_start 补全工具名');
  assert.strictEqual(msgs[1].toolCalls[0].input.file, 'a.ts', '从 tool_execution_start 补全参数');
});
test('损坏行跳过不报错', () => {
  const msgs = parseSessionLines(['{broken json', '{"type":"message","message":{"role":"user","content":"hi"}}']);
  assert.strictEqual(msgs.length, 1);
});

runAll();
