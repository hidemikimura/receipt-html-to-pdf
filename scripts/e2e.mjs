// フィクスチャを Chromium で PDF 化し、out/ に保存する開発用スクリプト。
// 使い方: node scripts/e2e.mjs [fixture-name] [variant]   (既定: receipt-invoice)
//   variant は expected.json の variants のキー。指定すると bodyClass を付けて変換し、
//   out/<fixture>-<variant>.pdf に保存する。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixture = process.argv[2] ?? 'receipt-invoice';
const variant = process.argv[3] ?? null;
const expected = JSON.parse(await readFile(join(root, 'fixtures', fixture, 'expected.json'), 'utf8'));
const bodyClass = variant ? expected.variants?.[variant]?.bodyClass ?? '' : '';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.ttf': 'font/ttf', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
page.on('console', (m) => console.log('[browser]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/fixtures/${fixture}/index.html`);
await page.evaluate(() => document.fonts.ready);

if (bodyClass) await page.evaluate((c) => document.body.classList.add(c), bodyClass);

const result = await page.evaluate(async ({ header, footer, pageOpts }) => {
  const lib = await import('/src/index.js');
  await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
  await lib.registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' });
  const warnings = [];
  const t0 = performance.now();
  const bytes = await lib.htmlToPdf(document.querySelector('#receipt') ?? document.body, {
    page: pageOpts,
    header,
    footer,
    metadata: { title: document.title, author: '株式会社サンプル商店' },
    output: 'uint8array',
    onWarning: (w) => warnings.push(`${w.code}: ${w.message}`),
  });
  return { bytes: Array.from(bytes), warnings, ms: Math.round(performance.now() - t0) };
}, { header: expected.header ?? null, footer: expected.footer ?? null, pageOpts: expected.page ?? { size: 'A4', margin: '15mm' } });
await browser.close();
server.close();

await mkdir(join(root, 'out'), { recursive: true });
const outPath = join(root, 'out', `${fixture}${variant ? `-${variant}` : ''}.pdf`);
await writeFile(outPath, Buffer.from(result.bytes));
console.log(`wrote ${outPath} (${result.bytes.length} bytes, ${result.ms} ms in browser)`);
for (const w of result.warnings) console.log('warning:', w);
