#!/usr/bin/env node
/**
 * html2pdf — 把 HTML 文件渲染成 PDF
 *
 * 用途：演示文稿/报告/文档导出 PDF
 * 技术：playwright-core + 系统 Edge/Chrome 的 print-to-PDF
 *
 * 用法：
 *   node html2pdf.js <input.html> [--output out.pdf] [--format A4] [--landscape]
 *
 * 参数：
 *   input.html     必填，输入的 HTML 文件路径
 *   --output       输出 PDF 路径（默认 input 同目录同名 .pdf）
 *   --format       纸张格式：A4 / A3 / Letter（默认 A4）
 *   --landscape    横向（默认 false）
 *   --margin       页边距 px（默认 0）
 *   --wait         加载后等待毫秒数（默认 800）
 *
 * 退出码：0 成功，1 失败
 */
"use strict";

const path = require("path");
const fs = require("fs");

function resolvePortableRoot() {
  if (process.env.PORTABLE_ROOT) return process.env.PORTABLE_ROOT;
  return path.resolve(__dirname, "..", "..", "..");
}

function findPlaywrightCore() {
  const candidates = [
    path.join(__dirname, "..", "node_modules", "playwright-core"),
    path.join(process.env.PORTABLE_ROOT || resolvePortableRoot(), "skills", "dashiai-ppt", "project", "node_modules", "playwright-core"),
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
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* skip */ }
  }
  return null;
}

function parseArgs(argv) {
  const args = { _: [], format: "A4", landscape: false, margin: "0", wait: 800 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--output") args.output = argv[++i];
    else if (a === "--format") args.format = argv[++i];
    else if (a === "--landscape") args.landscape = true;
    else if (a === "--margin") args.margin = argv[++i];
    else if (a === "--wait") args.wait = parseInt(argv[++i], 10);
    else if (!a.startsWith("--")) args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length === 0) {
    console.error("用法: node html2pdf.js <input.html> [--output out.pdf] [--format A4] [--landscape]");
    process.exit(1);
  }

  const input = path.resolve(args._[0]);
  if (!fs.existsSync(input)) {
    console.error(`输入文件不存在: ${input}`);
    process.exit(1);
  }

  const output = args.output ? path.resolve(args.output) : input.replace(/\.html?$/i, ".pdf");
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
  console.log(`[html2pdf] 输入: ${input}`);
  console.log(`[html2pdf] 输出: ${output}`);

  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    if (args.wait > 0) await page.waitForTimeout(args.wait);

    await page.pdf({
      path: output,
      format: args.format,
      landscape: args.landscape,
      margin: { top: args.margin, bottom: args.margin, left: args.margin, right: args.margin },
      printBackground: true,
    });

    const size = fs.statSync(output).size;
    console.log(`[html2pdf] 完成: ${output} (${size} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
