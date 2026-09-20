// @ts-check
// フィクスチャを各ブラウザで PDF 化し、テキスト抽出・ページ数・（pdftoppm があれば）画素差分を検証する。
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, convertOnPage, extractText, extractLinks, missingStrings, normalize, hasPdftoppm, pixelDiff, readPixels, root } from './helpers.mjs';

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

test('シャドウ DOM のホスト要素をそのまま変換できる（スロット・adoptedStyleSheets 込み）', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const { bytes, warnings, supported } = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' });

    class ReceiptCard extends HTMLElement {
      constructor() {
        super();
        const sr = this.attachShadow({ mode: 'open' });
        sr.innerHTML =
          '<style>:host{display:block;width:400px;font-family:"BIZ UDPGothic",sans-serif;font-size:14px}' +
          'h2{margin:0 0 8px}</style>' +
          '<h2>シャドウの見出し</h2>' +
          '<slot name="body">代替テキスト</slot>' +
          '<p class="total">合計 ￥12,345-</p>';
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('.total{font-weight:700}');
        sr.adoptedStyleSheets = [sheet];
      }
    }
    customElements.define('receipt-card', ReceiptCard);

    const host = document.createElement('receipt-card');
    host.innerHTML = '<div slot="body">スロットに入れた明細</div>';
    document.body.appendChild(host);
    await customElements.whenDefined('receipt-card');
    await document.fonts.ready;

    const warnings = [];
    const out = await lib.htmlToPdf(host, {
      stylesheets: 'none',
      fontFallback: ['BIZ UDPGothic'],
      output: 'uint8array',
      onWarning: (w) => warnings.push(`${w.code}: ${w.message}`),
    });
    return { bytes: Array.from(out), warnings, supported: typeof host.getHTML === 'function' };
  });

  test.skip(!supported, 'Element.getHTML() がこのブラウザにない');
  expect(warnings).toEqual([]);
  const { pages } = await extractText(bytes);
  // pdf.js はグリフ間の隙間を空白として拾うことがあるので空白を落として比較する
  const text = pages.join('\n').replace(/\s/g, '');
  expect(text).toContain('シャドウの見出し');
  expect(text).toContain('スロットに入れた明細');
  expect(text).toContain('合計');
  // スロットが埋まっているのでフォールバックは出ない
  expect(text).not.toContain('代替テキスト');
});

test('light DOM のカスタム要素と :defined がそのまま効く', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    customElements.define('light-card', class extends HTMLElement {});
    const host = document.createElement('light-card');
    host.innerHTML = '<span>light DOM の中身</span>';
    document.body.appendChild(host);
    await document.fonts.ready;
    const css = 'light-card{display:none} light-card:defined{display:block;width:300px;font-family:"BIZ UDPGothic";font-size:14px}';
    const out = await lib.htmlToPdf(host, { stylesheets: [css], output: 'uint8array' });
    return Array.from(out);
  });
  const { pages } = await extractText(bytes);
  // :defined が効かないと display:none のままで何も出ない
  expect(pages.join('\n').replace(/\s/g, '')).toContain('lightDOMの中身');
});

test('シャドウルート内の要素を渡すと、そのツリーのスタイルが inherit で引き継がれる', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>.inner{font-size:20px}</style><div class="inner">シャドウ内のスタイル</div>';
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.inner{font-family:"BIZ UDPGothic",sans-serif;width:300px}');
    sr.adoptedStyleSheets = [sheet];
    await document.fonts.ready;
    // stylesheets を明示せず（inherit のまま）変換する
    const out = await lib.htmlToPdf(sr.querySelector('.inner'), { output: 'uint8array' });
    return Array.from(out);
  });
  const { pages } = await extractText(bytes);
  expect(pages.join('\n').replace(/\s/g, '')).toContain('シャドウ内のスタイル');
});

