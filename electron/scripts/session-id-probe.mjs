/**
 * session-id-probe.mjs — 验证「预写会话文件 ⇒ 身份立即确定」。
 *
 * 目的（判断 goal-state 是否存在与草稿链同源的会话 id 漂移）：
 *   goal-state 的写入方是外挂（key = hook id = ctx.sessionManager.getSessionId()），
 *   读取方是主进程（key = inst.sessionId）。若二者在正常路径下必然同名，则无需修；
 *   若内核加载 --session 后会「另起一个 id」，那主进程与外挂就会各拿一套 id → 静默失效。
 *
 * 做法（零 token）：按 prepareNewSessionFile 的格式预写一份 header.id = U 的会话文件，
 *   用 --session 启动内核，ready 后调 get_state，看内核认的 sessionId 是不是 U。
 *
 * 退出码 0 = 内核认的就是 U（身份由预写决定 → goal-state 同源，无需改）。
 * 退出码 2 = 内核换了别的 id（→ 存在漂移，goal-state 需要同法加固）。
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnKernel, PORTABLE_ROOT } from './_kernel.mjs';

// 与 prepareNewSessionFile 对齐
const SESSION_HEADER_VERSION = 1;
const TS = new Date().toISOString().replace(/[:.]/g, '-');
const U = '00000000-1111-4222-8333-444444444444'; // 探针专用固定 uuid，便于肉眼核对

const tmpRoot = path.join(os.tmpdir(), `tiffa-sid-probe-${Date.now()}`);
const sessDir = path.join(tmpRoot, 'sessions');
const projectDir = path.join(sessDir, '--probe--');
fs.mkdirSync(projectDir, { recursive: true });
const sessFile = path.join(projectDir, `${TS}_${U}.jsonl`);
const header = JSON.stringify({
  type: 'session',
  version: SESSION_HEADER_VERSION,
  id: U,
  timestamp: new Date().toISOString(),
  cwd: tmpRoot,
});
fs.writeFileSync(sessFile, header + '\n', 'utf8');
console.log(`预写会话文件: ${path.basename(sessFile)}  header.id=${U}`);

const child = spawnKernel(['--session-dir', sessDir, '--session', sessFile], { cwd: tmpRoot });
child.stderr.on('data', (d) => {
  const s = d.toString().trim();
  if (s) console.error('[stderr]', s.slice(0, 300));
});

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
let seq = 0;
const pending = new Map();
const seenEvents = new Set();
let done = false;
const KEYS = ['sessionId', 'session_id', 'id', 'sessionPath', 'path'];

function send(cmd) {
  const id = `p${++seq}`;
  pending.set(id, cmd.type);
  child.stdin.write(JSON.stringify({ ...cmd, id }) + '\n');
  return id;
}

function finish(code, msg) {
  if (done) return;
  done = true;
  console.log(msg);
  console.log(`收到的事件类型: ${[...seenEvents].join(', ') || '(无)'}`);
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  process.exit(code);
}

setTimeout(() => finish(2, 'TIMEOUT（未拿到 get_state）'), 90000);

function pickSessionish(obj, depth = 0) {
  const out = [];
  if (!obj || typeof obj !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && (KEYS.includes(k) || /session/i.test(k))) out.push(`${k}=${v}`);
    else if (typeof v === 'object') out.push(...pickSessionish(v, depth + 1));
  }
  return out;
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
  if (ev.type) seenEvents.add(ev.type);
  // 内核可能通过 session_switch 事件暴露真实 id
  if (ev.type === 'session_switch' && ev.sessionPath) {
    console.log(`session_switch.sessionPath=${ev.sessionPath}`);
  }
  if (ev.type === 'ready') {
    console.log('ready: 内核就绪');
    send({ type: 'get_state' });
    return;
  }
  if (ev.type === 'response' && pending.has(ev.id)) {
    const kind = pending.get(ev.id);
    pending.delete(ev.id);
    const data = ev.data ?? {};
    const hits = pickSessionish(data);
    console.log(`get_state 里的会话相关字段: ${hits.length ? hits.join(' | ') : '(未找到)'}`);
    console.log(`get_state 顶层字段: ${Object.keys(data).join(', ')}`);
    if (hits.some((h) => h.includes(U))) {
      finish(0, `PASS 内核认的会话 id = 预写 id（${U}）→ 身份由预写决定，goal-state 与草稿不同源`);
    } else {
      finish(2, `DRIFT 内核认的会话 id ≠ 预写 id → 存在漂移，goal-state 需同法加固`);
    }
  }
});

child.on('exit', (c) => {
  if (!done) finish(2, `内核提前退出 code=${c}`);
});
