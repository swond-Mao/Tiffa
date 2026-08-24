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
import { useSessionsStore } from '../stores/useSessionsStore';
import { useProcStore } from '../stores/useProcStore';
import { switchModel, invalidateModelListCache } from '../services/sessionController';
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
      { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openrouter', authUrl: 'https://openrouter.ai/keys', hint: 'sk-or-...', cat: 'popular' },
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
      { id: 'ollama', name: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434', api: 'ollama-chat', authUrl: '', hint: '（本地服务可留空）', cat: 'local' },
      { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', api: 'openai-completions', authUrl: '', hint: '（本地服务可留空）', cat: 'local' },
      { id: 'vllm', name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', api: 'openai-completions', authUrl: '', hint: '（本地服务可留空）', cat: 'local' },
      { id: 'llama-cpp', name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080', api: 'ollama-chat', authUrl: '', hint: '（本地服务可留空）', cat: 'local' },
      { id: 'ollama-cloud', name: 'Ollama Cloud', baseUrl: 'https://cloud.ollama.com', api: 'ollama-chat', authUrl: '', hint: '...', cat: 'local' },
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

function serializeModelsYaml(data: TiffaModelsConfig | null): string {
  const lines = ['# Tiffa models.yml', ''];
  if (!data || !data.providers) return lines.join('\n');
  lines.push('providers:');
  for (const [k, p] of Object.entries(data.providers)) {
    lines.push(`  ${k}:`, `    baseUrl: "${p.baseUrl || ''}"`, `    api: "${p.api || 'openai-completions'}"`);
    if (p.apiKey) lines.push(`    apiKey: "${p.apiKey}"`);
    if (p.models && p.models.length > 0) {
      lines.push('    models:');
      for (const m of p.models) {
        lines.push(
          `      - id: "${m.id || ''}"`,
          `        name: "${m.name || m.id || ''}"`,
          `        reasoning: ${m.reasoning ? 'true' : 'false'}`,
          '        input:',
          ...(m.input || ['text']).map((i) => `          - "${i}"`),
          `        supportsTools: ${m.supportsTools ? 'true' : 'false'}`,
          `        contextWindow: ${m.contextWindow || 128000}`,
          `        maxTokens: ${m.maxTokens || 8192}`,
          '        cost:',
          `          input: ${(m.cost && m.cost.input) || 0}`,
          `          output: ${(m.cost && m.cost.output) || 0}`,
          `          cacheRead: ${(m.cost && m.cost.cacheRead) || 0}`,
          `          cacheWrite: ${(m.cost && m.cost.cacheWrite) || 0}`,
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
  input?: string[];
  supportsTools?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

function ModelConfigSection() {
  const [cfg, setCfg] = useState<TiffaModelsConfig | null>(null);
  const [status, setStatus] = useState('');
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const addToast = useUiStore((s) => s.addToast);

  const load = useCallback(async () => {
    try {
      const r = await window.tiffaDesktop.readModelsYml();
      if (r && !r.error) setCfg(r.data || null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!cfg) return <div className="model-item loading">加载中...</div>;
  const providers = cfg.providers || {};

  const patchProvider = (key: string, patch: Partial<TiffaProviderConfig>) => {
    setCfg((c) => {
      if (!c || !c.providers) return c;
      return { ...c, providers: { ...c.providers, [key]: { ...c.providers[key], ...patch } } };
    });
  };

  const save = async () => {
    setStatus('保存中...');
    try {
      const yaml = serializeModelsYaml(cfg);
      const r = (await window.tiffaDesktop.writeModelsYml(yaml)) as { success?: boolean; error?: string };
      setStatus(r && r.success ? '已保存' : `保存失败: ${(r && r.error) || ''}`);
      if (r && r.success) {
        addToast('success', '模型配置已保存');
        // 死列表缓存失效：下次点开模型列表时按新配置重载
        invalidateModelListCache();
        // 等价旧版 applyModelsConfigChange：agent 运行中不强行重启（避免中断任务），
        // 配置在下次重启 / 新对话时生效；空闲时才重启实例让配置立即生效。
        const activePath = useSessionsStore.getState().activeSessionPath;
        const running = activePath ? useProcStore.getState().procStateMap[activePath]?.agentRunning : false;
        if (running) {
          addToast('info', '模型配置已保存，将在重启 / 新对话后生效（也可点「重启」立即生效）');
          return;
        }
        try {
          const rr = (await window.tiffaDesktop.restartTiffa()) as { success?: boolean; error?: string };
          if (rr && rr.success) addToast('info', 'Tiffa 已重启，新配置生效');
          else if (rr && rr.error) addToast('warning', `重启失败: ${rr.error}`);
        } catch {
          /* ignore */
        }
      } else {
        addToast('error', `保存失败: ${(r && r.error) || '未知错误'}`);
      }
    } catch (err) {
      setStatus(`保存失败: ${(err as Error).message}`);
      addToast('error', `保存失败: ${(err as Error).message}`);
    }
    setTimeout(() => setStatus(''), 8000);
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
      await save();
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
      <div className="settings-section-desc">添加、编辑或删除模型供应商和模型，保存后需重启 Tiffa 生效</div>
      <div className="model-config">
        {Object.keys(providers).length === 0 && <div className="model-item empty">暂无供应商配置</div>}
        {Object.entries(providers).map(([key, prov]) => (
          <div className="provider-card" key={key} data-provider-key={key}>
            <div
              className="provider-header"
              onClick={() => setOpenCards((o) => ({ ...o, [key]: !o[key] }))}
            >
              <div>
                <span className="provider-name">{key}</span>
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
        <button type="button" className="settings-btn" style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }} onClick={() => void save()}>
          保存
        </button>
        <button type="button" className="settings-btn" onClick={() => void window.tiffaDesktop.restartTiffa()}>
          重启
        </button>
        <span className={`config-status${status ? (status.startsWith('保存') ? ' saved' : '') : ''}`}>{status}</span>
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
function ModelEntryRow({ model, onChange, onDelete, baseUrl, apiKey }: { model: ModelEntry; onChange: (patch: Partial<ModelEntry>) => void; onDelete: () => void; baseUrl?: string; apiKey?: string }) {
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const addToast = useUiStore((s) => s.addToast);
  // hooks 必须无条件调用：若放在 if(!editing) 之后，展开时 hooks 数量 1→2，
  // React 报 #310 "Rendered more hooks than during the previous render" → 白屏。
  const [fields, setFields] = useState({
    id: model.id,
    name: model.name || '',
    contextWindow: String(model.contextWindow || 128000),
    maxTokens: String(model.maxTokens || 8192),
    reasoning: !!model.reasoning,
    vision: !!(model.input && model.input.includes('image')),
  });

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
    return (
      <div className="model-entry" onClick={() => setEditing(true)}>
        <span className="model-entry-id">{model.id || ''}</span>
        <span className="model-entry-meta">
          {model.name || ''} | {model.contextWindow || '?'}ctx{thinkBadge}
          {visionBadge}
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
    onAdd({ id, name, reasoning, input: vision ? ['text', 'image'] : ['text'], supportsTools: true, contextWindow: ctx, maxTokens: max, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
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
    onAdd(k, { baseUrl: baseUrl.trim(), api, apiKey: apiKey.trim() || undefined, models: [] });
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
                <option value="openrouter">OpenRouter (openrouter)</option>
                <option value="google-generative-ai">Google Gemini (google-generative-ai)</option>
                <option value="google-gemini-cli">Google Gemini CLI (google-gemini-cli)</option>
                <option value="google-vertex">Google Vertex (google-vertex)</option>
                <option value="azure-openai-responses">Azure OpenAI (azure-openai-responses)</option>
                <option value="bedrock-converse-stream">AWS Bedrock (bedrock-converse-stream)</option>
                <option value="ollama-chat">Ollama (ollama-chat)</option>
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

  useEffect(() => {
    const load = async () => {
      try {
        const cfg = kind === 'bypass' ? await window.tiffaDesktop.getBypassModel() : await window.tiffaDesktop.getGroundingModel();
        const c = cfg as { baseUrl?: string; api_base?: string; apiKey?: string; api_key?: string; model?: string; enabled?: unknown; error?: string } | undefined;
        if (!c || c.error) return;
        setForm({
          baseUrl: c.baseUrl || c.api_base || '',
          apiKey: c.apiKey || c.api_key || '',
          model: c.model || '',
          enabled: kind === 'grounding' ? String(c.enabled) === '1' || c.enabled === true : c.enabled !== false,
        });
      } catch {
        /* ignore */
      }
    };
    void load();
  }, [kind]);

  const save = async () => {
    if (!form.baseUrl || !form.model) {
      addToast('warning', kind === 'bypass' ? '旁路模型需填写 Base URL 与 Model ID' : 'MCP 模型需填写 Base URL 与 Model ID');
      return;
    }
    const cfg = kind === 'bypass' ? { baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model, enabled: form.enabled } : { api_base: form.baseUrl, api_key: form.apiKey, model: form.model, enabled: form.enabled };
    const res = (kind === 'bypass' ? await window.tiffaDesktop.saveBypassModel(cfg) : await window.tiffaDesktop.saveGroundingModel(cfg)) as { success?: boolean; error?: string };
    if (res && res.success) {
      addToast('success', kind === 'bypass' ? `旁路模型已保存：${form.model}${form.enabled ? '（启用）' : '（未启用）'}` : `MCP 模型已保存：${form.model}${form.enabled ? '（启用）' : '（未启用）'}（重启 Tiffa 后电脑控制生效）`);
    } else {
      addToast('error', `保存失败: ${(res && res.error) || '未知错误'}`);
    }
  };

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
          ? '用于 AI 会话重命名、上下文压缩总结与轻量补全的独立模型。建议配置便宜快速的模型，让总结等后台任务不占用主模型。保存即时生效'
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
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="settings-btn" style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }} onClick={() => void save()}>
            保存
          </button>
          <button type="button" className="settings-btn" disabled={checked} onClick={() => void checkHealth()}>
            {checked ? '检查中...' : '健康检查'}
          </button>
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
          const el = document.getElementById('snapshotHotkeyInput') as HTMLInputElement | null;
          if (el) el.value = cfg.hotkey;
        }
      } catch {
        /* ignore */
      }
    };
    void loadHotkey();
  }, []);

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
          defaultValue="CommandOrControl+Alt+K"
          style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        />
        <button
          type="button"
          className="settings-btn"
          onClick={async () => {
            const hotkey = (document.getElementById('snapshotHotkeyInput') as HTMLInputElement).value.trim();
            await window.tiffaDesktop.setWindowSnapshotHotkey({ enabled: true, hotkey });
            await window.tiffaDesktop.reloadWindowSnapshotHotkey();
            addToast('success', `快照热键已更新：${hotkey}`);
          }}
        >
          保存热键
        </button>
      </div>
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

export default function SettingsPanel() {
  const open = useUiStore((s) => s.settingsOpen);
  const toggleSettings = useUiStore((s) => s.toggleSettings);
  const close = () => {
    if (useUiStore.getState().settingsOpen) toggleSettings();
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
              <div className="settings-body">
                <ModelConfigSection />
                <ModelListSection />
                <BypassModelSection kind="bypass" />
                <ComputerUseSection />
                <BypassModelSection kind="grounding" />
                <ThemeSection />
                <ConstraintsSection />
                <IdentitySection />
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
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
