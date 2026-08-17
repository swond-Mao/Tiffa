/**
 * useProcStore — per-session 进程/生成状态（对应 dim 的 procStateMap）
 *
 * 事件按 _sessionId/_sessionPath 路由到对应槽，UI 只读当前活跃会话的槽。
 * 卡住检测 / 首响超时的定时器与首响标志已 per-session 化，移入 generationGuard。
 */
import { create } from 'zustand';

export type ProcStatus = 'offline' | 'online' | 'streaming';

export interface SessionProcState {
  status: ProcStatus;
  agentRunning: boolean;
}

interface ProcState {
  /** 引擎是否就绪（ready 事件 / isReady 轮询） */
  tiffaReady: boolean;
  /** per-session 生成状态（key = sessionPath） */
  procStateMap: Record<string, SessionProcState>;
  /** per-session 实例就绪态（key = sessionPath）：活动对话（实例已就绪，LRU 保活中）为 true，
   *  对话树左侧圆点据此显示——选中（activeSessionPath）≠ 活动 */
  sessionReadyMap: Record<string, boolean>;
  /** per-实例(cwd) 生成状态（切换项目时保存/恢复） */
  instanceAgentRunning: Record<string, boolean>;
  /** 自动重启后未就绪标记 */
  autoRestarting: boolean;

  setReady: (ready: boolean) => void;
  setSessionReady: (sessionPath: string | null, ready: boolean) => void;
  setSessionReadyMap: (map: Record<string, boolean>) => void;
  setSessionRunning: (sessionPath: string | null, running: boolean) => void;
  setInstanceRunning: (cwd: string | null, running: boolean) => void;
  setAutoRestarting: (v: boolean) => void;
}

export const useProcStore = create<ProcState>((set) => ({
  tiffaReady: false,
  procStateMap: {},
  sessionReadyMap: {},
  instanceAgentRunning: {},
  autoRestarting: false,

  setReady: (ready) => set({ tiffaReady: ready }),
  setSessionReady: (sessionPath, ready) => {
    if (!sessionPath) return;
    set((s) => ({
      sessionReadyMap: { ...s.sessionReadyMap, [sessionPath]: ready },
    }));
  },
  setSessionReadyMap: (map) => set({ sessionReadyMap: map }),
  setSessionRunning: (sessionPath, running) => {
    if (!sessionPath) return;
    set((s) => {
      const cur = s.procStateMap[sessionPath];
      const status: ProcStatus = running ? 'streaming' : 'online';
      return {
        procStateMap: { ...s.procStateMap, [sessionPath]: { status, agentRunning: running } },
        // 旧版行为：cur 可能不存在时也记录
        ...(cur ? {} : {}),
      };
    });
  },
  setInstanceRunning: (cwd, running) => {
    if (!cwd) return;
    set((s) => ({ instanceAgentRunning: { ...s.instanceAgentRunning, [cwd]: running } }));
  },
  setAutoRestarting: (v) => set({ autoRestarting: v }),
}));

/** 重命名 per-session 键（session_switch 迁移用） */
export function renameProcKey(oldPath: string, newPath: string): void {
  useProcStore.setState((s) => {
    const map = { ...s.procStateMap };
    if (map[oldPath]) {
      map[newPath] = map[oldPath];
      delete map[oldPath];
    }
    const readyMap = { ...s.sessionReadyMap };
    if (oldPath in readyMap) {
      readyMap[newPath] = readyMap[oldPath];
      delete readyMap[oldPath];
    }
    return { procStateMap: map, sessionReadyMap: readyMap };
  });
}
