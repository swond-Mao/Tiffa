/**
 * TiffaInstanceManager: 多实例管理器（懒启动 + LRU 淘汰）
 *
 * 从 main.js 搬移。依赖通过模块导入（constants / tiffa-instance / session-utils / process-utils）。
 */
import path from 'path';
import { TiffaInstance } from './tiffa-instance';
import { findSessionFile } from './session-utils';
import { killTree } from './process-utils';
import { MAX_INSTANCES, LRU_KEEP_ALIVE_MS, setCurrentWorkspaceDir } from './constants';

export interface ActivateResult {
  inst: TiffaInstance;
  ready: boolean;
}

export class TiffaInstanceManager {
  instances = new Map<string, TiffaInstance>(); // key: cwd#sessionId -> TiffaInstance
  spawning = new Map<string, Promise<ActivateResult>>(); // key: cwd#sessionId -> Promise
  /** sessionId 迁移后的旧 key → 新 key 别名：前端在 IPC 延迟窗口内仍持旧 id 发消息时
   * 能解析到已迁移实例，避免按旧 id spawn 新进程导致「对话分裂/漂移」。 */
  aliasKeys = new Map<string, string>(); // oldKey -> newKey
  activeKey: string | null = null;
  activeCwd: string | null = null;

  _key(cwd: string, sessionId: string | null): string {
    return path.resolve(cwd) + '#' + (sessionId || 'project');
  }

  /** 激活项目级实例（用于文件操作、项目切换等） */
  async activate(cwd: string): Promise<ActivateResult> {
    const normalized = path.resolve(cwd);
    const key = this._key(cwd, null);
    this.activeKey = key;
    this.activeCwd = normalized;
    setCurrentWorkspaceDir(normalized);

    // 已存在实例 -> 复用；若正处崩溃重启中则等待 ready
    if (this.instances.has(key)) {
      const inst = this.instances.get(key)!;
      inst.lastActiveTime = Date.now();
      if (!inst.ready && (!inst.process || inst.process.exitCode !== null)) {
        await this._waitReady(inst);
      }
      return { inst, ready: inst.ready };
    }

    // 正在 spawn 中 -> 复用同一个 Promise
    if (this.spawning.has(key)) {
      return this.spawning.get(key)!;
    }

    // 超过上限 -> LRU 淘汰
    if (this.instances.size >= MAX_INSTANCES) {
      if (!this._evictLRU()) {
        throw new Error(`实例数已达上限(${MAX_INSTANCES})，且所有实例均在运行中无法淘汰。请关闭部分对话后重试。`);
      }
    }

    // 创建新实例
    const spawnPromise = (async (): Promise<ActivateResult> => {
      const inst = new TiffaInstance(normalized, null);
      this.instances.set(key, inst);
      inst.start();
      await this._waitSpawnReady(inst);
      if (!inst.process || inst.process.exitCode !== null) {
        const willRestart = !inst.userKilled && inst.crashCount < inst.maxCrashRestart;
        if (!willRestart) this.instances.delete(key);
      }
      return { inst, ready: inst.ready };
    })();

    this.spawning.set(key, spawnPromise);
    try {
      return await spawnPromise;
    } finally {
      this.spawning.delete(key);
    }
  }

