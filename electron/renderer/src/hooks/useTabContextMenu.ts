/**
 * useTabContextMenu — 会话右键菜单（tab 与左侧会话树共用，等价旧版 showSessionTabContextMenu）
 *
 * 菜单项：AI 重命名 / 手动重命名 / 分支 / 导出 HTML / 归档对话 / 删除对话。
 * DOM 方式渲染（复用 .context-menu 样式），点击外部自动关闭。
 */
import { useCallback, useRef } from 'react';
import {
  renameTabSession,
  aiRenameTabSession,
  branchTabSession,
  exportTabSessionHtml,
  archiveTabSession,
  deleteTabSession,
  type TabSession,
} from '../services/tabActions';

const MENU_ITEMS = [
  {
    action: 'ai-rename',
    label: 'AI 重命名',
    svg: '<path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V11h3a3 3 0 0 1 3 3v1.5a2.5 2.5 0 0 1-5 0V14H9v1.5a2.5 2.5 0 0 1-5 0V14a3 3 0 0 1 3-3h3V9.5A4 4 0 0 1 8 6a4 4 0 0 1 4-4z"/>',
  },
  {
    action: 'rename',
    label: '手动重命名',
    svg: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  },
  {
    action: 'branch',
    label: '分支',
    svg: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  },
  {
    action: 'export-html',
    label: '导出 HTML',
    svg: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  },
] as const;

const DANGER_ITEMS = [
  {
    action: 'archive',
    label: '归档对话',
    danger: false,
    svg: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>',
  },
  {
    action: 'delete',
    label: '删除对话',
    danger: true,
    svg: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  },
] as const;

function itemHtml(action: string, label: string, svg: string, danger?: boolean): string {
  return `<div class="context-menu-item${danger ? ' danger' : ''}" data-action="${action}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px">${svg}</svg>${label}
  </div>`;
}

export function useTabContextMenu() {
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    if (menuRef.current) {
      menuRef.current.remove();
      menuRef.current = null;
    }
  }, []);

  const showTabMenu = useCallback(
    (e: React.MouseEvent, session: TabSession) => {
      e.preventDefault();
      closeMenu();

      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.innerHTML =
        MENU_ITEMS.map((i) => itemHtml(i.action, i.label, i.svg)).join('') +
        '<div class="context-menu-divider"></div>' +
        DANGER_ITEMS.map((i) => itemHtml(i.action, i.label, i.svg, i.danger)).join('');
      document.body.appendChild(menu);
      menuRef.current = menu;

      // 定位（防溢出视口）
      let x = e.clientX;
      let y = e.clientY;
      const menuWidth = 160;
      const menuHeight = 220;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;

      menu.addEventListener('click', (ev) => {
        const item = (ev.target as HTMLElement).closest('.context-menu-item') as HTMLElement | null;
        if (!item) return;
        const action = item.dataset.action;
        closeMenu();
        if (action === 'rename') void renameTabSession(session);
        else if (action === 'ai-rename') void aiRenameTabSession(session);
        else if (action === 'branch') void branchTabSession(session);
        else if (action === 'export-html') void exportTabSessionHtml(session);
        else if (action === 'archive') void archiveTabSession(session);
        else if (action === 'delete') void deleteTabSession(session);
      });

      // 点击其他区域关闭
      setTimeout(() => {
        document.addEventListener(
          'click',
          (ev) => {
            if (menuRef.current && !menuRef.current.contains(ev.target as Node)) closeMenu();
          },
          { once: true },
        );
      }, 0);
    },
    [closeMenu],
  );

  return { showTabMenu, closeMenu };
}
