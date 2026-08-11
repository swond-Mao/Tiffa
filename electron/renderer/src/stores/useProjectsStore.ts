/**
 * useProjectsStore — 项目域（工作区 / 项目列表 / 归档 / 会话树）
 *
 * 对应 app.js state 中：workspacePath / projects / activeProjectDirName /
 * projectSessions / expandedProjects / archivedProjects / archiveCollapsed /
 * removedCwds。
 */
import { create } from 'zustand';
import type { TiffaProjectSummary, TiffaSessionSummary } from '../types/tiffaDesktop';

export interface ProjectsState {
  workspacePath: string | null;
  projects: TiffaProjectSummary[];
  activeProjectDirName: string | null;
  /** 每个项目的会话列表（左侧树数据源） */
  projectSessions: Record<string, TiffaSessionSummary[]>;
  expandedProjects: Record<string, true>;
  archivedProjects: TiffaProjectSummary[];
  archiveCollapsed: boolean;
  removedCwds: string[];

  setWorkspacePath: (p: string | null) => void;
  setProjects: (list: TiffaProjectSummary[]) => void;
  setActiveProject: (dirName: string | null) => void;
  setProjectSessions: (dirName: string, sessions: TiffaSessionSummary[]) => void;
  toggleExpandedProject: (dirName: string) => void;
  /** 强制展开（等价旧版 selectProject 的 expandedProjects.add，切换项目时用） */
  expandProject: (dirName: string) => void;
  setArchivedProjects: (list: TiffaProjectSummary[]) => void;
  setArchiveCollapsed: (v: boolean) => void;
  setRemovedCwds: (list: string[]) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  workspacePath: null,
  projects: [],
  activeProjectDirName: null,
  projectSessions: {},
  expandedProjects: {},
  archivedProjects: [],
  archiveCollapsed: false,
  removedCwds: [],

  setWorkspacePath: (p) => set({ workspacePath: p }),
  setProjects: (list) => set({ projects: list }),
  setActiveProject: (dirName) => set({ activeProjectDirName: dirName }),
  setProjectSessions: (dirName, sessions) =>
    set((s) => ({ projectSessions: { ...s.projectSessions, [dirName]: sessions } })),
  toggleExpandedProject: (dirName) =>
    set((s) => {
      const expandedProjects = { ...s.expandedProjects };
      if (expandedProjects[dirName]) delete expandedProjects[dirName];
      else expandedProjects[dirName] = true;
      return { expandedProjects };
    }),
  expandProject: (dirName) =>
    set((s) => {
      if (s.expandedProjects[dirName]) return s;
      return { expandedProjects: { ...s.expandedProjects, [dirName]: true } };
    }),
  setArchivedProjects: (list) => set({ archivedProjects: list }),
  setArchiveCollapsed: (v) => set({ archiveCollapsed: v }),
  setRemovedCwds: (list) => set({ removedCwds: list }),
}));
