"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskScheduler = void 0;
exports.cronMatches = cronMatches;
exports.everyToMs = everyToMs;
exports.readTasksFile = readTasksFile;
exports.writeTasksFile = writeTasksFile;
/**
 * Tiffa 定时任务调度器（主进程常驻）
 * ------------------------------------------------------------
 * 职责：在 Electron 主进程内按 cron / 固定间隔触发任务，复用会话通道执行 prompt。
 *
 * 文件：
 *   data/agent/scheduled-tasks.json  任务表（机器本地，不入 git）
 *   data/agent/scheduler-state.json  运行状态（lastRunAt / lastResult）
 *   data/log/scheduler.log           触发日志
 *
 * 设计要点：
 * - 任务表选 JSON 而非 YAML：agent 侧工具（schedule_task）直接写它，
 *   JSON.stringify 不会因中文 prompt 里的冒号/换行/引号而转义翻车。
 * - 每个任务单开实例并携带 `--approval-mode=<mode>`，按任务隔离审批模式，
 *   不改全局 config.yml（避免与其他会话的审批模式打架）。
 * - 任务会话 id 默认 `sched-<任务id>`：同一任务的多次运行累积在同一会话里，可追溯。
 * - 应用关闭期间的漏跑默认不补（catchUp: true 可开启，最多回溯 12 小时）。
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const TASKS_FILE = path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent', 'scheduled-tasks.json');
const STATE_FILE = path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent', 'scheduler-state.json');
const LOG_FILE = path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'log', 'scheduler.log');
const TICK_MS = 30_000;
/** 单次运行的最长保护窗口：超过则不再视为“运行中”，允许下次触发 */
const MAX_RUN_MS = 30 * 60 * 1000;
/** catchUp 最多回溯时长 */
const CATCHUP_MAX_LOOKBACK_MS = 12 * 60 * 60 * 1000;
const APPROVAL_TO_AGENT = {
    normal: 'always-ask',
    auto: 'write',
    yolo: 'yolo',
};
// ── 日志 ──
function ensureDir(dir) {
    try {
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
    }
    catch { }
}
function log(category, detail) {
    try {
        ensureDir(path_1.default.dirname(LOG_FILE));
        fs_1.default.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${category}] ${detail}\n`, 'utf8');
    }
    catch { }
}
// ── cron 解析 / 匹配 ──
const CRON_BOUNDS = [
    [0, 59], // minute
    [0, 23], // hour
    [1, 31], // day of month
    [1, 12], // month
    [0, 7], // day of week (0 与 7 都是周日)
];
/** 解析单个 cron 字段为允许值集合；非法返回 null。 */
function parseCronField(field, min, max) {
    const values = new Set();
    for (const part of field.split(',')) {
        const seg = part.trim();
        if (!seg)
            return null;
        let step = 1;
        let range = seg;
        const slash = seg.indexOf('/');
        if (slash !== -1) {
            range = seg.slice(0, slash);
            const stepRaw = seg.slice(slash + 1);
            step = Number(stepRaw);
            if (!Number.isInteger(step) || step <= 0)
                return null;
        }
        let lo;
        let hi;
        if (range === '*') {
            lo = min;
            hi = max;
        }
        else if (range.includes('-')) {
            const [a, b] = range.split('-');
            lo = Number(a);
            hi = Number(b);
        }
        else {
            const v = Number(range);
            if (!Number.isInteger(v))
                return null;
            lo = v;
            hi = v;
        }
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi)
            return null;
        for (let v = lo; v <= hi; v += step)
            values.add(v);
    }
    return values.size > 0 ? values : null;
}
/**
 * 5 字段 cron 匹配：`分 时 日 月 周`。
 * 日/周同时受限时按 crontab 惯例取「或」（任一命中即算命中）。
 */
function cronMatches(expr, d) {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5)
        return false;
    const sets = [];
    for (let i = 0; i < 5; i++)
        sets.push(parseCronField(fields[i], CRON_BOUNDS[i][0], CRON_BOUNDS[i][1]));
    if (sets.some((s) => s === null))
        return false;
    const [min, hour, dom, mon, dow] = sets;
    if (!min.has(d.getMinutes()) || !hour.has(d.getHours()) || !mon.has(d.getMonth() + 1))
        return false;
    const wd = d.getDay();
    const domHit = dom.has(d.getDate());
    const dowHit = dow.has(wd) || (wd === 0 && dow.has(7));
    const domRestricted = fields[2].trim() !== '*';
    const dowRestricted = fields[4].trim() !== '*';
    if (domRestricted && dowRestricted)
        return domHit || dowHit;
    return domHit && dowHit;
}
/** 解析间隔写法（30s/5m/2h/1d）为毫秒；非法返回 null。 */
function everyToMs(expr) {
    const m = String(expr).trim().match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!m)
        return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0)
        return null;
    const unit = m[2].toLowerCase();
    const mul = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return n * mul;
}
function minuteKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// ── 任务表读写 ──
function readTasksFile() {
    const errors = [];
    if (!fs_1.default.existsSync(TASKS_FILE))
        return { tasks: [], errors };
    try {
        const raw = JSON.parse(fs_1.default.readFileSync(TASKS_FILE, 'utf8'));
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : [];
        const tasks = [];
        for (const t of list) {
            if (!t || typeof t !== 'object')
                continue;
            if (!t.id || !String(t.prompt || '').trim()) {
                errors.push(`任务缺少 id 或 prompt：${JSON.stringify(t).slice(0, 80)}`);
                continue;
            }
            if (!t.cron && !t.every) {
                errors.push(`任务 ${t.id} 缺少 cron 或 every`);
                continue;
            }
            if (t.cron && !cronMatches(t.cron, new Date())) {
                // 语法自检：非法写法给出提示（不阻断其他任务）
            }
            if (t.every && everyToMs(t.every) === null) {
                errors.push(`任务 ${t.id} 的 every 写法非法（示例 "30m"/"2h"/"1d"）`);
                continue;
            }
            tasks.push(t);
        }
        return { tasks, errors };
    }
    catch (e) {
        errors.push(`任务表解析失败：${e instanceof Error ? e.message : String(e)}`);
        return { tasks: [], errors };
    }
}
function writeTasksFile(tasks) {
    ensureDir(path_1.default.dirname(TASKS_FILE));
    fs_1.default.writeFileSync(TASKS_FILE, JSON.stringify({ tasks }, null, 2), 'utf8');
}
function readState() {
    try {
        if (fs_1.default.existsSync(STATE_FILE)) {
            const parsed = JSON.parse(fs_1.default.readFileSync(STATE_FILE, 'utf8'));
            if (parsed && typeof parsed === 'object' && parsed.tasks)
                return parsed;
        }
    }
    catch { }
    return { tasks: {} };
}
function writeState(state) {
    try {
        ensureDir(path_1.default.dirname(STATE_FILE));
        fs_1.default.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    }
    catch { }
}
function describeSchedule(t) {
    if (t.cron)
        return `cron: ${t.cron}`;
    if (t.every)
        return `每 ${t.every}`;
    return '(无)';
}
class TaskScheduler {
    _manager;
    _defaultCwd;
    _timer = null;
    _running = new Map();
    _lastErrors = [];
    constructor(manager, defaultCwd) {
        this._manager = manager;
        this._defaultCwd = defaultCwd;
    }
    start() {
        if (this._timer)
            return;
        const { tasks, errors } = readTasksFile();
        this._lastErrors = errors;
        log('start', `调度器启动，任务 ${tasks.length} 个${errors.length ? `，告警 ${errors.length} 条` : ''}`);
        this._catchUp(tasks);
        this._timer = setInterval(() => this._tick(), TICK_MS);
        // 启动后先跑一次 tick，避免等到下一个 30s 边界
        setTimeout(() => this._tick(), 3_000);
    }
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }
    /** 重新加载任务表（UI / 工具改动后调用；tick 本身每轮也重读，故非必须） */
    reload() {
        const { tasks, errors } = readTasksFile();
        this._lastErrors = errors;
        log('reload', `任务 ${tasks.length} 个${errors.length ? `，告警 ${errors.length} 条` : ''}`);
    }
    list() {
        const { tasks, errors } = readTasksFile();
        const state = readState();
        const views = tasks.map((t) => {
            const st = state.tasks[t.id] || {};
            const sid = t.session || `sched-${t.id}`;
            const inst = this._manager.getBySessionIdAnywhere(sid);
            return {
                ...t,
                enabled: t.enabled !== false,
                approval: t.approval || 'auto',
                lastRunAt: st.lastRunAt,
                lastResult: st.lastResult,
                running: !!(inst && inst.agentRunning) || this._running.has(t.id),
                nextRunHint: describeSchedule(t),
            };
        });
        return { tasks: views, errors: errors.length ? errors : this._lastErrors };
    }
    /** 立即执行一次（跳过 schedule 判定），供 UI「立即运行」与工具调用 */
    async runNow(id) {
        const { tasks } = readTasksFile();
        const task = tasks.find((t) => t.id === id);
        if (!task)
            return { success: false, error: `任务不存在：${id}` };
        return this._run(task, 'manual');
    }
    _tick() {
        let tasks;
        try {
            const parsed = readTasksFile();
            tasks = parsed.tasks;
            this._lastErrors = parsed.errors;
        }
        catch (e) {
            log('tick.error', e instanceof Error ? e.message : String(e));
            return;
        }
        const now = new Date();
        const key = minuteKey(now);
        const state = readState();
        let stateDirty = false;
        for (const task of tasks) {
            if (task.enabled === false)
                continue;
            // 运行中判定：实例已空闲则解除占位
            const startedAt = this._running.get(task.id);
            if (startedAt !== undefined) {
                const sid = task.session || `sched-${task.id}`;
                const inst = this._manager.getBySessionIdAnywhere(sid);
                const idle = !inst || !inst.agentRunning;
                if (idle || Date.now() - startedAt > MAX_RUN_MS) {
                    this._running.delete(task.id);
                }
                else {
                    continue;
                }
            }
            const st = state.tasks[task.id] || {};
            let due = false;
            if (task.cron) {
                due = cronMatches(task.cron, now) && st.lastRunMinute !== key;
            }
            else if (task.every) {
                const iv = everyToMs(task.every);
                due = iv !== null && (!st.lastRunAt || Date.now() - st.lastRunAt >= iv);
            }
            if (!due)
                continue;
            // 先记账再执行，避免同一分钟重复触发
            state.tasks[task.id] = { ...st, lastRunMinute: key };
            stateDirty = true;
            void this._run(task, 'schedule');
        }
        if (stateDirty)
            writeState(state);
    }
    async _catchUp(tasks) {
        const state = readState();
        const now = Date.now();
        let dirty = false;
        for (const task of tasks) {
            if (task.enabled === false || !task.catchUp || !task.cron)
                continue;
            const st = state.tasks[task.id] || {};
            const from = Math.max(st.lastRunAt || 0, now - CATCHUP_MAX_LOOKBACK_MS);
            // 从 now 往回找最近一次应触发时刻，若晚于上次运行则补跑一次
            let missed = null;
            for (let t = now; t > from; t -= 60_000) {
                const d = new Date(t);
                if (cronMatches(task.cron, d)) {
                    missed = d;
                    break;
                }
            }
            if (missed && missed.getTime() > (st.lastRunAt || 0)) {
                log('catchup', `任务 ${task.id} 补跑（漏跑时刻 ${missed.toLocaleString()}）`);
                state.tasks[task.id] = { ...st, lastRunAt: now, lastRunMinute: minuteKey(new Date(missed)) };
                dirty = true;
                void this._run(task, 'catchup');
            }
        }
        if (dirty)
            writeState(state);
    }
    async _run(task, trigger) {
        const sessionId = task.session || `sched-${task.id}`;
        const cwd = task.cwd || this._defaultCwd();
        const approval = task.approval || 'auto';
        const extraArgs = [`--approval-mode=${APPROVAL_TO_AGENT[approval] || 'write'}`];
        try {
            const existing = this._manager.getBySessionIdAnywhere(sessionId);
            if (existing && existing.agentRunning) {
                log('skip', `任务 ${task.id} 跳过（会话正忙）trigger=${trigger}`);
                return { success: false, error: '会话正忙，本轮跳过' };
            }
            const { inst } = await this._manager.activateSession(cwd, sessionId, extraArgs);
            if (!inst || !inst.ready) {
                log('error', `任务 ${task.id} 实例未就绪 trigger=${trigger}`);
                return { success: false, error: '实例未就绪' };
            }
            if (inst.agentRunning) {
                log('skip', `任务 ${task.id} 跳过（激活后会话仍在运行）trigger=${trigger}`);
                return { success: false, error: '会话正忙，本轮跳过' };
            }
            this._running.set(task.id, Date.now());
            log('run', `任务 ${task.id} 开始 trigger=${trigger} cwd=${cwd} session=${sessionId} approval=${approval}`);
            await inst.sendCommand({ type: 'prompt', message: task.prompt });
            const state = readState();
            const st = state.tasks[task.id] || {};
            state.tasks[task.id] = {
                ...st,
                lastRunAt: Date.now(),
                lastRunMinute: st.lastRunMinute || minuteKey(new Date()),
                lastResult: 'ok',
            };
            writeState(state);
            log('done', `任务 ${task.id} 已投递`);
            return { success: true };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const state = readState();
            const st = state.tasks[task.id] || {};
            state.tasks[task.id] = { ...st, lastRunAt: Date.now(), lastResult: `error: ${msg}` };
            writeState(state);
            this._running.delete(task.id);
            log('error', `任务 ${task.id} 失败 trigger=${trigger} ${msg}`);
            return { success: false, error: msg };
        }
    }
}
exports.TaskScheduler = TaskScheduler;
//# sourceMappingURL=scheduler.js.map