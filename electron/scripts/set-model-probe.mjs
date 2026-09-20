/**
 * set-model-probe.mjs — 验证内核 `set_model` 在真实内核上可用（转写切模型功能依赖它）。
 *
 * 不发 prompt，零 token 消耗：ready → get_state → set_model(B) → get_state → set_model(回 A) → get_state。
 * 退出码 0 = set_model 生效并已切回。
 */
import * as readline from 'readline';
import { spawnKernel } from './_kernel.mjs';

const child = spawnKernel(['--no-session']);
child.stderr.on('data', (d) => {
  const s = d.toString().trim();
  if (s) console.error('[stderr]', s.slice(0, 300));
});
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

const TARGET = { provider: 'llama-cpp', modelId: 'qwen3.8-flash-next' };
let seq = 0;
const pending = new Map();
let phase = 'ready';
let original = null;
let afterSwitch = null;
let restored = null;
let done = false;

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
  child.kill('SIGKILL');
  process.exit(code);
}

setTimeout(() => finish(1, `TIMEOUT phase=${phase}`), 60000);

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let ev;
  try {
    ev = JSON.parse(t);
  } catch {
    return;
  }
  if (ev.type === 'ready') {
    console.log('ready: 内核就绪');
    send({ type: 'get_state' });
    return;
  }
  if (ev.type === 'response' && pending.has(ev.id)) {
    const kind = pending.get(ev.id);
    pending.delete(ev.id);
    if (!ev.success) {
      finish(1, `FAIL ${kind} 失败: ${ev.error}`);
      return;
    }
    if (kind === 'get_state') {
      const m = ev.data?.model ?? {};
      const label = `${m.provider || '?'}/${m.id || m.modelId || '?'} api=${m.api || '?'}`;
      if (!original) {
        original = m;
        console.log(`get_state #1 (原始): ${label}`);
        phase = 'switch';
        send({ type: 'set_model', provider: TARGET.provider, modelId: TARGET.modelId });
      } else if (!afterSwitch) {
        afterSwitch = m;
        console.log(`get_state #2 (切换后): ${label}`);
        phase = 'restore';
        send({
          type: 'set_model',
          provider: original.provider || '',
          modelId: original.id || original.modelId || '',
        });
      } else {
        restored = m;
        console.log(`get_state #3 (切回后): ${label}`);
        const okSwitch =
          (afterSwitch.provider || '') === TARGET.provider || (afterSwitch.id || '') === TARGET.modelId;
        const okRestore = (restored.provider || '') === (original.provider || '');
        console.log(`切换生效: ${okSwitch} | 切回一致: ${okRestore}`);
        finish(okSwitch && okRestore ? 0 : 1, okSwitch && okRestore ? 'PASS set_model 可用' : 'FAIL');
      }
      return;
    }
    if (kind === 'set_model') {
      console.log(`set_model ok → ${TARGET.provider}/${TARGET.modelId}`);
      send({ type: 'get_state' });
    }
  }
});

child.on('exit', (c) => {
  if (!done) finish(1, `内核提前退出 code=${c}`);
});