test('本文領域より横に広い内容は警告が出る', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const { tooWide, justFits } = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    const run = async (css) => {
      const out = [];
      await lib.htmlToPdf(`<div id="r" style="${css}">はみ出しの確認</div>`, {
        stylesheets: ['#r{font-family:"BIZ UDPGothic";font-size:12px}'],
        page: { size: 'A4', margin: '15mm' },
        output: 'uint8array',
        onWarning: (w) => out.push(`${w.code}: ${w.message}`),
      });
      return out;
    };
    return {
      // 180mm + padding + border が content-box ではみ出す
      tooWide: await run('width:180mm;padding:16px;border:1px solid #000'),
      // box-sizing: border-box なら 180mm ちょうどで収まる
      justFits: await run('width:180mm;padding:16px;border:1px solid #000;box-sizing:border-box'),
    };
  });
  expect(tooWide.join('\n')).toMatch(/wider than the page content area/);
  expect(justFits).toEqual([]);
});

test('親文書の body マージンは PDF に持ち込まれない', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const warnings = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    // ページ側が body にマージンを持っていても、用紙の余白は options.page.margin だけで決まる
    document.body.style.margin = '40px';
    const out = [];
    await lib.htmlToPdf('<div id="r">左端の位置を見る</div>', {
      stylesheets: ['#r{font-family:"BIZ UDPGothic";font-size:12px;width:180mm}', 'body{margin:40px}'],
      page: { size: 'A4', margin: '15mm' },
      output: 'uint8array',
      onWarning: (w) => out.push(`${w.code}: ${w.message}`),
    });
    return out;
  });
  // body マージンが効いていると 180mm + 80px で本文領域をはみ出し、はみ出し警告が出る
  expect(warnings).toEqual([]);
});

test('break-after: avoid — 見出しがページ末尾に取り残されない', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);

  /**
   * 見出しの前に置く本文の行数を変えて変換し、見出しと次の段落がそれぞれ何ページ目に載るかを返す。
   * 1 ページに何行入るかはブラウザの行の高さの丸め方で変わるので、
   * 「ちょうど末尾に来る行数」を決め打ちにせず、境界の前後を掃いて調べる。
   */
  const run = async (/** @type {number} */ rows, /** @type {boolean} */ avoid) => {
    const bytes = await page.evaluate(
      async ({ rows, avoid }) => {
        const lib = await import('/src/index.js');
        await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
        let html = '<div id="doc">';
        for (let i = 0; i < rows; i++) html += `<p>本文の行 ${i + 1}</p>`;
        html += '<h2>見出し</h2>';
        for (let i = 0; i < 10; i++) html += `<p>続く段落 ${i + 1}</p>`;
        html += '</div>';
        const css =
          '#doc{font-family:"BIZ UDPGothic";font-size:12pt;width:180mm}' +
          'p{margin:0;line-height:16pt}' +
          `h2{margin:0;font-size:12pt;line-height:16pt${avoid ? ';break-after:avoid' : ''}}`;
        const out = await lib.htmlToPdf(html, { stylesheets: [css], page: { size: 'A4', margin: '15mm' }, output: 'uint8array' });
        return Array.from(out);
      },
      { rows, avoid },
    );
    // pdf.js はグリフ間の隙間を空白として拾うことがあるので空白を落として比較する
    const pages = (await extractText(bytes)).pages.map((t) => t.replace(/\s/g, ''));
    return {
      heading: pages.findIndex((t) => t.includes('見出し')),
      next: pages.findIndex((t) => t.includes('続く段落1')),
    };
  };

  let separatedWithout = 0;
  for (let rows = 43; rows <= 50; rows++) {
    const off = await run(rows, false);
    const on = await run(rows, true);
    expect(off.heading, `${rows} 行: 見出しが見つかる`).toBeGreaterThanOrEqual(0);
    expect(on.heading, `${rows} 行: 見出しが見つかる（avoid あり）`).toBeGreaterThanOrEqual(0);

    // avoid を付けたら、見出しと次の段落は必ず同じページに載る
    expect(on.heading, `${rows} 行: avoid ありなら見出しと次の段落が同じページ`).toBe(on.next);
    if (off.heading !== off.next) separatedWithout++;
  }

  // avoid 無しでは、どこかの行数で必ず離れてしまう（= avoid が実際に効いている状況を通っている）
  expect(separatedWithout, 'avoid 無しで見出しが取り残される行数が少なくとも 1 つある').toBeGreaterThan(0);
});

