// @ts-nocheck — 本文件为 main.js 搬移的 IPC 路由代码，暂缓强类型化（渐进治理：
// 核心类/工具函数已在 modules/ 强类型，本入口后续逐步收紧）。
/**
 * Tiffa Desktop - Electron Main Process (TS)
 *
 * 模块化治理后入口：核心类/工具函数拆到 modules/，本文件保留
 * 配置、setupIpc（IPC 路由）、App Lifecycle。
 */
import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, globalShortcut, desktopCapturer } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, execSync as _execSync } from 'child_process';
import cp from 'child_process';
import yaml from 'js-yaml';
import { parseDocument, Document } from 'yaml';
import { StringDecoder } from 'string_decoder';
import { TiffaInstance } from './modules/tiffa-instance';
import { TiffaInstanceManager } from './modules/tiffa-manager';
import { setMainWindow } from './modules/tiffa-instance';
import { createWindow, syncCustomStartupImage } from './modules/window-setup';
import {
  PORTABLE_ROOT, BUN_EXE, TIFFA_CLI, EXTENSION_PATH, COMPUTER_USE_EXTENSION_PATH,
  DEFAULT_WORKSPACE_DIR, SESSIONS_DIR, ARCHIVE_DIR, PROJECTS_JSON, REMOVED_CWDS_FILE,
  COMPUTER_USE_ENABLED_FILE, COMPUTER_USE_MCP_JSON, AGENT_DIR, MAX_INSTANCES, LRU_KEEP_ALIVE_MS,
  currentWorkspaceDir, setCurrentWorkspaceDir,
} from './modules/constants';
import {
  extractSessionIdFromPath, _encodeSessionDirName, extractWorkspaceSuffix, stableSessionDirName,
  findSessionFile, mainLog, readTailLines, parseSessionLines, decodeSessionDirName,
  extractCwdFromSessionDir, isEmptySessionDir, cwdDisplayName, parseSessionHeader,
  parseMdField, encodeSessionDirName, rotateLogIfNeeded as _rotateLogIfNeeded,
} from './modules/session-utils';
import { killTree, utf8Env } from './modules/process-utils';
import { resolveDefaultModelFromConfig, findProviderConfig, callCompletion } from './modules/config-utils';
import { sanitizeModelsConfig, validateModelsConfig, extractUnsupportedApiProviders } from './modules/models-config';
import {
  readRemovedCwds, writeRemovedCwds, isRemovedCwd, unremoveCwd, rimraf, rimrafWithRetry,
  readProjectsJson, writeProjectsJson, ensureProjectInJson, cleanupProjectsJson,
  findProjectByDirName, sessionFileBelongsToCwd, deleteSessionFilesForCwd,
  moveSessionFilesForCwd, discoverWorkspaceProjects,
} from './modules/project-utils';
import { isComputerUseEnabled, syncComputerUseMcp } from './modules/computer-use-utils';
import { isPlaywrightEnabled, syncPlaywrightMcp } from './modules/playwright-utils';
import { PLAYWRIGHT_ENABLED_FILE } from './modules/constants';
import { tryGenerateSessionTitle } from './modules/session-utils';

/**
 * Tiffa Desktop - Electron Main Process
 *
 * Manages Tiffa rpc-ui subprocess, IPC communication, and window lifecycle.
 * Protocol: JSONL over stdin/stdout (one JSON object per line)
 */


// ── Configuration（常量从 constants 导入；仅设置 global.PORTABLE_ROOT 供旧代码兼容） ──
// PORTABLE_ROOT: 1) --portable-root CLI arg  2) PORTABLE_ROOT env  3) parent of __dirname
const argRootIdx = process.argv.indexOf('--portable-root');
if (argRootIdx >= 0 && process.argv[argRootIdx + 1]) {
  global.PORTABLE_ROOT = path.resolve(process.argv[argRootIdx + 1]);
} else if (process.env.PORTABLE_ROOT) {
  global.PORTABLE_ROOT = path.resolve(process.env.PORTABLE_ROOT);
} else {
  global.PORTABLE_ROOT = path.resolve(__dirname, '..');
}

// 自包含便携

// ── 自包含便携：把 Electron userData 锁到便携目录，localStorage/openTabs 等随 U 盘走 ──
// 必须在 app.ready 之前调用（此处模块顶层、BrowserWindow 创建前，时机正确）。
try {
  const portableUserData = path.join(PORTABLE_ROOT, 'data', 'electron-userdata');
  fs.mkdirSync(portableUserData, { recursive: true });
  app.setPath('userData', portableUserData);
  console.log('[portable] userData 锁定到:', portableUserData);
} catch (e) {
  console.warn('[portable] setPath(userData) 失败，回退系统默认:', e.message);
}
// ── 确保 config.yml 存在（git clone 后 config.yml 被 gitignore，需从 example 恢复） ──
try {
  const CONFIG_YML = path.join(PORTABLE_ROOT, 'data', 'agent', 'config.yml');
  const CONFIG_EXAMPLE = path.join(PORTABLE_ROOT, 'data', 'agent', 'config.yml.example');
  if (!fs.existsSync(CONFIG_YML) && fs.existsSync(CONFIG_EXAMPLE)) {
    fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_YML);
    console.log('[config] 已自动从 config.yml.example 恢复 config.yml');
  }
} catch (e) {
  console.warn('[config] 恢复 config.yml 失败:', e.message);
}
// ── 确保 mcp.json 存在（机器运行时状态不入库；syncComputerUseMcp 每次启动会把 {{PORTABLE_ROOT}} 写回为真实根目录，故仓库只保留 mcp.json.example 模板）──
try {
  const MCP_JSON = path.join(PORTABLE_ROOT, 'data', 'agent', 'mcp.json');
  const MCP_EXAMPLE = MCP_JSON + '.example';
  if (!fs.existsSync(MCP_JSON) && fs.existsSync(MCP_EXAMPLE)) {
    fs.copyFileSync(MCP_EXAMPLE, MCP_JSON);
    console.log('[config] 已自动从 mcp.json.example 恢复 mcp.json');
  }
} catch (e) {
  console.warn('[config] 恢复 mcp.json 失败:', e.message);
}
// ── mcp.json 盘符自愈：便携换盘符后，把残留的旧盘符 Tiffa 路径刷成当前根目录 ──
try {
  const MCP_JSON_HEAL = path.join(PORTABLE_ROOT, 'data', 'agent', 'mcp.json');
  if (fs.existsSync(MCP_JSON_HEAL)) {
    let rawHeal = fs.readFileSync(MCP_JSON_HEAL, 'utf8');
    const rootSlash = PORTABLE_ROOT.replace(/\\/g, '/');
    const fixed = rawHeal.replace(/[A-Za-z]:[\/\\]Tiffa[\/\\]/g, rootSlash + '/');
    if (fixed !== rawHeal) {
      fs.writeFileSync(MCP_JSON_HEAL, fixed, 'utf8');
      console.log('[config] mcp.json 盘符已自愈 ->', rootSlash);
    }
  }
} catch (e) {
  console.warn('[config] mcp.json 盘符自愈失败:', e.message);
}

// ── 确保 models.yml 存在（git clone 后同样被 gitignore，需从 example 恢复） ──
try {
  const MODELS_YML = path.join(PORTABLE_ROOT, 'data', 'agent', 'models.yml');
  const MODELS_EXAMPLE = path.join(PORTABLE_ROOT, 'data', 'agent', 'models.yml.example');
  if (!fs.existsSync(MODELS_YML) && fs.existsSync(MODELS_EXAMPLE)) {
    fs.copyFileSync(MODELS_EXAMPLE, MODELS_YML);
    console.log('[config] 已自动从 models.yml.example 恢复 models.yml');
  }
} catch (e) {
  console.warn('[config] 恢复 models.yml 失败:', e.message);
}

