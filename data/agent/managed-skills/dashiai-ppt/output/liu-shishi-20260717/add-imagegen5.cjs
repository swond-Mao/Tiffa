#!/usr/bin/env node
const fs = require('fs');

const goalPath = 'output/liu-shishi-20260717/goal.json';
const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));

const imageSpecs = {
  'theme09_page110': {count: 3, src: 'https://images.unsplash.com/photo-1534528741775-539af410f9fa?q=80&w=1080&auto=format&fit=crop'},
  'theme09_page100': {count: 1, src: 'https://images.unsplash.com/photo-1485230405346-71bc71f95473?q=80&w=1080&auto=format&fit=crop'},
  'theme09_page024': {count: 4, src: 'https://images.unsplash.com/photo-1516054515582-471451d50164?q=80&w=1080&auto=format&fit=crop'},
  'theme09_page108': {count: 4, src: 'https://images.unsplash.com/photo-1534528741775-539af410f9fa?q=80&w=1080&auto=format&fit=crop'},
  'theme09_page074': {count: 3, src: 'https://images.unsplash.com/photo-1485230405346-71bc71f95473?q=80&w=1080&auto=format&fit=crop'},
  'theme09_page039': {count: 5, src: 'https://images.unsplash.com/photo-1516054515582-471451d50164?q=80&w=1080&auto=format&fit=crop'},
  'theme09_page014': {count: 1, src: 'https://images.unsplash.com/photo-1534528741775-539af410f9fa?q=80&w=1080&auto=format&fit=crop'}
};

goal.slides.forEach(slide => {
  const layout = slide.layout;
  if (imageSpecs[layout]) {
    slide.props.images = Array(imageSpecs[layout].count).fill(imageSpecs[layout].src);
  } else if (slide.imageGen) {
    slide.props.images = [];
  }
});

fs.writeFileSync(goalPath, JSON.stringify(goal, null, 2));
console.log('Fixed images arrays with Unsplash URLs');
