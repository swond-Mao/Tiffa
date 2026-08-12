"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isComputerUseEnabled = isComputerUseEnabled;
exports.syncComputerUseMcp = syncComputerUseMcp;
/**
 * Computer Use 相关：开关读取 / MCP 配置同步
 *
 * 从 main.js setupIpc 闭包内提取的纯函数。IPC handler 留在 ipc-handlers.ts。
 */
const fs_1 = __importDefault(require("fs"));
const constants_1 = require("./constants");
/** 读取 Computer Use 开关状态（默认关） */
function isComputerUseEnabled() {
    try {
        if (!fs_1.default.existsSync(constants_1.COMPUTER_USE_ENABLED_FILE))
            return false;
        return fs_1.default.readFileSync(constants_1.COMPUTER_USE_ENABLED_FILE, 'utf8').trim() === 'true';
    }
    catch {
        return false;
    }
}
/**
 * 同步 Computer Use MCP 配置到开关状态。
 * 仓库里 mcp.json 用 {{PORTABLE_ROOT}} 占位符，运行时替换为真实便携根目录。
 */
function syncComputerUseMcp(enabled) {
    try {
        const p = constants_1.COMPUTER_USE_MCP_JSON;
        if (!fs_1.default.existsSync(p))
            return;
        let raw = fs_1.default.readFileSync(p, 'utf8');
        const rootSlash = constants_1.PORTABLE_ROOT.replace(/\\/g, '/');
        raw = raw.split('{{PORTABLE_ROOT}}').join(rootSlash);
        const cfg = JSON.parse(raw);
        if (cfg.mcpServers && cfg.mcpServers['computer-use']) {
            cfg.mcpServers['computer-use'].enabled = enabled;
            fs_1.default.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
        }
    }
    catch (err) {
        console.error('[主进程] syncComputerUseMcp 失败:', err.message);
    }
}
//# sourceMappingURL=computer-use-utils.js.map