// check-placeholders.mjs — 交付前内容填充校验（模拟渲染合并，不依赖浏览器）
// 用法（CLI）: node check-placeholders.mjs --dir <ppt目录>
// 用法（模块）: import { checkDeck } from './check-placeholders.mjs'; const r = checkDeck(dir);
// 逻辑: 读 view-model(sourceProps) + 每页 data-prop-defaults(defaultProps) → 合并 → 检查占位符/模板残留
// 返回: { ok, slideCount, issues[] }；CLI 退出码 0 = 干净; 1 = 残留; 2 = 用法错误
import fs from 'node:fs';
import path from 'node:path';

export const PLACEHOLDER_PATTERNS = [
  /「请输入[^」]*」/g,
  /\[待填充[^\]]*\]/g,
  /^ENTER CONTENT$/gm,
  /请输入[^「\n]{1,12}(标题|内容|名称|数值|标签|单位|机构)/g,
];

export const FORBIDDEN_TERMS = [
  '教育 AI', '医疗 AI', '法律 AI', '金融 AI', '企业搜索', '内容生成',
  '开源模型', '模型对齐', '低代码', '客服 AI', '具身智能', '自动驾驶',
  'AI 安全', '算力云', 'AI 芯片', '销售营销', 'K12 辅导', '企业培训', '教师工具',
  'OpenAI', 'NVIDIA', '资本结构', '智 造 集 团', '精益智造', '链通全国',
  '高效履约', '零售运营', '供应链', '生产基地智能化改造',
  '集团供应链体系', '融资 / 亿美元', 'Deal Map', 'Avg Ticket',
  'Concentration', 'Investor', '把握消费趋势', '激活终端潜力',
  '物流网络 / 配送图景', '零售门店运营', '智能制造', '自动化改造',
  '打通物流脉络', '构筑产业护城河', '实战培训', '全国零售门店',
  '用心服务客户', '实干创造业绩', 'SMART · MANUFACTURING',
  'THREE-YEAR · STRATEGY', 'RETAIL OPERATION GROWTH',
  '个性化习题与答疑', '岗位技能与上岗考核', '备课、批改与学情分析',
];

export function findProblems(text) {
  const set = new Set();
  for (const re of PLACEHOLDER_PATTERNS) {
    const m = text.match(re);
    if (m) m.forEach(x => set.add('占位符: ' + x));
  }
  for (const term of FORBIDDEN_TERMS) {
    if (text.includes(term)) set.add('模板残留: ' + term);
  }
  return [...set];
}

function collectStrings(obj, path = '', out = []) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === 'string') { out.push({ path, value: obj }); return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out)); return out; }
  if (typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) collectStrings(v, path ? `${path}.${k}` : k, out); }
  return out;
}

// 简单深合并（sparse 覆盖 default；数组/对象递归）
export function mergeProps(defaults, sparse) {
  const next = { ...(defaults || {}) };
  for (const [k, v] of Object.entries(sparse || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && next[k] && typeof next[k] === 'object' && !Array.isArray(next[k])) {
      next[k] = mergeProps(next[k], v);
    } else if (v !== undefined) {
      next[k] = v;
    }
  }
  return next;
}

export function checkHtmlText(html) {
  const issues = [];
  // 1) view-model（sourceProps）
  const vmMatch = html.match(/<script id="deck-view-model" type="application\/json">([\s\S]*?)<\/script>/);
  if (!vmMatch) return { ok: false, slideCount: 0, issues: ['无法解析 deck-view-model（渲染可能失败）'] };
  let vm;
  try { vm = JSON.parse(vmMatch[1]); } catch { return { ok: false, slideCount: 0, issues: ['deck-view-model JSON 解析失败'] }; }

  // 2) 每页 data-prop-defaults（defaultProps，HTML 实体解码）
  const defaultsByLayout = {};
  const sectionRe = /<section class="slide[\s\S]*?data-vm-layout="([^"]+)"[\s\S]*?data-prop-defaults="([^"]*)"[\s\S]*?<\/section>/g;
  let m;
  while ((m = sectionRe.exec(html)) !== null) {
    const layout = m[1];
    const raw = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    try { defaultsByLayout[layout] = JSON.parse(raw); } catch { /* 忽略解析失败 */ }
  }

  (vm.slides || []).forEach((slide, i) => {
    const source = slide.props || {};
    const defaults = defaultsByLayout[slide.layout] || {};
    const merged = mergeProps(defaults, source);
    const problems = new Set();
    for (const { value } of collectStrings(merged)) {
      findProblems(value).forEach(p => problems.add(p));
    }
    if (problems.size) issues.push(`slide ${i + 1} (${slide.layout}): ${[...problems].join(' | ')}`);
  });

  return { ok: issues.length === 0, slideCount: (vm.slides || []).length, issues };
}

export function checkDeck(dir) {
  const indexPath = path.join(dir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return { ok: false, slideCount: 0, issues: [`未找到 ${indexPath}`] };
  }
  const html = fs.readFileSync(indexPath, 'utf8');
  return checkHtmlText(html);
}

// ===== CLI 入口 =====
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  return args;
}

// 只有直接执行时才走 CLI（避免 import 时触发）
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir;
  if (!dir) {
    console.error('用法: node check-placeholders.mjs --dir <ppt目录>');
    process.exit(2);
  }
  const result = checkDeck(dir);
  console.log(`检查 ${result.slideCount} 页（合并默认值后）`);
  if (result.ok) {
    console.log('✅ 内容填充校验通过，无占位符、无模板残留，可交付。');
    process.exit(0);
  } else {
    console.error('❌ 检测到未填充内容，不可交付！');
    result.issues.forEach(x => console.error('  ' + x));
    console.error('\n请补充这些页面的内容后重新渲染，再次运行本校验。');
    process.exit(1);
  }
}
