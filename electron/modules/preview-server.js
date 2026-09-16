"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPreviewMainWindowGetter = setPreviewMainWindowGetter;
exports.registerPreview = registerPreview;
exports.unregisterPreview = unregisterPreview;
exports.stopPreviewServer = stopPreviewServer;
exports.startPreviewServer = startPreviewServer;
/**
 * Tiffa 内置预览服务（回环 HTTP + 文件监听）
 *
 * 为什么是 HTTP 服务而不是 iframe srcDoc：
 * 真实前端页面靠相对路径引用 css/js/图片。srcDoc 的文档基址是 `about:srcdoc`，
 * `<link href="styles.css">` 一律解析失败 —— 结果就是「页面能开但样式全丢」，
 * 用户看到的和开发者看到的不是一回事，等于没预览。起了回环服务后，文档基址是
 * `http://127.0.0.1:<port>/preview/<id>/`，同目录相对资源天然可解析。
 *
 * 安全边界（三条，缺一不可）：
 * 1. 只监听 127.0.0.1，端口被占则自增（同 web-search-proxy 策略）
 * 2. 只服务「已登记」的文件：id 由 registerPreview() 颁发，未登记的 id 直接 404，
 *    不能靠猜 id 遍历便携盘
 * 3. 路径穿越防护：解码后 resolve，必须仍在该 id 的根目录内，否则 403
 *
 * 文件监听：fs.watch 所在目录（非递归），200ms 去抖合并编辑器的原子写
 * （rename + change 连发）；变化后向渲染层推 preview:changed，面板换 iframe key 重载。
 */
const node_http_1 = __importDefault(require("node:http"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
const BASE_PORT = 18890;
const PORT_SPAN = 20;
/** 去抖窗口：VSCode 类编辑器的原子写会连发 rename+change，合并成一次刷新 */
const WATCH_DEBOUNCE_MS = 200;
/** 单文件大小上限：预览页可能引到大图，超过则拒绝（对齐 fs:readFile 的量级） */
const MAX_SERVE_BYTES = 20 * 1024 * 1024;
const MIME_BY_EXT = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".cjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
    ".txt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".wasm": "application/wasm",
};
const entries = new Map();
/** 按绝对路径（小写）复用 id：同一文件重复登记不新建监听 */
const idsByFile = new Map();
let server = null;
let actualPort = 0;
/** 窗口可被重建，故持 getter 而非引用 */
let mainWindowGetter = null;
function setPreviewMainWindowGetter(fn) {
    mainWindowGetter = fn;
}
/** 越界判定：target 必须严格落在 root 内（含 root 自身） */
function isInsideRoot(root, target) {
    const r = node_path_1.default.resolve(root);
    const t = node_path_1.default.resolve(target);
    return t === r || t.startsWith(r + node_path_1.default.sep);
}
function sendText(res, status, body) {
    res.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
    });
    res.end(body);
}
function serveFile(entry, relPath, res) {
    let decoded;
    try {
        decoded = decodeURIComponent(relPath);
    }
    catch {
        sendText(res, 400, "bad percent-encoding");
        return;
    }
    // 先归一化再判越界：`..` 与指向外部的符号链接都在这一步被拦掉
    const target = node_path_1.default.resolve(entry.dir, "." + node_path_1.default.sep + decoded.replace(/^[/\\]+/, ""));
    if (!isInsideRoot(entry.dir, target)) {
        sendText(res, 403, "forbidden: outside preview root");
        return;
    }
    node_fs_1.default.stat(target, (err, st) => {
        if (err || !st.isFile()) {
            sendText(res, 404, "not found");
            return;
        }
        if (st.size > MAX_SERVE_BYTES) {
            sendText(res, 413, `file too large (${(st.size / 1048576).toFixed(1)}MB)`);
            return;
        }
        res.writeHead(200, {
            "Content-Type": MIME_BY_EXT[node_path_1.default.extname(target).toLowerCase()] || "application/octet-stream",
            "Content-Length": st.size,
            // 必须 no-store：否则热更新时 Chromium 命中内存缓存，改了文件页面却不更新
            "Cache-Control": "no-store, must-revalidate",
            "X-Content-Type-Options": "nosniff",
        });
        const stream = node_fs_1.default.createReadStream(target);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
    });
}
// TIFFA_PREVIEW_HOST_GUARD_BEGIN:helper
/**
 * Host 头是否指向回环主机（端口任意）。
 * 绑 127.0.0.1 只挡住「别的机器」，挡不住 DNS 重绑定：evil.com 解析到
 * 127.0.0.1 后，浏览器视其为同源，能直接读走预览文件内容。故按 Host 拒绝。
 */
