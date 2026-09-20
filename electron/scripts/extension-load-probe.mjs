/**
 * extension-load-probe.mjs — 验证 Tiffa 外挂（claude-mode-extension.ts）能被内核正确加载。
 *
 * 为什么需要它：外挂是 `.ts`，由 Bun **直接加载、不经过 tsc** —— 没有任何编译检查会跑它。
 * 改了外挂源码（哪怕只是加了几行）如果不验证加载，出错时外挂会**整个失效**（比不修更糟），
 * 而且症状是"注入/守卫全都静默不生效"，极难从产品侧看出来。
 *
 * 判据（零 token）：外挂启动时会往 `data/log/claude-mode.log` 写
 *   `[init] === claude-mode extension loaded (vX) === | pid: <pid>`
 * 拿这个 pid 与内核子进程的 pid 比对 —— 相等 = **本次启动确实加载了我们改的这份外挂**。
 *
 * ⚠️ 不要用 `get_state.dumpTools` 判断外挂是否加载：它只列 11 个工具，而外挂日志显示
 *    内核实际有 21~22 个（外挂还会 `tools updated` 增删活跃集）。两者语义不同，会误判。
 *
 * 退出码 0 = 外挂已加载；2 = 未加载（去看 stderr 或 claude-mode.log 的报错）。
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { spawnKernel, PORTABLE_ROOT } from './_kernel.mjs';

const PLUGIN_LOG = path.join(PORTABLE_ROOT, 'data', 'log', 'claude-mode.log');

function readLines() {
  try {
    return fs.readFileSync(PLUGIN_LOG, 'utf8').split('\n');
  } catch {
    return [];
  }
}

const before = readLines().length;
const child = spawnKernel(['--no-session'], { plugins: true });
const errLines = [];
child.stderr.on('data', (d) => {
  const s = d.toString().trim();
  if (!s) return;
  for (const line of s.split('\n')) errLines.push(line.slice(0, 300));
});

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
let done = false;

function finish(code, msg) {
  if (done) return;
  done = true;
  console.log(msg);
  if (errLines.length) console.log(`stderr: ${errLines.slice(0, 5).join(' | ')}`);
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  process.exit(code);
}

setTimeout(() => finish(2, 'TIMEOUT（90s 内未判定）'), 90000);

function judge() {
  const fresh = readLines().slice(before);
  const loaded = fresh.find((l) => l.includes('extension loaded'));
  const sid = child.pid;
  const started = fresh.filter((l) => /\[(init|session_start)/.test(l)).slice(0, 6);
  console.log(`本次启动新增外挂日志 ${fresh.length} 行`);
  if (fresh.length) console.log(`  样例:\n  ${started.map((l) => l.trim()).join('\n  ')}`);
  if (!loaded) {
    finish(2, `FAIL 本次启动没有 "extension loaded" 记录（内核 pid=${sid}）→ 外挂未加载或加载即报错`);
    return;
  }
  const ok = String(sid) && loaded.includes(`pid: ${sid}`);
  finish(
    ok ? 0 : 2,
    ok
      ? `PASS 外挂已加载（pid=${sid}，与内核子进程一致）`
      : `WARN 有 loaded 记录但 pid 不匹配（内核 pid=${sid}，日志: ${loaded.trim().slice(0, 120)}）`,
  );
}

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let ev;
  try {
    ev = JSON.parse(t);
  } catch {
    return;
  }
  // ready 之后外挂还要跑 session_start（约 1s），延迟再读日志
  if (ev.type === 'ready') setTimeout(judge, 4000);
});

child.on('exit', (c) => {
  if (!done) finish(2, `内核提前退出 code=${c}`);
});
