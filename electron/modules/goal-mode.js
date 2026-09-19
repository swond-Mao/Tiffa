"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AUTO_RESUME = exports.GOAL_STATE_PATH = exports.GOAL_ARM_PATH = void 0;
exports.goalStatePath = goalStatePath;
exports.goalResumePath = goalResumePath;
exports.readGoalResume = readGoalResume;
exports.clearGoalResume = clearGoalResume;
exports.goalDraftPath = goalDraftPath;
exports.readGoalArm = readGoalArm;
exports.writeGoalArm = writeGoalArm;
exports.readGoalState = readGoalState;
exports.clearGoalState = clearGoalState;
exports.readGoalDraft = readGoalDraft;
exports.writeGoalDraft = writeGoalDraft;
exports.clearGoalDraft = clearGoalDraft;
exports.composeObjective = composeObjective;
exports.buildDraftCommand = buildDraftCommand;
exports.isForceCapable = isForceCapable;
exports.buildCreateCommand = buildCreateCommand;
exports.buildSoftCreateMessage = buildSoftCreateMessage;
exports.buildCloseCommand = buildCloseCommand;
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const constants_1 = require("./constants");
exports.GOAL_ARM_PATH = path.join(constants_1.AGENT_DIR, 'goal-mode.json');
/** 旧版全局运行态文件（只读兜底；新写入走 `goal-state.<sessionId>.json`） */
exports.GOAL_STATE_PATH = path.join(constants_1.AGENT_DIR, 'goal-state.json');
/** 本会话专属运行态文件路径；sessionId 缺失时退回全局文件（手工调试场景） */
function goalStatePath(sessionId) {
    return sessionId ? path.join(constants_1.AGENT_DIR, `goal-state.${sessionId}.json`) : exports.GOAL_STATE_PATH;
}
exports.DEFAULT_AUTO_RESUME = { enabled: false, maxTurns: 30, maxMinutes: 240, minIntervalMs: 800 };
/** 续跑计数文件（外挂写，主进程/前端只读展示）：`goal-resume.<sessionId>.json` */
function goalResumePath(sessionId) {
    return sessionId ? path.join(constants_1.AGENT_DIR, `goal-resume.${sessionId}.json`) : path.join(constants_1.AGENT_DIR, 'goal-resume.json');
}
function readGoalResume(sessionId) {
    for (const p of sessionId ? [goalResumePath(sessionId), goalResumePath(null)] : [goalResumePath(null)]) {
        try {
            if (!fs.existsSync(p))
                continue;
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!raw || typeof raw !== 'object')
                continue;
            if (raw.sessionId && sessionId && raw.sessionId !== sessionId)
                continue;
            return raw;
        }
        catch {
            continue;
        }
    }
    return null;
}
/** 开新目标 / 收尾目标时清掉计数：否则上一轮的轮数会算进新目标，护栏提前触发 */
function clearGoalResume(sessionId) {
    for (const p of [goalResumePath(sessionId), goalResumePath(null)]) {
        try {
            if (!fs.existsSync(p))
                continue;
            if (!sessionId) {
                fs.unlinkSync(p);
                continue;
            }
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (raw?.sessionId && raw.sessionId !== sessionId)
                continue;
            fs.unlinkSync(p);
        }
        catch {
            /* 删不掉不影响主流程 */
        }
    }
}
/** 草稿（转写 + 人审闸门）文件路径：`goal-draft.<sessionId>.json`。
 *  同样按会话分文件 —— 理由同运行态（子代理会在同进程内重载外挂）。 */
function goalDraftPath(sessionId) {
    return sessionId ? path.join(constants_1.AGENT_DIR, `goal-draft.${sessionId}.json`) : path.join(constants_1.AGENT_DIR, 'goal-draft.json');
}
const EMPTY_ARM = { enabled: false, objective: '', tokenBudget: null, sessionId: '' };
function parseAutoResume(raw) {
    const r = raw?.autoResume;
    if (!r || typeof r !== 'object' || r.enabled !== true)
        return null;
    const n = (v, def) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : def);
    return {
        enabled: true,
        maxTurns: n(r.maxTurns, exports.DEFAULT_AUTO_RESUME.maxTurns),
        maxMinutes: n(r.maxMinutes, exports.DEFAULT_AUTO_RESUME.maxMinutes),
        minIntervalMs: n(r.minIntervalMs, exports.DEFAULT_AUTO_RESUME.minIntervalMs ?? 800),
    };
}
function readGoalArm() {
    try {
        if (!fs.existsSync(exports.GOAL_ARM_PATH))
            return { ...EMPTY_ARM };
        const raw = JSON.parse(fs.readFileSync(exports.GOAL_ARM_PATH, 'utf8'));
        return {
            enabled: raw?.enabled === true,
            objective: typeof raw?.objective === 'string' ? raw.objective : '',
            tokenBudget: typeof raw?.tokenBudget === 'number' ? raw.tokenBudget : null,
            sessionId: typeof raw?.sessionId === 'string' ? raw.sessionId : '',
            autoResume: parseAutoResume(raw),
        };
    }
    catch {
        return { ...EMPTY_ARM };
    }
}
function writeGoalArm(arm) {
    const dir = path.dirname(exports.GOAL_ARM_PATH);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(exports.GOAL_ARM_PATH, JSON.stringify(arm, null, 2) + '\n', 'utf8');
}
/** 读某会话的运行态：先看专属文件，再看旧版全局文件（全局文件里写着别的会话则视为无目标） */
function readGoalState(sessionId) {
    const candidates = sessionId ? [goalStatePath(sessionId), exports.GOAL_STATE_PATH] : [exports.GOAL_STATE_PATH];
    for (const p of candidates) {
        try {
            if (!fs.existsSync(p))
                continue;
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!raw || typeof raw !== 'object')
                continue;
            if (p === exports.GOAL_STATE_PATH && raw.sessionId && sessionId && raw.sessionId !== sessionId)
                continue;
            return raw;
        }
        catch {
            continue;
        }
    }
    return null;
}
/** 清掉某会话的运行态（用户开新目标时调用）。
 *  不清的话旧文件里的 objective 会让外挂以为「这个目标已建过」→ 不再注入「待创建」指令；
 *  前端也会继续显示上一个（已完成/已放弃的）目标。 */
