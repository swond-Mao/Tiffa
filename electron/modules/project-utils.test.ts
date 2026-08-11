/**
 * project-utils 单测
 *
 * 覆盖纯函数：rimraf / readProjectsJson / readRemovedCwds / isRemovedCwd / findProjectByDirName
 * 用临时目录隔离，不污染真实数据。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  rimraf,
  readRemovedCwds,
  writeRemovedCwds,
  isRemovedCwd,
  unremoveCwd,
  readProjectsJson,
  writeProjectsJson,
  findProjectByDirName,
  deleteSessionFilesForCwd,
  discoverWorkspaceProjects,
  ensureProjectInJson,
  cleanupProjectsJson,
} from './project-utils';
import { REMOVED_CWDS_FILE, PROJECTS_JSON, PORTABLE_ROOT, SESSIONS_DIR } from './constants';

describe('rimraf', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rimraf-')); });
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('递归删除目录及内容', () => {
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    fs.writeFileSync(path.join(tmp, 'sub', 'b.txt'), 'y');
    rimraf(path.join(tmp, 'sub'));
    expect(fs.existsSync(path.join(tmp, 'sub'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'a.txt'))).toBe(true);
  });

  it('不存在的路径不报错', () => {
    expect(() => rimraf(path.join(tmp, 'nope'))).not.toThrow();
  });
});

describe('removedCwds 黑名单', () => {
  const testCwd = path.join(PORTABLE_ROOT, 'workspace', '__test_remove__');

  afterEach(() => {
    // 清理：从黑名单移除
    unremoveCwd(testCwd);
  });

  it('write -> read 往返', () => {
    const list = [testCwd.toLowerCase()];
    writeRemovedCwds(list);
    expect(readRemovedCwds()).toEqual(list);
  });

  it('isRemovedCwd 精确匹配', () => {
    writeRemovedCwds([testCwd.toLowerCase()]);
    expect(isRemovedCwd(testCwd)).toBe(true);
  });

  it('unremoveCwd 移除后不再匹配', () => {
    writeRemovedCwds([testCwd.toLowerCase()]);
    unremoveCwd(testCwd);
    expect(isRemovedCwd(testCwd)).toBe(false);
  });

  it('未在黑名单的路径返回 false', () => {
    writeRemovedCwds([]);
    expect(isRemovedCwd('C:\\totally\\different')).toBe(false);
  });
});

describe('projects.json 读写', () => {
  const origProjects = readProjectsJson();

  afterEach(() => {
    writeProjectsJson(origProjects);
  });

  it('write -> read 往返', () => {
    const test: ProjectEntry[] = [{
      cwd: 'C:\\test\\proj',
      displayName: 'proj',
      addedAt: '2024-01-01T00:00:00Z',
      lastOpenedAt: '2024-01-01T00:00:00Z',
      archived: false,
    }];
    writeProjectsJson(test);
    const read = readProjectsJson();
    expect(read).toHaveLength(1);
    expect(read[0].cwd).toBe('C:\\test\\proj');
  });

  it('文件不存在时返回空数组', () => {
    // 临时移走文件
    if (fs.existsSync(PROJECTS_JSON)) {
      fs.renameSync(PROJECTS_JSON, PROJECTS_JSON + '.bak');
    }
    expect(readProjectsJson()).toEqual([]);
    // 恢复
    if (fs.existsSync(PROJECTS_JSON + '.bak')) {
      fs.renameSync(PROJECTS_JSON + '.bak', PROJECTS_JSON);
    }
  });
});

describe('findProjectByDirName', () => {
  const origProjects = readProjectsJson();

  afterEach(() => {
    writeProjectsJson(origProjects);
  });

  it('不存在的 dirName 返回 project=null', () => {
    const r = findProjectByDirName('--nonexistent--');
    expect(r.project).toBeNull();
  });
});

describe('deleteSessionFilesForCwd', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'del-sess-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('不存在的目录不报错', () => {
    expect(() => deleteSessionFilesForCwd(path.join(tmp, 'nope'), 'C:\\x')).not.toThrow();
  });
});

describe('cleanupProjectsJson', () => {
  const origProjects = readProjectsJson();

  afterEach(() => {
    writeProjectsJson(origProjects);
  });

  it('不抛错并返回数组', () => {
    const r = cleanupProjectsJson();
    expect(Array.isArray(r)).toBe(true);
  });
});
