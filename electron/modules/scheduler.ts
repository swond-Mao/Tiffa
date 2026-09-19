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
import fs from 'fs';
import path from 'path';
import { PORTABLE_ROOT } from './constants';
import { clearGoalState, writeGoalArm, isForceCapable, buildCreateCommand, buildSoftCreateMessage } from './goal-mode';
import type { TiffaInstanceManager } from './tiffa-manager';

const TASKS_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'scheduled-tasks.json');
const STATE_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'scheduler-state.json');
const LOG_FILE = path.join(PORTABLE_ROOT, 'data', 'log', 'scheduler.log');
const TICK_MS = 30_000;
/** 单次运行的最长保护窗口：超过则不再视为“运行中”，允许下次触发 */
const MAX_RUN_MS = 30 * 60 * 1000;
/** catchUp 最多回溯时长 */
const CATCHUP_MAX_LOOKBACK_MS = 12 * 60 * 60 * 1000;

export type TaskApproval = 'normal' | 'auto' | 'yolo';
const APPROVAL_TO_AGENT: Record<TaskApproval, string> = {
	normal: 'always-ask',
	auto: 'write',
	yolo: 'yolo',
};

export interface ScheduledTask {
	/** 唯一 id（kebab-case） */
	id: string;
	/** 展示名 */
	name?: string;
	/** 5 字段 cron：分 时 日 月 周（与 linux crontab 同义） */
	cron?: string;
	/** 固定间隔，如 "30m" / "2h" / "1d"（与 cron 二选一） */
	every?: string;
	/** 是否启用，默认 true */
	enabled?: boolean;
	/** 目标项目目录，缺省用当前工作区 */
	cwd?: string;
	/** 任务会话 id，缺省 `sched-<id>` */
	session?: string;
	/** 审批模式：normal=每次确认 / auto=写操作免确认 / yolo=全自动 */
	approval?: TaskApproval;
	/** 指定模型 id（缺省沿用会话/全局默认模型）。与 provider 搭配最稳。 */
	model?: string;
	/** 模型所属供应商标识；缺省时按任务模型在实例可用列表里反查 */
	provider?: string;
	/** 应用关闭期间漏跑是否补跑，默认 false */
	catchUp?: boolean;
	/** 要执行的提示词 */
	prompt: string;
	/** 可选：以目标模式执行（内核 goal mode）。设定后本任务会先武装目标再投递 prompt，
	 *  模型在整轮里都带着该目标推进（入口只有 `/force goal`，详见 modules/goal-mode.ts 顶部注释）。 */
	goal?: {
		/** 目标原文（写清「做完了是什么样子」，会被逐字钉进上下文） */
		objective: string;
		/** token 预算；到顶内核会把目标置 budget-limited 并要求模型收尾交接 */
		tokenBudget?: number | null;
	};
}

interface TaskState {
	lastRunMinute?: string;
	lastRunAt?: number;
	lastResult?: string;
}

interface SchedulerStateFile {
	tasks: Record<string, TaskState>;
}

// ── 日志 ──
function ensureDir(dir: string): void {
	try {
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	} catch {}
}
function log(category: string, detail: string): void {
	try {
		ensureDir(path.dirname(LOG_FILE));
		fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${category}] ${detail}\n`, 'utf8');
	} catch {}
}

/** 给内核命令加超时护栏：冷启动实例上 set_model / get_available_models 可能长时间不返回 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} 超时(${Math.round(ms / 1000)}s)`)), ms);
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

/** 模型名归一化：去空白/点/下划线/连字符并小写，用于模糊匹配（各内核标签风格不一） */
function normalizeModelKey(s: unknown): string {
	return String(s ?? '').toLowerCase().replace(/[\s._\-]/g, '');
}

// ── cron 解析 / 匹配 ──
const CRON_BOUNDS: Array<[number, number]> = [
	[0, 59], // minute
	[0, 23], // hour
	[1, 31], // day of month
	[1, 12], // month
	[0, 7], // day of week (0 与 7 都是周日)
];

