import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// 两种环境分开（ADR-0004）：
// *.test.ts      → node：service worker 一侧，误用 DOM 会在这里失败
// *.dom.test.ts  → jsdom：页面一侧（抽取、Markdown 转换）和扩展页面
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // 文案语言固定为 zh_CN，测试里用 useLocale 切换（ALAG-7）；两个 project 经 extends 继承
    setupFiles: ['./tests/setup/i18n.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/*.dom.test.ts', '**/node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.dom.test.ts', 'tests/**/*.dom.test.ts'],
        },
      },
    ],
  },
});
