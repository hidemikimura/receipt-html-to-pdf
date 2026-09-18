// @ts-check
// フィクスチャを各ブラウザで PDF 化し、テキスト抽出・ページ数・（pdftoppm があれば）画素差分を検証する。
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, convertOnPage, extractText, missingStrings, normalize, hasPdftoppm, pixelDiff, root } from './helpers.mjs';

/** @type {{name: string, variant: string|null}[]} */
const CASES = [
  { name: 'receipt-invoice', variant: null },
  { name: 'receipt-invoice', variant: 'reissue' },
  { name: 'receipt-invoice-long', variant: null },
];

/**
 * 画素差分の許容値（差が大きい画素の割合）。
 * フォントのアンチエイリアス差だけで Chromium 2.4〜3%、WebKit 約 3.7% 出る。
 * 位置ずれ（例: 上余白 57px のずれ）は 7% 前後になるので、5% を境にする。
 */
const MAX_DIFF_RATIO = 0.05;

/** @type {Awaited<ReturnType<typeof serve>>} */
let server;
test.beforeAll(async () => {
  server = await serve();
});
test.afterAll(() => server.close());

for (const c of CASES) {
  const label = c.variant ? `${c.name} (${c.variant})` : c.name;

  test(`${label}: テキスト抽出とページ数`, async ({ page }, testInfo) => {
    const expected = JSON.parse(await readFile(join(root, 'fixtures', c.name, 'expected.json'), 'utf8'));
    const mustContain = [...expected.mustContain, ...(c.variant ? expected.variants?.[c.variant]?.mustContain ?? [] : [])];

    await page.goto(`${server.url}/fixtures/${c.name}/index.html`);
    await page.evaluate(() => document.fonts.ready);
    const result = await convertOnPage(page, expected, c.variant);
    testInfo.annotations.push({ type: 'timing', description: `${result.ms} ms, ${result.bytes.length} bytes` });
    for (const w of result.warnings) testInfo.annotations.push({ type: 'warning', description: w });

    await testInfo.attach(`${label}.pdf`, { body: Buffer.from(result.bytes), contentType: 'application/pdf' });

    const { pages, numPages, title } = await extractText(result.bytes);
    expect(missingStrings(pages, mustContain), 'PDF から抽出できなかった文字列').toEqual([]);
    if (expected.expectedPages !== undefined) expect(numPages).toBe(expected.expectedPages);
    for (const s of expected.mustContainOnEveryPage ?? []) {
      for (const [i, t] of pages.entries()) expect(normalize(t), `page ${i + 1} に "${s}"`).toContain(normalize(s));
    }
    expect(title).toBe(await page.title());
    // PDF ヘッダー・フッター
    expect(String.fromCharCode(...result.bytes.slice(0, 8))).toBe('%PDF-1.7');
    expect(String.fromCharCode(...result.bytes.slice(-6)).trim()).toBe('%%EOF');
  });

  if (!c.variant || c.variant === 'reissue') {
    test(`${label}: ブラウザ描画との画素差分`, async ({ page }, testInfo) => {
      test.skip(!(await hasPdftoppm()), 'pdftoppm (poppler-utils) が無いため画素差分はスキップ');
      const expected = JSON.parse(await readFile(join(root, 'fixtures', c.name, 'expected.json'), 'utf8'));
      // A4 の px 幅で開き、上余白 15mm をパディングで再現してスクリーンショットを撮る
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.goto(`${server.url}/fixtures/${c.name}/index.html`);
      if (c.variant) await page.evaluate((cls) => document.body.classList.add(cls), expected.variants[c.variant].bodyClass);
      await page.evaluate(() => document.fonts.ready);
      // 先に変換する（後で足す padding のスタイルが iframe に継承されないように）
      const result = await convertOnPage(page, expected, null);
      await page.addStyleTag({ content: 'body{padding-top:56.7px}' });
      const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 794, height: 1123 } });
      const { diffRatio, diffPath } = await pixelDiff(result.bytes, shot, testInfo.outputPath(), label.replace(/[^\w-]+/g, '_'));
      testInfo.annotations.push({ type: 'diff', description: `${(diffRatio * 100).toFixed(2)} % (${diffPath})` });
      await testInfo.attach('diff.png', { path: diffPath, contentType: 'image/png' });
      expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO);
    });
  }
}

test('登録フォントが無いときは明確なエラーになる', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const message = await page.evaluate(async () => {
    // 新しいモジュールインスタンスにするためクエリを付ける
    const lib = await import('/src/index.js?fresh=' + Date.now());
    try {
      await lib.htmlToPdf(document.body);
      return 'no error';
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  expect(message).toMatch(/no fonts registered/);
});

test('未対応 CSS は例外にならず onWarning に届く', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const warnings = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    /** @type {string[]} */
    const out = [];
    await lib.htmlToPdf('<div style="box-shadow:0 0 4px #000;font-family:BIZ UDPGothic">影 <span style="font-family:Nonexistent">x</span></div>', {
      stylesheets: 'none',
      fontFallback: ['BIZ UDPGothic'],
      output: 'uint8array',
      onWarning: (w) => out.push(w.code + ':' + (w.property ?? '')),
    });
    return out;
  });
  expect(warnings).toContain('unsupported-css:box-shadow');
});

test('overflow: hidden ではみ出した内容は描かれず、抽出テキストにも残らない', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    const html =
      '<div style="font-family:BIZ UDPGothic;font-size:14px">' +
      '<div style="width:120px;height:20px;overflow:hidden;white-space:nowrap">見える部分 ここからは見えないはず</div>' +
      '<div style="height:24px;overflow:hidden"><p style="margin:0;line-height:24px">一行目</p><p style="margin:0;line-height:24px">隠れる二行目</p></div>' +
      '</div>';
    const out = await lib.htmlToPdf(html, { stylesheets: 'none', output: 'uint8array' });
    return Array.from(out);
  });
  const { pages } = await extractText(bytes);
  const text = pages.join('\n');
  expect(text).toContain('見える部分');
  expect(text).toContain('一行目');
  expect(text).not.toContain('隠れる二行目');
  // 1 行目のはみ出し部分は同じ行（同じテキスト命令）なのでクリップだけで消える。文字は残ってよい
});
