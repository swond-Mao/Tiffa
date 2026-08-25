/**
 * models-config 单元测试：覆盖三类「毒配置」（缺 apiKey 行 / 空 apiKey / 数字写成字符串）
 * 的清洗与校验行为——这些配置会让内核 schema 校验失败禁用整个 providers，
 * 进而无可用模型、内核启动即退（Tiffa 表现为反复崩溃）。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeModelsConfig, validateModelsConfig } from './models-config';

const validModel = {
  id: 'm1', name: 'm1', reasoning: false, input: ['text'], supportsTools: true,
  contextWindow: 32768, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

describe('sanitizeModelsConfig', () => {
  it('缺 apiKey 行（有 baseUrl）→ 补 none', () => {
    const data = { providers: { p1: { baseUrl: 'http://127.0.0.1:8080/v1', models: [validModel] } } };
    const { changed } = sanitizeModelsConfig(data);
    expect(changed).toBe(true);
    expect((data.providers.p1 as any).apiKey).toBe('none');
  });

  it('空串 apiKey → 补 none', () => {
    const data = { providers: { p1: { baseUrl: 'http://x/v1', apiKey: '   ', models: [validModel] } } };
    sanitizeModelsConfig(data);
    expect((data.providers.p1 as any).apiKey).toBe('none');
  });

  it('已有 apiKey / 声明 auth 的不动', () => {
    const data = {
      providers: {
        a: { baseUrl: 'http://x/v1', apiKey: 'sk-real', models: [validModel] },
        b: { baseUrl: 'http://y/v1', auth: 'none', models: [validModel] },
      },
    };
    const { changed } = sanitizeModelsConfig(data);
    expect(changed).toBe(false);
    expect((data.providers.a as any).apiKey).toBe('sk-real');
  });

  it('数字字段字符串化 → 转回数字（含 cost）', () => {
    const m = { ...validModel, contextWindow: '32768' as unknown as number, maxTokens: '4096' as unknown as number,
      cost: { input: '0', output: '0', cacheRead: '0', cacheWrite: '0' } };
    const data = { providers: { p1: { baseUrl: 'http://x/v1', apiKey: 'none', models: [m] } } };
    const { changed } = sanitizeModelsConfig(data);
    expect(changed).toBe(true);
    const fixed = (data.providers.p1 as any).models[0];
    expect(fixed.contextWindow).toBe(32768);
    expect(fixed.maxTokens).toBe(4096);
    expect(fixed.cost.input).toBe(0);
  });

  it('幂等：第二遍不再有改动；非法输入不炸', () => {
    const data = { providers: { p1: { baseUrl: 'http://x/v1', models: [{ ...validModel }] } } };
    sanitizeModelsConfig(data);
    expect(sanitizeModelsConfig(data).changed).toBe(false);
    expect(sanitizeModelsConfig(null).changed).toBe(false);
    expect(sanitizeModelsConfig({}).changed).toBe(false);
    expect(sanitizeModelsConfig({ providers: { p1: null } }).changed).toBe(false);
  });
});

describe('validateModelsConfig', () => {
  it('合法配置通过', () => {
    const data = { providers: { p1: { baseUrl: 'http://x/v1', apiKey: 'none', models: [validModel] } } };
    expect(validateModelsConfig(data)).toEqual([]);
  });

  it('定义了 models 但缺 apiKey → 报错', () => {
    const data = { providers: { p1: { baseUrl: 'http://x/v1', models: [validModel] } } };
    const errs = validateModelsConfig(data);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('p1');
    expect(errs[0]).toContain('apiKey');
  });

  it('contextWindow 为字符串 → 报错；经 sanitize 后通过', () => {
    const m = { ...validModel, contextWindow: '32768' as unknown as number };
    const data = { providers: { p1: { baseUrl: 'http://x/v1', apiKey: 'none', models: [m] } } };
    expect(validateModelsConfig(data).length).toBeGreaterThan(0);
    sanitizeModelsConfig(data);
    expect(validateModelsConfig(data)).toEqual([]);
  });

  it('空模型 ID / 空 baseUrl → 报错', () => {
    const data = { providers: { p1: { baseUrl: '', apiKey: 'none', models: [{ ...validModel, id: ' ' }] } } };
    const errs = validateModelsConfig(data);
    expect(errs.some((e) => e.includes('baseUrl'))).toBe(true);
    expect(errs.some((e) => e.includes('模型 ID'))).toBe(true);
  });
});
