const layoutsData = [];

layouts.forEach(layout => {
  const result = require('child_process').execSync(\`node "G:\\Agent\\portable-opencode\\data\\config\\opencode\\skills\\dashiai-ppt\\project\\scripts\\inspect-layout.mjs" --compact \${layout}\`, {encoding: 'utf8'});
  layoutsData.push(JSON.parse(result).layouts[0]);
});

console.log(JSON.stringify(layoutsData, null, 2));
