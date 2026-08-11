/**
 * computer-use-utils 单测
 */
import { describe, it, expect } from 'vitest';
import { isComputerUseEnabled, syncComputerUseMcp } from './computer-use-utils';

describe('isComputerUseEnabled', () => {
  it('返回布尔值不抛错', () => {
    const r = isComputerUseEnabled();
    expect(typeof r).toBe('boolean');
  });
});

describe('syncComputerUseMcp', () => {
  it('mcp.json 不存在时不抛错', () => {
    expect(() => syncComputerUseMcp(false)).not.toThrow();
  });
});