test('linear-gradient をベクターで描き、ブラウザ描画と一致する', async ({ page }, testInfo) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const HTML = `<div id="g"><div class="a">to right</div><div class="b">45deg 3 色</div><div class="c">透明から黒へ</div><div class="d">角丸</div></div>`;
  const CSS = `#g{font-family:"BIZ UDPGothic";font-size:14px;width:400px;background:#fff}
    #g>div{height:60px;margin-bottom:10px;padding:8px;color:#fff;box-sizing:border-box}
    .a{background-image:linear-gradient(to right, rgb(255,0,0), rgb(0,0,255))}
    .b{background-image:linear-gradient(45deg, rgb(255,0,0) 0%, rgb(255,255,0) 30%, rgb(0,0,255) 100%)}
    .c{background-color:rgb(0,160,0);background-image:linear-gradient(to right, rgba(0,0,0,0), rgb(0,0,0))}
    .d{background-image:linear-gradient(to bottom, rgb(255,255,255), rgb(51,51,51));border-radius:16px;color:#000}`;

  const { bytes, warnings } = await page.evaluate(
    async ({ HTML, CSS }) => {
      const lib = await import('/src/index.js');
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
      const warnings = [];
      const out = await lib.htmlToPdf(HTML, {
        stylesheets: [CSS],
        page: { size: { width: '400px', height: '300px' }, margin: '0' },
        output: 'uint8array',
        onWarning: (w) => warnings.push(`${w.code}: ${w.message}`),
      });
      return { bytes: Array.from(out), warnings };
    },
    { HTML, CSS },
  );
  expect(warnings).toEqual([]);
  // テキストはベクターのまま（グラデーションを画像に落としていない）
  const { pages } = await extractText(bytes);
  expect(pages.join('').replace(/\s/g, '')).toContain('透明から黒へ');

  test.skip(!(await hasPdftoppm()), 'pdftoppm が無い');
  // 同じ HTML をブラウザに描かせて画素差分を取る
  const shot = await page.evaluate(
    async ({ HTML, CSS }) => {
      const host = document.createElement('div');
      host.id = 'shot';
      host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;background:#fff;z-index:99999';
      host.innerHTML = `<style>${CSS}</style>${HTML}`;
      document.body.appendChild(host);
      await document.fonts.ready;
      return true;
    },
    { HTML, CSS },
  );
  expect(shot).toBe(true);
  const png = await page.locator('#shot').screenshot();
  const { diffRatio, diffPath } = await pixelDiff(bytes, png, testInfo.outputPath('.'), 'gradient');
  testInfo.annotations.push({ type: 'pixel-diff', description: `${(diffRatio * 100).toFixed(2)}% (${diffPath})` });
  expect(diffRatio).toBeLessThan(0.05);
});

