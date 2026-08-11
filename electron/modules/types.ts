/**
 * 主进程共享类型定义
 */

/** JSONL 会话文件头部信息 */
export interface SessionHeader {
  path: string;
  name: string;
  sessionId: string | null;
  cwd: string | null;
  title: string | null;
  firstMessage: string;
  messageCount: number;
  size: number;
  modified: number;
  error?: string;
}

/** readTailLines 返回结构 */
export interface TailLinesResult {
  lines: string[];
  reachedStart: boolean;
  droppedAny: boolean;
}

/** 解析后的消息（parseSessionLines 产出） */
export interface ParsedMessage {
  role: string;
  text: string;
  thinking: string;
  toolCalls: ParsedToolCall[];
  timestamp?: string;
  model?: string;
  provider?: string;
  steering?: boolean;
  follow_up?: boolean;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

/** JSONL 行的宽松类型（内核写入，结构不保证） */
export type JsonlLine = Record<string, unknown>;
