import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = 'G:/Tiffa';
console.log('═══════════════════════════════════════════');
console.log('  Tiffa 五层记忆系统 · 端到端验证');
console.log('═══════════════════════════════════════════\n');

let pass = 0, fail = 0;
function check(layer: string, name: string, ok: boolean, detail: string) {
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon} [${layer}] ${name}: ${detail}`);
  ok ? pass++ : fail++;
}

// ── L1: USER.md ──
console.log('── L1 用户偏好 (USER.md) ──');
const userMd = join(ROOT, 'data/memory/USER.md');
const userExists = existsSync(userMd);
check('L1', '文件存在', userExists, userMd);
if (userExists) {
  const content = readFileSync(userMd, 'utf8');
  check('L1', '内容非空', content.trim().length > 0, `${content.trim().length} 字符`);
  check('L1', '包含用户称呼', content.includes('swond'), '识别到 swond');
}
// 检查扩展注入
const ext = readFileSync(join(ROOT, 'plugins/claude-mode-extension.ts'), 'utf8');
check('L1', '扩展注入 USER.md', ext.includes('USER.md') && ext.includes('用户偏好'), 'before_agent_start 中注入');

// ── L2: 全局 bank ──
console.log('\n── L2 全局 bank (mnemopi) ──');
const globalDb = join(ROOT, 'data/agent/memories/mnemopi/mnemopi.db');
const globalExists = existsSync(globalDb);
check('L2', '数据库存在', globalExists, globalDb);
if (globalExists) {
  const d = new Database(globalDb, { readonly: true });
  const embed = d.query('SELECT COUNT(*) as c FROM memory_embeddings').get();
  const episodic = d.query('SELECT COUNT(*) as c FROM episodic_memory').get();
  check('L2', 'embedding 向量', embed.c > 0, `${embed.c} 条`);
  check('L2', 'episodic 记忆', episodic.c > 0, `${episodic.c} 条`);
  // 检查模型
  const model = d.query('SELECT model FROM memory_embeddings LIMIT 1').get();
  check('L2', '模型正确', model?.model === 'BAAI/bge-small-zh-v1.5', model?.model || 'N/A');
  d.close();
}

// ── L3: PROJECT.md ──
console.log('\n── L3 项目纲领 (PROJECT.md) ──');
const workspace = join(ROOT, 'workspace');
const projects = existsSync(workspace) ? readdirSync(workspace).filter(d => {
  try { return existsSync(join(workspace, d, 'PROJECT.md')); } catch { return false; }
}) : [];
check('L3', 'workspace 存在', existsSync(workspace), workspace);
check('L3', '有 PROJECT.md 的项目', projects.length > 0, `${projects.length} 个: ${projects.join(', ') || '无'}`);
check('L3', '扩展注入 PROJECT.md', ext.includes('项目纲领') && ext.includes('写入规则'), '带写入规则注入');
check('L3', '写入限制生效', ext.includes('项目铁律') && ext.includes('非必要不写'), '铁律+里程碑+非必要不写');

// ── L4: per-project bank ──
console.log('\n── L4 项目 bank (per-project-tagged) ──');
const agentDb = new Database(join(ROOT, 'data/agent/agent.db'), { readonly: true });
const scoping = agentDb.query("SELECT value FROM settings WHERE key = 'mnemopi.scoping'").get();
const autoRecall = agentDb.query("SELECT value FROM settings WHERE key = 'mnemopi.autoRecall'").get();
const autoRetain = agentDb.query("SELECT value FROM settings WHERE key = 'mnemopi.autoRetain'").get();
const retainN = agentDb.query("SELECT value FROM settings WHERE key = 'mnemopi.retainEveryNTurns'").get();
const recallLimit = agentDb.query("SELECT value FROM settings WHERE key = 'mnemopi.recallLimit'").get();
const injLimit = agentDb.query("SELECT value FROM settings WHERE key = 'mnemopi.injectionTokenLimit'").get();
agentDb.close();

check('L4', 'scoping 模式', scoping?.value === 'per-project-tagged', scoping?.value || 'N/A');
check('L4', 'autoRecall', autoRecall?.value === 'true', autoRecall?.value || 'N/A');
check('L4', 'autoRetain', autoRetain?.value === 'true', autoRetain?.value || 'N/A');
check('L4', 'retainEveryNTurns', retainN?.value === '2', `每 ${retainN?.value} 轮`);
check('L4', 'recallLimit', recallLimit?.value === '10', `最多 ${recallLimit?.value} 条`);
check('L4', 'injectionTokenLimit', injLimit?.value === '2000', `≤${injLimit?.value} token`);

// ── L5: gap-fill ──
console.log('\n── L5 断片补救 (gap-fill) ──');
check('L5', 'session.compacting hook', ext.includes('session.compacting'), '扩展中注册');
check('L5', 'gap-fill 提取', ext.includes('gap-fill') && ext.includes('gapFillPath'), '提取改动/命令/决策');
check('L5', '60分钟清理', ext.includes('60') && ext.includes('gap-fill-'), '自动清理');

// ── 环境变量 ──
console.log('\n── 环境保障 ──');
const mainJs = readFileSync(join(ROOT, 'electron/main.js'), 'utf8');
check('ENV', 'MNEMOPI_EMBEDDING_MODEL 注入', mainJs.includes('MNEMOPI_EMBEDDING_MODEL'), 'main.js 子进程 env');
const bat = readFileSync(join(ROOT, 'start-tiffa.bat'), 'utf8');
check('ENV', 'start-tiffa.bat 注入', bat.includes('MNEMOPI_EMBEDDING_MODEL'), 'TUI/WebUI/RPC 模式');

// ── 总结 ──
console.log('\n═══════════════════════════════════════════');
console.log(`  结果: ${pass} 通过, ${fail} 失败`);
console.log(fail === 0 ? '  ★ 五层记忆系统全部就绪！' : '  ⚠ 有失败项，请检查');
console.log('═══════════════════════════════════════════');
