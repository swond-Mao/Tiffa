import { readFileSync, writeFileSync } from 'fs';
import path from 'node:path';

// 便携路径：禁止硬编码盘符。源 metadata.js 依次从 argv[2] / THEMES_METADATA 环境变量 / cwd 相对路径解析
const metaFile = process.argv[2] || process.env.THEMES_METADATA || path.join(process.cwd(), 'src', 'components', 'themes', 'theme09', 'metadata.js');
const raw = readFileSync(metaFile);
let m = raw.toString('utf8');
const idx = m.indexOf('export const pages');
const rest = m.substring(idx);

// Find array bounds
let depth = 0;
let endIdx = -1;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '[') depth++;
  else if (rest[i] === ']') { depth--; if (depth === 0) { endIdx = i; break; } }
}
const arrayStart = rest.indexOf('[', 8);
let jsonStr = rest.substring(arrayStart, endIdx).trim();

// Extract each top-level object by counting braces
const pages = [];
let i = 0;
while (i < jsonStr.length) {
  if (jsonStr[i] === '{') {
    let braceDepth = 0;
    let start = i;
    let inString = false;
    let escape = false;
    while (i < jsonStr.length) {
      const ch = jsonStr[i];
      if (escape) { escape = false; i++; continue; }
      if (ch === '\\') { escape = true; i++; continue; }
      if (ch === '"') { inString = !inString; i++; continue; }
      if (inString) { i++; continue; }
      if (ch === '{') { braceDepth++; }
      if (ch === '}') { braceDepth--; if (braceDepth === 0) break; }
      i++;
    }
    const objStr = jsonStr.substring(start, i + 1);
    try {
      pages.push(JSON.parse(objStr));
    } catch(e) {
      console.error('Failed to parse page:', e.message);
    }
  }
  i++;
}

console.log('Extracted', pages.length, 'pages');
const result = pages.map(p => ({
  key: p.key,
  layout: p.layout,
  slot: p.slot,
  label: p.label,
  controls: p.controls ? p.controls.map(c => ({key: c.key, type: c.type})) : [],
  defaultProps: Object.keys(p.defaultProps || {})
}));
const outFile = process.argv[3] || path.join(process.cwd(), 'pages-props.json');
writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
console.log('Saved to ' + outFile);
