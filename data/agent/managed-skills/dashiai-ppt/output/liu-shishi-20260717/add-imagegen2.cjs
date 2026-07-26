#!/usr/bin/env node
const fs = require('fs');

const goalPath = 'output/liu-shishi-20260717/goal.json';
const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));

const hasMediaSlots = {
  'theme09_page003': false,
  'theme09_page110': true,
  'theme09_page034': false,
  'theme09_page100': true,
  'theme09_page038': false,
  'theme09_page084': false,
  'theme09_page035': false,
  'theme09_page057': false,
  'theme09_page024': true,
  'theme09_page108': true,
  'theme09_page013': false,
  'theme09_page098': false,
  'theme09_page074': true,
  'theme09_page039': true,
  'theme09_page029': false,
  'theme09_page053': false,
  'theme09_page010': false,
  'theme09_page014': true,
  'theme09_page041': false,
  'theme09_page101': false
};

goal.slides.forEach(slide => {
  const layout = slide.layout;
  if (hasMediaSlots[layout]) {
    slide.imageGen = true;
    slide.props.images = true;
  } else {
    delete slide.imageGen;
  }
});

fs.writeFileSync(goalPath, JSON.stringify(goal, null, 2));
console.log('Updated: ' + goal.slides.filter(s => hasMediaSlots[s.layout]).length + ' slides with imageGen');
