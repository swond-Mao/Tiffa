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
import { stableSessionDirName, extractSessionIdFromPath, parseSessionHeader, mainLog } from './session-utils';
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
  /** 用户消息（prompt/steer/follow_up）已发出未完成：prewarm 定时器必须避开，
   *  否则 isPrewarming=true 会把用户回复流尾部全部吞掉（见 _handleEvent prewarm 过滤） */
  userPromptInFlight = false;
  sessionFilePath: string | null = null;
  /** 最近一次用户 prompt 文本（非内部命令）：用于探测内核自动创建的会话文件。
   *  内核 RPC 模式从不向主进程发送 session_switch（hooks 内部事件不输出），
   *  新对话实例的 sessionId/sessionFilePath 永远停留在前端临时 UUID——
   *  渲染层 migrateStuckNewTabs 因此拿不到真实路径，__new__ tab 永不迁移。
   *  这里在 agent_start（会话文件必已创建）时按 firstMessage 探测并模拟补发
   *  session_switch，让实例身份/事件路由/迁移链路恢复正常。 */
  lastPromptMessage: string | null = null;
  /** 本实例当前 spawn 的起始时间（探测时按文件创建时间约束，避免误匹配旧会话） */
  spawnedAt = Date.now();
  /** 迁移前的旧 sessionId 列表（探测/session_switch 迁移时追加；渲染层匹配用） */
  prevSessionIds: string[] = [];
  /** 会话文件目录（--session-dir 参数，探测扫描用） */
  sessionDir: string;
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
    this.sessionDir = path.join(SESSIONS_DIR, stableSessionDirName(cwd));
  }

  start(): void {
    if (this.process) return;
    this.userKilled = false;
    this.spawnedAt = Date.now();

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
      if (frame.type === 'prompt' || frame.type === 'steer' || frame.type === 'follow_up') {
        this.userPromptInFlight = true;
      }
      // 记录用户 prompt 文本（内部命令排除），供 agent_start 时探测内核自动创建的会话文件
      if (frame.type === 'prompt' && typeof frame.message === 'string' && !frame.message.trim().startsWith('/')) {
        this.lastPromptMessage = frame.message;
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
    if (frame.type === 'prompt' || frame.type === 'steer' || frame.type === 'follow_up') {
      this.userPromptInFlight = true;
    }
    // 记录用户 prompt 文本（内部命令排除），供 agent_start 时探测内核自动创建的会话文件
    if (frame.type === 'prompt' && typeof frame.message === 'string' && !frame.message.trim().startsWith('/')) {
      this.lastPromptMessage = frame.message;
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
        if (this.agentRunning || this.userPromptInFlight || this._restoringContext) return;
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
      // 会话文件探测：内核 RPC 模式不输出 session_switch，新会话文件的真实
      // id/路径主进程拿不到 → 实例身份停留在临时 UUID、渲染层迁移失效。
      // agent_start 时会话文件必已创建，按 firstMessage 匹配并模拟补发 session_switch。
      if (!this.sessionFilePath) this._probeSessionFile();
    } else if (event.type === 'agent_end') {
      mainLog(`[${this._shortCwd()}#${this.sessionId}] agent_end code=${event._wasPrewarming ? 'prewarm' : 'normal'}`);
      event._wasPrewarming = this.isPrewarming;
      this.agentRunning = false;
      this.userPromptInFlight = false;
      // agent_end 兜底探测：agent_start 时 firstMessage 可能尚未写盘（竞态）导致
      // 探测未命中——结束时文件必已完整，补探测并模拟补发 session_switch。
      if (!this.sessionFilePath) this._probeSessionFile();
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
        if (this.sessionId && !this.prevSessionIds.includes(this.sessionId)) this.prevSessionIds.push(this.sessionId);
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

  /** 探测内核自动创建的会话文件（RPC 模式无 session_switch 事件时的补偿机制）：
   *  内核把新会话文件写到磁盘（firstMessage = 用户 prompt 原文），但从不向主进程
   *  发送 session_switch（hooks 内部事件不输出到 stdout）→ 实例 sessionId 永远停留在
   *  前端临时 UUID、sessionFilePath 为 null → 渲染层 __new__ 迁移全部失效。
   *  这里按 firstMessage + 文件创建时间（>= 本次 spawn）匹配，命中后更新实例身份，
   *  并模拟补发 session_switch（_sessionIdPrev = 旧临时 id，渲染层归属校验按它通过）。 */
  private _probeSessionFile(): void {
    const promptText = this.lastPromptMessage;
    if (!promptText) return;
    const wanted = promptText.trim();
    if (!wanted) return;
    try {
      const files: string[] = [];
      const walk = (dir: string): void => {
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.isFile() && e.name.endsWith('.jsonl')) files.push(full);
        }
      };
      walk(this.sessionDir);
      // 候选必须唯一：多个同 firstMessage 的新文件（并发新对话发同一句话）不迁移，
      // 避免把实例身份错迁到别人的会话导致更严重的串台。
      let hit: string | null = null;
      let hitCount = 0;
      for (const file of files) {
        let st;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        // 只匹配本实例 spawn 之后创建的文件（排除旧会话/并发其他实例的会话）。
        // Windows 部分文件系统 birthtime 可能为 0，此时回退 mtime。
        const created = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
        if (created < this.spawnedAt - 1000) continue;
        const header = parseSessionHeader(file);
        if (!header.firstMessage) continue;
        if (header.firstMessage.trim() !== wanted) continue;
        hitCount++;
        hit = file;
      }
      if (hitCount !== 1 || !hit) return;
      {
        const file = hit;
        const header = parseSessionHeader(file);
        const realId = header.sessionId || extractSessionIdFromPath(file);
        const oldId = this.sessionId;
        if (realId && realId !== oldId) {
          if (oldId && !this.prevSessionIds.includes(oldId)) this.prevSessionIds.push(oldId);
          if (_migrateSessionId) _migrateSessionId(this.cwd, oldId, realId);
          this.sessionId = realId;
        }
        this.sessionFilePath = file;
        mainLog(
          `[${this._shortCwd()}#${this.sessionId}] 探测到会话文件 ${path.basename(file)} (${oldId || 'null'} -> ${realId || 'null'})`,
        );
        // 模拟补发 session_switch：渲染层 __new__ 迁移依赖它（内核 RPC 模式不发送）
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('tiffa:event', {
            type: 'session_switch',
            reason: 'new',
            sessionPath: file,
            _cwd: this.cwd,
            _sessionIdPrev: oldId,
            _sessionId: realId,
            _sessionPath: file,
            _probed: true,
          } as TiffaEvent);
        }
      }
    } catch {
      /* ignore */
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