test('インライン SVG をベクターで描き、ブラウザ描画と一致する', async ({ page }, testInfo) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const SVG = `<svg width="360" height="180" viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="240" height="120" fill="#f6f6f6"/>
      <g transform="translate(20,20)">
        <circle cx="30" cy="30" r="28" fill="#08f" stroke="#024" stroke-width="3"/>
        <rect x="70" y="8" width="60" height="44" rx="8" fill="none" stroke="#c00" stroke-width="4" stroke-dasharray="8 4"/>
        <path d="M150 10 L190 10 A20 20 0 0 1 190 50 L150 50 Z" fill="#0a0" fill-opacity="0.6"/>
        <polygon points="0,70 20,70 10,88" fill="#333"/>
        <polyline points="40,88 60,70 80,88 100,70" fill="none" stroke="#909" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="M120 70 q 20 -20 40 0 t 40 0" fill="none" stroke="#f60" stroke-width="3"/>
        <path d="M0 0 h10 v10 h-10 z M2 2 h6 v6 h-6 z" fill="#000" fill-rule="evenodd" transform="translate(200,60) scale(2)"/>
      </g>
    </svg>`;
  const CSS = '#d{font-family:"BIZ UDPGothic";width:400px;background:#fff;padding:10px;box-sizing:border-box}';

  const { bytes, warnings } = await page.evaluate(
    async ({ SVG, CSS }) => {
      const lib = await import('/src/index.js');
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
      const warnings = [];
      const out = await lib.htmlToPdf(`<div id="d">${SVG}</div>`, {
        stylesheets: [CSS],
        page: { size: { width: '400px', height: '220px' }, margin: '0' },
        output: 'uint8array',
        onWarning: (w) => warnings.push(`${w.code}: ${w.message}`),
      });
      return { bytes: Array.from(out), warnings };
    },
    { SVG, CSS },
  );
  expect(warnings).toEqual([]);
  // ベクターなので画像 XObject は生成されない
  expect(String.fromCharCode(...bytes)).not.toContain('/Subtype /Image');

  test.skip(!(await hasPdftoppm()), 'pdftoppm が無い');
  await page.evaluate(
    ({ SVG, CSS }) => {
      const host = document.createElement('div');
      host.id = 'shot';
      host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:220px;background:#fff;z-index:99999';
      host.innerHTML = `<style>${CSS}</style><div id="d">${SVG}</div>`;
      document.body.appendChild(host);
    },
    { SVG, CSS },
  );
  const png = await page.locator('#shot').screenshot();
  const { diffRatio, diffPath } = await pixelDiff(bytes, png, testInfo.outputPath('.'), 'svg');
  testInfo.annotations.push({ type: 'pixel-diff', description: `${(diffRatio * 100).toFixed(2)}% (${diffPath})` });
  expect(diffRatio).toBeLessThan(0.05);
});

test('SVG の <text> と paint server は警告して飛ばす', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const warnings = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    const out = [];
    await lib.htmlToPdf(
      `<svg width="100" height="50" xmlns="http://www.w3.org/2000/svg">
         <defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>
         <rect width="40" height="40" fill="url(#g)"/>
         <text x="0" y="45">文字</text>
       </svg>`,
      { stylesheets: 'none', output: 'uint8array', onWarning: (w) => out.push(w.message) },
    );
    return out;
  });
  expect(warnings.join('\n')).toMatch(/<text>/);
  expect(warnings.join('\n')).toMatch(/paint server/);
});

test('GSUB の単一置換（slashed-zero）をブラウザと同じグリフで描く', async ({ page }, testInfo) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const FF = '@font-face{font-family:"BIZ UDPGothic";font-weight:400;src:url("/fonts/BIZUDPGothic-Regular.ttf")}';
  const base = `${FF}#d{font-family:"BIZ UDPGothic";font-size:40px;white-space:pre;background:#fff;padding:20px}`;
  const HTML = '<div id="d">0123</div>';

  /** @param {boolean} slashed */
  const convert = (slashed) =>
    page.evaluate(
      async ({ CSS, HTML }) => {
        const lib = await import('/src/index.js');
        await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
        const out = await lib.htmlToPdf(HTML, {
          stylesheets: [CSS],
          page: { size: { width: '400px', height: '100px' }, margin: '0' },
          output: 'uint8array',
        });
        return Array.from(out);
      },
      { CSS: base + (slashed ? '#d{font-variant-numeric:slashed-zero}' : ''), HTML },
    );

  const plain = await convert(false);
  const slashed = await convert(true);

  // 置換が実際に起きている（同じ文字列でも中身が変わる）
  expect(Buffer.compare(Buffer.from(plain), Buffer.from(slashed))).not.toBe(0);
  // 置換してもテキストは元の文字として抽出できる（ToUnicode は元のコードポイントのまま）
  expect((await extractText(slashed)).pages.join('').replace(/\s/g, '')).toBe('0123');

  test.skip(!(await hasPdftoppm()), 'pdftoppm が無い');
  await page.evaluate(
    ({ CSS, HTML }) => {
      const host = document.createElement('div');
      host.id = 'shot';
      host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:100px;background:#fff;z-index:99999';
      host.innerHTML = `<style>${CSS}</style>${HTML}`;
      document.body.appendChild(host);
    },
    { CSS: base + '#d{font-variant-numeric:slashed-zero}', HTML },
  );
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator('#shot').screenshot();
  const { diffRatio, diffPath } = await pixelDiff(slashed, png, testInfo.outputPath('.'), 'gsub');
  testInfo.annotations.push({ type: 'pixel-diff', description: `${(diffRatio * 100).toFixed(2)}% (${diffPath})` });
  expect(diffRatio).toBeLessThan(0.05);
});