/** 解析单个 cron 字段为允许值集合；非法返回 null。 */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
	const values = new Set<number>();
	for (const part of field.split(',')) {
		const seg = part.trim();
		if (!seg) return null;
		let step = 1;
		let range = seg;
		const slash = seg.indexOf('/');
		if (slash !== -1) {
			range = seg.slice(0, slash);
			const stepRaw = seg.slice(slash + 1);
			step = Number(stepRaw);
			if (!Number.isInteger(step) || step <= 0) return null;
		}
		let lo: number;
		let hi: number;
		if (range === '*') {
			lo = min;
			hi = max;
		} else if (range.includes('-')) {
			const [a, b] = range.split('-');
			lo = Number(a);
			hi = Number(b);
		} else {
			const v = Number(range);
			if (!Number.isInteger(v)) return null;
			lo = v;
			hi = v;
		}
		if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) return null;
		for (let v = lo; v <= hi; v += step) values.add(v);
	}
	return values.size > 0 ? values : null;
}

/**
 * 5 字段 cron 匹配：`分 时 日 月 周`。
 * 日/周同时受限时按 crontab 惯例取「或」（任一命中即算命中）。
 */
export function cronMatches(expr: string, d: Date): boolean {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return false;
	const sets: Array<Set<number> | null> = [];
	for (let i = 0; i < 5; i++) sets.push(parseCronField(fields[i], CRON_BOUNDS[i][0], CRON_BOUNDS[i][1]));
	if (sets.some((s) => s === null)) return false;
	const [min, hour, dom, mon, dow] = sets as Set<number>[];
	if (!min.has(d.getMinutes()) || !hour.has(d.getHours()) || !mon.has(d.getMonth() + 1)) return false;
	const wd = d.getDay();
	const domHit = dom.has(d.getDate());
	const dowHit = dow.has(wd) || (wd === 0 && dow.has(7));
	const domRestricted = fields[2].trim() !== '*';
	const dowRestricted = fields[4].trim() !== '*';
	if (domRestricted && dowRestricted) return domHit || dowHit;
	return domHit && dowHit;
}

/** 解析间隔写法（30s/5m/2h/1d）为毫秒；非法返回 null。 */
export function everyToMs(expr: string): number | null {
	const m = String(expr).trim().match(/^(\d+)\s*(s|m|h|d)$/i);
	if (!m) return null;
	const n = Number(m[1]);
	if (!Number.isFinite(n) || n <= 0) return null;
	const unit = m[2].toLowerCase();
	const mul = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
	return n * mul;
}

