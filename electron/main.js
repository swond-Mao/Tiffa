/**
 * Tiffa Desktop - Electron Main Process
 *
 * Manages omp rpc-ui subprocess, IPC communication, and window lifecycle.
 * Protocol: JSONL over stdin/stdout (one JSON object per line)
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync: _execSync } = require('child_process');
const cp = require('child_process');
const yaml = require('js-yaml');
const { parseDocument, Document } = require('yaml');

// ── Configuration ──
// PORTABLE_ROOT: 1) --portable-root CLI arg  2) PORTABLE_ROOT env  3) parent of __dirname
const argRootIdx = process.argv.indexOf('--portable-root');
if (argRootIdx >= 0 && process.argv[argRootIdx + 1]) {
  global.PORTABLE_ROOT = path.resolve(process.argv[argRootIdx + 1]);
} else if (process.env.PORTABLE_ROOT) {
  global.PORTABLE_ROOT = path.resolve(process.env.PORTABLE_ROOT);
} else {
  global.PORTABLE_ROOT = path.resolve(__dirname, '..');
}
const PORTABLE_ROOT = global.PORTABLE_ROOT;
const IS_VERBOSE = process.argv.includes('--verbose');
const BUN_EXE = path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', 'bun', 'bin', 'bun.exe');
const OMP_CLI = path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', '@oh-my-pi', 'pi-coding-agent', 'dist', 'cli.js');
const EXTENSION_PATH = path.join(PORTABLE_ROOT, 'plugins', 'claude-mode-extension.ts');
const DEFAULT_WORKSPACE_DIR = path.join(PORTABLE_ROOT, 'workspace');
let currentWorkspaceDir = DEFAULT_WORKSPACE_DIR;

// ── Windows 进程树杀杀（SIGTERM/SIGKILL 在 Windows 上不可靠） ──
function _killTree(pid, sync = false) {
  if (!pid) return;
  if (process.platform !== 'win32') {
    try { process.kill(pid, 'SIGKILL'); } catch (e) { /* ignore */ }
    return;
  }
  try {
    const args = ['/PID', String(pid), '/T', '/F'];
    if (sync) {
      cp.spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    } else {
      cp.spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    }
  } catch (e) { /* ignore */ }
}

// ── UTF-8 环境变量注入（治理中文乱码） ──
// 乱码根因：omp 内部 spawn bash/powershell 执行命令时，Windows 控制台默认
// codepage 为 CP936（GBK），编码不一致 → 中文文件名/输出变成乱码。
// 策略：尽可能把所有涉及 I/O 编码的运行时环境变量都切到 UTF-8。
function _utf8Env() {
  return {
    // --- POSIX shell (Git Bash / MSYS2 / WSL) ---
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    // --- Python ---
    PYTHONIOENCODING: 'utf-8:replace',   // stdin/stdout/stderr 强制 UTF-8
    PYTHONUTF8: '1',                       // Python 3.7+ 全局 UTF-8 模式
    PYTHONLEGACYWINDOWSSTDIO: 'utf-8',     // Windows 上 Python 控制台 UTF-8 兜底
    // --- General ---
    NO_COLOR: '1',                         // 子进程输出不需要 ANSI 颜色码
  };
}

// ── 代理智能探测 ──
// TUN 模式代理对 Bun fetch() 不生效，需显式设置 HTTPS_PROXY
// 扫描常用代理端口，找到可用的设置到环境变量
const PROXY_PORTS = [21882, 7890, 7891, 10809, 10808, 20171, 8080];
let _detectedProxy = null;

function _detectProxy() {
  if (_detectedProxy) return _detectedProxy;
  // 优先用环境变量中已有的代理
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    _detectedProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    return _detectedProxy;
  }
  // 同步 TCP 探测：对每个常用代理端口尝试连接
  for (const port of PROXY_PORTS) {
    try {
      const result = cp.spawnSync('powershell', [
        '-NoProfile', '-Command',
        `(New-Object System.Net.Sockets.TcpClient).Connect('127.0.0.1',${port})`
      ], { timeout: 2000, windowsHide: true, stdio: 'ignore' });
      if (result.status === 0) {
        _detectedProxy = `http://127.0.0.1:${port}`;
        console.log(`[代理探测] 发现本地代理: ${_detectedProxy}`);
        return _detectedProxy;
      }
    } catch (e) { /* ignore */ }
  }
  console.log('[代理探测] 未发现本地代理');
  return null;
}

// ── Mnemopi Embedding 缓存预置 ──
// mnemopi embed worker 有两阶段缓存：
//   Phase 1 (II2): CWD/local_cache/fast-bge-small-zh-v1.5/ — tokenizer JSON 文件
//   Phase 2 (FlagEmbedding): {home}/.omp/cache/fastembed/fast-bge-small-zh-v1.5/ — ONNX 模型
// 随发布包分发: data/agent/mnemopi/ 下预置 tokenizer.json + model_optimized.onnx 等
const MNEMOPI_TOKENIZER_DIR = path.join(PORTABLE_ROOT, 'local_cache', 'fast-bge-small-zh-v1.5');
const MNEMOPI_ONNX_DIR = path.join(PORTABLE_ROOT, 'home', '.omp', 'cache', 'fastembed', 'fast-bge-small-zh-v1.5');
const MNEMOPI_BUNDLED_DIR = path.join(PORTABLE_ROOT, 'data', 'agent', 'mnemopi');
const MNEMOPI_TOKENIZER_FILES = {
  'config.json': '{"architectures":["BertModel"],"model_type":"bert","hidden_size":512,"num_hidden_layers":4,"num_attention_heads":8,"intermediate_size":2048,"max_position_embeddings":512,"vocab_size":21128,"type_vocab_size":2,"pad_token_id":0,"layer_norm_eps":1e-12}',
  'tokenizer_config.json': '{"do_lower_case":true,"model_type":"bert"}',
  'special_tokens_map.json': '{"unk_token":"[UNK]","sep_token":"[SEP]","pad_token":"[PAD]","cls_token":"[CLS]","mask_token":"[MASK]"}',
};

// 预置 mnemopi embedding 缓存（II2 Phase 1 + FlagEmbedding Phase 2）
// 从 data/agent/mnemopi/ 分发目录复制到 omp 运行时缓存路径
function _ensureEmbeddingCache() {
  // ── Phase 1: II2 tokenizer 缓存 (CWD/local_cache/fast-bge-small-zh-v1.5/) ──
  try {
    if (!fs.existsSync(MNEMOPI_TOKENIZER_DIR)) {
      fs.mkdirSync(MNEMOPI_TOKENIZER_DIR, { recursive: true });
    }
    // 写入精简版元数据文件
    for (const [name, content] of Object.entries(MNEMOPI_TOKENIZER_FILES)) {
      const fp = path.join(MNEMOPI_TOKENIZER_DIR, name);
      if (!fs.existsSync(fp)) {
        fs.writeFileSync(fp, content, 'utf8');
      }
    }
    // tokenizer.json (439KB) 从发布包复制
    const tokenizerJson = path.join(MNEMOPI_TOKENIZER_DIR, 'tokenizer.json');
    if (!fs.existsSync(tokenizerJson) || fs.statSync(tokenizerJson).size < 1000) {
      const src = path.join(MNEMOPI_BUNDLED_DIR, 'tokenizer.json');
      if (fs.existsSync(src) && fs.statSync(src).size > 1000) {
        fs.copyFileSync(src, tokenizerJson);
        console.log('[EmbedCache] Phase 1: tokenizer.json 已预置');
      }
    }
  } catch (e) {
    console.warn('[EmbedCache] Phase 1 预置失败:', e.message);
  }

  // ── Phase 2: FlagEmbedding ONNX 缓存 ({home}/.omp/cache/fastembed/fast-bge-small-zh-v1.5/) ──
  try {
    const onnxModel = path.join(MNEMOPI_ONNX_DIR, 'model_optimized.onnx');
    if (!fs.existsSync(onnxModel) || fs.statSync(onnxModel).size < 1000) {
      const srcOnnx = path.join(MNEMOPI_BUNDLED_DIR, 'model_optimized.onnx');
      if (fs.existsSync(srcOnnx) && fs.statSync(srcOnnx).size > 1000000) {
        if (!fs.existsSync(MNEMOPI_ONNX_DIR)) {
          fs.mkdirSync(MNEMOPI_ONNX_DIR, { recursive: true });
        }
        // 复制 ONNX 模型 (90MB) + 辅助文件
        const filesToCopy = ['model_optimized.onnx', 'ort_config.json', 'vocab.txt', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'config.json'];
        let copied = 0;
        for (const fname of filesToCopy) {
          const src = path.join(MNEMOPI_BUNDLED_DIR, fname);
          const dst = path.join(MNEMOPI_ONNX_DIR, fname);
          if (fs.existsSync(src) && !fs.existsSync(dst)) {
            fs.copyFileSync(src, dst);
            copied++;
          }
        }
        // 补充 config.json（内嵌版可能更完整）
        const configDst = path.join(MNEMOPI_ONNX_DIR, 'config.json');
        if (!fs.existsSync(configDst)) {
          fs.writeFileSync(configDst, MNEMOPI_TOKENIZER_FILES['config.json'], 'utf8');
          copied++;
        }
        console.log(`[EmbedCache] Phase 2: ONNX 模型已预置 (${copied} files)`);
      } else {
        console.log('[EmbedCache] Phase 2: 发布包中无 model_optimized.onnx，首次 embed 需网络下载');
      }
    }
  } catch (e) {
    console.warn('[EmbedCache] Phase 2 预置失败:', e.message);
  }
}

// ── Global State ──
let mainWindow = null;
const OMP_STALL_TIMEOUT = 180000; // 3 分钟无事件视为卡住
const OMP_WATCHDOG_INTERVAL = 30000; // 每 30 秒检查一次
const MAX_INSTANCES = 5; // 最多同时运行的 omp 实例数

// ═══════════════════════════════════════════════════════════════
// OmpInstance: 单个 omp 子进程的完整生命周期管理
// ═══════════════════════════════════════════════════════════════

class OmpInstance {
  constructor(cwd) {
    this.cwd = cwd;
    this.process = null;
    this.rl = null;          // readline.Interface（stdout 逐行解析）
    this.ready = false;
    this.agentRunning = false;
    this.pendingCommands = new Map();
    this.commandId = 0;
    this.lastActiveTime = Date.now();
    this.lastEventTime = Date.now();
    this.stallPhase = 0;
    this.watchdogTimer = null;
    this.forceKilled = false;
    this._userKilled = false;  // 用户主动 kill，不触发崩溃自动重启
    this._pendingCrashContinue = false;  // 崩溃重启后自动续行
    this._askPending = false;  // ask 工具等待用户回复中，看门狗跳过
    this._crashCount = 0;       // 连续崩溃计数
    this._crashResetTimer = null; // 崩溃计数重置定时器
  }

