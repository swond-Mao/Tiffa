/**
 * Tiffa Renderer — Vitest 配置（渲染层单测）
 * 与现有 electron/main.test.js（主进程单测，node 直接跑）分开。
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  test: {
    // node 环境：当前单测为纯 store 逻辑（zustand 不依赖 DOM）。
    // 若未来需要 DOM 断言（组件测试），再装 jsdom 并改回 'jsdom'。
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
