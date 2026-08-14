"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSessionIdFromPath = extractSessionIdFromPath;
exports.encodeSessionDirName = encodeSessionDirName;
exports._encodeSessionDirName = _encodeSessionDirName;
exports.extractWorkspaceSuffix = extractWorkspaceSuffix;
exports.stableSessionDirName = stableSessionDirName;
exports.findSessionFile = findSessionFile;
exports.rotateLogIfNeeded = rotateLogIfNeeded;
exports.mainLog = mainLog;
exports.readTailLines = readTailLines;
exports.parseSessionLines = parseSessionLines;
exports.decodeSessionDirName = decodeSessionDirName;
exports.extractCwdFromSessionDir = extractCwdFromSessionDir;
exports.isEmptySessionDir = isEmptySessionDir;
exports.cwdDisplayName = cwdDisplayName;
exports.parseSessionHeader = parseSessionHeader;
exports.tryGenerateSessionTitle = tryGenerateSessionTitle;
exports.parseMdField = parseMdField;
/**
 * 会话工具函数：ID 提取 / 目录编码 / 日志 / 历史读取 / 标题生成
 *
 * 从 main.js 搬移的纯函数集合。不依赖 Electron 运行时，可独立单测。
 * 依赖：constants (PORTABLE_ROOT, SESSIONS_DIR), types
 */
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const constants_1 = require("./constants");
// ── 会话 ID 工具 ──
/** 从 sessionPath 提取 UUID（与 renderer extractSessionId 一致） */
function extractSessionIdFromPath(sessionPath) {
    if (!sessionPath)
        return null;
    const match = String(sessionPath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
    return match ? match[1] : null;
}
// ── 会话目录名编码（与内核 cli.js WR5/d46 编码一致）──
// G:\Tiffa\workspace\Tiffa开发 -> --G--Tiffa-workspace-Tiffa开发--
function encodeSessionDirName(cwdPath) {
    return stableSessionDirName(cwdPath);
}
function _encodeSessionDirName(cwdPath) {
    const resolved = path_1.default.resolve(cwdPath);
    const stripped = resolved.replace(/^[/\\]/, '');
    const encoded = stripped.replace(/[/\\:]/g, '-');
    return '--' + encoded + '--';
}
/**
 * 提取 workspace/ 之后的相对路径后缀。
 * 品牌无关：优先按当前 PORTABLE_ROOT 下的 workspace 匹配（根目录改名也兼容），
 * 并兼容旧包曾放到其他盘符的迁移场景（任意 .../workspace/ 都提取后缀）。
 */
function extractWorkspaceSuffix(absPath) {
    const normalized = absPath.replace(/\\/g, '/');
    // 1) 当前 PORTABLE_ROOT 下的 workspace
    const workspaceRoot = path_1.default.join(constants_1.PORTABLE_ROOT, 'workspace').replace(/\\/g, '/');
    if (normalized.toLowerCase().startsWith(workspaceRoot.toLowerCase() + '/')) {
        return normalized.slice(workspaceRoot.length + 1).replace(/\//g, path_1.default.sep);
    }
    // 2) 兼容迁移：旧包挪到别的盘符，按 .../workspace/ 提取相对后缀
    const match = normalized.match(/\/workspace\/(.+)$/i);
    if (match)
        return match[1].replace(/\//g, path_1.default.sep);
    return null;
}
/**
 * 稳定会话目录名（与盘符/路径解耦）。
 * workspace 项目用「workspace 相对后缀」做稳定名，外部文件夹保持原 cwd 编码。
 */
function stableSessionDirName(cwdPath) {
    const normalized = path_1.default.resolve(cwdPath);
    const suffix = extractWorkspaceSuffix(normalized);
    if (suffix) {
        const safe = suffix.replace(/[/\\:]/g, '-');
        return '--wks-' + safe + '--';
    }
    return _encodeSessionDirName(cwdPath);
}
// ── 查找会话 JSONL 文件 ──
/**
 * 给定 cwd + sessionId，在 SESSIONS_DIR 下定位匹配的 .jsonl。
 * 两种存放模式：1. 直接 *_<uuid>.jsonl  2. 子目录 *_<uuid>/<name>.jsonl
 * 兜底：扫描所有会话目录按 sessionId 匹配。
 */
function findSessionFile(cwd, sessionId) {
    if (!cwd || !sessionId)
        return null;
    const dirName = stableSessionDirName(cwd);
    const projectDir = path_1.default.join(constants_1.SESSIONS_DIR, dirName);
    if (!fs_1.default.existsSync(projectDir))
        return null;
    const uuidLower = sessionId.toLowerCase();
    try {
        // 模式 1：直接在项目目录下的 *_<uuid>.jsonl
        const directFiles = fs_1.default
            .readdirSync(projectDir)
            .filter((f) => f.endsWith('.jsonl') && f.toLowerCase().includes(uuidLower));
        if (directFiles.length > 0)
            return path_1.default.join(projectDir, directFiles[0]);
        // 模式 2：子目录 *_<uuid>/ 中的 .jsonl
        const subDirs = fs_1.default
            .readdirSync(projectDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.toLowerCase().includes(uuidLower));
        for (const sd of subDirs) {
            const sdPath = path_1.default.join(projectDir, sd.name);
            const jsonlFiles = fs_1.default.readdirSync(sdPath).filter((f) => f.endsWith('.jsonl'));
            if (jsonlFiles.length > 0)
                return path_1.default.join(sdPath, jsonlFiles[0]);
        }
    }
    catch {
        // ignore
    }
    // 兜底：扫描所有会话目录
    try {
        const allDirs = fs_1.default
            .readdirSync(constants_1.SESSIONS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name !== dirName);
        for (const ad of allDirs) {
            const haystack = path_1.default.join(constants_1.SESSIONS_DIR, ad.name);
            const direct = fs_1.default
                .readdirSync(haystack)
                .filter((f) => f.endsWith('.jsonl') && f.toLowerCase().includes(uuidLower));
            if (direct.length > 0)
                return path_1.default.join(haystack, direct[0]);
            const sub = fs_1.default
                .readdirSync(haystack, { withFileTypes: true })
                .filter((d) => d.isDirectory() && d.name.toLowerCase().includes(uuidLower));
            for (const sd of sub) {
                const js = fs_1.default.readdirSync(path_1.default.join(haystack, sd.name)).filter((f) => f.endsWith('.jsonl'));
                if (js.length > 0)
                    return path_1.default.join(haystack, sd.name, js[0]);
            }
        }
    }
    catch {
        // ignore
    }
    return null;
}
// ── 主进程日志 ──
function rotateLogIfNeeded(filePath) {
    try {
        const st = fs_1.default.statSync(filePath);
        if (st.size > 1024 * 1024)
            fs_1.default.renameSync(filePath, filePath + '.old');
    }
    catch {
        // 不存在或轮转失败都不影响追加
    }
}
function mainLog(line) {
    try {
        const filePath = path_1.default.join(constants_1.PORTABLE_ROOT, 'data', 'logs', 'main-ask.log');
        rotateLogIfNeeded(filePath);
        fs_1.default.appendFileSync(filePath, `[${new Date().toISOString()}] ${line}\n`);
    }
    catch {
        // ignore
    }
}
// ── 会话历史增量读取（吸收 dim session-store 的流式/头部读取思路）──
/**
 * 从文件尾部反向读取 wantLines 条完整行（时间正序返回）。
 * 避免 JSONL 全量 JSON.parse 阻塞主进程事件循环。
 */
async function readTailLines(filePath, wantLines) {
    const CHUNK = 512 * 1024;
    const st = await fs_1.default.promises.stat(filePath);
    if (!st.size)
        return { lines: [], reachedStart: true, droppedAny: false };
    const fh = await fs_1.default.promises.open(filePath, 'r');
    try {
        let pos = st.size;
        let carry = '';
        let collected = [];
        let reachedStart = false;
        let droppedAny = false;
        while (pos > 0) {
            const len = Math.min(CHUNK, pos);
            pos -= len;
            const buf = Buffer.alloc(len);
            await fh.read(buf, 0, len, pos);
            // 跳到 UTF-8 字符边界
            let start = 0;
            while (start < buf.length && start < 4 && (buf[start] & 0xc0) === 0x80)
                start++;
            const text = buf.toString('utf8', start);
            const combined = text + carry;
            const parts = combined.split('\n');
            carry = parts.pop() || '';
            if (parts.length) {
                const older = [];
                for (const ln of parts) {
                    if (!ln.trim())
                        continue;
                    older.push(ln);
                }
                if (older.length) {
                    collected = older.concat(collected);
                    if (collected.length > wantLines) {
                        collected = collected.slice(collected.length - wantLines);
                        droppedAny = true;
                    }
                }
            }
            if (collected.length >= wantLines)
                break;
            if (pos === 0)
                reachedStart = true;
        }
        return { lines: collected, reachedStart, droppedAny };
    }
    finally {
        await fh.close();
    }
}
// ── JSONL 行解析 ──
function isTextPart(part) {
    return typeof part === 'object' && part !== null && part.type === 'text';
}
function isThinkingPart(part) {
    return typeof part === 'object' && part !== null && part.type === 'thinking';
}
function isToolUsePart(part) {
    if (typeof part !== 'object' || part === null)
        return false;
    const t = part.type;
    return t === 'tool_use' || t === 'tool_call';
}
/** 把 JSONL 行解析为前端消息数组（单遍：tool_execution_start 参数补全 toolResult） */
function parseSessionLines(lines) {
    const toolMeta = new Map();
    const messages = [];
    for (const line of lines) {
        if (!line)
            continue;
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (obj.type === 'custom' && obj.customType === 'tool_execution_start') {
            const data = obj.data;
            if (data?.toolCallId) {
                toolMeta.set(data.toolCallId, { toolName: data.toolName || '', args: data.args || {} });
            }
            continue;
        }
        if (obj.type !== 'message' || !obj.message)
            continue;
        const msg = obj.message;
        let textContent = '';
        let thinkingContent = '';
        let toolCalls = [];
        if (typeof msg.content === 'string') {
            textContent = msg.content;
        }
        else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (isTextPart(part)) {
                    textContent += part.text;
                }
                else if (isThinkingPart(part)) {
                    thinkingContent += part.thinking;
                }
                else if (isToolUsePart(part)) {
                    toolCalls.push({
                        id: part.id || '',
                        name: part.name || '',
                        input: (part.input ?? part.arguments ?? {}),
                    });
                }
            }
        }
        // toolResult 补全
        if (msg.role === 'toolResult' && msg.toolCallId) {
            const meta = toolMeta.get(msg.toolCallId);
            if (meta) {
                const resultText = Array.isArray(msg.content)
                    ? msg.content.filter(isTextPart).map((c) => c.text).join('')
                    : typeof msg.content === 'string'
                        ? msg.content
                        : '';
                messages.push({
                    role: 'assistant',
                    text: '',
                    thinking: '',
                    toolCalls: [
                        {
                            id: msg.toolCallId,
                            name: meta.toolName || 'tool',
                            input: meta.args,
                            result: resultText.substring(0, 10000),
                            isError: msg.isError || false,
                        },
                    ],
                    timestamp: obj.timestamp || msg.timestamp,
                    model: msg.model || '',
                    provider: msg.provider || '',
                });
                continue;
            }
        }
        messages.push({
            role: msg.role,
            text: textContent,
            thinking: thinkingContent,
            toolCalls,
            timestamp: obj.timestamp || msg.timestamp,
            model: msg.model || '',
            provider: msg.provider || '',
            steering: msg.steering || false,
            follow_up: msg.follow_up || false,
        });
    }
    return messages;
}
// ── 会话目录名解码 / cwd 提取 ──
/**
 * Decode session dir name back to cwd path（有损，仅 fallback）。
 * 可靠来源是 JSONL 文件中的 cwd 字段。
 */
function decodeSessionDirName(dirName) {
    if (!dirName.startsWith('--') || !dirName.endsWith('--'))
        return dirName;
    const inner = dirName.slice(2, -2);
    // Windows 盘符格式: X--rest
    if (/^[A-Z]--/.test(inner)) {
        const drive = inner[0];
        const rest = inner.slice(3);
        return drive + ':\\' + rest.replace(/-/g, '\\');
    }
    return '/' + inner.replace(/-/g, '/');
}
/** 从 JSONL 文件中提取 cwd（可靠来源） */
function extractCwdFromSessionDir(dirPath) {
    try {
        const entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const full = path_1.default.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                const found = extractCwdFromSessionDir(full);
                if (found)
                    return found;
            }
            else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                const stat = fs_1.default.statSync(full);
                const headSize = Math.min(4096, stat.size);
                const fd = fs_1.default.openSync(full, 'r');
                let text;
                try {
                    const buf = Buffer.alloc(headSize);
                    fs_1.default.readSync(fd, buf, 0, headSize, 0);
                    text = buf.toString('utf8');
                }
                finally {
                    fs_1.default.closeSync(fd);
                }
                const lines = text.split('\n').filter((l) => l.trim());
                for (const line of lines) {
                    try {
                        const obj = JSON.parse(line);
                        if (obj.cwd)
                            return obj.cwd;
                    }
                    catch {
                        // skip
                    }
                }
            }
        }
    }
    catch {
        // ignore
    }
    return null;
}
/** 判断 session 目录是否为空 */
function isEmptySessionDir(dirPath) {
    try {
        const entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
        return entries.length === 0;
    }
    catch {
        return false;
    }
}
/** 从 cwd 提取显示名 */
function cwdDisplayName(cwd) {
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || cwd;
}
// ── JSONL header 解析 ──
/** Parse JSONL session file header (first 64KB) */
function parseSessionHeader(filePath) {
    try {
        const stat = fs_1.default.statSync(filePath);
        const headSize = Math.min(65536, stat.size);
        const fd = fs_1.default.openSync(filePath, 'r');
        let text;
        try {
            const buf = Buffer.alloc(headSize);
            fs_1.default.readSync(fd, buf, 0, headSize, 0);
            text = buf.toString('utf8');
        }
        finally {
            fs_1.default.closeSync(fd);
        }
        const lines = text.split('\n').filter((l) => l.trim());
        let title = null;
        let sessionId = null;
        let cwd = null;
        let firstMessage = null;
        let messageCount = 0;
        for (const line of lines) {
            try {
                const obj = JSON.parse(line);
                // title 事件取“最后一个”（覆盖语义）：手动重命名以追加 title 事件行实现，
                // 头部可能有多条旧 title 事件；新追加的（更新的）必须优先。
                if (obj.type === 'title' && obj.title) {
                    title = obj.title;
                }
                if (obj.id && !sessionId && obj.version) {
                    sessionId = obj.id;
                    cwd = obj.cwd || null;
                    if (obj.title && !title)
                        title = obj.title;
                }
                if (obj.message) {
                    messageCount++;
                    const msg = obj.message;
                    if (!firstMessage && msg.role === 'user' && msg.content) {
                        if (typeof msg.content === 'string') {
                            firstMessage = msg.content;
                        }
                        else if (Array.isArray(msg.content)) {
                            const textPart = msg.content.find((c) => typeof c === 'object' && c !== null && c.type === 'text');
                            if (textPart)
                                firstMessage = textPart.text;
                        }
                        if (firstMessage && firstMessage.length > 100) {
                            firstMessage = firstMessage.substring(0, 100) + '...';
                        }
                    }
                }
            }
            catch {
                // skip
            }
        }
        // 追加标题（手动重命名）在文件尾部：头部 64KB 读不到时，扫描文件尾部 4KB
        // 取最新 title 事件（旧实现只扫头部，追加的标题对长会话不生效）
        if (stat.size > headSize) {
            const tailSize = Math.min(4096, stat.size);
            const fd2 = fs_1.default.openSync(filePath, 'r');
            try {
                const buf2 = Buffer.alloc(tailSize);
                fs_1.default.readSync(fd2, buf2, 0, tailSize, stat.size - tailSize);
                const tailLines = buf2.toString('utf8').split('\n').filter((l) => l.trim());
                for (const line of tailLines) {
                    try {
                        const obj = JSON.parse(line);
                        if (obj.type === 'title' && obj.title)
                            title = obj.title;
                    }
                    catch {
                        // skip
                    }
                }
            }
            finally {
                fs_1.default.closeSync(fd2);
            }
        }
        return {
            path: filePath,
            name: path_1.default.basename(filePath, '.jsonl'),
            sessionId,
            cwd,
            title,
            firstMessage: firstMessage || '(空会话)',
            messageCount,
            size: stat.size,
            modified: stat.mtimeMs,
        };
    }
    catch (err) {
        const e = err;
        return {
            path: filePath,
            name: path_1.default.basename(filePath),
            sessionId: null,
            cwd: null,
            title: null,
            firstMessage: '',
            messageCount: 0,
            size: 0,
            modified: 0,
            error: e.message,
        };
    }
}
/**
 * 自动生成会话标题。
 * 读取 JSONL header，若无 title 则从第一条用户消息截取前 25 字，
 * 写入 header.title + 追加 title 事件，然后通过 onNotify 回调通知前端。
 */
