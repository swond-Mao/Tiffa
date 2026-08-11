/**
 * e2e-smoke.mjs — Tiffa 内核协议端到端冒烟测试（不启 Electron 窗口）。
 *
 * 移植自 dim 项目 oh-my-pi-UI/scripts/e2e-smoke.mjs，改为 Tiffa 便携内核：
 *   spawn 真实 pi-coding-agent（bun + cli.js --mode rpc-ui）→ ready →
 *   get_state → prompt → agent_start → message_update（流式）→ agent_end。
 * 证明 内核协议流 + 模型链路 在真实环境下跑通。
 *
 * 运行：node scripts/e2e-smoke.mjs   （或 npm run test:e2e:smoke）
 * 退出码：0 = PASS，1 = FAIL
 */

import * as readline from 'readline';
import { spawnKernel } from './_kernel.mjs';

const child = spawnKernel(['--no-session']);
child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d.toString()));

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

let phase = 'waiting-ready';
const seen = [];
const deadline = setTimeout(() => {
  console.error(`TIMEOUT. phase=${phase} seen=${seen.join(',')}`);
  child.kill('SIGKILL');
  process.exit(1);
}, 90000);

function send(cmd) {
  child.stdin.write(JSON.stringify(cmd) + '\n');
}

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let f;
  try {
    f = JSON.parse(t);
  } catch {
    return;
  }
  seen.push(f.type);

  if (f.type === 'ready' && phase === 'waiting-ready') {
    console.log('[ok] ready');
    phase = 'get_state';
    send({ id: 's1', type: 'get_state' });
    return;
  }
  if (f.type === 'response' && f.command === 'get_state' && phase === 'get_state') {
    console.log('[ok] get_state success=', f.success, 'model=', f.data?.model?.id);
    phase = 'prompt';
    send({ id: 'p1', type: 'prompt', message: 'Reply with exactly: e2e ok' });
    return;
  }
  if (f.type === 'response' && f.command === 'prompt') {
    console.log('[ok] prompt ack success=', f.success);
    return;
  }
  if (f.type === 'agent_start') {
    console.log('[ok] agent_start');
    return;
  }
  if (f.type === 'message_update' && f.message?.role === 'assistant') {
    const texts = (f.message.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');
    process.stdout.write('\r[stream] ' + texts.slice(-40).padEnd(40));
    return;
  }
  if (f.type === 'agent_end') {
    console.log('\n[ok] agent_end');
    const assistant = (f.messages ?? []).find((m) => m.role === 'assistant');
    const out = (assistant?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');
    console.log('[result] assistant text =', JSON.stringify(out));
    clearTimeout(deadline);
    phase = 'done';
    child.kill('SIGKILL');
  }
});

child.on('exit', (code) => {
  if (phase === 'done') {
    console.log('E2E PASS');
    process.exit(0);
  }
  console.error('\nkernel exited early code=', code, 'phase=', phase, 'seen=', seen.join(','));
  process.exit(1);
});
