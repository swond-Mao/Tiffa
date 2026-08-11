/**
 * capture-select.mjs — 抓取真实 extension_ui_request 帧（调试工具）。
 *
 * 移植自 dim 项目 oh-my-pi-UI/scripts/capture-select.mjs：
 *   spawn 真实内核 → prompt → 记录所有帧 → 把 extension_ui_request 帧
 *   摘要打到 stderr，全量帧存 <root>/data/logs/e2e-capture-frames.jsonl。
 * 用于排查 审批/ask 交互帧的字段契约。
 *
 * 运行：node scripts/capture-select.mjs   （或 npm run test:capture）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { PORTABLE_ROOT, spawnKernel } from './_kernel.mjs';

const OUT = path.join(PORTABLE_ROOT, 'data', 'logs', 'e2e-capture-frames.jsonl');
const frames = [];

const child = spawnKernel(['--no-session']);
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

const dump = () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, frames.map((f) => JSON.stringify(f)).join('\n'));
};

const deadline = setTimeout(() => {
  console.error('TIMEOUT; frames captured=', frames.length, '->', OUT);
  dump();
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
  frames.push(f);
  if (f.type === 'extension_ui_request') {
    console.error('[REQ] method=', f.method, 'id=', f.id, 'title=', f.title, 'options=', JSON.stringify(f.options));
  }
  if (f.type === 'ready') {
    console.error('[ok] ready -> sending prompt');
    send({ id: 'p1', type: 'prompt', message: 'Run the command: dir' });
  }
});

child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d.toString()));
child.on('exit', (code) => {
  console.error('kernel exit', code, 'frames=', frames.length, '->', OUT);
  dump();
  clearTimeout(deadline);
  process.exit(0);
});
