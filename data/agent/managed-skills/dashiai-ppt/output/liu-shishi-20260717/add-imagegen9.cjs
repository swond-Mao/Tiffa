#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const goalPath = 'output/liu-shishi-20260717/goal.json';
const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));

// 创建 media 目录
const mediaDir = 'output/liu-shishi-20260717/ppt/assets/user-media';
const fsPath = 'output' + path.sep + 'liu-shishi-20260717' + path.sep + 'ppt' + path.sep + 'assets' + path.sep + 'user-media';

// 下载图片
var urls = [
  {url: 'https://images.unsplash.com/photo-1534528741775-539af410f9fa?q=80&w=1080&auto=format&fit=crop', count: 8},
  {url: 'https://images.unsplash.com/photo-1485230405346-71bc71f95473?q=80&w=1080&auto=format&fit=crop', count: 4},
  {url: 'https://images.unsplash.com/photo-1516054515582-471451d50164?q=80&w=1080&auto=format&fit=crop', count: 9}
];

var mediaCount = 0;

urls.forEach(function(urlObj) {
  var url = urlObj.url;
  var count = urlObj.count;
  var baseName = url.split('/').pop().split('?')[0];
  
  for (var i = 0; i < count; i++) {
    var fileName = baseName + '_' + i + '.jpg';
    var filePath = fsPath + '/' + fileName;
    
    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      mediaCount++;
      console.log('  Found:', fileName);
      continue;
    }
    
    console.log('  Downloading:', fileName);
    
    var file = fs.createWriteStream(filePath);
    https.get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close();
      });
    }).on('error', function(err) {
      console.error('Error downloading', url, err);
      fs.unlinkSync(filePath);
    });
  }
});

console.log('Downloaded', mediaCount, 'images');

// 更新 goal.json 使用本地路径
var relativeBase = 'ppt/assets/user-media';
var usedFiles = {};

goal.slides.forEach(function(slide) {
  if (slide.props && slide.props.images && Array.isArray(slide.props.images)) {
    slide.props.images = slide.props.images.map(function(img, idx) {
      var baseUrl = url.split('/').pop().split('?')[0];
      var fileName = baseUrl + '_' + idx + '.jpg';
      
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
