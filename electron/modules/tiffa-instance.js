"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TiffaInstance = void 0;
exports.setMainWindow = setMainWindow;
exports.setMigrateCallback = setMigrateCallback;
/**
 * TiffaInstance: 单个 Tiffa 子进程的完整生命周期管理
 *
 * 从 main.js 搬移。依赖通过模块导入 + setter 注入：
 * - mainWindow: setMainWindow() 注入（窗口创建后调用）
 * - migrateSessionId: setMigrateCallback() 注入（tiffa-manager 加载后调用）
 * - titleGenerateCallback: setTitleGenerateCallback() 注入
 */
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const constants_1 = require("./constants");
const session_utils_1 = require("./session-utils");
const process_utils_1 = require("./process-utils");
// ── 依赖注入 ──
let _mainWindow = null;
let _migrateSessionId = null;
function setMainWindow(win) {
    _mainWindow = win;
}
function setMigrateCallback(fn) {
    _migrateSessionId = fn;
}
class TiffaInstance {
    cwd;
    sessionId;
    process = null;
    rl = null;
    ready = false;
    agentRunning = false;
    pendingCommands = new Map();
    commandId = 0;
    lastActiveTime = Date.now();
    userKilled = false;
    crashCount = 0;
    maxCrashRestart = 3;
    _restartTimer = null;
    isPrewarming = false;
    /** 用户消息（prompt/steer/follow_up）已发出未完成：prewarm 定时器必须避开，
     *  否则 isPrewarming=true 会把用户回复流尾部全部吞掉（见 _handleEvent prewarm 过滤） */
    userPromptInFlight = false;
    sessionFilePath = null;
    /** 最近一次用户 prompt 文本（非内部命令）：用于探测内核自动创建的会话文件。
     *  内核 RPC 模式从不向主进程发送 session_switch（hooks 内部事件不输出），
     *  新对话实例的 sessionId/sessionFilePath 永远停留在前端临时 UUID——
     *  渲染层 migrateStuckNewTabs 因此拿不到真实路径，__new__ tab 永不迁移。
     *  这里在 agent_start（会话文件必已创建）时按 firstMessage 探测并模拟补发
     *  session_switch，让实例身份/事件路由/迁移链路恢复正常。 */
    lastPromptMessage = null;
    /** 本实例当前 spawn 的起始时间（探测时按文件创建时间约束，避免误匹配旧会话） */
    spawnedAt = Date.now();
    /** 迁移前的旧 sessionId 列表（探测/session_switch 迁移时追加；渲染层匹配用） */
    prevSessionIds = [];
    /** 会话文件目录（--session-dir 参数，探测扫描用） */
    sessionDir;
    /** 新建会话预写的正式文件（spawn 时通过 --session 引导内核加载，身份立即确定） */
    initialSessionFile = null;
    _titleGenerated = false;
    _restoringContext = false;
    _pendingAskIds = new Set();
    _rpcChunkBuffer = null;
    stderrDecoder = null;
    /** 最近 stderr 尾部（环形，≤4000 字符）：exit 时识别「配置致命错误」用 */
    _stderrTail = '';
    static _titleGenerateCallback = null;
    static setTitleGenerateCallback(fn) {
        TiffaInstance._titleGenerateCallback = fn;
    }
    constructor(cwd, sessionId = null, initialSessionFile = null) {
        this.cwd = cwd;
        this.sessionId = sessionId;
        this.initialSessionFile = initialSessionFile;
        this.sessionDir = path_1.default.join(constants_1.SESSIONS_DIR, (0, session_utils_1.stableSessionDirName)(cwd));
    }
    start() {
        if (this.process)
            return;
        this.userKilled = false;
        this.spawnedAt = Date.now();
        const env = {
            ...process.env,
            ...(0, process_utils_1.utf8Env)(),
            PI_CODING_AGENT_DIR: path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent'),
            HOME: path_1.default.join(constants_1.PORTABLE_ROOT, 'home'),
            USERPROFILE: path_1.default.join(constants_1.PORTABLE_ROOT, 'home'),
            // pip 配置重定向到便携包（install.ps1 写入 home\pip\pip.ini，不污染系统 %APPDATA%，跨盘迁移可用）
            ...(fs_1.default.existsSync(path_1.default.join(constants_1.PORTABLE_ROOT, 'home', 'pip', 'pip.ini'))
                ? { PIP_CONFIG_FILE: path_1.default.join(constants_1.PORTABLE_ROOT, 'home', 'pip', 'pip.ini') }
                : {}),
            // 暴露技能共享 npm 依赖（docx 等）：docx-js 生成的脚本在任意目录 require('docx')
            NODE_PATH: path_1.default.join(constants_1.PORTABLE_ROOT, 'skill-deps', 'node_modules'),
            // playwright 浏览器落盘位置（Windows 读 LOCALAPPDATA），重定向到便携 home 随包迁移
            LOCALAPPDATA: path_1.default.join(constants_1.PORTABLE_ROOT, 'home', 'AppData', 'Local'),
            BUN_INSTALL: constants_1.PORTABLE_ROOT,
            TIFFA_COMPACT: 'auto',
            MNEMOPI_EMBEDDING_MODEL: 'BAAI/bge-small-zh-v1.5',
            PATH: [
                path_1.default.join(constants_1.PORTABLE_ROOT, 'python'),
                path_1.default.join(constants_1.PORTABLE_ROOT, 'python', 'Scripts'),
                path_1.default.join(constants_1.PORTABLE_ROOT, 'node'),
                path_1.default.join(constants_1.PORTABLE_ROOT, 'npm-global', 'node_modules', 'bun', 'bin'),
                process.env.PATH || '',
            ].join(path_1.default.delimiter),
        };
        delete env.NODE_OPTIONS;
        delete env.ELECTRON_RUN_AS_NODE;
        const args = [constants_1.TIFFA_CLI, '--mode', 'rpc-ui', '-e', constants_1.EXTENSION_PATH, '-e', constants_1.COMPUTER_USE_EXTENSION_PATH];
        const stableSessionDir = path_1.default.join(constants_1.SESSIONS_DIR, (0, session_utils_1.stableSessionDirName)(this.cwd));
        args.push('--session-dir', stableSessionDir);
        // 新建会话：预写正式文件已就绪 → 启动即加载（resume 语义），身份在 spawn 时确定
        if (this.initialSessionFile) {
            args.push('--session', this.initialSessionFile);
        }
        console.log(`[TiffaInstance] Starting Tiffa cwd=${this.cwd}`, constants_1.BUN_EXE, args.join(' '));
        this.process = (0, child_process_1.spawn)(constants_1.BUN_EXE, args, {
            env: env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: false,
        });
        const proc = this.process;
        if (!proc)
            return;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        this.rl = require('readline').createInterface({
            input: proc.stdout,
            crlfDelay: Infinity,
        });
        const rl = this.rl;
        if (!rl)
            return;
        rl.on('line', (line) => {
            const trimmed = line.trim();
            if (!trimmed)
                return;
            try {
                const event = JSON.parse(trimmed);
                this._handleEvent(event);
            }
            catch (e) {
                console.warn(`[TiffaInstance:${this._shortCwd()}] 无法解析事件:`, trimmed.substring(0, 200));
            }
        });
        this.stderrDecoder = new (require('string_decoder').StringDecoder)('utf8');
        proc.stderr.on('data', (chunk) => {
            if (!this.stderrDecoder) return;
            const text = this.stderrDecoder.write(chunk).trim();
            this._stderrTail = (this._stderrTail + '\n' + text).slice(-4000);
            if (text)
                console.log(`[tiffa:stderr:${this._shortCwd()}]`, text);
        });
        proc.stdin.on('error', (err) => {
            console.warn(`[TiffaInstance:${this._shortCwd()}] stdin 管道错误:`, err.message);
        });
        proc.stdout.on('error', (err) => {
            console.warn(`[TiffaInstance:${this._shortCwd()}] stdout 管道错误:`, err.message);
        });
        proc.stderr.on('error', (err) => {
            console.warn(`[TiffaInstance:${this._shortCwd()}] stderr 管道错误:`, err.message);
        });
        proc.on('exit', (code, signal) => {
            (0, session_utils_1.mainLog)(`[${this._shortCwd()}#${this.sessionId}] EXIT code=${code} signal=${signal} userKilled=${this.userKilled} crashCount=${this.crashCount}`);
            console.log(`[TiffaInstance:${this._shortCwd()}] 已退出:`, { code, signal, userKilled: this.userKilled, crashCount: this.crashCount });
            for (const [, { reject }] of this.pendingCommands) {
                reject(new Error(`Tiffa process exited (code=${code}, signal=${signal})`));
            }
            this.pendingCommands.clear();
            try {
                this._cleanup();
            }
            catch (e) {
                console.warn(`[TiffaInstance:${this._shortCwd()}] _cleanup 异常:`, e);
            }
            const shouldRestart = !this.userKilled && this.crashCount < this.maxCrashRestart;
            if (shouldRestart) {
                this.crashCount++;
                console.log(`[TiffaInstance:${this._shortCwd()}] 3秒后自动重启 (第${this.crashCount}次)`);
                this._restartTimer = setTimeout(() => {
                    this._restartTimer = null;
                    try {
                        this.start();
                    }
                    catch (e) {
                        console.warn(`[TiffaInstance:${this._shortCwd()}] 自动重启 start() 异常:`, e);
                    }
                }, 3000);
            }
            // 配置致命错误识别：models.yml schema 校验失败 / 无可用模型时内核启动即退（exit≠0），
            // 自动重启救不了它（每次都读同一份坏配置）→ 把原因带给前端弹明确提示，而非无声重启循环。
            let fatalReason = null;
            if (code !== null && code !== 0 && !this.userKilled) {
                const m = this._stderrTail.match(/(No models available[^\n]*|models\.yml validation failed[^\n]*|Schema error:[^\n]*)/i);
                if (m)
                    fatalReason = m[1].trim();
            }
            if (_mainWindow && !_mainWindow.isDestroyed()) {
                try {
                    _mainWindow.webContents.send('tiffa:exited', {
                        code, signal, cwd: this.cwd, sessionId: this.sessionId,
                        autoRestarting: shouldRestart, crashCount: this.crashCount,
                        fatalReason,
                    });
                }
                catch (e) {
                    console.warn(`[TiffaInstance:${this._shortCwd()}] 通知渲染进程 exited 失败:`, e);
                }
            }
        });
        proc.on('error', (err) => {
            console.error(`[TiffaInstance:${this._shortCwd()}] 启动失败:`, err);
            this.process = null;
        });
    }
    kill(sync = false) {
        if (!this.process)
            return;
        const proc = this.process;
        this.userKilled = true;
        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
        (0, process_utils_1.killTree)(proc.pid, sync);
        this._cleanup();
    }
    sendCommand(frame) {
        return new Promise((resolve, reject) => {
            if (!this.process || !this.process.stdin.writable) {
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
                this.process.stdin.write(line, 'utf8');
            }
            catch (err) {
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
            this.process.stdin.write(line, 'utf8');
        }
        catch (err) {
            console.error(`[TiffaInstance:${this._shortCwd()}] stdin.write 失败:`, err.message);
        }
    }
    _handleEvent(event) {
        this.lastActiveTime = Date.now();
        if (event.type === 'ready') {
            this.ready = true;
            this.agentRunning = false;
            this.crashCount = 0;
            console.log(`[TiffaInstance:${this._shortCwd()}] 就绪`);
            setTimeout(() => {
                if (this.agentRunning || this.userPromptInFlight || this._restoringContext)
                    return;
                this.isPrewarming = true;
                this.sendRaw({ type: 'prompt', message: '/memory rebuild' });
                setTimeout(() => { this.isPrewarming = false; }, 30000);
            }, 3000);
            if (this.sessionFilePath && this.sessionId) {
                const sf = this.sessionFilePath;
                if (fs_1.default.existsSync(sf)) {
                    this._restoringContext = true;
                    const restoreDeadline = setTimeout(() => {
                        if (this._restoringContext) {
                            this._restoringContext = false;
                            console.warn(`[TiffaInstance:${this._shortCwd()}] 崩溃重启上下文恢复超时，强制解除过滤`);
                        }
                    }, 15000);
                    this.sendCommand({ type: 'switch_session', sessionPath: sf })
                        .then(() => { console.log(`[TiffaInstance:${this._shortCwd()}] 崩溃重启后上下文已恢复`); })
                        .catch((e) => { console.warn(`[TiffaInstance:${this._shortCwd()}] 崩溃重启后上下文恢复失败: ${e.message}`); })
                        .finally(() => { clearTimeout(restoreDeadline); setTimeout(() => { this._restoringContext = false; }, 800); });
                }
            }
            // 新建会话引导：内核已通过 --session 加载预写文件，立即确定正式身份。
            // 补发 session_switch 让渲染层当场把 __new__ tab 迁移到真实路径，
            // 不再依赖 firstMessage 探测（长消息/图片/命令/并发同文案时探测会永久失败）。
            // 注意必须放在崩溃重启恢复分支之后：两分支条件互斥（引导要求 sessionFilePath 为空），
            // 若放在前面会误入恢复分支产生冗余 switch_session 与 800ms 事件过滤窗口。
            if (this.initialSessionFile && !this.sessionFilePath) {
                this.sessionFilePath = this.initialSessionFile;
                this.announceNewSessionReady();
            }
        }
        if (event.type === 'prompt_result' && event.agentInvoked) {
            this.agentRunning = true;
            (0, session_utils_1.mainLog)(`[${this._shortCwd()}#${this.sessionId}] prompt_result agentInvoked`);
        }
        else if (event.type === 'agent_start') {
            this.agentRunning = true;
            (0, session_utils_1.mainLog)(`[${this._shortCwd()}#${this.sessionId}] agent_start`);
            // 会话文件探测：内核 RPC 模式不输出 session_switch，新会话文件的真实
            // id/路径主进程拿不到 → 实例身份停留在临时 UUID、渲染层迁移失效。
            // agent_start 时会话文件必已创建，按 firstMessage 匹配并模拟补发 session_switch。
            if (!this.sessionFilePath)
                this._probeSessionFile();
        }
        else if (event.type === 'agent_end') {
            (0, session_utils_1.mainLog)(`[${this._shortCwd()}#${this.sessionId}] agent_end code=${event._wasPrewarming ? 'prewarm' : 'normal'}`);
            event._wasPrewarming = this.isPrewarming;
            this.agentRunning = false;
            this.userPromptInFlight = false;
            // agent_end 兜底探测：agent_start 时 firstMessage 可能尚未写盘（竞态）导致
            // 探测未命中——结束时文件必已完整，补探测并模拟补发 session_switch。
            if (!this.sessionFilePath)
                this._probeSessionFile();
            if (!event._wasPrewarming && !this._titleGenerated) {
                this._titleGenerated = true;
                setTimeout(() => {
                    if (TiffaInstance._titleGenerateCallback)
                        TiffaInstance._titleGenerateCallback(this);
                }, 6000);
            }
        }
        // RPC chunked responses
        if (event.type === 'rpc_chunk' && event.chunkId) {
            const cid = event.chunkId;
            if (!this._rpcChunkBuffer)
                this._rpcChunkBuffer = new Map();
            if (!this._rpcChunkBuffer.has(cid)) {
                this._rpcChunkBuffer.set(cid, {
                    count: event.count,
                    chunks: new Array(event.count),
                    received: 0,
                    byteLength: event.byteLength,
                });
            }
            const buf = this._rpcChunkBuffer.get(cid);
            if (buf.chunks[event.index])
                return;
            buf.chunks[event.index] = Buffer.from(event.data, 'base64');
            buf.received++;
            if (buf.received < buf.count)
                return;
            const fullBuf = Buffer.concat(buf.chunks);
            this._rpcChunkBuffer.delete(cid);
            try {
                const parsed = JSON.parse(fullBuf.toString('utf8'));
                event = parsed;
            }
            catch (e) {
                console.warn(`[TiffaInstance:${this._shortCwd()}] rpc_chunk reassembly JSON parse failed: ${e.message}`);
                return;
            }
        }
        // Command responses
        if (event.type === 'response' && event.id && this.pendingCommands.has(event.id)) {
            const { resolve, reject, timer } = this.pendingCommands.get(event.id);
            clearTimeout(timer);
            this.pendingCommands.delete(event.id);
            if (event.success) {
                resolve(event.data);
            }
            else {
                reject(new Error(event.error || 'Command failed'));
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
            this.sessionFilePath = event.sessionPath;
            const realSessionId = (0, session_utils_1.extractSessionIdFromPath)(event.sessionPath);
            if (realSessionId && realSessionId !== this.sessionId) {
                if (this.sessionId && !this.prevSessionIds.includes(this.sessionId))
                    this.prevSessionIds.push(this.sessionId);
                if (_migrateSessionId)
                    _migrateSessionId(this.cwd, this.sessionId, realSessionId);
                this.sessionId = realSessionId;
            }
            event._sessionIdPrev = prevSessionId;
        }
        // ask 记账
        if (event.type === 'extension_ui_request') {
            const m = event.method;
            if (m === 'cancel') {
                this._pendingAskIds.delete(event.targetId || event.id);
                this._pendingAskIds.delete(event.id);
                (0, session_utils_1.mainLog)(`[${this._shortCwd()}#${this.sessionId}] ui-req cancel target=${event.targetId || event.id}`);
            }
            else if (['editor', 'select', 'confirm', 'input', 'askDialog'].includes(m)) {
                this._pendingAskIds.add(event.id);
                (0, session_utils_1.mainLog)(`[${this._shortCwd()}#${this.sessionId}] ui-req ${m} id=${event.id} pending=${this._pendingAskIds.size}`);
            }
        }
        event._cwd = this.cwd;
        event._sessionId = this.sessionId;
        event._sessionPath = this.sessionFilePath || null;
        const eventWasPrewarm = event._wasPrewarming || this.isPrewarming;
        if (eventWasPrewarm) {
            if (event.type === 'agent_end')
                this.isPrewarming = false;
            if (event.type !== 'extension_ui_request')
                return;
        }
        if (this._restoringContext && event.type !== 'session_switch' && event.type !== 'response'
            && event.type !== 'extension_ui_request') {
            return;
        }
        if (_mainWindow && !_mainWindow.isDestroyed()) {
            _mainWindow.webContents.send('tiffa:event', event);
        }
    }
    /** 新建会话引导完成后立即通知渲染层：__new__ tab 当场迁移（幂等，重复到达无害） */
    announceNewSessionReady() {
        if (!this.sessionFilePath)
            return;
        if (!_mainWindow || _mainWindow.isDestroyed())
            return;
        const realId = (0, session_utils_1.extractSessionIdFromPath)(this.sessionFilePath) || this.sessionId;
        _mainWindow.webContents.send('tiffa:event', {
            type: 'session_switch',
            reason: 'new',
            sessionPath: this.sessionFilePath,
            _cwd: this.cwd,
            _sessionIdPrev: this.sessionId,
            _sessionId: realId,
            _sessionPath: this.sessionFilePath,
            _probed: true,
        });
    }
    /** 探测内核自动创建的会话文件（RPC 模式无 session_switch 事件时的补偿机制）：
     *  内核把新会话文件写到磁盘（firstMessage = 用户 prompt 原文），但从不向主进程
     *  发送 session_switch（hooks 内部事件不输出到 stdout）→ 实例 sessionId 永远停留在
     *  前端临时 UUID、sessionFilePath 为 null → 渲染层 __new__ 迁移全部失效。
     *  这里按 firstMessage + 文件创建时间（>= 本次 spawn）匹配，命中后更新实例身份，
     *  并模拟补发 session_switch（_sessionIdPrev = 旧临时 id，渲染层归属校验按它通过）。 */
    _probeSessionFile() {
        const promptText = this.lastPromptMessage;
        if (!promptText)
            return;
        const wanted = promptText.trim();
        if (!wanted)
            return;
        try {
            const files = [];
            const walk = (dir) => {
                let entries;
                try {
                    entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
                }
                catch {
                    return;
                }
                for (const e of entries) {
                    const full = path_1.default.join(dir, e.name);
                    if (e.isDirectory())
                        walk(full);
                    else if (e.isFile() && e.name.endsWith('.jsonl'))
                        files.push(full);
                }
            };
            walk(this.sessionDir);
            // 候选必须唯一：多个同 firstMessage 的新文件（并发新对话发同一句话）不迁移，
            // 避免把实例身份错迁到别人的会话导致更严重的串台。
            let hit = null;
            let hitCount = 0;
            for (const file of files) {
                let st;
                try {
                    st = fs_1.default.statSync(file);
                }
                catch {
                    continue;
                }
                // 只匹配本实例 spawn 之后创建的文件（排除旧会话/并发其他实例的会话）。
                // Windows 部分文件系统 birthtime 可能为 0，此时回退 mtime。
                const created = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
                if (created < this.spawnedAt - 1000)
                    continue;
                const header = (0, session_utils_1.parseSessionHeader)(file);
                if (!header.firstMessage)
                    continue;
                if (header.firstMessage.trim() !== wanted)
                    continue;
                hitCount++;
                hit = file;
            }
            if (hitCount !== 1 || !hit)
                return;
            {
                const file = hit;
                const header = (0, session_utils_1.parseSessionHeader)(file);
                const realId = header.sessionId || (0, session_utils_1.extractSessionIdFromPath)(file);
                const oldId = this.sessionId;
                if (realId && realId !== oldId) {
                    if (oldId && !this.prevSessionIds.includes(oldId))
                        this.prevSessionIds.push(oldId);
                    if (_migrateSessionId)
                        _migrateSessionId(this.cwd, oldId, realId);
                    this.sessionId = realId;
                }
                this.sessionFilePath = file;
                (0, session_utils_1.mainLog)(`[${this._shortCwd()}#${this.sessionId}] 探测到会话文件 ${path_1.default.basename(file)} (${oldId || 'null'} -> ${realId || 'null'})`);
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
                    });
                }
            }
        }
        catch {
            /* ignore */
        }
    }
    _cleanup() {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        if (this.stderrDecoder) {
            const tail = this.stderrDecoder.write(Buffer.alloc(0)).trim();
            if (tail)
                console.log(`[tiffa:stderr:${this._shortCwd()}]`, tail);
            this.stderrDecoder = null;
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
exports.TiffaInstance = TiffaInstance;
//# sourceMappingURL=tiffa-instance.js.map