function minuteKey(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 任务表读写 ──
export function readTasksFile(): { tasks: ScheduledTask[]; errors: string[] } {
	const errors: string[] = [];
	if (!fs.existsSync(TASKS_FILE)) return { tasks: [], errors };
	try {
		const raw = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
		const list = Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : [];
		const tasks: ScheduledTask[] = [];
		for (const t of list) {
			if (!t || typeof t !== 'object') continue;
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
			// 目标模式任务：objective 不能为空（空目标会把「待创建」指令发出去却无从建目标）
			if (t.goal !== undefined && !String(t.goal?.objective || '').trim()) {
				errors.push(`任务 ${t.id} 的 goal.objective 为空（要么删掉 goal，要么填目标）`);
				continue;
			}
			tasks.push(t as ScheduledTask);
		}
		return { tasks, errors };
	} catch (e) {
		errors.push(`任务表解析失败：${e instanceof Error ? e.message : String(e)}`);
		return { tasks: [], errors };
	}
}

export function writeTasksFile(tasks: ScheduledTask[]): void {
	ensureDir(path.dirname(TASKS_FILE));
	fs.writeFileSync(TASKS_FILE, JSON.stringify({ tasks }, null, 2), 'utf8');
}

function readState(): SchedulerStateFile {
	try {
		if (fs.existsSync(STATE_FILE)) {
			const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
			if (parsed && typeof parsed === 'object' && parsed.tasks) return parsed as SchedulerStateFile;
		}
	} catch {}
	return { tasks: {} };
}

function writeState(state: SchedulerStateFile): void {
	try {
		ensureDir(path.dirname(STATE_FILE));
		fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
	} catch {}
}

export interface TaskView extends ScheduledTask {
	lastRunAt?: number;
	lastResult?: string;
	running?: boolean;
	nextRunHint?: string;
}

function describeSchedule(t: ScheduledTask): string {
	if (t.cron) return `cron: ${t.cron}`;
	if (t.every) return `每 ${t.every}`;
	return '(无)';
}

export class TaskScheduler {
	private _manager: TiffaInstanceManager;
	private _defaultCwd: () => string;
	private _timer: NodeJS.Timeout | null = null;
	private _running = new Map<string, number>();
	private _lastErrors: string[] = [];

	constructor(manager: TiffaInstanceManager, defaultCwd: () => string) {
		this._manager = manager;
		this._defaultCwd = defaultCwd;
	}

	start(): void {
		if (this._timer) return;
		const { tasks, errors } = readTasksFile();
		this._lastErrors = errors;
		log('start', `调度器启动，任务 ${tasks.length} 个${errors.length ? `，告警 ${errors.length} 条` : ''}`);
		this._catchUp(tasks);
		this._timer = setInterval(() => this._tick(), TICK_MS);
		// 启动后先跑一次 tick，避免等到下一个 30s 边界
		setTimeout(() => this._tick(), 3_000);
	}

	stop(): void {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	/** 重新加载任务表（UI / 工具改动后调用；tick 本身每轮也重读，故非必须） */
	reload(): void {
		const { tasks, errors } = readTasksFile();
		this._lastErrors = errors;
		log('reload', `任务 ${tasks.length} 个${errors.length ? `，告警 ${errors.length} 条` : ''}`);
	}

	list(): { tasks: TaskView[]; errors: string[] } {
		const { tasks, errors } = readTasksFile();
		const state = readState();
		const views: TaskView[] = tasks.map((t) => {
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
	async runNow(id: string): Promise<{ success: boolean; error?: string }> {
		const { tasks } = readTasksFile();
		const task = tasks.find((t) => t.id === id);
		if (!task) return { success: false, error: `任务不存在：${id}` };
		return this._run(task, 'manual');
	}

	private _tick(): void {
		let tasks: ScheduledTask[];
		try {
			const parsed = readTasksFile();
			tasks = parsed.tasks;
			this._lastErrors = parsed.errors;
		} catch (e) {
			log('tick.error', e instanceof Error ? e.message : String(e));
			return;
		}
		const now = new Date();
		const key = minuteKey(now);
		const state = readState();
		let stateDirty = false;

		for (const task of tasks) {
			if (task.enabled === false) continue;

			// 运行中判定：实例已空闲则解除占位
			const startedAt = this._running.get(task.id);
			if (startedAt !== undefined) {
				const sid = task.session || `sched-${task.id}`;
				const inst = this._manager.getBySessionIdAnywhere(sid);
				const idle = !inst || !inst.agentRunning;
				if (idle || Date.now() - startedAt > MAX_RUN_MS) {
					this._running.delete(task.id);
				} else {
					continue;
				}
			}

			const st = state.tasks[task.id] || {};
			let due = false;
			if (task.cron) {
				due = cronMatches(task.cron, now) && st.lastRunMinute !== key;
			} else if (task.every) {
				const iv = everyToMs(task.every);
				due = iv !== null && (!st.lastRunAt || Date.now() - st.lastRunAt >= iv);
			}
			if (!due) continue;

			// 先记账再执行，避免同一分钟重复触发
			state.tasks[task.id] = { ...st, lastRunMinute: key };
			stateDirty = true;
			void this._run(task, 'schedule');
		}

		if (stateDirty) writeState(state);
	}

	private async _catchUp(tasks: ScheduledTask[]): Promise<void> {
		const state = readState();
		const now = Date.now();
		let dirty = false;
		for (const task of tasks) {
			if (task.enabled === false || !task.catchUp || !task.cron) continue;
			const st = state.tasks[task.id] || {};
			const from = Math.max(st.lastRunAt || 0, now - CATCHUP_MAX_LOOKBACK_MS);
			// 从 now 往回找最近一次应触发时刻，若晚于上次运行则补跑一次
			let missed: Date | null = null;
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
		if (dirty) writeState(state);
	}

	/**
	 * 给任务会话切换模型（任务自带 model 时才动作）。
	 * - provider 已填 -> 直接下发 set_model
	 * - provider 缺失 -> 用实例可用模型列表按 id/名称反查（精确 → 归一化 → 包含）
	 * 任何失败都只记日志、不阻断任务：跑起来（哪怕用默认模型）比整轮不跑有价值。
	 */
	/** 读实例当前模型 api（决定目标模式能否用 `/force` 强制调用）；读不到时按「不支持」处理（有软路径兜底） */
	private async _modelApi(inst: { sendCommand: (...args: any[]) => Promise<any> }): Promise<string | undefined> {
		try {
			const st = await inst.sendCommand({ type: 'get_state' });
			return st?.data?.model?.api;
		} catch {
			return undefined;
		}
	}

	private async _applyTaskModel(inst: { sendCommand: (...args: any[]) => Promise<any> }, task: ScheduledTask): Promise<void> {
		const wantId = String(task.model || '').trim();
		if (!wantId) return;
		let provider = String(task.provider || '').trim();
		let modelId = wantId;

		if (!provider) {
			try {
				const list: any = await withTimeout(inst.sendCommand({ type: 'get_available_models' }), 20_000, 'get_available_models');
				const models: any[] = Array.isArray(list?.models) ? list.models : Array.isArray(list) ? list : [];
				const want = normalizeModelKey(wantId);
				const hit =
					models.find((m) => String(m?.id) === wantId) ||
					models.find((m) => normalizeModelKey(m?.id) === want || normalizeModelKey(m?.name) === want) ||
					models.find((m) => {
						const n = normalizeModelKey(m?.name);
						const i = normalizeModelKey(m?.id);
						return (!!n && (n.includes(want) || want.includes(n))) || (!!i && (i.includes(want) || want.includes(i)));
					});
				if (hit && hit.provider) {
					provider = String(hit.provider);
					modelId = String(hit.id || wantId);
				}
			} catch (e) {
				log('model.warn', `任务 ${task.id} 反查模型供应商失败：${e instanceof Error ? e.message : String(e)}`);
			}
		}

		if (!provider) {
			log('model.warn', `任务 ${task.id} 无法确定模型「${wantId}」的供应商，沿用默认模型`);
			return;
		}
		try {
			await withTimeout(inst.sendCommand({ type: 'set_model', provider, modelId }), 30_000, 'set_model');
			log('model', `任务 ${task.id} 模型已切换为 ${provider}/${modelId}`);
		} catch (e) {
			log('model.warn', `任务 ${task.id} 切换模型 ${provider}/${modelId} 失败（沿用默认模型）：${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * 投递后异步守候任务真实结束，只写日志（不阻塞 _run 的返回）。
	 *
	 * 背景：原先只有 `[done] 已投递` —— 那只代表 prompt 送进内核，看不出任务跑了多久、
	 * 有没有真的结束。排查「任务起来后对话卡住」时无从下手，故补齐 finish/timeout 两条记录。
	 *
	 * 判定：先等 agentRunning 变 true（避免刚投递时的瞬时 false 被误判成"已结束"），
	 * 之后再等它变 false 记 finish；超过 MAX_RUN_MS 记 timeout 并解除运行占位。
	 */
	private _watchTaskFinish(task: ScheduledTask, sessionId: string): void {
		const startedAt = Date.now();
		let sawRunning = false;
		const timer = setInterval(() => {
			let running = false;
			try {
				const cur = this._manager.getBySessionIdAnywhere(sessionId);
				running = !!(cur && cur.agentRunning);
			} catch {
				running = false;
			}
			const elapsed = Date.now() - startedAt;

			if (running) {
				if (!sawRunning) {
					sawRunning = true;
					log('running', `任务 ${task.id} 内核已开始执行（投递后 ${Math.round(elapsed / 1000)}s）`);
				}
			} else if (sawRunning || elapsed > 30_000) {
				clearInterval(timer);
				this._running.delete(task.id);
				log(
					'finish',
					sawRunning
						? `任务 ${task.id} 结束，执行耗时 ${Math.round(elapsed / 1000)}s`
						: `任务 ${task.id} 投递后 30s 内未见内核启动执行（可能被拒/模型无响应）`,
				);
				return;
			}

			if (elapsed > MAX_RUN_MS) {
				clearInterval(timer);
				this._running.delete(task.id);
				this._forceReleaseTask(task, sessionId, elapsed);
			}
		}, 3_000);
		if (timer.unref) timer.unref();
	}

	/**
	 * 任务超时后的强制释放：取消挂起审批 → abort → 强复位前端 → 仍不空闲则终止实例。
	 *
	 * 只「解除运行占位」不够 —— 卡住的实例仍占着实例池（MAX_INSTANCES=8），
	 * 且它所在会话一直是「运行中」，用户进去再发消息会被排队、停止按钮也无效
	 * （内核 ask 阻塞 + RPC 命令串行）。终止实例等价于手动关闭对话，是唯一可靠出路；
	 * 实例被移除后，下次任务触发或用户发言都会重新 spawn 并按会话文件恢复上下文。
	 */
	private _forceReleaseTask(task: ScheduledTask, sessionId: string, elapsed: number): void {
		const inst = this._manager.getBySessionIdAnywhere(sessionId);
		const mins = Math.round(elapsed / 60_000);
		if (!inst) {
			log('timeout', `任务 ${task.id} 超过 ${mins} 分钟仍未结束，已解除运行占位（实例已不在池中）`);
			return;
		}
		const releaseAt = Date.now();
		const cancelled = inst.cancelPendingAsks('task-timeout');
		try {
			inst.sendRaw({ type: 'abort' });
		} catch {
			/* 进程可能已退出 */
		}
		inst.forceReset('task-timeout');
		log(
			'timeout',
			`任务 ${task.id} 超过 ${mins} 分钟未结束（疑似卡在审批或模型无响应），已取消 ${cancelled} 个挂起审批并强制复位运行态`,
		);
		const killTimer = setTimeout(() => {
			try {
				// 用真实 agent_end 判定内核是否真的空闲：forceReset 已把 agentRunning
				// 置 false，拿它判断会永远不兜底（实例仍卡着但看起来"已恢复"）
				if (inst.lastRealAgentEndAt >= releaseAt) return;
				const key = this._manager.keyOf(inst);
				if (key) this._manager.closeByKey(key);
				else inst.kill(true);
				log('timeout', `任务 ${task.id} abort 无效，已终止实例以释放实例池（会话可重开恢复）`);
			} catch (e) {
				log('timeout', `任务 ${task.id} 终止实例失败: ${e instanceof Error ? e.message : String(e)}`);
			}
		}, 10_000);
		if (killTimer.unref) killTimer.unref();
	}

	private async _run(task: ScheduledTask, trigger: string): Promise<{ success: boolean; error?: string }> {
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
			// 先切模型再投递提示词：内核按会话当前模型处理本次 prompt
			await this._applyTaskModel(inst, task);
			log('run', `任务 ${task.id} 开始 trigger=${trigger} cwd=${cwd} session=${sessionId} approval=${approval}${task.model ? ` model=${task.provider ? task.provider + '/' : ''}${task.model}` : ''}`);
			// 目标模式：先武装目标（外挂在 before_agent_start / tool_call 里读 goal-mode.json），
			// 再把创建指令与任务 prompt 一起投递 —— 无人值守场景下它就是「不跑偏 + 预算上限」的保障。
			// ⚠️ sessionId 用本任务的固定 id（不是临时 id），不存在前端那种迁移问题。
			let message = task.prompt;
			if (task.goal?.objective) {
				const objective = String(task.goal.objective).trim();
				const budget = typeof task.goal.tokenBudget === 'number' && task.goal.tokenBudget > 0 ? Math.floor(task.goal.tokenBudget) : null;
				clearGoalState(sessionId);
				writeGoalArm({ enabled: true, objective, tokenBudget: budget, sessionId });
				const api = await this._modelApi(inst);
				const goalCmd = isForceCapable(api) ? buildCreateCommand(objective, budget) : buildSoftCreateMessage(objective);
				message = `${goalCmd}\n\n补充要求：\n${task.prompt}`;
				log('run', `任务 ${task.id} 目标模式已武装 budget=${budget ?? '-'} force=${isForceCapable(api)}`);
			}
			await inst.sendCommand({ type: 'prompt', message });
			// 投递成功只说明 prompt 进了内核；真正的结束时刻由 watchdog 记 finish/timeout
			this._watchTaskFinish(task, sessionId);

			const state = readState();
			const st = state.tasks[task.id] || {};
			state.tasks[task.id] = {
				...st,
				lastRunAt: Date.now(),
				lastRunMinute: st.lastRunMinute || minuteKey(new Date()),
				lastResult: 'ok',
			};
			writeState(state);
			log('done', `任务 ${task.id} prompt 已投递`);
			return { success: true };
		} catch (e) {
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
