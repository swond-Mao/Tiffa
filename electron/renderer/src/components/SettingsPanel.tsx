/**
 * SettingsPanel — 设置面板（等价旧版 setupSettings + 模型配置 + 旁路/grounding +
 * 主题 + ComputerUse + 约束 + AI 身份）
 *
 * 节：模型配置（provider 卡片增删改/拉取/保存/重启）/ 旁路模型 / grounding MCP /
 * 当前模型列表（筛选 + 隐藏）/ 主题风格（7 预设 + 日夜）/ Computer Use /
 * 约束规则 / AI 身份 / 关于
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '../stores/useUiStore';
import type { GoalLiveState } from '../stores/useUiStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useProcStore } from '../stores/useProcStore';
import { switchModel, invalidateModelListCache, getModelListCached } from '../services/sessionController';
import { showModalConfirm } from '../services/tabActions';
import { escapeHtml } from '../services/utils';
import { PERSONA_KEYWORDS, buildFallbackPersona, buildPersonaPrompt } from '../services/personaTemplate';
import type { TiffaModelsConfig, TiffaProviderConfig } from '../types/tiffaDesktop';

// ── 供应商预置（从 dim/oh-my-pi-UI 的 AddModelModal 抄回：已知提供商网格，自动带出 baseUrl/api）──
interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  authUrl?: string;
  hint: string;
  cat: 'popular' | 'chinese' | 'local' | 'other';
}

const PRESET_GROUPS: { label: string; cat: ProviderPreset['cat']; items: ProviderPreset[] }[] = [
  {
    label: '热门',
    cat: 'popular',
    items: [
      { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', api: 'openai-completions', authUrl: 'https://platform.deepseek.com/api_keys', hint: 'sk-...', cat: 'popular' },
      { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-responses', authUrl: 'https://platform.openai.com/api-keys', hint: 'sk-...', cat: 'popular' },
      { id: 'anthropic', name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages', authUrl: 'https://console.anthropic.com/settings/keys', hint: 'sk-ant-...', cat: 'popular' },
      { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', authUrl: 'https://openrouter.ai/keys', hint: 'sk-or-...', cat: 'popular' },
      { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions', authUrl: 'https://console.groq.com/keys', hint: 'gsk_...', cat: 'popular' },
      { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', api: 'openai-completions', authUrl: 'https://console.x.ai/', hint: 'xai-...', cat: 'popular' },
      { id: 'moonshot', name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.ai/v1', api: 'openai-completions', authUrl: 'https://platform.moonshot.ai/console/api-keys', hint: 'sk-...', cat: 'popular' },
      { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions', authUrl: 'https://cloud.cerebras.ai/platform/', hint: 'csk-...', cat: 'popular' },
      { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions', authUrl: 'https://fireworks.ai/account/api-keys', hint: 'fw_...', cat: 'popular' },
      { id: 'mistral', name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions', authUrl: 'https://console.mistral.ai/api-keys/', hint: '...', cat: 'popular' },
      { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', api: 'openai-completions', authUrl: 'https://api.together.xyz/settings/api-keys', hint: '...', cat: 'popular' },
      { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions', authUrl: 'https://build.nvidia.com/', hint: 'nvapi-...', cat: 'popular' },
      { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', api: 'openai-completions', authUrl: 'https://huggingface.co/settings/tokens', hint: 'hf_...', cat: 'popular' },
      { id: 'google', name: 'Google (Gemini)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-generative-ai', authUrl: 'https://aistudio.google.com/app/apikey', hint: 'AIza...', cat: 'popular' },
    ],
  },
  {
    label: '国内服务商',
    cat: 'chinese',
    items: [
      { id: 'zhipu-coding-plan', name: '智谱 GLM (Coding Plan)', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', api: 'openai-completions', authUrl: 'https://open.bigmodel.cn/usercenter/apikeys', hint: '...', cat: 'chinese' },
      { id: 'zai', name: '智谱 zAI (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', authUrl: 'https://open.bigmodel.cn/usercenter/apikeys', hint: '...', cat: 'chinese' },
      { id: 'qianfan', name: '百度千帆 (Qianfan)', baseUrl: 'https://qianfan.baidubce.com/v2', api: 'openai-completions', authUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application', hint: '...', cat: 'chinese' },
      { id: 'firepass', name: 'Fire Pass (Kimi K2 Turbo)', baseUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions', authUrl: 'https://fireworks.ai/firepass', hint: 'fpk_...', cat: 'chinese' },
      { id: 'xiaomi', name: '小米 (Xiaomi)', baseUrl: 'https://api.xiaomi.com/v1', api: 'openai-completions', authUrl: 'https://platform.mi.com/', hint: '...', cat: 'chinese' },
      { id: 'minimax-code', name: 'MiniMax Code', baseUrl: 'https://api.minimax.chat/v1', api: 'openai-completions', authUrl: 'https://platform.minimaxi.com/document/Account%20&%20Keys', hint: '...', cat: 'chinese' },
      { id: 'minimax-code-cn', name: 'MiniMax Code CN', baseUrl: 'https://api.minimaxi.chat/v1', api: 'openai-completions', authUrl: 'https://platform.minimaxi.com/document/Account%20&%20Keys', hint: '...', cat: 'chinese' },
      { id: 'sakana', name: 'Sakana AI (Fugu/GLM)', baseUrl: 'https://api.sakana.ai/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'chinese' },
      { id: 'siliconflow', name: 'SiliconFlow (硅基流动)', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions', authUrl: 'https://cloud.siliconflow.cn/account/ak', hint: 'sk-...', cat: 'chinese' },
      { id: 'dashscope', name: '阿里 DashScope (通义)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', authUrl: 'https://dashscope.console.aliyun.com/apiKey', hint: 'sk-...', cat: 'chinese' },
    ],
  },
  {
    label: '本地 / 自托管',
    cat: 'local',
    items: [
      { id: 'ollama', name: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434/v1', api: 'openai-completions', authUrl: '', hint: '（OpenAI 兼容端点，本地可留空 Key）', cat: 'local' },
      { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', api: 'openai-completions', authUrl: '', hint: '（本地服务可留空）', cat: 'local' },
      { id: 'vllm', name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', api: 'openai-completions', authUrl: '', hint: '（本地服务可留空）', cat: 'local' },
      { id: 'llama-cpp', name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1', api: 'openai-completions', authUrl: '', hint: '（OpenAI 兼容端点，本地可留空 Key）', cat: 'local' },
      { id: 'ollama-cloud', name: 'Ollama Cloud', baseUrl: 'https://ollama.com/v1', api: 'openai-completions', authUrl: 'https://ollama.com/settings/keys', hint: '（需 API Key）', cat: 'local' },
    ],
  },
  {
    label: '其他',
    cat: 'other',
    items: [
      { id: 'novita', name: 'Novita', baseUrl: 'https://api.novita.ai/openai/v1', api: 'openai-completions', authUrl: 'https://novita.ai/playground/key', hint: '...', cat: 'other' },
      { id: 'aimlapi', name: 'AIML API', baseUrl: 'https://api.aimlapi.com/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'synthetic', name: 'Synthetic (zAI)', baseUrl: 'https://api.synthetic.ai/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'nanogpt', name: 'NanoGPT', baseUrl: 'https://api.nanogpt.com/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', api: 'openai-completions', authUrl: '', hint: 'ppl-...', cat: 'other' },
      { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', baseUrl: 'https://gateway.vercel.sh/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'cloudflare-ai-gateway', name: 'Cloudflare AI Gateway', baseUrl: 'https://gateway.ai.cloudflare.com/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'litellm', name: 'LiteLLM Proxy', baseUrl: 'http://127.0.0.1:4000/v1', api: 'openai-completions', authUrl: '', hint: '（本地代理可留空）', cat: 'other' },
      { id: 'kilo', name: 'Kilo Gateway', baseUrl: 'https://kilo.run/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'zenmux', name: 'ZenMux', baseUrl: 'https://api.zenmux.app/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'umans', name: 'Umans AI', baseUrl: 'https://api.code.umans.ai', api: 'anthropic-messages', authUrl: '', hint: '...', cat: 'other' },
      { id: 'coreweave', name: 'CoreWeave Serverless', baseUrl: 'https://api.coreweave.com/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'wafer-serverless', name: 'Wafer Serverless', baseUrl: 'https://pass.wafer.ai/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'baseten', name: 'Baseten', baseUrl: 'https://app.baseten.co/v1', api: 'openai-completions', authUrl: '', hint: '...', cat: 'other' },
      { id: 'amazon-bedrock', name: 'AWS Bedrock', baseUrl: '', api: 'bedrock-converse-stream', authUrl: '', hint: '（需 AWS 凭证）', cat: 'other' },
      { id: 'azure', name: 'Azure OpenAI', baseUrl: '', api: 'azure-openai-responses', authUrl: '', hint: '（需 Azure 凭证）', cat: 'other' },
      { id: 'google-vertex', name: 'Google Vertex AI', baseUrl: '', api: 'google-vertex', authUrl: '', hint: '（需 GCP 凭证）', cat: 'other' },
    ],
  },
];

// ── 工具 ──

// 双引号 YAML 标量转义：反斜杠与双引号必须转义，否则 Key/名称含特殊字符时产出坏 YAML。
function yq(v: unknown): string {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// 数字字段强转：内核 schema 要求 number，字符串数字会导致整个 providers 配置被禁用（内核启动即崩）。
function ynum(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : dflt;
}

function serializeModelsYaml(data: TiffaModelsConfig | null): string {
  const lines = ['# Tiffa models.yml', ''];
  if (!data || !data.providers) return lines.join('\n');
  lines.push('providers:');
  for (const [k, p] of Object.entries(data.providers)) {
    lines.push(`  ${k}:`, ...(p.name ? [`    name: "${yq(p.name)}"`] : []), `    baseUrl: "${yq(p.baseUrl)}"`, `    api: "${p.api ? yq(p.api) : 'openai-completions'}"`);
    // apiKey 必须始终落盘：内核 getAvailable() 只收录「有凭据或 keyless」的 provider，
    // 空值省略会导致整个供应商从模型列表消失（健康检查不走内核，仍会显示在线）。
    // 惯例：无认证端点写 "none"（与旁路模型 callCompletion/健康检查口径一致）。
    lines.push(`    apiKey: "${p.apiKey ? yq(p.apiKey) : 'none'}"`);
    if (p.models && p.models.length > 0) {
      lines.push('    models:');
      for (const m of p.models) {
        lines.push(
          `      - id: "${m.id ? yq(m.id) : ''}"`,
          `        name: "${yq(m.name || m.id || '')}"`,
          `        reasoning: ${m.reasoning ? 'true' : 'false'}`,
          ...(m.qwen38
            ? [
                // Qwen3.8+ 深度开关：落盘三件套——
                // thinking.requiresEffort:false 显式声明「可关闭思考」，覆盖内核
                // isQwenTemplateReasoningEffortCompat 推导的 requiresEffort:true
                // （否则 off 档被 clamp 到 low，enable_thinking:false 关不掉）。
                // compat.qwenTemplateReasoningEffort:true 驱动 on 档发 reasoning_effort。
                '        thinking:',
                '          mode: "effort"',
                '          efforts: [ "low", "medium", "xhigh" ]',
                '          requiresEffort: false',
                '        compat:',
                '          thinkingFormat: "qwen-chat-template"',
                '          qwenTemplateReasoningEffort: true',
              ]
            : []),
          '        input:',
          ...(m.input && m.input.length > 0 ? m.input : ['text']).map((i) => `          - "${yq(i)}"`),
          `        supportsTools: ${m.supportsTools ? 'true' : 'false'}`,
          `        contextWindow: ${ynum(m.contextWindow, 128000)}`,
          `        maxTokens: ${ynum(m.maxTokens, 8192)}`,
          '        cost:',
          `          input: ${ynum(m.cost?.input, 0)}`,
          `          output: ${ynum(m.cost?.output, 0)}`,
          `          cacheRead: ${ynum(m.cost?.cacheRead, 0)}`,
          `          cacheWrite: ${ynum(m.cost?.cacheWrite, 0)}`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── 模型配置节 ──

interface ModelEntry {
  id: string;
  name?: string;
  reasoning?: boolean;
  /** Qwen3.8+ 思考深度档位（勾选后落盘 compat：thinkingFormat + qwenTemplateReasoningEffort；设置面板「Qwen3.8 深度」勾选框入口） */
  qwen38?: boolean;
  /** 内核 compat 透传（models.yml 的 compat 块；加载时归一化反映到 qwen38 勾选框） */
  compat?: { thinkingFormat?: string; qwenTemplateReasoningEffort?: boolean };
  input?: string[];
  supportsTools?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/**
 * 设置项防抖自动保存。
 * deps 变化后 delay 毫秒执行一次 save；期间再次变化会重置计时；首次挂载不触发。
 * 由各 Section 的 save 回调自行判断“内容与上次一致则跳过”，避免打开面板就重写磁盘。
 */