function tryGenerateSessionTitle(inst, onNotify) {
    try {
        const sessionPath = inst.sessionFilePath;
        if (!sessionPath)
            return;
        const resolved = path_1.default.resolve(sessionPath);
        if (!resolved.endsWith('.jsonl') || !fs_1.default.existsSync(resolved))
            return;
        const header = parseSessionHeader(resolved);
        if (header.title)
            return;
        if (!header.firstMessage || header.firstMessage === '(空会话)')
            return;
        let title = header.firstMessage;
        title = title.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
        if (title.length > 25)
            title = title.substring(0, 25) + '…';
        if (!title)
            return;
        // 写入 JSONL header + 追加 title 事件
        const fd = fs_1.default.openSync(resolved, 'r+');
        let headerBuf = Buffer.alloc(65536);
        const bytesRead = fs_1.default.readSync(fd, headerBuf, 0, 65536, 0);
        const headerText = headerBuf.toString('utf8', 0, bytesRead);
        const firstNl = headerText.indexOf('\n');
        if (firstNl < 0) {
            fs_1.default.closeSync(fd);
            return;
        }
        const firstLine = headerText.substring(0, firstNl);
        let headerObj;
        try {
            headerObj = JSON.parse(firstLine);
        }
        catch {
            fs_1.default.closeSync(fd);
            return;
        }
        headerObj.title = title;
        const newFirstLine = JSON.stringify(headerObj) + '\n';
        if (newFirstLine.length <= firstLine.length + 1) {
            const padded = newFirstLine.padEnd(firstLine.length + 1, ' ');
            fs_1.default.writeSync(fd, padded, 0, 'utf8');
        }
        fs_1.default.closeSync(fd);
        const titleEvent = JSON.stringify({ type: 'title', v: 1, title, updatedAt: new Date().toISOString(), source: 'auto' }) + '\n';
        fs_1.default.appendFileSync(resolved, titleEvent, 'utf8');
        onNotify(title, inst.sessionId, inst.cwd);
        console.log(`[title-gen] 会话标题已生成: "${title}"`);
    }
    catch (err) {
        console.warn('[title-gen] 生成标题失败:', err.message);
    }
}
// ── Markdown 字段提取 ──
/** 从 markdown 字段行 `- 字段名：值` 提取 value */
function parseMdField(content, field) {
    if (!content)
        return '';
    const re = new RegExp('^\\s*-\\s*' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]\\s*(.+?)\\s*$', 'm');
    const m = content.match(re);
    return m ? m[1].trim() : '';
}
//# sourceMappingURL=session-utils.js.map