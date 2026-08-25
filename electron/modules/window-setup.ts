/**
 * 窗口创建：自定义启动页图片 + createWindow + 外部链接兜底拦截
 *
 * 从 main.js 搬移。mainWindow 引用通过 tiffa-instance 的 setMainWindow 注入。
 */
import path from 'path';
import fs from 'fs';
import { BrowserWindow, shell } from 'electron';
import { PORTABLE_ROOT } from './constants';
import { setMainWindow } from './tiffa-instance';

const STARTUP_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
// 本模块编译产物位于 electron/modules/，上级 electron/ 才是资源所在目录（与拆模块前 main.js 的 __dirname 一致）
const APP_DIR = path.join(__dirname, '..');
const CUSTOM_STARTUP_DIST_DIR = path.join(APP_DIR, 'renderer', 'dist', 'assets');
const MAX_STARTUP_IMAGE = 20 * 1024 * 1024; // 上限 20MB，防启动卡顿

/** 同步自定义启动页图片（复制到 dist/assets，供渲染层相对路径引用） */
export function syncCustomStartupImage(): { url: string } | null {
  try {
    // 先清旧残留：用户删除图后必须回退默认图，不能残留旧自定义图
    for (const ext of STARTUP_IMAGE_EXTS) {
      const stale = path.join(CUSTOM_STARTUP_DIST_DIR, `startup-custom.${ext}`);
      if (fs.existsSync(stale)) fs.rmSync(stale);
    }
    const source = STARTUP_IMAGE_EXTS
      .map((ext) => path.join(PORTABLE_ROOT, 'data', `startup-image.${ext}`))
      .find((p) => fs.existsSync(p));
    if (!source) return null;
    if (fs.statSync(source).size > MAX_STARTUP_IMAGE) return null;
    const ext = path.extname(source).toLowerCase();
    fs.mkdirSync(CUSTOM_STARTUP_DIST_DIR, { recursive: true });
    fs.copyFileSync(source, path.join(CUSTOM_STARTUP_DIST_DIR, `startup-custom${ext}`));
    return { url: `assets/startup-custom${ext}` };
  } catch {
    return null;
  }
}

/** 创建主窗口 */
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    title: 'Tiffa',
    icon: path.join(APP_DIR, 'assets', 'tiffa-icon.ico'),
    backgroundColor: '#1a1a2e',
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  setMainWindow(win);
  syncCustomStartupImage();
  win.loadFile(path.join(APP_DIR, 'renderer', 'dist', 'index.html'));
  win.setMenu(null);
  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    setMainWindow(null);
  });

  if (process.argv.includes('--dev') || process.argv.includes('--verbose')) {
    win.webContents.openDevTools();
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
    // F5 / Ctrl+R 刷新渲染层（改了前端后无需重启应用；主进程与内核会话不受影响）
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) {
      win.webContents.reload();
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (/^https?:\/\//.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}
