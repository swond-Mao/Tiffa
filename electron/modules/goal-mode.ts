/**
 * 目标模式（内核 goal mode）主进程侧支持。
 *
 * 背景（2026-09-19 核实，内核 18.0.6）：goal 模式的**入口只在 TUI** ——
 *   · `/goal` 只挂了 `handleTui`，没有 text/ACP 用的 `handle`；而 RPC 的 prompt 只走
 *     `executeAcpBuiltinSlashCommand()`（要求 handle）→ `/goal` 在 rpc-ui 下会被当普通文本喂给模型；
 *   · RPC 协议（`RpcCommand` 联合）里没有 goal 命令，`get_state` 也不含 goal；
 *   · 扩展 API（ExtensionContext）没有 session / goalRuntime 句柄 → 外挂无法直接调 createGoal()。
 *
 * 唯一可用入口是内核内置斜杠命令 **`/force goal <prompt>`**（有 `handle`，rpc 可执行）：
 *   它调 `setForcedToolChoice("goal")` 让下一轮**必须**调用 goal 工具（要求该工具已在活跃集，
 *   由 `plugins/claude-mode-extension.ts` 的 sanitizeTools 常驻激活），再把剩余文本当用户消息发给模型。
 *   实测：`/force goal ...objective 用原文：X` → 模型调 `goal({op:"create",objective:"X"})`
 *   → 内核进入 goal 模式并回 `goal_updated{state.enabled:true}`。
 *
 * 模型/provider 不支持命名 tool_choice 时（`src/utils/tool-choice.ts` 只认
 * anthropic-messages / bedrock-converse-stream / openai-{codex-responses,responses,completions} /
 * azure-openai-responses / ollama-chat / google-*），退回「普通 prompt + 外挂注入指令」的软路径。
 *
 * 文件分工（都在 `data/agent/`，机器本地、gitignore）：
 *   · `goal-mode.json`              ：本模块写（前端开关），外挂读 —— 放行 `op=create` 的依据 + 目标原文
 *   · `goal-state.<sessionId>.json` ：外挂写（源自内核 `goal_updated` 事件），本模块/前端读 —— 状态显示
 *   · `goal-state.json`             ：旧版全局文件，只读兜底（新写入一律按会话分文件）
 * 两者都带 `sessionId`：Tiffa 多对话并发共用同一个 `data/agent`，goal 是**每会话**的，不能全局生效。
 * 运行态之所以**按会话分文件**而不只靠字段区分：内核 `task` 子代理会在同一进程内**再加载一次外挂**
 * （实测同一 pid 多次 "extension loaded"），子会话也会收到 goal_updated —— 共用一个文件会被子代理覆盖。
 */
import * as fs from 'fs';
import * as path from 'path';
import { AGENT_DIR } from './constants';

export const GOAL_ARM_PATH = path.join(AGENT_DIR, 'goal-mode.json');
/** 旧版全局运行态文件（只读兜底；新写入走 `goal-state.<sessionId>.json`） */
export const GOAL_STATE_PATH = path.join(AGENT_DIR, 'goal-state.json');

/** 本会话专属运行态文件路径；sessionId 缺失时退回全局文件（手工调试场景） */
export function goalStatePath(sessionId?: string | null): string {
  return sessionId ? path.join(AGENT_DIR, `goal-state.${sessionId}.json`) : GOAL_STATE_PATH;
}

export interface GoalArm {
  enabled: boolean;
  objective: string;
  tokenBudget: number | null;
  sessionId: string;
  /** 自动续跑配置。内核的 `goal.continuationModes` 只在 TUI 被读（rpc-ui 无续跑），
   *  所以桌面端要「跑到目标完成」只能由外挂在 agent_end 里自己发下一回合。
   *  null/undefined = 不续跑。 */
  autoResume?: GoalAutoResume | null;
}

/**
 * 自动续跑护栏。§必填的理由：没有上限的续跑就是放任模型烧 token，
 * 而且是弱模型空转放大器的最佳温床（每轮都"再想想"、永不 complete）。
 */
