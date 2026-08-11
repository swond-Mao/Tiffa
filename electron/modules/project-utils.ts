/**
 * 项目/工作空间管理：projects.json 读写 / rimraf / 归档/删除文件操作
 *
 * 从 main.js setupIpc 闭包内提取的纯函数。IPC handler 留在 ipc-handlers.ts。
 * 关闭实例的操作通过 closeInstancesForCwd 回调注入，避免循环依赖。
 */
import path from 'path';
import fs from 'fs';
import {
  PORTABLE_ROOT,
  SESSIONS_DIR,
  ARCHIVE_DIR,
  PROJECTS_JSON,
  REMOVED_CWDS_FILE,
  DEFAULT_WORKSPACE_DIR,
} from './constants';
import {
  extractWorkspaceSuffix,
  encodeSessionDirName,
  cwdDisplayName,
  parseSessionHeader,
} from './session-utils';
import type { SessionHeader } from './types';

export interface ProjectEntry {
  cwd: string;
  displayName: string;
  addedAt: string;
  lastOpenedAt: string;
  archived: boolean;
  archivedAt?: string;
}

// ── removedCwds 黑名单 ──

export function readRemovedCwds(): string[] {
  try {
    if (fs.existsSync(REMOVED_CWDS_FILE)) return JSON.parse(fs.readFileSync(REMOVED_CWDS_FILE, 'utf8'));
  } catch {
    // ignore
  }
  return [];
}

export function writeRemovedCwds(list: string[]): void {
  fs.writeFileSync(REMOVED_CWDS_FILE, JSON.stringify(list), 'utf8');
}

/** 判断路径是否被用户明确删除过（支持 workspace 后缀匹配） */
export function isRemovedCwd(absPath: string): boolean {
  const removedList = readRemovedCwds();
  const lower = absPath.toLowerCase();
  if (removedList.some((c) => c.toLowerCase() === lower)) return true;
  const mySuffix = extractWorkspaceSuffix(absPath);
  if (mySuffix) {
    return removedList.some((c) => {
      const theirSuffix = extractWorkspaceSuffix(c);
      return theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase();
    });
  }
  return false;
}

/** 从删除黑名单中移除匹配条目 */
export function unremoveCwd(absPath: string): void {
  const removedList = readRemovedCwds();
  const lower = absPath.toLowerCase();
  const mySuffix = extractWorkspaceSuffix(absPath);
  const filtered = removedList.filter((c) => {
    if (c.toLowerCase() === lower) return false;
    if (mySuffix) {
      const theirSuffix = extractWorkspaceSuffix(c);
      if (theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase()) return false;
    }
    return true;
  });
  if (filtered.length !== removedList.length) writeRemovedCwds(filtered);
}

// ── 递归删除 ──

export function rimraf(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) rimraf(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(dirPath);
}

