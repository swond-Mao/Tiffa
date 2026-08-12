"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readRemovedCwds = readRemovedCwds;
exports.writeRemovedCwds = writeRemovedCwds;
exports.isRemovedCwd = isRemovedCwd;
exports.unremoveCwd = unremoveCwd;
exports.rimraf = rimraf;
exports.rimrafWithRetry = rimrafWithRetry;
exports.readProjectsJson = readProjectsJson;
exports.writeProjectsJson = writeProjectsJson;
exports.ensureProjectInJson = ensureProjectInJson;
exports.cleanupProjectsJson = cleanupProjectsJson;
exports.findProjectByDirName = findProjectByDirName;
exports.sessionFileBelongsToCwd = sessionFileBelongsToCwd;
exports.deleteSessionFilesForCwd = deleteSessionFilesForCwd;
exports.moveSessionFilesForCwd = moveSessionFilesForCwd;
exports.discoverWorkspaceProjects = discoverWorkspaceProjects;
/**
 * 项目/工作空间管理：projects.json 读写 / rimraf / 归档/删除文件操作
 *
 * 从 main.js setupIpc 闭包内提取的纯函数。IPC handler 留在 ipc-handlers.ts。
 * 关闭实例的操作通过 closeInstancesForCwd 回调注入，避免循环依赖。
 */
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const constants_1 = require("./constants");
const session_utils_1 = require("./session-utils");
// ── removedCwds 黑名单 ──
function readRemovedCwds() {
    try {
        if (fs_1.default.existsSync(constants_1.REMOVED_CWDS_FILE))
            return JSON.parse(fs_1.default.readFileSync(constants_1.REMOVED_CWDS_FILE, 'utf8'));
    }
    catch {
        // ignore
    }
    return [];
}
function writeRemovedCwds(list) {
    fs_1.default.writeFileSync(constants_1.REMOVED_CWDS_FILE, JSON.stringify(list), 'utf8');
}
/** 判断路径是否被用户明确删除过（支持 workspace 后缀匹配） */
function isRemovedCwd(absPath) {
    const removedList = readRemovedCwds();
    const lower = absPath.toLowerCase();
    if (removedList.some((c) => c.toLowerCase() === lower))
        return true;
    const mySuffix = (0, session_utils_1.extractWorkspaceSuffix)(absPath);
    if (mySuffix) {
        return removedList.some((c) => {
            const theirSuffix = (0, session_utils_1.extractWorkspaceSuffix)(c);
            return theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase();
        });
    }
    return false;
}
/** 从删除黑名单中移除匹配条目 */
function unremoveCwd(absPath) {
    const removedList = readRemovedCwds();
    const lower = absPath.toLowerCase();
    const mySuffix = (0, session_utils_1.extractWorkspaceSuffix)(absPath);
    const filtered = removedList.filter((c) => {
        if (c.toLowerCase() === lower)
            return false;
        if (mySuffix) {
            const theirSuffix = (0, session_utils_1.extractWorkspaceSuffix)(c);
            if (theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase())
                return false;
        }
        return true;
    });
    if (filtered.length !== removedList.length)
        writeRemovedCwds(filtered);
}
// ── 递归删除 ──
function rimraf(dirPath) {
    if (!fs_1.default.existsSync(dirPath))
        return;
    for (const entry of fs_1.default.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path_1.default.join(dirPath, entry.name);
        if (entry.isDirectory())
            rimraf(full);
        else
            fs_1.default.unlinkSync(full);
    }
    fs_1.default.rmdirSync(dirPath);
}
/** 带重试的递归删除：Windows 上进程刚被杀死时文件句柄可能尚未释放 */
async function rimrafWithRetry(dirPath, maxRetries = 3) {
    for (let attempt = 0;; attempt++) {
        try {
            rimraf(dirPath);
            return;
        }
        catch (err) {
            const code = err.code;
            if (attempt < maxRetries && (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')) {
                console.log(`[rimraf] 文件锁未释放，${400 * (attempt + 1)}ms 后重试 (${attempt + 1}/${maxRetries}): ${dirPath}`);
                await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            }
            else {
                throw err;
            }
        }
    }
}
// ── projects.json 读写 ──
function readProjectsJson() {
    try {
        if (fs_1.default.existsSync(constants_1.PROJECTS_JSON)) {
            const raw = fs_1.default.readFileSync(constants_1.PROJECTS_JSON, 'utf8');
            const data = JSON.parse(raw);
            if (data && Array.isArray(data.projects))
                return data.projects;
        }
    }
    catch {
        // ignore
    }
    return [];
}
function writeProjectsJson(projects) {
    try {
        fs_1.default.writeFileSync(constants_1.PROJECTS_JSON, JSON.stringify({ projects }, null, 2), 'utf8');
    }
    catch {
        // ignore
    }
}
/** 确保项目在 projects.json 中（不存在则添加，已存在则更新 lastOpenedAt） */
function ensureProjectInJson(cwd) {
    const normalized = path_1.default.resolve(cwd);
    if (normalized === constants_1.DEFAULT_WORKSPACE_DIR)
        return normalized;
    if (isRemovedCwd(normalized))
        return normalized;
    if (!fs_1.default.existsSync(normalized)) {
        if ((0, session_utils_1.extractWorkspaceSuffix)(normalized)) {
            const sessionDirName = (0, session_utils_1.encodeSessionDirName)(normalized);
            const sessionDir = path_1.default.join(constants_1.SESSIONS_DIR, sessionDirName);
            if (fs_1.default.existsSync(sessionDir)) {
                fs_1.default.mkdirSync(normalized, { recursive: true });
                console.log(`[projects] 自动创建项目目录(有会话): ${normalized}`);
            }
            else {
                console.warn('[projects] 路径不存在且无会话，跳过注册:', normalized);
                return normalized;
            }
        }
        else {
            console.warn('[projects] 路径不存在，跳过注册:', normalized);
            return normalized;
        }
    }
    const projects = readProjectsJson();
    // 写前去重
    const deduped = [];
    const seenCwds = new Set();
    for (const p of projects) {
        const key = path_1.default.resolve(p.cwd).toLowerCase();
        if (!seenCwds.has(key)) {
            seenCwds.add(key);
            deduped.push(p);
        }
        else {
            console.log(`[projects] 去重: 跳过重复 ${p.cwd}`);
        }
    }
    const hasDupes = deduped.length < projects.length;
    let existing = deduped.find((p) => path_1.default.resolve(p.cwd) === normalized);
    if (!existing) {
        const mySuffix = (0, session_utils_1.extractWorkspaceSuffix)(normalized);
        if (mySuffix) {
            existing = deduped.find((p) => {
                const theirSuffix = (0, session_utils_1.extractWorkspaceSuffix)(path_1.default.resolve(p.cwd));
                return theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase();
            });
        }
    }
    if (!existing) {
        const removedList = readRemovedCwds();
        const normalizedLower = normalized.toLowerCase();
        if (removedList.some((c) => c.toLowerCase() === normalizedLower))
            return normalized;
        deduped.push({
            cwd: normalized,
            displayName: (0, session_utils_1.cwdDisplayName)(normalized),
            addedAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            archived: false,
        });
        writeProjectsJson(deduped);
    }
    else if (existing.archived) {
        if (path_1.default.resolve(existing.cwd) !== normalized) {
            console.log(`[projects] 盘符变化(已归档): ${existing.cwd} -> ${normalized}`);
            existing.cwd = normalized;
            writeProjectsJson(deduped);
        }
    }
    else {
        existing.lastOpenedAt = new Date().toISOString();
        if (path_1.default.resolve(existing.cwd) !== normalized) {
            console.log(`[projects] 盘符变化: ${existing.cwd} -> ${normalized}`);
            existing.cwd = normalized;
        }
        writeProjectsJson(deduped);
    }
    return normalized;
}
/** 清理 projects.json 中路径不存在的幽灵条目 + 去重 */
function cleanupProjectsJson() {
    const projects = readProjectsJson();
    const before = projects.length;
    const seen = new Set();
    const valid = projects.filter((p) => {
        if (path_1.default.resolve(p.cwd) === constants_1.DEFAULT_WORKSPACE_DIR)
            return false;
        if (isRemovedCwd(path_1.default.resolve(p.cwd)))
            return false;
        const normalized = path_1.default.resolve(p.cwd).toLowerCase();
        if (seen.has(normalized))
            return false;
        seen.add(normalized);
        if (p.archived)
            return true;
        const resolved = path_1.default.resolve(p.cwd);
        if ((0, session_utils_1.extractWorkspaceSuffix)(resolved)) {
            if (fs_1.default.existsSync(resolved))
                return true;
            const sessionDirName = (0, session_utils_1.encodeSessionDirName)(resolved);
            const sessionDir = path_1.default.join(constants_1.SESSIONS_DIR, sessionDirName);
            if (fs_1.default.existsSync(sessionDir))
                return true;
            return false;
        }
        return fs_1.default.existsSync(resolved);
    });
    if (valid.length < before) {
        console.log(`[projects] 清理+去重: ${before} -> ${valid.length}`);
        writeProjectsJson(valid);
    }
    return valid;
}
// ── 会话文件归属判断 / 外科手术删除 ──
/** 根据 dirName 查找 projects.json 中对应的项目 */
function findProjectByDirName(dirName) {
    const projects = readProjectsJson();
    for (const p of projects) {
        const normalized = path_1.default.resolve(p.cwd);
        if ((0, session_utils_1.encodeSessionDirName)(normalized) === dirName) {
            return { project: p, allProjects: projects, normalized };
        }
    }
    return { project: null, allProjects: projects, normalized: null };
}
/** 判断会话文件是否属于指定 cwd */
function sessionFileBelongsToCwd(filePath, cwdLower) {
    try {
        const header = (0, session_utils_1.parseSessionHeader)(filePath);
        return header.cwd !== null && path_1.default.resolve(header.cwd).toLowerCase() === cwdLower;
    }
    catch {
        return false;
    }
}
/** 外科手术式删除：只删会话目录中属于指定 cwd 的 .jsonl */
function deleteSessionFilesForCwd(sessionDir, projectCwd) {
    if (!fs_1.default.existsSync(sessionDir))
        return;
    const cwdLower = projectCwd.toLowerCase();
    for (const entry of fs_1.default.readdirSync(sessionDir, { withFileTypes: true })) {
        const full = path_1.default.join(sessionDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            if (sessionFileBelongsToCwd(full, cwdLower)) {
                try {
                    fs_1.default.unlinkSync(full);
                }
                catch { /* ignore */ }
            }
        }
        else if (entry.isDirectory()) {
            for (const sub of fs_1.default.readdirSync(full)) {
                if (!sub.endsWith('.jsonl'))
                    continue;
                const subFull = path_1.default.join(full, sub);
                if (sessionFileBelongsToCwd(subFull, cwdLower)) {
                    try {
                        fs_1.default.unlinkSync(subFull);
                    }
                    catch { /* ignore */ }
                }
            }
            try {
                if (fs_1.default.readdirSync(full).length === 0)
                    fs_1.default.rmdirSync(full);
            }
            catch { /* ignore */ }
        }
    }
    try {
        if (fs_1.default.readdirSync(sessionDir).length === 0)
            fs_1.default.rmdirSync(sessionDir);
    }
    catch { /* ignore */ }
}
/** 外科手术式移动：只把属于指定 cwd 的 .jsonl 移到目标目录 */
function moveSessionFilesForCwd(srcDir, destDir, projectCwd) {
    const cwdLower = projectCwd.toLowerCase();
    for (const entry of fs_1.default.readdirSync(srcDir, { withFileTypes: true })) {
        const full = path_1.default.join(srcDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            if (sessionFileBelongsToCwd(full, cwdLower)) {
                try {
                    fs_1.default.renameSync(full, path_1.default.join(destDir, entry.name));
                }
                catch { /* ignore */ }
            }
        }
        else if (entry.isDirectory()) {
            for (const sub of fs_1.default.readdirSync(full)) {
                if (!sub.endsWith('.jsonl'))
                    continue;
                const subFull = path_1.default.join(full, sub);
                if (sessionFileBelongsToCwd(subFull, cwdLower)) {
                    const subDest = path_1.default.join(destDir, entry.name);
                    if (!fs_1.default.existsSync(subDest))
                        fs_1.default.mkdirSync(subDest, { recursive: true });
                    try {
                        fs_1.default.renameSync(subFull, path_1.default.join(subDest, sub));
                    }
                    catch { /* ignore */ }
                }
            }
            try {
                if (fs_1.default.readdirSync(full).length === 0)
                    fs_1.default.rmdirSync(full);
            }
            catch { /* ignore */ }
        }
    }
    try {
        if (fs_1.default.readdirSync(srcDir).length === 0)
            fs_1.default.rmdirSync(srcDir);
    }
    catch { /* ignore */ }
}
/** 自动发现 workspace 下的子目录，注册到 projects.json */
function discoverWorkspaceProjects() {
    if (!fs_1.default.existsSync(constants_1.DEFAULT_WORKSPACE_DIR))
        return;
    try {
        const entries = fs_1.default.readdirSync(constants_1.DEFAULT_WORKSPACE_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const subDir = path_1.default.join(constants_1.DEFAULT_WORKSPACE_DIR, entry.name);
            ensureProjectInJson(subDir);
        }
    }
    catch (err) {
        console.warn('[discover] 扫描 workspace 子目录失败:', err.message);
    }
}
//# sourceMappingURL=project-utils.js.map