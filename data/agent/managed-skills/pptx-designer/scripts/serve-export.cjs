#!/usr/bin/env node
/**
 * pptx-designer serve-export.cjs — 一键导出服务（编辑器内导出 PPTX/PDF 的后端）
 *
 * 编辑器（editor.html）是纯静态 file:// 页面，无法自行调用导出引擎；
 * 本服务提供本地 HTTP 接口，接收编辑器的最新 DECK 状态，渲染 deck HTML，
 * 用系统 Edge/Chrome（playwright-core）+ html-deck-to-pptx 引擎导出
 * 可编辑 .pptx / PDF 到项目 output/ 目录。
 *
 * 用法:
 *   node scripts/serve-export.cjs [--port 47832]
 *
 * API:
 *   GET  /api/health            → { ok: true, engine: 'pptx-designer' }
 *   POST /api/export            → body: { deck: {design,pages}, format: 'pptx'|'pdf', outDir }
 *                                → 200 { ok, file, format }
 *                                → 500 { error }
 *   CORS 全开（file:// 页面 Origin: null 也能调用）
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { renderDeckHtml } = require(path.join(__dirname, 'export', 'deck-render.cjs'));

const DEFAULT_PORT = 47832;
const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return parseInt((i >= 0 ? process.argv[i + 1] : process.env.PPTX_EXPORT_PORT) || String(DEFAULT_PORT), 10);
})();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json;charset=utf-8', ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', d => { raw += d; if (raw.length > 50 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Malformed JSON: ' + e.message)); } });
    req.on('error', reject);
  });
}

/** 执行导出：渲染 deck → playwright 打开 → 引擎导出 → 返回产物绝对路径 */
async function doExport(deck, format, outDir) {
  if (!deck || !Array.isArray(deck.pages) || deck.pages.length === 0) {
    throw new Error('deck 无效：缺少 pages（至少一页）');
  }
  if (format !== 'pptx' && format !== 'pdf') throw new Error('format 仅支持 pptx / pdf');

  const outDirResolved = path.resolve(outDir);
  fs.mkdirSync(outDirResolved, { recursive: true });
  const exportTmp = path.join(outDirResolved, '.export');
  fs.mkdirSync(exportTmp, { recursive: true });

  // 1. 渲染纯 deck HTML（图片已内联 base64，自包含）
  const html = renderDeckHtml(deck);
  const deckHtml = path.join(exportTmp, 'deck-export.html');
  fs.writeFileSync(deckHtml, html, 'utf8');
  const deckUrl = 'file:///' + deckHtml.replace(/\\/g, '/');

  // 2. 启动导出浏览器（系统 Edge/Chrome，含沙箱/临时目录保险丝）
  const [{ chromium }, { launchExportBrowser }, engine] = await Promise.all([
    import('playwright-core'),
    import(pathToFileURL(path.join(__dirname, 'export', 'launch-export-browser.mjs')).href),
    format === 'pdf'
      ? import('../vendor/html-deck-to-pptx/src/screenshot.mjs')
      : import('../vendor/html-deck-to-pptx/src/editable.mjs'),
  ]);

  const outFile = path.join(outDirResolved, `deck.${format === 'pdf' ? 'pdf' : 'pptx'}`);
  const browser = await launchExportBrowser(chromium, {
    fallbackTmpDirs: [exportTmp],
    log: m => console.warn(m),
  });
  try {
    const opts = { outFile, title: (deck.design && deck.design.title) || 'PPT' };
    if (format === 'pdf') {
      await engine.exportScreenshotPdfFromUrl(browser, deckUrl, opts);
    } else {
      await engine.exportEditablePptxFromUrl(browser, deckUrl, opts);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (!fs.existsSync(outFile)) throw new Error('导出失败：引擎未产出文件');
  return outFile;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    if (req.method === 'GET' && url.pathname === '/api/health') { json(res, 200, { ok: true, engine: 'pptx-designer-export' }); return; }
    if (req.method === 'POST' && url.pathname === '/api/export') {
      const body = await readBody(req);
      const outFile = await doExport(body.deck, body.format, body.outDir);
      json(res, 200, { ok: true, file: outFile, format: body.format });
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[serve-export]', e);
    json(res, 500, { error: (e && e.message) || String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ pptx-designer 导出服务已启动: http://127.0.0.1:${PORT}/api/health`);
  console.log(`   编辑器内「导出 PPTX/PDF」按钮将自动调用本服务（端口 ${PORT}）`);
});
