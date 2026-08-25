/**
 * ask-dialog-e2e.mjs — ask 多问题 askDialog 协议端到端测试（真实内核 + 模型，不启 Electron）
 *
 * 验证内核补丁（healKernelAskDialog 打入的 askDialog 方法）全链路：
 *   spawn 内核(rpc-ui) → ready → prompt 让模型调 ask 工具问 3 题
 *   → 断言收到 method=askDialog 的整批请求 → 回传 {kind:submit, results}
 *   → 断言 ask 工具结果包含 3 题答案。
 * 若补丁缺失/失效，内核会退回逐题 select（[warn] 分支），测试判 FAIL。
 *
 * 用法：node scripts/ask-dialog-e2e.mjs   （或 npm run test:e2e:ask-dialog）
 * 退出码：0 = PASS，1 = FAIL
 */
import * as readline from 'readline';
import { spawnKernel } from './_kernel.mjs';

const child = spawnKernel(['--no-session']);
child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d.toString()));
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

const EXPECTED = [
  { id: 'proto_q1', pick: ['2'] },
  { id: 'proto_q2', pick: ['A', 'C'] },
  { id: 'proto_q3', pick: ['Y'] },
];
const PROMPT = [
  '请立即调用 ask 工具向用户提问以下 3 个问题（这是你唯一要做的动作，不要调用其他工具，不要输出多余文本）：',
  '第 1 题：id="proto_q1"，question="问题一：1+1 等于几？"，options=[{"label":"2"},{"label":"3"}]，recommended=0',
  '第 2 题：id="proto_q2"，question="问题二：请挑两项"，multi=true，options=[{"label":"A"},{"label":"B"},{"label":"C"}]',
  '第 3 题：id="proto_q3"，question="问题三：选一个"，options=[{"label":"X"},{"label":"Y"}]',
].join('\n');

let phase = 'waiting-ready';
let askReq = null;
let askResult = null;
const seen = [];
const deadline = setTimeout(() => {
  console.error(`TIMEOUT. phase=${phase} askReq=${askReq ? askReq.method : null} seen=${seen.slice(0, 30).join(',')}`);
  child.kill('SIGKILL');
  process.exit(1);
}, 180000);

const send = (cmd) => child.stdin.write(JSON.stringify(cmd) + '\n');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  child.kill('SIGKILL');
  process.exit(1);
}
let multiSteps = 0; // 降级路径 multi 题已作答轮数

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let f;
  try { f = JSON.parse(t); } catch { return; }
  seen.push(f.type);

  if (f.type === 'ready' && phase === 'waiting-ready') {
    phase = 'prompt';
    send({ id: 'p1', type: 'prompt', message: PROMPT });
    return;
  }
  if (f.type === 'extension_ui_request' && f.method === 'askDialog' && !askReq) {
    askReq = f;
    const qs = Array.isArray(f.questions) ? f.questions : [];
    console.log(`[ok] askDialog request: ${qs.length} questions, ids=${JSON.stringify(qs.map((q) => q.id))}`);
    if (qs.length !== EXPECTED.length) fail(`question count ${qs.length} != ${EXPECTED.length}`);
    for (const exp of EXPECTED) {
      const q = qs.find((x) => x.id === exp.id);
      if (!q) fail(`question ${exp.id} missing`);
    }
    // 回传应答：按请求里的问题顺序给结果（id 必须与请求一致）
    const results = qs.map((q) => ({
      id: q.id,
      selectedOptions: EXPECTED.find((e) => e.id === q.id).pick,
    }));
    setTimeout(() => send({ type: 'extension_ui_response', id: f.id, value: { kind: 'submit', results } }), 50);
    console.log(`[ok] responded with ${results.length} results`);
    return;
  }
  if (f.type === 'extension_ui_request') {
    // 未打补丁的降级路径（逐题 select）——模拟真人作答：
    // 单题直接选目标项；multi 题依次勾选后走「Other (type your own)」→ editor 提交
    // （无补丁内核在 allowForward 下不显示「Done selecting」，Other 是唯一提交出口）。
    // 内核不崩溃 + 三题都有答案 = 降级 UX 可用（测试整体仍判 FAIL，因为目标是 askDialog 通道）。
    if (f.method === 'select' && !askReq) {
      const title = String(f.title || '');
      const opts = (Array.isArray(f.options) ? f.options : []).map((o) => (typeof o === 'string' ? o : o?.label));
      let pick;
      if (title.includes('问题二')) {
        const seq = ['A', 'C'];
        const step = multiSteps++;
        const otherOpt = opts.find((o) => o && o.includes('Other'));
        pick = step < seq.length ? seq[step] : (otherOpt || opts[0]);
      } else if (title.includes('问题一')) {
        pick = '2';
      } else if (title.includes('问题三')) {
        pick = 'Y';
      } else {
        pick = opts[0];
      }
      if (pick) setTimeout(() => send({ type: 'extension_ui_response', id: f.id, value: pick }), 50);
      console.log(`[warn] select fallback: title=${title.slice(0, 40)} pick=${pick}`);
    }
    if (f.method === 'editor' && !askReq) {
      // multi 题经「Other」进入的 editor：回传自定义文本即完成该题
      setTimeout(() => send({ type: 'extension_ui_response', id: f.id, value: '完成' }), 50);
      console.log('[warn] editor fallback: respond 完成');
    }
    return;
  }
  // ask 工具结果：找 toolResult 消息
  const m = f.message || f.data;
  if (m && m.role === 'toolResult' && m.toolName === 'ask' && !askResult) {
    askResult = m;
    const text = (m.content || []).map((c) => c.text || '').join('\n');
    const details = m.details || {};
    const results = Array.isArray(details.results) ? details.results : [];
    console.log(`[ok] ask tool result text=${JSON.stringify(text.slice(0, 200))}`);
    for (const exp of EXPECTED) {
      const hit = text.includes(exp.id) && exp.pick.every((p) => text.includes(p));
      const det = results.find((r) => r.id === exp.id);
      if (!hit && !(det && exp.pick.every((p) => (det.selectedOptions || []).includes(p)))) {
        fail(`answer for ${exp.id} not found in tool result`);
      }
    }
    console.log('[ok] all 3 answers present in tool result');
  }
  if (f.type === 'agent_end') {
    if (askReq && askResult) {
      console.log('\nE2E PASS (askDialog full chain)');
      clearTimeout(deadline);
      child.kill('SIGKILL');
      process.exit(0);
    } else {
      fail(`agent_end but askReq=${!!askReq} askResult=${!!askResult}`);
    }
  }
});

child.on('exit', () => {
  if (phase !== 'done' && !askResult) {
    console.error(`kernel exited early. phase=${phase} seen=${seen.slice(0, 30).join(',')}`);
    process.exit(1);
  }
});