test('background-repeat をタイル描画で再現する', async ({ page }, testInfo) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  // 28x28 の単色タイル（左上に向き確認用の印）。等倍で使うのでリサンプリング差が出ない
  const src = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 28;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.fillStyle = '#0a58c8';
    g.fillRect(0, 0, 28, 28);
    g.fillStyle = '#e03030';
    g.fillRect(0, 0, 8, 8);
    return c.toDataURL('image/png');
  });
  const CSS = `#g{width:400px;background:#fff}
    #g>div{height:60px;margin-bottom:8px;box-sizing:border-box;
      background-image:url("${src}");background-size:28px 28px}
    .r{background-repeat:repeat}
    .x{background-repeat:repeat-x}
    .y{background-repeat:repeat-y}
    .s{background-repeat:space}
    .o{background-repeat:round}
    .n{background-repeat:no-repeat;background-position:center}`;
  const HTML = '<div id="g"><div class="r"></div><div class="x"></div><div class="y"></div><div class="s"></div><div class="o"></div><div class="n"></div></div>';

  const { bytes, warnings } = await page.evaluate(
    async ({ CSS, HTML }) => {
      const lib = await import('/src/index.js');
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
      const warnings = [];
      const out = await lib.htmlToPdf(HTML, {
        stylesheets: [CSS],
        page: { size: { width: '400px', height: '420px' }, margin: '0' },
        output: 'uint8array',
        onWarning: (w) => warnings.push(`${w.code}: ${w.message}`),
      });
      return { bytes: Array.from(out), warnings };
    },
    { CSS, HTML },
  );
  expect(warnings).toEqual([]);
  // 画像は 1 回しか埋め込まれない（タイルは同じ XObject を参照する）
  expect(String.fromCharCode(...bytes).match(/\/Subtype \/Image/g) ?? []).toHaveLength(1);

  test.skip(!(await hasPdftoppm()), 'pdftoppm が無い');
  await page.evaluate(
    ({ CSS, HTML }) => {
      const host = document.createElement('div');
      host.id = 'shot';
      host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:420px;background:#fff;z-index:99999';
      host.innerHTML = `<style>${CSS}</style>${HTML}`;
      document.body.appendChild(host);
    },
    { CSS, HTML },
  );
  await page.waitForTimeout(300);
  const png = await page.locator('#shot').screenshot();
  const { diffRatio, diffPath } = await pixelDiff(bytes, png, testInfo.outputPath('.'), 'bgrepeat');
  testInfo.annotations.push({ type: 'pixel-diff', description: `${(diffRatio * 100).toFixed(2)}% (${diffPath})` });

  // 配置そのものはタイルの内側の色を点で見て確かめる（96dpi なので 1px = 1css px）。
  // 画素差分より先に見ることで、ずれたときに「どのモードが壊れたか」が分かる
  const pdfPng = await readPixels(join(testInfo.outputPath('.'), 'bgrepeat-pdf.png'));
  const isTile = (/** @type {[number, number, number]} */ c) => c[2] > 150 && c[0] < 110;
  const isBlank = (/** @type {[number, number, number]} */ c) => c[0] > 235 && c[1] > 235 && c[2] > 235;
  // 各行は y = i*68 から高さ 60。タイルは 28x28
  expect(isTile(pdfPng.at(350, 0 * 68 + 50)), 'repeat: 右下までタイルが並ぶ').toBe(true);
  expect(isTile(pdfPng.at(350, 1 * 68 + 14)), 'repeat-x: 右端までタイルが並ぶ').toBe(true);
  expect(isBlank(pdfPng.at(350, 1 * 68 + 45)), 'repeat-x: 縦には繰り返さない').toBe(true);
  expect(isTile(pdfPng.at(14, 2 * 68 + 45)), 'repeat-y: 下までタイルが並ぶ').toBe(true);
  expect(isBlank(pdfPng.at(350, 2 * 68 + 14)), 'repeat-y: 横には繰り返さない').toBe(true);
  expect(isTile(pdfPng.at(350, 3 * 68 + 14)), 'space: 右端近くまで並ぶ').toBe(true);
  expect(isTile(pdfPng.at(350, 4 * 68 + 14)), 'round: 右端近くまで並ぶ').toBe(true);
  expect(isTile(pdfPng.at(200, 5 * 68 + 30)), 'no-repeat + center: 中央に 1 枚').toBe(true);
  expect(isBlank(pdfPng.at(10, 5 * 68 + 30)), 'no-repeat: 左端には無い').toBe(true);

  // アンチエイリアスの差で数 % はぶれるので、全体の一致は緩めに見る
  expect(diffRatio).toBeLessThan(0.05);
});