export interface GoalAutoResume {
  enabled: boolean;
  /** 最多续跑多少轮（0 = 不限）。到达后停止续跑，目标保持 active 等用户处理 */
  maxTurns: number;
  /** 最长续跑多久（分钟，0 = 不限） */
  maxMinutes: number;
  /** 两轮之间的最小间隔（毫秒），给内核收尾/落盘留时间，默认 800（与内核 TUI 防抖一致） */
  minIntervalMs?: number;
}

export const DEFAULT_AUTO_RESUME: GoalAutoResume = { enabled: false, maxTurns: 30, maxMinutes: 240, minIntervalMs: 800 };

/**
 * 暂停 / 继续自动续跑：**只改开关，保留护栏配置**（maxTurns/maxMinutes 不动），
 * 不发任何消息给模型、不清续跑计数。
 *
 * ⚠️ 这不是内核的 `paused` 状态：goal 工具只有 `create|get|resume|complete|drop` 五个 op，
 * **没有 pause**；目标级暂停只在内核内部（`onThreadSuspended` → `pauseGoal()`）发生，
 * RPC 下拿不到入口。桌面端真正需要的是「长跑中歇一下看看进度」，停掉续跑就是这个语义。
 */
export function setAutoResumeEnabled(sessionId: string | null, enabled: boolean): GoalAutoResume | null {
  const arm = readGoalArm();
  if (!arm.autoResume) return null;
  const next: GoalAutoResume = { ...arm.autoResume, enabled };
  writeGoalArm({ ...arm, sessionId: arm.sessionId || sessionId || '', autoResume: next });
  return next;
}

/** 调整续跑护栏（轮数 / 时长）。中途改预算做不到 —— goal 工具没有该 op，
 *  `goalRuntime.onBudgetMutated()` 只被 TUI 的 `/goal budget` 调用，扩展 API 不暴露。 */
export function setAutoResumeLimits(sessionId: string | null, maxTurns?: number, maxMinutes?: number): GoalAutoResume | null {
  const arm = readGoalArm();
  if (!arm.autoResume) return null;
  const next: GoalAutoResume = {
    ...arm.autoResume,
    maxTurns: typeof maxTurns === 'number' && maxTurns > 0 ? Math.floor(maxTurns) : arm.autoResume.maxTurns,
    maxMinutes: typeof maxMinutes === 'number' && maxMinutes > 0 ? Math.floor(maxMinutes) : arm.autoResume.maxMinutes,
  };
  writeGoalArm({ ...arm, sessionId: arm.sessionId || sessionId || '', autoResume: next });
  return next;
}

/** 续跑计数文件（外挂写，主进程/前端只读展示）：`goal-resume.<sessionId>.json` */
export function goalResumePath(sessionId?: string | null): string {
  return sessionId ? path.join(AGENT_DIR, `goal-resume.${sessionId}.json`) : path.join(AGENT_DIR, 'goal-resume.json');
}

export interface GoalResumeState {
  sessionId?: string;
  /** 已续跑轮数 */
  turns?: number;
  startedAt?: number;
  lastAt?: number;
  /** 最后一次停止续跑的原因（给用户看） */
  stoppedReason?: string;
}

export function readGoalResume(sessionId?: string | null): GoalResumeState | null {
  for (const p of sessionId ? [goalResumePath(sessionId), goalResumePath(null)] : [goalResumePath(null)]) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!raw || typeof raw !== 'object') continue;
      if (raw.sessionId && sessionId && raw.sessionId !== sessionId) continue;
      return raw;
    } catch {
      continue;
    }
  }
  return null;
}