function clearGoalState(sessionId) {
    for (const p of [goalStatePath(sessionId), exports.GOAL_STATE_PATH]) {
        try {
            if (!fs.existsSync(p))
                continue;
            if (p === exports.GOAL_STATE_PATH) {
                // 全局文件里若装着别的会话，别动它
                const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (raw?.sessionId && sessionId && raw.sessionId !== sessionId)
                    continue;
            }
            fs.unlinkSync(p);
        }
        catch {
            /* 删不掉也不影响主流程 */
        }
    }
}
/** 草稿读写（都在本会话专属文件里；sessionId 缺失时退回全局文件，手工调试用） */
function readGoalDraft(sessionId) {
    for (const p of sessionId ? [goalDraftPath(sessionId), goalDraftPath(null)] : [goalDraftPath(null)]) {
        try {
            if (!fs.existsSync(p))
                continue;
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!raw || typeof raw !== 'object')
                continue;
            if (raw.sessionId && sessionId && raw.sessionId !== sessionId)
                continue;
            return raw;
        }
        catch {
            continue;
        }
    }
    return null;
}
function writeGoalDraft(draft) {
    const dir = path.dirname(exports.GOAL_ARM_PATH);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(goalDraftPath(draft.sessionId), JSON.stringify(draft, null, 2) + '\n', 'utf8');
}
/** 清掉草稿（用户点「开始执行」或「放弃」之后）：留着会让下一轮继续被判成草稿阶段 */
function clearGoalDraft(sessionId) {
    for (const p of [goalDraftPath(sessionId), goalDraftPath(null)]) {
        try {
            if (!fs.existsSync(p))
                continue;
            if (!sessionId) {
                fs.unlinkSync(p);
                continue;
            }
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (raw?.sessionId && raw.sessionId !== sessionId)
                continue;
            fs.unlinkSync(p);
        }
        catch {
            /* 删不掉不影响主流程 */
        }
    }
}
/** 从草稿合成最终 objective：目标原文 + 验收标准 + 执行步骤一起钉进上下文，
 *  否则目标只留一句摘要，长跑中「完成」很容易退化成主观判断。 */
function composeObjective(draft) {
    const lines = [String(draft.objective || '').trim()];
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
function buildDraftCommand(request) {
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
function isForceCapable(api) {
    return typeof api === 'string' && FORCE_CAPABLE_APIS.has(api);
}
/**
 * `/force goal` 指令：创建目标。
 * objective 一律用用户原文（禁止模型改写/翻译/概括）——目标漂移是弱模型最常见的目标模式失效原因。
 */
function buildCreateCommand(objective, tokenBudget) {
    const lines = [
        '/force goal 用户开启了目标模式，请立刻调用 goal 工具创建目标：',
        'op 用 "create"，objective 使用下面这段用户原文（不要改写、不要翻译、不要概括）。',
    ];
    if (typeof tokenBudget === 'number' && tokenBudget > 0)
        lines.push(`token_budget 用 ${tokenBudget}。`);
    lines.push('', '<目标原文>', objective, '</目标原文>', '', '建完目标后按目标开始工作。');
    return lines.join('\n');
}
/** 模型不支持强制工具调用时的软路径：把目标原文当普通消息发出，由外挂注入「本轮必须建目标」指令兜底 */
function buildSoftCreateMessage(objective) {
    return `${objective}`;
}
/** `/force goal` 指令：结束 / 放弃目标 */
function buildCloseCommand(op) {
    if (op === 'drop') {
        return '/force goal 用户请求放弃当前目标。请调用 goal 工具，op 用 "drop"。';
    }
    return [
        '/force goal 用户请求结束当前目标。请调用 goal 工具，op 用 "complete"。',
        '调用前先按 goal 工具的描述逐项核对当前真实状态（读文件 / 跑检查，验证范围与声称范围一致）；',
        '若仍有未完成的交付物，不要标记完成，直接在回复里说明还差什么。',
    ].join('\n');
}
//# sourceMappingURL=goal-mode.js.map