function useAutoSave(
  save: () => unknown,
  deps: unknown[],
  opts: { delay?: number; enabled?: boolean } = {},
): { saving: boolean; savedAt: number | null } {
  const { delay = 900, enabled = true } = opts;
  const saveRef = useRef(save);
  const first = useRef(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        setSaving(true);
        try {
          await saveRef.current();
          if (!cancelled) setSavedAt(Date.now());
        } catch {
          /* 失败提示由调用方 save 内部负责 */
        } finally {
          if (!cancelled) setSaving(false);
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay, enabled]);

  return { saving, savedAt };
}

/** 自动保存状态提示（替代原来的「保存」按钮） */
function AutoSaveHint({ saving, savedAt, extra }: { saving: boolean; savedAt: number | null; extra?: string }) {
  const time = savedAt ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
  const text = saving ? '保存中…' : savedAt ? `已自动保存 ${time}` : '改动将自动保存';
  return (
    <span className="autosave-hint">
      {text}
      {extra && savedAt && !saving ? ` · ${extra}` : ''}
    </span>
  );
}

function ModelConfigSection() {
  const [cfg, setCfg] = useState<TiffaModelsConfig | null>(null);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const addToast = useUiStore((s) => s.addToast);
  // 上次成功落盘的 models.yml 内容，用于跳过无变化的自动保存
  const lastSavedYaml = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await window.tiffaDesktop.readModelsYml();
      if (r && !r.error) {
        // 空文件也要给出可编辑的空配置，否则会一直停在“加载中”
        const data = (r.data || { providers: {} }) as TiffaModelsConfig;
        // 「Qwen3.8 深度」勾选态归一化：磁盘已有 compat 块（手写或上次保存落盘）时反映到 qwen38，
        // 保证勾选框状态与实际落盘一致（序列化只看 qwen38，防止取消勾选后旧 compat 残留重新写回）。
        for (const p of Object.values((data && data.providers) || {})) {
          for (const m of p.models || []) {
            if (typeof m.qwen38 !== 'boolean') m.qwen38 = !!m.compat?.qwenTemplateReasoningEffort;
          }
        }
        setCfg(data);
        setLoadError('');
        // 记录基线：之后只有内容真的变了才落盘
        lastSavedYaml.current = serializeModelsYaml(data);
      } else {
        setLoadError(`读取 models.yml 失败：${(r && r.error) || '未知错误'}`);
      }
    } catch (err) {
      setLoadError(`读取 models.yml 失败：${(err as Error).message}`);
    }
  }, []);

  // 自动保存：只写盘，不自动重启（编辑过程中反复重启会打断操作；重启走下方「重启」按钮）
  const persist = useCallback(async () => {
    if (!cfg) return;
    try {
      const yaml = serializeModelsYaml(cfg);
      if (yaml === lastSavedYaml.current) return; // 内容未变（含首次加载）→ 不写盘
      const r = (await window.tiffaDesktop.writeModelsYml(yaml)) as { success?: boolean; error?: string };
      if (r && r.success) {
        lastSavedYaml.current = yaml;
        setStatus('');
        // 死列表缓存失效：下次点开模型列表时按新配置重载
        invalidateModelListCache();
      } else {
        setStatus(`保存失败: ${(r && r.error) || ''}`);
        addToast('error', `保存失败: ${(r && r.error) || '未知错误'}`);
      }
    } catch (err) {
      setStatus(`保存失败: ${(err as Error).message}`);
      addToast('error', `保存失败: ${(err as Error).message}`);
    }
  }, [cfg, addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const { saving, savedAt } = useAutoSave(persist, [cfg], { delay: 900 });

  // 读取失败时也要有反馈，否则会永远停在“加载中”
  if (!cfg) return <div className="model-item loading">{loadError || '加载中...'}</div>;
  const providers = cfg.providers || {};

  const patchProvider = (key: string, patch: Partial<TiffaProviderConfig>) => {
    setCfg((c) => {
      if (!c || !c.providers) return c;
      return { ...c, providers: { ...c.providers, [key]: { ...c.providers[key], ...patch } } };
    });
  };

  const deleteProvider = async (key: string) => {
    const ok = await showModalConfirm('删除供应商', `确定删除供应商 "${key}"？\n这将同时删除 models.yml 中的配置和白名单中的相关模型。`);
    if (!ok) return;
    try {
      const r = (await window.tiffaDesktop.deleteTiffaProvider(key)) as { error?: string };
      if (r && r.error) {
        addToast('error', `删除失败: ${r.error}`);
        return;
      }
      setCfg((c) => {
        if (!c || !c.providers) return c;
        const providers = { ...c.providers };
        delete providers[key];
        return { ...c, providers };
      });
      addToast('success', `已删除供应商 ${key}`);
      // 落盘交给 cfg 变化触发的自动保存
    } catch (err) {
      addToast('error', `删除失败: ${(err as Error).message}`);
    }
  };

  const deleteModel = (provKey: string, idx: number, model: ModelEntry) => {
    void showModalConfirm('删除模型', `确定删除模型 "${model.id}"？`).then((ok) => {
      if (!ok) return;
      patchProvider(provKey, {
        models: (providers[provKey]?.models || []).filter((_, i) => i !== idx),
      });
    });
  };

  const fetchModels = async (provKey: string) => {
    const prov = providers[provKey];
    if (!prov || !prov.baseUrl) {
      addToast('error', '请先填写 API 地址');
      return;
    }
    try {
      const r = (await window.tiffaDesktop.fetchProviderModels(prov.baseUrl, prov.apiKey || '')) as {
        models?: Array<{ id: string; reasoning?: boolean }>;
        error?: string;
      };
      if (r && r.error) {
        addToast('error', `拉取失败: ${r.error}`);
        return;
      }
      const models = r?.models || [];
      if (models.length === 0) {
        addToast('info', '服务器返回空列表');
        return;
      }
      const existIds = new Set((prov.models || []).map((m) => m.id));
      const newModels = models.filter((m) => !existIds.has(m.id));
      if (newModels.length === 0) {
        addToast('info', '服务器模型全部已添加');
        return;
      }
      patchProvider(provKey, {
        models: [
          ...(prov.models || []),
          ...newModels.map((m) => ({
            id: m.id,
            name: m.id,
            reasoning: !!m.reasoning,
            input: ['text'],
            supportsTools: true,
            contextWindow: 128000,
            maxTokens: 8192,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          })),
        ],
      });
      addToast('success', `已从服务器拉取 ${newModels.length} 个模型到 ${provKey}`);
    } catch (err) {
      addToast('error', `拉取失败: ${(err as Error).message}`);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">模型配置</div>
      <div className="settings-section-desc">添加、编辑或删除模型供应商与模型；改动自动保存，点「重启」后生效</div>
      <div className="model-config">
        {Object.keys(providers).length === 0 && <div className="model-item empty">暂无供应商配置</div>}
        {Object.entries(providers).map(([key, prov]) => (
          <div className="provider-card" key={key} data-provider-key={key}>
            <div
              className="provider-header"
              onClick={() => setOpenCards((o) => ({ ...o, [key]: !o[key] }))}
            >
              <div>
                <span className="provider-name">{prov.name || key}</span>
                <span className="provider-url">{prov.baseUrl || ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`provider-toggle${openCards[key] ? ' open' : ''}`}>▾</span>
              </div>
            </div>
            {openCards[key] && (
              <div className="provider-body open">
                <button
                  type="button"
                  className="btn-delete-provider"
                  style={{ float: 'right', marginBottom: 8 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteProvider(key);
                  }}
                >
                  删除此供应商
                </button>
                <div className="config-field">
                  <label>显示名（可选）</label>
                  <input
                    type="text"
                    value={prov.name || ''}
                    placeholder={key}
                    data-field="name"
                    onChange={(e) => patchProvider(key, { name: e.target.value || undefined })}
                  />
                </div>
                <div className="config-field">
                  <label>API 地址</label>
                  <input
                    type="text"
                    value={prov.baseUrl || ''}
                    placeholder="https://api.example.com/v1"
                    data-field="baseUrl"
                    onChange={(e) => patchProvider(key, { baseUrl: e.target.value })}
                  />
                </div>
                <div className="config-field">
                  <label>API Key（可选）</label>
                  <input
                    type="text"
                    value={prov.apiKey || ''}
                    placeholder="sk-xxx"
                    data-field="apiKey"
                    onChange={(e) => patchProvider(key, { apiKey: e.target.value })}
                  />
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                    模型列表
                  </div>
                  {(prov.models || []).map((m, i) => (
                    <ModelEntryRow
                      key={`${key}-${i}`}
                      model={m}
                      baseUrl={prov.baseUrl}
                      apiKey={prov.apiKey}
                      onChange={(patch) =>
                        patchProvider(key, {
                          models: (providers[key]?.models || []).map((mm, j) => (j === i ? { ...mm, ...patch } : mm)),
                        })
                      }
                      onDelete={() => deleteModel(key, i, m)}
                    />
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button type="button" className="btn-add-model" onClick={() => addModelDialog(providers[key], (m) => patchProvider(key, { models: [...(providers[key]?.models || []), m] }))}>
                      + 添加模型
                    </button>
                    <button type="button" className="btn-add-model" style={{ borderStyle: 'dashed' }} onClick={() => void fetchModels(key)}>
                      从服务器拉取模型
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px' }}>
        <button type="button" className="btn-add-model" style={{ borderStyle: 'dashed' }} onClick={() => setAddProviderOpen(true)}>
          + 添加供应商
        </button>
        <button type="button" className="settings-btn" onClick={() => void window.tiffaDesktop.restartTiffa()}>
          重启
        </button>
        <AutoSaveHint saving={saving} savedAt={savedAt} extra="点「重启」生效" />
        {status && <span className="config-status saved">{status}</span>}
      </div>
      {addProviderOpen && createPortal(
        <AddProviderModal
          existing={providers}
          onAdd={(key, p) => {
            setCfg((c) => (c ? { ...c, providers: { ...c.providers, [key]: p } } : c));
            setAddProviderOpen(false);
          }}
          onClose={() => setAddProviderOpen(false)}
        />,
        document.body,
      )}
    </div>
  );
}

/** 模型条目行：内联编辑（点击展开） */
/** 从模型真实值构建编辑表单字段（进入编辑时同步，避免脏状态） */
function buildFields(model: ModelEntry) {
  return {
    id: model.id,
    name: model.name || '',
    contextWindow: String(model.contextWindow || 128000),
    maxTokens: String(model.maxTokens || 8192),
    reasoning: !!model.reasoning,
    vision: !!(model.input && model.input.includes('image')),
    qwen38: !!model.qwen38,
  };
}
function ModelEntryRow({ model, onChange, onDelete, baseUrl, apiKey }: { model: ModelEntry; onChange: (patch: Partial<ModelEntry>) => void; onDelete: () => void; baseUrl?: string; apiKey?: string }) {
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const addToast = useUiStore((s) => s.addToast);
  // hooks 必须无条件调用：若放在 if(!editing) 之后，展开时 hooks 数量 1→2，
  // React 报 #310 "Rendered more hooks than during the previous render" → 白屏。
  const [fields, setFields] = useState(() => buildFields(model));

  const checkHealth = async () => {
    if (!baseUrl || !model.id) {
      addToast('warning', '健康检查需要配置 API 地址和模型 ID');
      return;
    }
    setChecking(true);
    try {
      const res = (await window.tiffaDesktop.checkModelHealth({ baseUrl, apiKey: apiKey || '', model: model.id })) as { ok?: boolean; status?: number; detail?: string };
      if (res && res.ok) addToast('success', `健康检查通过（HTTP ${res.status}）`);
      else addToast('error', `健康检查失败${res && res.status ? ` HTTP ${res.status}` : ''}: ${(res && res.detail) || '未知错误'}`);
    } catch (err) {
      addToast('error', `健康检查失败: ${(err as Error).message}`);
    }
    setChecking(false);
  };
  if (!editing) {
    const thinkBadge = model.reasoning ? ' | 思考' : '';
    const visionBadge = model.input && model.input.includes('image') ? ' | 视觉' : '';
    const depthBadge = model.qwen38 ? ' | 3.8深度' : '';
    return (
      <div className="model-entry" onClick={() => { setFields(buildFields(model)); setEditing(true); }}>
        <span className="model-entry-id">{model.id || ''}</span>
        <span className="model-entry-meta">
          {model.name || ''} | {model.contextWindow || '?'}ctx{thinkBadge}
          {visionBadge}
          {depthBadge}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {baseUrl && model.id && (
            <button
              type="button"
              className="model-entry-check"
              disabled={checking}
              onClick={(e) => {
                e.stopPropagation();
                void checkHealth();
              }}
              title="健康检查"
            >
              {checking ? '检查中...' : '检测'}
            </button>
          )}
          <button
            type="button"
            className="model-entry-delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            x
          </button>
        </div>
      </div>
    );
  }
  const inputStyle: React.CSSProperties = { flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12 };
  return (
    <div className="model-entry" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      {[
        { key: 'id', label: 'ID', input: <input style={inputStyle} value={fields.id} onChange={(e) => setFields((f) => ({ ...f, id: e.target.value }))} /> },
        { key: 'name', label: '名称', input: <input style={inputStyle} value={fields.name} onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))} /> },
        { key: 'contextWindow', label: '上下文', input: <input style={inputStyle} type="number" value={fields.contextWindow} onChange={(e) => setFields((f) => ({ ...f, contextWindow: e.target.value }))} /> },
        { key: 'maxTokens', label: '最大输出', input: <input style={inputStyle} type="number" value={fields.maxTokens} onChange={(e) => setFields((f) => ({ ...f, maxTokens: e.target.value }))} /> },
      ].map((row) => (
        <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ width: 60, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{row.label}</label>
          {row.input}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={fields.reasoning} onChange={(e) => setFields((f) => ({ ...f, reasoning: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
          思考模式
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={fields.vision} onChange={(e) => setFields((f) => ({ ...f, vision: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
          视觉
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }} title="标记模型为 Qwen3.8+：on 档发 reasoning_effort 控思考深度，off 档真关思考（落盘 requiresEffort:false 允许关闭）。保存并重启后生效。">
          <input type="checkbox" checked={fields.qwen38} onChange={(e) => setFields((f) => ({ ...f, qwen38: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
          Qwen3.8 深度
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          type="button"
          className="settings-btn"
          style={{ fontSize: 12, padding: '3px 10px', background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}
          onClick={(e) => {
            e.stopPropagation();
            onChange({
              id: fields.id,
              name: fields.name,
              contextWindow: parseInt(fields.contextWindow) || 128000,
              maxTokens: parseInt(fields.maxTokens) || 8192,
              reasoning: fields.reasoning,
              input: fields.vision ? ['text', 'image'] : ['text'],
              qwen38: fields.qwen38,
            });
            setEditing(false);
          }}
        >
          保存
        </button>
        <button type="button" className="settings-btn" style={{ fontSize: 12, padding: '3px 10px' }} onClick={(e) => { e.stopPropagation(); setEditing(false); }}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 添加模型对话框（DOM 方式，复用旧版样式） */
function addModelDialog(prov: TiffaProviderConfig | undefined, onAdd: (m: ModelEntry) => void): void {
  void prov;
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1100;display:flex;align-items:center;justify-content:center;';
  backdrop.innerHTML = `
    <div style="background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:20px;width:320px;">
      <div style="font-size:14px;font-weight:600;margin-bottom:12px;">添加模型</div>
      <label style="font-size:12px;color:var(--text-muted);">模型 ID</label>
      <input id="dlgModelId" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" placeholder="gpt-4o">
      <label style="font-size:12px;color:var(--text-muted);">显示名称</label>
      <input id="dlgModelName" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" placeholder="GPT-4o">
      <label style="font-size:12px;color:var(--text-muted);">上下文长度</label>
      <input id="dlgModelCtx" type="number" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" value="128000">
      <label style="font-size:12px;color:var(--text-muted);">最大输出</label>
      <input id="dlgModelMax" type="number" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" value="8192">
      <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin:4px 0;cursor:pointer;"><input id="dlgModelReasoning" type="checkbox" style="width:16px;height:16px;accent-color:var(--accent);"> 思考模式</label>
      <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin:4px 0;cursor:pointer;"><input id="dlgModelVision" type="checkbox" style="width:16px;height:16px;accent-color:var(--accent);"> 支持视觉（图片输入 / snapcompact 图像压缩）</label>
      <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin:4px 0;cursor:pointer;"><input id="dlgModelQwen38" type="checkbox" style="width:16px;height:16px;accent-color:var(--accent);"> Qwen3.8 深度（思考档位可控）</label>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="dlgCancel" style="padding:6px 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">取消</button>
        <button id="dlgOk" style="padding:6px 16px;border:none;border-radius:4px;background:var(--accent);color:white;cursor:pointer;">添加</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const idInput = backdrop.querySelector('#dlgModelId') as HTMLInputElement;
  setTimeout(() => idInput.focus(), 50);
  const close = () => backdrop.remove();
  backdrop.querySelector('#dlgCancel')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  const submit = () => {
    const id = (backdrop.querySelector('#dlgModelId') as HTMLInputElement).value.trim();
    if (!id) {
      useUiStore.getState().addToast('error', '模型 ID 不能为空');
      return;
    }
    const name = (backdrop.querySelector('#dlgModelName') as HTMLInputElement).value.trim() || id;
    const ctx = parseInt((backdrop.querySelector('#dlgModelCtx') as HTMLInputElement).value) || 128000;
    const max = parseInt((backdrop.querySelector('#dlgModelMax') as HTMLInputElement).value) || 8192;
    const reasoning = (backdrop.querySelector('#dlgModelReasoning') as HTMLInputElement).checked;
    const vision = (backdrop.querySelector('#dlgModelVision') as HTMLInputElement).checked;
    const qwen38 = (backdrop.querySelector('#dlgModelQwen38') as HTMLInputElement).checked;
    onAdd({ id, name, reasoning, qwen38, input: vision ? ['text', 'image'] : ['text'], supportsTools: true, contextWindow: ctx, maxTokens: max, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    close();
  };
  backdrop.querySelector('#dlgOk')?.addEventListener('click', submit);
  backdrop.querySelector('#dlgModelId')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') submit();
  });
}

/**
 * AddProviderModal — 「添加供应商」弹窗（从 dim/oh-my-pi-UI 的 AddModelModal 抄回的预置网格）：
 *   第 1 步：从内置 provider 预设列表选择（自动填充 baseUrl / api 类型，只需填 API Key），或选「自定义」手动填写；
 *   第 2 步：表单确认（可改 ID / 显示名 / baseUrl / api / Key），点击「添加」并入 models.yml 内存配置。
 *   样式复用 styles.css 中已有的 .add-model-* / .preset-*（当年 CSS 已抄、组件在重构时丢了，这里补回）。
 */
function AddProviderModal({
  existing,
  onAdd,
  onClose,
}: {
  existing: Record<string, TiffaProviderConfig>;
  onAdd: (key: string, p: TiffaProviderConfig) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ProviderPreset | 'custom' | null>(null);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState('openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PRESET_GROUPS;
    return PRESET_GROUPS
      .map((g) => ({ ...g, items: g.items.filter((p) => `${p.id} ${p.name}`.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [search]);

  const selectPreset = (p: ProviderPreset) => {
    setSelected(p);
    setKey(p.id);
    setName(p.name);
    setBaseUrl(p.baseUrl);
    setApi(p.api);
    setApiKey('');
    setError('');
    setStep(2);
  };
  const selectCustom = () => {
    setSelected('custom');
    setKey('');
    setName('');
    setBaseUrl('');
    setApi('openai-completions');
    setApiKey('');
    setError('');
    setStep(2);
  };
  const goBack = useCallback(() => {
    setSelected(null);
    setStep(1);
  }, []);

  const keyValid = /^[a-zA-Z0-9_-]+$/.test(key);
  const isDup = !!key.trim() && !!existing[key.trim()];
  const canSave = keyValid && !isDup && baseUrl.trim().length > 0;

  const submit = () => {
    const k = key.trim();
    if (!k) {
      setError('供应商名称不能为空');
      return;
    }
    if (existing[k]) {
      setError(`供应商 "${k}" 已存在`);
      return;
    }
    if (!baseUrl.trim()) {
      setError('API 地址不能为空');
      return;
    }
    onAdd(k, { baseUrl: baseUrl.trim(), api, apiKey: apiKey.trim() || undefined, name: name.trim() || undefined, models: [] });
    onClose();
  };

  const openAuth = useCallback((url: string) => {
    if (url && window.tiffaDesktop?.openExternal) void window.tiffaDesktop.openExternal(url);
  }, []);

  const preset = selected !== 'custom' && selected !== null ? (selected as ProviderPreset) : null;

  return createPortal(
    <div className="add-model-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="add-model-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-model-head">
          <span className="modal-title">添加供应商</span>
          <span className="add-model-subtitle">
            {step === 1
              ? '选择已知提供商或自定义'
              : preset
                ? `配置「${preset.name}」`
                : '自定义提供商（手动填写所有字段）'}
          </span>
          <button type="button" className="settings-close" onClick={onClose}>✕</button>
        </div>

        {step === 1 && (
          <div className="add-model-form">
            <div className="preset-search">
              <input
                className="form-input"
                placeholder="🔍 搜索提供商（如 deepseek、kimi、ollama）…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="preset-grid">
              {filteredGroups.map((g) => (
                <div key={g.cat} className="preset-group">
                  <div className="preset-group-label">{g.label}</div>
                  <div className="preset-items">
                    {g.items.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`preset-card ${p.cat}`}
                        onClick={() => selectPreset(p)}
                        title={`${p.name}\n${p.baseUrl}\nAPI: ${p.api}${p.authUrl ? '\n点击前往获取 API Key' : ''}`}
                      >
                        <span className="preset-name">{p.name}</span>
                        <span className="preset-id">{p.id}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {filteredGroups.every((g) => g.items.length === 0) && (
              <div className="settings-placeholder">没有匹配的提供商</div>
            )}
            <div className="preset-custom-divider">
              <span>或</span>
            </div>
            <button type="button" className="btn btn-block preset-custom-btn" onClick={selectCustom}>
              + 自定义提供商（手动填写所有字段）
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="add-model-form">
            {preset && (
              <div className="preset-selected-bar">
                <span className="preset-selected-name">{preset.name}</span>
                <span className="preset-selected-id">ID: {preset.id}</span>
                {preset.authUrl && (
                  <button type="button" className="btn btn-sm btn-link preset-auth-btn" onClick={() => openAuth(preset.authUrl!)}>
                    🔑 获取 API Key
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-link preset-change-btn" onClick={goBack}>
                  ← 换一个
                </button>
              </div>
            )}
            {selected === 'custom' && (
              <div className="preset-selected-bar">
                <span className="preset-selected-name">自定义提供商</span>
                <button type="button" className="btn btn-sm btn-link preset-change-btn" onClick={goBack}>
                  ← 从预设选择
                </button>
              </div>
            )}

            <label className="form-field">
              <span className="form-label">供应商 ID *</span>
              <input
                className="form-input"
                placeholder="如 deepseek（字母/数字/-/_）"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={selected !== 'custom'}
              />
              {key && !keyValid && <span className="form-error">只允许字母、数字、- 和 _</span>}
              {isDup && <span className="form-error">供应商 &quot;{key}&quot; 已存在</span>}
            </label>

            <label className="form-field">
              <span className="form-label">显示名</span>
              <input
                className="form-input"
                placeholder="如 深度求索 / DeepSeek（可选）"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span className="form-label">API 地址 (baseUrl) *</span>
              <input
                className="form-input"
                placeholder="如 https://api.deepseek.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span className="form-label">API 类型</span>
              <select className="form-input" value={api} onChange={(e) => setApi(e.target.value)}>
                <option value="openai-completions">OpenAI 兼容 (openai-completions)</option>
                <option value="openai-responses">OpenAI Responses API (openai-responses)</option>
                <option value="openai-codex-responses">OpenAI Codex Responses (openai-codex-responses)</option>
                <option value="anthropic-messages">Anthropic Claude (anthropic-messages)</option>
                <option value="google-generative-ai">Google Gemini (google-generative-ai)</option>
                <option value="google-gemini-cli">Google Gemini CLI (google-gemini-cli)</option>
                <option value="google-vertex">Google Vertex (google-vertex)</option>
                <option value="azure-openai-responses">Azure OpenAI (azure-openai-responses)</option>
                <option value="bedrock-converse-stream">AWS Bedrock (bedrock-converse-stream)</option>
              </select>
            </label>

            <label className="form-field">
              <span className="form-label">API Key（可选）</span>
              <div className="form-input-group">
                <input
                  className="form-input"
                  type={showKey ? 'text' : 'password'}
                  placeholder={preset ? `输入 ${preset.name} API Key（明文存于 models.yml）` : '输入 API Key（明文存于 models.yml）'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button type="button" className="btn btn-sm form-eye" onClick={() => setShowKey((v) => !v)} title={showKey ? '隐藏' : '显示'}>
                  {showKey ? '🙈' : '👁'}
                </button>
              </div>
              {preset && preset.hint && <span className="form-hint">格式提示：{preset.hint}</span>}
            </label>

            {error && <div className="model-config-error">{error}</div>}

            <div className="add-model-actions">
              <button type="button" className="btn" onClick={goBack}>返回</button>
              <button type="button" className="btn" onClick={onClose}>取消</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={!canSave}>
                添加
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── 旁路模型节 ──

function BypassModelSection({ kind }: { kind: 'bypass' | 'grounding' }) {
  const addToast = useUiStore((s) => s.addToast);
  const [form, setForm] = useState({ baseUrl: '', apiKey: '', model: '', enabled: true });
  const [checked, setChecked] = useState(false);
  // 上次落盘内容，用于跳过无变化的自动保存
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const cfg = kind === 'bypass' ? await window.tiffaDesktop.getBypassModel() : await window.tiffaDesktop.getGroundingModel();
        const c = cfg as { baseUrl?: string; api_base?: string; apiKey?: string; api_key?: string; model?: string; enabled?: unknown; error?: string } | undefined;
        if (!c || c.error) return;
        const next = {
          baseUrl: c.baseUrl || c.api_base || '',
          apiKey: c.apiKey || c.api_key || '',
          model: c.model || '',
          enabled: kind === 'grounding' ? String(c.enabled) === '1' || c.enabled === true : c.enabled !== false,
        };
        setForm(next);
        lastSaved.current = JSON.stringify({ ...next, kind });
      } catch {
        /* ignore */
      }
    };
    void load();
  }, [kind]);

  // 自动保存：Base URL 与 Model ID 都填了才写，避免录到一半落盘半成品
  const persist = useCallback(async () => {
    const key = JSON.stringify({ ...form, kind });
    if (key === lastSaved.current) return;
    const cfg = kind === 'bypass' ? { baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model, enabled: form.enabled } : { api_base: form.baseUrl, api_key: form.apiKey, model: form.model, enabled: form.enabled };
    const res = (kind === 'bypass' ? await window.tiffaDesktop.saveBypassModel(cfg) : await window.tiffaDesktop.saveGroundingModel(cfg)) as { success?: boolean; error?: string };
    if (res && res.success) {
      lastSaved.current = key;
    } else {
      addToast('error', `保存失败: ${(res && res.error) || '未知错误'}`);
    }
  }, [kind, form, addToast]);

  const { saving, savedAt } = useAutoSave(persist, [form], {
    delay: 1000,
    enabled: !!form.baseUrl.trim() && !!form.model.trim(),
  });

  const checkHealth = async () => {
    if (!form.baseUrl || !form.model) {
      addToast('warning', '健康检查需填写 Base URL 与 Model ID');
      return;
    }
    setChecked(true);
    try {
      const res = (await window.tiffaDesktop.checkModelHealth({ baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model })) as { ok?: boolean; status?: number; detail?: string };
      if (res && res.ok) addToast('success', `健康检查通过（HTTP ${res.status}）`);
      else addToast('error', `健康检查失败${res && res.status ? ` HTTP ${res.status}` : ''}: ${(res && res.detail) || '未知错误'}`);
    } catch (err) {
      addToast('error', `健康检查失败: ${(err as Error).message}`);
    }
    setChecked(false);
  };

  const label = kind === 'bypass' ? '旁路模型' : 'MCP 模型';
  return (
    <div className="settings-section">
      <div className="settings-section-title">{label}</div>
      <div className="settings-section-desc">
        {kind === 'bypass'
          ? '用于 AI 会话重命名、上下文压缩总结与轻量补全的独立模型。建议配置便宜快速的模型，让总结等后台任务不占用主模型。改动自动保存、即时生效'
          : 'computer-use grounding：ui_tars 视觉定位点击。修改后需重启 Tiffa 生效'}
      </div>
      <div className="bypass-model-form">
        <div className="bypass-field">
          <label>Base URL</label>
          <input type="text" value={form.baseUrl} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
        </div>
        <div className="bypass-field">
          <label>API Key</label>
          <input type="text" value={form.apiKey} placeholder="sk-xxx" autoComplete="off" spellCheck={false} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
        </div>
        <div className="bypass-field">
          <label>Model ID</label>
          <input type="text" value={form.model} placeholder="gpt-4o-mini" autoComplete="off" spellCheck={false} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
        </div>
        <div className="bypass-toggle-row">
          <label className="model-toggle">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
            <span className="model-toggle-slider" />
          </label>
          <span className="model-toggle-label">{form.enabled ? '已启用' : '未启用'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button type="button" className="settings-btn" disabled={checked} onClick={() => void checkHealth()}>
            {checked ? '检查中...' : '健康检查'}
          </button>
          <AutoSaveHint saving={saving} savedAt={savedAt} extra={kind === 'grounding' ? '重启后生效' : '即时生效'} />
        </div>
      </div>
    </div>
  );
}

// ── 当前模型列表节 ──

function ModelListSection() {
  const addToast = useUiStore((s) => s.addToast);
  const currentModel = useUiStore((s) => s.currentModel);
  const [models, setModels] = useState<Array<{ id: string; name?: string; provider?: string }> | null>(null);
  const [filter, setFilter] = useState('all');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  const loadHidden = useCallback(async () => {
    try {
      const root = (await window.tiffaDesktop.getRootPath()) as string;
      const r = (await window.tiffaDesktop.readFile(`${root}\\data\\agent\\hidden-models.json`)) as { content?: string } | undefined;
      if (r && r.content) {
        const arr = JSON.parse(r.content);
        if (Array.isArray(arr)) setHidden(new Set(arr));
      }
    } catch {
      setHidden(new Set());
    }
  }, []);

  const load = useCallback(async () => {
    // 引擎未就绪（含崩溃后停止重启）时不调 getModels：主进程 handler 无实例会 throw
    if (!useProcStore.getState().tiffaReady) {
      setModels([]);
      return;
    }
    try {
      const result = await window.tiffaDesktop.getModels(useSessionsStore.getState().activeSessionId);
      setModels((result && result.models) || []);
    } catch {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    void loadHidden();
    void load();
  }, [loadHidden, load]);

  const saveHidden = async (next: Set<string>) => {
    setHidden(next);
    try {
      const root = (await window.tiffaDesktop.getRootPath()) as string;
      await window.tiffaDesktop.writeFile(`${root}\\data\\agent\\hidden-models.json`, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  if (!models) return <div className="model-item loading">加载模型列表...</div>;
  if (!useProcStore.getState().tiffaReady && models.length === 0) {
    return (
      <div className="settings-section">
        <div className="settings-section-title">当前模型</div>
        <div className="settings-section-desc">点击切换模型（顶栏模型名也可点击切换）</div>
        <div className="model-item empty">引擎未就绪（可能已连续崩溃停止重启），就绪后自动加载模型列表</div>
      </div>
    );
  }
  const providers = [...new Set(models.map((m) => m.provider).filter((p): p is string => !!p))];
  const filtered = (filter === 'all' ? models : models.filter((m) => m.provider === filter)).filter((m) => !hidden.has(m.id));
  const hiddenCount = (filter === 'all' ? models : models.filter((m) => m.provider === filter)).filter((m) => hidden.has(m.id)).length;
  const displayed = showHidden ? (filter === 'all' ? models : models.filter((m) => m.provider === filter)) : filtered;

  return (
    <div className="settings-section">
      <div className="settings-section-title">当前模型</div>
      <div className="settings-section-desc">点击切换模型（顶栏模型名也可点击切换）</div>
      <div id="modelProviderFilter" className="model-provider-filter">
        <button type="button" className={`provider-filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          全部
        </button>
        {providers.map((p) => (
          <button key={p} type="button" className={`provider-filter-btn${filter === p ? ' active' : ''}`} onClick={() => setFilter(p)}>
            {p}
          </button>
        ))}
      </div>
      <div id="modelList" className="model-list">
        {displayed.length === 0 && hiddenCount === 0 && <div className="model-item empty">无匹配模型</div>}
        {displayed.map((m) => {
          const isCurrent = currentModel === m.id || currentModel === m.name;
          const isHidden = hidden.has(m.id);
          return (
            <div
              key={`${m.provider || ''}/${m.id}`}
              className={`model-item${isCurrent ? ' active' : ''}${isHidden ? ' dimmed' : ''}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.model-toggle')) return;
                void switchModel(m.provider || '', m.id);
              }}
            >
              <div className="model-item-info">
                <span className="model-item-name">{m.name || m.id}</span>
                <span className="model-item-provider">{m.provider || ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label className="model-toggle" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={(e) => {
                      e.stopPropagation();
                      const next = new Set(hidden);
                      if (e.target.checked) next.delete(m.id);
                      else next.add(m.id);
                      void saveHidden(next);
                    }}
                  />
                  <span className="model-toggle-slider" />
                </label>
                {isCurrent && <span className="model-item-check">当前</span>}
              </div>
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div className="model-item model-hidden-hint" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? '收起已隐藏模型' : `${hiddenCount} 个模型已隐藏，点击展开`}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主题节 ──

interface ThemePreset {
  id: string;
  name: string;
  description?: string;
  dark: { background: { bg100: string } };
  light: { background: { bg100: string } };
}

function ThemeSection() {
  const [, force] = useState(0);
  const presets: ThemePreset[] = ((window as unknown as { THEME_PRESETS?: ThemePreset[] }).THEME_PRESETS) || [];
  const getCurrentTheme = () => (window as unknown as { getCurrentTheme?: () => { presetId: string; mode: string } }).getCurrentTheme?.() || { presetId: '', mode: 'system' };
  const current = getCurrentTheme();

  const modes = [
    { id: 'light', label: '亮色', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' },
    { id: 'dark', label: '暗色', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' },
    { id: 'system', label: '跟随系统', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
  ];

  return (
    <div className="settings-section">
      <div className="settings-section-title">主题风格</div>
      <div className="settings-section-desc">选择配色风格</div>
      <div id="themePresetList" className="theme-preset-list">
        {presets.map((p) => (
          <div
            key={p.id}
            className={`theme-preset-card${p.id === current.presetId ? ' active' : ''}`}
            data-preset-id={p.id}
            onClick={() => {
              (window as unknown as { setThemePreset?: (id: string) => void }).setThemePreset?.(p.id);
              force((x) => x + 1);
            }}
          >
            <div className="theme-preset-swatch">
              <div className="theme-swatch-dark" style={{ background: `hsl(${p.dark.background.bg100})` }} />
              <div className="theme-swatch-light" style={{ background: `hsl(${p.light.background.bg100})` }} />
            </div>
            <div className="theme-preset-info">
              <div className="theme-preset-name">{p.name}</div>
              <div className="theme-preset-desc">{p.description}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="theme-mode-label">日夜模式</div>
      <div id="themeModeSelector" className="theme-mode-selector">
        {modes.map((m) => (
          <button
            type="button"
            key={m.id}
            className={`theme-mode-btn${m.id === current.mode ? ' active' : ''}`}
            data-mode={m.id}
            onClick={() => {
              const win = window as unknown as {
                setThemeMode?: (mode: string) => void;
                resolveMode?: (mode: string) => string;
                updateThemeIcons?: (mode: string) => void;
                updateHljsTheme?: (mode: string) => void;
              };
              win.setThemeMode?.(m.id);
              const resolved = win.resolveMode ? win.resolveMode(m.id) : m.id;
              // 同步 hljs 双主题（等价旧版 updateHljsTheme）
              const dark = document.getElementById('hljs-dark') as HTMLLinkElement | null;
              const light = document.getElementById('hljs-light') as HTMLLinkElement | null;
              if (dark) dark.disabled = resolved !== 'dark';
              if (light) light.disabled = resolved !== 'light';
              force((x) => x + 1);
            }}
            dangerouslySetInnerHTML={{ __html: `${m.icon}<span>${m.label}</span>` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── 其他小节 ──

function ComputerUseSection() {
  const addToast = useUiStore((s) => s.addToast);
  const [enabled, setEnabled] = useState(false);
  const [hotkey, setHotkey] = useState('');
  const lastHotkey = useRef<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = (await window.tiffaDesktop.getComputerUseStatus()) as { enabled?: boolean };
        setEnabled(!!(r && r.enabled));
      } catch {
        /* ignore */
      }
    };
    void load();
  }, []);

  // ── v4：加载并渲染每应用策略列表 ──
  const loadPolicyList = async () => {
    try {
      const cur = (await window.tiffaDesktop.getComputerUsePolicies()) as any;
      const apps = (cur && cur.apps) || {};
      const el = document.getElementById('policyList');
      if (!el) return;
      const entries = Object.entries(apps).map(([k, v]) => `${k} = ${v}`).join('；') || '（无，默认 ask）';
      el.textContent = `当前策略：${entries}`;
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    void loadPolicyList();
    const loadHotkey = async () => {
      try {
        const cfg = (await window.tiffaDesktop.getWindowSnapshotHotkey()) as any;
        if (cfg && cfg.hotkey) {
          setHotkey(cfg.hotkey);
          lastHotkey.current = cfg.hotkey;
        }
      } catch {
        /* ignore */
      }
    };
    void loadHotkey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 快照热键自动保存（去抖 1s，停止输入后写入并重新注册全局热键）
  const persistHotkey = useCallback(async () => {
    const v = hotkey.trim();
    if (!v || v === lastHotkey.current) return;
    lastHotkey.current = v;
    await window.tiffaDesktop.setWindowSnapshotHotkey({ enabled: true, hotkey: v });
    await window.tiffaDesktop.reloadWindowSnapshotHotkey();
  }, [hotkey]);

  const { saving: hkSaving, savedAt: hkSavedAt } = useAutoSave(persistHotkey, [hotkey], { delay: 1000 });

  return (
    <div className="settings-section">
      <div className="settings-section-title">Computer Use（电脑控制）</div>
      <div className="settings-section-desc">开启后启动时拉起电脑控制 MCP（含 UIA 依赖，开机较慢）；关闭则开机更快。修改后需重启 Tiffa 生效</div>
      <label className="model-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            const v = e.target.checked;
            setEnabled(v);
            try {
              await window.tiffaDesktop.toggleComputerUse(v);
            } catch {
              /* ignore */
            }
            addToast('info', v ? '已开启（重启 Tiffa 后生效）' : '已关闭');
          }}
        />
        <span className="model-toggle-slider" />
        <span className="model-toggle-label">{enabled ? '已开启（重启 Tiffa 后生效）' : '已关闭'}</span>
      </label>
      {/* ── v4：每应用执行策略 ── */}
      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
        每应用执行策略（ask=逐步确认 / auto-run=跳过确认 / disabled=禁止操作）
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          id="policyAppName"
          placeholder="应用名关键词（如 微信 / Excel）"
          style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        />
        <select
          id="policyAppMode"
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        >
          <option value="auto-run">auto-run</option>
          <option value="disabled">disabled</option>
        </select>
        <button
          type="button"
          className="settings-btn"
          onClick={async () => {
            const name = (document.getElementById('policyAppName') as HTMLInputElement).value.trim();
            const mode = (document.getElementById('policyAppMode') as HTMLSelectElement).value;
            if (!name) return;
            const cur = (await window.tiffaDesktop.getComputerUsePolicies()) as any;
            const next = { ...cur, apps: { ...(cur.apps || {}), [name]: mode } };
            await window.tiffaDesktop.setComputerUsePolicies(next);
            addToast('success', `策略已保存：${name} = ${mode}（即时生效）`);
            (document.getElementById('policyAppName') as HTMLInputElement).value = '';
            loadPolicyList();
          }}
        >
          添加策略
        </button>
      </div>
      <div id="policyList" style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
        {/* 由下方 useEffect 渲染当前策略列表 */}
      </div>
      {/* ── v4：窗口快照热键 ── */}
      <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)' }}>
        窗口快照热键（默认 Ctrl+Alt+K，按热键把当前活动窗口截图注入对话）
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
        <input
          id="snapshotHotkeyInput"
          placeholder="Ctrl+Alt+K"
          value={hotkey}
          onChange={(e) => setHotkey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        />
        <AutoSaveHint saving={hkSaving} savedAt={hkSavedAt} />
      </div>
    </div>
  );
}
function PlaywrightSection() {
  const addToast = useUiStore((s) => s.addToast);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const r = (await window.tiffaDesktop.getPlaywrightStatus()) as { enabled?: boolean };
        setEnabled(!!(r && r.enabled));
      } catch {
        /* ignore */
      }
    };
    void load();
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-title">Playwright（浏览器自动化 MCP）</div>
      <div className="settings-section-desc">开启后每个对话实例启动时都会拉起 playwright MCP 进程（含 playwright-core 加载，新对话准备更慢）；关闭则新对话启动更快。修改后需重启 Tiffa 生效</div>
      <label className="model-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            const v = e.target.checked;
            setEnabled(v);
            try {
              await window.tiffaDesktop.togglePlaywright(v);
            } catch {
              /* ignore */
            }
            addToast('info', v ? '已开启（重启 Tiffa 后生效）' : '已关闭（重启 Tiffa 后生效）');
          }}
        />
        <span className="model-toggle-slider" />
        <span className="model-toggle-label">{enabled ? '已开启（重启 Tiffa 后生效）' : '已关闭'}</span>
      </label>
    </div>
  );
}

function ConstraintsSection() {
  const [preview, setPreview] = useState('加载中...');
  useEffect(() => {
    const load = async () => {
      try {
        const root = (await window.tiffaDesktop.getRootPath()) as string;
        const r = (await window.tiffaDesktop.readFile(`${root}\\data\\memory\\constraints-inject.md`)) as { content?: string } | undefined;
        if (r && r.content) {
          const lines = r.content.split('\n').filter((l) => l.trim());
          setPreview(`<pre class="constraints-text">${escapeHtml(lines.slice(0, 15).join('\n'))}${lines.length > 15 ? '\n...' : ''}</pre>`);
        } else setPreview('暂无约束规则');
      } catch {
        setPreview('无法读取约束文件');
      }
    };
    void load();
  }, []);
  return (
    <div className="settings-section">
      <div className="settings-section-title">约束规则</div>
      <div className="settings-section-desc">编辑 constraints-inject.md 管理弱模型输出约束</div>
      <div className="constraints-preview" dangerouslySetInnerHTML={{ __html: preview }} />
      <button
        type="button"
        className="settings-btn"
        onClick={async () => {
          const root = (await window.tiffaDesktop.getRootPath()) as string;
          void window.tiffaDesktop.openPath(`${root}\\data\\memory\\constraints-inject.md`);
        }}
      >
        用记事本打开约束文件
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 目标模式（内核 goal mode）
// ═══════════════════════════════════════════════════════════
// 内核 18.0.6 的 goal 模式入口只在 TUI（`/goal` 只挂 handleTui）；rpc-ui 下没有 goal 的 RPC 命令，
// 外挂也拿不到 session/goalRuntime 句柄。唯一可用入口是内置斜杠命令 `/force goal <prompt>`：
// 它强制下一轮调用 goal 工具（provider 需支持命名 tool_choice），模型不支持时退回「普通消息 + 外挂注入指令」。
// 另注：`goal.continuationModes` 默认只含 interactive 且只在 TUI 被读 → rpc-ui 下**不会自动续跑**，
// 目标模式在 Tiffa 里的价值是「目标不漂移 + 预算计量 + 完成前审计」，不是「自己一直跑」。
const GOAL_STATUS_LABEL: Record<string, string> = {
  active: '进行中',
  paused: '已暂停',
  'budget-limited': '预算已耗尽',
  complete: '已完成',
  dropped: '已放弃',
};

function GoalModeSection() {
  const addToast = useUiStore((s) => s.addToast);
  const goalState = useUiStore((s) => s.goalState);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState('');
  // 磁盘上已有的目标状态（goal-state.<sessionId>.json）。实时事件只在会话活着时才有，
  // 重启 Tiffa / 切到别的对话再切回来时只能靠它 —— 否则已有目标显示成「无目标」且收尾按钮全灰。
  const [fileState, setFileState] = useState<GoalLiveState | null>(null);

  // 打开面板时回读主进程的开关状态与已有目标（goal-mode.json / goal-state.<sessionId>.json 可能来自上次会话）
  useEffect(() => {
    const load = async () => {
      try {
        const r = (await window.tiffaDesktop.goalStatus(activeSessionId ?? null)) as
          | {
              arm?: { enabled?: boolean; objective?: string; tokenBudget?: number | null };
              state?: {
                enabled?: boolean;
                status?: string;
                objective?: string;
                tokensUsed?: number;
                tokenBudget?: number | null;
              } | null;
            }
          | undefined;
        if (r?.arm?.enabled && r.arm.objective) {
          setObjective((prev) => (prev ? prev : String(r.arm!.objective)));
          if (r.arm.tokenBudget) setBudget(String(r.arm.tokenBudget));
        }
        const st = r?.state;
        setFileState(
          st && st.objective
            ? {
                sessionId: String(activeSessionId ?? ''),
                enabled: st.enabled === true,
                status: String(st.status || ''),
                objective: String(st.objective),
                tokensUsed: Number(st.tokensUsed || 0),
                tokenBudget: typeof st.tokenBudget === 'number' ? st.tokenBudget : null,
              }
            : null,
        );
      } catch {
        /* 读不到就按空处理 */
      }
    };
    void load();
  }, [activeSessionId]);

  // 实时事件优先（最新），但它**不会在切对话时清空** → 必须比对 sessionId，
  // 否则切到没有目标的对话会继续显示上一个对话的目标（并在收尾时误发指令给错的会话）。
  const liveGoal =
    goalState && goalState.objective && (!activeSessionId || !goalState.sessionId || goalState.sessionId === activeSessionId)
      ? goalState
      : null;
  const live = liveGoal ?? fileState;

  // 发出「开始目标」后等 goal_updated 回来；20s 没等到就提示可能没生效（软路径/模型不配合）
  useEffect(() => {
    if (!pending) return;
    if (live?.enabled) {
      setPending(false);
      setNote('');
      return;
    }
    const t = setTimeout(() => {
      setPending(false);
      setNote('已发送，但没等到内核返回目标状态：可能是模型没调用 goal 工具（弱模型/不支持强制工具调用）。可再点一次「开始目标」，或直接在对话里说「创建目标」。');
    }, 20000);
    return () => clearTimeout(t);
  }, [pending, live?.enabled]);

  const start = async () => {
    const text = objective.trim();
    if (!text) {
      addToast('warning', '请先写目标描述');
      return;
    }
    const b = budget.trim() ? Number(budget.trim()) : null;
    if (b !== null && (!Number.isFinite(b) || b <= 0)) {
      addToast('warning', 'token 预算必须是正整数（留空 = 不限）');
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const r = (await window.tiffaDesktop.goalStart(text, b, activeSessionId ?? null)) as
        | { ok?: boolean; error?: string; forced?: boolean }
        | undefined;
      if (!r?.ok) {
        setNote(r?.error || '启动失败');
        addToast('error', r?.error || '目标模式启动失败');
        return;
      }
      setPending(true);
      // 清掉上一轮目标的快照（磁盘 + 实时）：否则「等待模型创建…」会被旧目标的状态盖住，
      // 用户以为新目标没生效（实际只是还在等内核回 goal_updated）。下一次 goal_updated 会重新填上。
      setFileState(null);
      useUiStore.getState().setGoalState(null);
      setNote(r.forced ? '已通过 /force 强制模型创建目标…' : '当前模型不支持强制工具调用，已改用提示方式，等模型自己创建目标…');
    } catch (err) {
      setNote(String((err as Error)?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (op: 'complete' | 'drop') => {
    setBusy(true);
    setNote('');
    try {
      const r = (await window.tiffaDesktop.goalStop(op, activeSessionId ?? null)) as
        | { ok?: boolean; error?: string }
        | undefined;
      if (!r?.ok) {
        setNote(r?.error || '操作失败');
        addToast('error', r?.error || '目标收尾失败');
        return;
      }
      addToast('info', op === 'drop' ? '已请求放弃目标' : '已请求结束目标');
    } catch (err) {
      setNote(String((err as Error)?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">目标模式（Goal Mode）</div>
      <div className="settings-section-desc">
        给当前会话设一个**持久目标**：内核会把它作为目标模式（goal mode）跟踪，目标上下文每轮注入，
        并要求模型在逐项核对真实状态后才允许标记完成。目标按会话隔离，不跨对话生效。
      </div>
      <div className="settings-section-desc" style={{ marginTop: 4 }}>
        更省事的用法：点输入框旁的<b>靶心按钮</b>打开目标模式再发需求 —— 模型会<b>先只转写</b>成带验收标准和步骤的方案
        （这一轮它只读代码、不动手），你在输入区上方的卡片里改完点「开始执行」才真正开工。
      </div>

      <div
        style={{
          margin: '10px 0',
          padding: '8px 10px',
          borderRadius: 6,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 600 }}>
          当前状态：
          {live
            ? GOAL_STATUS_LABEL[live.status] || live.status || '未知'
            : pending
              ? '等待模型创建…'
              : '无目标'}
        </div>
        {live && (
          <>
            <div style={{ marginTop: 4, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {live.objective}
            </div>
            <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 12 }}>
              已用 {live.tokensUsed} tokens
              {typeof live.tokenBudget === 'number' ? ` / 预算 ${live.tokenBudget}` : '（未设预算）'}
            </div>
          </>
        )}
      </div>

      <div className="form-field">
        <div className="form-label">目标描述（会作为目标原文，模型不得改写）</div>
        <textarea
          className="form-input"
          rows={4}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="例：把 README 的中英文版本改到与当前代码一致，并附架构图检查报告"
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>

      <div className="form-field">
        <div className="form-label">token 预算（可选，留空 = 不限）</div>
        <input
          className="form-input"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="例：200000"
          style={{ width: 180 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="settings-btn" disabled={busy} onClick={start}>
          {live?.enabled ? '更新目标' : '开始目标'}
        </button>
        <button type="button" className="settings-btn" disabled={busy || !live?.enabled} onClick={() => stop('complete')}>
          结束目标
        </button>
        <button type="button" className="settings-btn" disabled={busy || !live?.enabled} onClick={() => stop('drop')}>
          放弃目标
        </button>
      </div>

      {note && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{note}</div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        说明：
        <br />· 入口走内核内置命令 <code>/force goal</code>（强制下一轮调用 goal 工具）；provider 不支持命名
        tool_choice 时自动退化为提示方式，成功率取决于模型。
        <br />· 内核的 <code>goal.continuationModes</code> 默认只含 <code>interactive</code>，且该设置只在 TUI 被读取
        —— 所以 Tiffa（rpc-ui）下**不会自动续跑**：目标模式的作用是「目标不漂移 + 预算计量 + 完成前审计」。
        <br />· 运行态记在 <code>data/agent/goal-state.json</code>，开关记在 <code>data/agent/goal-mode.json</code>（均随会话隔离）。
      </div>
    </div>
  );
}

function SchedulerSection() {
  const addToast = useUiStore((s) => s.addToast);
  const [tasks, setTasks] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'cron' | 'every'>('cron');
  const [models, setModels] = useState<Array<{ id: string; name?: string; provider?: string }>>([]);
  const [form, setForm] = useState({
    id: '',
    name: '',
    schedule: '0 9 * * *',
    prompt: '',
    approval: 'auto',
    cwd: '',
    // 模型选择：空串 = 跟随默认模型；否则为 `${provider}::${modelId}` 编码
    modelKey: '',
    catchUp: false,
    // 目标模式：定时以目标模式开跑（objective 写「做完了是什么样子」）
    goalOn: false,
    goalObjective: '',
    goalBudget: '',
  });

  useEffect(() => {
    void (async () => {
      try {
        const list = await getModelListCached();
        setModels((list || []).map((m) => ({ id: m.id, name: m.name, provider: m.provider })));
      } catch {
        setModels([]);
      }
    })();
  }, []);

  const refresh = async () => {
    try {
      const r: any = await (window.tiffaDesktop as any).schedulerList();
      setTasks(r?.tasks || []);
      setErrors(r?.errors || []);
    } catch (e: any) {
      addToast?.('error', `定时任务读取失败：${e?.message || e}`);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    if (!form.id.trim() || !form.prompt.trim()) {
      addToast?.('error', 'id 与 prompt 必填');
      return;
    }
    setBusy(true);
    try {
      const picked = form.modelKey ? models.find((m) => `${m.provider || ''}::${m.id}` === form.modelKey) : null;
      // 模型已从列表消失（被删/引擎未启动）时按编码拆分保留原值，避免保存时把模型静默清空
      const [encProvider, encModel] = form.modelKey ? form.modelKey.split('::') : ['', ''];
    if (form.goalOn && !form.goalObjective.trim()) {
      addToast?.('error', '勾选了目标模式就必须填目标（写清「做完了是什么样子」）');
      return;
    }
    const goalBudgetNum = Number(form.goalBudget);
    const payload: any = {
      id: form.id.trim(),
      name: form.name.trim() || undefined,
      [kind]: form.schedule.trim(),
      prompt: form.prompt,
      approval: form.approval,
      cwd: form.cwd.trim() || undefined,
      model: picked ? picked.id : encModel || undefined,
      provider: picked ? (picked.provider || undefined) : encProvider || undefined,
      catchUp: form.catchUp,
      enabled: true,
      // 目标模式：到点先武装目标再投递 prompt（无人值守时的「不跑偏 + 预算上限」保障）
      goal: form.goalOn
        ? {
            objective: form.goalObjective.trim(),
            tokenBudget: Number.isFinite(goalBudgetNum) && goalBudgetNum > 0 ? Math.floor(goalBudgetNum) : null,
          }
        : undefined,
    };
      const r: any = await (window.tiffaDesktop as any).schedulerSave(payload);
      if (r?.error) addToast?.('error', r.error);
      else {
        addToast?.('success', `已保存任务 ${form.id}`);
        setForm({ id: '', name: '', schedule: kind === 'cron' ? '0 9 * * *' : '2h', prompt: '', approval: 'auto', cwd: '', modelKey: '', catchUp: false, goalOn: false, goalObjective: '', goalBudget: '' });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const r: any = await (window.tiffaDesktop as any).schedulerRemove(id);
    if (r?.error) addToast?.('error', r.error);
    else addToast?.('info', `已删除任务 ${id}`);
    await refresh();
  };

  const toggle = async (t: any) => {
    const r: any = await (window.tiffaDesktop as any).schedulerSave({ ...t, enabled: !(t.enabled !== false) });
    if (r?.error) addToast?.('error', r.error);
    await refresh();
  };

  const runNow = async (id: string) => {
    addToast?.('info', `正在触发 ${id} ...`);
    const r: any = await (window.tiffaDesktop as any).schedulerRunNow(id);
    if (r?.error) addToast?.('error', `触发失败：${r.error}`);
    else addToast?.('success', `${id} 已投递到任务会话`);
    await refresh();
  };

  const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleString() : '—');

  /** 把已有任务回填到表单（含模型），改完点「保存任务」即按同 id 覆盖 */
  const edit = (t: any) => {
    setKind(t.cron ? 'cron' : 'every');
    setForm({
      id: t.id,
      name: t.name || '',
      schedule: String(t.cron || t.every || ''),
      prompt: t.prompt || '',
      approval: t.approval || 'auto',
      cwd: t.cwd || '',
      modelKey: t.model ? `${t.provider || ''}::${t.model}` : '',
      catchUp: !!t.catchUp,
      goalOn: !!t.goal,
      goalObjective: String(t.goal?.objective || ''),
      goalBudget: t.goal?.tokenBudget ? String(t.goal.tokenBudget) : '',
    });
    addToast?.('info', `已载入任务 ${t.id}，改完点「保存任务」覆盖`);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">定时任务</div>
      <div className="settings-section-desc">
        Tiffa 运行时生效（关闭期间的漏跑默认不补）。cron 五字段「分 时 日 月 周」，或用间隔 every（如 2h / 30m / 1d）。
        也可以直接在对话里让 AI 用 schedule_task 工具建任务。
      </div>

      {tasks.length === 0 && <div className="settings-section-desc">（暂无任务）</div>}
      {tasks.map((t) => (
        <div className="form-field" key={t.id} style={{ marginBottom: 8 }}>
          <div className="form-label">
            {t.name ? `${t.name}（${t.id}）` : t.id}
            <span style={{ opacity: 0.7, marginLeft: 8 }}>
              {t.nextRunHint} · 审批 {t.approval} · 模型 {t.model ? `${t.provider ? t.provider + '/' : ''}${t.model}` : '默认'} · 上次 {fmtTime(t.lastRunAt)}
              {t.lastResult && t.lastResult !== 'ok' ? ` · ${t.lastResult}` : ''}
              {t.running ? ' · 运行中' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="settings-btn" onClick={() => edit(t)}>
              编辑
            </button>
            <button type="button" className="settings-btn" onClick={() => void runNow(t.id)}>
              立即运行
            </button>
            <button type="button" className="settings-btn" onClick={() => void toggle(t)}>
              {t.enabled !== false ? '停用' : '启用'}
            </button>
            <button type="button" className="settings-btn" onClick={() => void remove(t.id)}>
              删除
            </button>
          </div>
        </div>
      ))}
      {errors.length > 0 && <div className="settings-section-desc">⚠️ {errors.join('；')}</div>}

      <div className="form-field" style={{ marginTop: 12 }}>
        <div className="form-label">新建 / 编辑（同 id 覆盖；点上方任务「编辑」可载入现有配置）</div>
        <input
          className="form-input"
          placeholder="id（英文短名，如 daily-report）"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
        />
        <input
          className="form-input"
          placeholder="展示名（可选）"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="form-input" value={kind} onChange={(e) => setKind(e.target.value as 'cron' | 'every')}>
            <option value="cron">cron</option>
            <option value="every">every</option>
          </select>
          <input
            className="form-input"
            placeholder={kind === 'cron' ? '0 9 * * *' : '2h'}
            value={form.schedule}
            onChange={(e) => setForm({ ...form, schedule: e.target.value })}
          />
          <select
            className="form-input"
            value={form.approval}
            onChange={(e) => setForm({ ...form, approval: e.target.value })}
          >
            <option value="normal">normal（每步确认）</option>
            <option value="auto">auto（写操作免确认）</option>
            <option value="yolo">yolo（全自动）</option>
          </select>
        </div>
        <label className="form-label" style={{ marginTop: 8 }}>使用模型</label>
        <select
          className="form-input"
          value={form.modelKey}
          onChange={(e) => setForm({ ...form, modelKey: e.target.value })}
        >
          <option value="">跟随默认模型</option>
          {form.modelKey && !models.some((m) => `${m.provider || ''}::${m.id}` === form.modelKey) && (
            <option value={form.modelKey}>{form.modelKey.split('::').join(' / ')}（当前值，不在列表中）</option>
          )}
          {models.map((m) => (
            <option key={`${m.provider || ''}::${m.id}`} value={`${m.provider || ''}::${m.id}`}>
              {m.provider ? `${m.provider} / ` : ''}{m.name || m.id}
            </option>
          ))}
        </select>
        {models.length === 0 && (
          <div className="settings-section-desc" style={{ marginTop: 2 }}>
            未读到模型列表（引擎未启动时仅能从 models.yml 兜底；启动后可选项会补齐）。
          </div>
        )}
        <textarea
          className="form-input"
          placeholder="到点要执行的指令（prompt）"
          rows={3}
          value={form.prompt}
          onChange={(e) => setForm({ ...form, prompt: e.target.value })}
        />
        <input
          className="form-input"
          placeholder="目标项目目录（可选，缺省当前工作区）"
          value={form.cwd}
          onChange={(e) => setForm({ ...form, cwd: e.target.value })}
        />
        <label className="form-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={form.catchUp} onChange={(e) => setForm({ ...form, catchUp: e.target.checked })} />
          应用关闭期间漏跑则下次启动补跑一次（最多回溯 12 小时）
        </label>
        <label className="form-label" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <input type="checkbox" checked={form.goalOn} onChange={(e) => setForm({ ...form, goalOn: e.target.checked })} />
          以目标模式运行（长任务推荐）
        </label>
        {form.goalOn && (
          <>
            <textarea
              className="form-input"
              placeholder="目标：写清「做完了是什么样子」，例如「npm test 从 47 个失败降到 0，不许用 skip 绕过」"
              rows={2}
              value={form.goalObjective}
              onChange={(e) => setForm({ ...form, goalObjective: e.target.value })}
            />
            <input
              className="form-input"
              type="number"
              min={0}
              placeholder="token 预算（可选，到顶会让模型收尾交接而不是硬停）"
              value={form.goalBudget}
              onChange={(e) => setForm({ ...form, goalBudget: e.target.value })}
            />
            <div className="settings-section-desc">
              目标会被逐字钉进整个执行过程；预算到顶内核会把目标置为 budget-limited 并要求模型收尾交接。
            </div>
          </>
        )}
        <button type="button" className="settings-btn" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存任务'}
        </button>
        <button
          type="button"
          className="settings-btn"
          onClick={async () => {
            const root = (await window.tiffaDesktop.getRootPath()) as string;
            void window.tiffaDesktop.openPath(`${root}\\data\\agent\\scheduled-tasks.json`);
          }}
        >
          用记事本打开任务表
        </button>
      </div>
    </div>
  );
}

function IdentitySection() {
  const addToast = useUiStore((s) => s.addToast);
  const aiName = useUiStore((s) => s.aiName);
  const userName = useUiStore((s) => s.userName);
  const gender = useUiStore((s) => s.gender);
  const persona = useUiStore((s) => s.persona);
  const currentProvider = useUiStore((s) => s.currentProvider);
  const currentModel = useUiStore((s) => s.currentModel);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [uname, setUname] = useState('');
  const [genderSel, setGenderSel] = useState('');
  const [personaCard, setPersonaCard] = useState('');
  const [selKeywords, setSelKeywords] = useState<string[]>([]);
  const [customKeyword, setCustomKeyword] = useState('');
  const [generating, setGenerating] = useState(false);

  const open = () => {
    setName(aiName === '助手' ? '' : aiName);
    setUname(userName);
    setGenderSel(gender);
    setPersonaCard(persona);
    setSelKeywords([]);
    setCustomKeyword('');
    setShowModal(true);
  };
  // 首次启动 onboarding：身份不全时自动打开「设置身份」弹窗（identity.ts Phase 3 触发）
  const identitySetupPending = useUiStore((s) => s.identitySetupPending);
  useEffect(() => {
    if (identitySetupPending) {
      open();
      useUiStore.getState().clearIdentitySetup();
    }
    // open 为组件内函数，每次渲染重建；effect 仅依赖标记位，无需入依赖数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identitySetupPending]);


  const toggleKeyword = (kw: string) => {
    setSelKeywords((prev) => (prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw]));
  };

  const addCustomKeyword = () => {
    const kw = customKeyword.trim();
    if (!kw) return;
    setSelKeywords((prev) => (prev.includes(kw) ? prev : [...prev, kw]));
    setCustomKeyword('');
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const prompt = buildPersonaPrompt(name.trim() || '助手', genderSel, selKeywords);
      const res = (await window.tiffaDesktop.completeWithLightModel(
        prompt,
        400,
        currentProvider || null,
        currentModel || null,
      )) as { text?: string; error?: string } | undefined;
      if (res && res.text) {
        setPersonaCard(res.text.trim());
        addToast('success', '角色卡已生成');
      } else if (res && res.error && res.error.includes('无可用模型')) {
        setPersonaCard(buildFallbackPersona(name.trim() || '助手', genderSel, selKeywords));
        addToast('info', '已用模板生成，可配置模型后重新扩写');
      } else {
        addToast('error', `扩写失败：${(res && res.error) || '未知错误'}`);
      }
    } catch (err) {
      addToast('error', `扩写失败：${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    try {
      await window.tiffaDesktop.saveIdentity(name.trim() || '助手', uname.trim(), genderSel, personaCard.trim());
      useUiStore.getState().setAiName(name.trim() || '助手');
      useUiStore.getState().setUserName(uname.trim());
      useUiStore.getState().setGender(genderSel);
      useUiStore.getState().setPersona(personaCard.trim());
      addToast('success', '身份已保存');
    } catch (err) {
      addToast('error', `保存失败: ${(err as Error).message}`);
    }
    setShowModal(false);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">AI 身份</div>
      <div className="settings-section-desc">配置 AI 的名字、称呼与角色卡（记忆系统 AI.md / USER.md）</div>
      <div className="constraints-preview">
        AI 名字：{aiName || '助手'}
        {userName ? `　·　对你的称呼：${userName}` : ''}
        {gender ? `　·　性别：${gender}` : ''}
      </div>
      <button type="button" className="settings-btn" onClick={open}>
        设置 AI 身份
      </button>
      {showModal &&
        createPortal(
          <div id="identityOverlay" className="overlay" onClick={() => setShowModal(false)}>
            <div className="settings-panel identity-panel" onClick={(e) => e.stopPropagation()}>
              <div className="settings-header">
                <h3>设置身份</h3>
                <button type="button" className="settings-close" onClick={() => setShowModal(false)}>
                  ×
                </button>
              </div>
              <div className="settings-body">
                <div className="settings-section-desc">给 AI 起个名字、设定性别与性格，可一键扩写为结构化角色卡并注入人设。信息写入记忆系统（AI.md / USER.md）。</div>
                <div className="bypass-field">
                  <label>AI 的名字</label>
                  <input type="text" value={name} placeholder="如：小巴 / Tiffa" autoComplete="off" spellCheck={false} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="bypass-field">
                  <label>对我的称呼</label>
                  <input type="text" value={uname} placeholder="如：swond / 朋友" autoComplete="off" spellCheck={false} onChange={(e) => setUname(e.target.value)} />
                </div>
                <div className="bypass-field">
                  <label>性别</label>
                  <div className="persona-gender-row">
                    {['男', '女', '其他', '不强调'].map((g) => (
                      <label key={g} className="persona-gender-item">
                        <input type="radio" name="persona-gender" checked={genderSel === g} onChange={() => setGenderSel(g)} />
                        <span>{g}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="bypass-field">
                  <label>性格关键词（可多选，可手填）</label>
                  <div className="persona-chips">
                    {PERSONA_KEYWORDS.map((kw) => (
                      <button
                        key={kw}
                        type="button"
                        className={`persona-chip${selKeywords.includes(kw) ? ' selected' : ''}`}
                        onClick={() => toggleKeyword(kw)}
                      >
                        {kw}
                      </button>
                    ))}
                  </div>
                  <div className="persona-custom-row">
                    <input
                      type="text"
                      value={customKeyword}
                      placeholder="自定义性格词，回车添加"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setCustomKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomKeyword();
                        }
                      }}
                    />
                    <button type="button" className="settings-btn" onClick={addCustomKeyword}>
                      添加
                    </button>
                  </div>
                  {selKeywords.length > 0 && <div className="persona-selected">已选：{selKeywords.join('、')}</div>}
                </div>
                <div className="bypass-field">
                  <label>角色卡（AI 扩写或手动编辑）</label>
                  <div className="persona-generate-row">
                    <button type="button" className="settings-btn" onClick={() => void generate()} disabled={generating}>
                      {generating ? '生成中…' : personaCard ? '重新生成' : '生成角色卡'}
                    </button>
                    <span className="persona-hint">优先使用旁路模型扩写，失败时本地模板兜底</span>
                  </div>
                  <textarea
                    className="persona-textarea"
                    value={personaCard}
                    rows={8}
                    placeholder={'【身份】…\n【性格】…\n【语气】…\n【说话方式】…\n【行为习惯】…\n【禁忌】…'}
                    onChange={(e) => setPersonaCard(e.target.value)}
                  />
                </div>
                <div className="ext-modal-actions">
                  <button type="button" className="settings-btn" onClick={() => setShowModal(false)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="settings-btn"
                    style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}
                    onClick={() => void save()}
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── 主组件 ──

type SettingsTabId =
  | 'model-config'
  | 'model-list'
  | 'aux-model'
  | 'identity'
  | 'computer-use'
  | 'scheduler'
  | 'goal'
  | 'theme'
  | 'about';

/** 左侧导航：分组 + 页签。新增设置区块时在这里登记一项即可。 */
const SETTINGS_TABS: { group: string; items: { id: SettingsTabId; label: string }[] }[] = [
  {
    group: '模型',
    items: [
      { id: 'model-config', label: '模型配置' },
      { id: 'model-list', label: '模型列表' },
      { id: 'aux-model', label: '辅助模型' },
    ],
  },
  {
    group: '人格',
    items: [{ id: 'identity', label: 'AI 身份 · 约束' }],
  },
  {
    group: '能力',
    items: [
      { id: 'computer-use', label: '电脑控制 · 浏览器' },
      { id: 'scheduler', label: '定时任务' },
      { id: 'goal', label: '目标模式' },
    ],
  },
  {
    group: '其它',
    items: [
      { id: 'theme', label: '主题风格' },
      { id: 'about', label: '关于' },
    ],
  },
];

const SETTINGS_TAB_KEY = 'tiffa.settingsTab';

function loadSavedTab(): SettingsTabId {
  try {
    const saved = localStorage.getItem(SETTINGS_TAB_KEY) as SettingsTabId | null;
    if (saved && SETTINGS_TABS.some((g) => g.items.some((i) => i.id === saved))) return saved;
  } catch {
    /* ignore */
  }
  return 'model-config';
}

export default function SettingsPanel() {
  const open = useUiStore((s) => s.settingsOpen);
  const toggleSettings = useUiStore((s) => s.toggleSettings);
  const [tab, setTab] = useState<SettingsTabId>(loadSavedTab);
  const close = () => {
    if (useUiStore.getState().settingsOpen) toggleSettings();
  };
  const select = (id: SettingsTabId) => {
    setTab(id);
    try {
      localStorage.setItem(SETTINGS_TAB_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {open &&
        createPortal(
          <div id="settingsOverlay" className="overlay" onClick={close}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
              <div className="settings-header">
                <h3>设置</h3>
                <button type="button" className="settings-close" onClick={close}>
                  ×
                </button>
              </div>
              <div className="settings-main">
                <nav className="settings-nav">
                  {SETTINGS_TABS.map((g) => (
                    <div className="settings-nav-group" key={g.group}>
                      <div className="settings-nav-group-label">{g.group}</div>
                      {g.items.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          className={`settings-nav-item${tab === it.id ? ' active' : ''}`}
                          onClick={() => select(it.id)}
                        >
                          {it.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </nav>
                {/* key={tab}：切换页签时重建滚动容器，滚动位置回到顶部 */}
                <div className="settings-body" key={tab}>
                  {tab === 'model-config' && <ModelConfigSection />}
                  {tab === 'model-list' && <ModelListSection />}
                  {tab === 'aux-model' && (
                    <>
                      <BypassModelSection kind="bypass" />
                      <BypassModelSection kind="grounding" />
                    </>
                  )}
                  {tab === 'identity' && (
                    <>
                      <IdentitySection />
                      <ConstraintsSection />
                    </>
                  )}
                  {tab === 'computer-use' && (
                    <>
                      <ComputerUseSection />
                      <PlaywrightSection />
                    </>
                  )}
                  {tab === 'scheduler' && <SchedulerSection />}
                  {tab === 'goal' && <GoalModeSection />}
                  {tab === 'theme' && <ThemeSection />}
                  {tab === 'about' && (
                    <div className="settings-section">
                      <div className="settings-section-title">关于</div>
                      <div className="about-info">
                        <div className="about-row">
                          <span>Tiffa 桌面端</span>
                          <span>v1.4</span>
                        </div>
                        <div className="about-row">
                          <span>oh-my-tiffa 内核</span>
                          <span>v17.0.7</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
