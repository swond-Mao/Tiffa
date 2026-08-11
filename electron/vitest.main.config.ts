import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  resolve: {
    // .ts 优先于 .js：避免解析到 tsc 编译产物（旧逻辑），确保测试始终跑源码
    extensions: ['.ts', '.js', '.json'],
  },
  test: {
    environment: 'node',
    include: ['modules/**/*.test.ts'],
  },
});
