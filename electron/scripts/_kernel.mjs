/**
 * _kernel.mjs — Tiffa 内核启动共享模块（E2E 脚本共用）
 *
 * 与 electron/main.js 完全一致的便携环境注入：
 *   - PI_CODING_AGENT_DIR → data/agent（config.yml 位置）
 *   - HOME / USERPROFILE → <root>/home（便携 HOME）
 *   - BUN_INSTALL → PORTABLE_ROOT
 *   - UTF-8 环境变量（治理中文乱码）
 *
 * 用法：
 *   import { spawnKernel } from './_kernel.mjs';
 *   const child = spawnKernel(['--no-session']);
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ── 便携根推导：本文件位于 <root>/electron/scripts/ ──
export const PORTABLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const BUN_EXE = path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', 'bun', 'bin', 'bun.exe');
export const TIFFA_CLI = path.join(
  PORTABLE_ROOT,
  'npm-global',
  'node_modules',
  '@oh-my-pi',
  'pi-coding-agent',
  'dist',
  'cli.js',
);
export const EXTENSION_PATH = path.join(PORTABLE_ROOT, 'plugins', 'claude-mode-extension.ts');
export const COMPUTER_USE_EXTENSION_PATH = path.join(PORTABLE_ROOT, 'plugins', 'computer-use-extension.ts');

// 与 main.js _utf8Env 对齐的 UTF-8 环境注入
export function kernelEnv() {
  return {
    ...process.env,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    NO_COLOR: '1',
    PI_CODING_AGENT_DIR: path.join(PORTABLE_ROOT, 'data', 'agent'),
    HOME: path.join(PORTABLE_ROOT, 'home'),
    USERPROFILE: path.join(PORTABLE_ROOT, 'home'),
    BUN_INSTALL: PORTABLE_ROOT,
  };
}

/**
 * spawn Tiffa 内核（rpc-ui 模式）。
 * @param {string[]} extraArgs 额外参数（如 ['--no-session']）
 * @param {{ cwd?: string, plugins?: boolean }} opts
 */
export function spawnKernel(extraArgs = [], opts = {}) {
  const { cwd = path.join(os.tmpdir(), `tiffa-e2e-${Date.now()}`), plugins = false } = opts;
  fs.mkdirSync(cwd, { recursive: true });
  const args = [TIFFA_CLI, '--mode', 'rpc-ui'];
  if (plugins) {
    args.push('-e', EXTENSION_PATH, '-e', COMPUTER_USE_EXTENSION_PATH);
  }
  args.push(...extraArgs);
  const child = spawn(BUN_EXE, args, {
    cwd,
    env: kernelEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.cwdUsed = cwd;
  return child;
}
