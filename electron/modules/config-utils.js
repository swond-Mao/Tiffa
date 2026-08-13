"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDefaultModelFromConfig = resolveDefaultModelFromConfig;
exports.findProviderConfig = findProviderConfig;
exports.callCompletion = callCompletion;
exports.readBypassModel = readBypassModel;
exports.writeBypassModel = writeBypassModel;
exports.readGroundingModel = readGroundingModel;
exports.writeGroundingModel = writeGroundingModel;
exports.checkModelHealth = checkModelHealth;
/**
 * 配置读写：旁路模型 / MCP / 模型健康 / 轻量补全
 *
 * 从 main.js setupIpc 闭包内提取的纯函数。IPC handler 留在 ipc-handlers.ts。
 */
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const constants_1 = require("./constants");
/** 读取 config.yml modelRoles 拿默认 provider/model */
function resolveDefaultModelFromConfig() {
    try {
        const cfgPath = path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent', 'config.yml');
        if (!fs_1.default.existsSync(cfgPath))
            return null;
        const cfg = js_yaml_1.default.load(fs_1.default.readFileSync(cfgPath, 'utf8'));
        const roles = cfg && cfg.modelRoles;
        const ref = (roles && roles.default) || (roles && roles.slow) || null;
        if (!ref || typeof ref !== 'string' || !ref.includes('/'))
            return null;
        const [provider, model] = ref.split('/');
        return { provider, model };
    }
    catch {
        return null;
    }
}
/** 从 models.yml 找 provider 配置 */
function findProviderConfig(providerId) {
    try {
        const raw = fs_1.default.readFileSync(path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent', 'models.yml'), 'utf8');
        const data = js_yaml_1.default.load(raw);
        const providers = data && data.providers;
        const p = providers && providers[providerId];
        if (!p || !p.baseUrl)
            return null;
        return {
            baseUrl: p.baseUrl,
            apiKey: p.apiKey || '',
            model: (p.models && p.models[0] && p.models[0].id) || '',
        };
    }
    catch {
        return null;
    }
}
/** 单次 completion 调用（带 10s 超时） */
async function callCompletion(baseUrl, model, apiKey, prompt, maxTokens) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
        const isDoubao = String(baseUrl).includes('ark');
        const body = {
            model,
            messages: [{ role: 'user', content: String(prompt || '') }],
            max_tokens: maxTokens || 40,
            temperature: 0.3,
            chat_template_kwargs: { enable_thinking: false },
        };
        if (isDoubao)
            body.thinking = { type: 'disabled' };
        const resp = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey && apiKey !== 'none' ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const bodyText = await resp.text().catch(() => '');
            return { error: `HTTP ${resp.status}: ${bodyText.slice(0, 200)}` };
        }
        const data = (await resp.json());
        const text = data?.choices?.[0]?.message?.content || '';
        return text.trim() ? { text: String(text).trim() } : { error: '空响应' };
    }
    finally {
        clearTimeout(timer);
    }
}
/** 读取旁路模型配置（bypass-model.json） */
function readBypassModel(customPath) {
    try {
        const p = customPath || path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent', 'bypass-model.json');
        if (!fs_1.default.existsSync(p))
            return null;
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
/** 写入旁路模型配置 */
function writeBypassModel(cfg, customPath) {
    const p = customPath || path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent', 'bypass-model.json');
    const clean = {
        baseUrl: String(cfg.baseUrl || '').trim(),
        apiKey: String(cfg.apiKey || '').trim(),
        model: String(cfg.model || '').trim(),
        enabled: !!cfg.enabled,
        ts: Date.now(),
    };
    fs_1.default.writeFileSync(p, JSON.stringify(clean, null, 2), 'utf8');
}
/** 读取 MCP grounding 模型配置 */
function readGroundingModel(customPath) {
    try {
        const p = customPath || path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent', 'managed-skills', 'computer-use', 'grounding.json');
        if (!fs_1.default.existsSync(p))
            return null;
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
/** 写入 MCP grounding 模型配置 */
function writeGroundingModel(cfg, customPath) {
    const p = customPath || path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'agent', 'managed-skills', 'computer-use', 'grounding.json');
    const clean = {
        api_base: String(cfg.api_base || '').trim(),
        api_key: String(cfg.api_key || '').trim(),
        model: String(cfg.model || '').trim(),
        enabled: cfg.enabled ? '1' : '0',
    };
    fs_1.default.writeFileSync(p, JSON.stringify(clean, null, 2), 'utf8');
}
/** 模型健康检查：验证 endpoint 可达 + model 可用 */
async function checkModelHealth(arg) {
    const u = String(arg.baseUrl || '').trim().replace(/\/$/, '');
    const k = String(arg.apiKey || '').trim();
    const model = String(arg.model || '').trim();
    if (!u || !model)
        return { ok: false, status: 0, detail: 'Base URL 与 Model ID 必填' };
    // models.yml 本地模型 apiKey 惯例为 "none"，不发送假认证头（与 callCompletion 口径一致）
    const headers = { 'Content-Type': 'application/json' };
    if (k && k !== 'EMPTY' && k !== 'none')
        headers.Authorization = `Bearer ${k}`;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(`${u}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        const text = await r.text().catch(() => '');
        if (r.ok)
            return { ok: true, status: r.status, detail: '模型可达且响应正常' };
        return { ok: false, status: r.status, detail: text.slice(0, 240) || `HTTP ${r.status}` };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, status: 0, detail: '网络不可达或请求超时: ' + msg };
    }
}
//# sourceMappingURL=config-utils.js.map