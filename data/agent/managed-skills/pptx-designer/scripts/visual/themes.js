#!/usr/bin/env node
/**
 * pptx-designer themes.js — 主题库（视觉引擎数据源）
 *
 * 主题定义两层：
 *   第一层 palette/font/bg/dark —— 全局设计元（供 build.js 映射 .pptx、CSS 变量）
 *   第二层 slideBundles —— 每类页面的装饰模板（供 preview/editor 铺装饰层）
 *
 * 主题来源：dashiai 12 套风格 DNA（见 references/designs/dashiai-styles.md）
 *           + 3 领域(academic/consulting/redgold) + generic 通用商务浅色
 *
 * 三引擎共享：preview.js / render-editor.js 用 CSS 完整呈现；
 *             build.js 把能映射的渐变/装饰映射为原生形状，不能的降级。
 */
'use strict';

// 主题 ID → 用于给页面 texture 背景生成 CSS 的函数
const THEMES = {
  /* ── dashiai 12 套 ───────────────────────────── */
  theme01: {
    id: 'theme01', name: '轻拟态风', dark: false,
    bg: '#F4F6FA', palette: { primary: '#5B8DEF', accent: '#46B083', warn: '#E8503A', gold: '#E0A23A', purple: '#7A5AE0', text: '#23232A', sub: '#5B6472', line: 'rgba(91,141,239,.2)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: true, radius: 20 },
  },
  theme02: {
    id: 'theme02', name: '炫光紫绿风', dark: true,
    bg: '#07090B', palette: { primary: '#2FE07F', accent: '#4EA2FF', warn: '#FF6FAE', purple: '#9B7DFF', gold: '#4EA2FF', text: '#F8FAFC', sub: '#8A94A6', line: 'rgba(158,125,255,.4)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'radial', decoration: { corner: 'glow', shadow: true, radius: 14 },
  },
  theme03: {
    id: 'theme03', name: '深浅代码风', dark: true,
    bg: '#161513', palette: { primary: '#5F8F0C', accent: '#6E85FF', warn: '#B04A2F', gold: '#84827C', purple: '#6E85FF', text: '#F3F2EE', sub: '#84827C', line: 'rgba(132,130,124,.3)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 6 },
  },
  theme04: {
    id: 'theme04', name: '玻璃糖果风', dark: false,
    bg: '#FDFBFF', palette: { primary: '#15A7F0', accent: '#FFC700', warn: '#FF9FE2', gold: '#FFC700', purple: '#27E021', text: '#06140F', sub: '#4A5A5A', line: 'rgba(21,167,240,.25)' },
    font: { body: '"阿里普惠体","微软雅黑",sans-serif', title: '"阿里普惠体","微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: true, radius: 24 },
  },
  theme05: {
    id: 'theme05', name: '色谱图表风', dark: false,
    bg: '#FFFFFF', palette: { primary: '#D8402E', accent: '#3C9A52', warn: '#4DA0C6', gold: '#EFBE2E', purple: '#7A3C90', text: '#1A1A1A', sub: '#5C6B7A', line: 'rgba(56,122,180,.2)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 8 },
  },
  theme06: {
    id: 'theme06', name: '深色图谱风', dark: true,
    bg: '#26261F', palette: { primary: '#C8F135', accent: '#FF5A3C', warn: '#3CA0FF', gold: '#FFD23C', purple: '#3CA0FF', text: '#F5F5F0', sub: '#9AA08A', line: 'rgba(200,241,53,.3)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 8 },
  },
  theme07: {
    id: 'theme07', name: '冷白调研风', dark: false,
    bg: '#FFFFFF', palette: { primary: '#2F7BFF', accent: '#23C76A', warn: '#F2A93B', gold: '#8FD400', purple: '#23C76A', text: '#0E110B', sub: '#55607F', line: 'rgba(47,123,255,.18)' },
    font: { body: '"微软雅黑",sans-serif', title: '"思源宋体","微软雅黑",serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 6 },
  },
  theme08: {
    id: 'theme08', name: '黑金实验风', dark: true,
    bg: '#16150F', palette: { primary: '#ECEF35', accent: '#E7E6EE', warn: '#DEDCEA', gold: '#ECEF35', purple: '#E7E6EE', text: '#E7E6EE', sub: '#8A8A88', line: 'rgba(236,239,53,.3)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 4 },
  },
  theme09: {
    id: 'theme09', name: '深蓝杂志风', dark: true,
    bg: '#050B22', palette: { primary: '#46E3C6', accent: '#4A86FF', warn: '#FFB27A', gold: '#9F7BFF', purple: '#9F7BFF', text: '#FFFFFF', sub: '#93A4C8', line: 'rgba(70,227,198,.35)' },
    font: { body: '"微软雅黑",sans-serif', title: '"思源宋体","微软雅黑",serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 8 },
  },
  theme10: {
    id: 'theme10', name: '金色指数风', dark: false,
    bg: '#F2F3F6', palette: { primary: '#5479E8', accent: '#6F9BD8', warn: '#8FA8E6', gold: '#5479E8', purple: '#6F9BD8', text: '#0D0E11', sub: '#5A6678', line: 'rgba(84,121,232,.2)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Georgia,Consolas,serif' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 8 },
  },
  theme11: {
    id: 'theme11', name: '高能增长风', dark: true,
    bg: '#1B1108', palette: { primary: '#E22A0C', accent: '#FF6E2E', warn: '#54D17A', gold: '#FFC07A', purple: '#FF6E2E', text: '#FDF3EA', sub: '#A98A74', line: 'rgba(226,42,12,.4)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'radial', decoration: { corner: 'bar', shadow: false, radius: 8 },
  },
  theme12: {
    id: 'theme12', name: '声波霓虹风', dark: true,
    bg: '#241E20', palette: { primary: '#F15A29', accent: '#3BB6EC', warn: '#BAF04F', gold: '#C8C0BD', purple: '#BAF04F', text: '#F2EFED', sub: '#9A8F8C', line: 'rgba(241,90,41,.4)' },
    font: { body: '"微软雅黑",sans-serif', title: '"阿里普惠体","微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: true, radius: 16 },
  },

  /* ── 3 领域预设 ─────────────────────────────── */
  academic: {
    id: 'academic', name: '学术风', dark: false,
    bg: '#FFFFFF', palette: { primary: '#1E3A5F', accent: '#3B82F6', warn: '#64748B', gold: '#3B82F6', purple: '#5B8DEF', text: '#1A2740', sub: '#5B6B8A', line: 'rgba(30,58,95,.15)' },
    font: { body: '"微软雅黑",sans-serif', title: '"思源宋体","微软雅黑",serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 4 },
  },
  consulting: {
    id: 'consulting', name: '咨询风', dark: true,
    bg: '#0F172A', palette: { primary: '#3B82F6', accent: '#06B6D4', warn: '#F8FAFC', gold: '#3B82F6', purple: '#06B6D4', text: '#F8FAFC', sub: '#94A3B8', line: 'rgba(59,130,246,.35)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 6 },
  },
  redgold: {
    id: 'redgold', name: '红金政务风', dark: false,
    bg: '#FFFFFF', palette: { primary: '#C8102E', accent: '#D4AF37', warn: '#1A1A1A', gold: '#D4AF37', purple: '#C8102E', text: '#1A1A1A', sub: '#5C5C5C', line: 'rgba(200,16,46,.2)' },
    font: { body: '"微软雅黑",sans-serif', title: '"思源宋体","微软雅黑",serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 2 },
  },

  /* ── generic 通用商务浅色（默认） ───────────── */
  generic: {
    id: 'generic', name: '商务浅色', dark: false,
    bg: '#FFFFFF', palette: { primary: '#2563EB', accent: '#0EA5E9', warn: '#64748B', gold: '#F59E0B', purple: '#8B5CF6', text: '#0F172A', sub: '#64748B', line: 'rgba(37,99,235,.18)' },
    font: { body: '"微软雅黑",sans-serif', title: '"微软雅黑",sans-serif', mono: 'Consolas,monospace' },
    texture: 'none', decoration: { corner: 'bar', shadow: false, radius: 8 },
  },
};

/** 画布逻辑尺寸 */
const CANVAS_W = 1280;
const CANVAS_H = 720;

/**
 * 根据主题 id 产出 CSS 文本（预览/编辑器画布背景下挂）
 * 纹理：none | dot | grid | radial | noise（radial 在深色主题制造光效）
 */
function themeCSS(themeId) {
  const t = THEMES[themeId] || THEMES.generic;
  const p = t.palette;
  let bg = t.bg;
  if (t.texture === 'dot') {
    bg += `; background-image: radial-gradient(circle, ${p.line} 1px, transparent 1px); background-size: 24px 24px;`;
  } else if (t.texture === 'grid') {
    bg += `; background-image: linear-gradient(${p.line} 1px, transparent 1px), linear-gradient(90deg, ${p.line} 1px, transparent 1px); background-size: 40px 40px;`;
  } else if (t.texture === 'radial') {
    bg += `; background-image: radial-gradient(ellipse 60% 45% at 82% 12%, ${p.primary}33 0%, transparent 55%), radial-gradient(ellipse 50% 50% at 8% 88%, ${p.accent}2e 0%, transparent 50%);`;
  }
  return bg;
}

/** 主题的 CSS 变量（供 preview text/rect 等默认颜色用） */
function themeVars(themeId) {
  const t = THEMES[themeId] || THEMES.generic;
  return Object.entries(t.palette)
    .map(([k, v]) => `--tp-${k}: ${v}`)
    .join(';');
}

module.exports = { THEMES, CANVAS_W, CANVAS_H, themeCSS, themeVars };
