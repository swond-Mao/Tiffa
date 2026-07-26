#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const goalPath = 'output/liu-shishi-20260717/goal.json';
const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));

// 创建 media 目录
const mediaDir = 'output/liu-shishi-20260717/ppt/assets/user-media';
const fsPath = path.join('output', 'liu-shishi-20260717', 'ppt', 'assets', 'user-media');

// 下载图片
const urls = [
  {url: 'https://images.unsplash.com/photo-1534528741775-539af410f9fa?q=80&w=1080&auto=format&fit=crop', count: 8},
  {url: 'https://images.unsplash.com/photo-1485230405346-71bc71f95473?q=80&w=1080&auto=format&fit=crop', count: 4},
  {url: 'https://images.unsplash.com/photo-1516054515582-471451d50164?q=80&w=1080&auto=format&fit=crop', count: 9}
];

let mediaCount = 0;

urls.forEach(({url, count}) => {
  const baseName = url.split('/').pop().split('?')[0];
  for (let i = 0; i < count; i++) {
    const fileName = baseName + '_' + i + '.jpg';
    const filePath = fsPath + '/' + fileName;
    
    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      mediaCount++;
      console.log('  Found:', fileName);
      continue;
    }
    
    console.log('  Downloading:', fileName);
    
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
      });
    }).on('error', (err) => {
      console.error('Error downloading', url, err);
      fs.unlinkSync(filePath);
    });
  }
});

console.log('Downloaded', mediaCount, 'images');

// 更新 goal.json 使用本地路径
const relativeBase = 'ppt/assets/user-media';
let usedFiles = {};

goal.slides.forEach(slide => {
  if (slide.props && slide.props.images && Array.isArray(slide.props.images)) {
    slide.props.images = slide.props.images.map((img, idx) => {
      const baseName = url.split('/').pop().split('?')[0];
      const fileName = baseName + '_' + idx + '.jpg';
      
      if (!usedFiles[fileName]) {
        usedFiles[fileName] = [];
      }
      usedFiles[fileName].push(slide);
      
      return relativeBase + '/' + fileName;
    });
  }
});

fs.writeFileSync(goalPath, JSON.stringify(goal, null, 2));
console.log('Updated goal.json with local media paths');
