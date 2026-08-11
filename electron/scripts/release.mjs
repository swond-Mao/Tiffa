/**
 * release.mjs — Tiffa 一键发布（超过 dim 的本地工程化：CI 做质量门禁，发布一键化）
 *
 * 流程：
 *   1. 检查 git 工作区干净
 *   2. 可选：跑本地全检（typecheck + 单测 + 构建；E2E 需模型 Key，单独跑）
 *   3. 打 tag v<electron/package.json version>
 *   4. 推 master + tag 到三远端（gitee / github / gitcode）
 *
 * 用法：
 *   node scripts/release.mjs              # 默认不自动跑全检（--check 开启）
 *   node scripts/release.mjs --check      # 全检通过后才发布
 *
 * 退出码：0 = 成功；1 = 任一环节失败（不继续）
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');
const REMOTES = ['origin', 'github', 'gitcode'];

// git 可执行文件：优先 PATH，回退常见安装路径
function resolveGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
    return 'git';
  } catch {
    const cands = [
      'C:\\Program Files\\Git\\bin\\git.exe',
      'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    ];
    for (const c of cands) {
      if (fs.existsSync(c)) return c;
    }
    throw new Error('未找到 git。请安装 Git 或把 git 加入 PATH。');
  }
}

const GIT = resolveGit();
const run = (args, opts = {}) =>
  execFileSync(GIT, args, { cwd: ROOT, stdio: opts.silent ? 'pipe' : 'inherit', windowsHide: true });

// ── 0) 版本与分支 ──
const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
console.log(`\n==> 发布 Tiffa v${version}（tag=${tag}）`);

// ── 1) 工作区检查 ──
const status = run(['status', '--porcelain'], { silent: true }).toString().trim();
if (status) {
  console.error('✗ 工作区有未提交改动，先提交再发布：\n' + status.split('\n').slice(0, 10).join('\n'));
  process.exit(1);
}
console.log('✓ 工作区干净');

// ── 2) 可选全检 ──
if (process.argv.includes('--check')) {
  console.log('\n==> 本地全检（typecheck + 单测 + 构建）...');
  const checkCmd = `cd /d "${ELECTRON_DIR}" && npm run typecheck && node main.test.js && npm run test:renderer && npm run build:renderer`;
  try {
    execFileSync('cmd', ['/c', checkCmd], { stdio: 'inherit', windowsHide: true });
    console.log('✓ 全检通过');
  } catch {
    console.error('✗ 全检失败，终止发布。');
    process.exit(1);
  }
  console.log('   提示：协议 E2E（npm run test:e2e）需要真实模型 Key，建议发布前手动跑一次。');
}

// ── 3) 打 tag ──
try {
  run(['tag', tag]);
  console.log(`✓ 已打 tag ${tag}`);
} catch {
  console.error(`✗ tag ${tag} 已存在（或打标失败）。如需重新发布请先删除：git tag -d ${tag}`);
  process.exit(1);
}

// ── 4) 推送三远端 ──
for (const remote of REMOTES) {
  try {
    run(['push', remote, 'master']);
    run(['push', remote, tag]);
    console.log(`✓ 已推送 ${remote}（master + ${tag}）`);
  } catch {
    console.error(`✗ 推送 ${remote} 失败，已停止。剩余远端未推。`);
    process.exit(1);
  }
}

console.log(`\n🎉 发布完成：v${version} 已推送到 gitee / github / gitcode（master + tag）。`);
