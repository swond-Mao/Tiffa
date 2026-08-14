/**
 * TiffaInstance: 单个 Tiffa 子进程的完整生命周期管理
 *
 * 从 main.js 搬移。依赖通过模块导入 + setter 注入：
 * - mainWindow: setMainWindow() 注入（窗口创建后调用）
 * - migrateSessionId: setMigrateCallback() 注入（tiffa-manager 加载后调用）
 * - titleGenerateCallback: setTitleGenerateCallback() 注入
 */
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type { BrowserWindow } from 'electron';
import {
  PORTABLE_ROOT,
  BUN_EXE,
  TIFFA_CLI,
  EXTENSION_PATH,
  COMPUTER_USE_EXTENSION_PATH,
  SESSIONS_DIR,
} from './constants';
import { stableSessionDirName, extractSessionIdFromPath, mainLog } from './session-utils';
import { killTree, utf8Env } from './process-utils';

// ── 依赖注入 ──
let _mainWindow: BrowserWindow | null = null;
let _migrateSessionId: ((cwd: string, oldSid: string | null, newSid: string) => void) | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  _mainWindow = win;
}

export function setMigrateCallback(
  fn: (cwd: string, oldSid: string | null, newSid: string) => void,
): void {
  _migrateSessionId = fn;
}

export interface TiffaEvent {
  type: string;
  [key: string]: unknown;
}

export interface PendingCommand {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TiffaInstance {
  cwd: string;
  sessionId: string | null;
  process: ReturnType<typeof spawn> | null = null;
  rl: { on: (event: string, cb: (line: string) => void) => void; close: () => void } | null = null;
  ready = false;
  agentRunning = false;
  pendingCommands = new Map<string, PendingCommand>();
  commandId = 0;
  lastActiveTime = Date.now();
  userKilled = false;
  crashCount = 0;
  maxCrashRestart = 3;
  _restartTimer: ReturnType<typeof setTimeout> | null = null;
  isPrewarming = false;
  sessionFilePath: string | null = null;
  _titleGenerated = false;
  _restoringContext = false;
  _pendingAskIds = new Set<string>();
  _rpcChunkBuffer: Map<string, { count: number; chunks: Buffer[]; received: number; byteLength: number }> | null = null;
  stderrDecoder: StringDecoder | null = null;

  static _titleGenerateCallback: ((inst: TiffaInstance) => void) | null = null;

  static setTitleGenerateCallback(fn: ((inst: TiffaInstance) => void) | null): void {
    TiffaInstance._titleGenerateCallback = fn;
  }

  constructor(cwd: string, sessionId: string | null = null) {
    this.cwd = cwd;
    this.sessionId = sessionId;
  }

