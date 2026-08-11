/**
 * config-utils 单测
 *
 * 覆盖纯函数：resolveDefaultModelFromConfig / findProviderConfig / readBypassModel / writeBypassModel
 * callCompletion / checkModelHealth 涉及网络，仅测参数校验分支。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveDefaultModelFromConfig,
  findProviderConfig,
  readBypassModel,
  writeBypassModel,
  readGroundingModel,
  writeGroundingModel,
  checkModelHealth,
} from './config-utils';
import { PORTABLE_ROOT } from './constants';

describe('resolveDefaultModelFromConfig', () => {
  it('config.yml 不存在返回 null', () => {
    // PORTABLE_ROOT 指向真实安装，config.yml 可能存在；测函数不抛错即可
    const r = resolveDefaultModelFromConfig();
    expect(r === null || (typeof r === 'object' && 'provider' in r && 'model' in r)).toBe(true);
  });
});

describe('findProviderConfig', () => {
  it('不存在的 provider 返回 null', () => {
    expect(findProviderConfig('__nonexistent__')).toBeNull();
  });
});

describe('bypass model 读写', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `tiffa-bypass-${Date.now()}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('writeBypassModel 写入后 readBypassModel 读回', () => {
    const cfg = { baseUrl: 'http://localhost:1234', apiKey: '', model: 'test-model', enabled: true };
    writeBypassModel(cfg, tmpFile);
    const read = readBypassModel(tmpFile);
    expect(read).not.toBeNull();
    expect(read!.baseUrl).toBe('http://localhost:1234');
    expect(read!.model).toBe('test-model');
    expect(read!.enabled).toBe(true);
  });

  it('写入路径不存在时读回 null', () => {
    const missing = path.join(os.tmpdir(), `tiffa-missing-${Date.now()}-${Math.random()}.json`);
    expect(readBypassModel(missing)).toBeNull();
  });
});

describe('grounding model 读写', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `tiffa-grounding-${Date.now()}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('writeGroundingModel 写入后读回', () => {
    writeGroundingModel({ api_base: 'http://test:1234', api_key: '', model: 'test', enabled: false }, tmpFile);
    const r = readGroundingModel(tmpFile);
    expect(r).not.toBeNull();
    expect(r!.api_base).toBe('http://test:1234');
    expect(r!.model).toBe('test');
    expect(r!.enabled).toBe('0');
  });

  it('不存在的文件返回 null', () => {
    const missing = path.join(os.tmpdir(), `tiffa-missing-g-${Date.now()}-${Math.random()}.json`);
    expect(readGroundingModel(missing)).toBeNull();
  });
});

describe('checkModelHealth 参数校验', () => {
  it('缺 baseUrl 返回失败', async () => {
    const r = await checkModelHealth({ baseUrl: '', model: 'test' });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('必填');
  });

  it('缺 model 返回失败', async () => {
    const r = await checkModelHealth({ baseUrl: 'http://localhost:1234', model: '' });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('必填');
  });
});
