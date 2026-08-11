/**
 * Tiffa 桌面版 - 预加载脚本
 *
 * 安全 IPC 桥接，连接渲染进程和主进程。
 * 通过 contextBridge 暴露受控 API。
 */

const { contextBridge, ipcRenderer, clipboard, webUtils } = require('electron');
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

contextBridge.exposeInMainWorld('tiffaDesktop', {
  // ── Tiffa 代理命令 ──
  send: (message, images, sessionId) => ipcRenderer.invoke('tiffa:send', message, images, sessionId),
  abort: (sessionId) => ipcRenderer.invoke('tiffa:abort', sessionId),
  setModel: (provider, modelId, sessionId) => ipcRenderer.invoke('tiffa:setModel', provider, modelId, sessionId),
  getModels: (sessionId) => ipcRenderer.invoke('tiffa:getModels', sessionId),
  getState: (sessionId) => ipcRenderer.invoke('tiffa:getState', sessionId),
  isReady: (sessionId) => ipcRenderer.invoke('tiffa:isReady', sessionId),
  diagnostics: () => ipcRenderer.invoke('tiffa:diagnostics'),
  steer: (message, sessionId) => ipcRenderer.invoke('tiffa:steer', message, sessionId),
  followUp: (message, sessionId) => ipcRenderer.invoke('tiffa:followUp', message, sessionId),
  extensionResponse: (id, value, sessionId) => ipcRenderer.invoke('tiffa:extensionResponse', id, value, sessionId),
  rendererLog: (tag, msg) => ipcRenderer.send('renderer:log', tag, msg),
  compact: (sessionId) => ipcRenderer.invoke('tiffa:compact', sessionId),
  command: (type, payload, sessionId) => ipcRenderer.invoke('tiffa:command', type, payload, sessionId),

  // ── 事件监听 ──
  onEvent: (callback) => {
    ipcRenderer.on('tiffa:event', (event, data) => callback(data));
  },
  onExited: (callback) => {
    ipcRenderer.on('tiffa:exited', (event, data) => callback(data));
  },
  // ── 文件系统 ──
  listDir: (dirPath) => ipcRenderer.invoke('fs:listDir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  readImage: (filePath) => ipcRenderer.invoke('fs:readImage', filePath),
  // 自定义启动页图片（<PORTABLE_ROOT>/data/startup-image.*），无则返回 null
  getStartupImage: () => ipcRenderer.invoke('custom:getStartupImage'),
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
  loadSessionHistory: (sessionPath, opts) => ipcRenderer.invoke('sessions:loadHistory', sessionPath, opts),
  archiveProject: (dirName, cwd) => ipcRenderer.invoke('sessions:archiveProject', dirName, cwd),
  deleteProject: (dirName, cwd) => ipcRenderer.invoke('sessions:deleteProject', dirName, cwd),
  listArchivedProjects: () => ipcRenderer.invoke('sessions:listArchived'),
  restoreProject: (dirName) => ipcRenderer.invoke('sessions:restoreProject', dirName),
  archiveSession: (sessionPath) => ipcRenderer.invoke('sessions:archiveSession', sessionPath),
  deleteSession: (sessionPath) => ipcRenderer.invoke('sessions:deleteSession', sessionPath),
  renameSession: (sessionPath, newTitle) => ipcRenderer.invoke('sessions:rename', sessionPath, newTitle),
  // 轻量模型补全（AI 重命名等小任务；旁路模型优先，失败降级主模型 → 豆包）
  completeWithLightModel: (prompt, maxTokens, providerHint, modelHint) => ipcRenderer.invoke('ai:complete', { prompt, maxTokens, providerHint, modelHint }),
  listArchivedSessions: (projectDirName) => ipcRenderer.invoke('sessions:listArchivedSessions', projectDirName),
  restoreSession: (sessionPath) => ipcRenderer.invoke('sessions:restoreSession', sessionPath),
  getUserEntries: (sessionPath) => ipcRenderer.invoke('sessions:getUserEntries', sessionPath),
  exportSessionHtml: (sessionPath) => ipcRenderer.invoke('sessions:exportHtml', sessionPath),
  recallMemory: (query) => ipcRenderer.invoke('memory:recall', query),
  getIdentity: () => ipcRenderer.invoke('memory:getIdentity'),
  saveIdentity: (aiName, userName) => ipcRenderer.invoke('memory:saveIdentity', aiName, userName),
  getRemovedCwds: () => ipcRenderer.invoke('sessions:getRemovedCwds'),
  addRemovedCwd: (cwd) => ipcRenderer.invoke('sessions:addRemovedCwd', cwd),
  removeRemovedCwd: (cwd) => ipcRenderer.invoke('sessions:removeRemovedCwd', cwd),

  // ── 模型配置 ──
  readModelsYml: () => ipcRenderer.invoke('models:read'),
  writeModelsYml: (content) => ipcRenderer.invoke('models:write', content),
  restartTiffa: () => ipcRenderer.invoke('models:restart'),
  writeTiffaProvider: (providerId, cfg) => ipcRenderer.invoke('models:writeProvider', providerId, cfg),
  deleteTiffaProvider: (providerId) => ipcRenderer.invoke('models:deleteProvider', providerId),

  // ── 配置写入 ──
  writeApprovalMode: (tiffaMode) => ipcRenderer.invoke('config:writeApprovalMode', tiffaMode),

  // ── 工作区/项目管理 ──
  openFolderDialog: () => ipcRenderer.invoke('workspace:openFolderDialog'),
  changeWorkspace: (newCwd) => ipcRenderer.invoke('workspace:change', newCwd),

  // ── 多实例管理 ──
  activateInstance: (cwd) => ipcRenderer.invoke('tiffa:activate', cwd),
  activateSession: (cwd, sessionId) => ipcRenderer.invoke('tiffa:activateSession', cwd, sessionId),
  closeSession: (cwd, sessionId) => ipcRenderer.invoke('tiffa:closeSession', cwd, sessionId),
  getInstances: () => ipcRenderer.invoke('tiffa:instances'),

  // ── XML 翻译开关 ──
  getXmlTranslationStatus: () => ipcRenderer.invoke('xml-translation:status'),
  toggleXmlTranslation: (enabled) => ipcRenderer.invoke('xml-translation:toggle', enabled),

  // ── Computer Use（电脑控制）开关 ──
  getComputerUseStatus: () => ipcRenderer.invoke('computer-use:status'),
  toggleComputerUse: (enabled) => ipcRenderer.invoke('computer-use:toggle', enabled),

  // ── 旁路模型 / MCP 模型配置 ──
  getBypassModel: () => ipcRenderer.invoke('settings:getBypassModel'),
  saveBypassModel: (cfg) => ipcRenderer.invoke('settings:saveBypassModel', cfg),
  getGroundingModel: () => ipcRenderer.invoke('settings:getGroundingModel'),
  saveGroundingModel: (cfg) => ipcRenderer.invoke('settings:saveGroundingModel', cfg),
  checkModelHealth: (arg) => ipcRenderer.invoke('settings:checkModelHealth', arg),

  // ── 渲染库 ──
  marked: (src) => marked.parse(src),
  // 历史加载专用：不做 hljs 高亮（由渲染进程可见时再高亮），避免长会话全量同步高亮卡死
  markedNoHighlight: (src) => marked.parse(src, { highlight: null }),
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
  // ── 文件路径解析（Electron 32+ File.path 已移除）──
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
