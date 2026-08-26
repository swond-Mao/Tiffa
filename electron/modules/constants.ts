/**
 * 主进程共享常量
 *
 * 从 main.ts 顶层 Configuration 区域提取，供所有子模块导入。
 * 纯计算无副作用，PORTABLE_ROOT 解析逻辑与 main.js 一致。
 */
import path from 'path';

function resolvePortableRoot(): string {
  const argRootIdx = process.argv.indexOf('--portable-root');
  if (argRootIdx >= 0 && process.argv[argRootIdx + 1]) {
    return path.resolve(process.argv[argRootIdx + 1]);
  }
  if (process.env.PORTABLE_ROOT) {
    return path.resolve(process.env.PORTABLE_ROOT);
  }
  // main.js 已先设置 global.PORTABLE_ROOT（其 __dirname 为 electron/，向上一级即便携根）
  const g = (global as any).PORTABLE_ROOT;
  if (typeof g === 'string' && g) {
    return path.resolve(g);
  }
  // 兜底：本模块编译产物位于 electron/modules/，向上两级才是便携根（勿用单级 ..，否则指向 electron/）
  return path.resolve(__dirname, '..', '..');
}

export const PORTABLE_ROOT = resolvePortableRoot();

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
export const DEFAULT_WORKSPACE_DIR = path.join(PORTABLE_ROOT, 'workspace');
export const SESSIONS_DIR = path.join(PORTABLE_ROOT, 'data', 'agent', 'sessions');
export const ARCHIVE_DIR = path.join(PORTABLE_ROOT, 'data', 'agent', 'sessions-archive');
export const PROJECTS_JSON = path.join(PORTABLE_ROOT, 'data', 'agent', 'projects.json');
export const REMOVED_CWDS_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'removed-cwds.json');
export const COMPUTER_USE_ENABLED_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'computer-use-enabled');
export const COMPUTER_USE_MCP_JSON = path.join(PORTABLE_ROOT, 'data', 'agent', 'mcp.json');
export const PLAYWRIGHT_ENABLED_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'playwright-enabled');
export const AGENT_DIR = path.join(PORTABLE_ROOT, 'data', 'agent');
export const MAX_INSTANCES = 8;
export const LRU_KEEP_ALIVE_MS = 5 * 60 * 1000;

export let currentWorkspaceDir = DEFAULT_WORKSPACE_DIR;

export function setCurrentWorkspaceDir(dir: string): void {
  currentWorkspaceDir = dir;
}
