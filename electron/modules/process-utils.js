"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.killTree = killTree;
exports.utf8Env = utf8Env;
/**
 * 进程工具：树杀 / UTF-8 环境变量
 *
 * 从 main.js 顶层提取，供 tiffa-instance 和 ipc-handlers 使用。
 */
const child_process_1 = __importDefault(require("child_process"));
/** Windows 进程树杀（SIGTERM/SIGKILL 在 Windows 上不可靠） */
function killTree(pid, sync = false) {
    if (!pid)
        return;
    if (process.platform !== 'win32') {
        try {
            process.kill(pid, 'SIGKILL');
        }
        catch { /* ignore */ }
        return;
    }
    try {
        const args = ['/PID', String(pid), '/T', '/F'];
        if (sync) {
            child_process_1.default.spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
        }
        else {
            child_process_1.default.spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
        }
    }
    catch {
        // ignore
    }
}
/** UTF-8 环境变量注入（治理中文乱码） */
function utf8Env() {
    return {
        // --- POSIX shell (Git Bash / MSYS2 / WSL) ---
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        // --- Python ---
        PYTHONIOENCODING: 'utf-8:replace',
        PYTHONUTF8: '1',
        PYTHONLEGACYWINDOWSSTDIO: 'utf-8',
        // --- General ---
        NO_COLOR: '1',
    };
}
//# sourceMappingURL=process-utils.js.map