/** 开新目标 / 收尾目标时清掉计数：否则上一轮的轮数会算进新目标，护栏提前触发 */
export function clearGoalResume(sessionId?: string | null): void {
  for (const p of [goalResumePath(sessionId), goalResumePath(null)]) {
    try {
      if (!fs.existsSync(p)) continue;
      if (!sessionId) {
        fs.unlinkSync(p);
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (raw?.sessionId && raw.sessionId !== sessionId) continue;
      fs.unlinkSync(p);
    } catch {
      /* 删不掉不影响主流程 */
    }
  }
}

/** 草稿（转写 + 人审闸门）文件路径：`goal-draft.<sessionId>.json`。
 *  同样按会话分文件 —— 理由同运行态（子代理会在同进程内重载外挂）。 */
export function goalDraftPath(sessionId?: string | null): string {
  return sessionId ? path.join(AGENT_DIR, `goal-draft.${sessionId}.json`) : path.join(AGENT_DIR, 'goal-draft.json');
}

export interface GoalState {
  sessionId?: string;
  ts?: number;
  enabled?: boolean;
  status?: string;
  objective?: string;
  tokensUsed?: number;
  tokenBudget?: number | null;
}

/**
 * 目标草稿：用户点「开始执行」之前，模型先把需求转写成可验收的目标方案。
 * status: pending=已下发、等模型产出 | ready=草稿已就绪、等人审 | error=模型没按格式输出
 */
export interface GoalDraft {
  sessionId: string;
  /** 渲染层发起这次转写时用的会话 id（前端自己穿进来的那个值，前后一致）。
   *  会话 id 在「新对话首条消息」时会迁移，而主进程按实例 id 写、外挂按 hook id 写、
   *  前端按渲染层 id 读 —— 三方不一致时靠 sessionId 匹配会让卡片误判成"别的会话的草稿"
   *  而直接隐藏（方案明明产出了却看不到）。匹配一律优先用这个字段。 */
  uiSessionId?: string;
  /** 这次转写流程涉及过的所有会话 id（实例 id / 渲染层 id / 内核 hook id）。
   *  会话 id 迁移后旧草稿仍能按别名找回；无关会话的 id 不在其中，隔离性不受影响。 */
  aliases?: string[];
  ts: number;
  status: 'pending' | 'ready' | 'error';
  /** 用户原话（转写前的输入） */
  request: string;
  /** 转写后的目标：写清"做完是什么样子" */
  objective: string;
  /** 验收标准（每条都要能客观判定） */
  criteria: string[];
  /** 执行步骤 */
  todos: string[];
  error?: string;
  /** 下发后由主进程补写的自诊断（见 main.ts goal:draft）：
   *  区分「内核没起回合（排队）」与「已交给模型（慢在模型端）」——
   *  实测两者等待时间都可能到 200 秒级，光看秒表分不出来。 */
  diag?: {
    invoked: boolean;
    atSec: number;
    idleSec: number;
    pendingAsks: number;
  };
}

const EMPTY_ARM: GoalArm = { enabled: false, objective: '', tokenBudget: null, sessionId: '', autoResume: null };

function parseAutoResume(raw: any): GoalAutoResume | null {
  const r = raw?.autoResume;
  // ⚠️ enabled=false（用户暂停）**不能**读成 null：配置丢了就再也恢复不了，
  // 前端也会因为读不到 autoResume 而把「继续续跑」按钮藏起来。
  // 「要不要续跑」由消费方判 `.enabled === true`，这里只负责把配置原样读出来。
  if (!r || typeof r !== 'object' || typeof r.enabled !== 'boolean') return null;
  const n = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : def);
  return {
    enabled: r.enabled === true,
    maxTurns: n(r.maxTurns, DEFAULT_AUTO_RESUME.maxTurns),
    maxMinutes: n(r.maxMinutes, DEFAULT_AUTO_RESUME.maxMinutes),
    minIntervalMs: n(r.minIntervalMs, DEFAULT_AUTO_RESUME.minIntervalMs ?? 800),
  };
}

export function readGoalArm(): GoalArm {
  try {
    if (!fs.existsSync(GOAL_ARM_PATH)) return { ...EMPTY_ARM };
    const raw = JSON.parse(fs.readFileSync(GOAL_ARM_PATH, 'utf8'));
    return {
      enabled: raw?.enabled === true,
      objective: typeof raw?.objective === 'string' ? raw.objective : '',
      tokenBudget: typeof raw?.tokenBudget === 'number' ? raw.tokenBudget : null,
      sessionId: typeof raw?.sessionId === 'string' ? raw.sessionId : '',
      autoResume: parseAutoResume(raw),
    };
  } catch {
    return { ...EMPTY_ARM };
  }
}

