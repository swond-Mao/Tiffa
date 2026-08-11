/**
 * Computer Use 相关：开关读取 / MCP 配置同步
 *
 * 从 main.js setupIpc 闭包内提取的纯函数。IPC handler 留在 ipc-handlers.ts。
 */
import fs from 'fs';
import { PORTABLE_ROOT, COMPUTER_USE_ENABLED_FILE, COMPUTER_USE_MCP_JSON } from './constants';

/** 读取 Computer Use 开关状态（默认关） */
export function isComputerUseEnabled(): boolean {
  try {
    if (!fs.existsSync(COMPUTER_USE_ENABLED_FILE)) return false;
    return fs.readFileSync(COMPUTER_USE_ENABLED_FILE, 'utf8').trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * 同步 Computer Use MCP 配置到开关状态。
 * 仓库里 mcp.json 用 {{PORTABLE_ROOT}} 占位符，运行时替换为真实便携根目录。
 */
export function syncComputerUseMcp(enabled: boolean): void {
  try {
    const p = COMPUTER_USE_MCP_JSON;
    if (!fs.existsSync(p)) return;
    let raw = fs.readFileSync(p, 'utf8');
    const rootSlash = PORTABLE_ROOT.replace(/\\/g, '/');
    raw = raw.split('{{PORTABLE_ROOT}}').join(rootSlash);
    const cfg = JSON.parse(raw) as {
      mcpServers?: { 'computer-use'?: { enabled?: boolean } };
    };
    if (cfg.mcpServers && cfg.mcpServers['computer-use']) {
      cfg.mcpServers['computer-use'].enabled = enabled;
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    }
  } catch (err) {
    console.error('[主进程] syncComputerUseMcp 失败:', (err as Error).message);
  }
}