  start() {
    if (this.process) return;
    this._userKilled = false;  // 新启动时重置用户主动关闭标记

    // 确保 mnemopi embed worker 的 fastembed-runtime 依赖已安装
    this._ensureFastembedRuntime();
    _ensureEmbeddingCache();

    // 代理探测：TUN 模式代理对 Bun fetch() 不生效，需显式设置
    const proxy = _detectProxy();
    const env = {
      ...process.env,
      ..._utf8Env(),
      PI_CODING_AGENT_DIR: path.join(PORTABLE_ROOT, 'data', 'agent'),
      HOME: path.join(PORTABLE_ROOT, 'home'),
      USERPROFILE: path.join(PORTABLE_ROOT, 'home'),
      BUN_INSTALL: PORTABLE_ROOT,
      // mnemopi embed worker: HuggingFace 下载用国内镜像
      HF_ENDPOINT: 'https://hf-mirror.com',
    };
    // 有代理时显式注入（Bun 不走系统 TUN）
    if (proxy) {
      env.HTTPS_PROXY = proxy;
      env.HTTP_PROXY = proxy;
    }

    // 调试开关
    if (process.argv.includes('--verbose')) {
      env.PI_PYTHON_IPC_TRACE = '1';
    }

    delete env.NODE_OPTIONS;
    delete env.ELECTRON_RUN_AS_NODE;

    const args = [OMP_CLI, '--mode', 'rpc-ui', '-e', EXTENSION_PATH];

    console.log(`[OmpInstance] Starting omp cwd=${this.cwd}`, BUN_EXE, args.join(' '));

    this.process = spawn(BUN_EXE, args, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: false,
    });