export function writeGoalArm(arm: GoalArm): void {
  const dir = path.dirname(GOAL_ARM_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GOAL_ARM_PATH, JSON.stringify(arm, null, 2) + '\n', 'utf8');
}

/** 读某会话的运行态：先看专属文件，再看旧版全局文件（全局文件里写着别的会话则视为无目标） */
export function readGoalState(sessionId?: string | null): GoalState | null {
  const candidates = sessionId ? [goalStatePath(sessionId), GOAL_STATE_PATH] : [GOAL_STATE_PATH];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!raw || typeof raw !== 'object') continue;
      if (p === GOAL_STATE_PATH && raw.sessionId && sessionId && raw.sessionId !== sessionId) continue;
      return raw;
    } catch {
      continue;
    }
  }
  return null;
}

/** 清掉某会话的运行态（用户开新目标时调用）。
 *  不清的话旧文件里的 objective 会让外挂以为「这个目标已建过」→ 不再注入「待创建」指令；
 *  前端也会继续显示上一个（已完成/已放弃的）目标。 */
export function clearGoalState(sessionId?: string | null): void {
  for (const p of [goalStatePath(sessionId), GOAL_STATE_PATH]) {
    try {
      if (!fs.existsSync(p)) continue;
      if (p === GOAL_STATE_PATH) {
        // 全局文件里若装着别的会话，别动它
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (raw?.sessionId && sessionId && raw.sessionId !== sessionId) continue;
      }
      fs.unlinkSync(p);
    } catch {
      /* 删不掉也不影响主流程 */
    }
  }
}

/** 草稿读写（都在本会话专属文件里；sessionId 缺失时退回全局文件，手工调试用） */
/**
 * 草稿归属判定：这个 id 是不是这份草稿的「主人之一」。
 *
 * 为什么需要多身份：同一次转写流程会牵涉三个不同的会话 id ——
 * 主进程按**实例 id** 写、渲染层按**自己的会话 id** 读、外挂按 **hook id**（内核真实会话 id）读；
 * 而「新对话首条消息」会触发 id 迁移，三方拿到的值可能各不相同。
 * 只认单一 `sessionId` 会让整条闸门静默失效（前端永远转圈 + 外挂不注入转写指令 →
 * 这一轮退化成普通回合，实测表现为"等了 200 秒模型才动，但走的不是目标模式"）。
 *
 * 但仍然**必须**拒绝无关会话：外挂读到别人的 pending 会误以为自己在草稿阶段（拦掉写类工具）。
 * 所以只认「明确列名」的 id：sessionId / uiSessionId / aliases 三处任一命中才算。
 */
function draftBelongsTo(raw: any, sessionId?: string | null): boolean {
  if (!sessionId) return true;
  if (raw?.sessionId === sessionId) return true;
  if (raw?.uiSessionId === sessionId) return true;
  if (Array.isArray(raw?.aliases) && raw.aliases.includes(sessionId)) return true;
  // 完全没有身份信息的草稿（异常写入/旧格式）：无从判断归属，放行优于静默失效
  return !raw?.sessionId && !raw?.uiSessionId && !(Array.isArray(raw?.aliases) && raw.aliases.length);
}

export function readGoalDraft(sessionId?: string | null): GoalDraft | null {
  const named = goalDraftPath(sessionId);
  const fallback = goalDraftPath(null);
  for (const p of sessionId && named !== fallback ? [named, fallback] : [fallback]) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!raw || typeof raw !== 'object') continue;
      if (!draftBelongsTo(raw, sessionId)) continue;
      // 兜底副本只认「新近」的：陈年草稿不该在几小时后把某轮消息误判成草稿阶段
      if (p === fallback && typeof raw.ts === 'number' && Date.now() - raw.ts > 30 * 60 * 1000) continue;
      return raw as GoalDraft;
    } catch {
      continue;
    }
  }
  return null;
}

