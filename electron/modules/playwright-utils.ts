/**
 * Playwright MCP 相关：开关读取 / MCP 配置同步
 *
 * 与 computer-use-utils 同模式：开关文件 data/agent/playwright-enabled，
 * 缺失默认关（不拉起 playwright MCP 进程，新对话启动更快）。
 * 同步时把 mcp.json 中 playwright.enabled 刷成开关状态。
 */
import fs from 'fs';
import { PORTABLE_ROOT, PLAYWRIGHT_ENABLED_FILE, COMPUTER_USE_MCP_JSON } from './constants';

/** 读取 Playwright 开关状态（默认关，启动快） */
export function isPlaywrightEnabled(): boolean {
  try {
    if (!fs.existsSync(PLAYWRIGHT_ENABLED_FILE)) return false;
    return fs.readFileSync(PLAYWRIGHT_ENABLED_FILE, 'utf8').trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * 同步 Playwright MCP 配置到开关状态。
 * 仓库里 mcp.json 用 {{PORTABLE_ROOT}} 占位符，运行时替换为真实便携根目录。
 */
export function syncPlaywrightMcp(enabled: boolean): void {
  try {
    const p = COMPUTER_USE_MCP_JSON;
    if (!fs.existsSync(p)) return;
    let raw = fs.readFileSync(p, 'utf8');
    const rootSlash = PORTABLE_ROOT.replace(/\\/g, '/');
    raw = raw.split('{{PORTABLE_ROOT}}').join(rootSlash);
    const cfg = JSON.parse(raw) as {
      mcpServers?: { playwright?: { enabled?: boolean } };
    };
    if (cfg.mcpServers && cfg.mcpServers['playwright']) {
      cfg.mcpServers['playwright'].enabled = enabled;
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    }
  } catch (err) {
    console.error('[主进程] syncPlaywrightMcp 失败:', (err as Error).message);
  }
}