  /** 激活对话级实例（每个对话独立 Tiffa 进程） */
  async activateSession(cwd: string, sessionId: string): Promise<ActivateResult> {
    const normalized = path.resolve(cwd);
    const key = this._key(cwd, sessionId);

    if (this.instances.has(key)) {
      const inst = this.instances.get(key)!;
      inst.lastActiveTime = Date.now();
      if (!inst.ready && (!inst.process || inst.process.exitCode !== null)) {
        await this._waitReady(inst);
      }
      return { inst, ready: inst.ready };
    }

    if (this.spawning.has(key)) {
      return this.spawning.get(key)!;
    }

    if (this.instances.size >= MAX_INSTANCES) {
      if (!this._evictLRU()) {
        throw new Error(`实例数已达上限(${MAX_INSTANCES})，且所有实例均在运行中无法淘汰。请关闭部分对话后重试。`);
      }
    }

    const spawnPromise = (async (): Promise<ActivateResult> => {
      const inst = new TiffaInstance(normalized, sessionId);
      this.instances.set(key, inst);
      inst.start();
      await this._waitSpawnReady(inst);

      if (!inst.process || inst.process.exitCode !== null) {
        const willRestart = !inst.userKilled && inst.crashCount < inst.maxCrashRestart;
        if (!willRestart) this.instances.delete(key);
        return { inst, ready: inst.ready };
      }

      // 会话上下文恢复
      if (inst.ready && inst.sessionId) {
        const sessionFile = findSessionFile(normalized, inst.sessionId);
        if (sessionFile) {
          inst._restoringContext = true;
          const restoreDeadline = setTimeout(() => {
            if (inst._restoringContext) {
              inst._restoringContext = false;
              console.warn(`[TiffaInstance:${inst._shortCwd()}] 上下文恢复超时，强制解除过滤`);
            }
          }, 15000);
          try {
            await inst.sendCommand({ type: 'switch_session', sessionPath: sessionFile });
            inst.sessionFilePath = sessionFile;
            console.log(`[TiffaInstance:${inst._shortCwd()}] 会话上下文已恢复: ${sessionFile}`);
          } catch (err) {
            console.warn(`[TiffaInstance:${inst._shortCwd()}] 上下文恢复失败: ${(err as Error).message}`);
          } finally {
            clearTimeout(restoreDeadline);
            setTimeout(() => { inst._restoringContext = false; }, 800);
          }
        }
      }

      return { inst, ready: inst.ready };
    })();

    this.spawning.set(key, spawnPromise);
    try {
      return await spawnPromise;
    } finally {
      this.spawning.delete(key);
    }
  }