export function writeGoalDraft(draft: GoalDraft): void {
  const dir = path.dirname(GOAL_ARM_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 累积别名：写进来的每个 id 都记下，让「迁移后也能找回来」。只增不减（草稿是短命对象）。
  const aliases = Array.from(
    new Set([...(draft.aliases ?? []), draft.sessionId, draft.uiSessionId].filter(Boolean) as string[]),
  );
  const body = JSON.stringify({ ...draft, aliases }, null, 2) + '\n';
  fs.writeFileSync(goalDraftPath(draft.sessionId), body, 'utf8');
  // 再写一份 sid 无关的兜底副本：前端按渲染层 id 读、外挂按 hook id 读，都与实例 id 不同，
  // 只写带 id 的文件会让方案产出了却没人读得到（卡片一直转圈）。
  if (goalDraftPath(draft.sessionId) !== goalDraftPath(null)) {
    try {
      fs.writeFileSync(goalDraftPath(null), body, 'utf8');
    } catch {
      /* 兜底写失败不影响主副本 */
    }
  }
}

/** 清掉草稿（用户点「开始执行」或「放弃」之后）：留着会让下一轮继续被判成草稿阶段 */
export function clearGoalDraft(sessionId?: string | null): void {
  for (const p of [goalDraftPath(sessionId), goalDraftPath(null)]) {
    try {
      if (!fs.existsSync(p)) continue;
      if (!sessionId) {
        fs.unlinkSync(p);
        continue;
      }
      // 归属用同一套判定（含别名）：既保证 id 迁移后仍清得掉自己那份，
      // 也不会误删别的会话的草稿 —— 漏清的后果是下一轮消息被当成"草稿阶段"（闸门误拦）。
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!draftBelongsTo(raw, sessionId)) continue;
      fs.unlinkSync(p);
    } catch {
      /* 删不掉不影响主流程 */
    }
  }
}

/**
 * 转写专用模型配置：`goal-draft-model.json`。
 *
 * 转写阶段（把需求写成 objective/criteria/todos）默认**沿用当前会话的模型**，
 * 这对强模型没问题，但会话挂在本机弱模型上时最容易卡住/不按格式输出 —— 而"转写"本身
 * 是纯文本结构化活儿，完全可以单独指定一个模型。留空/缺失 = 跟随当前会话（保持原行为）。
 */
export interface GoalDraftModel {
  provider: string;
  modelId: string;
}

export const GOAL_DRAFT_MODEL_PATH = path.join(AGENT_DIR, 'goal-draft-model.json');

export function readGoalDraftModel(): GoalDraftModel | null {
  try {
    const raw = JSON.parse(fs.readFileSync(GOAL_DRAFT_MODEL_PATH, 'utf8'));
    if (raw && typeof raw.provider === 'string' && typeof raw.modelId === 'string' && raw.provider && raw.modelId) {
      return { provider: raw.provider, modelId: raw.modelId };
    }
  } catch {
    /* 缺失/损坏 = 跟随当前会话 */
  }
  return null;
}

