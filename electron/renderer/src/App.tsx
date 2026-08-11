/**
 * Tiffa React 渲染层根组件
 *
 * 布局：index.html 的 #app（flex row）> #root（flex:1）> #main-layout >
 * #projectPanel + .panel-resizer + #mainArea(#titlebar + #chatPanel(ChatView + InputBox))
 * + .sidebar-resize-handle + #sidebar。不重复渲染 id="app"，避免双重 id 导致
 * #root 宽度收缩为内容最小宽度（元素全部挤在左侧）。
 */
import { useEffect } from 'react';
import { initEventRouter } from './services/eventRouter';
import { fetchCurrentModel, loadProjects, preloadDuringWelcome } from './services/sessionController';
import { loadModelMap } from './services/historyService';
import { initIdentity } from './services/identity';
import ChatView from './components/ChatView';
import InputBox from './components/InputBox';
import StatusBar from './components/StatusBar';
import SessionTabs from './components/SessionTabs';
import ProjectSidebar from './components/ProjectSidebar';
import StartupRitual from './components/StartupRitual';
import RightSidebar from './components/RightSidebar';
import AskModal from './components/AskModal';
import SettingsPanel from './components/SettingsPanel';
import ToastContainer from './components/ToastContainer';

export default function App() {
  // 初始化（幂等）：事件路由 + 模型记忆 + 当前模型 + 项目列表 + 身份
  useEffect(() => {
    // 重应用主题：Vite 构建把 styles.css link 放在 themes.js 之后，head 早期注入的
    // <style> 会被 styles.css 的 :root fallback 覆盖；这里重建 style 到 head 末尾使主题生效
    const win = window as unknown as {
      applyThemeToDOM?: (presetId: string, resolvedMode: string) => void;
      getCurrentTheme?: () => { presetId: string; resolvedMode: string };
    };
    try {
      if (win.applyThemeToDOM && win.getCurrentTheme) {
        const t = win.getCurrentTheme();
        win.applyThemeToDOM(t.presetId, t.resolvedMode);
      }
    } catch {
      /* ignore */
    }
    initEventRouter();
    void loadModelMap();
    void fetchCurrentModel();
    // 预热（等价旧版 preloadDuringWelcome）：遮罩等待期预载已打开 tab 的历史
    // 与所有项目的会话列表——先并行发起（tab 列表直接从 localStorage 读），
    // loadProjects 完成后幂等补一轮（项目列表此时才有数据）。
    void preloadDuringWelcome();
    void loadProjects().then(() => preloadDuringWelcome());
    void initIdentity();
  }, []);

  return (
    <>
      {/* 启动剧本：控制 #startupOverlay 的进度条/字幕/淡出时序 */}
      <StartupRitual />
      <div id="main-layout">
        <ProjectSidebar />
        <div id="mainArea">
          <div id="titlebar">
            <div className="titlebar-left">
              <SessionTabs />
            </div>
            <StatusBar />
          </div>
          <div id="chatPanel">
            <ChatView />
            <InputBox />
          </div>
        </div>
        <RightSidebar />
      </div>
      {/* 全局 ask 队列：队列头常显（含后台会话 ask） */}
      <AskModal />
      {/* 设置面板（左下角齿轮控制开关） */}
      <SettingsPanel />
      {/* 全局浮动通知（toast）：修复——toasts 此前无渲染层，addToast 全部不可见 */}
      <ToastContainer />
    </>
  );
}
