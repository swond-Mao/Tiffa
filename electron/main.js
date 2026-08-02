/**
 * Tiffa Desktop - Electron Main Process
 *
 * Manages Tiffa rpc-ui subprocess, IPC communication, and window lifecycle.
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
const BUN_EXE = path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', 'bun', 'bin', 'bun.exe');
const TIFFA_CLI = path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', '@oh-my-pi', 'pi-coding-agent', 'dist', 'cli.js');
const EXTENSION_PATH = path.join(PORTABLE_ROOT, 'plugins', 'claude-mode-extension.ts');
const COMPUTER_USE_EXTENSION_PATH = path.join(PORTABLE_ROOT, 'plugins', 'computer-use-extension.ts');
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

// ── 会话 ID 工具：从 sessionPath 提取 UUID（与 renderer extractSessionId 一致） ──
function _extractSessionIdFromPath(sessionPath) {
  if (!sessionPath) return null;
  const match = String(sessionPath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : null;
}
// 删除/归档会话前关闭持有该会话文件的实例。
// 根因：实例内存持有 session 状态，只删 jsonl 不关实例时，内核后续任何写盘
// （agent_end flush / switch_session / 消息追加）都会把文件"复活"，历史面板残留记录；
// 且实例持有的文件句柄会导致 Windows unlink/rename EBUSY。
function _closeInstancesForSessionFile(sessionPath) {
  const resolved = path.resolve(sessionPath);
  const norm = resolved.toLowerCase();
  const targetSessionId = _extractSessionIdFromPath(resolved);
  const keysToClose = [];
  for (const [key, inst] of tiffaManager.instances) {
    const sf = inst.sessionFilePath;
    const matchByPath = sf && path.resolve(sf).toLowerCase() === norm;
    const matchById = targetSessionId && inst.sessionId === targetSessionId;
    if (matchByPath || matchById) keysToClose.push(key);
  }
  for (const key of keysToClose) {
    const inst = tiffaManager.instances.get(key);
    console.log(`[sessions] 关闭会话实例: ${key}`);
    if (inst) inst.kill(true); // userKilled=true 防自动重启 + 同步树杀
    tiffaManager.instances.delete(key);
    if (tiffaManager.activeKey === key) {
      tiffaManager.activeKey = null;
      tiffaManager.activeCwd = null;
    }
  }
}

// ── 会话目录名编码：cwd -> session 目录名（与内核 cli.js WR5/d46 编码一致） ──
// G:\Tiffa\workspace\Tiffa开发 -> --G--Tiffa-workspace-Tiffa开发--
function _encodeSessionDirName(cwdPath) {
  const resolved = path.resolve(cwdPath);
  const stripped = resolved.replace(/^[/\\]/, '');
  const encoded = stripped.replace(/[/\\:]/g, '-');
  return '--' + encoded + '--';
}

// ── 查找会话 JSONL 文件：给定 cwd + sessionId，在 SESSIONS_DIR 下定位匹配的 .jsonl ──
// 会话文件有两种存放模式：
//   1. 直接在项目目录下：*_<uuid>.jsonl
//   2. 在子目录中：*_<uuid>/<name>.jsonl
// sessionId 是 UUID，用它做唯一匹配键
const _SESSIONS_DIR = path.join(PORTABLE_ROOT, 'data', 'agent', 'sessions');
function _findSessionFile(cwd, sessionId) {
  if (!cwd || !sessionId) return null;
  const dirName = _encodeSessionDirName(cwd);
  const projectDir = path.join(_SESSIONS_DIR, dirName);
  if (!fs.existsSync(projectDir)) return null;
  const uuidLower = sessionId.toLowerCase();
  try {
    // 模式 1：直接在项目目录下的 *_<uuid>.jsonl
    const directFiles = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl') && f.toLowerCase().includes(uuidLower));
    if (directFiles.length > 0) return path.join(projectDir, directFiles[0]);

    // 模式 2：子目录 *_<uuid>/ 中的 .jsonl
    const subDirs = fs.readdirSync(projectDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.toLowerCase().includes(uuidLower));
    for (const sd of subDirs) {
      const sdPath = path.join(projectDir, sd.name);
      const jsonlFiles = fs.readdirSync(sdPath).filter(f => f.endsWith('.jsonl'));
      if (jsonlFiles.length > 0) return path.join(sdPath, jsonlFiles[0]);
    }
  } catch {}
  return null;
}

// ── UTF-8 环境变量注入（治理中文乱码） ──
// 乱码根因：Tiffa 内核 spawn bash/powershell 执行命令时，Windows 控制台默认
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

// ── Global State ──
let mainWindow = null;
const MAX_INSTANCES = 8; // 最多同时运行的 Tiffa 实例数（项目级 + 对话级共享）

// ═══════════════════════════════════════════════════════════════
// TiffaInstance: 单个 Tiffa 子进程的完整生命周期管理
// ═══════════════════════════════════════════════════════════════

class TiffaInstance {
  constructor(cwd, sessionId = null) {
    this.cwd = cwd;
    this.sessionId = sessionId;  // null = 项目级实例；UUID = 对话级实例
    this.process = null;
    this.rl = null;          // readline.Interface（stdout 逐行解析）
    this.ready = false;
    this.agentRunning = false;
    this.pendingCommands = new Map();
    this.commandId = 0;
    this.lastActiveTime = Date.now();
    this.userKilled = false;    // 用户主动 kill，不自动重启
    this.crashCount = 0;        // 连续崩溃次数
    this.maxCrashRestart = 3;   // 最多自动重启 3 次
    this._restartTimer = null;
    this.isPrewarming = false;  // embedding 预热中，过滤噪音事件
    this.sessionFilePath = null; // session_switch 事件中保存的 JSONL 文件路径
    this._titleGenerated = false; // 本会话是否已生成过标题（避免重复）
    this._restoringContext = false; // 正在通过 switch_session 恢复历史上下文，过滤重复事件
  }

  start() {
    if (this.process) return;
    this.userKilled = false;

    const env = {
      ...process.env,
      ..._utf8Env(),
      PI_CODING_AGENT_DIR: path.join(PORTABLE_ROOT, 'data', 'agent'),
      HOME: path.join(PORTABLE_ROOT, 'home'),
      USERPROFILE: path.join(PORTABLE_ROOT, 'home'),
      BUN_INSTALL: PORTABLE_ROOT,
      // Mnemopi embedding：必须用中文模型，否则回退到默认英文模型
      MNEMOPI_EMBEDDING_MODEL: 'BAAI/bge-small-zh-v1.5',
      // 将便携 python/node 前置到 PATH，确保子进程能直接用 python/node 命令
      // 否则 Windows 系统 PATH 中的 Store 占位符 python.exe 会被命中（exit 49 弹窗）
      PATH: [
        path.join(PORTABLE_ROOT, 'python'),
        path.join(PORTABLE_ROOT, 'python', 'Scripts'),
        path.join(PORTABLE_ROOT, 'node'),
        path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', 'bun', 'bin'),
        process.env.PATH || '',
      ].join(path.delimiter),
    };

    delete env.NODE_OPTIONS;
    delete env.ELECTRON_RUN_AS_NODE;

    const args = [TIFFA_CLI, '--mode', 'rpc-ui', '-e', EXTENSION_PATH, '-e', COMPUTER_USE_EXTENSION_PATH];

    console.log(`[TiffaInstance] Starting Tiffa cwd=${this.cwd}`, BUN_EXE, args.join(' '));

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
        console.warn(`[TiffaInstance:${this._shortCwd()}] 无法解析事件:`, trimmed.substring(0, 200));
      }
    });

    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        console.log(`[tiffa:stderr:${this._shortCwd()}]`, text);
      }
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[TiffaInstance:${this._shortCwd()}] 已退出:`, { code, signal, userKilled: this.userKilled, crashCount: this.crashCount });

      // 拒绝所有待定命令（避免 Promise 永久挂起）
      for (const [id, { reject }] of this.pendingCommands) {
        reject(new Error(`Tiffa process exited (code=${code}, signal=${signal})`));
      }
      this.pendingCommands.clear();

      this._cleanup();

      // 崩溃自动重启：非用户主动 kill、未超出重启上限
      // 注：常驻 CLI 不应自行退出；切换会话/项目时若 CLI 异常 clean exit(code===0) 也应重启，
      // 否则实例被 ready 轮询 delete 后静默消失（用户感知为"静默崩溃不重启"）
      const shouldRestart = !this.userKilled && this.crashCount < this.maxCrashRestart;
      if (shouldRestart) {
        this.crashCount++;
        console.log(`[TiffaInstance:${this._shortCwd()}] 3秒后自动重启 (第${this.crashCount}次)`);
        this._restartTimer = setTimeout(() => {
          this._restartTimer = null;
          this.start();
        }, 3000);
      }

      // 通知渲染进程
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tiffa:exited', {
          code, signal, cwd: this.cwd, sessionId: this.sessionId,
          autoRestarting: shouldRestart, crashCount: this.crashCount,
        });
      }
    });

    this.process.on('error', (err) => {
      console.error(`[TiffaInstance:${this._shortCwd()}] 启动失败:`, err);
      this.process = null;
    });
  }

  kill(sync = false) {
    if (!this.process) return;
    this.userKilled = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    _killTree(this.process.pid, sync);
    this._cleanup();
  }

  forceKill(reason) {
    this.userKilled = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (!this.process) {
      this.agentRunning = false;
      return;
    }
    console.log(`[TiffaInstance:${this._shortCwd()}] forceKill (原因: ${reason})`);
    _killTree(this.process.pid);
    this._cleanup();
  }

  sendCommand(frame) {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin.writable) {
        reject(new Error('Tiffa process not running'));
        return;
      }

      // 用户交互立即取消预热过滤：避免用户消息的响应事件被预热过滤器吞掉
      // （预热仅服务于 /memory rebuild 的 embedding 冷加载，用户交互优先级更高）
      if (this.isPrewarming) {
        this.isPrewarming = false;
        console.log(`[TiffaInstance:${this._shortCwd()}] 用户命令到达，取消预热过滤`);
      }

      const id = `cmd_${++this.commandId}`;
      frame.id = id;

      const timer = setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error('Command timeout'));
        }
      }, 5 * 60 * 1000);

      this.pendingCommands.set(id, { resolve, reject, timer });

      const line = JSON.stringify(frame) + '\n';
      try {
        this.process.stdin.write(line, 'utf8');
      } catch (err) {
        clearTimeout(timer);
        this.pendingCommands.delete(id);
        reject(err);
      }
    });
  }

  sendRaw(frame) {
    if (!this.process || !this.process.stdin.writable) {
      console.error(`[TiffaInstance:${this._shortCwd()}] Tiffa 未运行，无法发送`);
      return;
    }
    // 用户交互（steer/follow_up/prompt）立即取消预热过滤
    if (this.isPrewarming && (frame.type === 'prompt' || frame.type === 'steer' || frame.type === 'follow_up')) {
      this.isPrewarming = false;
      console.log(`[TiffaInstance:${this._shortCwd()}] 用户 raw 命令(${frame.type})到达，取消预热过滤`);
    }
    const line = JSON.stringify(frame) + '\n';
    try {
      this.process.stdin.write(line, 'utf8');
    } catch (err) {
      console.error(`[TiffaInstance:${this._shortCwd()}] stdin.write 失败:`, err.message);
    }
  }

  // ── 事件处理 ──

  _handleEvent(event) {
    this.lastActiveTime = Date.now();

    if (event.type === 'ready') {
      this.ready = true;
      this.agentRunning = false;
      this.crashCount = 0; // 成功启动后重置崩溃计数
      console.log(`[TiffaInstance:${this._shortCwd()}] 就绪`);
      // 延迟 3 秒后预热 embedding（fastembed onnx 模型 ~93MB），
      // 避免首次发送消息时 embedding 冷加载导致超时/失败。
      // 用 /memory rebuild 触发 mnemopi retain->embed 路径加载模型。
      setTimeout(() => {
        // 如果用户已在交互（agent 正在运行），跳过预热避免阻塞用户事件
        if (this.agentRunning) return;
        this.isPrewarming = true;
        this.sendRaw({ type: 'prompt', message: '/memory rebuild' });
        // 30 秒兜底：若 agent_end 未正常到达（进程异常），强制解除过滤
        setTimeout(() => { this.isPrewarming = false; }, 30000);
      }, 3000);
      // 崩溃重启后上下文恢复：crashCount 在 ready 时已重置，用 sessionFilePath 判断是否为重启。
      // 首次启动时 sessionFilePath 为 null（activateSession 负责恢复）；
      // 崩溃重启时 sessionFilePath 保留着之前会话的路径，需重新发 switch_session 恢复上下文。
      if (this.sessionFilePath && this.sessionId) {
        const sf = this.sessionFilePath;
        if (fs.existsSync(sf)) {
          this._restoringContext = true;
          this.sendCommand({ type: 'switch_session', sessionPath: sf })
            .then(() => { console.log(`[TiffaInstance:${this._shortCwd()}] 崩溃重启后上下文已恢复`); })
            .catch((e) => { console.warn(`[TiffaInstance:${this._shortCwd()}] 崩溃重启后上下文恢复失败: ${e.message}`); })
            .finally(() => { this._restoringContext = false; });
        }
      }
    }

    if (event.type === 'prompt_result' && event.agentInvoked) {
      this.agentRunning = true;
    } else if (event.type === 'agent_start') {
      this.agentRunning = true;
    } else if (event.type === 'agent_end') {
      const wasPrewarming = this.isPrewarming;
      this.agentRunning = false;
      // 预热 agent 结束 -> 立即解除事件过滤（不再等 30 秒兜底）
      this.isPrewarming = false;
      // 非预热 agent_end 后，尝试生成会话标题
      // RPC-UI 模式下内核不自动调用 generateTitle，需 main.js 主动补标题
      if (!wasPrewarming && !this._titleGenerated) {
        this._titleGenerated = true;
        setTimeout(() => { if (TiffaInstance._titleGenerateCallback) TiffaInstance._titleGenerateCallback(this); }, 500);
      }
    }

    // Handle command responses
    if (event.type === 'response' && event.id && this.pendingCommands.has(event.id)) {
      const { resolve, reject, timer } = this.pendingCommands.get(event.id);
      clearTimeout(timer);
      this.pendingCommands.delete(event.id);
      if (event.success) {
        resolve(event.data);
      } else {
        reject(new Error(event.error || 'Command failed'));
      }
      return;
    }

    // 拦截 session_switch：CLI 分配真实 sessionId 后，同步更新实例的 sessionId 与 map key。
    // 否则 renderer 用 realSessionId 切回时 _key(cwd, realSessionId) 查不到 -> spawn 新进程 ->
    // CLI 进程内存里的对话上下文随旧进程死亡丢失（用户感知为"找不到上下文"）。
    // 注意：预热期间的 session_switch 来自 /memory rebuild，不应迁移实例 key，
    // 否则后续用户消息的 session_switch 无法正确匹配。
    // 上下文恢复期间的 session_switch 是我们主动触发的，不需要迁移 key（key 已是正确的 realSessionId）。
    if (event.type === 'session_switch' && event.sessionPath && !this.isPrewarming && !this._restoringContext) {
      this.sessionFilePath = event.sessionPath; // 保存当前会话的 JSONL 文件路径
      const realSessionId = _extractSessionIdFromPath(event.sessionPath);
      if (realSessionId && realSessionId !== this.sessionId) {
        tiffaManager.migrateSessionId(this.cwd, this.sessionId, realSessionId);
        this.sessionId = realSessionId; // 更新实例自身 sessionId，后续事件标记用新值
      }
    }
    // Forward all events to renderer (带 cwd + sessionId 标记)
    event._cwd = this.cwd;
    event._sessionId = this.sessionId;

    // embedding 预热期间过滤掉 /memory rebuild 产生的噪音事件
    if (this.isPrewarming) {
      return;
    }

    // 上下文恢复期间（switch_session 重放历史），过滤掉重放的消息事件避免前端重复渲染。
    // 允许 session_switch（已完成恢复操作本身）和 response（命令响应）通过。
    if (this._restoringContext && event.type !== 'session_switch' && event.type !== 'response') {
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tiffa:event', event);
    }
  }

  _cleanup() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.process = null;
    this.ready = false;
    this.agentRunning = false;
  }

  _shortCwd() {
    const parts = this.cwd.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || this.cwd;
  }
}

// ═══════════════════════════════════════════════════════════════
// TiffaInstanceManager: 多实例管理器（懒启动 + LRU 淘汰）
// ═══════════════════════════════════════════════════════════════

class TiffaInstanceManager {
  constructor() {
    this.instances = new Map(); // key: cwd#sessionId -> TiffaInstance
    this.spawning = new Map(); // key: cwd#sessionId -> Promise<TiffaInstance>
    this.activeKey = null;     // 当前活跃实例的 key
    this.activeCwd = null;     // 当前活跃实例的 cwd（向后兼容）
  }

  _key(cwd, sessionId) {
    return path.resolve(cwd) + '#' + (sessionId || 'project');
  }

  // 激活项目级实例（用于文件操作、项目切换等）
  async activate(cwd) {
    const normalized = path.resolve(cwd);
    const key = this._key(cwd, null);
    this.activeKey = key;
    this.activeCwd = normalized;
    currentWorkspaceDir = normalized;

    // 已存在实例 -> 复用；若正处崩溃重启中则等待 ready
    if (this.instances.has(key)) {
      const inst = this.instances.get(key);
      inst.lastActiveTime = Date.now();
      // 实例可能在崩溃重启中（process 已退出、_restartTimer 排队）：
      // 不等待会让调用方拿到 process=null 的实例，sendCommand 立即失败
      if (!inst.ready && (!inst.process || inst.process.exitCode !== null)) {
        await new Promise((resolve) => {
          let checks = 0;
          const check = setInterval(() => {
            checks++;
            // ready 成功 / 等待超 10s / 重启计时器已清且仍无 process(重启放弃) -> 结束等待
            if (inst.ready || checks > 100 || (!inst._restartTimer && !inst.process)) {
              clearInterval(check); resolve();
            }
          }, 100);
        });
      }
      return { inst, ready: inst.ready };
    }

    // 正在 spawn 中 -> 复用同一个 Promise
    if (this.spawning.has(key)) {
      return this.spawning.get(key);
    }

    // 超过上限 -> LRU 淘汰
    if (this.instances.size >= MAX_INSTANCES) {
      if (!this._evictLRU()) {
        throw new Error(`实例数已达上限(${MAX_INSTANCES})，且所有实例均在运行中无法淘汰。请关闭部分对话后重试。`);
      }
    }

    // 创建新实例
    const spawnPromise = (async () => {
      const inst = new TiffaInstance(normalized, null);
      // 立即注册到 instances map，防止竞态条件：
      // activate() 等待 ready 期间，getActive() 能返回该实例
      this.instances.set(key, inst);
      inst.start();

      await new Promise((resolve) => {
        let checks = 0;
        const check = setInterval(() => {
          checks++;
          if (inst.ready || checks > 300) { clearInterval(check); resolve(); }
        }, 100);
        // 进程提前退出 -> 立即结束轮询
        if (inst.process) {
          inst.process.once('exit', () => { clearInterval(check); resolve(); });
        }
      });

      // 进程已退出：若 exit handler 已安排重启则保留实例占位，避免重启进程脱离 map 变孤儿
      if (!inst.process || inst.process.exitCode !== null) {
        const willRestart = !inst.userKilled && inst.crashCount < inst.maxCrashRestart;
        if (!willRestart) this.instances.delete(key);
      }
      return { inst, ready: inst.ready };
    })();

    this.spawning.set(key, spawnPromise);
    try {
      return await spawnPromise;
    } finally {
      this.spawning.delete(key);
    }
  }

  // 激活对话级实例（每个对话独立 Tiffa 进程）
  // 注意：不再修改 activeKey/activeCwd，避免 fire-and-forget 调用竞态覆盖活跃实例
  async activateSession(cwd, sessionId) {
    const normalized = path.resolve(cwd);
    const key = this._key(cwd, sessionId);

    // 已存在实例 -> 复用；若正处崩溃重启中则等待 ready
    if (this.instances.has(key)) {
      const inst = this.instances.get(key);
      inst.lastActiveTime = Date.now();
      // 实例可能在崩溃重启中（process 已退出、_restartTimer 排队）：
      // 不等待会让调用方拿到 process=null 的实例，sendCommand 立即失败
      if (!inst.ready && (!inst.process || inst.process.exitCode !== null)) {
        await new Promise((resolve) => {
          let checks = 0;
          const check = setInterval(() => {
            checks++;
            // ready 成功 / 等待超 10s / 重启计时器已清且仍无 process(重启放弃) -> 结束等待
            if (inst.ready || checks > 100 || (!inst._restartTimer && !inst.process)) {
              clearInterval(check); resolve();
            }
          }, 100);
        });
      }
      return { inst, ready: inst.ready };
    }

    // 正在 spawn 中 -> 复用同一个 Promise
    if (this.spawning.has(key)) {
      return this.spawning.get(key);
    }

    // 超过上限 -> LRU 淘汰
    if (this.instances.size >= MAX_INSTANCES) {
      if (!this._evictLRU()) {
        throw new Error(`实例数已达上限(${MAX_INSTANCES})，且所有实例均在运行中无法淘汰。请关闭部分对话后重试。`);
      }
    }

    // 创建新实例（对话级：带 sessionId）
    const spawnPromise = (async () => {
      const inst = new TiffaInstance(normalized, sessionId);
      // 立即注册到 instances map，防止竞态条件
      this.instances.set(key, inst);
      inst.start();

      await new Promise((resolve) => {
        let checks = 0;
        const check = setInterval(() => {
          checks++;
          if (inst.ready || checks > 300) { clearInterval(check); resolve(); }
        }, 100);
        if (inst.process) {
          inst.process.once('exit', () => { clearInterval(check); resolve(); });
        }
      });

      // 进程已退出：若 exit handler 已安排重启则保留实例占位，避免重启进程脱离 map 变孤儿
      if (!inst.process || inst.process.exitCode !== null) {
        const willRestart = !inst.userKilled && inst.crashCount < inst.maxCrashRestart;
        if (!willRestart) this.instances.delete(key);
        return { inst, ready: inst.ready };
      }

      // ── 会话上下文恢复 ──
      // 新进程是空白会话，需通过 switch_session 从 JSONL 加载历史上下文到内存。
      // 否则用户发消息时 AI 看到的是全新对话，之前的上下文全丢。
      // 仅对话级实例（sessionId != null）需要恢复；项目级实例不绑定特定会话。
      if (inst.ready && inst.sessionId) {
        const sessionFile = _findSessionFile(normalized, inst.sessionId);
        if (sessionFile) {
          inst._restoringContext = true;
          try {
            await inst.sendCommand({ type: 'switch_session', sessionPath: sessionFile });
            inst.sessionFilePath = sessionFile;
            console.log(`[TiffaInstance:${inst._shortCwd()}] 会话上下文已恢复: ${sessionFile}`);
          } catch (err) {
            console.warn(`[TiffaInstance:${inst._shortCwd()}] 上下文恢复失败: ${err.message}`);
          } finally {
            inst._restoringContext = false;
          }
        }
      }

      return { inst, ready: inst.ready };
    })();

    this.spawning.set(key, spawnPromise);
    try {
      return await spawnPromise;
    } finally {
      this.spawning.delete(key);
    }
  }

  // 获取当前活跃实例
  getActive() {
    if (!this.activeKey) return null;
    return this.instances.get(this.activeKey) || null;
  }

  // 按 sessionId 精确查找实例（不依赖 activeKey）
  getBySessionId(cwd, sessionId) {
    if (!cwd || !sessionId) return null;
    const key = this._key(cwd, sessionId);
    return this.instances.get(key) || null;
  }

  // 迁移实例的 sessionId：CLI 分配真实 sessionId 后，把实例从旧 key(tempSessionId)
  // 迁到新 key(realSessionId)，避免切回时查不到 → spawn 新进程 → 丢上下文。
  migrateSessionId(cwd, oldSessionId, newSessionId) {
    if (!cwd || !oldSessionId || !newSessionId || oldSessionId === newSessionId) return false;
    const oldKey = this._key(cwd, oldSessionId);
    const newKey = this._key(cwd, newSessionId);
    const inst = this.instances.get(oldKey);
    if (!inst) return false; // 实例不存在（可能已被 LRU 淘汰或 closeByKey）
    if (this.instances.has(newKey)) {
      // 目标 key 已有实例（异常情况）：保留已有实例，不覆盖，仅删旧 key
      console.log(`[TiffaManager] migrateSessionId: 目标 key 已存在，仅删旧 key ${oldKey}`);
      this.instances.delete(oldKey);
      return false;
    }
    this.instances.delete(oldKey);
    this.instances.set(newKey, inst);
    // activeKey 也要同步（如果当前活跃实例正是被迁移的）
    if (this.activeKey === oldKey) this.activeKey = newKey;
    // spawning Map 同步（极端情况：迁移时还在 spawn 轮询 ready）
    if (this.spawning.has(oldKey)) {
      this.spawning.set(newKey, this.spawning.get(oldKey));
      this.spawning.delete(oldKey);
    }
    console.log(`[TiffaManager] sessionId 迁移: ${oldSessionId} -> ${newSessionId} (key: ${oldKey} -> ${newKey})`);
    return true;
  }

  // 按 sessionId 查找，回退到 activeKey
  resolve(cwd, sessionId) {
    return this.getBySessionId(cwd, sessionId) || this.getActive();
  }

  // 关闭某个 key 的实例
  closeByKey(key) {
    const inst = this.instances.get(key);
    if (inst) {
      inst.kill();
      this.instances.delete(key);
    }
    if (this.activeKey === key) {
      this.activeKey = null;
      this.activeCwd = null;
    }
  }

  // 关闭某个 cwd 的所有实例（项目级 + 对话级）
  close(cwd) {
    const normalized = path.resolve(cwd);
    const keysToDelete = [];
    for (const [key, inst] of this.instances) {
      if (inst.cwd === normalized) {
        inst.kill();
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.instances.delete(key);
    }
    if (this.activeCwd === normalized) {
      this.activeKey = null;
      this.activeCwd = null;
    }
  }

  // 关闭所有实例
  closeAll() {
    for (const inst of this.instances.values()) {
      inst.kill();
    }
    this.instances.clear();
    this.activeKey = null;
    this.activeCwd = null;
  }

  // 关闭所有实例（退出时用，同步暴力清理）
  killAll() {
    for (const inst of this.instances.values()) {
      inst.userKilled = true;
      if (inst._restartTimer) {
        clearTimeout(inst._restartTimer);
        inst._restartTimer = null;
      }
      if (inst.process) {
        _killTree(inst.process.pid, true);
      }
      for (const [id, { reject }] of inst.pendingCommands) {
        reject(new Error('app quitting'));
      }
      inst.pendingCommands.clear();
    }
    this.instances.clear();
    this.spawning.clear();
    this.activeKey = null;
    this.activeCwd = null;
  }

  // LRU 淘汰：淘汰最久未活跃的非当前实例
  _evictLRU() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [key, inst] of this.instances) {
      if (key === this.activeKey) continue;
      // 运行中的实例跳过：强杀会丢失未写盘的对话片段（taskkill /F /T 不等 flush）
      if (inst.agentRunning) continue;
      if (inst.lastActiveTime < oldestTime) {
        oldestTime = inst.lastActiveTime;
        oldest = key;
      }
    }

    if (oldest) {
      console.log(`[TiffaManager] LRU 淘汰: ${oldest}`);
      this.closeByKey(oldest);
      return true;
    }
    // 所有实例都在运行或为当前活跃，无法淘汰
    console.warn(`[TiffaManager] LRU 淘汰失败：所有 ${this.instances.size} 个实例均不可淘汰`);
    return false;
  }

  // 获取所有实例状态（供前端显示）
  getStatus() {
    const result = [];
    for (const [key, inst] of this.instances) {
      result.push({
        key,
        cwd: inst.cwd,
        sessionId: inst.sessionId,
        sessionFilePath: inst.sessionFilePath,
        active: key === this.activeKey,
        ready: inst.ready,
        agentRunning: inst.agentRunning,
        lastActiveTime: inst.lastActiveTime,
      });
    }
    return result;
  }
}

// 全局实例管理器
const tiffaManager = new TiffaInstanceManager();

// ── Window Creation ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    // 最小尺寸足够大：左侧项目栏 180px 固定 + 右侧 minimap + 聊天区，
    // 缩小到最小也不挤压内容、不露出背景边框
    minWidth: 1100,
    minHeight: 720,
    title: 'Tiffa',
    icon: path.join(__dirname, 'assets', 'tiffa-icon.ico'),
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

  // ── 兜底：防止外部链接在 app 窗口内导航导致页面卡死 ──
  // 即使前端漏拦截，这里也会把 http/https 导航重定向到系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (/^https?:\/\//.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

// ── IPC Handlers ──

function setupIpc() {
  // ── 多实例感知的辅助函数 ──
  // 所有 Tiffa 命令都路由到当前活跃实例

  function _active() {
    const inst = tiffaManager.getActive();
    if (!inst) throw new Error('No active Tiffa instance');
    return inst;
  }

  // Tiffa commands
  ipcMain.handle('tiffa:send', async (event, message, images, sessionId) => {
    // /omfg（或 /吐槽）命令拦截：TTSR 规则生成/修复 prompt（OI3 标准格式）
    const omfgMatch = typeof message === 'string' && message.match(/^\/(?:omfg|吐槽)\s*(.+)/);
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
      console.log(`[/omfg|/吐槽] intercepted: complaint="${complaint}"`);
    }
    const frame = { type: 'prompt', message };
    if (images && images.length > 0) {
      // WebP → PNG：本地 llama.cpp 不解 webp，统一转 PNG 确保所有模型兼容
      const { nativeImage } = require('electron');
      frame.images = images.map(img => {
        if (img.mimeType === 'image/webp') {
          try {
            const ni = nativeImage.createFromBuffer(Buffer.from(img.data, 'base64'));
            if (!ni.isEmpty()) {
              const pngBuf = ni.toPNG();
              return { data: pngBuf.toString('base64'), mimeType: 'image/png' };
            }
          } catch (e) {
            console.warn('[主进程] webp→png 转换失败，保留原图:', e.message);
          }
        }
        return img;
      });
    }
    let inst = tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
    if (!inst && sessionId) {
      // 会话级实例不存在（启动恢复/竞态）→ 先激活再发送，不回退到项目级实例
      // （项目级实例 _sessionId=null 的事件会被渲染层严格路由过滤，导致无输出）
      await tiffaManager.activateSession(tiffaManager.activeCwd, sessionId);
      inst = tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
    }
    if (!inst) inst = tiffaManager.getActive(); // 无 sessionId 时用项目级
    if (!inst) throw new Error('No active Tiffa instance');
    // 发送重试：进程可能在重启中（process=null 但 restartTimer 排队），等待一次再试
    try {
      return await inst.sendCommand(frame);
    } catch (err) {
      if (inst._restartTimer || (!inst.process && inst.crashCount < inst.maxCrashRestart)) {
        console.log(`[主进程] 发送失败，实例可能在重启中，等待 4 秒后重试…`);
        await new Promise(r => setTimeout(r, 4000));
        if (inst.ready && inst.process) {
          return inst.sendCommand(frame);
        }
      }
      throw err;
    }
  });

  // 激活对话级实例（每对话独立进程）——显式设置 activeKey
  ipcMain.handle('tiffa:activateSession', async (event, cwd, sessionId) => {
    try {
      const normalized = path.resolve(cwd);
      ensureProjectInJson(normalized);
      // 显式激活：设置 activeKey（用户主动切换对话时才调用）
      tiffaManager.activeKey = tiffaManager._key(normalized, sessionId);
      tiffaManager.activeCwd = normalized;
      currentWorkspaceDir = normalized;
      const result = await tiffaManager.activateSession(normalized, sessionId);
      return { success: true, cwd: normalized, sessionId, ready: result.ready };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 关闭对话级实例（关闭标签时释放进程）
  ipcMain.handle('tiffa:closeSession', async (event, cwd, sessionId) => {
    try {
      const key = tiffaManager._key(cwd, sessionId);
      tiffaManager.closeByKey(key);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('tiffa:abort', async (event, sessionId) => {
    const inst = tiffaManager.resolve(tiffaManager.activeCwd, sessionId);
    if (inst) inst.sendRaw({ type: 'abort' });
  });

  ipcMain.handle('tiffa:setModel', async (event, provider, modelId, sessionId) => {
    // 指定 sessionId 时精确匹配对话实例，不回退到项目级（避免模型设到错误实例）
    let inst;
    if (sessionId) {
      inst = tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
      if (!inst) {
        // 实例不存在 -> 先激活再设置（与 send 路径一致）
        await tiffaManager.activateSession(tiffaManager.activeCwd, sessionId);
        inst = tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
      }
    } else {
      inst = tiffaManager.getActive();
    }
    if (!inst) throw new Error('No active Tiffa instance');
    return inst.sendCommand({ type: 'set_model', provider, modelId });
  });

  ipcMain.handle('tiffa:getModels', async () => {
    return _active().sendCommand({ type: 'get_available_models' });
  });

  ipcMain.handle('tiffa:isReady', async () => {
    const inst = tiffaManager.getActive();
    return inst ? inst.ready : false;
  });

  ipcMain.handle('tiffa:diagnostics', async () => {
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

  ipcMain.handle('tiffa:getState', async () => {
    return _active().sendCommand({ type: 'get_state' });
  });

  ipcMain.handle('tiffa:steer', async (event, message, sessionId) => {
    const inst = tiffaManager.resolve(tiffaManager.activeCwd, sessionId);
    if (!inst) throw new Error('no active process');
    inst.sendRaw({ type: 'steer', message });
  });

  ipcMain.handle('tiffa:followUp', async (event, message, sessionId) => {
    const inst = tiffaManager.resolve(tiffaManager.activeCwd, sessionId);
    if (!inst) throw new Error('no active process');
    inst.sendRaw({ type: 'follow_up', message });
  });

  ipcMain.handle('tiffa:extensionResponse', async (event, id, value, sessionId) => {
    const frame = { type: 'extension_ui_response', id };
    if (value && typeof value === 'object') {
      if ('cancelled' in value) frame.cancelled = true;
      else if ('value' in value) frame.value = value.value;
      else if ('confirmed' in value) frame.value = true;
      else frame.value = value;
    } else {
      frame.value = value;
    }
    // 按 sessionId 路由到发请求的实例，而非 _active()（当前活跃实例可能已切换）
    const inst = sessionId
      ? (tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId) || tiffaManager.getActive())
      : tiffaManager.getActive();
    if (inst) inst.sendRaw(frame);
  });

  ipcMain.handle('tiffa:compact', async () => {
    return _active().sendCommand({ type: 'compact' });
  });

  ipcMain.handle('tiffa:command', async (event, type, payload) => {
    const frame = { type, ...payload };
    return _active().sendCommand(frame);
  });

  // ── 多实例管理 IPC ──
  ipcMain.handle('tiffa:activate', async (event, cwd) => {
    try {
      const normalized = path.resolve(cwd);
      // 显式用户操作：如果路径曾被删除，从黑名单移除（允许重新添加）
      unremoveCwd(normalized);
      // 确保项目注册到 projects.json
      ensureProjectInJson(normalized);
      const result = await tiffaManager.activate(normalized);
      return { success: true, cwd: tiffaManager.activeCwd, ready: result.ready };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('tiffa:instances', async () => {
    return tiffaManager.getStatus();
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

  // ── Computer Use Toggle（后台开关：默认关，启动不拉起 MCP，开机更快）──
  const COMPUTER_USE_ENABLED_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'computer-use-enabled');
  const COMPUTER_USE_MCP_JSON = path.join(PORTABLE_ROOT, 'data', 'agent', 'mcp.json');

  function isComputerUseEnabled() {
    try {
      if (!fs.existsSync(COMPUTER_USE_ENABLED_FILE)) return false; // 默认关，启动快
      return fs.readFileSync(COMPUTER_USE_ENABLED_FILE, 'utf8').trim() === 'true';
    } catch { return false; }
  }

  function syncComputerUseMcp(enabled) {
    try {
      const p = COMPUTER_USE_MCP_JSON;
      if (!fs.existsSync(p)) return;
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (cfg.mcpServers && cfg.mcpServers['computer-use']) {
        cfg.mcpServers['computer-use'].enabled = enabled;
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
      }
    } catch (err) {
      console.error('[主进程] syncComputerUseMcp 失败:', err.message);
    }
  }

  // 启动时把 mcp.json 同步到开关状态（默认关 -> 不拉起 Computer Use，开机快）
  syncComputerUseMcp(isComputerUseEnabled());

  ipcMain.handle('computer-use:status', async () => ({ enabled: isComputerUseEnabled() }));
  ipcMain.handle('computer-use:toggle', async (event, enabled) => {
    try {
      const dir = path.dirname(COMPUTER_USE_ENABLED_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(COMPUTER_USE_ENABLED_FILE, enabled ? 'true' : 'false', 'utf8');
      syncComputerUseMcp(enabled);
      console.log(`[主进程] Computer Use 开关: ${enabled ? 'ON' : 'OFF'}`);
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
      // 取纯 cwd（去重，keys() 含 #sessionId 后缀不能直接用于 activate）
      const cwds = [...new Set([...tiffaManager.instances.values()].map(i => i.cwd))];
      tiffaManager.closeAll();
      await new Promise(resolve => setTimeout(resolve, 500));
      for (const cwd of cwds) {
        await tiffaManager.activate(cwd);
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
  // 前端模式名 → 内核配置值
  const TIFFA_APPROVAL_MODE_MAP = { normal: 'always-ask', auto: 'write', yolo: 'yolo' };

  ipcMain.handle('config:writeApprovalMode', async (event, tiffaMode) => {
    try {
      const agentMode = TIFFA_APPROVAL_MODE_MAP[tiffaMode] || 'yolo';
      let doc;
      if (fs.existsSync(CONFIG_YML)) {
        const raw = fs.readFileSync(CONFIG_YML, 'utf8');
        doc = parseDocument(raw);
      } else {
        doc = new Document();
      }
      doc.set('tools', doc.get('tools') || doc.createNode({}));
      doc.get('tools').set('approvalMode', agentMode);
      fs.writeFileSync(CONFIG_YML, doc.toString(), 'utf8');
      return { success: true, agentMode };
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
      // 显式用户操作：如果路径曾被删除，从黑名单移除（允许重新添加）
      unremoveCwd(resolved);
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
      await tiffaManager.activate(resolved);
      return { success: true, cwd: tiffaManager.activeCwd };
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

  // 判断路径是否被用户明确删除过（支持 workspace 后缀匹配：
  // 便携包从 E:\Tiffa 迁到 G:\Tiffa 后，旧路径的删除记录仍然生效）
  function isRemovedCwd(absPath) {
    const removedList = readRemovedCwds();
    const lower = absPath.toLowerCase();
    if (removedList.some(c => c.toLowerCase() === lower)) return true;
    const mySuffix = extractWorkspaceSuffix(absPath);
    if (mySuffix) {
      return removedList.some(c => {
        const theirSuffix = extractWorkspaceSuffix(c);
        return theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase();
      });
    }
    return false;
  }

  // 从删除黑名单中移除匹配条目（用户显式重新选择时调用，含同后缀条目）
  function unremoveCwd(absPath) {
    const removedList = readRemovedCwds();
    const lower = absPath.toLowerCase();
    const mySuffix = extractWorkspaceSuffix(absPath);
    const filtered = removedList.filter(c => {
      if (c.toLowerCase() === lower) return false;
      if (mySuffix) {
        const theirSuffix = extractWorkspaceSuffix(c);
        if (theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase()) return false;
      }
      return true;
    });
    if (filtered.length !== removedList.length) writeRemovedCwds(filtered);
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

  // 带重试的递归删除：Windows 上进程刚被杀死时文件句柄可能尚未释放（EBUSY/EPERM）
  async function rimrafWithRetry(dirPath, maxRetries = 3) {
    for (let attempt = 0; ; attempt++) {
      try {
        rimraf(dirPath);
        return;
      } catch (err) {
        if (attempt < maxRetries && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
          console.log(`[rimraf] 文件锁未释放，${400 * (attempt + 1)}ms 后重试 (${attempt + 1}/${maxRetries}): ${dirPath}`);
          await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }
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
    // 用户明确删除过的项目：永不注册、永不重建目录（防止「删了又复活」）
    if (isRemovedCwd(normalized)) {
      return normalized;
    }
    // 防御：路径在磁盘上不存在则不注册（避免幽灵项目）
    // workspace 下的项目：仅当有会话记录时才自动重建目录（换盘符场景）
    if (!fs.existsSync(normalized)) {
      if (extractWorkspaceSuffix(normalized)) {
        const sessionDirName = encodeSessionDirName(normalized);
        const sessionDir = path.join(SESSIONS_DIR, sessionDirName);
        if (fs.existsSync(sessionDir)) {
          // 有会话记录，自动创建 workspace 子目录（换电脑/换盘符场景）
          fs.mkdirSync(normalized, { recursive: true });
          console.log(`[projects] 自动创建项目目录(有会话): ${normalized}`);
        } else {
          // 无会话记录，不重建（避免已删除项目复活）
          console.warn('[projects] 路径不存在且无会话，跳过注册:', normalized);
          return normalized;
        }
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
      // 排除用户明确删除过的项目（防残留条目复活）
      if (isRemovedCwd(path.resolve(p.cwd))) return false;
      // 去重：相同 normalized cwd 只保留第一条（保留最早 addedAt）
      const normalized = path.resolve(p.cwd).toLowerCase();
      if (seen.has(normalized)) return false;  // 重复，只保留第一条
      seen.add(normalized);
      // 保留 archived 的（可能在归档区）
      if (p.archived) return true;
      // workspace 下的项目：目录存在则保留；目录不存在但有会话记录也保留（换电脑场景）；
      // 目录不存在且无会话记录 → 幽灵项目，清理（用户已在文件管理器删除）
      const resolved = path.resolve(p.cwd);
      if (extractWorkspaceSuffix(resolved)) {
        if (fs.existsSync(resolved)) return true;
        // 目录不存在，检查是否有会话记录
        const sessionDirName = encodeSessionDirName(resolved);
        const sessionDir = path.join(SESSIONS_DIR, sessionDirName);
        if (fs.existsSync(sessionDir)) return true;  // 有会话，保留
        return false;  // 无目录无会话，清理
      }
      // 其他路径必须存在
      return fs.existsSync(resolved);
    });
    if (valid.length < before) {
      console.log(`[projects] 清理+去重: ${before} → ${valid.length}`);
      writeProjectsJson(valid);
    }
    return valid;
  }

  // Encode cwd path to Tiffa session dir name
  function encodeSessionDirName(cwdPath) {
    // Tiffa 的编码规则 (cli.js WR5/d46):
    //   path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")
    //   然后首尾加 -- 
    // G:\Tiffa\workspace → --G--Tiffa-workspace--
    const resolved = path.resolve(cwdPath);
    const stripped = resolved.replace(/^[/\\]/, '');
    const encoded = stripped.replace(/[/\\:]/g, '-');
    return '--' + encoded + '--';
  }

  // Decode Tiffa session dir name back to cwd path
  // NOTE: Tiffa 的编码 replace(/[/\\:]/g, "-") 是有损的，
  // 目录名中的 - 和路径分隔符编码后的 - 无法区分。
  // 可靠的 cwd 来源是 JSONL 文件中的 cwd 字段。
  // 此函数仅作为 fallback 使用。
  function decodeSessionDirName(dirName) {
    if (!dirName.startsWith('--') || !dirName.endsWith('--')) return dirName;
    const inner = dirName.slice(2, -2); // e.g. "G--Tiffa-workspace"
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
        let text;
        try {
          const buf = Buffer.alloc(headSize);
          fs.readSync(fd, buf, 0, headSize, 0);
          text = buf.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
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

  // 判断 session 目录是否为空（无任何文件或子目录）
  // 空孤儿目录静默清理，不打 warn 日志
  function isEmptySessionDir(dirPath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries.length === 0;
    } catch {
      return false;
    }
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

        // 空孤儿目录（无任何会话文件）静默清理，不打 warn 日志
        if (!cwd && isEmptySessionDir(dirPath)) {
          try { fs.rmdirSync(dirPath); } catch {}
          continue;
        }

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

        // 用户明确删除过的项目：清理残留会话目录，绝不复活
        if (isRemovedCwd(normalized)) {
          console.log(`[migrate] 清理已删除项目的残留会话目录: ${dir.name}`);
          try { rimraf(dirPath); } catch {}
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
  // 场景：用户把 Tiffa 便携包从 G:\Tiffa\ 拷到新电脑的 D:\Tiffa\
  // 问题1: session 目录名编码了旧路径 --G--Tiffa-workspace-omp调试--
  // 问题2: projects.json 中的 cwd 是旧绝对路径 G:\Tiffa\workspace\omp调试
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
      // 如果 projects.json 里写的是 G:\Tiffa\workspace\xxx，但当前 PORTABLE_ROOT 是 D:\Tiffa
      // 则修正为 D:\Tiffa\workspace\xxx
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
        // 空孤儿目录静默清理；非空但无法提取 cwd 才打 warn
        if (isEmptySessionDir(dirPath)) {
          try { fs.rmdirSync(dirPath); } catch {}
        } else {
          console.log(`[migrate-path] 无法提取 cwd: ${dir.name}`);
        }
        continue;
      }

      const workspaceSuffix = extractWorkspaceSuffix(oldCwd);
      if (!workspaceSuffix) {
        // 非 workspace 下的项目，跳过（用户只迁移 workspace 下的项目）
        continue;
      }

      const newCwd = path.join(currentWorkspace, workspaceSuffix);
      const newDirName = encodeSessionDirName(newCwd);

      // 用户明确删除过的项目：清理残留会话目录，不迁移不复活
      if (isRemovedCwd(path.resolve(newCwd))) {
        console.log(`[migrate-path] 清理已删除项目的残留会话目录: ${dir.name}`);
        try { rimraf(dirPath); } catch {}
        continue;
      }

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
   * 品牌无关：优先按当前 PORTABLE_ROOT 下的 workspace 匹配（根目录改名也兼容），
   * 并兼容旧包曾放到其他盘符的迁移场景（任意 .../workspace/ 都提取后缀）。
   * 例如: E:\Tiffa\workspace\omp调试 → omp调试
   *       E:\OldPackage\workspace\ppt制作\sub → ppt制作\sub
   *       G:\some\other\path → null（不在任何 workspace 下）
   */
  function extractWorkspaceSuffix(absPath) {
    const normalized = absPath.replace(/\\/g, '/');
    // 1) 当前 PORTABLE_ROOT 下的 workspace（推荐，根目录叫什么都行）
    const workspaceRoot = path.join(PORTABLE_ROOT, 'workspace').replace(/\\/g, '/');
    if (normalized.toLowerCase().startsWith(workspaceRoot.toLowerCase() + '/')) {
      return normalized.slice(workspaceRoot.length + 1).replace(/\//g, path.sep);
    }
    // 2) 兼容迁移：旧包挪到别的盘符，按 .../workspace/ 提取相对后缀
    const match = normalized.match(/\/workspace\/(.+)$/i);
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
      let text;
      try {
        const buf = Buffer.alloc(headSize);
        fs.readSync(fd, buf, 0, headSize, 0);
        text = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
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
            // 手动重命名写入 header.title，作为 title 事件的 fallback
            if (obj.title && !title) title = obj.title;
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

  // ── 自动生成会话标题 ──
  // RPC-UI 模式下内核不调用 generateTitle，main.js 在 agent_end 后补标题。
  // 策略：读取 JSONL header，若无 title 则从第一条用户消息截取前 25 字作标题，
  // 写入 header.title + 追加 title 事件，然后通知前端更新标签。
  function _tryGenerateSessionTitle(inst) {
    try {
      const sessionPath = inst.sessionFilePath;
      if (!sessionPath) return;
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) return;

      const header = parseSessionHeader(resolved);
      // 已有标题（title 事件或 header.title）-> 不覆盖
      if (header.title) return;
      // 没有用户消息 -> 无法生成
      if (!header.firstMessage || header.firstMessage === '(空会话)') return;

      // 截取前 25 字作为标题（与前端 renderHistoryPanel 的截断长度一致）
      let title = header.firstMessage;
      // 去掉换行和多余空白
      title = title.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      if (title.length > 25) title = title.substring(0, 25) + '…';
      if (!title) return;

      // 写入 JSONL：更新 header.title + 追加 title 事件
      // 安全策略：只读第一行（header），修改后写回第一行位置，再 append title 事件到文件末尾
      // 避免读取整个文件再写回（与内核并发 append 冲突会丢数据）
      const fd = fs.openSync(resolved, 'r+');
      let headerBuf = Buffer.alloc(65536);
      const bytesRead = fs.readSync(fd, headerBuf, 0, 65536, 0);
      const headerText = headerBuf.toString('utf8', 0, bytesRead);
      const firstNl = headerText.indexOf('\n');
      if (firstNl < 0) { fs.closeSync(fd); return; }
      const firstLine = headerText.substring(0, firstNl);
      let headerObj;
      try { headerObj = JSON.parse(firstLine); } catch { fs.closeSync(fd); return; }
      headerObj.title = title;
      const newFirstLine = JSON.stringify(headerObj) + '\n';
      // 检查新 header 行长度不超过原 header 行长度（避免覆盖后续行）
      // 如果更长，放弃修改 header（仅追加 title 事件即可，parseSessionHeader 也能读到）
      if (newFirstLine.length <= firstLine.length + 1) {
        // 用空格 pad 到原长度，避免覆盖下一行
        const padded = newFirstLine.padEnd(firstLine.length + 1, ' ');
        fs.writeSync(fd, padded, 0, 'utf8');
      }
      fs.closeSync(fd);
      // 追加 title 事件到文件末尾（与内核的 append-only 写入模式一致，无并发冲突）
      const titleEvent = JSON.stringify({
        type: 'title', v: 1, title,
        updatedAt: new Date().toISOString(),
        source: 'auto',
      }) + '\n';
      fs.appendFileSync(resolved, titleEvent, 'utf8');

      // 通知前端更新标签标题
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tiffa:event', {
          type: 'session_info_update',
          title,
          sessionId: inst.sessionId,
          _cwd: inst.cwd,
          _sessionId: inst.sessionId,
        });
      }
      console.log(`[title-gen] 会话标题已生成: "${title}" (${inst._shortCwd()})`);
    } catch (err) {
      console.warn('[title-gen] 生成标题失败:', err.message);
    }
  }
  // 将标题生成函数注册为 TiffaInstance 的静态回调
  // （TiffaInstance 类定义在模块顶层，无法直接访问 setupIpc 闭包内的函数）
  TiffaInstance._titleGenerateCallback = _tryGenerateSessionTitle;

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
        let text;
        try {
          const buf = Buffer.alloc(10 * 1024 * 1024);
          fs.readSync(fd, buf, 0, 10 * 1024 * 1024, stat.size - 10 * 1024 * 1024);
          text = buf.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
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
      const messages = [];

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
              steering: msg.steering || false,
              follow_up: msg.follow_up || false,
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

  // 判断会话文件(.jsonl)是否属于指定 cwd（读取 header 中的 cwd 字段）
  function sessionFileBelongsToCwd(filePath, cwdLower) {
    try {
      const header = parseSessionHeader(filePath);
      return header && header.cwd && path.resolve(header.cwd).toLowerCase() === cwdLower;
    } catch { return false; }
  }

  // 外科手术式删除：只删会话目录中属于指定 cwd 的 .jsonl（编码碰撞场景：
  // logo\design 与 logo-design 编码后目录名相同，不能整目录删），并清理空目录
  function deleteSessionFilesForCwd(sessionDir, projectCwd) {
    if (!fs.existsSync(sessionDir)) return;
    const cwdLower = projectCwd.toLowerCase();
    for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
      const full = path.join(sessionDir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (sessionFileBelongsToCwd(full, cwdLower)) {
          try { fs.unlinkSync(full); } catch {}
        }
      } else if (entry.isDirectory()) {
        // 子目录模式：*_<uuid>/<name>.jsonl
        for (const sub of fs.readdirSync(full)) {
          if (!sub.endsWith('.jsonl')) continue;
          const subFull = path.join(full, sub);
          if (sessionFileBelongsToCwd(subFull, cwdLower)) {
            try { fs.unlinkSync(subFull); } catch {}
          }
        }
        try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch {}
      }
    }
    try { if (fs.readdirSync(sessionDir).length === 0) fs.rmdirSync(sessionDir); } catch {}
  }

  // 外科手术式移动：只把属于指定 cwd 的 .jsonl 移到目标目录（编码碰撞场景的归档）
  function moveSessionFilesForCwd(srcDir, destDir, projectCwd) {
    const cwdLower = projectCwd.toLowerCase();
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const full = path.join(srcDir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (sessionFileBelongsToCwd(full, cwdLower)) {
          try { fs.renameSync(full, path.join(destDir, entry.name)); } catch {}
        }
      } else if (entry.isDirectory()) {
        for (const sub of fs.readdirSync(full)) {
          if (!sub.endsWith('.jsonl')) continue;
          const subFull = path.join(full, sub);
          if (sessionFileBelongsToCwd(subFull, cwdLower)) {
            const subDest = path.join(destDir, entry.name);
            if (!fs.existsSync(subDest)) fs.mkdirSync(subDest, { recursive: true });
            try { fs.renameSync(subFull, path.join(subDest, sub)); } catch {}
          }
        }
        try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch {}
      }
    }
    try { if (fs.readdirSync(srcDir).length === 0) fs.rmdirSync(srcDir); } catch {}
  }

  ipcMain.handle('sessions:archiveProject', async (event, dirName, cwd) => {
    try {
      // 在 projects.json 中标记 archived（优先按 cwd 精确匹配，避免编码碰撞误伤）
      const allProjects = readProjectsJson();
      let project = null;
      if (cwd) {
        const normalized = path.resolve(cwd);
        project = allProjects.find(p => path.resolve(p.cwd) === normalized) || null;
        // cwd 已指定时不回退 dirName 匹配（防碰撞场景误归档兄弟项目）
      } else {
        project = findProjectByDirName(dirName).project;
      }
      if (project) {
        project.archived = true;
        project.archivedAt = new Date().toISOString();
        writeProjectsJson(allProjects);
      }

      // 仍然移动目录到归档区（保留物理数据以便恢复）
      const srcDir = path.join(SESSIONS_DIR, dirName);
      if (fs.existsSync(srcDir)) {
        const projectCwd = (project ? path.resolve(project.cwd) : null) || (cwd ? path.resolve(cwd) : null);
        // 编码碰撞检测：是否还有活跃项目共享此会话目录
        const hasSibling = projectCwd && allProjects.some(p =>
          !p.archived && path.resolve(p.cwd) !== projectCwd &&
          encodeSessionDirName(path.resolve(p.cwd)) === dirName);
        if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
        const destDir = path.join(ARCHIVE_DIR, dirName);
        if (hasSibling) {
          // 碰撞：只移走本项目的会话文件，兄弟项目的留下
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          moveSessionFilesForCwd(srcDir, destDir, projectCwd);
        } else {
          let finalDest = destDir;
          if (fs.existsSync(finalDest)) {
            finalDest = path.join(ARCHIVE_DIR, dirName + '-' + Date.now());
          }
          fs.renameSync(srcDir, finalDest);
        }
      }
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:deleteProject', async (event, dirName, cwd) => {
    try {
      // 定位项目（优先按 cwd 精确匹配：编码有损，logo\design 与 logo-design 的 dirName 相同）
      const allProjects = readProjectsJson();
      let project = null, normalized = null;
      if (cwd) {
        normalized = path.resolve(cwd);
        project = allProjects.find(p => path.resolve(p.cwd) === normalized) || null;
        // cwd 已指定时不回退 dirName 匹配：记录已不存在（重复删除）也不能误删兄弟项目
      } else {
        const found = findProjectByDirName(dirName);
        project = found.project;
        normalized = found.normalized;
      }
      // 从 projects.json 中删除记录
      let hasSibling = false;
      if (normalized) {
        const filtered = allProjects.filter(p => path.resolve(p.cwd) !== normalized);
        writeProjectsJson(filtered);
        // 碰撞检测：删除后是否仍有其他项目共享同一会话目录名
        hasSibling = filtered.some(p => encodeSessionDirName(path.resolve(p.cwd)) === dirName);
      }

      const projectCwd = normalized || ((project && project.cwd) ? path.resolve(project.cwd) : null);

      // ── 第一步：加入 removedCwds（必须在文件删除之前，即使后续步骤失败也不复活） ──
      if (projectCwd) {
        const removedList = readRemovedCwds();
        const lower = projectCwd.toLowerCase();
        if (!removedList.includes(lower)) {
          removedList.push(lower);
          writeRemovedCwds(removedList);
        }
      }

      // ── 第二步：同步杀死该项目的所有实例（userKilled 防自动重启） ──
      if (projectCwd) {
        const keysToDelete = [];
        for (const [key, inst] of tiffaManager.instances) {
          if (inst.cwd === projectCwd) {
            inst.kill(true); // 同步树杀，确保进程已死、文件句柄释放
            keysToDelete.push(key);
          }
        }
        for (const key of keysToDelete) {
          tiffaManager.instances.delete(key);
        }
        if (tiffaManager.activeCwd === projectCwd) {
          tiffaManager.activeKey = null;
          tiffaManager.activeCwd = null;
        }
        // 等待操作系统释放文件句柄
        if (keysToDelete.length > 0) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // ── 第三步：物理删除会话数据（带重试，防 Windows 文件锁残留） ──
      // 编码碰撞时只删本项目的会话文件，兄弟项目的保留
      const srcDir = path.join(SESSIONS_DIR, dirName);
      const archiveSrcDir = path.join(ARCHIVE_DIR, dirName);
      if (hasSibling && projectCwd) {
        console.log(`[deleteProject] 编码碰撞，仅删除 ${projectCwd} 的会话文件`);
        deleteSessionFilesForCwd(srcDir, projectCwd);
        deleteSessionFilesForCwd(archiveSrcDir, projectCwd);
      } else {
        await rimrafWithRetry(srcDir);
        // 归档区的数据也一并清理（永久删除归档项目时走这里）
        await rimrafWithRetry(archiveSrcDir);
      }

      // ── 第四步：删除 workspace 下的项目物理目录（否则 discover 会重新发现） ──
      if (projectCwd) {
        // 安全检查：只删 workspace 子目录，不删 workspace 根目录本身
        const wsSuffix = extractWorkspaceSuffix(projectCwd);
        if (wsSuffix) {
          // 嵌套项目保护：目录内还有其他注册项目时不删物理目录
          // （否则 ensureProjectInJson 会因嵌套项目的会话记录立即重建父目录）
          const prefix = projectCwd.toLowerCase() + path.sep;
          const hasNested = readProjectsJson().some(p => path.resolve(p.cwd).toLowerCase().startsWith(prefix));
          if (hasNested) {
            console.log(`[deleteProject] 目录内存在嵌套项目，跳过物理删除: ${projectCwd}`);
          } else {
            await rimrafWithRetry(projectCwd);
            console.log(`[deleteProject] 已删除 workspace 目录: ${projectCwd}`);
          }
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

  // ── 单会话归档：关闭实例 + 移动 jsonl 到归档目录 ──
  ipcMain.handle('sessions:archiveSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      // 先关闭实例，防止内核后续写盘在归档后的原路径重建文件
      _closeInstancesForSessionFile(resolved);
      await new Promise(r => setTimeout(r, 300));
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

  // ── 单会话删除：关闭实例 + 物理删除 jsonl 文件（幂等） ──
  ipcMain.handle('sessions:deleteSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl')) {
        return { error: 'Session file not found' };
      }
      // 先关闭持有该会话的实例：防内核写盘复活文件 + 释放文件句柄（Windows unlink EBUSY）
      _closeInstancesForSessionFile(resolved);
      await new Promise(r => setTimeout(r, 300));
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
      // 幂等：文件已不存在也视为删除成功（目标就是删掉它），仅路径非法/IO 错误才报错
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 重命名会话：修改 jsonl 文件中的 title ──
  ipcMain.handle('sessions:rename', async (event, sessionPath, newTitle) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      const text = fs.readFileSync(resolved, 'utf8');
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) {
        return { error: 'Invalid session file' };
      }
      const firstLine = text.substring(0, firstNewline);
      let header;
      try {
        header = JSON.parse(firstLine);
      } catch {
        return { error: 'Invalid session header JSON' };
      }
      header.title = newTitle;
      const newFirstLine = JSON.stringify(header) + '\n';
      const newText = newFirstLine + text.substring(firstNewline + 1);
      fs.writeFileSync(resolved, newText, 'utf8');
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 列出归档的会话（单会话级别）

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

  // ── 全局记忆召回：直接查询 mnemopi SQLite FTS，不经过内核 ──
  ipcMain.handle('memory:recall', async (event, query) => {
    const q = (query || '').trim();
    if (!q) return { results: [], error: '空查询' };
    try {
      const pythonExe = path.join(PORTABLE_ROOT, 'python', 'python.exe');
      const banksDir = path.join(AGENT_DIR, 'memories', 'mnemopi', 'banks');
      const script = `
import sqlite3, os, glob, json, sys

query = sys.argv[1]
banks_dir = sys.argv[2]
results = []

for db_path in glob.glob(os.path.join(banks_dir, '*', 'mnemopi.db')):
    bank = os.path.basename(os.path.dirname(db_path))
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        fts_ok = False
        try:
            cur.execute(
                "SELECT wm.id, wm.content, wm.source, wm.timestamp, wm.session_id "
                "FROM fts_working JOIN working_memory wm ON fts_working.id = wm.id "
                "WHERE fts_working MATCH ? ORDER BY rank LIMIT 20",
                (query,)
            )
            for row in cur.fetchall():
                results.append({
                    'id': row['id'],
                    'content': row['content'][:500],
                    'source': row['source'] or '',
                    'timestamp': row['timestamp'] or '',
                    'session_id': row['session_id'] or '',
                    'bank': bank,
                    'score': 1.0,
                })
            fts_ok = True
        except Exception:
            pass
        if not fts_ok:
            cur.execute(
                "SELECT id, content, source, timestamp, session_id "
                "FROM working_memory WHERE content LIKE ? "
                "ORDER BY timestamp DESC LIMIT 20",
                (f'%{query}%',)
            )
            for row in cur.fetchall():
                results.append({
                    'id': row['id'],
                    'content': row['content'][:500],
                    'source': row['source'] or '',
                    'timestamp': row['timestamp'] or '',
                    'session_id': row['session_id'] or '',
                    'bank': bank,
                    'score': 0.5,
                })
        conn.close()
    except Exception:
        pass

results.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
print(json.dumps({'results': results[:30]}, ensure_ascii=False))
`;
      const { execFileSync } = require('child_process');
      const output = execFileSync(pythonExe, ['-c', script, q, banksDir], {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024,
      });
      return JSON.parse(output.trim());
    } catch (err) {
      console.error('[memory:recall] error:', err.message);
      return { results: [], error: err.message };
    }
  });
}

// ── App Lifecycle ──

app.whenReady().then(() => {
  setupIpc();
  createWindow();
  // 懒启动：不在此处启动 Tiffa，等前端 loadProjects 切换项目时再 activate
  //（此处不再 activate 默认工作区，避免启动时创建两个 Tiffa 实例）

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  tiffaManager.killAll();
  app.quit();
});

app.on('before-quit', () => {
  // 同步杀所有进程（app 退出路径必须同步等进程死透）
  for (const inst of tiffaManager.instances.values()) {
    if (inst.process) {
      try {
        inst.process.stdin.write(JSON.stringify({ type: 'abort' }) + '\n');
      } catch (e) { /* ignore */ }
      _killTree(inst.process.pid, true);
    }
  }
  // 给 2 秒时间优雅退出
  setTimeout(() => {
    tiffaManager.killAll();
  }, 2000);
});