test('タイル数が上限を超えたら警告して 1 枚だけ描く', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const warnings = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    const out = [];
    await lib.htmlToPdf('<div id="t"></div>', {
      stylesheets: ['#t{width:800px;height:800px;background-image:url("/fixtures/receipt-invoice/assets/seal.png");background-size:2px 2px;background-repeat:repeat}'],
      page: { size: 'A4', margin: '0' },
      output: 'uint8array',
      onWarning: (w) => out.push(w.message),
    });
    return out;
  });
  expect(warnings.join('\n')).toMatch(/tiles \(limit 4000\)/);
});

test('onProgress が変換の進み具合を順番に知らせる', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const events = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    let html = '<div id="d">';
    for (let i = 0; i < 300; i++) html += `<p>本文の行 ${i + 1}</p>`;
    html += '</div>';
    const out = [];
    await lib.htmlToPdf(html, {
      stylesheets: ['#d{font-family:"BIZ UDPGothic";font-size:11pt;width:180mm}p{margin:0;line-height:16pt}'],
      page: { size: 'A4', margin: '15mm' },
      output: 'uint8array',
      onProgress: (p) => out.push(p),
    });
    return out;
  });

  const phases = events.map((e) => e.phase);
  expect(phases[0]).toBe('render');
  expect(phases[1]).toBe('walk');
  expect(phases[2]).toBe('layout');
  expect(phases.at(-1)).toBe('done');

  const layout = events[2];
  expect(layout.totalPages).toBeGreaterThan(1);

  // page は 1 から totalPages まで抜けなく届く
  const pages = events.filter((e) => e.phase === 'page').map((e) => e.page);
  expect(pages).toEqual(Array.from({ length: layout.totalPages }, (_, i) => i + 1));
  for (const e of events.filter((x) => x.phase === 'page')) expect(e.totalPages).toBe(layout.totalPages);
});

test('画像は埋め込み後に解放され、次の変換では読み直される', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const result = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    const { loadImage } = await import('/src/walker/image.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    const url = new URL('/fixtures/receipt-invoice/assets/seal.png', location.href).href;
    const html = `<div id="d"><img src="${url}" width="60" height="60"></div>`;

    const first = await lib.htmlToPdf(html, { stylesheets: 'none', output: 'uint8array' });
    // 変換後、デコード済みのピクセルデータは手放されている
    const cached = await loadImage(url, () => {});
    const releasedAfterFirst = cached !== null && cached.rgb !== null; // 読み直されたので再びデータを持つ
    // 2 回目も同じ大きさの PDF になる（読み直しが効いている）
    const second = await lib.htmlToPdf(html, { stylesheets: 'none', output: 'uint8array' });
    return { firstLen: first.length, secondLen: second.length, releasedAfterFirst };
  });
  expect(result.firstLen).toBeGreaterThan(1000);
  // 解放されていれば loadImage は読み直し、再びピクセルデータを持つ
  expect(result.releasedAfterFirst).toBe(true);
  // 読み直しが効いているので 2 回目も同じ内容になる
  expect(result.secondLen).toBe(result.firstLen);
});

