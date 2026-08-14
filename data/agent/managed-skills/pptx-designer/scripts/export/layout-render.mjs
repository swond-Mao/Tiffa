#!/usr/bin/env node
/**
 * pptx-designer layout-render.mjs — dashiai 页级模板渲染器
 *
 * 页面定义 { layout: 'theme01_page006', data: {...} } → 静态 HTML。
 * 复用 dashiai 主题运行时（vendor/theme-runtime/*.module.mjs）：
 *   - runtimePages[i] = { key, Component, defaultProps, controls, ... }
 *   - props = { ...defaultProps, ...data }（AI 的 data 覆盖默认内容）
 *   - renderToStaticMarkup 服务端渲染（无需浏览器）
 *   - 主题 CSS 通过 document stub 捕获（组件渲染时注入 <style>）
 */
'use strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEME_RUNTIME_DIR = path.resolve(HERE, '..', '..', 'vendor', 'theme-runtime');

/* ── 主题 CSS 捕获（document stub） ───────────────────── */
let cssInstalled = false;
const themeCssCache = new Map(); // themeId → css 字符串

function installCssCapture() {
  if (cssInstalled) return;
  cssInstalled = true;
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
      getElementById() { return null; },
      createElement(tag) {
        if (tag === 'style') {
          return {
            id: '', textContent: '',
            set id(v) { this._id = v; },
            get id() { return this._id; },
          };
        }
        return {};
      },
      head: { appendChild(el) { if (el.textContent) captureCss(el._id, el.textContent); } },
    };
  }
}

function captureCss(styleId, css) {
  // 记录主题 CSS：theme-runtime 注入的 style id 如 aip-theme
  if (!css || !styleId) return;
  themeCssCache.set(`#${styleId}`, css);
}

/* ── 主题运行时加载（懒加载 + 缓存） ──────────────────── */
const runtimeCache = new Map(); // themeId → runtimePages

async function loadThemeRuntime(themeId) {
  if (!/^theme\d{2}$/.test(themeId)) throw new Error(`无效主题 ID: ${themeId}`);
  if (runtimeCache.has(themeId)) return runtimeCache.get(themeId);
  const modPath = path.join(THEME_RUNTIME_DIR, `${themeId}.module.mjs`);
  if (!fs.existsSync(modPath)) throw new Error(`主题运行时不存在: ${modPath}`);
  const mod = await import(pathToFileURL(modPath).href);
  const pages = mod.runtimePages || {};
  runtimeCache.set(themeId, pages);
  return pages;
}

/* ── 公共 API ─────────────────────────────────────────── */

/**
 * 渲染一个模板页。
 * @param {string} layoutKey 如 'theme01_page006'
 * @param {object} [data] AI 填充的内容（覆盖 defaultProps）
 * @returns {Promise<{html: string, css: string, meta: object}>}
 */
export async function renderLayoutPage(layoutKey, data) {
  const m = String(layoutKey).match(/^(theme\d{2})_page(\d+)$/);
  if (!m) throw new Error(`layout key 格式应为 themeXX_pageNNN: ${layoutKey}`);
  const themeId = m[1];
  const pageNum = parseInt(m[2], 10);

  installCssCapture();
  const pages = await loadThemeRuntime(themeId);
  const page = pages[String(pageNum - 1)];
  if (!page || !page.Component) throw new Error(`布局不存在: ${layoutKey}（${themeId} 共 ${Object.keys(pages).length} 页）`);

  const props = { ...(page.defaultProps || {}), ...(data || {}) };
  const html = renderToStaticMarkup(React.createElement(page.Component, props));

  // 收集本主题 CSS（渲染时已注入捕获）
  const css = [...themeCssCache.values()].join('\n');
  return { html, css, meta: { key: page.key, label: page.label, slot: page.slot, themeId } };
}

/**
 * 解析 layout key → 主题 + 页号 + 页面元数据（供 catalog/编辑器标注用）
 */
export async function describeLayout(layoutKey) {
  const m = String(layoutKey).match(/^(theme\d{2})_page(\d+)$/);
  if (!m) return null;
  const themeId = m[1];
  const pageNum = parseInt(m[2], 10);
  const pages = await loadThemeRuntime(themeId);
  const page = pages[String(pageNum - 1)];
  if (!page) return null;
  return { key: page.key, themeId, label: page.label, slot: page.slot, layout: page.layout };
}

/** CLI：node layout-render.mjs theme01_page006 -d data.json -o out.html */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [layoutKey, dataFile, outFile] = process.argv.slice(2);
  const data = dataFile ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : {};
  const out = outFile || 'layout-render.html';
  const { html, css } = await renderLayoutPage(layoutKey, data);
  const full = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body><div id="deck"><div class="slide" style="width:1280px;height:720px;position:relative;overflow:hidden">${html}</div></div></body></html>`;
  fs.writeFileSync(out, full, 'utf8');
  console.log(`✅ 已渲染 ${layoutKey} → ${out}（HTML ${html.length}B，CSS ${css.length}B）`);
}
