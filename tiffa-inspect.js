// 临时排查脚本：检查会话 JSONL 尾部结构与 compaction 条目（用后即删）
const fs = require('fs');
const path = require('path');

const base = 'G:/Tiffa/data/agent/sessions';
const tailN = Number(process.argv[2] || 250);
const target = process.argv[3] || '';

function findFiles() {
  const out = [];
  for (const d of fs.readdirSync(base)) {
    const dir = path.join(base, d);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dir, f);
      out.push({ p, name: f, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const files = findFiles();
console.log('=== 最近更新的会话文件 ===');
for (const f of files.slice(0, 5)) {
  console.log(f.p.slice(base.length + 1), new Date(f.mtime).toISOString(), f.size);
}

const pick = target ? files.find(f => f.p.includes(target)) || files[0] : files[0];
console.log('\n=== 检查:', pick.name, '===');
const raw = fs.readFileSync(pick.p, 'utf8');
const lines = raw.split('\n');
console.log('总行数(含空行):', lines.length);

// 统计
const types = {};
let parseErr = 0;
const errSamples = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i].trim();
  if (!l) continue;
  try { const o = JSON.parse(l); types[o.type] = (types[o.type] || 0) + 1; }
  catch (e) { parseErr++; if (errSamples.length < 5) errSamples.push({ i, len: l.length, head: l.slice(0, 80) }); }
}
console.log('类型统计:', JSON.stringify(types));
console.log('JSON 解析失败行数:', parseErr);
for (const s of errSamples) console.log('  样例', s.i, 'len=' + s.len, JSON.stringify(s.head));

// 尾部内容（含 compaction 明细）
console.log('\n=== 尾部', tailN, '行明细 ===');
const start = Math.max(0, lines.length - tailN);
for (let i = start; i < lines.length; i++) {
  const l = lines[i].trim();
  if (!l) continue;
  try {
    const o = JSON.parse(l);
    if (o.type === 'message') {
      const m = o.message || {};
      let txt = '';
      if (typeof m.content === 'string') txt = m.content;
      else if (Array.isArray(m.content)) txt = m.content.filter(c => c && c.type === 'text').map(c => c.text).join('');
      const ts = new Date(o.timestamp || m.timestamp || 0);
      console.log(i, 'msg', m.role, ts.toISOString().slice(11, 19), txt.slice(0, 30).replace(/\n/g, '⏎'));
    } else if (o.type === 'compaction') {
      const sm = String(o.summary || '').slice(0, 60).replace(/\n/g, '⏎');
      const img = (o.image && typeof o.image === 'string') ? `[image ${o.image.length}B]` : '';
      console.log(i, 'COMPACTION', (o.id || '').slice(0, 8), 'parent=' + String(o.parentId || '').slice(0, 8), 'firstKept=' + String(o.firstKeptEntryId || '').slice(0, 8), img, 'summary:', sm);
    } else if (o.type === 'title' || o.type === 'title_change') {
      console.log(i, o.type, JSON.stringify(o.title || o.name || '').slice(0, 40));
    } else {
      console.log(i, o.type, o.customType || '');
    }
  } catch {
    console.log(i, 'PARSE_ERR len=' + l.length, JSON.stringify(l.slice(0, 60)));
  }
}

// route 文件
try {
  const rp = 'G:/Tiffa/data/agent/last-compact-route.json';
  console.log('\n=== last-compact-route.json ===');
  console.log(fs.readFileSync(rp, 'utf8'));
} catch (e) { console.log('route 文件不可读:', e.message); }
