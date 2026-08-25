"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCustomStartupImage = syncCustomStartupImage;
exports.createWindow = createWindow;
/**
 * 窗口创建：自定义启动页图片 + createWindow + 外部链接兜底拦截
 *
 * 从 main.js 搬移。mainWindow 引用通过 tiffa-instance 的 setMainWindow 注入。
 */
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_1 = require("electron");
const constants_1 = require("./constants");
const tiffa_instance_1 = require("./tiffa-instance");
const STARTUP_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
// 本模块编译产物位于 electron/modules/，上级 electron/ 才是资源所在目录（与拆模块前 main.js 的 __dirname 一致）
const APP_DIR = path_1.default.join(__dirname, '..');
const CUSTOM_STARTUP_DIST_DIR = path_1.default.join(APP_DIR, 'renderer', 'dist', 'assets');
const MAX_STARTUP_IMAGE = 20 * 1024 * 1024; // 上限 20MB，防启动卡顿
/** 同步自定义启动页图片（复制到 dist/assets，供渲染层相对路径引用） */
function syncCustomStartupImage() {
    try {
        // 先清旧残留：用户删除图后必须回退默认图，不能残留旧自定义图
        for (const ext of STARTUP_IMAGE_EXTS) {
            const stale = path_1.default.join(CUSTOM_STARTUP_DIST_DIR, `startup-custom.${ext}`);
            if (fs_1.default.existsSync(stale))
                fs_1.default.rmSync(stale);
        }
        const source = STARTUP_IMAGE_EXTS
            .map((ext) => path_1.default.join(constants_1.PORTABLE_ROOT, 'data', `startup-image.${ext}`))
            .find((p) => fs_1.default.existsSync(p));
        if (!source)
            return null;
        if (fs_1.default.statSync(source).size > MAX_STARTUP_IMAGE)
            return null;
        const ext = path_1.default.extname(source).toLowerCase();
        fs_1.default.mkdirSync(CUSTOM_STARTUP_DIST_DIR, { recursive: true });
        fs_1.default.copyFileSync(source, path_1.default.join(CUSTOM_STARTUP_DIST_DIR, `startup-custom${ext}`));
        return { url: `assets/startup-custom${ext}` };
    }
    catch {
        return null;
    }
}
/** 创建主窗口 */
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1600,
        height: 1000,
        minWidth: 1100,
        minHeight: 720,
        title: 'Tiffa',
        icon: path_1.default.join(APP_DIR, 'assets', 'tiffa-icon.ico'),
        backgroundColor: '#1a1a2e',
        show: false,
        webPreferences: {
            preload: path_1.default.join(APP_DIR, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    (0, tiffa_instance_1.setMainWindow)(win);
    syncCustomStartupImage();
    win.loadFile(path_1.default.join(APP_DIR, 'renderer', 'dist', 'index.html'));
    win.setMenu(null);
    win.once('ready-to-show', () => {
        win.show();
    });
    win.on('closed', () => {
        (0, tiffa_instance_1.setMainWindow)(null);
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
            electron_1.shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (/^https?:\/\//.test(url)) {
            e.preventDefault();
            electron_1.shell.openExternal(url);
        }
    });
    return win;
}
//# sourceMappingURL=window-setup.js.map