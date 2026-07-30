// 端到端验证：启动 CLI，发消息，检查记忆注入
import { spawn } from 'child_process';

const env = {
  ...process.env,
  HOME: 'G:/Tiffa/home',
  USERPROFILE: 'G:/Tiffa/home',
  PI_CODING_AGENT_DIR: 'G:/Tiffa/data/agent',
  MNEMOPI_EMBEDDING_MODEL: 'BAAI/bge-small-zh-v1.5',
  PORTABLE_ROOT: 'G:/Tiffa',
};

const child = spawn('G:/Tiffa/npm-global/node_modules/bun/bin/bun.exe', [
  'G:/Tiffa/npm-global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js',
  '--mode', 'rpc-ui',
  '-e', 'G:/Tiffa/plugins/claude-mode-extension.ts',
], { cwd: 'G:/Tiffa/workspace', env, stdio: ['pipe', 'pipe', 'pipe'] });

let output = '';
let gotAgentEnd = false;
let gotMessage = false;
let messageText = '';

child.stdout.on('data', (chunk) => {
  const lines = chunk.toString().split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'ready') console.log('[✓] ready 事件收到');
      if (ev.type === 'response' && ev.success) console.log('[✓] prompt 已接受');
      if (ev.type === 'message_start' && ev.message?.role === 'assistant') {
        gotMessage = true;
        console.log('[✓] assistant 消息开始');
      }
      if (ev.type === 'message_update' && ev.assistantMessageEvent?.type === 'text_delta') {
        messageText += ev.assistantMessageEvent.text || '';
      }
      if (ev.type === 'agent_end') {
        gotAgentEnd = true;
        console.log('[✓] agent_end 收到');
        console.log('\n── AI 回复 ──');
        console.log(messageText.substring(0, 200));
        console.log('\n── 验证结果 ──');
        console.log(gotMessage ? '[✓] 模型正常响应' : '[✗] 未收到模型响应');
        console.log(gotAgentEnd ? '[✓] agent 完整结束' : '[✗] agent 未结束');
        setTimeout(() => { child.kill(); process.exit(0); }, 1000);
      }
      // 检查 stderr 中的记忆日志
    } catch {}
  }
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  // 捕获 mnemopi 和 extension 日志
  if (text.includes('mnemopi') || text.includes('before_agent_start') || text.includes('recall') || text.includes('retain')) {
    const relevant = text.split('\n').filter(l => 
      l.includes('mnemopi') || l.includes('inject') || l.includes('recall') || l.includes('retain') || l.includes('USER.md') || l.includes('PROJECT.md')
    );
    for (const l of relevant) console.log('[LOG]', l.trim().substring(0, 150));
  }
});

// 等 ready 后发 prompt
setTimeout(() => {
  console.log('[..] 发送测试消息...');
  child.stdin.write(JSON.stringify({ type: 'prompt', message: '你好，简短回复一句话', id: 'test1' }) + '\n');
}, 5000);

// 超时保护
setTimeout(() => {
  console.log('\n[!] 60秒超时，强制退出');
  console.log('已收到消息:', gotMessage);
  console.log('已收到 agent_end:', gotAgentEnd);
  if (messageText) console.log('部分回复:', messageText.substring(0, 200));
  child.kill();
  process.exit(1);
}, 60000);
