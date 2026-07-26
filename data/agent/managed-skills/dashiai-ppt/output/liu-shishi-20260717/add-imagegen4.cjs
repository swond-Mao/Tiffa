#!/usr/bin/env node
const fs = require('fs');

const goalPath = 'output/liu-shishi-20260717/goal.json';
const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));

goal.slides.forEach(slide => {
  if (slide.imageGen && slide.props.images === true) {
    slide.props.images = [true];
  }
});

fs.writeFileSync(goalPath, JSON.stringify(goal, null, 2));
console.log('Fixed images to [true] arrays');
