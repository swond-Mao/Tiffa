"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlaywrightEnabled = isPlaywrightEnabled;
exports.syncPlaywrightMcp = syncPlaywrightMcp;
/**
 * Playwright MCP 相关：开关读取 / MCP 配置同步
 *
 * 与 computer-use-utils 同模式：开关文件 data/agent/playwright-enabled，
 * 缺失默认关（不拉起 playwright MCP 进程，新对话启动更快）。
 * 同步时把 mcp.json 中 playwright.enabled 刷成开关状态。
 */
const fs_1 = __importDefault(require("fs"));
const constants_1 = require("./constants");
/** 读取 Playwright 开关状态（默认关，启动快） */
function isPlaywrightEnabled() {
    try {
        if (!fs_1.default.existsSync(constants_1.PLAYWRIGHT_ENABLED_FILE))
            return false;
        return fs_1.default.readFileSync(constants_1.PLAYWRIGHT_ENABLED_FILE, 'utf8').trim() === 'true';
    }
    catch {
        return false;
    }
}
/**
 * 同步 Playwright MCP 配置到开关状态。
 * 仓库里 mcp.json 用 {{PORTABLE_ROOT}} 占位符，运行时替换为真实便携根目录。
 */
function syncPlaywrightMcp(enabled) {
    try {
        const p = constants_1.COMPUTER_USE_MCP_JSON;
        if (!fs_1.default.existsSync(p))
            return;
        let raw = fs_1.default.readFileSync(p, 'utf8');
        const rootSlash = constants_1.PORTABLE_ROOT.replace(/\\/g, '/');
        raw = raw.split('{{PORTABLE_ROOT}}').join(rootSlash);
        const cfg = JSON.parse(raw);
        if (cfg.mcpServers && cfg.mcpServers['playwright']) {
            cfg.mcpServers['playwright'].enabled = enabled;
            fs_1.default.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
        }
    }
    catch (err) {
        console.error('[主进程] syncPlaywrightMcp 失败:', err.message);
    }
}
//# sourceMappingURL=playwright-utils.js.map