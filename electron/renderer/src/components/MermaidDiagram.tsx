/**
 * MermaidDiagram — mermaid 代码块的聊天内渲染（SVG 矢量图）
 *
 * - 动态 import('mermaid')：vite 拆独立 chunk，首屏不加载（约 2MB 按需拉起），
 *   库只初始化一次（startOnLoad:false，渲染全走 API）
 * - theme:'dark' 对齐应用暗色底；securityLevel:'strict' 保持默认消毒，
 *   SVG 输出经 mermaid 内部 DOMPurify 清洗后才进 dangerouslySetInnerHTML
 * - 防呆：渲染失败不吞错——展示原因 + 原始代码兜底；渲染中显示原始代码占位
 * - 每次 render 用全局自增 id，避免 mermaid 内部节点 id 冲突
 */
import { useEffect, useRef, useState } from 'react';

/** 对 mermaid 动态模块的最小结构化类型（避免内联 import() 类型标注） */
interface LoadedMermaid {
  default: {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, text: string) => Promise<{ svg: string }>;
  };
}

/** 单例加载 + 一次性 initialize（并发请求共享同一个 Promise） */
let mermaidPromise: Promise<LoadedMermaid> | null = null;

function loadMermaid(): Promise<LoadedMermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // base 主题 + 自定义配色：内置 dark 主题偏灰黑，这里对齐应用主题色
        // （--accent-brand 青绿系），深底上节点有实色填充、连线可读
        theme: 'base',
        fontFamily: 'inherit',
        themeVariables: {
          fontSize: '15px',
          primaryColor: '#115e59',
          primaryTextColor: '#ccfbf1',
          primaryBorderColor: '#2dd4bf',
          secondaryColor: '#1e3a5f',
          secondaryTextColor: '#dbeafe',
          secondaryBorderColor: '#60a5fa',
          tertiaryColor: '#3b2f4a',
          tertiaryTextColor: '#ede9fe',
          tertiaryBorderColor: '#a78bfa',
          lineColor: '#94a3b8',
          textColor: '#cbd5e1',
          edgeLabelBackground: '#16202b',
          clusterBkg: 'rgba(45, 212, 191, 0.06)',
          clusterBorder: 'rgba(45, 212, 191, 0.35)',
          noteBkgColor: '#1e3a5f',
          noteTextColor: '#dbeafe',
          noteBorderColor: '#60a5fa',
          actorBkg: '#115e59',
          actorBorder: '#2dd4bf',
          actorTextColor: '#ccfbf1',
          signalColor: '#cbd5e1',
          signalTextColor: '#cbd5e1',
          labelBoxBkgColor: '#1e3a5f',
          labelBoxBorderColor: '#60a5fa',
        },
      });
        return m as LoadedMermaid;
    });
  }
  return mermaidPromise;
}
/** 深底友好的节点调色板：青 / 蓝 / 紫 / 琥珀 循环 */
const NODE_PALETTE: ReadonlyArray<{ fill: string; stroke: string }> = [
  { fill: '#115e59', stroke: '#2dd4bf' },
  { fill: '#1e3a5f', stroke: '#60a5fa' },
  { fill: '#3b2f4a', stroke: '#a78bfa' },
  { fill: '#5c4a1e', stroke: '#fbbf24' },
];

/**
 * 渲染后处理：对 SVG 里每个 g.node 轮换填充/描边色，文字统一浅色。
 * mermaid 流程图默认所有节点同色（primaryColor），不靠 classDef 就能出彩色。
 * 只改颜色属性、不改结构，输入是 mermaid 自身消毒过的输出。
 */
function recolorNodes(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    const nodes = root.querySelectorAll('g.node');
    nodes.forEach((node, i) => {
      const { fill, stroke } = NODE_PALETTE[i % NODE_PALETTE.length];
      node.querySelectorAll('rect, polygon, circle, ellipse, path').forEach((shape) => {
        const el = shape as SVGElement;
        el.style.setProperty('fill', fill);
        el.style.setProperty('stroke', stroke);
      });
      node.querySelectorAll('text, .label span').forEach((t) => {
        (t as SVGElement).style.setProperty('color', '#eef2f7');
        (t as SVGElement).style.setProperty('fill', '#eef2f7');
      });
    });
    return new XMLSerializer().serializeToString(root);
  } catch {
    return svg; // 后处理失败不影响出图，退回原样
  }
}

/** 全局自增渲染 id（跨实例唯一，防 mermaid 内部 svg id 冲突） */
let renderSeq = 0;

type RenderState = { svg?: string; error?: string };

export default function MermaidDiagram({ code }: { code: string }) {
  const [state, setState] = useState<RenderState>({});
  const instanceId = useRef('tiffa-mermaid');

  useEffect(() => {
    let cancelled = false;
    setState({});
    loadMermaid()
      .then((m) =>
        m.default.render(`${instanceId.current}-${++renderSeq}`, code),
      )
      .then(({ svg }) => {
        if (!cancelled) setState({ svg: recolorNodes(svg) });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.svg) {
    return (
      <div
        className="mermaid-diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  if (state.error) {
    return (
      <div className="mermaid-fallback">
        <div className="mermaid-fallback-hint">
          图表渲染失败（{state.error}），以下为原始代码：
        </div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  // 加载/渲染中：先按普通代码块占位，完成后无缝替换为图
  return (
    <pre className="mermaid-loading">
      <code>{code}</code>
    </pre>
  );
}
