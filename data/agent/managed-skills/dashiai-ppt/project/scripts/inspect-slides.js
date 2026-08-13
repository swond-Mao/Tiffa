const manifest = require("./layout-manifest.json");
const layouts = manifest.layouts || {};
const goal = require("G:/workspace/goal.json");
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
