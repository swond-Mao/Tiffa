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

// Each layout has a slot and may have controls with "prop" fields
// Also each layout may have countBindings and controls
for (let idx = 0; idx < slides.length; idx++) {
  const slide = slides[idx];
  const layoutId = slide.layout;
  const layout = layouts[layoutId];
  if (!layout) {
    console.log("MISSING Slide " + (idx+1) + " layout=" + layoutId);
    continue;
  }
  console.log("SLIDE " + (idx+1) + " LAYOUT=" + layoutId + " SLOT=" + layout.slot);
  
  // Check all fields on the layout object
  const layoutKeys = Object.keys(layout);
  console.log("  ALL KEYS: " + JSON.stringify(layoutKeys));
  
  // Check controls
  if (layout.controls && layout.controls.length > 0) {
    console.log("  CONTROLS:");
    for (const c of layout.controls) {
      console.log("    " + JSON.stringify(c));
    }
  }
  
  // Check countBindings
  if (layout.countBindings && layout.countBindings.length > 0) {
    console.log("  COUNTBINDINGS: " + JSON.stringify(layout.countBindings));
  }
  
  console.log("");
}
