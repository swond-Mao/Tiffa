#!/usr/bin/env node
/**
 * pptx-designer extract_assets.js
 * 从 docx/pptx/xlsx 中提取图片到指定目录（纯 JS 解包，无需 python）
 *
 * 用法:
 *   node scripts/extract_assets.js <文件路径...> -o <输出目录>
 *
 * 支持格式:
 *   .docx -> word/media/*  (python-docx 等价)
 *   .pptx -> ppt/media/*
 *   .xlsx -> xl/media/*
 */
const path = require('path');
const fs = require('fs');
const JSZip = require(path.join(__dirname, '..', 'node_modules', 'jszip'));

const MEDIA_PATHS = {
  '.docx': ['word/media/'],
  '.pptx': ['ppt/media/'],
  '.xlsx': ['xl/media/'],
};

async function extractOne(file, outDir) {
  const ext = path.extname(file).toLowerCase();
  const mediaPrefixes = MEDIA_PATHS[ext];
  if (!mediaPrefixes) {
    console.log(`[skip] 不支持格式 ${ext}: ${file}`);
    return 0;
  }
  const buf = fs.readFileSync(file);
  const zip = await JSZip.loadAsync(buf);
  let count = 0;
  for (const prefix of mediaPrefixes) {
    for (const name of Object.keys(zip.files)) {
      if (!name.startsWith(prefix) || zip.files[name].dir) continue;
      const entry = zip.files[name];
      const data = await entry.async('nodebuffer');
      // 跳过过小文件（<10KB 大概率是装饰/图标）
      if (data.length < 10 * 1024) continue;
      const base = path.basename(name);
      const target = path.join(outDir, `${path.basename(file, ext)}_${base}`);
      fs.writeFileSync(target, data);
      console.log(`  ✓ ${base} (${(data.length / 1024).toFixed(0)}KB) -> ${target}`);
      count++;
    }
  }
  return count;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('-o');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : 'resources/images';
  // 排除 -o 及其值，剩余都是输入文件
  const files = args.filter((a, i) => a !== '-o' && (outIdx < 0 || i !== outIdx + 1) && !a.startsWith('-'));
  if (!files.length) {
    console.error('用法: node scripts/extract_assets.js <docx/pptx/xlsx...> -o <输出目录>');
    process.exit(1);
  }
  fs.mkdirSync(path.resolve(outDir), { recursive: true });
  let total = 0;
  for (const f of files) {
    if (!fs.existsSync(f)) { console.log(`[skip] 文件不存在: ${f}`); continue; }
    console.log(`处理 ${f}:`);
    total += await extractOne(f, outDir);
  }
  console.log(`\n✅ 共提取 ${total} 张图片 -> ${path.resolve(outDir)}`);
}

main().catch(e => { console.error('❌ 提取失败:', e.message); process.exit(1); });
