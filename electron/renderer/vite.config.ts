/**
 * Tiffa Renderer — Vite 构建配置（仅构建渲染层）
 *
 * - root 指向本目录（renderer/），入口为 renderer/index.html
 * - 产物输出 renderer/dist/（electron-builder files 已指向 renderer/dist/**\/*）
 * - base: './' 保证 file:// 协议下相对资源可加载（便携性关键）
 * - target 对齐 Electron 33 内置 Chromium 130
 * - themes.js / styles.css / hljs CSS 以普通资源方式被 index.html 引用，
 *   Vite 会将其打包/复制到 dist，保持"纯静态、零依赖、零网络"。
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // 单文件打包：Electron file:// 加载简单可靠；代码量可控
        manualChunks: undefined,
        assetFileNames: 'assets/[name].[hash][extname]',
        chunkFileNames: 'assets/[name].[hash].js',
        entryFileNames: 'assets/[name].[hash].js',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
