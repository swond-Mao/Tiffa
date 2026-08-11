import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// ── 全局 JS 错误捕获：转发到 renderer.log（data/logs/renderer.log），
// 避免切换审批/事件处理等异步异常静默丢失（旧版只有 dbgLog 主动记录）。──
window.addEventListener('error', (e) => {
  try {
    window.tiffaDesktop?.rendererLog?.(
      'error',
      `JS错误: ${e.message} @ ${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`,
    );
  } catch {
    /* ignore */
  }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    const reason = e.reason instanceof Error ? `${e.reason.message} ${e.reason.stack || ''}` : String(e.reason);
    window.tiffaDesktop?.rendererLog?.('error', `unhandledRejection: ${reason}`);
  } catch {
    /* ignore */
  }
});

// 生产构建不启用 StrictMode：避免开发期 effect 双调用导致 onEvent 双订阅
createRoot(document.getElementById('root')!).render(<App />);
