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
  const controls = layout.controls || [];
  const propNames = controls.map(c => c.prop).filter(Boolean);
  console.log("SLIDE " + (idx+1) + " LAYOUT=" + layoutId + " SLOT=" + layout.slot + " CONTROLS=" + propNames.length);
  for (const p of propNames) {
    console.log("  " + p);
  }
  console.log("");
}
