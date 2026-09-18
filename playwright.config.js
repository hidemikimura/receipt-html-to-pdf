// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * ブラウザテスト（tests/browser）。
 * Chromium / Firefox / WebKit の 3 プロジェクトで同じ検証を走らせる。
 * CHROMIUM_PATH を指定すると Chromium だけその実行ファイルを使う（Playwright 同梱版が無い環境向け）。
 * BROWSERS=chromium のようにカンマ区切りで対象を絞れる。
 */
const browsers = (process.env.BROWSERS ?? 'chromium,firefox,webkit').split(',').map((s) => s.trim());

/** @type {import('@playwright/test').Project[]} */
const projects = [];
if (browsers.includes('chromium')) {
  projects.push({
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      deviceScaleFactor: 1,
      launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    },
  });
}
// Desktop Safari プリセットは deviceScaleFactor: 2 を含み、スクリーンショットが 2 倍サイズになって
// PDF ラスター（96dpi）と比較できなくなるため、全プロジェクトで 1 に固定する
if (browsers.includes('firefox')) projects.push({ name: 'firefox', use: { ...devices['Desktop Firefox'], deviceScaleFactor: 1 } });
if (browsers.includes('webkit')) projects.push({ name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } });

export default defineConfig({
  testDir: './tests/browser',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    viewport: { width: 900, height: 1200 },
    deviceScaleFactor: 1,
  },
  projects,
});
