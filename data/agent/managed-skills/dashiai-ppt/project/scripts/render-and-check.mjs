// render-and-check.mjs — 渲染 PPT 并自动执行内容填充校验（交付门禁）
// 用法: node render-and-check.mjs <goal.json> <output/ppt/index.html>
// 流程: 1) 调 render-goal-deck.jsx 渲染  2) 自动跑 check-placeholders 校验
// 退出码: 0 = 渲染成功且校验通过; 1 = 校验未通过（禁止交付）; 2 = 渲染失败/用法错误
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeck } from './check-placeholders.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [, , specArg, outArg] = process.argv;
if (!specArg || !outArg) {
  console.error('用法: node render-and-check.mjs <goal-spec.json> <output/ppt/index.html>');
  process.exit(2);
}

const CALLER_CWD = process.env.INIT_CWD || process.cwd();
const specPath = path.resolve(CALLER_CWD, specArg);
const outFile = path.resolve(CALLER_CWD, outArg);
const pptDir = path.dirname(outFile);

// 1) 渲染
console.log('━━ 渲染中…');
const render = spawnSync(process.execPath, [
  '--import', 'tsx',
  path.join(__dirname, 'render-goal-deck.jsx'),
  specPath, outFile,
], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });

if (render.status !== 0) {
  process.stdout.write(render.stdout || '');
  process.stderr.write(render.stderr || '');
  console.error('\n❌ 渲染失败，无法交付。');
  process.exit(2);
}
console.log('✅ 渲染完成:', path.relative(CALLER_CWD, outFile) || outFile);

// 2) 自动校验（交付门禁）
console.log('\n━━ 内容填充校验（交付门禁）…');
const result = checkDeck(pptDir);
console.log(`检查 ${result.slideCount} 页（合并默认值后）`);
if (result.ok) {
  console.log('✅ 内容填充校验通过，无占位符、无模板残留，可交付。');
  process.exit(0);
} else {
  console.error('❌ 检测到未填充内容，不可交付！');
  result.issues.forEach(x => console.error('  ' + x));
  console.error('\n请补充这些页面的内容后重新渲染（再次运行本命令），校验通过后才能交付。');
  process.exit(1);
}
