#!/usr/bin/env node
/**
 * html2png — 把 HTML 文件渲染成 PNG 图片
 *
 * 用途：海报/设计稿/网页导出图片（发朋友圈、社媒、分享）
 * 技术：playwright-core + 系统 Edge/Chrome，无额外浏览器下载
 *
 * 用法：
 *   node html2png.js <input.html> [--output out.png] [--width 1080] [--height 1440] [--selector "#poster"]
 *
 * 参数：
 *   input.html     必填，输入的 HTML 文件路径
 *   --output      输出 PNG 路径（默认 input 同目录同名 .png）
 *   --width       视口宽度（默认 1080）
 *   --height      视口高度（默认 1440，自动缩放时用）
 *   --selector    只截图页面中匹配 CSS 选择器的元素（默认整页）
 *   --full-page   截整页（滚动拼接，默认 false）
 *   --scale       设备像素比（默认 2，高清）
 *   --wait        加载后等待毫秒数（默认 800，等动画/图表渲染）
 *
 * 退出码：0 成功，1 失败
 */
"use strict";

const path = require("path");
const fs = require("fs");

// ── 便携包环境探测 ──
function resolvePortableRoot() {
  if (process.env.PORTABLE_ROOT) return process.env.PORTABLE_ROOT;
  // 从本文件位置推导：<root>/data/agent/managed-skills/shared-visual-components/tools/html2png.js（5 级）
  return path.resolve(__dirname, "..", "..", "..", "..", "..");
}

function findPlaywrightCore() {
  const candidates = [
    // 组件库自带（若未来 npm i）
    path.join(__dirname, "..", "node_modules", "playwright-core"),
    // dashiai-ppt 项目内（已知存在）
    path.join(process.env.PORTABLE_ROOT || resolvePortableRoot(), "data", "agent", "managed-skills", "dashiai-ppt", "project", "node_modules", "playwright-core"),
  ];
  for (const c of candidates) {
    try { require(c); return c; } catch (e) { /* try next */ }
  }
  return null;
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    process.env.PORTABLE_ROOT ? path.join(process.env.PORTABLE_ROOT, "chrome", "chrome.exe") : null,
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* skip */ }
  }
  return null;
}

function parseArgs(argv) {
  const args = { _: [], width: 1080, height: 1440, scale: 2, wait: 800, fullPage: false, selector: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--output") args.output = argv[++i];
    else if (a === "--width") args.width = parseInt(argv[++i], 10);
    else if (a === "--height") args.height = parseInt(argv[++i], 10);
    else if (a === "--scale") args.scale = parseInt(argv[++i], 10);
    else if (a === "--wait") args.wait = parseInt(argv[++i], 10);
    else if (a === "--selector") args.selector = argv[++i];
    else if (a === "--full-page") args.fullPage = true;
    else if (!a.startsWith("--")) args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length === 0) {
    console.error("用法: node html2png.js <input.html> [--output out.png] [--width 1080] [--height 1440] [--selector '#poster']");
    process.exit(1);
  }

  const input = path.resolve(args._[0]);
  if (!fs.existsSync(input)) {
    console.error(`输入文件不存在: ${input}`);
    process.exit(1);
  }

  const output = args.output ? path.resolve(args.output) : input.replace(/\.html?$/i, ".png");
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const pwPath = findPlaywrightCore();
  if (!pwPath) {
    console.error("未找到 playwright-core，请确认 dashiai-ppt 项目已安装依赖");
    process.exit(1);
  }
  const { chromium } = require(pwPath);

  const browserPath = findBrowser();
  if (!browserPath) {
    console.error("未找到 Chrome/Edge 浏览器");
    process.exit(1);
  }

  const url = "file:///" + input.replace(/\\/g, "/");

  console.log(`[html2png] 输入: ${input}`);
  console.log(`[html2png] 输出: ${output}`);
  console.log(`[html2png] 视口: ${args.width}x${args.height}, scale=${args.scale}`);

  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: args.scale,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(url, { waitUntil: "networkidle" });
    if (args.wait > 0) await page.waitForTimeout(args.wait);

    let buffer;
    if (args.selector) {
      const el = await page.$(args.selector);
      if (!el) {
        console.error(`未找到选择器: ${args.selector}`);
        process.exit(1);
      }
      buffer = await el.screenshot({ path: output });
    } else {
      buffer = await page.screenshot({ path: output, fullPage: args.fullPage });
    }

    console.log(`[html2png] 完成: ${output} (${buffer.length} bytes)`);
    if (errors.length) {
      console.warn(`[html2png] 页面错误 ${errors.length} 条:`);
      errors.slice(0, 5).forEach((e) => console.warn("  -", e));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
