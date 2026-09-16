import { readFileSync, writeFileSync } from 'fs';

const raw = readFileSync('G:/Agent/portable-opencode/data/config/opencode/skills/dashiai-ppt/project/src/components/themes/theme09/metadata.js');
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
writeFileSync('G:/Agent/portable-opencode/data/config/opencode/skills/dashiai-ppt/project/scripts/pages-props.json', JSON.stringify(result, null, 2), 'utf8');
console.log('Saved to pages-props.json');