/** 传 null 表示「跟随当前会话」（删配置文件） */
export function writeGoalDraftModel(cfg: GoalDraftModel | null): void {
  try {
    if (!cfg) {
      try {
        fs.unlinkSync(GOAL_DRAFT_MODEL_PATH);
      } catch {
        /* 本来就没有 */
      }
      return;
    }
    fs.writeFileSync(GOAL_DRAFT_MODEL_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  } catch {
    /* 写不进不影响主流程 */
  }
}

/** 从草稿合成最终 objective：目标原文 + 验收标准 + 执行步骤一起钉进上下文，
 *  否则目标只留一句摘要，长跑中「完成」很容易退化成主观判断。 */
export function composeObjective(draft: Pick<GoalDraft, 'objective' | 'criteria' | 'todos'>): string {
  const lines: string[] = [String(draft.objective || '').trim()];
  const criteria = Array.isArray(draft.criteria) ? draft.criteria.filter((s) => String(s || '').trim()) : [];
  const todos = Array.isArray(draft.todos) ? draft.todos.filter((s) => String(s || '').trim()) : [];
  if (criteria.length) {
    lines.push('', '验收标准：');
    criteria.forEach((c, i) => lines.push(`${i + 1}. ${String(c).trim()}`));
  }
  if (todos.length) {
    lines.push('', '执行步骤：');
    todos.forEach((t, i) => lines.push(`${i + 1}. ${String(t).trim()}`));
  }
  return lines.join('\n').trim();
}

/** 草稿指令：让模型**只转写不动手**，把需求写成可验收的目标方案（Qoder 式「转写 + 人审闸门」） */
export function buildDraftCommand(request: string): string {
  return [
    '用户开启了目标模式。这一轮**不要动手执行**，你唯一的任务是把下面这段需求转写成一份可验收的目标方案，',
    '等用户点「开始执行」之后才真正干活。',
    '',
    '<用户需求>',
    request,
    '</用户需求>',
    '',
    '转写要求：',
    '1. objective：一句话写清「做完了是什么样子」（验收态），不要写成「帮我…」这种动作描述，必须含可判定的完成条件；',
    '2. criteria：3-8 条验收标准，每条都要能用「读文件 / 跑命令」客观判定，禁止「代码更清晰」「性能更好」这类主观描述；',
    '3. todos：按执行顺序拆成 5-15 步，每步是一个能独立完成并验证的动作；',
    '4. 用户需求里的硬约束（例如不许跳过测试、不许删用例、不许改接口）必须原样保留，不得弱化。',
    '',
    '本轮**禁止**创建目标、修改任何文件、执行任何命令 —— 只允许读代码做调研。',
    '调研完把方案用下面这个代码块输出（代码块之外可以写简短说明）：',
    '',
    '```tiffa-goal',
    '{"objective":"...","criteria":["...","..."],"todos":["...","..."]}',
    '```',
  ].join('\n');
}

/** 外挂实际激活路径写出的 `api`（`tool-choice.ts` 的命名 tool_choice 支持表） */
const FORCE_CAPABLE_APIS = new Set([
  'anthropic-messages',
  'bedrock-converse-stream',
  'openai-codex-responses',
  'openai-responses',
  'openai-completions',
  'azure-openai-responses',
  'ollama-chat',
  'google-generative-ai',
  'google-gemini-cli',
  'google-vertex',
]);

export function isForceCapable(api: unknown): boolean {
  return typeof api === 'string' && FORCE_CAPABLE_APIS.has(api);
}

/**
 * `/force goal` 指令：创建目标。
 * objective 一律用用户原文（禁止模型改写/翻译/概括）——目标漂移是弱模型最常见的目标模式失效原因。
 */
export function buildCreateCommand(objective: string, tokenBudget?: number | null): string {
  const lines = [
    '/force goal 用户开启了目标模式，请立刻调用 goal 工具创建目标：',
    'op 用 "create"，objective 使用下面这段用户原文（不要改写、不要翻译、不要概括）。',
  ];
  if (typeof tokenBudget === 'number' && tokenBudget > 0) lines.push(`token_budget 用 ${tokenBudget}。`);
  lines.push('', '<目标原文>', objective, '</目标原文>', '', '建完目标后按目标开始工作。');
  return lines.join('\n');
}

/** 模型不支持强制工具调用时的软路径：把目标原文当普通消息发出，由外挂注入「本轮必须建目标」指令兜底 */
export function buildSoftCreateMessage(objective: string): string {
  return `${objective}`;
}

/** `/force goal` 指令：结束 / 放弃目标 */
export function buildCloseCommand(op: 'complete' | 'drop'): string {
  if (op === 'drop') {
    return '/force goal 用户请求放弃当前目标。请调用 goal 工具，op 用 "drop"。';
  }
  return [
    '/force goal 用户请求结束当前目标。请调用 goal 工具，op 用 "complete"。',
    '调用前先按 goal 工具的描述逐项核对当前真实状态（读文件 / 跑检查，验证范围与声称范围一致）；',
    '若仍有未完成的交付物，不要标记完成，直接在回复里说明还差什么。',
  ].join('\n');
}
