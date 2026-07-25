/**
 * Tiffa 桌面版 - 预加载脚本
 *
 * 安全 IPC 桥接，连接渲染进程和主进程。
 * 通过 contextBridge 暴露受控 API。
 */

const { contextBridge, ipcRenderer, clipboard } = require('electron');
const hljs = require('highlight.js/lib/common');
const { marked } = require('marked');

// Configure marked with highlight.js integration
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

contextBridge.exposeInMainWorld('ompDesktop', {
  // ── omp 代理命令 ──
  send: (message, images) => ipcRenderer.invoke('omp:send', message, images),
  abort: () => ipcRenderer.invoke('omp:abort'),
  setModel: (provider, modelId) => ipcRenderer.invoke('omp:setModel', provider, modelId),
  getModels: () => ipcRenderer.invoke('omp:getModels'),
  getState: () => ipcRenderer.invoke('omp:getState'),
  isReady: () => ipcRenderer.invoke('omp:isReady'),
  steer: (message) => ipcRenderer.invoke('omp:steer', message),
  extensionResponse: (id, value) => ipcRenderer.invoke('omp:extensionResponse', id, value),
  compact: () => ipcRenderer.invoke('omp:compact'),
  command: (type, payload) => ipcRenderer.invoke('omp:command', type, payload),

  // ── 事件监听 ──
  onEvent: (callback) => {
    ipcRenderer.on('omp:event', (event, data) => callback(data));
  },
  onExited: (callback) => {
    ipcRenderer.on('omp:exited', (event, data) => callback(data));
  },
  onStallKilled: (callback) => {
    ipcRenderer.on('omp:stall-killed', (event, data) => callback(data));
  },
  onStallWarning: (callback) => {
    ipcRenderer.on('omp:stall-warning', (event, data) => callback(data));
  },
  onStallRecovered: (callback) => {
    ipcRenderer.on('omp:stall-recovered', (event, data) => callback(data));
  },
  onRestarting: (callback) => {
    ipcRenderer.on('omp:restarting', (event, data) => callback(data));
  },

  // ── 文件系统 ──
  listDir: (dirPath) => ipcRenderer.invoke('fs:listDir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  readImage: (filePath) => ipcRenderer.invoke('fs:readImage', filePath),
  fetchProviderModels: (baseUrl, apiKey) => ipcRenderer.invoke('fetch:providerModels', baseUrl, apiKey),

  // ── 外部调用 ──
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),

  // ── 路径工具 ──
  getWorkspacePath: () => ipcRenderer.invoke('path:workspace'),
  getRootPath: () => ipcRenderer.invoke('path:root'),

  // ── 会话/项目管理 ──
  listProjects: () => ipcRenderer.invoke('sessions:listProjects'),
  listSessions: (projectDirName) => ipcRenderer.invoke('sessions:listSessions', projectDirName),
  switchSession: (sessionPath) => ipcRenderer.invoke('sessions:switch', sessionPath),
  newSession: () => ipcRenderer.invoke('sessions:new'),
  loadSessionHistory: (sessionPath) => ipcRenderer.invoke('sessions:loadHistory', sessionPath),
  archiveProject: (dirName) => ipcRenderer.invoke('sessions:archiveProject', dirName),
  deleteProject: (dirName) => ipcRenderer.invoke('sessions:deleteProject', dirName),
  listArchivedProjects: () => ipcRenderer.invoke('sessions:listArchived'),
  restoreProject: (dirName) => ipcRenderer.invoke('sessions:restoreProject', dirName),
  archiveSession: (sessionPath) => ipcRenderer.invoke('sessions:archiveSession', sessionPath),
  deleteSession: (sessionPath) => ipcRenderer.invoke('sessions:deleteSession', sessionPath),
  listArchivedSessions: (projectDirName) => ipcRenderer.invoke('sessions:listArchivedSessions', projectDirName),
  restoreSession: (sessionPath) => ipcRenderer.invoke('sessions:restoreSession', sessionPath),
  getUserEntries: (sessionPath) => ipcRenderer.invoke('sessions:getUserEntries', sessionPath),
  exportSessionHtml: (sessionPath) => ipcRenderer.invoke('sessions:exportHtml', sessionPath),
  getRemovedCwds: () => ipcRenderer.invoke('sessions:getRemovedCwds'),
  addRemovedCwd: (cwd) => ipcRenderer.invoke('sessions:addRemovedCwd', cwd),
  removeRemovedCwd: (cwd) => ipcRenderer.invoke('sessions:removeRemovedCwd', cwd),

  // ── 模型配置 ──
  readModelsYml: () => ipcRenderer.invoke('models:read'),
  writeModelsYml: (content) => ipcRenderer.invoke('models:write', content),
  restartOmp: () => ipcRenderer.invoke('models:restart'),
  writeOmpProvider: (providerId, cfg) => ipcRenderer.invoke('models:writeProvider', providerId, cfg),
  deleteOmpProvider: (providerId) => ipcRenderer.invoke('models:deleteProvider', providerId),

  // ── 工作区/项目管理 ──
  openFolderDialog: () => ipcRenderer.invoke('workspace:openFolderDialog'),
  changeWorkspace: (newCwd) => ipcRenderer.invoke('workspace:change', newCwd),

  // ── 多实例管理 ──
  activateInstance: (cwd) => ipcRenderer.invoke('omp:activate', cwd),
  getInstances: () => ipcRenderer.invoke('omp:instances'),

  // ── XML 翻译开关 ──
  getXmlTranslationStatus: () => ipcRenderer.invoke('xml-translation:status'),
  toggleXmlTranslation: (enabled) => ipcRenderer.invoke('xml-translation:toggle', enabled),

  // ── 渲染库 ──
  marked: (src) => marked.parse(src),
  hljs: {
    highlight: (code, opts) => {
      try {
        return hljs.highlight(code, opts);
      } catch (e) {
        return { value: code };
      }
    },
    highlightAuto: (code) => {
      try {
        return hljs.highlightAuto(code);
      } catch (e) {
        return { value: code };
      }
    },
    getLanguage: (lang) => hljs.getLanguage(lang),
  },

  // ── 剪贴板 ──
  clipboardWriteText: (text) => clipboard.writeText(text),
});
