/**
 * ThinkingPicker — 思考档位切换（借鉴 oh-my-pi-UI ThinkingPicker）
 *
 * - 7 档：off/minimal/low/medium/high/xhigh/max（中文 label + desc）
 * - 显示当前档位标签，点击弹出菜单选择；当前模型不支持的档位禁用置灰
 * - Ctrl+T 循环切换（跳过当前模型不支持的档位）
 * - 档位经内核 set_thinking_level 命令透传（内核负责各家方言：reasoning_effort /
 *   chat_template_kwargs.enable_thinking / thinking.effort 等）
 */
import { useEffect, useRef, useState } from 'react';
import { useUiStore, type ThinkingLevel } from '../stores/useUiStore';
import { sendThinkingLevel, cycleThinkingLevel } from '../services/sessionController';

const LEVELS: { value: ThinkingLevel; label: string; desc: string }[] = [
  { value: 'off', label: '关闭', desc: '不思考，最快响应' },
  { value: 'minimal', label: '极简', desc: '仅在必要时思考' },
  { value: 'low', label: '低', desc: '轻度思考' },
  { value: 'medium', label: '中', desc: '平衡质量与速度' },
  { value: 'high', label: '高', desc: '深入思考' },
  { value: 'xhigh', label: '极高', desc: '非常深入' },
  { value: 'max', label: '最大', desc: '最大思考深度' },
];

export default function ThinkingPicker() {
  const level = useUiStore((s) => s.thinkingLevel);
  const efforts = useUiStore((s) => s.thinkingEfforts);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Ctrl+T 循环切换（仅聚焦在输入区时，避免干扰浏览器）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 't') {
        const ta = document.getElementById('messageInput');
        if (ta && document.activeElement === ta) {
          e.preventDefault();
          void cycleThinkingLevel();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // 当前模型实际支持的档位（内核实测 state.model.thinking.efforts）；无此信息时不过滤。
  // off 是"关闭思考"开关而非 effort 档位：只要模型可关思考就始终可选（不受 efforts 过滤），
  // 否则 efforts=[low,medium,xhigh] 时 off 永远置灰。
  const isSupported = (v: ThinkingLevel) => v === 'off' || !efforts || efforts.includes(v);

  const pick = (l: ThinkingLevel) => {
    if (!isSupported(l)) return;
    setOpen(false);
    void sendThinkingLevel(l);
  };

  const current = LEVELS.find((l) => l.value === level) || { label: '自动', desc: '跟随模型默认' };

  return (
    <div className="thinking-picker" ref={ref}>
      <button
        type="button"
        className="input-btn thinking-btn"
        title={`思考档位：${current.desc}（点击选择，Ctrl+T 循环切换）`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="thinking-btn-label">{current.label}</span>
        <span className="thinking-btn-caret">▾</span>
      </button>
      {open && (
        <div className="thinking-menu">
          <div className="thinking-menu-title">思考档位</div>
          {LEVELS.map((l) => {
            const ok = isSupported(l.value);
            return (
              <div
                key={l.value}
                className={`thinking-item${level === l.value ? ' current' : ''}`}
                onClick={() => pick(l.value)}
                title={ok ? l.desc : `当前模型不支持（支持：${(efforts ?? []).join(' / ') || '未知'}）`}
                style={ok ? undefined : { opacity: 0.35, cursor: 'not-allowed' }}
              >
                <span className="thinking-item-label">{l.label}</span>
                <span className="thinking-item-desc">{ok ? l.desc : '不支持'}</span>
                {level === l.value && <span className="thinking-item-check">✓</span>}
              </div>
            );
          })}
          <div className="thinking-menu-hint" onClick={() => { setOpen(false); void cycleThinkingLevel(); }}>
            Ctrl+T 循环切换
          </div>
        </div>
      )}
    </div>
  );
}
