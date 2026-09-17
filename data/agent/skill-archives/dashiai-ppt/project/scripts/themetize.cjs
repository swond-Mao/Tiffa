// themetize: 从 PPTX 模板风格生成 dashiai-ppt 新主题（克隆基底 + token 级换肤）
// 用法: node themetize.mjs --base theme07 --out theme13 --name "公卫例会风" \
//        --accent 005DA2 --accent-bright 1F497D --accent-soft E8F0F8 \
//        --ink 0D100A --paper FFFFFF --font "微软雅黑"
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const THEMES = path.resolve(__dirname, '../src/components/themes');
const base = args.base || 'theme07';
const out = args.out || 'theme13';
const name = args.name || '新主题';
const scenario = args.scenario || '政务汇报、医疗公卫、政策解读、学术会议';
const audience = args.audience || '政府机构、医院、事业单位、研究机构';
const accent = (args.accent || '005DA2').replace(/^#/, '');
const accentBright = (args.accentBright || '1F497D').replace(/^#/, '');
const accentDeep = (args.accentDeep || '123B63').replace(/^#/, '');
const accentSoft = (args.accentSoft || 'E8F0F8').replace(/^#/, '');
const ink = (args.ink || '0D100A').replace(/^#/, '');
const paper = (args.paper || 'FFFFFF').replace(/^#/, '');
const font = args.font || "'微软雅黑','Noto Sans SC',system-ui,sans-serif";

const baseDir = path.join(THEMES, base);
const outDir = path.join(THEMES, out);
if (!fs.existsSync(baseDir)) { console.error('基底主题不存在:', baseDir); process.exit(1); }
if (fs.existsSync(outDir)) { console.error('目标主题已存在:', outDir); process.exit(1); }

// 1. 复制目录
fs.cpSync(baseDir, outDir, { recursive: true });

// 2. 改 metadata.js: key/themeKey/名称 + 主题色
const metaPath = path.join(outDir, 'metadata.js');
let meta = fs.readFileSync(metaPath, 'utf8');
meta = meta.split(`"key": "${base}"`).join(`"key": "${out}"`);
meta = meta.split(`"themeKey": "${base}"`).join(`"themeKey": "${out}"`);
meta = meta.split(`"displayName": "${base === 'theme07' ? '冷白调研风' : base}"`).join(`"displayName": "${name}"`);
meta = meta.split(`"label": "${base === 'theme07' ? '冷白调研风' : base}"`).join(`"label": "${name}"`);
meta = meta.split(`"name": "${base === 'theme07' ? '冷白调研风' : base}"`).join(`"name": "${name}"`);
meta = meta.split(`"scenario": "调研报告、白皮书、竞品分析、学术/政策型表达"`).join(`"scenario": "${scenario}"`);
meta = meta.split(`"audience": "研究机构、咨询团队、政府/高校/智库、B2B 团队"`).join(`"audience": "${audience}"`);
// 替换主题色（theme07 的绿色系）
const colorMap = {
  '#8FD400': '#' + accent,
  '#86D62B': '#' + accent,
  '#AEEA46': '#' + accentBright,
  '#5FA01A': '#' + accentDeep,
  '#E9FBC6': '#' + accentSoft,
  '#C2EE3A': '#' + accentBright,
  '#5BB000': '#' + accentDeep,
  '#3C8A00': '#' + accentDeep,
  '#F4F5F0': '#' + paper,
  '#ECEEE6': '#' + paper,
};
Object.entries(colorMap).forEach(([from, to]) => { meta = meta.split(from).join(to); });
// layout 前缀 THEME07 -> THEME13
meta = meta.split('THEME07-').join('THEME13-');
fs.writeFileSync(metaPath, meta);
console.log('metadata.js 更新完成');

// 3. 改 theme.js: THEME token
const themeJsPath = path.join(outDir, 'source/src/theme.js');
let themeJs = fs.readFileSync(themeJsPath, 'utf8');
themeJs = themeJs.replace(/accent:\s*'#[0-9A-Fa-f]{6}'/, `accent: '#${accent}'`);
themeJs = themeJs.replace(/accentBright:\s*'#[0-9A-Fa-f]{6}'/, `accentBright: '#${accentBright}'`);
themeJs = themeJs.replace(/accentDeep:\s*'#[0-9A-Fa-f]{6}'/, `accentDeep: '#${accentDeep}'`);
themeJs = themeJs.replace(/accentSoft:\s*'#[0-9A-Fa-f]{6}'/, `accentSoft: '#${accentSoft}'`);
themeJs = themeJs.replace(/paper:\s*'#[0-9A-Fa-f]{6}'/, `paper: '#${paper}'`);
themeJs = themeJs.replace(/fontDisplay:\s*'[^']*'/, `fontDisplay: '${font}'`);
themeJs = themeJs.replace(/fontText:\s*'[^']*'/, `fontText: '${font}'`);
fs.writeFileSync(themeJsPath, themeJs);
console.log('theme.js 更新完成');

console.log('\n主题生成成功:', outDir);
console.log('下一步: 更新注册表（theme-registry-codegen.mjs + generated-metadata.js + dist bundle）');