  start(): void {
    if (this.process) return;
    this.userKilled = false;

    const env: Record<string, string | undefined> = {
      ...process.env,
      ...utf8Env(),
      PI_CODING_AGENT_DIR: path.join(PORTABLE_ROOT, 'data', 'agent'),
      HOME: path.join(PORTABLE_ROOT, 'home'),
      USERPROFILE: path.join(PORTABLE_ROOT, 'home'),
      BUN_INSTALL: PORTABLE_ROOT,
      TIFFA_COMPACT: 'auto',
      MNEMOPI_EMBEDDING_MODEL: 'BAAI/bge-small-zh-v1.5',
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

    const stableSessionDir = path.join(SESSIONS_DIR, stableSessionDirName(this.cwd));
    args.push('--session-dir', stableSessionDir);

    console.log(`[TiffaInstance] Starting Tiffa cwd=${this.cwd}`, BUN_EXE, args.join(' '));

    this.process = spawn(BUN_EXE, args, {
      env: env as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: false,
    });
    const proc = this.process;
    if (!proc) return;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.rl = require('readline').createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });
    const rl = this.rl;
    if (!rl) return;
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as TiffaEvent;
        this._handleEvent(event);
      } catch (e) {
        console.warn(`[TiffaInstance:${this._shortCwd()}] 无法解析事件:`, trimmed.substring(0, 200));
      }
    });

    this.stderrDecoder = new StringDecoder('utf8');
    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = this.stderrDecoder!.write(chunk).trim();
      if (text) console.log(`[tiffa:stderr:${this._shortCwd()}]`, text);
    });

    proc.stdin!.on('error', (err: Error) => {
      console.warn(`[TiffaInstance:${this._shortCwd()}] stdin 管道错误:`, err.message);
    });
    proc.stdout!.on('error', (err: Error) => {
      console.warn(`[TiffaInstance:${this._shortCwd()}] stdout 管道错误:`, err.message);
    });
    proc.stderr!.on('error', (err: Error) => {
      console.warn(`[TiffaInstance:${this._shortCwd()}] stderr 管道错误:`, err.message);
    });

    proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      mainLog(`[${this._shortCwd()}#${this.sessionId}] EXIT code=${code} signal=${signal} userKilled=${this.userKilled} crashCount=${this.crashCount}`);
      console.log(`[TiffaInstance:${this._shortCwd()}] 已退出:`, { code, signal, userKilled: this.userKilled, crashCount: this.crashCount });

      for (const [, { reject }] of this.pendingCommands) {
        reject(new Error(`Tiffa process exited (code=${code}, signal=${signal})`));
      }
      this.pendingCommands.clear();

      try {
        this._cleanup();
      } catch (e) {
        console.warn(`[TiffaInstance:${this._shortCwd()}] _cleanup 异常:`, e);
      }

      const shouldRestart = !this.userKilled && this.crashCount < this.maxCrashRestart;
      if (shouldRestart) {
        this.crashCount++;
        console.log(`[TiffaInstance:${this._shortCwd()}] 3秒后自动重启 (第${this.crashCount}次)`);
        this._restartTimer = setTimeout(() => {
          this._restartTimer = null;
          try { this.start(); } catch (e) { console.warn(`[TiffaInstance:${this._shortCwd()}] 自动重启 start() 异常:`, e); }
        }, 3000);
      }

      if (_mainWindow && !_mainWindow.isDestroyed()) {
        try {
          _mainWindow.webContents.send('tiffa:exited', {
            code, signal, cwd: this.cwd, sessionId: this.sessionId,
            autoRestarting: shouldRestart, crashCount: this.crashCount,
          });
        } catch (e) {
          console.warn(`[TiffaInstance:${this._shortCwd()}] 通知渲染进程 exited 失败:`, e);
        }
      }
    });

    proc.on('error', (err: Error) => {
      console.error(`[TiffaInstance:${this._shortCwd()}] 启动失败:`, err);
      this.process = null;
    });
  }

  kill(sync = false): void {
    if (!this.process) return;
    const proc = this.process;
    this.userKilled = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    killTree(proc.pid, sync);
    this._cleanup();
  }

  sendCommand(frame: TiffaEvent): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin!.writable) {
        reject(new Error('Tiffa process not running'));
        return;
      }

      if (this.isPrewarming) {
        this.isPrewarming = false;
        console.log(`[TiffaInstance:${this._shortCwd()}] 用户命令到达，取消预热过滤`);
      }
      if (this._restoringContext && (frame.type === 'prompt' || frame.type === 'steer' || frame.type === 'follow_up')) {
        this._restoringContext = false;
        console.log(`[TiffaInstance:${this._shortCwd()}] 用户命令到达，取消上下文恢复过滤`);
      }

      const id = `cmd_${++this.commandId}`;
      frame.id = id;

      const existingCmd = this.pendingCommands.get(id);
      if (existingCmd) {
        clearTimeout(existingCmd.timer);
        existingCmd.reject(new Error(`command id collision, superseded: ${id}`));
      }

      const timer = setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          console.warn(`[TiffaInstance:${this._shortCwd()}] command timeout: ${frame.type} (${id})`);
          reject(new Error(`Command timeout: ${frame.type}`));
        }
      }, 5 * 60 * 1000);

      this.pendingCommands.set(id, { resolve, reject, timer });

      const line = JSON.stringify(frame) + '\n';
      try {
        this.process!.stdin!.write(line, 'utf8');
      } catch (err) {
        clearTimeout(timer);
        this.pendingCommands.delete(id);
        reject(err as Error);
      }
    });
  }

  sendRaw(frame: TiffaEvent): void {
    if (!this.process || !this.process.stdin!.writable) {
      console.error(`[TiffaInstance:${this._shortCwd()}] Tiffa 未运行，无法发送`);
      return;
    }
    if (this.isPrewarming && (frame.type === 'prompt' || frame.type === 'steer' || frame.type === 'follow_up')) {
      this.isPrewarming = false;
      console.log(`[TiffaInstance:${this._shortCwd()}] 用户 raw 命令(${frame.type})到达，取消预热过滤`);
    }
    const line = JSON.stringify(frame) + '\n';
    try {
      this.process!.stdin!.write(line, 'utf8');
    } catch (err) {
      console.error(`[TiffaInstance:${this._shortCwd()}] stdin.write 失败:`, (err as Error).message);
    }
  }

  private _handleEvent(event: TiffaEvent): void {
    this.lastActiveTime = Date.now();

    if (event.type === 'ready') {
      this.ready = true;
      this.agentRunning = false;
      this.crashCount = 0;
      console.log(`[TiffaInstance:${this._shortCwd()}] 就绪`);
      setTimeout(() => {
        if (this.agentRunning) return;
        this.isPrewarming = true;
        this.sendRaw({ type: 'prompt', message: '/memory rebuild' });
        setTimeout(() => { this.isPrewarming = false; }, 30000);
      }, 3000);
      if (this.sessionFilePath && this.sessionId) {
        const sf = this.sessionFilePath;
        if (fs.existsSync(sf)) {
          this._restoringContext = true;
          const restoreDeadline = setTimeout(() => {
            if (this._restoringContext) {
              this._restoringContext = false;
              console.warn(`[TiffaInstance:${this._shortCwd()}] 崩溃重启上下文恢复超时，强制解除过滤`);
            }
          }, 15000);
          this.sendCommand({ type: 'switch_session', sessionPath: sf })
            .then(() => { console.log(`[TiffaInstance:${this._shortCwd()}] 崩溃重启后上下文已恢复`); })
            .catch((e: Error) => { console.warn(`[TiffaInstance:${this._shortCwd()}] 崩溃重启后上下文恢复失败: ${e.message}`); })
            .finally(() => { clearTimeout(restoreDeadline); setTimeout(() => { this._restoringContext = false; }, 800); });
        }
      }
    }

    if (event.type === 'prompt_result' && event.agentInvoked) {
      this.agentRunning = true;
      mainLog(`[${this._shortCwd()}#${this.sessionId}] prompt_result agentInvoked`);
    } else if (event.type === 'agent_start') {
      this.agentRunning = true;
      mainLog(`[${this._shortCwd()}#${this.sessionId}] agent_start`);
    } else if (event.type === 'agent_end') {
      mainLog(`[${this._shortCwd()}#${this.sessionId}] agent_end code=${event._wasPrewarming ? 'prewarm' : 'normal'}`);
      event._wasPrewarming = this.isPrewarming;
      this.agentRunning = false;
      if (!event._wasPrewarming && !this._titleGenerated) {
        this._titleGenerated = true;
        setTimeout(() => {
          if (TiffaInstance._titleGenerateCallback) TiffaInstance._titleGenerateCallback(this);
        }, 6000);
      }
    }

    // RPC chunked responses
    if (event.type === 'rpc_chunk' && event.chunkId) {
      const cid = event.chunkId as string;
      if (!this._rpcChunkBuffer) this._rpcChunkBuffer = new Map();
      if (!this._rpcChunkBuffer.has(cid)) {
        this._rpcChunkBuffer.set(cid, {
          count: event.count as number,
          chunks: new Array(event.count as number),
          received: 0,
          byteLength: event.byteLength as number,
        });
      }
      const buf = this._rpcChunkBuffer.get(cid)!;
      if (buf.chunks[event.index as number]) return;
      buf.chunks[event.index as number] = Buffer.from(event.data as string, 'base64');
      buf.received++;
      if (buf.received < buf.count) return;
      const fullBuf = Buffer.concat(buf.chunks);
      this._rpcChunkBuffer.delete(cid);
      try {
        const parsed = JSON.parse(fullBuf.toString('utf8')) as TiffaEvent;
        event = parsed;
      } catch (e) {
        console.warn(`[TiffaInstance:${this._shortCwd()}] rpc_chunk reassembly JSON parse failed: ${(e as Error).message}`);
        return;
      }
    }

    // Command responses
    if (event.type === 'response' && event.id && this.pendingCommands.has(event.id as string)) {
      const { resolve, reject, timer } = this.pendingCommands.get(event.id as string)!;
      clearTimeout(timer);
      this.pendingCommands.delete(event.id as string);
      if (event.success) {
        resolve(event.data);
      } else {
        reject(new Error((event.error as string) || 'Command failed'));
      }
      return;
    }

    // session_switch
    // 收紧迁移条件（与旧版注释语义一致）：prewarm 的 /memory rebuild 产生的 session_switch
    // 是当前会话自己的路径（realSessionId === this.sessionId），不会走到迁移分支；
    // 走到这里的（realSessionId !== this.sessionId）只可能是用户消息触发的新建会话
    // session_switch——必须迁移，否则实例 key/sessionId 停留在 temp，前端按 real id
    // 路由时查不到实例 → spawn 新进程 → 对话分裂/漂移。
    if (event.type === 'session_switch' && event.sessionPath && !this._restoringContext) {
      // 记录迁移前 id（新建对话实例 = 前端临时 UUID），透传给渲染层做归属校验：
      // 只有 prevId === 前端临时 id 的 session_switch 才是本实例自己的迁移；
      // 后台实例（已迁移旧会话）的 prevId 是真实 id，会被渲染层过滤。
      // 注意不能直接透传 this.sessionId：转发前它已被更新为真实 id（见下），
      // 渲染层拿它比临时 id 永远不相等 → __new__ 永不迁移 → AI 重命名/切走卡"准备中"。
      const prevSessionId = this.sessionId;
      this.sessionFilePath = event.sessionPath as string;
      const realSessionId = extractSessionIdFromPath(event.sessionPath as string);
      if (realSessionId && realSessionId !== this.sessionId) {
        if (_migrateSessionId) _migrateSessionId(this.cwd, this.sessionId, realSessionId);
        this.sessionId = realSessionId;
      }
      (event as { _sessionIdPrev?: string })._sessionIdPrev = prevSessionId;
    }

    // ask 记账
    if (event.type === 'extension_ui_request') {
      const m = event.method as string;
      if (m === 'cancel') {
        this._pendingAskIds.delete((event.targetId as string) || (event.id as string));
        this._pendingAskIds.delete(event.id as string);
        mainLog(`[${this._shortCwd()}#${this.sessionId}] ui-req cancel target=${event.targetId || event.id}`);
      } else if (['editor', 'select', 'confirm', 'input'].includes(m)) {
        this._pendingAskIds.add(event.id as string);
        mainLog(`[${this._shortCwd()}#${this.sessionId}] ui-req ${m} id=${event.id} pending=${this._pendingAskIds.size}`);
      }
    }

    event._cwd = this.cwd;
    event._sessionId = this.sessionId;
    event._sessionPath = this.sessionFilePath || null;

    const eventWasPrewarm = event._wasPrewarming || this.isPrewarming;
    if (eventWasPrewarm) {
      if (event.type === 'agent_end') this.isPrewarming = false;
      if (event.type !== 'extension_ui_request') return;
    }

    if (this._restoringContext && event.type !== 'session_switch' && event.type !== 'response'
        && event.type !== 'extension_ui_request') {
      return;
    }

    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('tiffa:event', event);
    }
  }

  private _cleanup(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.stderrDecoder) {
      const tail = this.stderrDecoder.write(Buffer.alloc(0)).trim();
      if (tail) console.log(`[tiffa:stderr:${this._shortCwd()}]`, tail);
      this.stderrDecoder = null;
    }
    this.process = null;
    this.ready = false;
    this.agentRunning = false;
  }

  _shortCwd(): string {
    const parts = this.cwd.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || this.cwd;
  }
}
