"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentWorkspaceDir = exports.LRU_KEEP_ALIVE_MS = exports.MAX_INSTANCES = exports.AGENT_DIR = exports.COMPUTER_USE_MCP_JSON = exports.COMPUTER_USE_ENABLED_FILE = exports.REMOVED_CWDS_FILE = exports.PROJECTS_JSON = exports.ARCHIVE_DIR = exports.SESSIONS_DIR = exports.DEFAULT_WORKSPACE_DIR = exports.COMPUTER_USE_EXTENSION_PATH = exports.EXTENSION_PATH = exports.TIFFA_CLI = exports.BUN_EXE = exports.PORTABLE_ROOT = void 0;
exports.setCurrentWorkspaceDir = setCurrentWorkspaceDir;
/**
 * 主进程共享常量
 *
 * 从 main.ts 顶层 Configuration 区域提取，供所有子模块导入。
 * 纯计算无副作用，PORTABLE_ROOT 解析逻辑与 main.js 一致。
 */
const path_1 = __importDefault(require("path"));
function resolvePortableRoot() {
    const argRootIdx = process.argv.indexOf('--portable-root');
    if (argRootIdx >= 0 && process.argv[argRootIdx + 1]) {
        return path_1.default.resolve(process.argv[argRootIdx + 1]);
    }
    if (process.env.PORTABLE_ROOT) {
        return path_1.default.resolve(process.env.PORTABLE_ROOT);
    }
    // main.js 已先设置 global.PORTABLE_ROOT（其 __dirname 为 electron/，向上一级即便携根）
    const g = global.PORTABLE_ROOT;
    if (typeof g === 'string' && g) {
        return path_1.default.resolve(g);
    }
    // 兜底：本模块编译产物位于 electron/modules/，向上两级才是便携根（勿用单级 ..，否则指向 electron/）
    return path_1.default.resolve(__dirname, '..', '..');
}
exports.PORTABLE_ROOT = resolvePortableRoot();
exports.BUN_EXE = path_1.default.join(exports.PORTABLE_ROOT, 'npm-global', 'node_modules', 'bun', 'bin', 'bun.exe');
exports.TIFFA_CLI = path_1.default.join(exports.PORTABLE_ROOT, 'npm-global', 'node_modules', '@oh-my-pi', 'pi-coding-agent', 'dist', 'cli.js');
exports.EXTENSION_PATH = path_1.default.join(exports.PORTABLE_ROOT, 'plugins', 'claude-mode-extension.ts');
exports.COMPUTER_USE_EXTENSION_PATH = path_1.default.join(exports.PORTABLE_ROOT, 'plugins', 'computer-use-extension.ts');
exports.DEFAULT_WORKSPACE_DIR = path_1.default.join(exports.PORTABLE_ROOT, 'workspace');
exports.SESSIONS_DIR = path_1.default.join(exports.PORTABLE_ROOT, 'data', 'agent', 'sessions');
exports.ARCHIVE_DIR = path_1.default.join(exports.PORTABLE_ROOT, 'data', 'agent', 'sessions-archive');
exports.PROJECTS_JSON = path_1.default.join(exports.PORTABLE_ROOT, 'data', 'agent', 'projects.json');
exports.REMOVED_CWDS_FILE = path_1.default.join(exports.PORTABLE_ROOT, 'data', 'agent', 'removed-cwds.json');
exports.COMPUTER_USE_ENABLED_FILE = path_1.default.join(exports.PORTABLE_ROOT, 'data', 'agent', 'computer-use-enabled');
exports.COMPUTER_USE_MCP_JSON = path_1.default.join(exports.PORTABLE_ROOT, 'data', 'agent', 'mcp.json');
exports.AGENT_DIR = path_1.default.join(exports.PORTABLE_ROOT, 'data', 'agent');
exports.MAX_INSTANCES = 8;
exports.LRU_KEEP_ALIVE_MS = 5 * 60 * 1000;
exports.currentWorkspaceDir = exports.DEFAULT_WORKSPACE_DIR;
function setCurrentWorkspaceDir(dir) {
    exports.currentWorkspaceDir = dir;
}
//# sourceMappingURL=constants.js.map