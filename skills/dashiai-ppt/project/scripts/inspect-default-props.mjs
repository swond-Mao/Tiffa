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
  const dp = layout.defaultProps || {};
  const keys = Object.keys(dp);
  console.log("SLIDE " + (idx+1) + " LAYOUT=" + layoutId + " SLOT=" + layout.slot + " DEFAULTPROPS(" + keys.length + "):");
  for (const k of keys) {
    const v = dp[k];
    let desc;
    if (Array.isArray(v)) {
      desc = '[ARRAY len=' + v.length + ']';
    } else if (v === null) {
      desc = 'null';
    } else if (typeof v === 'object') {
      desc = '{...}';
    } else {
      desc = '"' + String(v).substring(0, 80) + '"';
    }
    console.log("  " + k + " = " + desc);
  }
  console.log("");
}