    // 用 readline 逐行解析 stdout（比手动 buffer + split 更健壮）
    this.rl = require('readline').createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,  // 自动处理 \r\n 和 \n
    });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed);
        this._handleEvent(event);
      } catch (e) {
        console.warn(`[OmpInstance:${this._shortCwd()}] 无法解析事件:`, trimmed.substring(0, 200));
      }
    });

    // stderr 落盘 + console
    const stderrLogDir = path.join(PORTABLE_ROOT, '.temp');
    if (!fs.existsSync(stderrLogDir)) fs.mkdirSync(stderrLogDir, { recursive: true });
    const stderrLogFile = path.join(stderrLogDir, `omp-stderr-${new Date().toISOString().slice(0, 10)}.log`);
    this._stderrStream = fs.createWriteStream(stderrLogFile, { flags: 'a' });

    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        console.log(`[omp:stderr:${this._shortCwd()}]`, text);
        this._stderrStream.write(`[${new Date().toISOString()}] ${text}\n`);
      }
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[OmpInstance:${this._shortCwd()}] 已退出:`, { code, signal, forceKilled: this.forceKilled });

      // 拒绝所有待定命令（避免 Promise 永久挂起）
      for (const [id, { reject }] of this.pendingCommands) {
        reject(new Error(`omp process exited (code=${code}, signal=${signal})`));
      }
      this.pendingCommands.clear();

      this._cleanup();
      this.stopWatchdog();

      // 通知渲染进程
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('omp:exited', { code, signal, cwd: this.cwd });
      }

      // 自动重启判断：
      // 1. 被 forceKill 杀掉的（abort-timeout / agent-unresponsive）
      // 2. 进程异常退出（code !== 0 且非用户主动 kill），可能是内部崩溃
      const shouldRestart = this.forceKilled || (code !== 0 && code !== null && !this._userKilled);
      if (shouldRestart) {
        const reason = this.forceKilled ? 'force-killed' : 'crashed';
        this.forceKilled = false;

        // 崩溃计数 + 指数退避，防止死循环
        this._crashCount++;
        clearTimeout(this._crashResetTimer);
        const CRASH_LIMIT = 3; // 连续崩溃 3 次后停止自动续行
        const delay = Math.min(3000 * Math.pow(2, this._crashCount - 1), 60000); // 3s → 6s → 12s，上限 60s

        if (this._crashCount >= CRASH_LIMIT) {
          // 熔断：不再自动续行，让用户介入
          this._pendingCrashContinue = false;
          console.log(`[OmpInstance:${this._shortCwd()}] 连续崩溃 ${this._crashCount} 次，停止自动续行`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('omp:exited', {
              code, signal, cwd: this.cwd,
              crashLoop: true, crashCount: this._crashCount,
            });
          }
          // 5 分钟后重置崩溃计数，允许后续自动恢复
          this._crashResetTimer = setTimeout(() => { this._crashCount = 0; }, 300000);
        } else {
          this._pendingCrashContinue = true;  // 重启后自动续行
          console.log(`[OmpInstance:${this._shortCwd()}] ${reason}，${delay/1000} 秒后自动重启（第${this._crashCount}次）`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('omp:restarting', { reason, cwd: this.cwd, delay, crashCount: this._crashCount });
          }
          const restartCwd = this.cwd;
          setTimeout(() => {
            if (!this.process && mainWindow && !mainWindow.isDestroyed()) {
              console.log(`[OmpInstance:${this._shortCwd()}] 自动重启`);
              this.start();
            }
          }, delay);
        }
      } else {
        // 正常退出，重置崩溃计数
        this._crashCount = 0;
      }
    });

    this.process.on('error', (err) => {
      console.error(`[OmpInstance:${this._shortCwd()}] 启动失败:`, err);
      this.process = null;
    });

    this.startWatchdog();
  }

  kill(sync = false) {
    if (!this.process) return;
    this.forceKilled = false; // 正常关闭不自动重启
    this._userKilled = true;  // 用户主动关闭，不触发崩溃自动重启

    // 借鉴 dimchang：替换 exit handler，防止旧进程 exit 事件
    // 误触发崩溃恢复逻辑（与新的 start() 产生竞态）
    const victim = this.process;
    victim.removeAllListeners('exit');
    victim.on('exit', () => {
      // 旧进程退出是预期行为，静默处理
      console.log(`[OmpInstance:${this._shortCwd()}] 旧进程已退出（主动 kill）`);
    });

    _killTree(victim.pid, sync);
    this._cleanup();
    this.stopWatchdog();
  }

  forceKill(reason) {
    if (!this.process) {
      this.agentRunning = false;
      return;
    }

    this.forceKilled = true;
    console.log(`[OmpInstance:${this._shortCwd()}] forceKill (原因: ${reason})`);

    _killTree(this.process.pid);

    // 通知渲染进程
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omp:stall-killed', { reason, cwd: this.cwd });
    }
  }

  sendCommand(frame) {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin.writable) {
        reject(new Error('omp process not running'));
        return;
      }

      const id = `cmd_${++this.commandId}`;
      frame.id = id;
      this.pendingCommands.set(id, { resolve, reject });

      const line = JSON.stringify(frame) + '\n';
      this.process.stdin.write(line, 'utf8');

      // 调试：记录 sendCommand 发送的关键帧（仅 --verbose 模式）
      if (IS_VERBOSE && (frame.type === 'prompt' || frame.type === 'set_model' || frame.type === 'get_state')) {
        try {
          const p = path.join(PORTABLE_ROOT, '.temp', 'omp-debug.log');
          const summary = frame.type === 'prompt'
            ? `CMD prompt: ${(frame.message || '').substring(0, 80)}`
            : `CMD ${frame.type}: ${JSON.stringify(frame).substring(0, 100)}`;
          fs.appendFileSync(p, `[${new Date().toISOString()}] [${this._shortCwd()}] ${summary}\n`);
        } catch {}
      }

      setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error('Command timeout'));
        }
      }, 5 * 60 * 1000); // 5 分钟：本地大上下文 prefill 可能需 60-90 秒
    });
  }

  sendRaw(frame) {
    if (!this.process || !this.process.stdin.writable) {
      console.error(`[OmpInstance:${this._shortCwd()}] omp 未运行，无法发送`);
      return;
    }
    const line = JSON.stringify(frame) + '\n';
    this.process.stdin.write(line, 'utf8');
    // 调试：记录发送的帧（仅 --verbose 模式）
    if (IS_VERBOSE) {
      try {
        const p = path.join(PORTABLE_ROOT, '.temp', 'omp-debug.log');
        const summary = frame.type === 'prompt'
          ? `SEND prompt: ${(frame.message || '').substring(0, 80)}`
          : `SEND ${frame.type}: ${JSON.stringify(frame).substring(0, 100)}`;
        fs.appendFileSync(p, `[${new Date().toISOString()}] [${this._shortCwd()}] ${summary}\n`);
      } catch {}
    }
  }

  // ── 看门狗 ──

  startWatchdog() {
    this.stopWatchdog();
    this.lastEventTime = Date.now();
    this.stallPhase = 0;
    this.watchdogTimer = setInterval(() => {
      if (!this.agentRunning || !this.process) {
        this.stallPhase = 0;
        return;
      }
      // ask 工具等待用户回复时完全跳过看门狗检查
      if (this._askPending) {
        return;
      }
      const elapsed = Date.now() - this.lastEventTime;

      if (this.stallPhase === 0 && elapsed > OMP_STALL_TIMEOUT) {
        this.stallPhase = 1;
        console.warn(`[看门狗:${this._shortCwd()}] 第一级：${Math.round(elapsed / 1000)}秒无事件，通知 agent`);
        this.sendRaw({ type: 'abort' });
        this.sendRaw({
          type: 'steer',
          message: `[系统提示] 你的工具执行已超过 ${Math.round(elapsed / 1000)} 秒无响应，可能卡住了。已发送中止信号。请考虑：1) 重试该工具调用 2) 换一种方式完成任务 3) 跳过此步骤继续。`,
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('omp:stall-warning', {
            elapsed: Math.round(elapsed / 1000),
            phase: 'notified',
            cwd: this.cwd,
          });
        }
      }

      if (this.stallPhase === 1 && elapsed > OMP_STALL_TIMEOUT + 30000) {
        this.stallPhase = 2;
        console.error(`[看门狗:${this._shortCwd()}] 第二级：通知 agent 后 30 秒仍未恢复，强制终止`);
        this.forceKill('agent-unresponsive');
      }
    }, OMP_WATCHDOG_INTERVAL);
  }

  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.stallPhase = 0;
  }

  // ── 事件处理 ──

  _handleEvent(event) {
    this.lastEventTime = Date.now();
    this.lastActiveTime = Date.now();

    // 如果之前处于 stall 状态，现在收到事件说明 agent 恢复了
    if (this.stallPhase > 0 && this.agentRunning) {
      console.log(`[看门狗:${this._shortCwd()}] agent 已恢复，重置 stall 状态`);
      this.stallPhase = 0;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('omp:stall-recovered', { cwd: this.cwd });
      }
    }

    // ask 工具等待用户回复时暂停看门狗（用户思考不是卡住）
    if (event.type === 'tool_execution_start' && event.toolName === 'ask') {
      console.log(`[看门狗:${this._shortCwd()}] ask 工具等待用户回复，暂停超时检测`);
      this._askPending = true;
      this.stallPhase = 0;
    }
    // ask 工具返回结果后恢复看门狗
    if (event.type === 'tool_execution_end' && event.toolName === 'ask') {
      console.log(`[看门狗:${this._shortCwd()}] ask 工具已回复，恢复超时检测`);
      this._askPending = false;
      this.lastEventTime = Date.now();
    }

    if (event.type === 'ready') {
      this.ready = true;
      this.agentRunning = false;
      console.log(`[OmpInstance:${this._shortCwd()}] 就绪`);

      // warmup 机制已移除：用户首条消息自然触发 mnemopi embed worker 初始化
      // 无需自动发送 __warmup__，避免 60 秒阻塞 + JSONL 污染 + 事件过滤 bug

      // 崩溃/forceKill 重启后自动续行（gap-fill 由扩展自动注入）
      if (this._pendingCrashContinue) {
        this._pendingCrashContinue = false;
        console.log(`[OmpInstance:${this._shortCwd()}] 崩溃重启就绪，2秒后自动续行`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('omp:crash-recovered', { cwd: this.cwd });
        }
        setTimeout(() => {
          if (this.process && this.ready && !this.agentRunning) {
            console.log(`[OmpInstance:${this._shortCwd()}] 发送自动续行消息`);
            this.sendRaw({ type: 'prompt', message: '进程异常重启，请继续之前的任务。' });
          }
        }, 2000);
      }
    }

    if (event.type === 'prompt_result' && event.agentInvoked) {
      this.agentRunning = true;
    } else if (event.type === 'agent_start') {
      this.agentRunning = true;
    } else if (event.type === 'agent_end') {
      this.agentRunning = false;
    }

    // Handle command responses
    if (event.type === 'response' && event.id && this.pendingCommands.has(event.id)) {
      const { resolve, reject } = this.pendingCommands.get(event.id);
      this.pendingCommands.delete(event.id);
      if (event.success) {
        resolve(event.data);
      } else {
        reject(new Error(event.error || 'Command failed'));
      }
      return;
    }

    // Forward all events to renderer (带 cwd 标记)
    event._cwd = this.cwd;

    // 调试：记录关键事件到日志文件（仅 --verbose 模式）
    if (IS_VERBOSE) {
      const _debugLog = (msg) => {
        try {
          const p = path.join(PORTABLE_ROOT, '.temp', 'omp-debug.log');
          fs.appendFileSync(p, `[${new Date().toISOString()}] [${this._shortCwd()}] ${msg}\n`);
        } catch {}
      };
      if (event.type === 'ready' || event.type === 'agent_start' || event.type === 'agent_end'
        || event.type === 'message_start' || event.type === 'message_end'
        || event.type === 'prompt_result' || event.type === 'turn_start' || event.type === 'turn_end') {
        _debugLog(`${event.type} ${event.agentInvoked ? 'agentInvoked' : ''} ${event.role || ''} ${event.model || ''}`);
      } else if (event.type === 'text_delta' || event.type === 'thinking_delta') {
        if (!this._lastDeltaLogged || Date.now() - this._lastDeltaLogged > 5000) {
          _debugLog(`${event.type} (delta logged, skipping rest for 5s)`);
          this._lastDeltaLogged = Date.now();
        }
      } else if (event.type === 'error') {
        _debugLog(`ERROR: ${JSON.stringify(event).substring(0, 200)}`);
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omp:event', event);
    }
  }

  _cleanup() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this._stderrStream) {
      this._stderrStream.end();
      this._stderrStream = null;
    }
    this.process = null;
    this.ready = false;
    this.agentRunning = false;
  }

  _shortCwd() {
    const parts = this.cwd.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || this.cwd;
  }

  // 确保 mnemopi embed worker 的 fastembed-runtime 依赖已安装
  // 如果 node_modules 缺失，omp 首次 prompt 会花 60+ 秒做 bun install
  // 预装后首次 prompt 仅需 ~1.2s
  _ensureFastembedRuntime() {
    try {
      const runtimeDir = path.join(PORTABLE_ROOT, 'home', '.omp', 'cache', 'fastembed-runtime');
      // 找到实际的版本目录（如 fastembed-2.1.0_transitive-ort）
      if (!fs.existsSync(runtimeDir)) return;
      const versionDirs = fs.readdirSync(runtimeDir).filter(d => d.startsWith('fastembed-'));
      if (versionDirs.length === 0) return;

      for (const vDir of versionDirs) {
        const fullDir = path.join(runtimeDir, vDir);
        const nodeModules = path.join(fullDir, 'node_modules');
        const pkgJson = path.join(fullDir, 'package.json');

        // 如果 package.json 存在但 node_modules 缺失或为空，执行 bun install
        if (fs.existsSync(pkgJson) && (!fs.existsSync(nodeModules) || fs.readdirSync(nodeModules).length === 0)) {
          console.log(`[OmpInstance] 正在预装 fastembed-runtime 依赖: ${vDir}`);
          try {
            const result = cp.spawnSync(BUN_EXE, ['install'], {
              cwd: fullDir,
              windowsHide: true,
              timeout: 60000,
              stdio: 'pipe',
            });
            if (result.status === 0) {
              console.log(`[OmpInstance] fastembed-runtime 依赖预装完成`);
            } else {
              console.warn(`[OmpInstance] fastembed-runtime 预装失败 (exit=${result.status}), 首次消息可能延迟`);
            }
          } catch (e) {
            console.warn(`[OmpInstance] fastembed-runtime 预装异常: ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.warn(`[OmpInstance] 检查 fastembed-runtime 失败: ${e.message}`);
    }
  }

  // 预热完成后清理 JSONL 中的 __warmup__ 记录，避免历史污染和文件膨胀
  _cleanWarmupFromSession() {
    try {
      const sessionsDir = path.join(PORTABLE_ROOT, 'data', 'agent', 'sessions');
      if (!fs.existsSync(sessionsDir)) return;

      // 找最近 60 秒内修改的 JSONL 文件（warmup 刚完成，一定是最新写入的）
      const cutoff = Date.now() - 60000;
      let latestPath = null;
      let latestMtime = 0;

      for (const dir of fs.readdirSync(sessionsDir)) {
        const fullDir = path.join(sessionsDir, dir);
        try { if (!fs.statSync(fullDir).isDirectory()) continue; } catch { continue; }
        for (const f of fs.readdirSync(fullDir)) {
          if (!f.endsWith('.jsonl')) continue;
          const fp = path.join(fullDir, f);
          try {
            const mtime = fs.statSync(fp).mtimeMs;
            if (mtime > cutoff && mtime > latestMtime) {
              latestMtime = mtime;
              latestPath = fp;
            }
          } catch {}
        }
      }

      if (!latestPath) return;

      // 读取并过滤掉 __warmup__ 相关行
      const lines = fs.readFileSync(latestPath, 'utf8').split('\n').filter(l => l.trim());
      let warmupFound = false;
      const filtered = [];
      let skipFollowing = false;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.message) {
            const msg = obj.message;
            const text = typeof msg.content === 'string' ? msg.content
              : Array.isArray(msg.content) ? msg.content.filter(p => p.type === 'text').map(p => p.text).join('')
              : '';
            if (text.trim() === '__warmup__') {
              warmupFound = true;
              skipFollowing = true;
              continue;
            }
            if (skipFollowing && msg.role === 'user') {
              skipFollowing = false;
            }
            if (skipFollowing) continue;
          }
          if (skipFollowing && obj.type === 'custom') continue;
          filtered.push(line);
        } catch {
          if (!skipFollowing) filtered.push(line);
        }
      }

      if (warmupFound) {
        fs.writeFileSync(latestPath, filtered.join('\n') + '\n', 'utf8');
        console.log(`[OmpInstance:${this._shortCwd()}] 已清理 JSONL 中的 __warmup__ 记录`);
      }
    } catch (err) {
      console.error(`[OmpInstance:${this._shortCwd()}] 清理 warmup 记录失败:`, err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// OmpInstanceManager: 多实例管理器（懒启动 + LRU 淘汰）
// ═══════════════════════════════════════════════════════════════

class OmpInstanceManager {
  constructor() {
    this.instances = new Map(); // cwd (normalized) -> OmpInstance
    this.spawning = new Map(); // cwd (normalized) -> Promise<OmpInstance>（防并发重复 spawn）
    this.activeCwd = null;     // 当前活跃实例的 cwd
  }

  // 激活某个 cwd 的实例（懒启动）
  async activate(cwd) {
    const normalized = path.resolve(cwd);
    this.activeCwd = normalized;
    currentWorkspaceDir = normalized;

    // 已存在实例 → 直接复用
    if (this.instances.has(normalized)) {
      const inst = this.instances.get(normalized);
      inst.lastActiveTime = Date.now();
      return inst;
    }

    // 正在 spawn 中 → 复用同一个 Promise，避免并发创建重复进程
    if (this.spawning.has(normalized)) {
      return this.spawning.get(normalized);
    }

    // 超过上限 → LRU 淘汰最久未活跃的
    if (this.instances.size >= MAX_INSTANCES) {
      this._evictLRU();
    }

    // 创建新实例（用 Promise 包装，支持并发 dedup）
    const spawnPromise = (async () => {
      const inst = new OmpInstance(normalized);
      this.instances.set(normalized, inst);
      inst.start();

      // 等待就绪（最多 30 秒，比 15 秒更宽容，避免慢机器上误超时）
      await new Promise((resolve) => {
        let checks = 0;
        const check = setInterval(() => {
          checks++;
          if (inst.ready || checks > 300) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });

      return { inst, ready: inst.ready };
    })();

    this.spawning.set(normalized, spawnPromise);
    try {
      return await spawnPromise;
    } finally {
      this.spawning.delete(normalized);
    }
  }

  // 获取当前活跃实例
  getActive() {
    if (!this.activeCwd) return null;
    return this.instances.get(this.activeCwd) || null;
  }

  // 关闭某个 cwd 的实例
  close(cwd) {
    const normalized = path.resolve(cwd);
    const inst = this.instances.get(normalized);
    if (inst) {
      inst.kill();
      this.instances.delete(normalized);
    }
    if (this.activeCwd === normalized) {
      this.activeCwd = null;
    }
  }

  // 关闭所有实例
  closeAll() {
    for (const inst of this.instances.values()) {
      inst.forceKilled = false; // 正常关闭不自动重启
      inst.kill();
    }
    this.instances.clear();
    this.activeCwd = null;
  }

  // 关闭所有实例（退出时用，同步暴力清理）
  killAll() {
    for (const inst of this.instances.values()) {
      inst.forceKilled = false;
      // 同步杀进程，确保 app 退出前进程真的死透
      if (inst.process) {
        _killTree(inst.process.pid, true);
      }
      // 拒绝所有待定命令
      for (const [id, { reject }] of inst.pendingCommands) {
        reject(new Error('app quitting'));
      }
      inst.pendingCommands.clear();
    }
    this.instances.clear();
    this.spawning.clear();
    this.activeCwd = null;
  }

  // LRU 淘汰：淘汰最久未活跃的非当前实例
  _evictLRU() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [cwd, inst] of this.instances) {
      // 不淘汰当前活跃的
      if (cwd === this.activeCwd) continue;
      if (inst.lastActiveTime < oldestTime) {
        oldestTime = inst.lastActiveTime;
        oldest = cwd;
      }
    }

    if (oldest) {
      console.log(`[OmpManager] LRU 淘汰: ${oldest}`);
      this.close(oldest);
    }
  }

  // 获取所有实例状态（供前端显示）
  getStatus() {
    const result = [];
    for (const [cwd, inst] of this.instances) {
      result.push({
        cwd,
        active: cwd === this.activeCwd,
        ready: inst.ready,
        agentRunning: inst.agentRunning,
        lastActiveTime: inst.lastActiveTime,
      });
    }
    return result;
  }
}

// 全局实例管理器
const ompManager = new OmpInstanceManager();

// ── Window Creation ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Tiffa',
    backgroundColor: '#1a1a2e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for fs access via preload
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 隐藏原生菜单栏
  mainWindow.setMenu(null);

  // 等渲染进程准备好再显示窗口，避免黑屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open dev tools in dev mode
  if (process.argv.includes('--dev') || process.argv.includes('--verbose')) {
    mainWindow.webContents.openDevTools();
  }
}

// ── IPC Handlers ──

function setupIpc() {
  // ── 多实例感知的辅助函数 ──
  // 所有 omp 命令都路由到当前活跃实例

  function _active() {
    const inst = ompManager.getActive();
    if (!inst) throw new Error('No active omp instance');
    return inst;
  }

  // omp commands
  ipcMain.handle('omp:send', async (event, message, images) => {
    // 调试：记录用户消息到达主进程（仅 --verbose 模式）
    if (IS_VERBOSE) {
      try {
        const p = path.join(PORTABLE_ROOT, '.temp', 'omp-debug.log');
        fs.appendFileSync(p, `[${new Date().toISOString()}] [主进程] omp:send 被调用: ${(message || '').substring(0, 80)}\n`);
      } catch {}
    }
    // /omfg 命令拦截：TTSR 规则生成/修复 prompt（OI3 标准格式）
    const omfgMatch = typeof message === 'string' && message.match(/^\/omfg\s*(.+)/);
    if (omfgMatch) {
      const complaint = omfgMatch[1].trim();
      const ruleDir = path.join(PORTABLE_ROOT, 'data', 'agent', 'rules');
      try { if (!fs.existsSync(ruleDir)) fs.mkdirSync(ruleDir, { recursive: true }); } catch {}
      let existingRules = '(无)';
      let existingRuleDetails = '';
      try {
        const files = fs.readdirSync(ruleDir).filter(f => f.endsWith('.md'));
        if (files.length > 0) {
          existingRules = files.join(', ');
          // 读取每条规则的 frontmatter 摘要
          existingRuleDetails = files.map(f => {
            try {
              const content = fs.readFileSync(path.join(ruleDir, f), 'utf8');
              const descMatch = content.match(/^description:\s*"?(.+?)"?\s*$/m);
              const desc = descMatch ? descMatch[1] : '(无描述)';
              return `- ${f}: ${desc}`;
            } catch { return `- ${f}`; }
          }).join('\n');
        }
      } catch {}

      const omfgPrompt = [
        '<omfg>',
        'The user is frustrated about recurring agent behavior.',
        'Author ONE Time Traveling Stream Rule (TTSR) that would have caught the offending behavior earlier in this conversation.',
        '',
        'TTSR mechanics:',
        '- A rule is a markdown file with YAML frontmatter, stored in ' + ruleDir,
        '- `condition` is one or more JavaScript regex patterns tested against assistant streamed output.',
        '- `scope` is a comma-separated allowlist. If present, only listed streams are checked.',
        '- `text` = assistant prose only. `thinking` = hidden reasoning summaries. `tool` = every tool\'s arguments.',
        '- `tool:<name>(<glob>)` = one tool, only when path-like args match the glob.',
        '- SHOULD use file-specific tool scopes for code complaints.',
        '- Tool arguments may be serialized while streaming. Conditions for code containing quotes SHOULD tolerate JSON escaping.',
        '- When `condition` matches within `scope`, the stream is interrupted and the markdown body is injected as correction guidance.',
        '- `interruptMode`: `always` = immediately abort generation, `never` = inject warning without interrupting.',
        '- `repeatMode` (optional): `once` = fire once per session (default), `after-gap` = re-trigger after N messages.',
        '',
        'Action: Write the rule file directly using the write tool.',
        '',
        'File format (markdown with YAML frontmatter):',
        '```',
        '---',
        'description: "One-line summary of what the rule prevents"',
        'condition: "regex pattern or array of patterns"',
        'scope: "text" or "tool:write(*.ts)" or ["tool:edit(*.ts)", "tool:write(*.ts)"]',
        'interruptMode: "always" or "never"',
        '---',
        '',
        'Markdown body explaining the correct behavior.',
        '```',
        '',
        'Guidelines:',
        '- File name MUST be kebab-case with .md extension (e.g. no-hardcoded-secrets.md)',
        '- `condition` MUST match the specific offending output visible in this conversation. Keep it precise; NEVER use broad catch-alls.',
        '- Escape regex backslashes once in YAML: use `"\\beval\\s*\\("`, NOT `"\\\\beval\\\\s*\\\\("`.',
        '- Keep `scope` as narrow as the complaint allows. NEVER use `tool, text` unless the same bad behavior occurred in both.',
        '- If an existing rule has a bug (regex too narrow/broad, wrong scope), fix it directly by rewriting that file.',
        '',
        'Existing rules (avoid duplicates):',
        existingRuleDetails || '(none)',
        '',
        'Complaint:',
        complaint,
        '</omfg>',
      ].join('\n');

      message = omfgPrompt;
      console.log(`[/omfg] intercepted: complaint="${complaint}"`);
    }

    const frame = { type: 'prompt', message };
    if (images && images.length > 0) {
      frame.images = images;
    }
    return _active().sendCommand(frame);
  });

  ipcMain.handle('omp:abort', async () => {
    const inst = _active();
    inst.sendRaw({ type: 'abort' });

    if (inst.process) {
      const pid = inst.process.pid;
      const abortTimeout = setTimeout(() => {
        if (inst.process && inst.process.pid === pid && inst.agentRunning) {
          console.log('[主进程] abort 后 30 秒 agent 未恢复，强制终止');
          inst.forceKill('abort-timeout');
        }
      }, 30000);
      inst.process.once('exit', () => clearTimeout(abortTimeout));
    }
  });

  ipcMain.handle('omp:setModel', async (event, provider, modelId) => {
    return _active().sendCommand({ type: 'set_model', provider, modelId });
  });

  ipcMain.handle('omp:getModels', async () => {
    return _active().sendCommand({ type: 'get_available_models' });
  });

  ipcMain.handle('omp:isReady', async () => {
    const inst = ompManager.getActive();
    return inst ? inst.ready : false;
  });

  ipcMain.handle('omp:diagnostics', async () => {
    const inst = _active();
    if (!inst) return { error: 'no active instance' };
    return {
      ready: inst.ready,
      agentRunning: inst.agentRunning,
      cwd: inst.cwd,
      pid: inst.process?.pid || null,
      stdinWritable: inst.process?.stdin?.writable || false,
      pendingCommands: inst.pendingCommands.size,
    };
  });

  ipcMain.handle('omp:getState', async () => {
    return _active().sendCommand({ type: 'get_state' });
  });

  ipcMain.handle('omp:steer', async (event, message) => {
    _active().sendRaw({ type: 'steer', message });
  });

  ipcMain.handle('omp:extensionResponse', async (event, id, value) => {
    const frame = { type: 'extension_ui_response', id };
    if (value && typeof value === 'object') {
      if ('cancelled' in value) frame.cancelled = true;
      else if ('value' in value) frame.value = value.value;
      else if ('confirmed' in value) frame.value = true;
      else frame.value = value;
    } else {
      frame.value = value;
    }
    _active().sendRaw(frame);
  });

  ipcMain.handle('omp:compact', async () => {
    return _active().sendCommand({ type: 'compact' });
  });

  ipcMain.handle('omp:command', async (event, type, payload) => {
    const frame = { type, ...payload };
    return _active().sendCommand(frame);
  });

  // ── 多实例管理 IPC ──
  ipcMain.handle('omp:activate', async (event, cwd) => {
    try {
      const normalized = path.resolve(cwd);
      // 确保项目注册到 projects.json
      ensureProjectInJson(normalized);
      const result = await ompManager.activate(normalized);
      return { success: true, cwd: ompManager.activeCwd, ready: result.ready };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('omp:instances', async () => {
    return ompManager.getStatus();
  });

  // File system operations (for sidebar)
  ipcMain.handle('fs:listDir', async (event, dirPath) => {
    try {
      const resolvedPath = path.resolve(dirPath || currentWorkspaceDir);
      // Security: only allow within portable root or workspace
      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        path: path.join(resolvedPath, e.name),
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        size: e.isFile() ? fs.statSync(path.join(resolvedPath, e.name)).size : 0,
        ext: e.isFile() ? path.extname(e.name).toLowerCase() : '',
      })).sort((a, b) => {
        // Directories first, then files, alphabetical
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:readFile', async (event, filePath) => {
    try {
      const resolvedPath = path.resolve(filePath);
      const maxSize = 5 * 1024 * 1024; // 5MB limit
      const stat = fs.statSync(resolvedPath);
      if (stat.size > maxSize) {
        return { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, limit 5MB)` };
      }
      const content = fs.readFileSync(resolvedPath, 'utf8');
      const ext = path.extname(resolvedPath).toLowerCase();
      return { content, ext, path: resolvedPath, size: stat.size };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
    try {
      const resolvedPath = path.resolve(filePath);
      // 安全：只允许写入 PORTABLE_ROOT 内
      if (!resolvedPath.startsWith(PORTABLE_ROOT)) {
        return { error: 'Path outside portable root' };
      }
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, content, 'utf8');
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fetch:providerModels', async (event, baseUrl, apiKey) => {
    try {
      const url = baseUrl.replace(/\/+$/, '') + '/models';
      const headers = { 'Accept': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      const data = await resp.json();
      const models = (data.data || []).map(m => ({ id: m.id, name: m.id }));
      return { models };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:readImage', async (event, filePath) => {
    try {
      const resolvedPath = path.resolve(filePath);
      const content = fs.readFileSync(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      };
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      const base64 = content.toString('base64');
      return { base64, mimeType, path: resolvedPath, size: content.length };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Shell operations
  ipcMain.handle('shell:openExternal', async (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('shell:openPath', async (event, filePath) => {
    shell.openPath(filePath);
  });

  // Path helpers
  ipcMain.handle('path:workspace', async () => currentWorkspaceDir);
  ipcMain.handle('path:root', async () => PORTABLE_ROOT);

  // ── XML Translation Toggle ──
  const XML_TRANSLATION_ENABLED_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'xml-translation-enabled');

  ipcMain.handle('xml-translation:status', async () => {
    try {
      if (!fs.existsSync(XML_TRANSLATION_ENABLED_FILE)) return { enabled: false };
      const content = fs.readFileSync(XML_TRANSLATION_ENABLED_FILE, 'utf8').trim();
      return { enabled: content === 'true' };
    } catch (err) {
      return { enabled: false };
    }
  });

  ipcMain.handle('xml-translation:toggle', async (event, enabled) => {
    try {
      const dir = path.dirname(XML_TRANSLATION_ENABLED_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(XML_TRANSLATION_ENABLED_FILE, enabled ? 'true' : 'false', 'utf8');
      console.log(`[主进程] XML 翻译开关: ${enabled ? 'ON' : 'OFF'}`);
      return { enabled };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Models.yml config ──
  const MODELS_YML = path.join(PORTABLE_ROOT, 'data', 'agent', 'models.yml');
  const MODELS_YML_BACKUP = MODELS_YML + '.bak';

  ipcMain.handle('models:read', async () => {
    try {
      if (!fs.existsSync(MODELS_YML)) {
        return { error: 'models.yml not found' };
      }
      const raw = fs.readFileSync(MODELS_YML, 'utf8');
      const data = yaml.load(raw);
      return { data, raw };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('models:write', async (event, yamlContent) => {
    try {
      // Validate YAML before writing
      yaml.load(yamlContent);

      // Backup current file
      if (fs.existsSync(MODELS_YML)) {
        fs.copyFileSync(MODELS_YML, MODELS_YML_BACKUP);
      }

      fs.writeFileSync(MODELS_YML, yamlContent, 'utf8');
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('models:restart', async () => {
    try {
      // 重启所有实例（模型配置变更后）
      const cwds = [...ompManager.instances.keys()];
      ompManager.closeAll();
      await new Promise(resolve => setTimeout(resolve, 500));
      // 恢复之前的活跃实例
      for (const cwd of cwds) {
        await ompManager.activate(cwd);
      }
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── YAML 注释保留式写入/删除 provider ──
  // 用 yaml 包的 parseDocument + setIn/deleteIn，只改 providers.<id> 子树
  // 保留用户手写的注释、其他 provider、顶层字段
  ipcMain.handle('models:writeProvider', async (event, providerId, cfg) => {
    try {
      if (!providerId || !/^[a-zA-Z0-9_-]+$/.test(providerId)) {
        return { error: `provider id 不合法（只允许字母/数字/-/_）: ${providerId}` };
      }
      // 清理 undefined/null/空值
      const clean = {};
      for (const [k, v] of Object.entries(cfg)) {
        if (v !== undefined && v !== null && v !== '') clean[k] = v;
      }
      // 加载 YAML Document（保注释）
      let doc;
      if (fs.existsSync(MODELS_YML)) {
        const raw = fs.readFileSync(MODELS_YML, 'utf8');
        doc = parseDocument(raw);
        if (doc.errors.length > 0) {
          return { error: `models.yml 解析失败（${doc.errors[0].message}），为避免破坏原文件已中止写入` };
        }
      } else {
        doc = new Document({});
      }
      doc.setIn(['providers', providerId], doc.createNode(clean));
      fs.mkdirSync(path.dirname(MODELS_YML), { recursive: true });
      fs.writeFileSync(MODELS_YML, doc.toString(), 'utf8');
      console.log(`[主进程] 已写入 provider: ${providerId}`);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('models:deleteProvider', async (event, providerId) => {
    try {
      if (!fs.existsSync(MODELS_YML)) return { success: true };
      const raw = fs.readFileSync(MODELS_YML, 'utf8');
      const doc = parseDocument(raw);
      if (doc.errors.length > 0) {
        return { error: `models.yml 解析失败，已中止` };
      }
      doc.deleteIn(['providers', providerId]);
      fs.writeFileSync(MODELS_YML, doc.toString(), 'utf8');
      console.log(`[主进程] 已删除 provider: ${providerId}`);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Config.yml approval mode ──
  const CONFIG_YML = path.join(PORTABLE_ROOT, 'data', 'agent', 'config.yml');
  // 前端模式名 → omp 配置值
  const OMP_APPROVAL_MODE_MAP = { normal: 'always-ask', auto: 'write', yolo: 'yolo' };

  ipcMain.handle('config:writeApprovalMode', async (event, tiffaMode) => {
    try {
      const ompMode = OMP_APPROVAL_MODE_MAP[tiffaMode] || 'yolo';
      let doc;
      if (fs.existsSync(CONFIG_YML)) {
        const raw = fs.readFileSync(CONFIG_YML, 'utf8');
        doc = parseDocument(raw);
      } else {
        doc = new Document();
      }
      doc.set('tools', doc.get('tools') || doc.createNode({}));
      doc.get('tools').set('approvalMode', ompMode);
      fs.writeFileSync(CONFIG_YML, doc.toString(), 'utf8');
      return { success: true, ompMode };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Workspace / Project management ──

  // 打开文件夹选择器
  ipcMain.handle('workspace:openFolderDialog', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择项目文件夹',
        defaultPath: currentWorkspaceDir,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const selected = result.filePaths[0];
      // 不允许选择 workspace 根目录本身
      if (path.resolve(selected) === DEFAULT_WORKSPACE_DIR) {
        return { error: '不能选择工作区根目录作为项目，请选择其子文件夹' };
      }
      return { canceled: false, path: selected };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 切换工作区（懒启动新实例或复用已有实例）
  ipcMain.handle('workspace:change', async (event, newCwd) => {
    try {
      if (!newCwd) {
        return { error: '路径为空' };
      }
      let resolved = path.resolve(newCwd);
      // workspace 下的项目如果目录不存在，自动创建
      if (!fs.existsSync(resolved)) {
        const wsSuffix = extractWorkspaceSuffix(resolved);
        if (wsSuffix) {
          fs.mkdirSync(resolved, { recursive: true });
          console.log(`[workspace] 自动创建项目目录: ${resolved}`);
        } else {
          return { error: '路径不存在' };
        }
      }
      // 注册到 projects.json
      ensureProjectInJson(resolved);
      // 激活（懒启动或复用）
      await ompManager.activate(resolved);
      return { success: true, cwd: ompManager.activeCwd };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Session / Project management ──
  const SESSIONS_DIR = path.join(PORTABLE_ROOT, 'data', 'agent', 'sessions');
  const ARCHIVE_DIR = path.join(PORTABLE_ROOT, 'data', 'agent', 'sessions-archive');
  const PROJECTS_JSON = path.join(PORTABLE_ROOT, 'data', 'agent', 'projects.json');
  const REMOVED_CWDS_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'removed-cwds.json');

  function readRemovedCwds() {
    try {
      if (fs.existsSync(REMOVED_CWDS_FILE)) return JSON.parse(fs.readFileSync(REMOVED_CWDS_FILE, 'utf8'));
    } catch {}
    return [];
  }
  function writeRemovedCwds(list) {
    fs.writeFileSync(REMOVED_CWDS_FILE, JSON.stringify(list), 'utf8');
  }

  // 递归删除目录
  function rimraf(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) rimraf(full);
      else fs.unlinkSync(full);
    }
    fs.rmdirSync(dirPath);
  }

  // ── projects.json 读写 ──
  // 格式: { projects: [ { cwd, displayName, addedAt, lastOpenedAt, archived }, ... ] }
  function readProjectsJson() {
    try {
      if (fs.existsSync(PROJECTS_JSON)) {
        const raw = fs.readFileSync(PROJECTS_JSON, 'utf8');
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.projects)) return data.projects;
      }
    } catch {}
    return [];
  }

  function writeProjectsJson(projects) {
    try {
      fs.writeFileSync(PROJECTS_JSON, JSON.stringify({ projects }, null, 2), 'utf8');
    } catch {}
  }

  // 确保项目在 projects.json 中（不存在则添加，已存在则更新 lastOpenedAt）
  // 用 workspace 后缀匹配，解决移动硬盘换盘符导致的重复问题
  // 写入前去重：防止任何来源的重复（IPC 并发、启动迁移等）
  function ensureProjectInJson(cwd) {
    const normalized = path.resolve(cwd);
    // workspace 根目录不作为项目
    if (normalized === DEFAULT_WORKSPACE_DIR) return normalized;
    // 防御：路径在磁盘上不存在则不注册（避免幽灵项目）
    // 但 workspace 下的项目允许不存在（换电脑后子目录可能还没创建）
    if (!fs.existsSync(normalized)) {
      if (extractWorkspaceSuffix(normalized)) {
        // 自动创建 workspace 子目录
        fs.mkdirSync(normalized, { recursive: true });
        console.log(`[projects] 自动创建项目目录: ${normalized}`);
      } else {
        console.warn('[projects] 路径不存在，跳过注册:', normalized);
        return normalized;
      }
    }
    const projects = readProjectsJson();

    // ── 写前去重：清理可能存在的重复条目 ──
    const deduped = [];
    const seenCwds = new Set();
    for (const p of projects) {
      const key = path.resolve(p.cwd).toLowerCase();
      if (!seenCwds.has(key)) {
        seenCwds.add(key);
        deduped.push(p);
      } else {
        console.log(`[projects] 去重: 跳过重复 ${p.cwd}`);
      }
    }
    const hasDupes = deduped.length < projects.length;

    // 匹配策略：先精确匹配，再用 workspace 后缀匹配（处理盘符变化）
    let existing = deduped.find(p => path.resolve(p.cwd) === normalized);
    if (!existing) {
      const mySuffix = extractWorkspaceSuffix(normalized);
      if (mySuffix) {
        existing = deduped.find(p => {
          const theirSuffix = extractWorkspaceSuffix(path.resolve(p.cwd));
          return theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase();
        });
      }
    }
    if (!existing) {
      // 检查 removedCwds：如果用户已删除此项目，不再自动注册
      const removedList = readRemovedCwds();
      const normalizedLower = normalized.toLowerCase();
      if (removedList.some(c => c.toLowerCase() === normalizedLower)) {
        return normalized;
      }
      deduped.push({
        cwd: normalized,
        displayName: cwdDisplayName(normalized),
        addedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        archived: false,
      });
      writeProjectsJson(deduped);
    } else if (existing.archived) {
      // 已归档项目：不再自动取消归档（需用户手动恢复）
      // 仅更新 cwd 路径（处理盘符变化）
      if (path.resolve(existing.cwd) !== normalized) {
        console.log(`[projects] 盘符变化(已归档): ${existing.cwd} → ${normalized}`);
        existing.cwd = normalized;
        writeProjectsJson(deduped);
      }
    } else {
      // 更新最后打开时间
      existing.lastOpenedAt = new Date().toISOString();
      // 如果 cwd 发生了盘符变化，更新为新路径
      if (path.resolve(existing.cwd) !== normalized) {
        console.log(`[projects] 盘符变化: ${existing.cwd} → ${normalized}`);
        existing.cwd = normalized;
      }
      if (hasDupes) writeProjectsJson(deduped);
      else writeProjectsJson(deduped);
    }
    return normalized;
  }

  // 清理 projects.json 中路径不存在的幽灵条目 + 去重
  function cleanupProjectsJson() {
    const projects = readProjectsJson();
    const before = projects.length;
    const seen = new Set();  // 用于去重：normalized cwd → 首次出现的索引
    const valid = projects.filter((p, i) => {
      // 排除 workspace 根目录
      if (path.resolve(p.cwd) === DEFAULT_WORKSPACE_DIR) return false;
      // 去重：相同 normalized cwd 只保留第一条（保留最早 addedAt）
      const normalized = path.resolve(p.cwd).toLowerCase();
      if (seen.has(normalized)) return false;  // 重复，只保留第一条
      seen.add(normalized);
      // 保留 archived 的（可能在归档区）
      if (p.archived) return true;
      // workspace 下的项目即使路径不存在也保留（换电脑后子目录可能还没创建）
      const resolved = path.resolve(p.cwd);
      if (extractWorkspaceSuffix(resolved)) return true;
      // 其他路径必须存在
      return fs.existsSync(resolved);
    });
    if (valid.length < before) {
      console.log(`[projects] 清理+去重: ${before} → ${valid.length}`);
      writeProjectsJson(valid);
    }
    return valid;
  }

  // Encode cwd path to omp session dir name
  function encodeSessionDirName(cwdPath) {
    // omp 的编码规则 (cli.js WR5/d46):
    //   path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")
    //   然后首尾加 -- 
    // G:\oh-my-pi\workspace → --G--oh-my-pi-workspace--
    const resolved = path.resolve(cwdPath);
    const stripped = resolved.replace(/^[/\\]/, '');
    const encoded = stripped.replace(/[/\\:]/g, '-');
    return '--' + encoded + '--';
  }

  // Decode omp session dir name back to cwd path
  // NOTE: omp 的编码 replace(/[/\\:]/g, "-") 是有损的，
  // 目录名中的 - 和路径分隔符编码后的 - 无法区分。
  // 可靠的 cwd 来源是 JSONL 文件中的 cwd 字段。
  // 此函数仅作为 fallback 使用。
  function decodeSessionDirName(dirName) {
    if (!dirName.startsWith('--') || !dirName.endsWith('--')) return dirName;
    const inner = dirName.slice(2, -2); // e.g. "G--oh-my-pi-workspace"
    // Windows 盘符格式: X--rest (X 是盘符，后面两个 - 分别是 : 和 \)
    if (/^[A-Z]--/.test(inner)) {
      const drive = inner[0];
      // 去掉 "X--" (冒号和根路径的反斜杠)
      const rest = inner.slice(3);
      // rest 中包含目录名中的 - 和路径分隔符编码的 -
      // 我们无法完美还原，但可以尝试用 fs 验证
      // 对于不含 - 的路径组件，简单的替换就够用
      // 对于含 - 的路径，需要 extractCwdFromSessionDir 辅助
      return drive + ':\\' + rest.replace(/-/g, '\\');
    }
    // 非 Windows 路径
    return '/' + inner.replace(/-/g, '/');
  }

  // 从 JSONL 文件中提取 cwd（可靠来源）
  function extractCwdFromSessionDir(dirPath) {
    try {
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        const headSize = Math.min(4096, stat.size);
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(headSize);
        fs.readSync(fd, buf, 0, headSize, 0);
        fs.closeSync(fd);
        const text = buf.toString('utf8');
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.cwd) return obj.cwd;
          } catch {}
        }
      }
    } catch {}
    return null;
  }

  // Extract session display name from cwd
  function cwdDisplayName(cwd) {
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || cwd;
  }

  // 首次启动时，扫描 sessions 目录迁移到 projects.json
  function migrateSessionsToProjectsJson() {
    const existing = readProjectsJson();
    const existingCwds = new Set(existing.map(p => path.resolve(p.cwd)));
    let changed = false;

    if (fs.existsSync(SESSIONS_DIR)) {
      const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const dir of dirs) {
        // 优先从 JSONL 文件中读取 cwd（可靠）
        const dirPath = path.join(SESSIONS_DIR, dir.name);
        let cwd = extractCwdFromSessionDir(dirPath);
        
        // 如果 JSONL 为空或无 cwd 字段，用 decode 做最佳猜测
        if (!cwd) {
          cwd = decodeSessionDirName(dir.name);
        }
        
        const normalized = path.resolve(cwd);
        
        // 验证 encode 反向匹配：确保 encode(normalized) 能映射回当前 dirName
        // 这能排除 decode 错误的情况
        if (encodeSessionDirName(normalized) !== dir.name) {
          console.log(`[migrate] 跳过不匹配的目录: ${dir.name} (decoded: ${normalized}, re-encoded: ${encodeSessionDirName(normalized)})`);
          continue;
        }
        
        // 验证 cwd 路径存在于磁盘（排除歧义 decode 产生的幽灵路径）
        // 但对于 workspace 下的项目，即使路径不存在也保留（换电脑后子目录可能还没创建）
        const wsSuffix = extractWorkspaceSuffix(normalized);
        if (!fs.existsSync(normalized)) {
          if (wsSuffix) {
            console.log(`[migrate] workspace 项目路径不存在但保留: ${dir.name} (cwd: ${normalized})`);
          } else {
            console.log(`[migrate] 跳过路径不存在的目录: ${dir.name} (cwd: ${normalized})`);
            continue;
          }
        }
        
        if (!existingCwds.has(normalized)) {
          existing.push({
            cwd: normalized,
            displayName: cwdDisplayName(normalized),
            addedAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            archived: false,
          });
          existingCwds.add(normalized);
          changed = true;
        }
      }
    }

    if (changed) writeProjectsJson(existing);
    return existing;
  }

  // ═══════════════════════════════════════════════════════════
  // 启动时路径迁移：修复换电脑后盘符/路径变化导致的数据丢失
  // ═══════════════════════════════════════════════════════════
  //
  // 场景：用户把 omp 便携包从 G:\oh-my-pi\ 拷到新电脑的 D:\oh-my-pi\
  // 问题1: session 目录名编码了旧路径 --G--oh-my-pi-workspace-omp调试--
  // 问题2: projects.json 中的 cwd 是旧绝对路径 G:\oh-my-pi\workspace\omp调试
  //
  // 解决：
  // 1. 扫描 sessions 目录找"孤儿"（不在 projects.json 中的旧目录）
  // 2. 从 JSONL 文件中提取旧 cwd，替换盘符/根路径后重命名目录
  // 3. 更新 projects.json 中旧盘符的条目

  function migrateSessionDirsForNewRoot() {
    if (!fs.existsSync(SESSIONS_DIR)) return;

    const currentWorkspace = path.join(PORTABLE_ROOT, 'workspace');
    const projects = readProjectsJson();
    const existingCwds = new Set(projects.map(p => path.resolve(p.cwd)));
    let changed = false;

    // 步骤1: 修复 projects.json 中旧盘符的条目
    const newProjects = [];
    for (const proj of projects) {
      const resolved = path.resolve(proj.cwd);
      // 检查 cwd 是否指向当前 PORTABLE_ROOT 的 workspace
      // 如果 projects.json 里写的是 G:\oh-my-pi\workspace\xxx，但当前 PORTABLE_ROOT 是 D:\oh-my-pi
      // 则修正为 D:\oh-my-pi\workspace\xxx
      const workspaceSuffix = extractWorkspaceSuffix(resolved);
      if (workspaceSuffix) {
        const newCwd = path.join(currentWorkspace, workspaceSuffix);
        if (newCwd.toLowerCase() !== resolved.toLowerCase()) {
          console.log(`[migrate-path] projects.json 修复: ${proj.cwd} → ${newCwd}`);
          proj.cwd = newCwd;
          changed = true;
        }
      }
      newProjects.push(proj);
    }
    // 步骤1.5: 去重（修复盘符后可能有多个条目指向同一个路径）
    const seenCwds = new Set();
    const dedupedProjects = [];
    for (const proj of newProjects) {
      const resolved = path.resolve(proj.cwd).toLowerCase();
      if (seenCwds.has(resolved)) {
        console.log(`[migrate-path] 去重: 移除重复项目 ${proj.cwd}`);
        changed = true;
        continue;
      }
      seenCwds.add(resolved);
      dedupedProjects.push(proj);
    }
    if (changed) {
      writeProjectsJson(dedupedProjects);
    }

    // 步骤2: 扫描 sessions 目录，找孤儿目录并迁移
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const dirPath = path.join(SESSIONS_DIR, dir.name);

      // 从 JSONL 文件中提取旧 cwd
      const oldCwd = extractCwdFromSessionDir(dirPath);
      if (!oldCwd) {
        console.log(`[migrate-path] 无法提取 cwd: ${dir.name}`);
        continue;
      }

      const workspaceSuffix = extractWorkspaceSuffix(oldCwd);
      if (!workspaceSuffix) {
        // 非 workspace 下的项目，跳过（用户只迁移 workspace 下的项目）
        continue;
      }

      const newCwd = path.join(currentWorkspace, workspaceSuffix);
      const newDirName = encodeSessionDirName(newCwd);

      // 已经匹配当前路径 → 无需迁移
      if (dir.name === newDirName) continue;

      // 新目录已存在 → 合并（把旧目录的文件移过去）
      const newDirPath = path.join(SESSIONS_DIR, newDirName);
      if (fs.existsSync(newDirPath)) {
        console.log(`[migrate-path] 合并: ${dir.name} → ${newDirName}`);
        // 移动旧目录中的文件到新目录
        const oldFiles = fs.readdirSync(dirPath);
        for (const f of oldFiles) {
          const src = path.join(dirPath, f);
          const dst = path.join(newDirPath, f);
          if (!fs.existsSync(dst)) {
            try { fs.renameSync(src, dst); } catch {}
          }
        }
        // 尝试删除旧目录（可能非空如果文件名冲突）
        try { fs.rmdirSync(dirPath); } catch {}
      } else {
        // 直接重命名
        console.log(`[migrate-path] 重命名: ${dir.name} → ${newDirName}`);
        try { fs.renameSync(dirPath, newDirPath); } catch (err) {
          console.log(`[migrate-path] 重命名失败: ${err.message}`);
          continue;
        }
      }

      // 确保 projects.json 中有新路径的条目
      if (!existingCwds.has(path.resolve(newCwd))) {
        projects.push({
          cwd: newCwd,
          displayName: cwdDisplayName(newCwd),
          addedAt: new Date().toISOString(),
          lastOpenedAt: new Date().toISOString(),
          archived: false,
        });
        existingCwds.add(path.resolve(newCwd));
        changed = true;
      }
    }

    if (changed) writeProjectsJson(projects);
  }

  /**
   * 从绝对路径中提取 workspace/ 之后的相对路径后缀。
   * 例如: G:\oh-my-pi\workspace\omp调试 → omp调试
   *       E:\oh-my-pi\workspace\ppt制作\sub → ppt制作\sub
   *       G:\some\other\path → null（不在任何 oh-my-pi/workspace 下）
   */
  function extractWorkspaceSuffix(absPath) {
    const normalized = absPath.replace(/\\/g, '/');
    // 匹配任意盘符/根路径下的 oh-my-pi/workspace/... 模式
    const match = normalized.match(/\/oh-my-pi\/workspace\/(.+)$/i);
    if (match) return match[1].replace(/\//g, path.sep);
    return null;
  }

  // 自动发现 workspace 下的子目录，注册到 projects.json
  function discoverWorkspaceProjects() {
    if (!fs.existsSync(DEFAULT_WORKSPACE_DIR)) return;
    try {
      const entries = fs.readdirSync(DEFAULT_WORKSPACE_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(DEFAULT_WORKSPACE_DIR, entry.name);
        ensureProjectInJson(subDir);
      }
    } catch (err) {
      console.warn('[discover] 扫描 workspace 子目录失败:', err.message);
    }
  }

  // 启动时迁移一次，清理幽灵条目，确保默认工作区已注册
  migrateSessionDirsForNewRoot();
  migrateSessionsToProjectsJson();
  cleanupProjectsJson();
  discoverWorkspaceProjects();
  ensureProjectInJson(currentWorkspaceDir);

  // Parse JSONL session file header (first 4KB)
  function parseSessionHeader(filePath) {
    try {
      const stat = fs.statSync(filePath);
      const headSize = Math.min(65536, stat.size); // 64KB（从 4KB 升级）
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(headSize);
      fs.readSync(fd, buf, 0, headSize, 0);
      fs.closeSync(fd);
      const text = buf.toString('utf8');
      const lines = text.split('\n').filter(l => l.trim());

      let title = null;
      let sessionId = null;
      let cwd = null;
      let firstMessage = null;
      let messageCount = 0;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          // title 事件格式: {"type":"title","v":1,"title":"实际标题","updatedAt":"..."}
          // v 是版本号不是标题，只有 title 字段有值时才取
          if (obj.type === 'title' && obj.title && !title) {
            title = obj.title;
          }
          if (obj.id && !sessionId && obj.version) {
            sessionId = obj.id;
            cwd = obj.cwd;
          }
          if (obj.message) {
            messageCount++;
            if (!firstMessage && obj.message.role === 'user' && obj.message.content) {
              const content = obj.message.content;
              if (typeof content === 'string') firstMessage = content;
              else if (Array.isArray(content)) {
                const textPart = content.find(c => c.type === 'text');
                if (textPart) firstMessage = textPart.text;
              }
              if (firstMessage && firstMessage.length > 100) {
                firstMessage = firstMessage.substring(0, 100) + '...';
              }
            }
          }
        } catch {}
      }

      return {
        path: filePath,
        name: path.basename(filePath, '.jsonl'),
        sessionId,
        cwd,
        title,
        firstMessage: firstMessage || '(空会话)',
        messageCount,
        size: stat.size,
        modified: stat.mtimeMs,
      };
    } catch (err) {
      return { path: filePath, name: path.basename(filePath), error: err.message };
    }
  }

  ipcMain.handle('sessions:listProjects', async () => {
    try {
      // 每次列出项目时也自动发现 workspace 子目录
      discoverWorkspaceProjects();

      const projects = readProjectsJson().filter(p => !p.archived);

      const result = [];
      for (const proj of projects) {
        const normalized = path.resolve(proj.cwd);
        const dirName = encodeSessionDirName(normalized);
        const projectPath = path.join(SESSIONS_DIR, dirName);

        // 统计会话数
        let sessionCount = 0;
        try {
          if (fs.existsSync(projectPath)) {
            sessionCount = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl')).length;
          }
        } catch {}

        result.push({
          dirName,
          cwd: normalized,
          displayName: proj.displayName || cwdDisplayName(normalized),
          sessionCount,
          path: projectPath,
          lastOpenedAt: proj.lastOpenedAt || '',
          addedAt: proj.addedAt || '',
        });
      }

      // 按最新会话活动排序（最近活跃的项目排在前面）
      for (const proj of result) {
        try {
          const projectPath = path.join(SESSIONS_DIR, proj.dirName);
          if (fs.existsSync(projectPath)) {
            const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
            let newestMtime = 0;
            for (const f of files) {
              const stat = fs.statSync(path.join(projectPath, f));
              if (stat.mtimeMs > newestMtime) newestMtime = stat.mtimeMs;
            }
            proj.lastSessionMtime = newestMtime;
          } else { proj.lastSessionMtime = 0; }
        } catch { proj.lastSessionMtime = 0; }
      }
      result.sort((a, b) => {
        const aTime = b.lastSessionMtime || new Date(b.lastOpenedAt || 0).getTime() || 0;
        const bTime = a.lastSessionMtime || new Date(a.lastOpenedAt || 0).getTime() || 0;
        return aTime - bTime;
      });

      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:listSessions', async (event, projectDirName) => {
    try {
      const projectPath = path.join(SESSIONS_DIR, projectDirName);
      if (!fs.existsSync(projectPath)) return [];

      const files = fs.readdirSync(projectPath)
        .filter(f => f.endsWith('.jsonl'))
        .sort(); // Sort by filename (which starts with ISO timestamp), oldest first

      const sessions = [];
      for (const file of files) {
        const session = parseSessionHeader(path.join(projectPath, file));
        sessions.push(session);
      }

      // 按时间正序返回（最旧在左，最新在右），不 reverse
      return sessions;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:switch', async (event, sessionPath) => {
    return _active().sendCommand({ type: 'switch_session', sessionPath });
  });

  ipcMain.handle('sessions:new', async () => {
    return _active().sendCommand({ type: 'new_session' });
  })

  // ── Session History Loading ──
  ipcMain.handle('sessions:loadHistory', async (event, sessionPath) => {
    try {
      const resolvedPath = path.resolve(sessionPath);
      if (!resolvedPath.endsWith('.jsonl') || !fs.existsSync(resolvedPath)) {
        return { error: 'Session file not found' };
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.size > 20 * 1024 * 1024) {
        // 超过 20MB 的文件只读最后 10MB
        const fd = fs.openSync(resolvedPath, 'r');
        const buf = Buffer.alloc(10 * 1024 * 1024);
        fs.readSync(fd, buf, 0, 10 * 1024 * 1024, stat.size - 10 * 1024 * 1024);
        fs.closeSync(fd);
        var text = buf.toString('utf8');
        // 跳过第一行（可能是不完整的 JSON）
        const firstNewline = text.indexOf('\n');
        if (firstNewline >= 0) text = text.substring(firstNewline + 1);
      } else {
        var text = fs.readFileSync(resolvedPath, 'utf8');
      }

      const lines = text.split('\n').filter(l => l.trim());

      // 第一遍：收集 tool_execution_start 的参数（按 toolCallId 索引）
      const toolMeta = new Map();
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'custom' && obj.customType === 'tool_execution_start' && obj.data) {
            const tcId = obj.data.toolCallId;
            if (tcId) toolMeta.set(tcId, { toolName: obj.data.toolName, args: obj.data.args });
          }
        } catch {}
      }

      // 第二遍：解析消息，关联工具参数
      // 预热过滤：跳过 __warmup__ 用户消息及紧随其后的 assistant/toolResult 消息
      const messages = [];
      let skipWarmupFollowers = false;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.message) {
            const msg = obj.message;
            let textContent = '';
            let thinkingContent = '';
            let toolCalls = [];

            if (typeof msg.content === 'string') {
              textContent = msg.content;
            } else if (Array.isArray(msg.content)) {
              for (const part of msg.content) {
                if (part.type === 'text' && part.text) {
                  textContent += part.text;
                } else if (part.type === 'thinking' && part.thinking) {
                  thinkingContent += part.thinking;
                } else if (part.type === 'tool_use' || part.type === 'tool_call') {
                  toolCalls.push({
                    id: part.id || '',
                    name: part.name || '',
                    input: part.input || part.arguments || {},
                  });
                }
              }
            }

            // 历史遗留 warmup 过滤：旧版 JSONL 中可能包含 __warmup__ 消息
            if (msg.role === 'user' && textContent.trim() === '__warmup__') {
              skipWarmupFollowers = true;
              continue;
            }
            if (skipWarmupFollowers) {
              if (msg.role === 'user') {
                // 遇到新用户消息，停止跳过
                skipWarmupFollowers = false;
              } else {
                // assistant / toolResult 等跟随消息也跳过
                continue;
              }
            }

            // toolResult 补全：从第一遍的 toolMeta 中恢复参数
            if (msg.role === 'toolResult' && msg.toolCallId) {
              const meta = toolMeta.get(msg.toolCallId);
              if (meta) {
                const resultText = Array.isArray(msg.content)
                  ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('')
                  : (typeof msg.content === 'string' ? msg.content : '');
                messages.push({
                  role: 'assistant',
                  text: '',
                  thinking: '',
                  toolCalls: [{
                    id: msg.toolCallId,
                    name: meta.toolName || msg.toolName || 'tool',
                    input: meta.args || {},
                    result: resultText.substring(0, 10000),
                    isError: msg.isError || false,
                  }],
                  timestamp: obj.timestamp || msg.timestamp,
                  model: msg.model || '',
                  provider: msg.provider || '',
                });
                continue;
              }
            }

            messages.push({
              role: msg.role,
              text: textContent,
              thinking: thinkingContent,
              toolCalls,
              timestamp: obj.timestamp || msg.timestamp,
              model: msg.model || '',
              provider: msg.provider || '',
            });
          }
        } catch {}
      }

      return { messages, total: messages.length };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Project archive / delete ──
  // 根据 dirName 查找 projects.json 中对应的项目
  function findProjectByDirName(dirName) {
    const projects = readProjectsJson();
    for (const p of projects) {
      const normalized = path.resolve(p.cwd);
      if (encodeSessionDirName(normalized) === dirName) {
        return { project: p, allProjects: projects, normalized };
      }
    }
    return { project: null, allProjects: projects, normalized: null };
  }

  ipcMain.handle('sessions:archiveProject', async (event, dirName) => {
    try {
      // 在 projects.json 中标记 archived
      const { project, allProjects, normalized } = findProjectByDirName(dirName);
      if (project) {
        project.archived = true;
        project.archivedAt = new Date().toISOString();
        writeProjectsJson(allProjects);
      }

      // 仍然移动目录到归档区（保留物理数据以便恢复）
      const srcDir = path.join(SESSIONS_DIR, dirName);
      if (fs.existsSync(srcDir)) {
        if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
        let destDir = path.join(ARCHIVE_DIR, dirName);
        if (fs.existsSync(destDir)) {
          destDir = path.join(ARCHIVE_DIR, dirName + '-' + Date.now());
        }
        fs.renameSync(srcDir, destDir);
      }
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:deleteProject', async (event, dirName) => {
    try {
      // 从 projects.json 中删除记录
      const { project, allProjects, normalized } = findProjectByDirName(dirName);
      if (normalized) {
        const filtered = allProjects.filter(p => path.resolve(p.cwd) !== normalized);
        writeProjectsJson(filtered);
      }

      // 先关闭该项目的 omp 实例（释放文件锁，否则 Windows 上 rmdir 会 EBUSY）
      if (project && project.cwd) {
        const projectCwd = path.resolve(project.cwd);
        ompManager.close(projectCwd);
      }

      // 物理删除会话目录
      const srcDir = path.join(SESSIONS_DIR, dirName);
      if (fs.existsSync(srcDir)) {
        rimraf(srcDir);
      }

      // 同时删除 workspace 下的项目物理目录（否则 discoverWorkspaceProjects 会重新发现它）
      if (project && project.cwd) {
        const projectCwd = path.resolve(project.cwd);
        // 安全检查：只删 workspace 子目录，不删 workspace 根目录本身
        const wsSuffix = extractWorkspaceSuffix(projectCwd);
        if (wsSuffix && fs.existsSync(projectCwd)) {
          rimraf(projectCwd);
          console.log(`[deleteProject] 已删除 workspace 目录: ${projectCwd}`);
        }
      }

      // 加入 removedCwds 列表，防止 discoverWorkspaceProjects 再次发现
      if (project && project.cwd) {
        const projectCwd = path.resolve(project.cwd);
        const removedList = (() => {
          try { return fs.existsSync(REMOVED_CWDS_FILE) ? JSON.parse(fs.readFileSync(REMOVED_CWDS_FILE, 'utf8')) : []; }
          catch { return []; }
        })();
        const normalized = projectCwd.toLowerCase();
        if (!removedList.includes(normalized)) {
          removedList.push(normalized);
          fs.writeFileSync(REMOVED_CWDS_FILE, JSON.stringify(removedList), 'utf8');
        }
      }

      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:listArchived', async () => {
    try {
      // 从 projects.json 中获取已归档项目
      const projects = readProjectsJson().filter(p => p.archived);
      return projects.map(p => {
        const normalized = path.resolve(p.cwd);
        const dirName = encodeSessionDirName(normalized);
        return {
          dirName,
          cwd: normalized,
          displayName: p.displayName || cwdDisplayName(normalized),
          archivedAt: p.archivedAt || '',
        };
      });
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:restoreProject', async (event, dirName) => {
    try {
      // 在 projects.json 中取消归档标记
      const { project, allProjects, normalized } = findProjectByDirName(dirName);
      if (project) {
        project.archived = false;
        delete project.archivedAt;
        project.lastOpenedAt = new Date().toISOString();
        writeProjectsJson(allProjects);
      }

      // 移动归档目录回 sessions 区
      const srcDir = path.join(ARCHIVE_DIR, dirName);
      if (fs.existsSync(srcDir)) {
        const destDir = path.join(SESSIONS_DIR, dirName);
        if (!fs.existsSync(destDir)) {
          fs.renameSync(srcDir, destDir);
        }
      }
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 单会话归档：移动 jsonl 到归档目录 ──
  ipcMain.handle('sessions:archiveSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      // 从文件路径反推项目 dirName
      const sessionDir = path.dirname(resolved);
      const dirName = path.basename(sessionDir);
      const archiveProjectDir = path.join(ARCHIVE_DIR, dirName);
      if (!fs.existsSync(archiveProjectDir)) {
        fs.mkdirSync(archiveProjectDir, { recursive: true });
      }
      const destPath = path.join(archiveProjectDir, path.basename(resolved));
      // 目标已存在时加时间戳防冲突
      let finalDest = destPath;
      if (fs.existsSync(finalDest)) {
        finalDest = path.join(archiveProjectDir, path.basename(resolved, '.jsonl') + '-' + Date.now() + '.jsonl');
      }
      fs.renameSync(resolved, finalDest);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 单会话删除：物理删除 jsonl 文件 ──
  ipcMain.handle('sessions:deleteSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      fs.unlinkSync(resolved);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 列出归档的会话（单会话级别） ──
  ipcMain.handle('sessions:listArchivedSessions', async (event, projectDirName) => {
    try {
      const archiveProjectDir = path.join(ARCHIVE_DIR, projectDirName);
      if (!fs.existsSync(archiveProjectDir)) return [];
      const files = fs.readdirSync(archiveProjectDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort();
      const sessions = [];
      for (const file of files) {
        sessions.push(parseSessionHeader(path.join(archiveProjectDir, file)));
      }
      return sessions;
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 恢复归档的会话 ──
  ipcMain.handle('sessions:restoreSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      // 从归档路径反推项目 dirName
      const archiveDir = path.dirname(resolved);
      const dirName = path.basename(archiveDir);
      const activeProjectDir = path.join(SESSIONS_DIR, dirName);
      if (!fs.existsSync(activeProjectDir)) {
        fs.mkdirSync(activeProjectDir, { recursive: true });
      }
      const destPath = path.join(activeProjectDir, path.basename(resolved));
      let finalDest = destPath;
      if (fs.existsSync(finalDest)) {
        finalDest = path.join(activeProjectDir, path.basename(resolved, '.jsonl') + '-' + Date.now() + '.jsonl');
      }
      fs.renameSync(resolved, finalDest);
      return { success: true, restoredPath: finalDest };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 读取用户消息列表（用于分支功能） ──
  ipcMain.handle('sessions:getUserEntries', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      const text = fs.readFileSync(resolved, 'utf8');
      const lines = text.split('\n').filter(l => l.trim());
      const entries = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.message && obj.message.role === 'user') {
            let text = '';
            if (typeof obj.message.content === 'string') text = obj.message.content;
            else if (Array.isArray(obj.message.content)) {
              text = obj.message.content.filter(c => c.type === 'text').map(c => c.text).join('');
            }
            if (text) entries.push({ id: obj.message.id || String(entries.length), text: text.substring(0, 200) });
          }
        } catch {}
      }
      return { entries };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 导出会话为 HTML ──
  ipcMain.handle('sessions:exportHtml', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      const text = fs.readFileSync(resolved, 'utf8');
      const lines = text.split('\n').filter(l => l.trim());
      let htmlParts = ['<!DOCTYPE html><html><head><meta charset="UTF-8"><title>对话导出</title>',
        '<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px;}',
        '.msg{margin:12px 0;padding:12px;border-radius:8px;}',
        '.user{background:#e8f0fe;} .assistant{background:#f5f5f5;}',
        '.role{font-weight:bold;font-size:12px;color:#666;margin-bottom:4px;}',
        '.time{font-size:11px;color:#999;float:right;}',
        'pre{background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;overflow-x:auto;}',
        '</style></head><body>'];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.message) {
            const msg = obj.message;
            let content = '';
            if (typeof msg.content === 'string') content = msg.content;
            else if (Array.isArray(msg.content)) {
              content = msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            }
            if (!content) continue;
            const role = msg.role === 'user' ? '你' : '助手';
            const time = obj.timestamp ? new Date(obj.timestamp).toLocaleString() : '';
            const escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
            htmlParts.push(`<div class="msg ${msg.role}"><div class="role">${role}<span class="time">${time}</span></div><div>${escaped}</div></div>`);
          }
        } catch {}
      }
      htmlParts.push('</body></html>');
      const desktopPath = path.join(require('os').homedir(), 'Desktop');
      const sessionName = path.basename(resolved, '.jsonl').substring(0, 30);
      const exportPath = path.join(desktopPath, `对话导出-${sessionName}-${Date.now()}.html`);
      fs.writeFileSync(exportPath, htmlParts.join('\n'), 'utf8');
      return { success: true, path: exportPath };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── removedCwds：防止已删除的项目被自动发现复活 ──
  // （readRemovedCwds / writeRemovedCwds 已在上方模块级定义）

  ipcMain.handle('sessions:getRemovedCwds', async () => readRemovedCwds());
  ipcMain.handle('sessions:addRemovedCwd', async (event, cwd) => {
    const list = readRemovedCwds();
    const normalized = path.resolve(cwd).toLowerCase();
    if (!list.includes(normalized)) { list.push(normalized); writeRemovedCwds(list); }
    return { success: true };
  });
  ipcMain.handle('sessions:removeRemovedCwd', async (event, cwd) => {
    const list = readRemovedCwds();
    const normalized = path.resolve(cwd).toLowerCase();
    writeRemovedCwds(list.filter(c => c !== normalized));
    return { success: true };
  });
}

// ── App Lifecycle ──

app.whenReady().then(() => {
  setupIpc();
  createWindow();
  // 懒启动：不在此处启动 omp，等前端 loadProjects 切换项目时再 activate
  //（此处不再 activate 默认工作区，避免启动时创建两个 omp 实例）

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  ompManager.killAll();
  app.quit();
});

app.on('before-quit', () => {
  // 同步杀所有进程（app 退出路径必须同步等进程死透）
  for (const inst of ompManager.instances.values()) {
    if (inst.process) {
      try {
        inst.process.stdin.write(JSON.stringify({ type: 'abort' }) + '\n');
      } catch (e) { /* ignore */ }
      _killTree(inst.process.pid, true);
    }
  }
  // 给 2 秒时间优雅退出
  setTimeout(() => {
    ompManager.killAll();
  }, 2000);
});
