/**
 * 配置读写：旁路模型 / MCP / 模型健康 / 轻量补全
 *
 * 从 main.js setupIpc 闭包内提取的纯函数。IPC handler 留在 ipc-handlers.ts。
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { PORTABLE_ROOT } from './constants';

export interface ModelRef {
  provider: string;
  model: string;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface CompletionResult {
  text?: string;
  error?: string;
}

/** 读取 config.yml modelRoles 拿默认 provider/model */
export function resolveDefaultModelFromConfig(): ModelRef | null {
  try {
    const cfgPath = path.join(PORTABLE_ROOT, 'data', 'agent', 'config.yml');
    if (!fs.existsSync(cfgPath)) return null;
    const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8')) as { modelRoles?: { default?: string; slow?: string } } | null;
    const roles = cfg && cfg.modelRoles;
    const ref = (roles && roles.default) || (roles && roles.slow) || null;
    if (!ref || typeof ref !== 'string' || !ref.includes('/')) return null;
    const [provider, model] = ref.split('/');
    return { provider, model };
  } catch {
    return null;
  }
}

/** 从 models.yml 找 provider 配置 */
export function findProviderConfig(providerId: string): ProviderConfig | null {
  try {
    const raw = fs.readFileSync(path.join(PORTABLE_ROOT, 'data', 'agent', 'models.yml'), 'utf8');
    const data = yaml.load(raw) as { providers?: Record<string, { baseUrl?: string; apiKey?: string; models?: { id?: string }[] }> } | null;
    const providers = data && data.providers;
    const p = providers && providers[providerId];
    if (!p || !p.baseUrl) return null;
    return {
      baseUrl: p.baseUrl,
      apiKey: p.apiKey || '',
      model: (p.models && p.models[0] && p.models[0].id) || '',
    };
  } catch {
    return null;
  }
}

/** 单次 completion 调用（带 10s 超时） */
export async function callCompletion(
  baseUrl: string,
  model: string,
  apiKey: string,
  prompt: string,
  maxTokens: number,
): Promise<CompletionResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const isDoubao = String(baseUrl).includes('ark');
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: String(prompt || '') }],
      max_tokens: maxTokens || 40,
      temperature: 0.3,
      chat_template_kwargs: { enable_thinking: false },
    };
    if (isDoubao) body.thinking = { type: 'disabled' };
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
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content || '';
    return text.trim() ? { text: String(text).trim() } : { error: '空响应' };
  } finally {
    clearTimeout(timer);
  }
}

export interface ModelCandidate {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** 读取旁路模型配置（bypass-model.json） */
export function readBypassModel(customPath?: string): { enabled: boolean; baseUrl: string; apiKey: string; model: string; ts: number } | null {
  try {
    const p = customPath || path.join(PORTABLE_ROOT, 'data', 'agent', 'bypass-model.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 写入旁路模型配置 */
export function writeBypassModel(cfg: { baseUrl?: string; apiKey?: string; model?: string; enabled?: boolean }, customPath?: string): void {
  const p = customPath || path.join(PORTABLE_ROOT, 'data', 'agent', 'bypass-model.json');
  const clean = {
    baseUrl: String(cfg.baseUrl || '').trim(),
    apiKey: String(cfg.apiKey || '').trim(),
    model: String(cfg.model || '').trim(),
    enabled: !!cfg.enabled,
    ts: Date.now(),
  };
  fs.writeFileSync(p, JSON.stringify(clean, null, 2), 'utf8');
}

/** 读取 MCP grounding 模型配置 */
export function readGroundingModel(customPath?: string): { enabled: string; api_base: string; api_key: string; model: string } | null {
  try {
    const p = customPath || path.join(PORTABLE_ROOT, 'skills', 'computer-use', 'grounding.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 写入 MCP grounding 模型配置 */
export function writeGroundingModel(cfg: { api_base?: string; api_key?: string; model?: string; enabled?: boolean }, customPath?: string): void {
  const p = customPath || path.join(PORTABLE_ROOT, 'skills', 'computer-use', 'grounding.json');
  const clean = {
    api_base: String(cfg.api_base || '').trim(),
    api_key: String(cfg.api_key || '').trim(),
    model: String(cfg.model || '').trim(),
    enabled: cfg.enabled ? '1' : '0',
  };
  fs.writeFileSync(p, JSON.stringify(clean, null, 2), 'utf8');
}

export interface HealthCheckResult {
  ok: boolean;
  status: number;
  detail: string;
}

/** 模型健康检查：验证 endpoint 可达 + model 可用 */
export async function checkModelHealth(arg: { baseUrl?: string; apiKey?: string; model?: string }): Promise<HealthCheckResult> {
  const u = String(arg.baseUrl || '').trim().replace(/\/$/, '');
  const k = String(arg.apiKey || '').trim() || 'EMPTY';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const model = String(arg.model || '').trim();
  if (!u || !model) return { ok: false, status: 0, detail: 'Base URL 与 Model ID 必填' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`${u}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await r.text().catch(() => '');
    if (r.ok) return { ok: true, status: r.status, detail: '模型可达且响应正常' };
    return { ok: false, status: r.status, detail: text.slice(0, 240) || `HTTP ${r.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, detail: '网络不可达或请求超时: ' + msg };
  }
}