// ── 启动自愈：models.yml 历史脏数据清洗（复用 sanitizeModelsConfig，幂等）──
// 覆盖：缺 apiKey / 空 apiKey 补 "none"；contextWindow/maxTokens/cost.* 字符串数字转回数字；
// api 枚举不支持的 provider（旧版 UI 写出的 ollama-chat/openrouter）整体摘出隔离。
// 内核 schema 校验失败会禁用整个 providers → 无可用模型 → 内核启动即退（反复崩溃），此处兜底。
try {
  const MODELS_YML_HEAL = path.join(PORTABLE_ROOT, 'data', 'agent', 'models.yml');
  if (fs.existsSync(MODELS_YML_HEAL)) {
    const rawHeal = fs.readFileSync(MODELS_YML_HEAL, 'utf8');
    const healed = yaml.load(rawHeal);
    const { changed } = sanitizeModelsConfig(healed);
    // api 枚举不兼容的 provider：原样备份到 models.yml.quarantine.bak.yml 后从主文件摘除，
    // 避免一颗雷炸掉所有自定义供应商（内核 schema 任一错误即整体禁用）
    const { removed } = extractUnsupportedApiProviders(healed);
    if (changed || Object.keys(removed).length > 0) {
      fs.copyFileSync(MODELS_YML_HEAL, MODELS_YML_HEAL + '.bak-heal-apikey');
      if (Object.keys(removed).length > 0) {
        fs.writeFileSync(MODELS_YML_HEAL + '.quarantine.bak.yml', yaml.dump({ providers: removed }), 'utf8');
      }
      fs.writeFileSync(MODELS_YML_HEAL, yaml.dump(healed), 'utf8');
      console.log(`[config] models.yml 自愈完成（apiKey/数字修复: ${changed}；隔离不兼容 api 供应商: ${Object.keys(removed).join(',') || '无'}；原文件备份 .bak-heal-apikey）`);
    }
  }
} catch (e) {
  console.warn('[config] models.yml 凭据自愈失败:', e.message);
}
// ── 确保 grounding.json 存在（computer-use 视觉模型配置，含真实 API Key 不入库；缺失时从 example 恢复，绝不覆盖已有配置） ──
try {
  const GROUNDING_JSON = path.join(PORTABLE_ROOT, 'data', 'agent', 'managed-skills', 'computer-use', 'grounding.json');
  const GROUNDING_EXAMPLE = path.join(PORTABLE_ROOT, 'data', 'agent', 'managed-skills', 'computer-use', 'grounding.json.example');
  if (!fs.existsSync(GROUNDING_JSON) && fs.existsSync(GROUNDING_EXAMPLE)) {
    fs.copyFileSync(GROUNDING_EXAMPLE, GROUNDING_JSON);
    console.log('[config] 已自动从 grounding.json.example 恢复 grounding.json');
  }
} catch (e) {
  console.warn('[config] 恢复 grounding.json 失败:', e.message);
}
// ── 确保 AI.md 存在（运行时个人数据，gitignore 不入库；新机器 git clone/pull 后从 AI.md.template 模板恢复） ──
// 1) 文件缺失 → 整体拷贝模板；2) 旧 pull 遗留的无角色卡版本 → 从模板补齐角色卡（不覆盖已有名字/性别等字段）
try {
  const MEM_AI_MD = path.join(PORTABLE_ROOT, 'data', 'memory', 'AI.md');
  const MEM_AI_TEMPLATE = path.join(PORTABLE_ROOT, 'data', 'memory', 'AI.md.template');
  if (fs.existsSync(MEM_AI_TEMPLATE)) {
    const tpl = fs.readFileSync(MEM_AI_TEMPLATE, 'utf8');
    const tplCard = (tpl.match(/^##\s*角色卡\s*\n([\s\S]*)$/m) || [])[1];
    if (!fs.existsSync(MEM_AI_MD)) {
      fs.mkdirSync(path.dirname(MEM_AI_MD), { recursive: true });
      fs.copyFileSync(MEM_AI_TEMPLATE, MEM_AI_MD);
      console.log('[memory] AI.md 缺失，已自动从 AI.md.template 恢复');
    } else if (tplCard && !/^##\s*角色卡/m.test(fs.readFileSync(MEM_AI_MD, 'utf8'))) {
      const cur = fs.readFileSync(MEM_AI_MD, 'utf8').replace(/\s+$/, '');
      fs.writeFileSync(MEM_AI_MD, cur + '\n\n## 角色卡\n\n' + tplCard.trim() + '\n', 'utf8');
      console.log('[memory] AI.md 缺少角色卡，已从 AI.md.template 补齐');
    }
  }
} catch (e) {
  console.warn('[memory] 恢复 AI.md 失败:', e.message);
}

// ── Global State（模块化：实例管理器从 tiffa-manager 导入） ──
let mainWindow = null;
const tiffaManager = new TiffaInstanceManager();

// 删除/归档会话前关闭持有该会话文件的实例。
// 根因：实例内存持有 session 状态，只删 jsonl 不关实例时，内核后续任何写盘
// （agent_end flush / switch_session / 消息追加）都会把文件"复活"，历史面板残留记录；
// 且实例持有的文件句柄会导致 Windows unlink/rename EBUSY。
function _closeInstancesForSessionFile(sessionPath) {
  const resolved = path.resolve(sessionPath);
  const norm = resolved.toLowerCase();
  const targetSessionId = extractSessionIdFromPath(resolved);
  const keysToClose = [];
  for (const [key, inst] of tiffaManager.instances) {
    const sf = inst.sessionFilePath;
    const matchByPath = sf && path.resolve(sf).toLowerCase() === norm;
    const matchById = targetSessionId && inst.sessionId === targetSessionId;
    if (matchByPath || matchById) keysToClose.push(key);
  }
  for (const key of keysToClose) {
    const inst = tiffaManager.instances.get(key);
    console.log(`[sessions] 关闭会话实例: ${key}`);
    if (inst) inst.kill(true);
    tiffaManager.instances.delete(key);
    if (tiffaManager.activeKey === key) {
      tiffaManager.activeKey = null;
      tiffaManager.activeCwd = null;
    }
  }
}

// ── 全局异常捕获：防止主进程未捕获异常弹"JavaScript 报错"对话框/崩溃 ──
// 切换审批/会话重启等异步流程（exit handler、_cleanup、spawn、LRU）任何裸奔异常
// 都会走这里：只记日志、不弹窗、不退出，问题可通过 data/logs/main-ask.log 定位。
process.on('uncaughtException', (err) => {
  try {
    console.error('[main] uncaughtException:', err);
    mainLog(`[main] uncaughtException: ${(err && err.stack) || err}`);
  } catch {}
});
process.on('unhandledRejection', (reason) => {
  try {
    console.error('[main] unhandledRejection:', reason);
    mainLog(`[main] unhandledRejection: ${(reason && reason.stack) || reason}`);
  } catch {}
});


// ── 项目 cwd 校验：禁止把 Tiffa 基础目录当工作目录（防目录漂移污染 projects.json / 会话 cwd）──
// 基础目录 = PORTABLE_ROOT 内、workspace 外（data/、electron/、python/、plugins/、home/ 等）
// 用户项目应位于 workspace/ 下的子目录，或 PORTABLE_ROOT 之外的任意目录
function assertProjectCwd(cwd: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const normalized = path.resolve(cwd);
  const rootNorm = path.resolve(PORTABLE_ROOT).toLowerCase();
  const wsNorm = path.resolve(path.join(PORTABLE_ROOT, 'workspace')).toLowerCase();
  const cwdNorm = normalized.toLowerCase();
  if (cwdNorm.startsWith(rootNorm + path.sep) && !cwdNorm.startsWith(wsNorm + path.sep)) {
    return { ok: false, error: `不允许以 Tiffa 基础目录作为工作目录：${normalized}。请选择 workspace/ 下的项目目录或其他用户目录。` };
  }
  return { ok: true, normalized };
}

function setupIpc() {
  // ── 多实例感知的辅助函数 ──
  // 所有 Tiffa 命令都路由到当前活跃实例

  function _active() {
    const inst = tiffaManager.getActive();
    if (!inst) throw new Error('No active Tiffa instance');
    return inst;
  }

  // 按 sessionId 显式路由（吸收 dim 的"命令必须带 sessionPath"原则）：
  // getModels/getState/compact/command 这类"看似全局"的操作，若走 _active() 会
  // 误发到"最后被激活的对话进程"，导致压缩/状态查错会话。
  // 先全池按 sessionId 扫描（跨项目也命中），再精确 key，最后回退当前活跃实例。
  function _routeBySession(sessionId) {
    if (sessionId) {
      const inst = tiffaManager.getBySessionIdAnywhere(sessionId)
        || tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
      if (inst) return inst;
    }
    return tiffaManager.getActive();
  }

  // Tiffa commands
  ipcMain.handle('tiffa:send', async (event, message, images, sessionId) => {
    // /omfg（或 /吐槽）命令拦截：TTSR 规则生成/修复 prompt（OI3 标准格式）
    const omfgMatch = typeof message === 'string' && message.match(/^\/(?:omfg|吐槽)\s*(.+)/);
    if (omfgMatch) {
      const complaint = omfgMatch[1].trim();
      const ruleDir = path.join(PORTABLE_ROOT, 'data', 'agent', 'rules');
      try { if (!fs.existsSync(ruleDir)) fs.mkdirSync(ruleDir, { recursive: true }); } catch {}
      let existingRules = '(无)';
      let existingRuleDetails = '';
      try {
        const files = fs.readdirSync(ruleDir).filter(f => f.endsWith('.md'));
        if (files.length > 0) {
          existingRules = files.join(', ');
          // 读取每条规则的 frontmatter 摘要
          existingRuleDetails = files.map(f => {
            try {
              const content = fs.readFileSync(path.join(ruleDir, f), 'utf8');
              const descMatch = content.match(/^description:\s*"?(.+?)"?\s*$/m);
              const desc = descMatch ? descMatch[1] : '(无描述)';
              return `- ${f}: ${desc}`;
            } catch { return `- ${f}`; }
          }).join('\n');
        }
      } catch {}

      const omfgPrompt = [
        '<omfg>',
        'The user is frustrated about recurring agent behavior.',
        'Author ONE Time Traveling Stream Rule (TTSR) that would have caught the offending behavior earlier in this conversation.',
        '',
        'TTSR mechanics:',
        '- A rule is a markdown file with YAML frontmatter, stored in ' + ruleDir,
        '- `condition` is one or more JavaScript regex patterns tested against assistant streamed output.',
        '- `scope` is a comma-separated allowlist. If present, only listed streams are checked.',
        '- `text` = assistant prose only. `thinking` = hidden reasoning summaries. `tool` = every tool\'s arguments.',
        '- `tool:<name>(<glob>)` = one tool, only when path-like args match the glob.',
        '- SHOULD use file-specific tool scopes for code complaints.',
        '- Tool arguments may be serialized while streaming. Conditions for code containing quotes SHOULD tolerate JSON escaping.',
        '- When `condition` matches within `scope`, the stream is interrupted and the markdown body is injected as correction guidance.',
        '- `interruptMode`: `always` = immediately abort generation, `never` = inject warning without interrupting.',
        '- `repeatMode` (optional): `once` = fire once per session (default), `after-gap` = re-trigger after N messages.',
        '',
        'Action: Write the rule file directly using the write tool.',
        '',
        'File format (markdown with YAML frontmatter):',
        '```',
        '---',
        'description: "One-line summary of what the rule prevents"',
        'condition: "regex pattern or array of patterns"',
        'scope: "text" or "tool:write(*.ts)" or ["tool:edit(*.ts)", "tool:write(*.ts)"]',
        'interruptMode: "always" or "never"',
        '---',
        '',
        'Markdown body explaining the correct behavior.',
        '```',
        '',
        'Guidelines:',
        '- File name MUST be kebab-case with .md extension (e.g. no-hardcoded-secrets.md)',
        '- `condition` MUST match the specific offending output visible in this conversation. Keep it precise; NEVER use broad catch-alls.',
        '- Escape regex backslashes once in YAML: use `"\\beval\\s*\\("`, NOT `"\\\\beval\\\\s*\\\\("`.',
        '- Keep `scope` as narrow as the complaint allows. NEVER use `tool, text` unless the same bad behavior occurred in both.',
        '- If an existing rule has a bug (regex too narrow/broad, wrong scope), fix it directly by rewriting that file.',
        '',
        'Existing rules (avoid duplicates):',
        existingRuleDetails || '(none)',
        '',
        'Complaint:',
        complaint,
        '</omfg>',
      ].join('\n');

      message = omfgPrompt;
      console.log(`[/omfg|/吐槽] intercepted: complaint="${complaint}"`);
    }
    const frame = { type: 'prompt', message };
    if (images && images.length > 0) {
      // WebP → PNG：本地 llama.cpp 不解 webp，统一转 PNG 确保所有模型兼容
      const { nativeImage } = require('electron');
      frame.images = images.map(img => {
        if (img.mimeType === 'image/webp') {
          try {
            const ni = nativeImage.createFromBuffer(Buffer.from(img.data, 'base64'));
            if (!ni.isEmpty()) {
              const pngBuf = ni.toPNG();
              return { data: pngBuf.toString('base64'), mimeType: 'image/png' };
            }
          } catch (e) {
            console.warn('[主进程] webp→png 转换失败，保留原图:', e.message);
          }
        }
        return img;
      });
    }
    let inst = tiffaManager.getBySessionIdAnywhere(sessionId)
      || tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
    if (!inst && sessionId) {
      // 会话级实例不存在（启动恢复/竞态/非阻塞切换期间）→ 先激活再发送，不回退到项目级实例
      // （项目级实例 _sessionId=null 的事件会被渲染层严格路由过滤，导致无输出）
      await tiffaManager.activateSession(tiffaManager.activeCwd, sessionId);
      inst = tiffaManager.getBySessionIdAnywhere(sessionId)
        || tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
    }
    // 实例存在但尚未就绪（刚 spawn / 重启 / 后台激活中）→ 等就绪再发，
    // 避免 prompt 落入未就绪进程被吞（非阻塞切换后立刻发消息的兜底）。
    if (inst && !inst.ready && sessionId) {
      await new Promise((resolve) => {
        let checks = 0;
        const check = setInterval(() => {
          checks++;
          if (inst.ready || checks > 150) { clearInterval(check); resolve(); } // 最多 15s
        }, 100);
        if (inst.process) inst.process.once('exit', () => { clearInterval(check); resolve(); });
      });
    }
    if (!inst) inst = tiffaManager.getActive(); // 无 sessionId 时用项目级
    if (!inst) throw new Error('No active Tiffa instance');
    // 发送重试：进程可能在重启中（process=null 但 restartTimer 排队），等待一次再试
    try {
      return await inst.sendCommand(frame);
    } catch (err) {
      if (inst._restartTimer || (!inst.process && inst.crashCount < inst.maxCrashRestart)) {
        console.log(`[主进程] 发送失败，实例可能在重启中，等待 4 秒后重试…`);
        await new Promise(r => setTimeout(r, 4000));
        if (inst.ready && inst.process) {
          return inst.sendCommand(frame);
        }
      }
      throw err;
    }
  });

  // 激活对话级实例（每对话独立进程）——显式设置 activeKey
  ipcMain.handle('tiffa:activateSession', async (event, cwd, sessionId) => {
    try {
      const check = assertProjectCwd(cwd);
      if (!check.ok) return { error: check.error };
      const normalized = check.normalized;
      ensureProjectInJson(normalized);
      // 显式激活：设置 activeKey（用户主动切换对话时才调用）
      tiffaManager.activeKey = tiffaManager._key(normalized, sessionId);
      tiffaManager.activeCwd = normalized;
      setCurrentWorkspaceDir(normalized);
      const result = await tiffaManager.activateSession(normalized, sessionId);
      return { success: true, cwd: normalized, sessionId, ready: result.ready };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 关闭对话级实例（关闭标签时释放进程）
  ipcMain.handle('tiffa:closeSession', async (event, cwd, sessionId) => {
    try {
      const key = tiffaManager._key(cwd, sessionId);
      tiffaManager.closeByKey(key);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('tiffa:abort', async (event, sessionId) => {
    // 全池按 sessionId 找（跨项目也命中），避免 abort 到当前活跃实例
    const inst = sessionId
      ? (tiffaManager.getBySessionIdAnywhere(sessionId) || tiffaManager.resolve(tiffaManager.activeCwd, sessionId))
      : tiffaManager.getActive();
    if (inst) inst.sendRaw({ type: 'abort' });
  });

  ipcMain.handle('tiffa:setModel', async (event, provider, modelId, sessionId) => {
    // 指定 sessionId 时精确匹配对话实例，不回退到项目级（避免模型设到错误实例）。
    // 全池扫描优先（跨项目也命中），再精确 key。
    let inst;
    if (sessionId) {
      inst = tiffaManager.getBySessionIdAnywhere(sessionId)
        || tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
      if (!inst) {
        // 实例不存在 -> 先激活再设置（与 send 路径一致）
        await tiffaManager.activateSession(tiffaManager.activeCwd, sessionId);
        inst = tiffaManager.getBySessionIdAnywhere(sessionId)
          || tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId);
      }
    } else {
      inst = tiffaManager.getActive();
    }
    if (!inst) throw new Error('No active Tiffa instance');
    try {
      const modelPath = path.join(PORTABLE_ROOT, 'data', 'agent', 'current-model.json');
      fs.writeFileSync(modelPath, JSON.stringify({ provider, modelId, sessionId: sessionId || null, ts: Date.now() }, null, 2));
    } catch {}
    return inst.sendCommand({ type: 'set_model', provider, modelId });
  });

  ipcMain.handle('tiffa:getModels', async (event, sessionId) => {
    const inst = _routeBySession(sessionId);
    if (!inst) throw new Error('No active Tiffa instance');
    return inst.sendCommand({ type: 'get_available_models' });
  });

  ipcMain.handle('tiffa:isReady', async (event, sessionId) => {
    const inst = _routeBySession(sessionId);
    return inst ? inst.ready : false;
  });

  // 诊断：上报全部实例状态（吸收 dim 的 per-session 可观测性），
  // 解决"多个对话并行时无法判断某个后台内核是否还在跑"的问题。
  ipcMain.handle('tiffa:diagnostics', async () => {
    const instances = [];
    for (const [key, inst] of tiffaManager.instances) {
      instances.push({
        key,
        cwd: inst.cwd,
        sessionId: inst.sessionId,
        sessionFilePath: inst.sessionFilePath,
        active: key === tiffaManager.activeKey,
        ready: inst.ready,
        agentRunning: inst.agentRunning,
        lastActiveTime: inst.lastActiveTime,
        pid: inst.process?.pid || null,
        stdinWritable: inst.process?.stdin?.writable || false,
        pendingCommands: inst.pendingCommands.size,
        pendingAskIds: inst._pendingAskIds.size,
      });
    }
    return { instances, activeKey: tiffaManager.activeKey };
  });

  ipcMain.handle('tiffa:getState', async (event, sessionId) => {
    const inst = _routeBySession(sessionId);
    if (!inst) throw new Error('No active Tiffa instance');
    return inst.sendCommand({ type: 'get_state' });
  });

  ipcMain.handle('tiffa:steer', async (event, message, sessionId) => {
    const inst = tiffaManager.resolve(tiffaManager.activeCwd, sessionId);
    if (!inst) throw new Error('no active process');
    inst.sendRaw({ type: 'steer', message });
  });

  ipcMain.handle('tiffa:followUp', async (event, message, sessionId) => {
    const inst = tiffaManager.resolve(tiffaManager.activeCwd, sessionId);
    if (!inst) throw new Error('no active process');
    inst.sendRaw({ type: 'follow_up', message });
  });

  ipcMain.handle('tiffa:extensionResponse', async (event, id, value, sessionId) => {
    const frame = { type: 'extension_ui_response', id };
    if (value && typeof value === 'object') {
      if ('cancelled' in value) frame.cancelled = true;
      else if ('value' in value) frame.value = value.value;
      else if ('confirmed' in value) frame.value = true;
      else frame.value = value;
    } else {
      frame.value = value;
    }
    // 按 sessionId 路由到发请求的实例，而非 _active()（当前活跃实例可能已切换）。
    // 先全池按 sessionId 扫描（跨项目也命中），再精确 key，最后才回退当前活跃。
    const inst = sessionId
      ? (tiffaManager.getBySessionIdAnywhere(sessionId)
          || tiffaManager.getBySessionId(tiffaManager.activeCwd, sessionId)
          || tiffaManager.getActive())
      : tiffaManager.getActive();
    if (inst) {
      // 用户应答 → 移除待应答记账（非交互型确认无对应 id，delete 为 no-op，不会误减）
      inst._pendingAskIds.delete(id);
      mainLog(`[${inst._shortCwd()}#${inst.sessionId}] ui-resp id=${id} activeKey=${tiffaManager.activeKey}`);
      inst.sendRaw(frame);
    } else {
      mainLog(`[ui-resp] id=${id} sessionId=${sessionId} INST NOT FOUND (routed to getActive)`);
    }
  });

  // 渲染层诊断日志（ask 抽屉等疑难问题排查）——落 data/logs/renderer.log，不影响 UI
  ipcMain.on('renderer:log', (event, tag, msg) => {
    try {
      const filePath = path.join(global.PORTABLE_ROOT, 'data', 'logs', 'renderer.log');
      _rotateLogIfNeeded(filePath);
      const line = `[${new Date().toISOString()}] [${tag}] ${msg}\n`;
      fs.appendFileSync(filePath, line);
    } catch {}
  });

  ipcMain.handle('tiffa:compact', async (event, sessionId) => {
    const inst = _routeBySession(sessionId);
    if (!inst) throw new Error('No active Tiffa instance');
    try {
      return await inst.sendCommand({ type: 'compact' });
    } catch (err) {
      // ── 运行时兜底（2+3 修复 #3）：内核 snapcompact 爆帧预算（扩展字节预判漏判）──
      // 五级链是前置钩子决策，② 放行后无钩子能接住内核预算错误；此处应用层兜底：
      // 仅对该精确错误写 force 标记（扩展消费后本次强制 ③ 旁路结构化总结）并自动重试一次。
      // 严格限次：只认此错误、只重试一次，防死循环；其他错误（Compaction already in progress /
      // 内容过短 / 超时等）原样透传。标记由扩展消费 + TTL(120s) 双保险，重试结束（无论成败）删除。
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('standing image payload exceeds the per-request budget')) {
        const flagPath = path.join(global.PORTABLE_ROOT, 'data', 'agent', 'compact-force-next.json');
        try {
          fs.mkdirSync(path.dirname(flagPath), { recursive: true });
          fs.writeFileSync(flagPath, JSON.stringify({ ts: Date.now(), sessionId: inst.sessionId ?? sessionId }), 'utf8');
        } catch { /* 标记写失败则重试仍会走扩展预判（可能再降 ③），值得再试 */ }
        mainLog(`[compact-retry] ${inst._shortCwd()}#${inst.sessionId} snapcompact 帧预算超限 -> 写 force 标记自动重试（③ 旁路结构化摘要）`);
        try {
          const retried = await inst.sendCommand({ type: 'compact' });
          try { fs.unlinkSync(flagPath); } catch { /* 已被删除，no-op */ }
          mainLog(`[compact-retry] 重试成功，压缩以 ③ 完成`);
          return retried;
        } catch (retryErr) {
          try { fs.unlinkSync(flagPath); } catch { /* 同上 */ }
          mainLog(`[compact-retry] 重试失败：${retryErr instanceof Error ? retryErr.message : String(retryErr)}（返回原始首跳错误）`);
          throw err;
        }
      }
      throw err;
    }
  });

  ipcMain.handle('tiffa:command', async (event, type, payload, sessionId) => {
    const frame = { type, ...payload };
    const inst = _routeBySession(sessionId);
    if (!inst) throw new Error('No active Tiffa instance');
    return inst.sendCommand(frame);
  });

  // ── 多实例管理 IPC ──
  ipcMain.handle('tiffa:activate', async (event, cwd) => {
    try {
      const check = assertProjectCwd(cwd);
      if (!check.ok) return { error: check.error };
      const normalized = check.normalized;
      // 显式用户操作：如果路径曾被删除，从黑名单移除（允许重新添加）
      unremoveCwd(normalized);
      // 确保项目注册到 projects.json
      ensureProjectInJson(normalized);
      const result = await tiffaManager.activate(normalized);
      return { success: true, cwd: tiffaManager.activeCwd, ready: result.ready };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('tiffa:instances', async () => {
    return tiffaManager.getStatus();
  });

  // File system operations (for sidebar)
  ipcMain.handle('fs:listDir', async (event, dirPath) => {
    try {
      const resolvedPath = path.resolve(dirPath || currentWorkspaceDir);
      // Security: only allow within portable root or workspace
      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        path: path.join(resolvedPath, e.name),
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        size: e.isFile() ? fs.statSync(path.join(resolvedPath, e.name)).size : 0,
        ext: e.isFile() ? path.extname(e.name).toLowerCase() : '',
      })).sort((a, b) => {
        // Directories first, then files, alphabetical
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:readFile', async (event, filePath) => {
    try {
      const resolvedPath = path.resolve(filePath);
      const maxSize = 5 * 1024 * 1024; // 5MB limit
      const stat = fs.statSync(resolvedPath);
      if (stat.size > maxSize) {
        return { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, limit 5MB)` };
      }
      const content = fs.readFileSync(resolvedPath, 'utf8');
      const ext = path.extname(resolvedPath).toLowerCase();
      return { content, ext, path: resolvedPath, size: stat.size };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
    try {
      const resolvedPath = path.resolve(filePath);
      // 安全：只允许写入 PORTABLE_ROOT 内
      if (!resolvedPath.startsWith(PORTABLE_ROOT)) {
        return { error: 'Path outside portable root' };
      }
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, content, 'utf8');
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fetch:providerModels', async (event, baseUrl, apiKey) => {
    try {
      const url = baseUrl.replace(/\/+$/, '') + '/models';
      const headers = { 'Accept': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      const data = await resp.json();
      const models = (data.data || []).map(m => ({ id: m.id, name: m.id }));
      return { models };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fs:readImage', async (event, filePath) => {
    try {
      const resolvedPath = path.resolve(filePath);
      const content = fs.readFileSync(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      };
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      const base64 = content.toString('base64');
      return { base64, mimeType, path: resolvedPath, size: content.length };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 自定义启动页图片 ──────────────────────────────────────────
  // 用户把图片命名为 startup-image.png/.jpg/.jpeg/.webp/.gif 放入 <PORTABLE_ROOT>/data/。
  // 实现：启动时同步复制到 dist/assets/startup-custom.<ext>，渲染层用相对路径引用。
  // 为什么不 base64：13MB+ 动图转 data URL 后约 17MB，塞进 CSS 变量易被 Chromium
  // 静默丢弃；静态文件由 Chromium 原生解码，GIF/WebP 动画照常播放且无大小瓶颈。
  ipcMain.handle('custom:getStartupImage', () => syncCustomStartupImage());

  // Shell operations
  ipcMain.handle('shell:openExternal', async (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('shell:openPath', async (event, filePath) => {
    shell.openPath(filePath);
  });

  ipcMain.handle('shell:showItemInFolder', async (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // Path helpers
  ipcMain.handle('path:workspace', async () => currentWorkspaceDir);
  ipcMain.handle('path:root', async () => PORTABLE_ROOT);

  // ── XML Translation Toggle ──
  const XML_TRANSLATION_ENABLED_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'xml-translation-enabled');

  ipcMain.handle('xml-translation:status', async () => {
    try {
      if (!fs.existsSync(XML_TRANSLATION_ENABLED_FILE)) return { enabled: false };
      const content = fs.readFileSync(XML_TRANSLATION_ENABLED_FILE, 'utf8').trim();
      return { enabled: content === 'true' };
    } catch (err) {
      return { enabled: false };
    }
  });

  ipcMain.handle('xml-translation:toggle', async (event, enabled) => {
    try {
      const dir = path.dirname(XML_TRANSLATION_ENABLED_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(XML_TRANSLATION_ENABLED_FILE, enabled ? 'true' : 'false', 'utf8');
      console.log(`[主进程] XML 翻译开关: ${enabled ? 'ON' : 'OFF'}`);
      return { enabled };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Computer Use Toggle（后台开关：默认关，启动不拉起 MCP，开机更快）──
  const COMPUTER_USE_ENABLED_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'computer-use-enabled');
  const COMPUTER_USE_MCP_JSON = path.join(PORTABLE_ROOT, 'data', 'agent', 'mcp.json');
  
  // ── Computer Use v4：每应用执行策略（data/agent/computer-use-policies.json）──
  const COMPUTER_USE_POLICIES_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'computer-use-policies.json');

  function defaultPolicies() {
    return { default: 'ask', apps: {}, popup_ignore: ['Tiffa'] };
  }

  function readPolicies() {
    try {
      if (!fs.existsSync(COMPUTER_USE_POLICIES_FILE)) return defaultPolicies();
      const cfg = JSON.parse(fs.readFileSync(COMPUTER_USE_POLICIES_FILE, 'utf8'));
      if (!cfg || typeof cfg !== 'object') return defaultPolicies();
      return {
        default: ['ask', 'auto-run', 'disabled'].includes(cfg.default) ? cfg.default : 'ask',
        apps: cfg.apps && typeof cfg.apps === 'object' ? cfg.apps : {},
        popup_ignore: Array.isArray(cfg.popup_ignore) ? cfg.popup_ignore : ['Tiffa'],
      };
    } catch {
      return defaultPolicies();
    }
  }

  ipcMain.handle('computer-use:policies:get', async () => readPolicies());
  ipcMain.handle('computer-use:policies:set', async (event, cfg) => {
    try {
      const clean = {
        default: ['ask', 'auto-run', 'disabled'].includes(cfg && cfg.default) ? cfg.default : 'ask',
        apps: cfg && cfg.apps && typeof cfg.apps === 'object' ? cfg.apps : {},
        popup_ignore: Array.isArray(cfg && cfg.popup_ignore) ? cfg.popup_ignore : ['Tiffa'],
      };
      const dir = path.dirname(COMPUTER_USE_POLICIES_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(COMPUTER_USE_POLICIES_FILE, JSON.stringify(clean, null, 2) + '\n', 'utf8');
      console.log('[主进程] computer-use policies 已保存:', JSON.stringify(clean));
      return { ok: true, policies: clean };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Computer Use v4：全局窗口快照热键（默认 Ctrl+Alt+K）──
  const WINDOW_SNAPSHOT_CFG_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'window-snapshot.json');
  const DEFAULT_SNAPSHOT_HOTKEY = 'CommandOrControl+Alt+K';

  function readSnapshotCfg() {
    try {
      if (!fs.existsSync(WINDOW_SNAPSHOT_CFG_FILE)) return { enabled: true, hotkey: DEFAULT_SNAPSHOT_HOTKEY };
      const cfg = JSON.parse(fs.readFileSync(WINDOW_SNAPSHOT_CFG_FILE, 'utf8'));
      return {
        enabled: cfg.enabled !== false,
        hotkey: typeof cfg.hotkey === 'string' && cfg.hotkey ? cfg.hotkey : DEFAULT_SNAPSHOT_HOTKEY,
      };
    } catch {
      return { enabled: true, hotkey: DEFAULT_SNAPSHOT_HOTKEY };
    }
  }

  ipcMain.handle('window-snapshot:getHotkey', async () => readSnapshotCfg());
  ipcMain.handle('window-snapshot:setHotkey', async (event, cfg) => {
    try {
      const clean = {
        enabled: cfg && cfg.enabled !== false,
        hotkey: cfg && typeof cfg.hotkey === 'string' && cfg.hotkey ? cfg.hotkey : DEFAULT_SNAPSHOT_HOTKEY,
      };
      const dir = path.dirname(WINDOW_SNAPSHOT_CFG_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(WINDOW_SNAPSHOT_CFG_FILE, JSON.stringify(clean, null, 2) + '\n', 'utf8');
      console.log('[主进程] window-snapshot 配置已保存:', JSON.stringify(clean));
      return { ok: true, cfg: clean };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 快照动作：取 z-order 顶部窗口（当前活动窗口）→ 推给渲染层
  async function captureWindowSnapshot() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1600, height: 1600 },
      });
      if (!sources || sources.length === 0) {
        mainLog('[主进程] captureWindowSnapshot: 无可用窗口源');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('window-snapshot:error', { error: '无可用窗口源' });
        }
        return;
      }
      const src = sources[0]; // z-order 顶部 = 当前活动窗口
      const img = src.thumbnail;
      if (!img || img.isEmpty()) {
        mainLog('[主进程] captureWindowSnapshot: 快照为空');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('window-snapshot:error', { error: '快照为空（窗口可能最小化）' });
        }
        return;
      }
      const b64 = img.toPNG().toString('base64');
      mainLog(`[主进程] captureWindowSnapshot: 已捕获 ${src.name} (${(b64.length * 0.75 / 1024).toFixed(0)}KB)`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window-snapshot:captured', {
          data: b64,
          mimeType: 'image/png',
          title: src.name || '窗口快照',
        });
      }
    } catch (err) {
      mainLog(`[主进程] captureWindowSnapshot 失败: ${String((err && err.message) || err)}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window-snapshot:error', { error: String((err && err.message) || err) });
      }
    }
  }

  // 注册/注销全局热键（跟随配置）
  function registerSnapshotHotkey() {
    try {
      globalShortcut.unregisterAll();
      const cfg = readSnapshotCfg();
      if (!cfg.enabled) {
        mainLog('[主进程] 窗口快照热键: 已禁用，不注册');
        return;
      }
      const ok = globalShortcut.register(cfg.hotkey, () => {
        void captureWindowSnapshot();
      });
      mainLog(`[主进程] 窗口快照热键 ${cfg.hotkey}: ${ok ? 'OK' : '注册失败（可能被占用）'}`);
      console.log(`[主进程] 窗口快照热键 ${cfg.hotkey}: ${ok ? 'OK' : '注册失败（可能被占用）'}`);
    } catch (err) {
      mainLog(`[主进程] registerSnapshotHotkey 失败: ${err.message}`);
      console.error('[主进程] registerSnapshotHotkey 失败:', err.message);
    }
  }

  registerSnapshotHotkey();
  ipcMain.handle('window-snapshot:reload', async () => {
    registerSnapshotHotkey();
    return { ok: true };
  });

  function isComputerUseEnabled() {
    try {
      if (!fs.existsSync(COMPUTER_USE_ENABLED_FILE)) return false; // 默认关，启动快
      return fs.readFileSync(COMPUTER_USE_ENABLED_FILE, 'utf8').trim() === 'true';
    } catch { return false; }
  }

  function syncComputerUseMcp(enabled) {
    try {
      const p = COMPUTER_USE_MCP_JSON;
      if (!fs.existsSync(p)) return;
      let raw = fs.readFileSync(p, 'utf8');
      // 仓库里用 {{PORTABLE_ROOT}} 占位符（避免硬编码盘符泄露），运行时替换为真实便携根目录
      const rootSlash = PORTABLE_ROOT.replace(/\\/g, '/');
      raw = raw.split('{{PORTABLE_ROOT}}').join(rootSlash);
      const cfg = JSON.parse(raw);
      if (cfg.mcpServers && cfg.mcpServers['computer-use']) {
        cfg.mcpServers['computer-use'].enabled = enabled;
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
      }
    } catch (err) {
      console.error('[主进程] syncComputerUseMcp 失败:', err.message);
    }
  }

  // 启动时把 mcp.json 同步到开关状态（默认关 -> 不拉起 Computer Use，开机快）
  syncComputerUseMcp(isComputerUseEnabled());

  ipcMain.handle('computer-use:status', async () => ({ enabled: isComputerUseEnabled() }));
  ipcMain.handle('computer-use:toggle', async (event, enabled) => {
    try {
      const dir = path.dirname(COMPUTER_USE_ENABLED_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(COMPUTER_USE_ENABLED_FILE, enabled ? 'true' : 'false', 'utf8');
      syncComputerUseMcp(enabled);
      console.log(`[主进程] Computer Use 开关: ${enabled ? 'ON' : 'OFF'}`);
      return { enabled };
    } catch (err) {
      return { error: err.message };
    }
  });
  // ── Playwright MCP 开关（默认关 -> 不拉起 playwright 进程，新对话启动更快）──
  syncPlaywrightMcp(isPlaywrightEnabled());

  ipcMain.handle('playwright:status', async () => ({ enabled: isPlaywrightEnabled() }));
  ipcMain.handle('playwright:toggle', async (event, enabled) => {
    try {
      const dir = path.dirname(PLAYWRIGHT_ENABLED_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PLAYWRIGHT_ENABLED_FILE, enabled ? 'true' : 'false', 'utf8');
      syncPlaywrightMcp(!!enabled);
      console.log(`[主进程] Playwright 开关: ${enabled ? 'ON' : 'OFF'}`);
      return { enabled: !!enabled };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Models.yml config ──
  const MODELS_YML = path.join(PORTABLE_ROOT, 'data', 'agent', 'models.yml');
  const MODELS_YML_BACKUP = MODELS_YML + '.bak';

  ipcMain.handle('models:read', async () => {
    try {
      if (!fs.existsSync(MODELS_YML)) {
        return { error: 'models.yml not found' };
      }
      const raw = fs.readFileSync(MODELS_YML, 'utf8');
      const data = yaml.load(raw);
      return { data, raw };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('models:write', async (event, yamlContent) => {
    try {
      // 1) 语法校验
      const data = yaml.load(yamlContent);
      let out = yamlContent;
      if (data && typeof data === 'object') {
        // 2) 幂等清洗（补 apiKey "none"、数字字符串转数字），有改动则以清洗后内容落盘
        const { changed } = sanitizeModelsConfig(data);
        // 3) schema 校验：不过 → 明确报错，拒绝写入（否则内核禁用整个 providers，启动即崩）
        const errs = validateModelsConfig(data);
        if (errs.length > 0) {
          return { error: '模型配置存在问题，未保存：\n' + errs.join('\n') };
        }
        if (changed) out = yaml.dump(data);
      }

      // Backup current file
      if (fs.existsSync(MODELS_YML)) {
        fs.copyFileSync(MODELS_YML, MODELS_YML_BACKUP);
      }

      fs.writeFileSync(MODELS_YML, out, 'utf8');
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('models:restart', async () => {
    try {
      // 重启所有实例（模型配置变更后）
      // 取纯 cwd（去重，keys() 含 #sessionId 后缀不能直接用于 activate）
      const cwds = [...new Set([...tiffaManager.instances.values()].map(i => i.cwd))];
      tiffaManager.closeAll();
      await new Promise(resolve => setTimeout(resolve, 500));
      for (const cwd of cwds) {
        await tiffaManager.activate(cwd);
      }
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── YAML 注释保留式写入/删除 provider ──
  // 用 yaml 包的 parseDocument + setIn/deleteIn，只改 providers.<id> 子树
  // 保留用户手写的注释、其他 provider、顶层字段
  ipcMain.handle('models:writeProvider', async (event, providerId, cfg) => {
    try {
      if (!providerId || !/^[a-zA-Z0-9_-]+$/.test(providerId)) {
        return { error: `provider id 不合法（只允许字母/数字/-/_）: ${providerId}` };
      }
      // 清理 undefined/null/空值
      const clean = {};
      for (const [k, v] of Object.entries(cfg)) {
        if (v !== undefined && v !== null && v !== '') clean[k] = v;
      }
      // 加载 YAML Document（保注释）
      let doc;
      if (fs.existsSync(MODELS_YML)) {
        const raw = fs.readFileSync(MODELS_YML, 'utf8');
        doc = parseDocument(raw);
        if (doc.errors.length > 0) {
          return { error: `models.yml 解析失败（${doc.errors[0].message}），为避免破坏原文件已中止写入` };
        }
      } else {
        doc = new Document({});
      }
      doc.setIn(['providers', providerId], doc.createNode(clean));
      fs.mkdirSync(path.dirname(MODELS_YML), { recursive: true });
      fs.writeFileSync(MODELS_YML, doc.toString(), 'utf8');
      console.log(`[主进程] 已写入 provider: ${providerId}`);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('models:deleteProvider', async (event, providerId) => {
    try {
      if (!fs.existsSync(MODELS_YML)) return { success: true };
      const raw = fs.readFileSync(MODELS_YML, 'utf8');
      const doc = parseDocument(raw);
      if (doc.errors.length > 0) {
        return { error: `models.yml 解析失败，已中止` };
      }
      doc.deleteIn(['providers', providerId]);
      fs.writeFileSync(MODELS_YML, doc.toString(), 'utf8');
      console.log(`[主进程] 已删除 provider: ${providerId}`);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Config.yml approval mode ──
  const CONFIG_YML = path.join(PORTABLE_ROOT, 'data', 'agent', 'config.yml');
  // 前端模式名 → 内核配置值
  const TIFFA_APPROVAL_MODE_MAP = { normal: 'always-ask', auto: 'write', yolo: 'yolo' };

  ipcMain.handle('config:writeApprovalMode', async (event, tiffaMode) => {
    try {
      const agentMode = TIFFA_APPROVAL_MODE_MAP[tiffaMode] || 'yolo';
      let doc;
      if (fs.existsSync(CONFIG_YML)) {
        const raw = fs.readFileSync(CONFIG_YML, 'utf8');
        doc = parseDocument(raw);
      } else {
        doc = new Document();
      }
      doc.set('tools', doc.get('tools') || doc.createNode({}));
      doc.get('tools').set('approvalMode', agentMode);
      fs.writeFileSync(CONFIG_YML, doc.toString(), 'utf8');
      return { success: true, agentMode };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Workspace / Project management ──

  // 打开文件夹选择器
  ipcMain.handle('workspace:openFolderDialog', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择项目文件夹',
        defaultPath: currentWorkspaceDir,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const selected = result.filePaths[0];
      // 不允许选择 workspace 根目录本身
      if (path.resolve(selected) === DEFAULT_WORKSPACE_DIR) {
        return { error: '不能选择工作区根目录作为项目，请选择其子文件夹' };
      }
      return { canceled: false, path: selected };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 切换工作区（懒启动新实例或复用已有实例）
  ipcMain.handle('workspace:change', async (event, newCwd) => {
    try {
      if (!newCwd) {
        return { error: '路径为空' };
      }
      let resolved = path.resolve(newCwd);
      // 显式用户操作：如果路径曾被删除，从黑名单移除（允许重新添加）
      unremoveCwd(resolved);
      // workspace 下的项目如果目录不存在，自动创建
      if (!fs.existsSync(resolved)) {
        const wsSuffix = extractWorkspaceSuffix(resolved);
        if (wsSuffix) {
          fs.mkdirSync(resolved, { recursive: true });
          console.log(`[workspace] 自动创建项目目录: ${resolved}`);
        } else {
          return { error: '路径不存在' };
        }
      }
      // 注册到 projects.json
      ensureProjectInJson(resolved);
      // 激活（懒启动或复用）
      await tiffaManager.activate(resolved);
      return { success: true, cwd: tiffaManager.activeCwd };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Session / Project management ──
  const SESSIONS_DIR = path.join(PORTABLE_ROOT, 'data', 'agent', 'sessions');
  const ARCHIVE_DIR = path.join(PORTABLE_ROOT, 'data', 'agent', 'sessions-archive');
  const PROJECTS_JSON = path.join(PORTABLE_ROOT, 'data', 'agent', 'projects.json');
  const REMOVED_CWDS_FILE = path.join(PORTABLE_ROOT, 'data', 'agent', 'removed-cwds.json');

  function readRemovedCwds() {
    try {
      if (fs.existsSync(REMOVED_CWDS_FILE)) return JSON.parse(fs.readFileSync(REMOVED_CWDS_FILE, 'utf8'));
    } catch {}
    return [];
  }
  function writeRemovedCwds(list) {
    fs.writeFileSync(REMOVED_CWDS_FILE, JSON.stringify(list), 'utf8');
  }

  // 判断路径是否被用户明确删除过（支持 workspace 后缀匹配：
  // 便携包从 E:\Tiffa 迁到 G:\Tiffa 后，旧路径的删除记录仍然生效）
  function isRemovedCwd(absPath) {
    const removedList = readRemovedCwds();
    const lower = absPath.toLowerCase();
    if (removedList.some(c => c.toLowerCase() === lower)) return true;
    const mySuffix = extractWorkspaceSuffix(absPath);
    if (mySuffix) {
      return removedList.some(c => {
        const theirSuffix = extractWorkspaceSuffix(c);
        return theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase();
      });
    }
    return false;
  }

  // 从删除黑名单中移除匹配条目（用户显式重新选择时调用，含同后缀条目）
  function unremoveCwd(absPath) {
    const removedList = readRemovedCwds();
    const lower = absPath.toLowerCase();
    const mySuffix = extractWorkspaceSuffix(absPath);
    const filtered = removedList.filter(c => {
      if (c.toLowerCase() === lower) return false;
      if (mySuffix) {
        const theirSuffix = extractWorkspaceSuffix(c);
        if (theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase()) return false;
      }
      return true;
    });
    if (filtered.length !== removedList.length) writeRemovedCwds(filtered);
  }

  // 递归删除目录
  function rimraf(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) rimraf(full);
      else fs.unlinkSync(full);
    }
    fs.rmdirSync(dirPath);
  }

  // 带重试的递归删除：Windows 上进程刚被杀死时文件句柄可能尚未释放（EBUSY/EPERM）
  async function rimrafWithRetry(dirPath, maxRetries = 3) {
    for (let attempt = 0; ; attempt++) {
      try {
        rimraf(dirPath);
        return;
      } catch (err) {
        if (attempt < maxRetries && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
          console.log(`[rimraf] 文件锁未释放，${400 * (attempt + 1)}ms 后重试 (${attempt + 1}/${maxRetries}): ${dirPath}`);
          await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }
  }

  // ── projects.json 读写 ──
  // 格式: { projects: [ { cwd, displayName, addedAt, lastOpenedAt, archived }, ... ] }
  function readProjectsJson() {
    try {
      if (fs.existsSync(PROJECTS_JSON)) {
        const raw = fs.readFileSync(PROJECTS_JSON, 'utf8');
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.projects)) return data.projects;
      }
    } catch {}
    return [];
  }

  function writeProjectsJson(projects) {
    try {
      fs.writeFileSync(PROJECTS_JSON, JSON.stringify({ projects }, null, 2), 'utf8');
    } catch {}
  }

  // 确保项目在 projects.json 中（不存在则添加，已存在则更新 lastOpenedAt）
  // 用 workspace 后缀匹配，解决移动硬盘换盘符导致的重复问题
  // 写入前去重：防止任何来源的重复（IPC 并发、启动迁移等）
  function ensureProjectInJson(cwd) {
    const normalized = path.resolve(cwd);
    // workspace 根目录不作为项目
    if (normalized === DEFAULT_WORKSPACE_DIR) return normalized;
    // 用户明确删除过的项目：永不注册、永不重建目录（防止「删了又复活」）
    if (isRemovedCwd(normalized)) {
      return normalized;
    }
    // 防御：路径在磁盘上不存在则不注册（避免幽灵项目）
    // workspace 下的项目：仅当有会话记录时才自动重建目录（换盘符场景）
    if (!fs.existsSync(normalized)) {
      if (extractWorkspaceSuffix(normalized)) {
        const sessionDirName = encodeSessionDirName(normalized);
        const sessionDir = path.join(SESSIONS_DIR, sessionDirName);
        if (fs.existsSync(sessionDir)) {
          // 有会话记录，自动创建 workspace 子目录（换电脑/换盘符场景）
          fs.mkdirSync(normalized, { recursive: true });
          console.log(`[projects] 自动创建项目目录(有会话): ${normalized}`);
        } else {
          // 无会话记录，不重建（避免已删除项目复活）
          console.warn('[projects] 路径不存在且无会话，跳过注册:', normalized);
          return normalized;
        }
      } else {
        console.warn('[projects] 路径不存在，跳过注册:', normalized);
        return normalized;
      }
    }
    const projects = readProjectsJson();

    // ── 写前去重：清理可能存在的重复条目 ──
    const deduped = [];
    const seenCwds = new Set();
    for (const p of projects) {
      const key = path.resolve(p.cwd).toLowerCase();
      if (!seenCwds.has(key)) {
        seenCwds.add(key);
        deduped.push(p);
      } else {
        console.log(`[projects] 去重: 跳过重复 ${p.cwd}`);
      }
    }
    const hasDupes = deduped.length < projects.length;

    // 匹配策略：先精确匹配，再用 workspace 后缀匹配（处理盘符变化）
    let existing = deduped.find(p => path.resolve(p.cwd) === normalized);
    if (!existing) {
      const mySuffix = extractWorkspaceSuffix(normalized);
      if (mySuffix) {
        existing = deduped.find(p => {
          const theirSuffix = extractWorkspaceSuffix(path.resolve(p.cwd));
          return theirSuffix && theirSuffix.toLowerCase() === mySuffix.toLowerCase();
        });
      }
    }
    if (!existing) {
      // 检查 removedCwds：如果用户已删除此项目，不再自动注册
      const removedList = readRemovedCwds();
      const normalizedLower = normalized.toLowerCase();
      if (removedList.some(c => c.toLowerCase() === normalizedLower)) {
        return normalized;
      }
      deduped.push({
        cwd: normalized,
        displayName: cwdDisplayName(normalized),
        addedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        archived: false,
      });
      writeProjectsJson(deduped);
    } else if (existing.archived) {
      // 已归档项目：不再自动取消归档（需用户手动恢复）
      // 仅更新 cwd 路径（处理盘符变化）
      if (path.resolve(existing.cwd) !== normalized) {
        console.log(`[projects] 盘符变化(已归档): ${existing.cwd} → ${normalized}`);
        existing.cwd = normalized;
        writeProjectsJson(deduped);
      }
    } else {
      // 更新最后打开时间
      existing.lastOpenedAt = new Date().toISOString();
      // 如果 cwd 发生了盘符变化，更新为新路径
      if (path.resolve(existing.cwd) !== normalized) {
        console.log(`[projects] 盘符变化: ${existing.cwd} → ${normalized}`);
        existing.cwd = normalized;
      }
      if (hasDupes) writeProjectsJson(deduped);
      else writeProjectsJson(deduped);
    }
    return normalized;
  }

  // 清理 projects.json 中路径不存在的幽灵条目 + 去重
  function cleanupProjectsJson() {
    const projects = readProjectsJson();
    const before = projects.length;
    const seen = new Set();  // 用于去重：normalized cwd → 首次出现的索引
    const valid = projects.filter((p, i) => {
      // 排除 workspace 根目录
      if (path.resolve(p.cwd) === DEFAULT_WORKSPACE_DIR) return false;
      // 排除用户明确删除过的项目（防残留条目复活）
      if (isRemovedCwd(path.resolve(p.cwd))) return false;
      // 去重：相同 normalized cwd 只保留第一条（保留最早 addedAt）
      const normalized = path.resolve(p.cwd).toLowerCase();
      if (seen.has(normalized)) return false;  // 重复，只保留第一条
      seen.add(normalized);
      // 保留 archived 的（可能在归档区）
      if (p.archived) return true;
      // workspace 下的项目：目录存在则保留；目录不存在但有会话记录也保留（换电脑场景）；
      // 目录不存在且无会话记录 → 幽灵项目，清理（用户已在文件管理器删除）
      const resolved = path.resolve(p.cwd);
      if (extractWorkspaceSuffix(resolved)) {
        if (fs.existsSync(resolved)) return true;
        // 目录不存在，检查是否有会话记录
        const sessionDirName = encodeSessionDirName(resolved);
        const sessionDir = path.join(SESSIONS_DIR, sessionDirName);
        if (fs.existsSync(sessionDir)) return true;  // 有会话，保留
        return false;  // 无目录无会话，清理
      }
      // 其他路径必须存在
      return fs.existsSync(resolved);
    });
    if (valid.length < before) {
      console.log(`[projects] 清理+去重: ${before} → ${valid.length}`);
      writeProjectsJson(valid);
    }
    return valid;
  }

  // Encode cwd path to Tiffa session dir name
  // 委托给 stableSessionDirName：workspace 项目用盘符无关的稳定名（与内核 --session-dir 同源），
  // 外部文件夹退回原 cwd 编码。cli.js WR5/d46 的编码规则保留在 _encodeSessionDirName 作兜底。
  function encodeSessionDirName(cwdPath) {
    return stableSessionDirName(cwdPath);
  }

  // Decode Tiffa session dir name back to cwd path
  // NOTE: Tiffa 的编码 replace(/[/\\:]/g, "-") 是有损的，
  // 目录名中的 - 和路径分隔符编码后的 - 无法区分。
  // 可靠的 cwd 来源是 JSONL 文件中的 cwd 字段。
  // 此函数仅作为 fallback 使用。
  function decodeSessionDirName(dirName) {
    if (!dirName.startsWith('--') || !dirName.endsWith('--')) return dirName;
    const inner = dirName.slice(2, -2); // e.g. "G--Tiffa-workspace"
    // Windows 盘符格式: X--rest (X 是盘符，后面两个 - 分别是 : 和 \)
    if (/^[A-Z]--/.test(inner)) {
      const drive = inner[0];
      // 去掉 "X--" (冒号和根路径的反斜杠)
      const rest = inner.slice(3);
      // rest 中包含目录名中的 - 和路径分隔符编码的 -
      // 我们无法完美还原，但可以尝试用 fs 验证
      // 对于不含 - 的路径组件，简单的替换就够用
      // 对于含 - 的路径，需要 extractCwdFromSessionDir 辅助
      return drive + ':\\' + rest.replace(/-/g, '\\');
    }
    // 非 Windows 路径
    return '/' + inner.replace(/-/g, '/');
  }

  // 从 JSONL 文件中提取 cwd（可靠来源）
  function extractCwdFromSessionDir(dirPath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          // 递归进分支子目录（mode 2 布局：目录/<uuid>/<uuid>.jsonl），否则嵌套会话的 cwd 提取不到会被误判为孤儿而跳过迁移
          const found = extractCwdFromSessionDir(full);
          if (found) return found;
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const stat = fs.statSync(full);
          const headSize = Math.min(4096, stat.size);
          const fd = fs.openSync(full, 'r');
          let text;
          try {
            const buf = Buffer.alloc(headSize);
            fs.readSync(fd, buf, 0, headSize, 0);
            text = buf.toString('utf8');
          } finally {
            fs.closeSync(fd);
          }
          const lines = text.split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.cwd) return obj.cwd;
            } catch {}
          }
        }
      }
    } catch {}
    return null;
  }

  // 判断 session 目录是否为空（无任何文件或子目录）
  // 空孤儿目录静默清理，不打 warn 日志
  function isEmptySessionDir(dirPath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries.length === 0;
    } catch {
      return false;
    }
  }

  // Extract session display name from cwd
  function cwdDisplayName(cwd) {
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || cwd;
  }

  // 首次启动时，扫描 sessions 目录迁移到 projects.json
  function migrateSessionsToProjectsJson() {
    const existing = readProjectsJson();
    const existingCwds = new Set(existing.map(p => path.resolve(p.cwd)));
    let changed = false;

    if (fs.existsSync(SESSIONS_DIR)) {
      let dirs = [];
      try {
        dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
      } catch (err) {
        console.warn('[migrate] 扫描 sessions 目录失败（可能被 NTFS 损坏目录阻塞）:', err.message);
      }
      for (const dir of dirs) {
        // 优先从 JSONL 文件中读取 cwd（可靠）
        const dirPath = path.join(SESSIONS_DIR, dir.name);
        let cwd = extractCwdFromSessionDir(dirPath);

        // 空孤儿目录（无任何会话文件）静默清理，不打 warn 日志
        if (!cwd && isEmptySessionDir(dirPath)) {
          try { fs.rmdirSync(dirPath); } catch {}
          continue;
        }

        // 如果 JSONL 为空或无 cwd 字段，用 decode 做最佳猜测
        if (!cwd) {
          cwd = decodeSessionDirName(dir.name);
        }
        
        let normalized = path.resolve(cwd);

        // 旧盘符迁移：如果 cwd 不在当前 PORTABLE_ROOT 下但属于某个 workspace，
        // 迁移到当前 PORTABLE_ROOT 的 workspace 下（换电脑/换盘符场景）
        const wsSuffix = extractWorkspaceSuffix(normalized);
        if (wsSuffix) {
          const migrated = path.resolve(path.join(path.join(PORTABLE_ROOT, 'workspace'), wsSuffix));
          if (migrated.toLowerCase() !== normalized.toLowerCase()) {
            console.log(`[migrate] 盘符迁移: ${normalized} -> ${migrated}`);
            normalized = migrated;
          }
        }

        // 验证 encode 反向匹配：确保 encode(normalized) 能映射回当前 dirName
        // 注意：迁移后的 normalized 编码可能和 dirName 不同（旧盘符编码的目录），
        // 此时跳过验证 -- 迁移逻辑已在 migrateSessionDirsForNewRoot 中处理目录重命名
        if (encodeSessionDirName(normalized) !== dir.name) {
          // 旧盘符编码的目录，migrateSessionDirsForNewRoot 应该已经处理过重命名/合并
          // 如果目录还在，说明迁移失败（如文件冲突），跳过避免注册旧路径
          console.log(`[migrate] 跳过旧盘符目录(应由路径迁移处理): ${dir.name} (cwd: ${normalized})`);
          continue;
        }

        // 用户明确删除过的项目：清理残留会话目录，绝不复活
        if (isRemovedCwd(normalized)) {
          console.log(`[migrate] 清理已删除项目的残留会话目录: ${dir.name}`);
          try { rimraf(dirPath); } catch {}
          continue;
        }

        // 验证 cwd 路径存在于磁盘（排除歧义 decode 产生的幽灵路径）
        // 但对于 workspace 下的项目，即使路径不存在也保留（换电脑后子目录可能还没创建）
        if (!fs.existsSync(normalized)) {
          if (wsSuffix) {
            console.log(`[migrate] workspace 项目路径不存在但保留: ${dir.name} (cwd: ${normalized})`);
          } else {
            console.log(`[migrate] 跳过路径不存在的目录: ${dir.name} (cwd: ${normalized})`);
            continue;
          }
        }
        
        if (!existingCwds.has(normalized)) {
          existing.push({
            cwd: normalized,
            displayName: cwdDisplayName(normalized),
            addedAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            archived: false,
          });
          existingCwds.add(normalized);
          changed = true;
        }
      }
    }

    if (changed) writeProjectsJson(existing);
    return existing;
  }

  // ═══════════════════════════════════════════════════════════
  // 启动时路径迁移：修复换电脑后盘符/路径变化导致的数据丢失
  // ═══════════════════════════════════════════════════════════
  //
  // 场景：用户把 Tiffa 便携包从 G:\Tiffa\ 拷到新电脑的 D:\Tiffa\
  // 问题1: session 目录名编码了旧路径 --G--Tiffa-workspace-omp调试--
  // 问题2: projects.json 中的 cwd 是旧绝对路径 G:\Tiffa\workspace\omp调试
  //
  // 解决：
  // 1. 扫描 sessions 目录找"孤儿"（不在 projects.json 中的旧目录）
  // 2. 从 JSONL 文件中提取旧 cwd，替换盘符/根路径后重命名目录
  // 3. 更新 projects.json 中旧盘符的条目

  function migrateSessionDirsForNewRoot() {
    if (!fs.existsSync(SESSIONS_DIR)) return;

    const currentWorkspace = path.join(PORTABLE_ROOT, 'workspace');
    const projects = readProjectsJson();
    const existingCwds = new Set(projects.map(p => path.resolve(p.cwd)));
    let changed = false;

    // 步骤1: 修复 projects.json 中旧盘符的条目
    const newProjects = [];
    for (const proj of projects) {
      const resolved = path.resolve(proj.cwd);
      // 检查 cwd 是否指向当前 PORTABLE_ROOT 的 workspace
      // 如果 projects.json 里写的是 G:\Tiffa\workspace\xxx，但当前 PORTABLE_ROOT 是 D:\Tiffa
      // 则修正为 D:\Tiffa\workspace\xxx
      const workspaceSuffix = extractWorkspaceSuffix(resolved);
      if (workspaceSuffix) {
        const newCwd = path.join(currentWorkspace, workspaceSuffix);
        if (newCwd.toLowerCase() !== resolved.toLowerCase()) {
          console.log(`[migrate-path] projects.json 修复: ${proj.cwd} → ${newCwd}`);
          proj.cwd = newCwd;
          changed = true;
        }
      }
      newProjects.push(proj);
    }
    // 步骤1.5: 去重（修复盘符后可能有多个条目指向同一个路径）
    const seenCwds = new Set();
    const dedupedProjects = [];
    for (const proj of newProjects) {
      const resolved = path.resolve(proj.cwd).toLowerCase();
      if (seenCwds.has(resolved)) {
        console.log(`[migrate-path] 去重: 移除重复项目 ${proj.cwd}`);
        changed = true;
        continue;
      }
      seenCwds.add(resolved);
      dedupedProjects.push(proj);
    }
    if (changed) {
      writeProjectsJson(dedupedProjects);
    }

    // 步骤2: 扫描 sessions 目录，找孤儿目录并迁移
    let dirs = [];
    try {
      dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    } catch (err) {
      console.warn('[migrate-path] 扫描 sessions 目录失败（可能被 NTFS 损坏目录阻塞）:', err.message);
    }
    for (const dir of dirs) {
      const dirPath = path.join(SESSIONS_DIR, dir.name);

      // 从 JSONL 文件中提取旧 cwd
      const oldCwd = extractCwdFromSessionDir(dirPath);
      if (!oldCwd) {
        // 空孤儿目录静默清理；非空但无法提取 cwd 才打 warn
        if (isEmptySessionDir(dirPath)) {
          try { fs.rmdirSync(dirPath); } catch {}
        } else {
          console.log(`[migrate-path] 无法提取 cwd: ${dir.name}`);
        }
        continue;
      }

      const workspaceSuffix = extractWorkspaceSuffix(oldCwd);
      if (!workspaceSuffix) {
        // 非 workspace 下的项目，跳过（用户只迁移 workspace 下的项目）
        continue;
      }

      const newCwd = path.join(currentWorkspace, workspaceSuffix);
      const newDirName = encodeSessionDirName(newCwd);

      // 用户明确删除过的项目：清理残留会话目录，不迁移不复活
      if (isRemovedCwd(path.resolve(newCwd))) {
        console.log(`[migrate-path] 清理已删除项目的残留会话目录: ${dir.name}`);
        try { rimraf(dirPath); } catch {}
        continue;
      }

      // 已经匹配当前路径 → 无需迁移
      if (dir.name === newDirName) continue;

      // 新目录已存在 → 合并（把旧目录的文件移过去）
      const newDirPath = path.join(SESSIONS_DIR, newDirName);
      if (fs.existsSync(newDirPath)) {
        console.log(`[migrate-path] 合并: ${dir.name} -> ${newDirName}`);
        // 移动旧目录中的文件到新目录，文件名冲突时直接删除源文件（目标已存在且内容相同）
        const oldFiles = fs.readdirSync(dirPath);
        for (const f of oldFiles) {
          const src = path.join(dirPath, f);
          const dst = path.join(newDirPath, f);
          if (!fs.existsSync(dst)) {
            try { fs.renameSync(src, dst); } catch {}
          } else {
            // 目标已存在同名文件，删除源文件（会话文件内容相同，无需重复保留）
            try { fs.unlinkSync(src); } catch {}
          }
        }
        // 删除旧目录（此时应为空）
        try { fs.rmdirSync(dirPath); } catch (err) {
          // rmdirSync 失败说明目录可能含子目录或文件删除失败，用 rimraf 兜底
          try { rimraf(dirPath); } catch {}
        }
      } else {
        // 直接重命名
        console.log(`[migrate-path] 重命名: ${dir.name} → ${newDirName}`);
        try { fs.renameSync(dirPath, newDirPath); } catch (err) {
          console.log(`[migrate-path] 重命名失败: ${err.message}`);
          continue;
        }
      }

      // 确保 projects.json 中有新路径的条目
      if (!existingCwds.has(path.resolve(newCwd))) {
        projects.push({
          cwd: newCwd,
          displayName: cwdDisplayName(newCwd),
          addedAt: new Date().toISOString(),
          lastOpenedAt: new Date().toISOString(),
          archived: false,
        });
        existingCwds.add(path.resolve(newCwd));
        changed = true;
      }
    }

    if (changed) writeProjectsJson(projects);
  }

  // 注：extractWorkspaceSuffix 已提升到模块顶层（见上方），setupIpc 内部经作用域链直接复用，此处不再重复定义。

  // 自动发现 workspace 下的子目录，注册到 projects.json
  function discoverWorkspaceProjects() {
    if (!fs.existsSync(DEFAULT_WORKSPACE_DIR)) return;
    try {
      const entries = fs.readdirSync(DEFAULT_WORKSPACE_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(DEFAULT_WORKSPACE_DIR, entry.name);
        ensureProjectInJson(subDir);
      }
    } catch (err) {
      console.warn('[discover] 扫描 workspace 子目录失败:', err.message);
    }
  }

  // 启动时迁移一次，清理幽灵条目，确保默认工作区已注册
  migrateSessionDirsForNewRoot();
  migrateSessionsToProjectsJson();
  cleanupProjectsJson();
  discoverWorkspaceProjects();
  ensureProjectInJson(currentWorkspaceDir);

  // Parse JSONL session file header (first 4KB)
  function parseSessionHeader(filePath) {
    try {
      const stat = fs.statSync(filePath);
      const headSize = Math.min(65536, stat.size); // 64KB（从 4KB 升级）
      const fd = fs.openSync(filePath, 'r');
      let text;
      try {
        const buf = Buffer.alloc(headSize);
        fs.readSync(fd, buf, 0, headSize, 0);
        text = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
      const lines = text.split('\n').filter(l => l.trim());

      let title = null;
      let sessionId = null;
      let cwd = null;
      let firstMessage = null;
      let messageCount = 0;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          // title 事件取“最后一个”（覆盖语义）：手动重命名以追加 title 事件行实现，
          // 新追加的（更新的）必须优先。
          if (obj.type === 'title' && obj.title) {
            title = obj.title;
          }
          if (obj.id && !sessionId && obj.version) {
            sessionId = obj.id;
            cwd = obj.cwd;
            // 手动重命名写入 header.title，作为 title 事件的 fallback
            if (obj.title && !title) title = obj.title;
          }
          if (obj.message) {
            messageCount++;
            if (!firstMessage && obj.message.role === 'user' && obj.message.content) {
              const content = obj.message.content;
              if (typeof content === 'string') firstMessage = content;
              else if (Array.isArray(content)) {
                const textPart = content.find(c => c.type === 'text');
                if (textPart) firstMessage = textPart.text;
              }
              if (firstMessage && firstMessage.length > 100) {
                firstMessage = firstMessage.substring(0, 100) + '...';
              }
            }
          }
        } catch {}
      }

      // 追加标题（手动重命名）在文件尾部：头部 64KB 读不到时，扫描文件尾部 4KB
      // 取最新 title 事件（与 session-utils.parseSessionHeader 一致）
      if (stat.size > headSize) {
        const tailSize = Math.min(4096, stat.size);
        const fd2 = fs.openSync(filePath, 'r');
        try {
          const buf2 = Buffer.alloc(tailSize);
          fs.readSync(fd2, buf2, 0, tailSize, stat.size - tailSize);
          const tailLines = buf2.toString('utf8').split('\n').filter((l) => l.trim());
          for (const line of tailLines) {
            try {
              const obj = JSON.parse(line);
              if (obj.type === 'title' && obj.title) title = obj.title;
            } catch {}
          }
        } finally {
          fs.closeSync(fd2);
        }
      }

      return {
        path: filePath,
        name: path.basename(filePath, '.jsonl'),
        sessionId,
        cwd,
        title,
        firstMessage: firstMessage || '(空会话)',
        messageCount,
        size: stat.size,
        modified: stat.mtimeMs,
      };
    } catch (err) {
      return { path: filePath, name: path.basename(filePath), error: err.message };
    }
  }

  // ── 自动生成会话标题 ──
  // RPC-UI 模式下内核不调用 generateTitle，main.js 在 agent_end 后补标题。
  // 策略：读取 JSONL header，若无 title 则从第一条用户消息截取前 25 字作标题，
  // 写入 header.title + 追加 title 事件，然后通知前端更新标签。
  function _tryGenerateSessionTitle(inst) {
    try {
      const sessionPath = inst.sessionFilePath;
      if (!sessionPath) return;
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) return;

      const header = parseSessionHeader(resolved);
      // 已有标题（title 事件或 header.title）-> 不覆盖
      if (header.title) return;
      // 没有用户消息 -> 无法生成
      if (!header.firstMessage || header.firstMessage === '(空会话)') return;

      // 截取前 25 字作为标题（与前端 renderHistoryPanel 的截断长度一致）
      let title = header.firstMessage;
      // 去掉换行和多余空白
      title = title.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      if (title.length > 25) title = title.substring(0, 25) + '…';
      if (!title) return;

      // 写入 JSONL：更新 header.title + 追加 title 事件
      // 安全策略：只读第一行（header），修改后写回第一行位置，再 append title 事件到文件末尾
      // 避免读取整个文件再写回（与内核并发 append 冲突会丢数据）
      const fd = fs.openSync(resolved, 'r+');
      let headerBuf = Buffer.alloc(65536);
      const bytesRead = fs.readSync(fd, headerBuf, 0, 65536, 0);
      const headerText = headerBuf.toString('utf8', 0, bytesRead);
      const firstNl = headerText.indexOf('\n');
      if (firstNl < 0) { fs.closeSync(fd); return; }
      const firstLine = headerText.substring(0, firstNl);
      let headerObj;
      try { headerObj = JSON.parse(firstLine); } catch { fs.closeSync(fd); return; }
      headerObj.title = title;
      const newFirstLine = JSON.stringify(headerObj) + '\n';
      // 检查新 header 行长度不超过原 header 行长度（避免覆盖后续行）
      // 如果更长，放弃修改 header（仅追加 title 事件即可，parseSessionHeader 也能读到）
      if (newFirstLine.length <= firstLine.length + 1) {
        // 用空格 pad 到原长度，避免覆盖下一行
        const padded = newFirstLine.padEnd(firstLine.length + 1, ' ');
        fs.writeSync(fd, padded, 0, 'utf8');
      }
      fs.closeSync(fd);
      // 追加 title 事件到文件末尾（与内核的 append-only 写入模式一致，无并发冲突）
      const titleEvent = JSON.stringify({
        type: 'title', v: 1, title,
        updatedAt: new Date().toISOString(),
        source: 'auto',
      }) + '\n';
      fs.appendFileSync(resolved, titleEvent, 'utf8');

      // 通知前端更新标签标题
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tiffa:event', {
          type: 'session_info_update',
          title,
          sessionId: inst.sessionId,
          _cwd: inst.cwd,
          _sessionId: inst.sessionId,
        });
      }
      console.log(`[title-gen] 会话标题已生成: "${title}" (${inst._shortCwd()})`);
    } catch (err) {
      console.warn('[title-gen] 生成标题失败:', err.message);
    }
  }
  // 将标题生成函数注册为 TiffaInstance 的静态回调
  // （TiffaInstance 类定义在模块顶层，无法直接访问 setupIpc 闭包内的函数）
  TiffaInstance._titleGenerateCallback = _tryGenerateSessionTitle;

  ipcMain.handle('sessions:listProjects', async () => {
    try {
      // 每次列出项目时也自动发现 workspace 子目录
      discoverWorkspaceProjects();

      const projects = readProjectsJson().filter(p => !p.archived);

      const result = [];
      for (const proj of projects) {
        const normalized = path.resolve(proj.cwd);
        const dirName = encodeSessionDirName(normalized);
        const projectPath = path.join(SESSIONS_DIR, dirName);

        // 会话附属目录判定（listProjects / listSessions 共用）：
        // 子目录名与“顶层会话名”相同（或以其+_开头）→ bash 日志/压缩归档等附属内容，
        // 内部 jsonl 不是独立会话（否则一个对话的归档会分裂成多个列表项）
        let _topNames = null;
        const isAttachmentDir = (dirName) => {
          if (!_topNames) {
            _topNames = new Set();
            try {
              for (const e of fs.readdirSync(projectPath, { withFileTypes: true })) {
                if (e.isFile() && e.name.endsWith('.jsonl')) _topNames.add(e.name.slice(0, -'.jsonl'.length));
              }
            } catch { /* ignore */ }
          }
          for (const t of _topNames) if (dirName === t || dirName.startsWith(t + '_')) return true;
          return false;
        };

        // 统计会话数（与 sessions:listSessions 口径一致：顶层会话 + 非附属子目录）
        let sessionCount = 0;
        const countJsonl = (dir, isTop) => {
          let entries;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              // 顶层以下目录名以“顶层会话名_”开头 → 会话附属目录（bash 日志/压缩归档），
              // 内部 jsonl 不是独立会话（否则一个对话的归档会分裂成多个列表项）
              if (isTop && isAttachmentDir(entry.name)) continue;
              countJsonl(full, false);
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) sessionCount++;
          }
        };
        if (fs.existsSync(projectPath)) countJsonl(projectPath, true);

        result.push({
          dirName,
          cwd: normalized,
          displayName: proj.displayName || cwdDisplayName(normalized),
          sessionCount,
          path: normalized,
          lastOpenedAt: proj.lastOpenedAt || '',
          addedAt: proj.addedAt || '',
        });
      }

      // 按最新会话活动排序（最近活跃的项目排在前面）
      for (const proj of result) {
        try {
          const projectPath = path.join(SESSIONS_DIR, proj.dirName);
          if (fs.existsSync(projectPath)) {
            // 递归扫描（含分支子目录），与 listSessions 口径一致
            let newestMtime = 0;
            const scanMtime = (dir) => {
              let entries;
              try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
              } catch {
                return;
              }
              for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) scanMtime(full);
                else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                  const stat = fs.statSync(full);
                  if (stat.mtimeMs > newestMtime) newestMtime = stat.mtimeMs;
                }
              }
            };
            scanMtime(projectPath);
            proj.lastSessionMtime = newestMtime;
          } else { proj.lastSessionMtime = 0; }
        } catch { proj.lastSessionMtime = 0; }
      }
      result.sort((a, b) => {
        const aTime = a.lastSessionMtime || new Date(a.lastOpenedAt || 0).getTime() || 0;
        const bTime = b.lastSessionMtime || new Date(b.lastOpenedAt || 0).getTime() || 0;
        return bTime - aTime;  // 最近活跃的排前
      });

      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:listSessions', async (event, projectDirName) => {
    try {
      const projectPath = path.join(SESSIONS_DIR, projectDirName);
      if (!fs.existsSync(projectPath)) return [];

      // 顶层会话名（去 .jsonl）：子目录名与“顶层会话名”相同（或以其+_开头）→ 会话附属目录
      // （bash 日志/压缩归档 P*.jsonl 等），内部 jsonl 不视为独立会话，
      // 否则一个对话的归档会分裂成多个列表项（用户看到“一个对话变成好几个”）。
      const isAttachmentDir = (dirName) => {
        const topNames = new Set();
        for (const e of fs.readdirSync(projectPath, { withFileTypes: true })) {
          if (e.isFile() && e.name.endsWith('.jsonl')) topNames.add(e.name.slice(0, -'.jsonl'.length));
        }
        for (const t of topNames) if (dirName === t || dirName.startsWith(t + '_')) return true;
        return false;
      };

      // 收集 .jsonl：顶层全部；子目录仅当不是会话附属目录时才递归
      // （保留非附属子目录内的真会话文件，与旧“分支会话丢失”修复兼容）
      const files = [];
      const walk = (dir, isTop) => {
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (isTop && isAttachmentDir(entry.name)) continue;
            walk(full, false);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            files.push(full);
          }
        }
      };
      walk(projectPath, true);
      // 按文件名（ISO 时间戳前缀）正序，最旧在前；分支子目录与顶层混排时按 basename 比较保持时间序
      files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

      const sessions = [];
      for (const file of files) {
        const session = parseSessionHeader(file);
        sessions.push(session);
      }

      // 按时间正序返回（最旧在左，最新在右），不 reverse
      return sessions;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:switch', async (event, sessionPath) => {
    return _active().sendCommand({ type: 'switch_session', sessionPath });
  });

  ipcMain.handle('sessions:new', async () => {
    return _active().sendCommand({ type: 'new_session' });
  })

  // ── Session History Loading ──
  ipcMain.handle('sessions:loadHistory', async (event, sessionPath, opts) => {
    try {
      const resolvedPath = path.resolve(sessionPath);
      if (!resolvedPath.endsWith('.jsonl') || !fs.existsSync(resolvedPath)) {
        return { error: 'Session file not found' };
      }
      // 增量读取：默认只返回尾部 tail 条；skip = 已从尾部加载的条数（"加载更早"用）。
      // opts.tail = 0 表示全量（分支/导出等需要全部消息的场景）。
      const rawTail = Number(opts && opts.tail);
      const wantAll = rawTail === 0;
      const tail = wantAll ? Infinity : Math.min(rawTail || 200, 500);
      const skip = Math.max(Number(opts && opts.skip) || 0, 0);

      let lines, reachedStart, droppedAny = false;
      if (wantAll) {
        const text = await fs.promises.readFile(resolvedPath, 'utf8');
        lines = text.split('\n');
        reachedStart = true;
      } else {
        const r = await readTailLines(resolvedPath, skip + tail);
        lines = r.lines;
        reachedStart = r.reachedStart;
        droppedAny = r.droppedAny;
      }

      const all = parseSessionLines(lines);
      const kept = wantAll ? all : all.slice(0, Math.max(0, all.length - skip));
      const messages = wantAll ? kept : kept.slice(-tail);
      // hasMore：丢弃过更旧的行 或 没读到文件头 → 一定还有更早的消息
      const hasMore = wantAll ? false : (droppedAny || !reachedStart);
      return { messages, hasMore };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Project archive / delete ──
  // 根据 dirName 查找 projects.json 中对应的项目
  function findProjectByDirName(dirName) {
    const projects = readProjectsJson();
    for (const p of projects) {
      const normalized = path.resolve(p.cwd);
      if (encodeSessionDirName(normalized) === dirName) {
        return { project: p, allProjects: projects, normalized };
      }
    }
    return { project: null, allProjects: projects, normalized: null };
  }

  // 判断会话文件(.jsonl)是否属于指定 cwd（读取 header 中的 cwd 字段）
  function sessionFileBelongsToCwd(filePath, cwdLower) {
    try {
      const header = parseSessionHeader(filePath);
      return header && header.cwd && path.resolve(header.cwd).toLowerCase() === cwdLower;
    } catch { return false; }
  }

  // 外科手术式删除：只删会话目录中属于指定 cwd 的 .jsonl（编码碰撞场景：
  // logo\design 与 logo-design 编码后目录名相同，不能整目录删），并清理空目录
  function deleteSessionFilesForCwd(sessionDir, projectCwd) {
    if (!fs.existsSync(sessionDir)) return;
    const cwdLower = projectCwd.toLowerCase();
    for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
      const full = path.join(sessionDir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (sessionFileBelongsToCwd(full, cwdLower)) {
          try { fs.unlinkSync(full); } catch {}
        }
      } else if (entry.isDirectory()) {
        // 子目录模式：*_<uuid>/<name>.jsonl
        for (const sub of fs.readdirSync(full)) {
          if (!sub.endsWith('.jsonl')) continue;
          const subFull = path.join(full, sub);
          if (sessionFileBelongsToCwd(subFull, cwdLower)) {
            try { fs.unlinkSync(subFull); } catch {}
          }
        }
        try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch {}
      }
    }
    try { if (fs.readdirSync(sessionDir).length === 0) fs.rmdirSync(sessionDir); } catch {}
  }

  // 外科手术式移动：只把属于指定 cwd 的 .jsonl 移到目标目录（编码碰撞场景的归档）
  function moveSessionFilesForCwd(srcDir, destDir, projectCwd) {
    const cwdLower = projectCwd.toLowerCase();
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const full = path.join(srcDir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (sessionFileBelongsToCwd(full, cwdLower)) {
          try { fs.renameSync(full, path.join(destDir, entry.name)); } catch {}
        }
      } else if (entry.isDirectory()) {
        for (const sub of fs.readdirSync(full)) {
          if (!sub.endsWith('.jsonl')) continue;
          const subFull = path.join(full, sub);
          if (sessionFileBelongsToCwd(subFull, cwdLower)) {
            const subDest = path.join(destDir, entry.name);
            if (!fs.existsSync(subDest)) fs.mkdirSync(subDest, { recursive: true });
            try { fs.renameSync(subFull, path.join(subDest, sub)); } catch {}
          }
        }
        try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch {}
      }
    }
    try { if (fs.readdirSync(srcDir).length === 0) fs.rmdirSync(srcDir); } catch {}
  }

  ipcMain.handle('sessions:archiveProject', async (event, dirName, cwd) => {
    try {
      // 在 projects.json 中标记 archived（优先按 cwd 精确匹配，避免编码碰撞误伤）
      const allProjects = readProjectsJson();
      let project = null;
      if (cwd) {
        const normalized = path.resolve(cwd);
        project = allProjects.find(p => path.resolve(p.cwd) === normalized) || null;
        // cwd 已指定时不回退 dirName 匹配（防碰撞场景误归档兄弟项目）
      } else {
        project = findProjectByDirName(dirName).project;
      }
      if (project) {
        project.archived = true;
        project.archivedAt = new Date().toISOString();
        writeProjectsJson(allProjects);
      }

      // 仍然移动目录到归档区（保留物理数据以便恢复）
      const srcDir = path.join(SESSIONS_DIR, dirName);
      if (fs.existsSync(srcDir)) {
        const projectCwd = (project ? path.resolve(project.cwd) : null) || (cwd ? path.resolve(cwd) : null);
        // 编码碰撞检测：是否还有活跃项目共享此会话目录
        const hasSibling = projectCwd && allProjects.some(p =>
          !p.archived && path.resolve(p.cwd) !== projectCwd &&
          encodeSessionDirName(path.resolve(p.cwd)) === dirName);
        if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
        const destDir = path.join(ARCHIVE_DIR, dirName);
        if (hasSibling) {
          // 碰撞：只移走本项目的会话文件，兄弟项目的留下
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          moveSessionFilesForCwd(srcDir, destDir, projectCwd);
        } else {
          let finalDest = destDir;
          if (fs.existsSync(finalDest)) {
            finalDest = path.join(ARCHIVE_DIR, dirName + '-' + Date.now());
          }
          fs.renameSync(srcDir, finalDest);
        }
      }
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:deleteProject', async (event, dirName, cwd) => {
    try {
      // 定位项目（优先按 cwd 精确匹配：编码有损，logo\design 与 logo-design 的 dirName 相同）
      const allProjects = readProjectsJson();
      let project = null, normalized = null;
      if (cwd) {
        normalized = path.resolve(cwd);
        project = allProjects.find(p => path.resolve(p.cwd) === normalized) || null;
        // cwd 已指定时不回退 dirName 匹配：记录已不存在（重复删除）也不能误删兄弟项目
      } else {
        const found = findProjectByDirName(dirName);
        project = found.project;
        normalized = found.normalized;
      }
      // 从 projects.json 中删除记录
      let hasSibling = false;
      if (normalized) {
        const filtered = allProjects.filter(p => path.resolve(p.cwd) !== normalized);
        writeProjectsJson(filtered);
        // 碰撞检测：删除后是否仍有其他项目共享同一会话目录名
        hasSibling = filtered.some(p => encodeSessionDirName(path.resolve(p.cwd)) === dirName);
      }

      const projectCwd = normalized || ((project && project.cwd) ? path.resolve(project.cwd) : null);

      // ── 第一步：加入 removedCwds（必须在文件删除之前，即使后续步骤失败也不复活） ──
      if (projectCwd) {
        const removedList = readRemovedCwds();
        const lower = projectCwd.toLowerCase();
        if (!removedList.includes(lower)) {
          removedList.push(lower);
          writeRemovedCwds(removedList);
        }
      }

      // ── 第二步：同步杀死该项目的所有实例（userKilled 防自动重启） ──
      if (projectCwd) {
        const keysToDelete = [];
        for (const [key, inst] of tiffaManager.instances) {
          if (inst.cwd === projectCwd) {
            inst.kill(true); // 同步树杀，确保进程已死、文件句柄释放
            keysToDelete.push(key);
          }
        }
        for (const key of keysToDelete) {
          tiffaManager.instances.delete(key);
        }
        if (tiffaManager.activeCwd === projectCwd) {
          tiffaManager.activeKey = null;
          tiffaManager.activeCwd = null;
        }
        // 等待操作系统释放文件句柄
        if (keysToDelete.length > 0) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // ── 第三步：物理删除会话数据（带重试，防 Windows 文件锁残留） ──
      // 编码碰撞时只删本项目的会话文件，兄弟项目的保留
      const srcDir = path.join(SESSIONS_DIR, dirName);
      const archiveSrcDir = path.join(ARCHIVE_DIR, dirName);
      if (hasSibling && projectCwd) {
        console.log(`[deleteProject] 编码碰撞，仅删除 ${projectCwd} 的会话文件`);
        deleteSessionFilesForCwd(srcDir, projectCwd);
        deleteSessionFilesForCwd(archiveSrcDir, projectCwd);
      } else {
        await rimrafWithRetry(srcDir);
        // 归档区的数据也一并清理（永久删除归档项目时走这里）
        await rimrafWithRetry(archiveSrcDir);
      }

      // ── 第四步：删除 workspace 下的项目物理目录（否则 discover 会重新发现） ──
      if (projectCwd) {
        // 安全检查：只删 workspace 子目录，不删 workspace 根目录本身
        const wsSuffix = extractWorkspaceSuffix(projectCwd);
        if (wsSuffix) {
          // 嵌套项目保护：目录内还有其他注册项目时不删物理目录
          // （否则 ensureProjectInJson 会因嵌套项目的会话记录立即重建父目录）
          const prefix = projectCwd.toLowerCase() + path.sep;
          const hasNested = readProjectsJson().some(p => path.resolve(p.cwd).toLowerCase().startsWith(prefix));
          if (hasNested) {
            console.log(`[deleteProject] 目录内存在嵌套项目，跳过物理删除: ${projectCwd}`);
          } else {
            await rimrafWithRetry(projectCwd);
            console.log(`[deleteProject] 已删除 workspace 目录: ${projectCwd}`);
          }
        }
      }

      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:listArchived', async () => {
    try {
      // 从 projects.json 中获取已归档项目
      const projects = readProjectsJson().filter(p => p.archived);
      return projects.map(p => {
        const normalized = path.resolve(p.cwd);
        const dirName = encodeSessionDirName(normalized);
        return {
          dirName,
          cwd: normalized,
          displayName: p.displayName || cwdDisplayName(normalized),
          archivedAt: p.archivedAt || '',
        };
      });
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sessions:restoreProject', async (event, dirName) => {
    try {
      // 在 projects.json 中取消归档标记
      const { project, allProjects, normalized } = findProjectByDirName(dirName);
      if (project) {
        project.archived = false;
        delete project.archivedAt;
        project.lastOpenedAt = new Date().toISOString();
        writeProjectsJson(allProjects);
      }

      // 移动归档目录回 sessions 区
      const srcDir = path.join(ARCHIVE_DIR, dirName);
      if (fs.existsSync(srcDir)) {
        const destDir = path.join(SESSIONS_DIR, dirName);
        if (!fs.existsSync(destDir)) {
          fs.renameSync(srcDir, destDir);
        }
      }
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 单会话归档：关闭实例 + 移动 jsonl 到归档目录 ──
  ipcMain.handle('sessions:archiveSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      // 先关闭实例，防止内核后续写盘在归档后的原路径重建文件
      _closeInstancesForSessionFile(resolved);
      await new Promise(r => setTimeout(r, 300));
      // 从文件路径反推项目 dirName
      const sessionDir = path.dirname(resolved);
      const dirName = path.basename(sessionDir);
      const archiveProjectDir = path.join(ARCHIVE_DIR, dirName);
      if (!fs.existsSync(archiveProjectDir)) {
        fs.mkdirSync(archiveProjectDir, { recursive: true });
      }
      const destPath = path.join(archiveProjectDir, path.basename(resolved));
      // 目标已存在时加时间戳防冲突
      let finalDest = destPath;
      if (fs.existsSync(finalDest)) {
        finalDest = path.join(archiveProjectDir, path.basename(resolved, '.jsonl') + '-' + Date.now() + '.jsonl');
      }
      fs.renameSync(resolved, finalDest);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 单会话删除：关闭实例 + 物理删除 jsonl 文件（幂等） ──
  ipcMain.handle('sessions:deleteSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl')) {
        return { error: 'Session file not found' };
      }
      // 先关闭持有该会话的实例：防内核写盘复活文件 + 释放文件句柄（Windows unlink EBUSY）
      _closeInstancesForSessionFile(resolved);
      await new Promise(r => setTimeout(r, 300));
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
      // 幂等：文件已不存在也视为删除成功（目标就是删掉它），仅路径非法/IO 错误才报错
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 重命名会话：优先内核 set_session_name 写 title slot，无实例时降级追加 title 事件行 ──
  ipcMain.handle('sessions:rename', async (event, sessionPath, newTitle) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      if (!newTitle || typeof newTitle !== 'string' || !String(newTitle).trim()) {
        return { error: 'Invalid title' };
      }
      const name = String(newTitle).trim().slice(0, 60);
      // 优先走内核 set_session_name：内核把 title 写入文件第一行 title slot
      // （256 字节定宽、原地改写头部，永远在 parseSessionHeader 的 64KB 头窗内），
      // 并追加 title_change 审计行 + 广播变更事件——tab 与树从同一权威来源取名。
      // 旧实现只往文件末尾追加 title 事件行：对话继续后消息行把 title 行推出
      // parseSessionHeader 的尾窗，树永远读不到新名（tab 与树分叉）。
      const sid = extractSessionIdFromPath(resolved);
      const inst = sid
        ? (tiffaManager.getBySessionIdAnywhere(sid) || tiffaManager.getBySessionId(tiffaManager.activeCwd, sid))
        : null;
      if (inst) {
        try {
          await inst.sendCommand({ type: 'set_session_name', name });
          console.log(`[rename] 内核写入 title slot: ${name} (${resolved})`);
          return { success: true };
        } catch (err) {
          console.warn(`[rename] set_session_name 失败，降级追加 title 行: ${(err as Error).message}`);
        }
      }
      // 降级：无活跃实例或命令失败 → 追加 title 事件行（不重写文件，避免与内核写盘竞态）
      const titleLine = JSON.stringify({
        type: 'title',
        v: 1,
        title: name,
        source: 'manual',
        updatedAt: new Date().toISOString(),
      }) + '\n';
      fs.appendFileSync(resolved, titleLine, 'utf8');
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 轻量模型补全（AI 重命名等小任务） ──
  // 降级链：豆包（grounding.json）→ 主模型旁路（当前模型或 config.yml default 的 provider，普通 completion 直调）
  // 读取 config.yml modelRoles 拿默认 provider/model
  function resolveDefaultModelFromConfig() {
    try {
      const cfgPath = path.join(PORTABLE_ROOT, 'data', 'agent', 'config.yml');
      if (!fs.existsSync(cfgPath)) return null;
      const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
      const roles = cfg && cfg.modelRoles;
      const ref = (roles && roles.default) || (roles && roles.slow) || null;
      if (!ref || typeof ref !== 'string' || !ref.includes('/')) return null;
      const [provider, model] = ref.split('/');
      // `localmodel` 是 config.yml 模板占位名，不是真实模型 ID，视为空交给 provider 第一个模型兜底
      return { provider, model: model && model !== 'localmodel' ? model : '' };
    } catch {
      return null;
    }
  }

  // 从 models.yml 找 provider 配置
  function findProviderConfig(providerId) {
    try {
      const raw = fs.readFileSync(path.join(PORTABLE_ROOT, 'data', 'agent', 'models.yml'), 'utf8');
      const data = yaml.load(raw);
      const providers = data && data.providers;
      const p = providers && providers[providerId];
      if (!p || !p.baseUrl) return null;
      return {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey || '',
        model: (p.models && p.models[0] && p.models[0].id) || '',
      };
    } catch {
      return null;
    }
  }

  // 模型回显宽容匹配：归一化（去 /models/ 前缀、去首斜杠、小写）后相等或互相包含即视为匹配
  function modelEchoMatches(reqModel, respModel) {
    const norm = (s) => String(s).toLowerCase().replace(/^\/models\//, '').replace(/^[\\/]/, '').trim();
    const a = norm(reqModel);
    const b = norm(respModel);
    if (!a || !b) return true;
    return a === b || a.includes(b) || b.includes(a);
  }

  // 单次 completion 调用（带 20s 超时）
  async function callCompletion(baseUrl, model, apiKey, prompt, maxTokens) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const isDoubao = String(baseUrl).includes('ark');
      const body = {
        model,
        messages: [{ role: 'user', content: String(prompt || '') }],
        max_tokens: maxTokens || 40,
        temperature: 0.3,
        // 关 llama.cpp qwen3 系思考：实测默认思考占满 max_tokens 导致 content 空（空响应误判失败）
        // 云端 OpenAI 兼容 API 忽略未知字段
        chat_template_kwargs: { enable_thinking: false },
      };
      if (isDoubao) body.thinking = { type: 'disabled' };  // 仅豆包需要关思考（实测 16s→1.9s）
      const resp = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && apiKey !== 'none' ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '');
        return { error: `HTTP ${resp.status}: ${bodyText.slice(0, 200)}` };
      }
      const data = await resp.json();
      const msg = data && data.choices && data.choices[0] && data.choices[0].message;
      // 模型回显校验：sglang 等服务器对未知 model 会回显占位/错乱 model（如 "????"）并输出垃圾回复，
      // 必须判失败继续降级链，避免把乱码当标题返回；回显缺失时放行（兼容旧服务）
      const respModel = data && data.model;
      if (respModel && model && !modelEchoMatches(String(model), String(respModel))) {
        return { error: `模型回显不匹配（请求 ${model}，返回 ${respModel}）` };
      }
      const text = (msg && msg.content) || '';
      return text.trim() ? { text: String(text).trim() } : { error: '空响应' };
    } finally {
      clearTimeout(timer);
    }
  }

  ipcMain.handle('ai:complete', async (event, { prompt, maxTokens, providerHint, modelHint }) => {
    const candidates = [];
    const seen = new Set();
    const push = (c) => {
      const key = `${c.baseUrl}|${c.model}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(c);
      }
    };
    // 0. 旁路模型（bypass-model.json，用户手配：AI 重命名/压缩总结/轻量补全三处共用，低成本优先）
    try {
      const bpPath = path.join(PORTABLE_ROOT, 'data', 'agent', 'bypass-model.json');
      if (fs.existsSync(bpPath)) {
        const bp = JSON.parse(fs.readFileSync(bpPath, 'utf8'));
        if (bp && bp.enabled !== false && bp.baseUrl && bp.model) {
          push({ name: 'bypass', baseUrl: bp.baseUrl, model: bp.model, apiKey: bp.apiKey || '' });
        }
      }
    } catch {}
    // 1. 豆包云端独立通道（computer-use grounding.json）：本地 11434 撞单槽时优先兜底，
    //    避免重试同实例的主模型（bypass 与主模型同为 11434 时冗余度为 1，直接跳云端更顺）
    try {
      const cfgPath = path.join(PORTABLE_ROOT, 'data', 'agent', 'managed-skills', 'computer-use', 'grounding.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      // enabled 字段存在（如 "0"/false）时视为未启用，跳过（占位 apiKey 只会白等一次 401）
      if (cfg && cfg.api_base && cfg.model && cfg.api_key && cfg.enabled !== false && cfg.enabled !== '0') {
        push({ name: 'doubao', baseUrl: cfg.api_base, model: cfg.model, apiKey: cfg.api_key });
      }
    } catch {}
    // 2. 主模型旁路：前端当前模型优先（主力经常变，跟随当前；local 开着就用免费的本地，没开快速失败落下一级）
    //    只要有 providerHint 就尝试，modelHint 为空时用 provider 的第一个模型兜底
    let ref = null;
    if (providerHint) {
      ref = { provider: providerHint, model: modelHint || '' };
    } else {
      ref = resolveDefaultModelFromConfig();
    }
    if (ref) {
      const pc = findProviderConfig(ref.provider);
      if (pc && pc.baseUrl) {
        push({ name: ref.provider, baseUrl: pc.baseUrl, model: ref.model || pc.model, apiKey: pc.apiKey });
      }
    }
    // 3. models.yml 里其他 provider（兜底：单一模型欠费/限流时仍可用）
    //    放宽条件：有 baseUrl 即可（本地模型无需 apiKey，云端模型有 apiKey 更佳）
    try {
      const data = yaml.load(fs.readFileSync(path.join(PORTABLE_ROOT, 'data', 'agent', 'models.yml'), 'utf8'));
      const providers = data && data.providers;
      if (providers) {
        for (const [pid, p] of Object.entries(providers)) {
          if (!p || !p.baseUrl) continue;
          // 无模型定义时跳过，避免发空 model 请求空等 10s 超时
          const firstModel = p.models && p.models[0] && p.models[0].id;
          if (!firstModel) continue;
          // 优先有 apiKey 的，然后是没有 apiKey 的（本地模型）
          const hasKey = p.apiKey && p.apiKey !== 'none';
          push({
            name: pid,
            baseUrl: p.baseUrl,
            model: firstModel,
            apiKey: hasKey ? p.apiKey : '',
            _priority: hasKey ? 0 : 1, // 有 key 的优先
          });
        }
      }
    } catch {}
    // 按优先级排序：有 apiKey 的优先，旁路模型和豆包已经在前面所以不需要排
    candidates.sort((a, b) => (a._priority ?? 0) - (b._priority ?? 0));
    // 清理内部字段
    for (const c of candidates) delete c._priority;
    if (candidates.length === 0) {
      return { error: '无可用模型配置（models.yml 无可用 provider 且豆包 grounding.json 缺失）' };
    }
    let lastErr = null;
    for (const c of candidates) {
      try {
        const result = await callCompletion(c.baseUrl, c.model, c.apiKey, prompt, maxTokens);
        if (result && result.text) {
          return { text: result.text, model: c.name, modelId: c.model };  // 返回实际命中模型，前端可显示
        }
        lastErr = `${c.name}: ${result.error}`;
      } catch (err) {
        lastErr = `${c.name}: ${err.message}`;
      }
    }
    return { error: `所有模型调用失败：${lastErr}` };
  });

  // ── 旁路模型配置（bypass-model.json：AI 重命名 / 压缩总结 / 轻量补全 三处共用） ──
  ipcMain.handle('settings:getBypassModel', async () => {
    try {
      const p = path.join(PORTABLE_ROOT, 'data', 'agent', 'bypass-model.json');
      if (!fs.existsSync(p)) return { enabled: false, baseUrl: '', apiKey: '', model: '', ts: 0 };
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('settings:saveBypassModel', async (event, cfg) => {
    try {
      const p = path.join(PORTABLE_ROOT, 'data', 'agent', 'bypass-model.json');
      const clean = {
        baseUrl: String((cfg && cfg.baseUrl) || '').trim(),
        apiKey: String((cfg && cfg.apiKey) || '').trim(),
        model: String((cfg && cfg.model) || '').trim(),
        enabled: !!(cfg && cfg.enabled),
        ts: Date.now(),
      };
      fs.writeFileSync(p, JSON.stringify(clean, null, 2), 'utf8');
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ── MCP 模型配置（computer-use grounding.json：ui_tars 视觉定位点击） ──
  ipcMain.handle('settings:getGroundingModel', async () => {
    try {
      const p = path.join(PORTABLE_ROOT, 'data', 'agent', 'managed-skills', 'computer-use', 'grounding.json');
      if (!fs.existsSync(p)) return { enabled: false, api_base: '', api_key: '', model: '' };
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('settings:saveGroundingModel', async (event, cfg) => {
    try {
      const p = path.join(PORTABLE_ROOT, 'data', 'agent', 'managed-skills', 'computer-use', 'grounding.json');
      const clean = {
        api_base: String((cfg && cfg.api_base) || '').trim(),
        api_key: String((cfg && cfg.api_key) || '').trim(),
        model: String((cfg && cfg.model) || '').trim(),
        enabled: (cfg && cfg.enabled) ? '1' : '0',
      };
      fs.writeFileSync(p, JSON.stringify(clean, null, 2), 'utf8');
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ── 模型健康检查（旁路 / MCP 共用）：验证 endpoint 可达 + model 可用 ──
  ipcMain.handle('settings:checkModelHealth', async (event, arg) => {
    const u = String((arg && arg.baseUrl) || '').trim().replace(/\/$/, '');
    const k = String((arg && arg.apiKey) || '').trim();
    const model = String((arg && arg.model) || '').trim();
    if (!u || !model) return { ok: false, status: 0, detail: 'Base URL 与 Model ID 必填' };
    // models.yml 本地模型 apiKey 惯例为 "none"，与 callCompletion 口径一致，不发送假认证头
    const auth = k && k !== 'EMPTY' && k !== 'none' ? { Authorization: `Bearer ${k}` } : {};
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(`${u}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const text = await r.text().catch(() => '');
      if (r.ok) return { ok: true, status: r.status, detail: '模型可达且响应正常' };
      return { ok: false, status: r.status, detail: ((text || '').slice(0, 240)) || `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, status: 0, detail: '网络不可达或请求超时: ' + (e && e.message ? e.message : String(e)) };
    }
  });

  // ── 列出归档的会话（单会话级别）
  ipcMain.handle('sessions:listArchivedSessions', async (event, projectDirName) => {
    try {
      const archiveProjectDir = path.join(ARCHIVE_DIR, projectDirName);
      if (!fs.existsSync(archiveProjectDir)) return [];
      const files = fs.readdirSync(archiveProjectDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort();
      const sessions = [];
      for (const file of files) {
        sessions.push(parseSessionHeader(path.join(archiveProjectDir, file)));
      }
      return sessions;
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 恢复归档的会话 ──
  ipcMain.handle('sessions:restoreSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      // 从归档路径反推项目 dirName
      const archiveDir = path.dirname(resolved);
      const dirName = path.basename(archiveDir);
      const activeProjectDir = path.join(SESSIONS_DIR, dirName);
      if (!fs.existsSync(activeProjectDir)) {
        fs.mkdirSync(activeProjectDir, { recursive: true });
      }
      const destPath = path.join(activeProjectDir, path.basename(resolved));
      let finalDest = destPath;
      if (fs.existsSync(finalDest)) {
        finalDest = path.join(activeProjectDir, path.basename(resolved, '.jsonl') + '-' + Date.now() + '.jsonl');
      }
      fs.renameSync(resolved, finalDest);
      return { success: true, restoredPath: finalDest };
    } catch (err) {
      return { error: err.message };
    }
  });
  // ── 永久删除归档的会话（单会话级别，幂等）──
  ipcMain.handle('sessions:deleteArchivedSession', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl')) {
        return { error: 'Session file not found' };
      }
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
      // 幂等：文件已不存在也视为成功
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 读取用户消息列表（用于分支功能） ──
  ipcMain.handle('sessions:getUserEntries', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      const text = fs.readFileSync(resolved, 'utf8');
      const lines = text.split('\n').filter(l => l.trim());
      const entries = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.message && obj.message.role === 'user') {
            let text = '';
            if (typeof obj.message.content === 'string') text = obj.message.content;
            else if (Array.isArray(obj.message.content)) {
              text = obj.message.content.filter(c => c.type === 'text').map(c => c.text).join('');
            }
            if (text) entries.push({ id: obj.message.id || String(entries.length), text: text.substring(0, 200) });
          }
        } catch {}
      }
      return { entries };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── 导出会话为 HTML ──
  ipcMain.handle('sessions:exportHtml', async (event, sessionPath) => {
    try {
      const resolved = path.resolve(sessionPath);
      if (!resolved.endsWith('.jsonl') || !fs.existsSync(resolved)) {
        return { error: 'Session file not found' };
      }
      const text = fs.readFileSync(resolved, 'utf8');
      const lines = text.split('\n').filter(l => l.trim());
      let htmlParts = ['<!DOCTYPE html><html><head><meta charset="UTF-8"><title>对话导出</title>',
        '<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px;}',
        '.msg{margin:12px 0;padding:12px;border-radius:8px;}',
        '.user{background:#e8f0fe;} .assistant{background:#f5f5f5;}',
        '.role{font-weight:bold;font-size:12px;color:#666;margin-bottom:4px;}',
        '.time{font-size:11px;color:#999;float:right;}',
        'pre{background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;overflow-x:auto;}',
        '</style></head><body>'];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.message) {
            const msg = obj.message;
            let content = '';
            if (typeof msg.content === 'string') content = msg.content;
            else if (Array.isArray(msg.content)) {
              content = msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            }
            if (!content) continue;
            const role = msg.role === 'user' ? '你' : '助手';
            const time = obj.timestamp ? new Date(obj.timestamp).toLocaleString() : '';
            const escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
            htmlParts.push(`<div class="msg ${msg.role}"><div class="role">${role}<span class="time">${time}</span></div><div>${escaped}</div></div>`);
          }
        } catch {}
      }
      htmlParts.push('</body></html>');
      const desktopPath = path.join(require('os').homedir(), 'Desktop');
      const sessionName = path.basename(resolved, '.jsonl').substring(0, 30);
      const exportPath = path.join(desktopPath, `对话导出-${sessionName}-${Date.now()}.html`);
      fs.writeFileSync(exportPath, htmlParts.join('\n'), 'utf8');
      return { success: true, path: exportPath };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── removedCwds：防止已删除的项目被自动发现复活 ──
  // （readRemovedCwds / writeRemovedCwds 已在上方模块级定义）

  ipcMain.handle('sessions:getRemovedCwds', async () => readRemovedCwds());
  ipcMain.handle('sessions:addRemovedCwd', async (event, cwd) => {
    const list = readRemovedCwds();
    const normalized = path.resolve(cwd).toLowerCase();
    if (!list.includes(normalized)) { list.push(normalized); writeRemovedCwds(list); }
    return { success: true };
  });
  ipcMain.handle('sessions:removeRemovedCwd', async (event, cwd) => {
    const list = readRemovedCwds();
    const normalized = path.resolve(cwd).toLowerCase();
    writeRemovedCwds(list.filter(c => c !== normalized));
    return { success: true };
  });

  // ── 全局记忆召回：跨项目语义检索（bun wide-recall CLI，与 agent 的 wide_recall MCP 同源）──
  ipcMain.handle('memory:recall', async (event, query) => {
    const q = (query || '').trim();
    if (!q) return { results: [], error: '空查询' };
    try {
      const bunExe = path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', 'bun', 'bin', 'bun.exe');
      const cliScript = path.join(AGENT_DIR, 'mcp-servers', 'wide-recall.ts');
      const { execFileSync } = require('child_process');
      const output = execFileSync(bunExe, [cliScript, '--query', q, '--limit', '20'], {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR, PORTABLE_ROOT },
      });
      const parsed = JSON.parse(output.trim()) as { results?: unknown[] };
      return { results: Array.isArray(parsed.results) ? parsed.results : [] };
    } catch (err) {
      console.error('[memory:recall] error:', err.message);
      return { results: [], error: err.message };
    }
  });

  // ── AI 身份 / 用户称呼：记忆系统配置 ──
  // AI.md 存 AI 名字（扩展 before_agent_start 注入 system prompt）；
  // USER.md 的「称呼」存对用户的称呼。两者任一为空 → 前端首次启动弹设置框。
  const MEMORY_DIR = path.join(PORTABLE_ROOT, 'data', 'memory');
  const AI_MD = path.join(MEMORY_DIR, 'AI.md');
  const USER_MD = path.join(MEMORY_DIR, 'USER.md');

  // 从 markdown 字段行 `- 字段名：值` / `- 字段名: 值` 提取 value
  function parseMdField(content, field) {
    if (!content) return '';
    const re = new RegExp('^[ \\t]*-[ \\t]*' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*[:：][ \\t]*(.+?)[ \\t]*$', 'm');
    const m = content.match(re);
    return m ? m[1].trim() : '';
  }

  // 提取 AI.md 中的「角色卡」多行块（## 角色卡 标题到文件尾，去首尾空白）
  // 注意 m 标志：标题位于 # AI 身份 之后，^ 需锚定行首而非字符串开头
  function parsePersonaCard(content) {
    if (!content) return '';
    const m = content.match(/^##\s*角色卡\s*\n([\s\S]*)$/m);
    if (!m) return '';
    return m[1].replace(/^\s*\n+|[ \t\n]+$/g, '').trim();
  }

  ipcMain.handle('memory:getIdentity', async () => {
    try {
      const aiContent = fs.existsSync(AI_MD) ? fs.readFileSync(AI_MD, 'utf8') : '';
      const userContent = fs.existsSync(USER_MD) ? fs.readFileSync(USER_MD, 'utf8') : '';
      const aiName = parseMdField(aiContent, '名字');
      const gender = parseMdField(aiContent, '性别');
      const persona = parsePersonaCard(aiContent);
      const userName = parseMdField(userContent, '称呼');
      return {
        aiName,
        gender,
        persona,
        userName,
        needsSetup: (!aiName || !userName),
      };
    } catch (err) {
      return { aiName: '', gender: '', persona: '', userName: '', needsSetup: true, error: err.message };
    }
  });

  ipcMain.handle('memory:saveIdentity', async (event, aiName, userName, gender, persona) => {
    try {
      const name = (aiName || '').trim();
      const title = (userName || '').trim();
      const newGender = (gender || '').trim();
      const newPersona = (persona || '').trim();
      if (!name && !title) return { ok: false, error: '名字与称呼不能都为空' };

      // 写 AI.md（整体覆盖，结构固定；未显式更新的性别/角色卡保留旧值）
      if (name) {
        const prevAi = fs.existsSync(AI_MD) ? fs.readFileSync(AI_MD, 'utf8') : '';
        const prevGender = parseMdField(prevAi, '性别');
        const prevPersona = parsePersonaCard(prevAi);
        const finalGender = newGender || prevGender;
        const finalPersona = newPersona || prevPersona;
        const aiMd = [
          '# AI 身份',
          '',
          `- 名字：${name}`,
          ...(finalGender ? [`- 性别：${finalGender}`] : []),
          '- 定位：你的桌面 AI 助手，陪你写代码、想方案、管记忆。',
          '',
          ...(finalPersona ? ['## 角色卡', '', finalPersona, ''] : []),
        ].join('\n');
        fs.writeFileSync(AI_MD, aiMd, 'utf8');
      }

      // 更新 USER.md 的「称呼」字段（保留其余内容）
      if (title) {
        let userContent = fs.existsSync(USER_MD) ? fs.readFileSync(USER_MD, 'utf8') : '# 用户档案\n\n- 称呼：\n';
        if (/^\s*-\s*称呼\s*[:：]/.test(userContent)) {
          userContent = userContent.replace(/^(\s*-\s*称呼\s*[:：]\s*).*$/m, `$1${title}`);
        } else {
          // 在「# 用户档案」标题后插入，否则追加到末尾
          if (/^#\s*用户档案\s*$/m.test(userContent)) {
            userContent = userContent.replace(/^(#\s*用户档案\s*$)/m, `$1\n\n- 称呼：${title}`);
          } else {
            userContent = userContent.trimEnd() + `\n\n- 称呼：${title}\n`;
          }
        }
        fs.writeFileSync(USER_MD, userContent, 'utf8');
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}



// ── App Lifecycle ──

// 单实例锁：禁止双开。双实例会竞争同一批会话目录：互相 kill 实例（命令超时）、
// 一方把另一方新建的会话文件当孤儿清理（对话丢失）、事件路由串台（回复进错对话）。
// 后启动的实例直接退出；已有实例收到二次启动时聚焦主窗口。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      const win = wins[0];
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
// ── ask 多题对话框协议自愈：给内核 RPC UI 适配器补 askDialog 方法 ──
// 背景：ask 工具多问有原生富对话框通道（context.ui.askDialog），但 rpc-ui 模式下内核 RPC
// 适配器只实现了 select/confirm/input/editor，多问被降级成逐题 select（桌面端一题一题弹）。
// 此处在 cli.js 的唯一锚点（RPC UI 类的 select 方法）后注入一个 askDialog 方法，
// 整批 questions 一次下发，渲染层同屏作答后一次性回传 results。
// 内核升级后锚点漂移则仅告警：不阻断启动，退回逐题流程（功能降级不坏）。
const ASK_DIALOG_MARKER = 'method:"askDialog"';
const ASK_DIALOG_ANCHOR = 'select(v,P,I){return wZs(this.pendingRequests,this.output,v,P,I)}';
// 锚点版本表：17.2.2 = select(d,A,C){return YEn(...)}；18.0.6 = select(v,P,I){return wZs(this.pendingRequests,this.output,v,P,I)}
// （18.0.6 把 select 重构为顶层函数 wZs 委托，分派函数 YEn→O5e，选项映射 R8n→Qle；
//  内核 RPC 包装器 Uoi 原生识别 e.askDialog 并以 s.call(e,...) 绑定 this，ask 工具裸引用调用，
//  故 askDialog 必须保持箭头函数类字段；返回契约：{kind:"submit",results:[{id,selectedOptions,...}]} 或 {kind:"chat"}）
// 注意两点：
// 1) 必须是箭头函数类字段——ask 工具把 ui.askDialog 取成裸引用后直接调用（this 会丢失），
//    普通方法形式会抛 "undefined is not an object (evaluating 'this.pendingRequests')"。
// 2) 类字段后必须跟分号——minified 上下文中 `askDialog=(d,A)=>...confirm(...)` 无分号是语法错误
//    （esbuild: Expected ";" but found "confirm"）。
const ASK_DIALOG_INSERT = 'askDialog=(d,A)=>O5e(this.pendingRequests,this.output,A,void 0,{method:"askDialog",title:"请回答以下问题",questions:d,timeout:A?A.timeout:void 0},(N)=>{if(N&&"cancelled"in N&&N.cancelled)return;if(N&&N.value&&(N.value.kind==="chat"||(N.value.kind==="submit"&&Array.isArray(N.value.results))))return N.value;});';

function healKernelAskDialog(): void {
  try {
    const cliJs = path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', '@oh-my-pi', 'pi-coding-agent', 'dist', 'cli.js');
    if (!fs.existsSync(cliJs)) return;
    let s = fs.readFileSync(cliJs, 'utf8');
    const bak = cliJs + '.bak-askdialog';
    const GOOD_TAIL = 'return N.value;});'; // v3 补丁尾（箭头字段 + 分号）
    if (s.includes(GOOD_TAIL)) { console.log('[kernel-heal] askDialog already patched, skip'); return; } // 已是正确版本，跳过
    if (s.includes(ASK_DIALOG_MARKER)) {
      // 存在旧版/坏补丁（v1 方法形式 this 丢失 / v2 缺尾分号语法错）→ 从备份恢复原件后重打
      if (!fs.existsSync(bak) || fs.readFileSync(bak, 'utf8').includes(ASK_DIALOG_MARKER)) {
        console.warn('[kernel-heal] 检测到旧版 askDialog 补丁且无干净备份，跳过（多问 ask 可能异常，需人工恢复内核）');
        return;
      }
      s = fs.readFileSync(bak, 'utf8');
      console.log('[kernel-heal] 旧版 askDialog 补丁已从备份恢复原件');
    }
    const i = s.indexOf(ASK_DIALOG_ANCHOR);
    if (i === -1) {
      console.warn('[kernel-heal] askDialog 锚点未找到（内核版本可能变化），多问 ask 退回逐题回答');
      return;
    }
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, s, 'utf8'); // 原件仅备份一次
    const next = s.slice(0, i + ASK_DIALOG_ANCHOR.length) + ASK_DIALOG_INSERT + s.slice(i + ASK_DIALOG_ANCHOR.length);
    fs.writeFileSync(cliJs, next, 'utf8');
    console.log('[kernel-heal] askDialog patched ->', cliJs);
  } catch (e) {
    console.warn('[kernel-heal] askDialog 打补丁失败（退回逐题回答）:', (e as Error).message);
  }
}
// ── 自愈：延长内核扩展 handler 超时（30s → 120s）──
// session_before_compact 钩子内同步跑旁路总结（最坏 35-46s），内核默认 30s 会 abort 钩子
// 并放弃结果，导致压缩降级到内核自压。延长到 120s 让钩子有时间完成 ③ 旁路结构化总结。
// 幂等：已打标记则跳过。内核升级后 dist/cli.js 被覆盖，本函数每次启动自动重打。
function healKernelExtensionHandlerTimeout(): void {
  try {
    const cliJs = path.join(PORTABLE_ROOT, 'npm-global', 'node_modules', '@oh-my-pi', 'pi-coding-agent', 'dist', 'cli.js');
    if (!fs.existsSync(cliJs)) return;
    const m = '/*TIFFA_EXT_HANDLER_TIMEOUT_120000*/';
    let src = fs.readFileSync(cliJs, 'utf8');
    if (src.includes(m)) return; // 已打
    const anchor = 'var Xle=30000,';
    const idx = src.indexOf(anchor);
    if (idx < 0) { console.warn('[kernel-heal] extension-handler-timeout 锚点未找到（内核版本可能变化），跳过'); return; }
    const newSrc = src.slice(0, idx) + 'var Xle=120000' + m + ',' + src.slice(idx + anchor.length);
    fs.writeFileSync(cliJs, newSrc, 'utf8');
    mainLog('[kernel-heal] 内核扩展 handler 超时 30s -> 120s（session_before_compact 旁路总结需要更长窗口）');
  } catch (e) {
    console.warn('[kernel-heal] extension-handler-timeout 打补丁失败:', (e as Error).message);
  }
}



app.whenReady().then(() => {
  healKernelExtensionHandlerTimeout();
  healKernelAskDialog();
  setupIpc();
  mainWindow = createWindow();
  // 懒启动：不在此处启动 Tiffa，等前端 loadProjects 切换项目时再 activate
  //（此处不再 activate 默认工作区，避免启动时创建两个 Tiffa 实例）

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

// 优雅关机标记：before-quit 会被 app.quit() 重复触发，靠它避免重入与二次强杀
let gracefulShutdownStarted = false;

app.on('window-all-closed', () => {
  // 不再直接强杀——交给 before-quit 统一走内核 EOF 优雅 drain + dispose
  app.quit();
});

app.on('before-quit', (e) => {
  globalShortcut.unregisterAll(); // 窗口快照热键清理
  if (gracefulShutdownStarted) return;        // 第二次（app.quit 再次触发）直接放行退出
  gracefulShutdownStarted = true;
  e.preventDefault();                          // 先拦住，等内核 drain+dispose 自退后再 quit

  const instances = [...tiffaManager.instances.values()].filter(i => i.process && i.process.pid);
  let pending = instances.length;

  const finish = () => {
    if (pending > 0) return;
    clearTimeout(forceKillTimer);
    app.quit();
  };

  // 兜底：3 秒内没退干净就强制 kill，避免关机卡死
  const forceKillTimer = setTimeout(() => {
    tiffaManager.killAll();
    app.quit();
  }, 5000);

  if (pending === 0) { clearTimeout(forceKillTimer); app.quit(); return; }

  for (const inst of instances) {
    const p = inst.process;
    // 已经退出的实例不计入等待
    if (p.exitCode !== null || p.signalCode !== null) { pending--; continue; }
    try {
      p.stdin.write(JSON.stringify({ type: 'abort' }) + '\n');   // 取消在途生成
    } catch { /* ignore */ }
    try {
      p.stdin.end();                                            // 关键：EOF → 内核走 drain+session.dispose 自退
    } catch { /* ignore */ }
    p.on('exit', () => { pending--; finish(); });
  }
  finish();
});

// ── 测试导出：Electron 运行时此对象未被使用，仅供 node 单测加载 ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TiffaInstance, TiffaInstanceManager, tiffaManager, readTailLines, parseSessionLines };
}