function isLoopbackHost(host) {
    if (!host)
        return false;
    const h = host.toLowerCase().replace(/:\d+$/, '');
    return (h === 'localhost' ||
        h === '[::1]' ||
        h === '::1' ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h));
}
// TIFFA_PREVIEW_HOST_GUARD_END:helper
function handleRequest(req, res) {
    // TIFFA_PREVIEW_HOST_GUARD_BEGIN:check
    if (!isLoopbackHost(req.headers.host)) {
        sendText(res, 403, 'forbidden: non-loopback Host');
        return;
    }
    // TIFFA_PREVIEW_HOST_GUARD_END:check
    const u = new URL(req.url || "/", "http://127.0.0.1/");
    if (u.pathname === "/health") {
        sendText(res, 200, "ok");
        return;
    }
    const m = /^\/preview\/([^/]+)\/?(.*)$/.exec(u.pathname);
    if (!m) {
        sendText(res, 404, "not found");
        return;
    }
    const entry = entries.get(m[1]);
    if (!entry) {
        sendText(res, 404, "unknown or expired preview id");
        return;
    }
    serveFile(entry, m[2] && m[2].length ? m[2] : node_path_1.default.basename(entry.file), res);
}
function notifyChanged(entry) {
    entry.rev++;
    const win = mainWindowGetter ? mainWindowGetter() : null;
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed())
        return;
    win.webContents.send("preview:changed", { id: entry.id, file: entry.file, rev: entry.rev });
}
/** 起目录监听（非递归）；同目录其它文件的变化不触发重载，它们只是被引用的资源 */
function attachWatcher(entry) {
    if (entry.watcher)
        return;
    try {
        entry.watcher = node_fs_1.default.watch(entry.dir, { persistent: false }, (_event, filename) => {
            if (filename && node_path_1.default.basename(String(filename)) !== node_path_1.default.basename(entry.file))
                return;
            clearTimeout(entry.timer ?? undefined);
            entry.timer = setTimeout(() => {
                entry.timer = null;
                notifyChanged(entry);
            }, WATCH_DEBOUNCE_MS);
        });
        entry.watcher.on("error", () => {
            // 目录被删/移动硬盘拔盘符：摘掉监听，不抛（下次登记会重建）
            try {
                entry.watcher?.close();
            }
            catch {
                /* ignore */
            }
            entry.watcher = undefined;
        });
    }
    catch {
        entry.watcher = undefined;
    }
}
/**
 * 登记一个文件为可预览对象。同一路径重复登记返回同一 id（幂等）。
 * 便携盘场景下路径必须落在 PORTABLE_ROOT 内（与 fs:writeFile 同一条校验）。
 */
function registerPreview(absFile) {
    const file = node_path_1.default.resolve(absFile);
    if (!node_fs_1.default.existsSync(file) || !node_fs_1.default.statSync(file).isFile()) {
        return { ok: false, error: `文件不存在：${file}` };
    }
    if (!isInsideRoot(constants_1.PORTABLE_ROOT, file)) {
        return { ok: false, error: "路径不在便携根目录内，已拒绝预览" };
    }
    const existing = entries.get(idsByFile.get(file.toLowerCase()) ?? "");
    if (existing) {
        attachWatcher(existing);
        return { ok: true, ...snapshot(existing) };
    }
    const entry = {
        id: (0, node_crypto_1.randomUUID)().slice(0, 8),
        url: "",
        file,
        rev: 0,
        dir: node_path_1.default.dirname(file),
    };
    entry.url = `http://127.0.0.1:${actualPort}/preview/${entry.id}/${encodeURIComponent(node_path_1.default.basename(file))}`;
    entries.set(entry.id, entry);
    idsByFile.set(file.toLowerCase(), entry.id);
    attachWatcher(entry);
    return { ok: true, ...snapshot(entry) };
}
function snapshot(e) {
    return { id: e.id, url: e.url, file: e.file, rev: e.rev };
}
function unregisterPreview(id) {
    const e = entries.get(id);
    if (!e)
        return;
    clearTimeout(e.timer ?? undefined);
    try {
        e.watcher?.close();
    }
    catch {
        /* ignore */
    }
    entries.delete(id);
    idsByFile.delete(e.file.toLowerCase());
}
function stopPreviewServer() {
    for (const id of [...entries.keys()])
        unregisterPreview(id);
    if (!server)
        return;
    try {
        server.close();
    }
    catch {
        /* ignore */
    }
    server = null;
}
/**
 * 起服务。用 executor 形式（非 Promise.withResolvers）：主进程 tsconfig lib=ES2022
 * 无该类型声明，且端口自重重试需要在 error 事件里回调 listen —— 与
 * web-search-proxy.ts 同构，保持一致。
 */
function startPreviewServer() {
    return new Promise((resolve, reject) => {
        const s = node_http_1.default.createServer((req, res) => {
            try {
                handleRequest(req, res);
            }
            catch (e) {
                sendText(res, 500, String(e));
            }
        });
        let port = BASE_PORT;
        s.on("error", (e) => {
            if (e.code === "EADDRINUSE" && port < BASE_PORT + PORT_SPAN) {
                port++;
                s.listen(port, "127.0.0.1");
            }
            else {
                reject(e);
            }
        });
        s.listen(port, "127.0.0.1", () => {
            actualPort = port;
            server = s;
            // 端口在登记前可能自增过（旧登记 URL 失效），清空重登记比留脏 URL 安全
            for (const id of [...entries.keys()])
                unregisterPreview(id);
            resolve(port);
        });
    });
}
//# sourceMappingURL=preview-server.js.map