import { readFileSync, existsSync } from 'fs';
import path from 'node:path';

const manifest = JSON.parse(readFileSync('../layout-manifest.json', 'utf8'));
const layouts = manifest.layouts || {};
// 便携路径：禁止硬编码盘符。goal.json 依次从 argv / GOAL_JSON 环境变量 / cwd 解析
function resolveGoalJson() {
  const candidates = [process.argv[2], process.env.GOAL_JSON, path.join(process.cwd(), 'goal.json')].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return JSON.parse(readFileSync(c, 'utf8'));
  }
  console.error('goal.json not found. Pass path as argv[1] or set GOAL_JSON env.');
  process.exit(1);
}
const goal = resolveGoalJson();
const slides = goal.slides || [];

for (let idx = 0; idx < slides.length; idx++) {
  const slide = slides[idx];
  const layoutId = slide.layout;
  const layout = layouts[layoutId];
  if (!layout) {
    console.log("MISSING Slide " + (idx+1) + " layout=" + layoutId);
    continue;
  }
  const controls = layout.controls || [];
  const propNames = controls.map(c => c.prop).filter(Boolean);
  console.log("SLIDE " + (idx+1) + " LAYOUT=" + layoutId + " SLOT=" + layout.slot + " CONTROLS=" + propNames.length);
  for (const p of propNames) {
    console.log("  " + p);
  }
  console.log("");
}
