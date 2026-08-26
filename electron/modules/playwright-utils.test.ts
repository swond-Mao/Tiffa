/**
 * playwright-utils 单测
 */
import { describe, it, expect } from 'vitest';
import { isPlaywrightEnabled, syncPlaywrightMcp } from './playwright-utils';

describe('isPlaywrightEnabled', () => {
  it('返回布尔值不抛错', () => {
    const r = isPlaywrightEnabled();
    expect(typeof r).toBe('boolean');
  });
});

describe('syncPlaywrightMcp', () => {
  it('mcp.json 不存在时不抛错', () => {
    expect(() => syncPlaywrightMcp(false)).not.toThrow();
  });
});