  private async _waitReady(inst: TiffaInstance): Promise<void> {
    await new Promise<void>((resolve) => {
      let checks = 0;
      const check = setInterval(() => {
        checks++;
        if (inst.ready || checks > 100 || (!inst._restartTimer && !inst.process)) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  private async _waitSpawnReady(inst: TiffaInstance): Promise<void> {
    await new Promise<void>((resolve) => {
      let checks = 0;
      const check = setInterval(() => {
        checks++;
        if (inst.ready || checks > 300) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      if (inst.process) {
        inst.process.once('exit', () => {
          clearInterval(check);
          resolve();
        });
      }
    });
  }

  /** 获取当前活跃实例 */
  getActive(): TiffaInstance | null {
    if (!this.activeKey) return null;
    return this.instances.get(this.activeKey) || null;
  }

  /** 解析可能存在的旧 key 别名链（惰性清理：目标已不存在则删除过期别名） */
  private _resolveKey(key: string): string {
    const seen = new Set<string>();
    while (this.aliasKeys.has(key) && !seen.has(key)) {
      seen.add(key);
      key = this.aliasKeys.get(key)!;
    }
    if (seen.size > 0 && !this.instances.has(key)) {
      for (const k of seen) this.aliasKeys.delete(k);
    }
    return key;
  }

  /** 按 sessionId 精确查找实例（不依赖 activeKey；支持迁移前旧 id） */
  getBySessionId(cwd: string | null, sessionId: string | null): TiffaInstance | null {
    if (!cwd || !sessionId) return null;
    const key = this._resolveKey(this._key(cwd, sessionId));
    return this.instances.get(key) || null;
  }

  /** 按 sessionId 全池扫描（不依赖 activeCwd；支持迁移前旧 id） */
  getBySessionIdAnywhere(sessionId: string | null): TiffaInstance | null {
    if (!sessionId) return null;
    for (const inst of this.instances.values()) {
      if (inst.sessionId === sessionId) return inst;
    }
    // 别名扫描：key 尾缀匹配旧 id（temp UUID）
    const suffix = '#' + sessionId;
    for (const [oldKey, newKey] of this.aliasKeys) {
      if (oldKey.endsWith(suffix)) {
        const resolved = this._resolveKey(newKey);
        const inst = this.instances.get(resolved);
        if (inst) return inst;
      }
    }
    return null;
  }

  /** 迁移实例的 sessionId：CLI 分配真实 sessionId 后迁移 key */
  migrateSessionId(cwd: string, oldSessionId: string | null, newSessionId: string): boolean {
    if (!cwd || !oldSessionId || !newSessionId || oldSessionId === newSessionId) return false;
    const oldKey = this._key(cwd, oldSessionId);
    const newKey = this._key(cwd, newSessionId);
    const inst = this.instances.get(oldKey);
    if (!inst) return false;
    if (this.instances.has(newKey)) {
      console.log(`[TiffaManager] migrateSessionId: 目标 key 已存在，仅删旧 key ${oldKey}`);
      this.instances.delete(oldKey);
      return false;
    }
    this.instances.delete(oldKey);
    this.instances.set(newKey, inst);
    // 保留旧 key 别名：迁移后前端可能仍持旧 id（temp）发消息/查询，解析到新 key 避免分裂
    this.aliasKeys.set(oldKey, newKey);
    if (this.activeKey === oldKey) this.activeKey = newKey;
    if (this.spawning.has(oldKey)) {
      this.spawning.set(newKey, this.spawning.get(oldKey)!);
      this.spawning.delete(oldKey);
    }
    console.log(`[TiffaManager] sessionId 迁移: ${oldSessionId} -> ${newSessionId} (key: ${oldKey} -> ${newKey})`);
    return true;
  }

  /** 按 sessionId 查找，回退到 activeKey */
  resolve(cwd: string | null, sessionId: string | null): TiffaInstance | null {
    return this.getBySessionId(cwd, sessionId) || this.getActive();
  }

  /** 关闭某个 key 的实例 */
  closeByKey(key: string): void {
    // 清理指向/来自该 key 的别名，避免悬挂
    for (const [ok, nk] of this.aliasKeys) {
      if (ok === key || nk === key) this.aliasKeys.delete(ok);
    }
    const inst = this.instances.get(key);
    if (inst) {
      inst.kill();
      this.instances.delete(key);
    }
    if (this.activeKey === key) {
      this.activeKey = null;
      this.activeCwd = null;
    }
  }

  /** 关闭某个 cwd 的所有实例 */
  close(cwd: string): void {
    const normalized = path.resolve(cwd);
    const keysToDelete: string[] = [];
    for (const [key, inst] of this.instances) {
      if (inst.cwd === normalized) {
        inst.kill();
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.instances.delete(key);
    }
    if (this.activeCwd === normalized) {
      this.activeKey = null;
      this.activeCwd = null;
    }
  }

  /** 关闭所有实例 */
  closeAll(): void {
    for (const inst of this.instances.values()) {
      inst.kill();
    }
    this.instances.clear();
    this.activeKey = null;
    this.activeCwd = null;
  }

  /** 关闭所有实例（退出时用，同步暴力清理） */
  killAll(): void {
    for (const inst of this.instances.values()) {
      inst.userKilled = true;
      if (inst._restartTimer) {
        clearTimeout(inst._restartTimer);
        inst._restartTimer = null;
      }
      if (inst.process) {
        killTree(inst.process.pid, true);
      }
      for (const [, { reject }] of inst.pendingCommands) {
        reject(new Error('app quitting'));
      }
      inst.pendingCommands.clear();
    }
    this.instances.clear();
    this.spawning.clear();
    this.activeKey = null;
    this.activeCwd = null;
  }

  /** LRU 淘汰：淘汰最久未活跃的非当前实例 */
  _evictLRU(): boolean {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    let fallback: string | null = null;
    let fallbackTime = Infinity;
    const now = Date.now();

    for (const [key, inst] of this.instances) {
      if (key === this.activeKey) continue;
      if (inst.agentRunning) continue;
      if (inst._pendingAskIds && inst._pendingAskIds.size > 0) continue;
      if (now - inst.lastActiveTime < LRU_KEEP_ALIVE_MS) {
        if (inst.lastActiveTime < fallbackTime) {
          fallbackTime = inst.lastActiveTime;
          fallback = key;
        }
        continue;
      }
      if (inst.lastActiveTime < oldestTime) {
        oldestTime = inst.lastActiveTime;
        oldest = key;
      }
    }

    const victim = oldest || fallback;
    if (victim) {
      console.log(`[TiffaManager] LRU 淘汰: ${victim}`);
      this.closeByKey(victim);
      return true;
    }
    console.warn(`[TiffaManager] LRU 淘汰失败：所有 ${this.instances.size} 个实例均不可淘汰`);
    return false;
  }

  /** 获取所有实例状态（供前端显示） */
  getStatus(): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const [key, inst] of this.instances) {
      result.push({
        key,
        cwd: inst.cwd,
        sessionId: inst.sessionId,
        sessionFilePath: inst.sessionFilePath,
        active: key === this.activeKey,
        ready: inst.ready,
        agentRunning: inst.agentRunning,
        lastActiveTime: inst.lastActiveTime,
      });
    }
    return result;
  }
}
