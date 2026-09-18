// ブラウザテスト共通: 静的サーバー、変換、pdf.js によるテキスト抽出、画素差分
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname, join, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export const root = resolve(new URL('../..', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };

/** リポジトリを配信する静的サーバーを起動し、{ url, close } を返す */
export async function serve() {
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
  return { url: `http://localhost:${server.address().port}`, close: () => server.close() };
}

/**
 * ページ上でフィクスチャを PDF 化する。
 * @param {import('@playwright/test').Page} page
 * @param {object} expected  fixtures/<name>/expected.json
 * @param {string|null} variant
 */
export async function convertOnPage(page, expected, variant) {
  const bodyClass = variant ? expected.variants?.[variant]?.bodyClass ?? '' : '';
  if (bodyClass) await page.evaluate((c) => document.body.classList.add(c), bodyClass);
  return page.evaluate(
    async ({ header, footer, pageOpts }) => {
      const lib = await import('/src/index.js');
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
      await lib.registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' });
      const warnings = [];
      const t0 = performance.now();
      const bytes = await lib.htmlToPdf(document.querySelector('#receipt') ?? document.body, {
        page: pageOpts,
        header,
        footer,
        metadata: { title: document.title },
        output: 'uint8array',
        onWarning: (w) => warnings.push(`${w.code}: ${w.message}`),
      });
      return { bytes: Array.from(bytes), warnings, ms: Math.round(performance.now() - t0) };
    },
    { header: expected.header ?? null, footer: expected.footer ?? null, pageOpts: expected.page ?? { size: 'A4', margin: '15mm' } },
  );
}

/** pdf.js で全ページのテキストを取り出す */
export async function extractText(bytes) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    let text = '';
    let lastY = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1) text += '\n';
      text += item.str;
      lastY = y;
    }
    pages.push(text);
  }
  const info = (await pdf.getMetadata()).info;
  return { pages, numPages: pdf.numPages, title: info.Title };
}

export const normalize = (s) => s.replace(/[ 　\t]+/g, ' ').trim();

/** mustContain の照合。見つからなかった文字列を返す */
export function missingStrings(pages, mustContain) {
  const all = pages.join('\n');
  const hay = normalize(all);
  const compact = all.replace(/\s+/g, '');
  return mustContain.filter((s) => !(hay.includes(normalize(s)) || compact.includes(s.replace(/\s+/g, ''))));
}

/** pdftoppm が使えるか */
export async function hasPdftoppm() {
  try {
    await promisify(execFile)('pdftoppm', ['-v']);
    return true;
  } catch (e) {
    // pdftoppm -v は stderr にバージョンを出して 0 で終わるが、環境によっては非 0 のことがある
    return !(e && e.code === 'ENOENT');
  }
}

/**
 * PDF の 1 ページ目を 96dpi でラスタライズし、ブラウザのスクリーンショットと比較する。
 * @returns {Promise<{diffRatio: number, diffPath: string}>}  diffRatio: 差が 64/255 を超える画素の割合
 */
export async function pixelDiff(pdfBytes, screenshotPng, outDir, name) {
  await mkdir(outDir, { recursive: true });
  const pdfPath = join(outDir, `${name}.pdf`);
  await writeFile(pdfPath, Buffer.from(pdfBytes));
  await promisify(execFile)('pdftoppm', ['-r', '96', '-png', '-f', '1', '-l', '1', '-singlefile', pdfPath, join(outDir, `${name}-pdf`)]);
  let a = PNG.sync.read(screenshotPng);
  const b = PNG.sync.read(await readFile(join(outDir, `${name}-pdf.png`)));
  // Retina 等でスクリーンショットが整数倍のサイズになっていたら PDF 側の解像度に縮小する
  const scale = Math.round(a.width / b.width);
  if (scale > 1 && Math.abs(a.width / b.width - scale) < 0.02) a = downscale(a, scale);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const crop = (img) => {
    const out = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) img.data.copy(out.data, y * w * 4, y * img.width * 4, y * img.width * 4 + w * 4);
    return out;
  };
  const A = crop(a);
  const B = crop(b);
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(A.data, B.data, diff.data, w, h, { threshold: 0.25, includeAA: false });
  const diffPath = join(outDir, `${name}-diff.png`);
  await writeFile(diffPath, PNG.sync.write(diff));
  await writeFile(join(outDir, `${name}-ref.png`), screenshotPng);
  return { diffRatio: n / (w * h), diffPath };
}

/**
 * 整数倍のボックス平均で縮小する。
 * @param {PNG} img
 * @param {number} k
 */
function downscale(img, k) {
  const w = Math.floor(img.width / k);
  const h = Math.floor(img.height / k);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = ((y * k + dy) * img.width + (x * k + dx)) * 4;
          for (let c = 0; c < 4; c++) acc[c] += img.data[i + c];
        }
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out.data[o + c] = Math.round(acc[c] / (k * k));
    }
  }
  return out;
}

export { existsSync };
