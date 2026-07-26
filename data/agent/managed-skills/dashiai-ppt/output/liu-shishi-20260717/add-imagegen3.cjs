#!/usr/bin/env node
const fs = require('fs');

const goalPath = 'output/liu-shishi-20260717/goal.json';
const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));

goal.slides.forEach(slide => {
  if (slide.imageGen) {
    if (!slide.props.images) {
      slide.props.images = [];
    }
  }
});

fs.writeFileSync(goalPath, JSON.stringify(goal, null, 2));
console.log('Fixed props.images to arrays');
