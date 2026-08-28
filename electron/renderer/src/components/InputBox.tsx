/**
 * InputBox — 输入区（等价旧版 setupInput / submitMidRun / 图片与 slash 逻辑）
 *
 * - 多行自适应 textarea（max 160px）、Enter 发送 / Shift+Enter 换行
 * - 生成中：Enter 排队（pendingQueueMessage）+ 排队栏（引导发送 / 取消）
 * - 发送/中止按钮按 agentRunning 切换；未就绪/切换中禁用输入
 * - 图片：附件按钮 / 粘贴 / 拖放（图片 → 压缩管线（发送版 ≤1568px + 缩略图，拖入/附件带原图路径）预览 chips；非图片 → 路径文本插入）
 * - slash 命令自动补全（键盘导航 ArrowDown/Up、Tab/Enter 选中、Esc 关闭）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { useProcStore } from '../stores/useProcStore';
import { useUiStore } from '../stores/useUiStore';
import { abortMessage, sendMessage, sendSteer, compactMessage } from '../services/sessionController';
import ModelPicker from './ModelPicker';
import ThinkingPicker from './ThinkingPicker';
import type { MessageImage } from '../types/messages';
import { dbgLog } from '../services/utils';
import { compressImageBase64, compressImageFile } from '../services/imageUtils';

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

const SLASH_COMMANDS = [
  { name: '/ask', desc: '提出一个问题，弹卡片回答后发给模型' },
  { name: '/compact', desc: '压缩对话上下文' },
  { name: '/clear', desc: '清空当前对话' },
  { name: '/model', desc: '切换模型' },
  { name: '/skills', desc: '列出可用技能' },
  { name: '/help', desc: '显示帮助信息' },
  { name: '/cost', desc: '显示 token 消耗' },
  { name: '/undo', desc: '撤销上一轮对话' },
  { name: '/branch', desc: '从当前消息分支新对话' },
];

export default function InputBox() {
  const activeSessionPath = useSessionsStore((s) => s.activeSessionPath);
  const agentRunning = useProcStore((s) => (activeSessionPath ? s.procStateMap[activeSessionPath]?.agentRunning : false));
  const tiffaReady = useProcStore((s) => s.tiffaReady);
  const sessionSwitching = useUiStore((s) => s.sessionSwitching);
  const modelSwitching = useUiStore((s) => s.modelSwitching);
  const pendingQueueMessage = useUiStore((s) => s.pendingQueueMessage);
  const setPendingQueueMessage = useUiStore((s) => s.setPendingQueueMessage);
  // 指针模式：实例未就绪时不锁输入/模型（可打字、可选模型），点发送才拉实例，
  // 连接期间由 pendingActivation 锁住发送按钮防止重复触发。
  const pendingActivation = useUiStore((s) => s.pendingActivation);
  const draftInput = useChatStore((s) => s.draftInput);
  const isEditingQueue = useUiStore((s) => s.isEditingQueue);
  const setIsEditingQueue = useUiStore((s) => s.setIsEditingQueue);
  const [editText, setEditText] = useState('');
  const [text, setText] = useState('');
  const [images, setImages] = useState<MessageImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [slashVisible, setSlashVisible] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 切换/模型切换锁（有会话时生效）；无会话单独走 input-nosession 遮罩（保留点击提示，
  // 不复用 input-disabled 的 pointer-events:none——那会吞掉点击，弹不出「请先新建对话」）
  const switchingLock = sessionSwitching || modelSwitching;
  const noSession = !activeSessionPath;
  const shouldDisable = switchingLock || noSession;

  // 无会话点击防呆提示（2s 节流，避免连续点击刷屏）
  const lastNoSessionToastRef = useRef(0);
  const handleNoSessionClick = () => {
    const now = Date.now();
    if (now - lastNoSessionToastRef.current < 2000) return;
    lastNoSessionToastRef.current = now;
    useUiStore.getState().addToast('warning', '请先新建对话');
  };

  const placeholder = noSession
    ? '请先新建对话'
    : switchingLock
      ? sessionSwitching
        ? '正在切换会话…'
        : '正在切换模型…'
      : pendingActivation
        ? '正在连接引擎…'
        : !tiffaReady
          ? '输入消息，发送后自动连接引擎…'
          : agentRunning
            ? 'Enter 排队 / 再次 Enter 发送 | 点击引导按钮立即干预'
            : '输入消息，Enter 发送，Shift+Enter 换行...';

  // ── textarea 高度自适应 ──

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [text]);

  // ── 队列清空时退出编辑模式 ──
  useEffect(() => {
    if (!pendingQueueMessage) setIsEditingQueue(false);
  }, [pendingQueueMessage, setIsEditingQueue]);

  // ── 一次性输入预填（分支等场景）──

  useEffect(() => {
    if (draftInput && !agentRunning && !shouldDisable) {
      setText(draftInput);
      useChatStore.getState().setDraftInput(null);
    }
  }, [draftInput, agentRunning, shouldDisable]);

  // ── 全局窗口快照热键：监听主进程推送，注入待发送图片 ──
  useEffect(() => {
    dbgLog('snapshot', '快照监听已挂载');
    const off = window.tiffaDesktop.onWindowSnapshot((p) => {
      dbgLog('snapshot', `收到快照事件: ${p.title} dataLen=${p.data.length}`);
      void compressImageBase64(p.data, p.mimeType || 'image/png', p.title).then((img) => {
        if (!img) {
          useUiStore.getState().addToast('error', '窗口快照处理失败');
          return;
        }
        setImages((prev) => [...prev, img]);
        useUiStore.getState().addToast('info', `已捕获窗口快照：${p.title}`);
      });
    });
    const offErr = window.tiffaDesktop.onWindowSnapshotError((p) => {
      dbgLog('snapshot', `快照错误事件: ${p.error}`);
      useUiStore.getState().addToast('warning', `窗口快照失败：${p.error}`);
    });
    return () => { off(); offErr(); };
  }, []);

  // ── slash 命令检测 ──

  const slashItems = useMemo(() => {
    if (!slashVisible) return SLASH_COMMANDS;
    const q = text.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
  }, [slashVisible, text]);

  useEffect(() => {
    if (text.startsWith('/') && !text.includes(' ')) {
      const q = text.toLowerCase();
      if (SLASH_COMMANDS.some((c) => c.name.startsWith(q))) {
        setSlashVisible(true);
        setSlashIndex(0);
        return;
      }
    }
    setSlashVisible(false);
  }, [text]);

  const selectSlash = (name: string) => {
    setText(name + ' ');
    setSlashVisible(false);
    taRef.current?.focus();
  };

  // ── 图片处理（统一走压缩管线：发送版 ≤1568px + 缩略图；拖入/附件附带原图路径）──

  const readImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      useUiStore.getState().addToast('warning', `不支持的文件类型: ${file.type}`);
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      useUiStore.getState().addToast('warning', `图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大支持 20MB`);
      return;
    }
    void compressImageFile(file).then((img) => {
      if (!img) {
        useUiStore.getState().addToast('error', `无法识别的图片格式，无法处理${file.name ? `：${file.name}` : ''}`);
        return;
      }
      setImages((prev) => [...prev, img]);
    }).catch((err) => {
      useUiStore.getState().addToast('error', `图片处理失败: ${(err as Error).message}`);
    });
  };

  const insertFilePaths = (files: File[]) => {
    const paths = files
      .map((f) => {
        try {
          return window.tiffaDesktop.getPathForFile(f);
        } catch {
          return (f as File & { path?: string }).path;
        }
      })
      .filter(Boolean) as string[];
    if (paths.length === 0) return;
    setText((prev) => {
      const separator = prev && !prev.endsWith('\n') ? '\n' : '';
      return prev + separator + paths.join('\n') + '\n';
    });
    taRef.current?.focus();
  };

  // ── 发送 / 排队 / 中止 ──

  // 拖入/附件图片追加原图路径引用（附件为压缩版，agent 需要像素级细节时 read 原图）
  const messageWithImageRefs = (t: string): string => {
    const paths = images.map((img) => img.path).filter((p): p is string => !!p);
    if (paths.length === 0) return t;
    const note = `[图片原图路径（附件为压缩版，需要像素级细节时请 read 原图）\n${paths.join('\n')}]`;
    return t ? `${t}\n\n${note}` : note;
  };

  const handleSend = () => {
    // 排队消息优先：输入框已清空时按 Enter 也要能触发发送
    if (pendingQueueMessage && agentRunning) {
      handleQueueSteer();
      return;
    }
    const t = text.trim();
    if (!t && images.length === 0) return;
    if (pendingActivation) return; // 引擎连接中，防重复触发
    if (agentRunning) {
      setPendingQueueMessage(t);
      setText('');
    } else {
      void sendMessage(messageWithImageRefs(t), images);
      setText('');
      setImages([]);
    }
  };

  const handleAbort = () => {
    void abortMessage();
  };

  const handleQueueSteer = () => {
    if (!pendingQueueMessage) return;
    const msg = pendingQueueMessage;
    setPendingQueueMessage(null);
    void sendSteer(msg);
  };


  const handleQueueCancel = () => {
    setPendingQueueMessage(null);
    setIsEditingQueue(false);
    setEditText('');
  };
  const handleEditQueue = () => {
    if (!pendingQueueMessage) return;
    setEditText(pendingQueueMessage);
    setIsEditingQueue(true);
    // 编辑模式下清空主 textarea 的焦点到编辑框
  };

  const handleConfirmEdit = () => {
    const msg = editText.trim();
    if (!msg) {
      setIsEditingQueue(false);
      return;
    }
    setPendingQueueMessage(null);
    setIsEditingQueue(false);
    void sendSteer(msg);
  };
  const handleCancelEdit = () => {
    setIsEditingQueue(false);
    setEditText('');
  };

  // ── 键盘 ──

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % Math.max(slashItems.length, 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + Math.max(slashItems.length, 1)) % Math.max(slashItems.length, 1));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const item = slashItems[slashIndex];
        if (item) selectSlash(item.name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashVisible(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── 拖放 ──

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const otherFiles = files.filter((f) => !f.type.startsWith('image/'));
    imageFiles.forEach((f) => readImageFile(f));
    if (otherFiles.length > 0) insertFilePaths(otherFiles);
  };

  // ── 粘贴图片 ──

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach((item) => {
      const blob = item.getAsFile();
      if (blob) readImageFile(blob);
    });
  };

  // ── 渲染 ──

  return (
    <div
      id="inputArea"
      className={`${agentRunning ? 'input-running' : ''} ${switchingLock ? 'input-disabled' : ''} ${noSession ? 'input-nosession' : ''} ${dragOver ? 'drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {pendingQueueMessage && (
        <div id="pendingQueueBar" className={`pending-queue-bar${isEditingQueue ? ' pending-queue-bar-editing' : ''}`}>
          {isEditingQueue ? (
            <div className="pending-queue-edit-area">
              <textarea
                id="pendingQueueEditInput"
                className="pending-queue-edit-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleConfirmEdit();
                  }
                  if (e.key === 'Escape') {
                    handleCancelEdit();
                  }
                }}
                rows={2}
                autoFocus
              />
              <div className="pending-queue-edit-actions">
                <button type="button" id="pendingQueueConfirmEditBtn" className="pending-queue-edit-confirm" onClick={handleConfirmEdit}>
                  发送
                </button>
                <button type="button" id="pendingQueueCancelEditBtn" className="pending-queue-edit-cancel" onClick={handleCancelEdit}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <span id="pendingQueueText" className="pending-queue-text">{pendingQueueMessage}</span>
              <button type="button" id="pendingQueueEditBtn" className="pending-queue-edit" onClick={handleEditQueue} title="编辑排队消息">
                ✎
              </button>
              <button type="button" id="pendingQueueSteerBtn" className="pending-queue-steer" onClick={handleQueueSteer}>
                引导
              </button>
              <button type="button" id="pendingQueueCancelBtn" className="pending-queue-cancel" title="取消排队" onClick={handleQueueCancel}>
                ✕
              </button>
            </>
          )}
        </div>
      )}
      {images.length > 0 && (
        <div id="imagePreview" className="image-preview">
          {images.map((img, i) => (
            <div key={i} className="image-preview-item">
              <img src={img.thumbnail || `data:${img.mimeType};base64,${img.data}`} alt={img.name || 'image'} title={img.name} />
              <button
                type="button"
                className="image-preview-remove"
                title="移除"
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="input-wrapper">
        <textarea
          ref={taRef}
          id="messageInput"
          rows={1}
          placeholder={placeholder}
          disabled={shouldDisable}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="input-actions">
          <ThinkingPicker />
          <ModelPicker className="input-btn model-picker-btn" />
          <button
            type="button"
            id="btnCompact"
            className="input-btn compact"
            title="压缩对话上下文（点击压缩）"
            disabled={shouldDisable || !tiffaReady || agentRunning || !!pendingActivation}
            onClick={() => void compactMessage()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          <button type="button" id="btnAttach" className="input-btn attach" title="添加图片" disabled={noSession} onClick={() => fileInputRef.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          {agentRunning ? (
            <button type="button" id="btnAbort" className="input-btn abort" onClick={handleAbort}>
              中止
            </button>
          ) : (
            <button type="button" id="btnSend" className="input-btn send" disabled={shouldDisable || !!pendingActivation} onClick={handleSend}>
              {pendingActivation ? '连接中…' : '发送'}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          id="fileInput"
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            files.forEach((f) => readImageFile(f));
            e.target.value = '';
          }}
        />
        <div id="slashPopup" className={slashVisible ? 'visible' : undefined}>
          {slashItems.map((cmd, i) => (
            <div
              key={cmd.name}
              className={`slash-item${i === slashIndex ? ' selected' : ''}`}
              onClick={() => selectSlash(cmd.name)}
            >
              <span className="slash-item-name">{cmd.name}</span>
              <span className="slash-item-desc">{cmd.desc || ''}</span>
            </div>
          ))}
        </div>
        {noSession && (
          <div
            className="input-nosession-mask"
            onClick={handleNoSessionClick}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
          />
        )}
      </div>
    </div>
  );
}
