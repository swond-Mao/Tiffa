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
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
