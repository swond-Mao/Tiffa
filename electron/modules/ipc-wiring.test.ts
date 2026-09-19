/**
 * IPC 七层接线一致性（架构守卫测试）
 *
 * 加一个主进程级功能要同时改 7 处：modules/*.ts → main.ts IPC → main.js（**构建产物**）→
 * preload.js 桥 → renderer d.ts → store/事件路由 → UI。只要漏一处，功能就是静默失效
 * （前端调用一个不存在的桥方法，或直接 undefined 报错）。
 *
 * 本测试把「漏改某一层」变成构建期可发现的失败：
 *   ① preload 里每个 `ipcRenderer.invoke('x')` 都要能在 **main.js 产物**里找到 handler
 *      （不是 main.ts —— 源码改了没重新编译，运行时照样挂）；
 *   ② preload 暴露的每个方法都要在 tiffaDesktop.d.ts 里声明（否则前端 TS 报错或 any 化）；
 *   ③ renderer 里用到的每个 `window.tiffaDesktop.X` 都要在 preload 里暴露。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
const PRELOAD = path.resolve(HERE, '../preload.js');
const MAIN_JS = path.resolve(HERE, '../main.js');
const DTS = path.resolve(HERE, '../renderer/src/types/tiffaDesktop.d.ts');
const RENDERER_SRC = path.resolve(HERE, '../renderer/src');

const preload = fs.readFileSync(PRELOAD, 'utf8');
const mainJs = fs.readFileSync(MAIN_JS, 'utf8');
const dts = fs.readFileSync(DTS, 'utf8');

/**
 * preload 暴露的方法名 / 对象名。
 *
 * ⚠️ 必须从 `contextBridge.exposeInMainWorld('tiffaDesktop', {...})` **内部**取：
 * 文件里还有 marked 之类的配置对象（`highlight: (code, lang) => ...`），
 * 缩进碰巧也是 2 空格，按全文件扫会把它误当成暴露的 API。
 */
function exposedMethods(): string[] {
  const marker = "contextBridge.exposeInMainWorld('tiffaDesktop', {";
  const at = preload.indexOf(marker);
  if (at < 0) throw new Error('preload.js 里找不到 contextBridge.exposeInMainWorld');
  const body = preload.slice(at + marker.length - 1); // 从 `{` 起
  // 顶层键固定 2 空格缩进；嵌套对象里的键是 4 空格及以上
  return [...body.matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
}

/** preload 里 `ipcRenderer.invoke('channel'` 的通道名 */
function invokedChannels(): string[] {
  return [...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]);
}

/** renderer 源码里用到的 window.tiffaDesktop.X */
function usedInRenderer(): Set<string> {
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const t = fs.readFileSync(p, 'utf8');
      for (const m of t.matchAll(/window\.tiffaDesktop\.([A-Za-z_$][\w$]*)/g)) used.add(m[1]);
    }
  };
  walk(RENDERER_SRC);
  return used;
}

describe('IPC 七层接线一致性', () => {
  it('preload 调用的每个通道都在 main.js 产物里有 handler（漏编译 main.ts 会在这里挂）', () => {
    const missing = invokedChannels().filter((ch) => !mainJs.includes(`'${ch}'`));
    expect(missing, `这些通道没有 ipcMain.handle：${missing.join(', ')}`).toEqual([]);
  });

  it('preload 暴露的每个方法都在 tiffaDesktop.d.ts 里声明', () => {
    // d.ts 里方法声明形如 `  methodName: (` 或 `  methodName(`；字段名（非方法）不算
    const undeclared = exposedMethods().filter((m) => !new RegExp(`^\\s{2}${m}\\s*[(:]`, 'm').test(dts));
    expect(undeclared, `d.ts 缺声明：${undeclared.join(', ')}`).toEqual([]);
  });

  it('renderer 用到的每个 window.tiffaDesktop.X 都在 preload 里暴露', () => {
    const exposed = new Set(exposedMethods());
    const missing = [...usedInRenderer()].filter((m) => !exposed.has(m));
    expect(missing, `preload 没暴露：${missing.join(', ')}`).toEqual([]);
  });

  it('d.ts 声明的方法也都要在 preload 里真的暴露（防止声明了不实现）', () => {
    // ⚠️ 只看 TiffaDesktopApi 接口内部：文件里其他接口（GoalActionResult 等）的字段
    // 缩进同样是 2 空格，全文件扫会把 `ok` / `status` 这类字段当成 API 方法。
    const at = dts.indexOf('interface TiffaDesktopApi {');
    if (at < 0) throw new Error('d.ts 里找不到 TiffaDesktopApi');
    const body = dts.slice(at, dts.indexOf('\n}', at));
    const declared = [...body.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*[(:]/gm)].map((m) => m[1]);
    const exposed = new Set(exposedMethods());
    const notImplemented = declared.filter((m) => !exposed.has(m));
    expect(declared.length, 'TiffaDesktopApi 里没解析到任何方法，正则该改了').toBeGreaterThan(10);
    expect(notImplemented, `声明了但 preload 没实现：${notImplemented.join(', ')}`).toEqual([]);
  });
});
