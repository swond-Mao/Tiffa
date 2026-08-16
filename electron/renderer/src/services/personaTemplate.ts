/**
 * personaTemplate — 角色卡本地兜底模板 + 扩写 prompt + 预设性格标签
 *
 * 扩写链路：SettingsPanel 点击「生成角色卡」→ completeWithLightModel(旁路模型)
 * 失败（无可用模型）→ buildFallbackPersona 本地模板兜底。
 */

/** 预设性格标签（可多选，另有自定义手填） */
export const PERSONA_KEYWORDS = [
  '傲娇', '高冷', '温柔', '活泼', '毒舌', '成熟', '病娇', '元气', '冷静', '腹黑',
  '天然呆', '御姐', '正太', '中二', '治愈', '强势', '腼腆', '优雅', '慵懒', '理性',
  '感性', '幽默', '神秘', '可爱', '清冷', '热烈', '沉静',
];

/**
 * 本地模板兜底：输入性别+关键词，输出一张可用的结构化默认角色卡。
 * 仅当旁路模型不可用时使用，保证流程不卡死。
 */
export function buildFallbackPersona(name: string, gender: string, keywords: string[]): string {
  const kw = keywords.length ? keywords.join('、') : '温和';
  return [
    '【身份】' + (name || '助手') + (gender ? `（${gender}）` : ''),
    `【性格】以${kw}为主基调，沉稳而克制，话不多但句句有分量。`,
    '【语气】简洁、直接，不寒暄、不堆砌形容词。',
    '【说话方式】多用短句，陈述句为主，偶尔反问。',
    '【行为习惯】先给结论再讲理由；能用一句话说清绝不多写。',
    '【禁忌】不卖萌、不刷表情、不冗余客套。',
  ].join('\n');
}

/** 扩写 prompt：约束 LLM 产出结构化角色卡 */
export function buildPersonaPrompt(name: string, gender: string, keywords: string[]): string {
  const kw = keywords.length ? keywords.join('、') : '温和';
  return `你是角色设定写手。根据以下要求扩写一张【结构化角色卡】，用于注入 AI 助手的人设。
必须严格按以下 6 个分节输出，每节一行「【标签】内容」。不要输出额外解释。
【身份】【性格】【语气】【说话方式】【行为习惯】【禁忌】

名字：${name}　性别：${gender}　性格关键词：${kw}
要求：
1. 性格要"有血有肉"但可执行——给具体语气和行为，不给空泛形容词堆砌。
2. 语气/说话方式要写成可直接照做的规则（如"多用短句""先怼一句再帮忙"）。
3. 控制在 8~15 行。`;
}
