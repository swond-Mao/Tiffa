/**
 * SettingsPanel — 设置面板（等价旧版 setupSettings + 模型配置 + 旁路/grounding +
 * 主题 + ComputerUse + 约束 + AI 身份）
 *
 * 节：模型配置（provider 卡片增删改/拉取/保存/重启）/ 旁路模型 / grounding MCP /
 * 当前模型列表（筛选 + 隐藏）/ 主题风格（7 预设 + 日夜）/ Computer Use /
 * 约束规则 / AI 身份 / 关于
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '../stores/useUiStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useProcStore } from '../stores/useProcStore';
import { switchModel } from '../services/sessionController';
import { showModalConfirm } from '../services/tabActions';
import { escapeHtml } from '../services/utils';
import type { TiffaModelsConfig, TiffaProviderConfig } from '../types/tiffaDesktop';

// ── 工具 ──

function serializeModelsYaml(data: TiffaModelsConfig | null): string {
  const lines = ['# Tiffa models.yml', ''];
  if (!data || !data.providers) return lines.join('\n');
  lines.push('providers:');
  for (const [k, p] of Object.entries(data.providers)) {
    lines.push(`  ${k}:`, `    baseUrl: "${p.baseUrl || ''}"`, `    api: "${p.api || 'custom-openai'}"`);
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
        <button type="button" className="btn-add-model" style={{ borderStyle: 'dashed' }} onClick={() => addProviderDialog(providers, (key, p) => {
          setCfg((c) => (c ? { ...c, providers: { ...c.providers, [key]: p } } : c));
        })}>
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
    </div>
  );
}

/** 模型条目行：内联编辑（点击展开） */
function ModelEntryRow({ model, onChange, onDelete }: { model: ModelEntry; onChange: (patch: Partial<ModelEntry>) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
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

/** 添加供应商对话框（DOM 方式，复用旧版 addProviderUI 字段：名称/API 地址/API Key/API 类型） */
function addProviderDialog(
  providers: Record<string, TiffaProviderConfig>,
  onAdd: (key: string, p: TiffaProviderConfig) => void,
): void {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1100;display:flex;align-items:center;justify-content:center;';
  backdrop.innerHTML = `
    <div style="background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:20px;width:360px;">
      <div style="font-size:14px;font-weight:600;margin-bottom:12px;">添加供应商</div>
      <label style="font-size:12px;color:var(--text-muted);">供应商名称（唯一标识）</label>
      <input id="dlgProvKey" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" placeholder="my-provider">
      <label style="font-size:12px;color:var(--text-muted);">API 地址</label>
      <input id="dlgProvUrl" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" placeholder="https://api.example.com/v1">
      <label style="font-size:12px;color:var(--text-muted);">API Key（可选）</label>
      <input id="dlgProvKeyApi" type="password" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;" placeholder="sk-xxx">
      <label style="font-size:12px;color:var(--text-muted);">API 类型</label>
      <select id="dlgProvApi" style="width:100%;padding:6px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;">
        <option value="custom-openai">custom-openai（OpenAI 兼容）</option>
        <option value="openai">openai</option>
        <option value="anthropic">anthropic</option>
        <option value="ollama">ollama</option>
        <option value="deepseek">deepseek</option>
      </select>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="dlgProvCancel" style="padding:6px 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">取消</button>
        <button id="dlgProvOk" style="padding:6px 16px;border:none;border-radius:4px;background:var(--accent);color:white;cursor:pointer;">添加</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const keyInput = backdrop.querySelector('#dlgProvKey') as HTMLInputElement;
  setTimeout(() => keyInput.focus(), 50);
  const close = () => backdrop.remove();
  backdrop.querySelector('#dlgProvCancel')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  const submit = () => {
    const key = keyInput.value.trim();
    if (!key) {
      useUiStore.getState().addToast('error', '供应商名称不能为空');
      return;
    }
    if (providers[key]) {
      useUiStore.getState().addToast('error', `供应商 "${key}" 已存在`);
      return;
    }
    const baseUrl = (backdrop.querySelector('#dlgProvUrl') as HTMLInputElement).value.trim();
    const apiKey = (backdrop.querySelector('#dlgProvKeyApi') as HTMLInputElement).value.trim();
    const api = (backdrop.querySelector('#dlgProvApi') as HTMLSelectElement).value;
    if (!baseUrl) {
      useUiStore.getState().addToast('error', 'API 地址不能为空');
      return;
    }
    onAdd(key, { baseUrl, api, apiKey: apiKey || undefined, models: [] });
    close();
  };
  backdrop.querySelector('#dlgProvOk')?.addEventListener('click', submit);
  backdrop.querySelector('#dlgProvKey')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') submit();
  });
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
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [uname, setUname] = useState('');

  const open = () => {
    setName(aiName === '助手' ? '' : aiName);
    setUname(userName);
    setShowModal(true);
  };

  const save = async () => {
    try {
      await window.tiffaDesktop.saveIdentity(name.trim() || '助手', uname.trim());
      useUiStore.getState().setAiName(name.trim() || '助手');
      useUiStore.getState().setUserName(uname.trim());
      addToast('success', '身份已保存');
    } catch (err) {
      addToast('error', `保存失败: ${(err as Error).message}`);
    }
    setShowModal(false);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">AI 身份</div>
      <div className="settings-section-desc">配置 AI 的名字与对你的称呼（记忆系统 AI.md / USER.md）</div>
      <div className="constraints-preview">AI 名字：{aiName || '助手'}{userName ? `　·　对你的称呼：${userName}` : ''}</div>
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
                <div className="settings-section-desc">给 AI 起个名字，并告诉它怎么称呼你。信息会写入记忆系统（AI.md / USER.md），可随时在「设置 → AI 身份」修改。</div>
                <div className="bypass-field">
                  <label>AI 的名字</label>
                  <input type="text" value={name} placeholder="如：小巴 / Tiffa" autoComplete="off" spellCheck={false} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="bypass-field">
                  <label>对我的称呼</label>
                  <input type="text" value={uname} placeholder="如：swond / 朋友" autoComplete="off" spellCheck={false} onChange={(e) => setUname(e.target.value)} />
                </div>
                <div className="ext-modal-actions">
                  <button type="button" className="settings-btn" onClick={() => setShowModal(false)}>
                    取消
                  </button>
                  <button type="button" className="settings-btn" style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }} onClick={() => void save()}>
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