/** 带重试的递归删除：Windows 上进程刚被杀死时文件句柄可能尚未释放 */
export async function rimrafWithRetry(dirPath: string, maxRetries = 3): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      rimraf(dirPath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < maxRetries && (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')) {
        console.log(`[rimraf] 文件锁未释放，${400 * (attempt + 1)}ms 后重试 (${attempt + 1}/${maxRetries}): ${dirPath}`);
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

// ── projects.json 读写 ──

export function readProjectsJson(): ProjectEntry[] {
  try {
    if (fs.existsSync(PROJECTS_JSON)) {
      const raw = fs.readFileSync(PROJECTS_JSON, 'utf8');
      const data = JSON.parse(raw) as { projects?: ProjectEntry[] };
      if (data && Array.isArray(data.projects)) return data.projects;
    }
  } catch {
    // ignore
  }
  return [];
}

export function writeProjectsJson(projects: ProjectEntry[]): void {
  try {
    fs.writeFileSync(PROJECTS_JSON, JSON.stringify({ projects }, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

/** 确保项目在 projects.json 中（不存在则添加，已存在则更新 lastOpenedAt） */
export function ensureProjectInJson(cwd: string): string {
  const normalized = path.resolve(cwd);
  if (normalized === DEFAULT_WORKSPACE_DIR) return normalized;
  if (isRemovedCwd(normalized)) return normalized;

  if (!fs.existsSync(normalized)) {
    if (extractWorkspaceSuffix(normalized)) {
      const sessionDirName = encodeSessionDirName(normalized);
      const sessionDir = path.join(SESSIONS_DIR, sessionDirName);
      if (fs.existsSync(sessionDir)) {
        fs.mkdirSync(normalized, { recursive: true });
        console.log(`[projects] 自动创建项目目录(有会话): ${normalized}`);
      } else {
        console.warn('[projects] 路径不存在且无会话，跳过注册:', normalized);
        return normalized;
      }
    } else {
      console.warn('[projects] 路径不存在，跳过注册:', normalized);
      return normalized;
    }
  }
  const projects = readProjectsJson();

  // 写前去重
  const deduped: ProjectEntry[] = [];
  const seenCwds = new Set<string>();
  for (const p of projects) {
    const key = path.resolve(p.cwd).toLowerCase();
    if (!seenCwds.has(key)) {
      seenCwds.add(key);
      deduped.push(p);
    } else {
      console.log(`[projects] 去重: 跳过重复 ${p.cwd}`);
    }
  }
  const hasDupes = deduped.length < projects.length;

  let existing = deduped.find((p) => path.resolve(p.cwd) === normalized);
  if (!existing) {
    const mySuffix = extractWorkspaceSuffix(normalized);
    if (mySuffix) {
      existing = deduped.find((p) => {
        const theirSuffix = extractWorkspaceSuffix(path.resolve(p.cwd));
        return theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase();
      });
    }
  }
  if (!existing) {
    const removedList = readRemovedCwds();
    const normalizedLower = normalized.toLowerCase();
    if (removedList.some((c) => c.toLowerCase() === normalizedLower)) return normalized;
    deduped.push({
      cwd: normalized,
      displayName: cwdDisplayName(normalized),
      addedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      archived: false,
    });
    writeProjectsJson(deduped);
  } else if (existing.archived) {
    if (path.resolve(existing.cwd) !== normalized) {
      console.log(`[projects] 盘符变化(已归档): ${existing.cwd} -> ${normalized}`);
      existing.cwd = normalized;
      writeProjectsJson(deduped);
    }
  } else {
    existing.lastOpenedAt = new Date().toISOString();
    if (path.resolve(existing.cwd) !== normalized) {
      console.log(`[projects] 盘符变化: ${existing.cwd} -> ${normalized}`);
      existing.cwd = normalized;
    }
    writeProjectsJson(deduped);
  }
  return normalized;
}

/** 清理 projects.json 中路径不存在的幽灵条目 + 去重 */
export function cleanupProjectsJson(): ProjectEntry[] {
  const projects = readProjectsJson();
  const before = projects.length;
  const seen = new Set<string>();
  const valid = projects.filter((p) => {
    if (path.resolve(p.cwd) === DEFAULT_WORKSPACE_DIR) return false;
    if (isRemovedCwd(path.resolve(p.cwd))) return false;
    const normalized = path.resolve(p.cwd).toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    if (p.archived) return true;
    const resolved = path.resolve(p.cwd);
    if (extractWorkspaceSuffix(resolved)) {
      if (fs.existsSync(resolved)) return true;
      const sessionDirName = encodeSessionDirName(resolved);
      const sessionDir = path.join(SESSIONS_DIR, sessionDirName);
      if (fs.existsSync(sessionDir)) return true;
      return false;
    }
    return fs.existsSync(resolved);
  });
  if (valid.length < before) {
    console.log(`[projects] 清理+去重: ${before} -> ${valid.length}`);
    writeProjectsJson(valid);
  }
  return valid;
}

// ── 会话文件归属判断 / 外科手术删除 ──

/** 根据 dirName 查找 projects.json 中对应的项目 */
export function findProjectByDirName(dirName: string): {
  project: ProjectEntry | null;
  allProjects: ProjectEntry[];
  normalized: string | null;
} {
  const projects = readProjectsJson();
  for (const p of projects) {
    const normalized = path.resolve(p.cwd);
    if (encodeSessionDirName(normalized) === dirName) {
      return { project: p, allProjects: projects, normalized };
    }
  }
  return { project: null, allProjects: projects, normalized: null };
}

/** 判断会话文件是否属于指定 cwd */
export function sessionFileBelongsToCwd(filePath: string, cwdLower: string): boolean {
  try {
    const header: SessionHeader = parseSessionHeader(filePath);
    return header.cwd !== null && path.resolve(header.cwd).toLowerCase() === cwdLower;
  } catch {
    return false;
  }
}

/** 外科手术式删除：只删会话目录中属于指定 cwd 的 .jsonl */
export function deleteSessionFilesForCwd(sessionDir: string, projectCwd: string): void {
  if (!fs.existsSync(sessionDir)) return;
  const cwdLower = projectCwd.toLowerCase();
  for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
    const full = path.join(sessionDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      if (sessionFileBelongsToCwd(full, cwdLower)) {
        try { fs.unlinkSync(full); } catch { /* ignore */ }
      }
    } else if (entry.isDirectory()) {
      for (const sub of fs.readdirSync(full)) {
        if (!sub.endsWith('.jsonl')) continue;
        const subFull = path.join(full, sub);
        if (sessionFileBelongsToCwd(subFull, cwdLower)) {
          try { fs.unlinkSync(subFull); } catch { /* ignore */ }
        }
      }
      try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch { /* ignore */ }
    }
  }
  try { if (fs.readdirSync(sessionDir).length === 0) fs.rmdirSync(sessionDir); } catch { /* ignore */ }
}

/** 外科手术式移动：只把属于指定 cwd 的 .jsonl 移到目标目录 */
export function moveSessionFilesForCwd(srcDir: string, destDir: string, projectCwd: string): void {
  const cwdLower = projectCwd.toLowerCase();
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      if (sessionFileBelongsToCwd(full, cwdLower)) {
        try { fs.renameSync(full, path.join(destDir, entry.name)); } catch { /* ignore */ }
      }
    } else if (entry.isDirectory()) {
      for (const sub of fs.readdirSync(full)) {
        if (!sub.endsWith('.jsonl')) continue;
        const subFull = path.join(full, sub);
        if (sessionFileBelongsToCwd(subFull, cwdLower)) {
          const subDest = path.join(destDir, entry.name);
          if (!fs.existsSync(subDest)) fs.mkdirSync(subDest, { recursive: true });
          try { fs.renameSync(subFull, path.join(subDest, sub)); } catch { /* ignore */ }
        }
      }
      try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch { /* ignore */ }
    }
  }
  try { if (fs.readdirSync(srcDir).length === 0) fs.rmdirSync(srcDir); } catch { /* ignore */ }
}

/** 自动发现 workspace 下的子目录，注册到 projects.json */
export function discoverWorkspaceProjects(): void {
  if (!fs.existsSync(DEFAULT_WORKSPACE_DIR)) return;
  try {
    const entries = fs.readdirSync(DEFAULT_WORKSPACE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(DEFAULT_WORKSPACE_DIR, entry.name);
      ensureProjectInJson(subDir);
    }
  } catch (err) {
    console.warn('[discover] 扫描 workspace 子目录失败:', (err as Error).message);
  }
}