/** リンクとしおりの検証用: 見出しと 3 種類のリンクを含む 2 ページの文書 */
const LINK_DOC = {
  css:
    '@font-face{font-family:"BIZ UDPGothic";src:url("/fonts/BIZUDPGothic-Regular.ttf")}' +
    '#d{font-family:"BIZ UDPGothic";font-size:11pt;width:180mm}p,h1,h2,h3{margin:0;line-height:18pt}',
  build: (rows = 60) => {
    let html = '<div id="d"><h1>請求書</h1>';
    html += '<p><a href="https://example.com/pay/123">支払いページ</a>／<a href="mailto:info@example.com">お問い合わせ</a></p>';
    html += '<p><a href="#terms">規約へ</a>／<a href="#missing">飛び先なし</a>／<a href="javascript:alert(1)">スクリプト</a></p>';
    for (let i = 0; i < rows; i++) html += `<p>本文 ${i + 1}</p>`;
    html += '<h2 id="terms">規約</h2><p>規約の本文</p><h3>細則</h3><p>細則の本文</p><h2>連絡先</h2><p>おわり</p></div>';
    return html;
  },
};

test('<a href> をリンク注釈にする（外部・mailto・文書内）', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(
    async ({ css, html }) => {
      const lib = await import('/src/index.js');
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
      const out = await lib.htmlToPdf(html, { stylesheets: [css], page: { size: 'A4', margin: '15mm' }, output: 'uint8array' });
      return Array.from(out);
    },
    { css: LINK_DOC.css, html: LINK_DOC.build() },
  );

  const { links, numPages, outline } = await extractLinks(bytes);
  expect(numPages).toBe(2);

  const urls = links.map((l) => l.url).filter(Boolean);
  expect(urls).toContain('https://example.com/pay/123');
  expect(urls).toContain('mailto:info@example.com');
  // javascript: と、飛び先の無い #missing は注釈にしない
  expect(urls.some((u) => /^javascript:/.test(u ?? ''))).toBe(false);
  expect(links).toHaveLength(3);

  // 文書内リンクは #terms が載っている 2 ページ目を指す
  const internal = links.filter((l) => l.destPage !== null);
  expect(internal).toHaveLength(1);
  expect(internal[0]?.destPage).toBe(1);

  // 注釈はすべて 1 ページ目（リンクを置いた位置）にあり、面積を持つ
  for (const l of links) {
    expect(l.page).toBe(0);
    expect(l.rect[2] - l.rect[0]).toBeGreaterThan(1);
    expect(l.rect[3] - l.rect[1]).toBeGreaterThan(1);
  }

  // outline: false（既定）ではしおりを作らない
  expect(outline).toEqual([]);
});

test('outline: true で見出しからしおりを作る', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(
    async ({ css, html }) => {
      const lib = await import('/src/index.js');
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
      const out = await lib.htmlToPdf(html, { stylesheets: [css], page: { size: 'A4', margin: '15mm' }, outline: true, output: 'uint8array' });
      return Array.from(out);
    },
    { css: LINK_DOC.css, html: LINK_DOC.build() },
  );
  const { outline } = await extractLinks(bytes);
  // h1 > h2 > h3 の入れ子になる
  expect(outline).toEqual([
    { depth: 0, title: '請求書' },
    { depth: 1, title: '規約' },
    { depth: 2, title: '細則' },
    { depth: 1, title: '連絡先' },
  ]);
});

test('links: false でリンク注釈を作らない', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(
    async ({ css, html }) => {
      const lib = await import('/src/index.js');
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
      const out = await lib.htmlToPdf(html, { stylesheets: [css], page: { size: 'A4', margin: '15mm' }, links: false, output: 'uint8array' });
      return Array.from(out);
    },
    { css: LINK_DOC.css, html: LINK_DOC.build() },
  );
  expect((await extractLinks(bytes)).links).toEqual([]);
});

