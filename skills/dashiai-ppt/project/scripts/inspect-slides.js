const fs = require("fs");
const path = require("path");
const manifest = require("./layout-manifest.json");
const layouts = manifest.layouts || {};
// 便携路径：禁止硬编码盘符。goal.json 路径依次从 argv / GOAL_JSON 环境变量 / cwd 解析
function resolveGoal() {
  const candidates = [process.argv[2], process.env.GOAL_JSON, path.join(process.cwd(), "goal.json")].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf8"));
  }
  console.error("goal.json not found. Pass path as argv[1] or set GOAL_JSON env.");
  process.exit(1);
}
const goal = resolveGoal();
const slides = goal.slides || [];

slides.forEach((slide, idx) => {
  const layoutId = slide.layout;
  const layout = layouts[layoutId];
  if (!layout) {
    console.log("MISSING Slide " + (idx+1) + " layout=" + layoutId);
    return;
  }
  const controls = layout.controls || [];
  const propNames = controls.map(c => c.prop).filter(Boolean);
  console.log("SLIDE " + (idx+1) + " LAYOUT=" + layoutId + " SLOT=" + layout.slot + " CONTROLS=" + propNames.length);
  propNames.forEach(p => {
    console.log("  " + p);
  });
  console.log("");
});
