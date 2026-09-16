import { readFileSync } from 'fs';

const manifest = JSON.parse(readFileSync('../layout-manifest.json', 'utf8'));
const layouts = manifest.layouts || {};
const goal = JSON.parse(readFileSync('G:/workspace/goal.json', 'utf8'));
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
