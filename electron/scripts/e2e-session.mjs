/**
 * e2e-session.mjs — Tiffa 内核会话命令端到端测试（不启 Electron 窗口）。
 *
 * 移植自 dim 项目 oh-my-pi-UI/scripts/e2e-session.mjs：
 *   ready → get_messages → get_session_stats
 * 证明 会话读取命令链路 在真实内核上可用。
 *
 * 运行：node scripts/e2e-session.mjs   （或 npm run test:e2e:session）
 * 退出码：0 = PASS，1 = FAIL
 */

import * as readline from 'readline';
import { spawnKernel } from './_kernel.mjs';

const child = spawnKernel(['--no-session']);
child.stderr.on('data', () => {}); // 静默 stderr，失败时由 exit 分支报错

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

let step = 'ready';
const deadline = setTimeout(() => {
  console.error(`TIMEOUT step=${step}`);
  child.kill('SIGKILL');
  process.exit(1);
}, 30000);

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
  if (f.type === 'ready' && step === 'ready') {
    console.log('[ok] ready');
    step = 'gm';
    send({ id: '1', type: 'get_messages' });
  } else if (f.type === 'response' && f.command === 'get_messages' && step === 'gm') {
    console.log('[ok] get_messages success=', f.success, 'count=', (f.data?.messages ?? []).length);
    step = 'gs';
    send({ id: '2', type: 'get_session_stats' });
  } else if (f.type === 'response' && f.command === 'get_session_stats' && step === 'gs') {
    console.log('[ok] get_session_stats success=', f.success);
    step = 'done';
    clearTimeout(deadline);
    child.kill('SIGKILL');
    console.log('SESSION-CMDS PASS');
    process.exit(0);
  }
});

child.on('exit', (code) => {
  if (step !== 'done') {
    console.error('kernel exited early code=', code, 'step=', step);
    process.exit(1);
  }
});
