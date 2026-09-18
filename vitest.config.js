import { defineConfig } from 'vitest/config';

// 単体テストは test/、ブラウザテスト（Playwright）は tests/browser/ に置く
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
  },
});