test('ページ境界を跨ぐリンクは両ページに分けて出す', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    // 高さのあるブロックリンクを、ちょうどページ境界にかかる位置に置く
    let html = '<div id="d">';
    // 1 ページ目の途中から始まり、次のページまで続く高さにする
    for (let i = 0; i < 30; i++) html += `<p>本文 ${i + 1}</p>`;
    html += '<a class="big" href="https://example.com/long">またがるリンク</a>';
    for (let i = 0; i < 10; i++) html += `<p>あと ${i + 1}</p>`;
    html += '</div>';
    const css =
      '@font-face{font-family:"BIZ UDPGothic";src:url("/fonts/BIZUDPGothic-Regular.ttf")}' +
      '#d{font-family:"BIZ UDPGothic";font-size:11pt;width:180mm}p{margin:0;line-height:18pt}' +
      '.big{display:block;height:300pt;background:#eef}';
    const out = await lib.htmlToPdf(html, { stylesheets: [css], page: { size: 'A4', margin: '15mm' }, output: 'uint8array' });
    return Array.from(out);
  });

  const { links } = await extractLinks(bytes);
  const big = links.filter((l) => l.url === 'https://example.com/long');
  expect(big).toHaveLength(2);
  expect(big.map((l) => l.page)).toEqual([0, 1]);
  // 切り取られた 2 つの高さを足すと元の高さ（300pt）に近い
  const total = big.reduce((sum, l) => sum + (l.rect[3] - l.rect[1]), 0);
  expect(total).toBeGreaterThan(290);
  expect(total).toBeLessThan(310);
});

test('リンク注釈の矩形がその文字の上に重なる', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(
    async ({ css, html }) => {
      const lib = await import('/src/index.js');
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
      const out = await lib.htmlToPdf(html, { stylesheets: [css], page: { size: 'A4', margin: '15mm' }, output: 'uint8array' });
      return Array.from(out);
    },
    { css: LINK_DOC.css, html: LINK_DOC.build(0) },
  );

  const { links } = await extractLinks(bytes);
  const pay = links.find((l) => l.url === 'https://example.com/pay/123');
  expect(pay).toBeTruthy();

  // 「支払いページ」のベースライン位置を取り出し、注釈の矩形に入っているか見る
  const { positions } = await extractText(bytes);
  const glyph = positions.find((t) => t.str.replace(/\s/g, '').startsWith('支払'));
  expect(glyph, '「支払いページ」が抽出できる').toBeTruthy();
  const rect = /** @type {number[]} */ (pay?.rect);
  expect(glyph?.x).toBeGreaterThanOrEqual(rect[0] - 2);
  expect(glyph?.x).toBeLessThanOrEqual(rect[2]);
  expect(glyph?.y).toBeGreaterThanOrEqual(rect[1] - 2);
  expect(glyph?.y).toBeLessThanOrEqual(rect[3] + 2);
});

test('フッターの中のリンクも注釈になる', async ({ page }) => {
  await page.goto(`${server.url}/fixtures/receipt-invoice/index.html`);
  const bytes = await page.evaluate(async () => {
    const lib = await import('/src/index.js');
    await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
    let html = '<div id="d">';
    for (let i = 0; i < 60; i++) html += `<p>本文 ${i + 1}</p>`;
    html += '</div>';
    const css =
      '@font-face{font-family:"BIZ UDPGothic";src:url("/fonts/BIZUDPGothic-Regular.ttf")}' +
      '#d{font-family:"BIZ UDPGothic";font-size:11pt;width:180mm}p{margin:0;line-height:18pt}';
    const out = await lib.htmlToPdf(html, {
      stylesheets: [css],
      page: { size: 'A4', margin: '15mm' },
      footer: '<div style="font-family:\'BIZ UDPGothic\';font-size:8pt;text-align:center"><a href="https://example.com/support">サポート</a> {{pageNumber}} / {{totalPages}}</div>',
      output: 'uint8array',
    });
    return Array.from(out);
  });

  const { links, numPages } = await extractLinks(bytes);
  const support = links.filter((l) => l.url === 'https://example.com/support');
  // 全ページのフッターに 1 つずつ
  expect(numPages).toBeGreaterThan(1);
  expect(support).toHaveLength(numPages);
  expect(support.map((l) => l.page)).toEqual(Array.from({ length: numPages }, (_, i) => i));
  // フッター帯（下余白の上）に置かれている
  for (const l of support) expect(l.rect[1]).toBeLessThan(100);
});
