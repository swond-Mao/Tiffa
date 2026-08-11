/**
 * 进程工具：树杀 / UTF-8 环境变量
 *
 * 从 main.js 顶层提取，供 tiffa-instance 和 ipc-handlers 使用。
 */
import cp from 'child_process';

/** Windows 进程树杀（SIGTERM/SIGKILL 在 Windows 上不可靠） */
export function killTree(pid: number | undefined, sync = false): void {
  if (!pid) return;
  if (process.platform !== 'win32') {
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    return;
  }
  try {
    const args = ['/PID', String(pid), '/T', '/F'];
    if (sync) {
      cp.spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    } else {
      cp.spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    }
  } catch {
    // ignore
  }
}

/** UTF-8 环境变量注入（治理中文乱码） */
export function utf8Env(): Record<string, string> {
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
