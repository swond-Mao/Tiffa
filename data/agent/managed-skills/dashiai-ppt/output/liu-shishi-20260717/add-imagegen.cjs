#!/usr/bin/env node
const fs = require('fs');

const goalPath = 'output/liu-shishi-20260717/goal.json';
const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));

// 为所有 slides 添加 imageGen: true
goal.slides.forEach(slide => {
  if (!slide.imageGen) {
    slide.imageGen = true;
  }
});

fs.writeFileSync(goalPath, JSON.stringify(goal, null, 2));
console.log('Updated ' + goal.slides.length + ' slides with imageGen: true');
