// out/<fixture>.pdf を pdf.js で読み戻し、fixtures/<fixture>/expected.json の mustContain を検証する。
// 使い方: node scripts/verify.mjs [fixture-name] [variant]
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixture = process.argv[2] ?? 'receipt-invoice';
const variant = process.argv[3] ?? null;
const expected = JSON.parse(await readFile(join(root, 'fixtures', fixture, 'expected.json'), 'utf8'));
const mustContain = [...expected.mustContain, ...(variant ? expected.variants?.[variant]?.mustContain ?? [] : [])];
const data = new Uint8Array(await readFile(join(root, 'out', `${fixture}${variant ? `-${variant}` : ''}.pdf`)));

const pdf = await getDocument({ data, useSystemFonts: false, disableFontFace: true }).promise;
const meta = await pdf.getMetadata();
let text = '';
/** @type {string[]} ページごとのテキスト */
const pageTexts = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  // 同じ行の item はそのまま連結し、改行だけ挿入する
  let lastY = null;
  let pt = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 1) pt += '\n';
    pt += item.str;
    lastY = y;
  }
  pageTexts.push(pt);
  text += pt + '\n';
}

const normalize = (s) => s.replace(/[ 　\t]+/g, ' ').trim();
const haystack = normalize(text);
// 回転テキストなどは pdf.js が 1 文字ずつ別 item にするため、空白を全部取った形でも照合する
const compact = text.replace(/\s+/g, '');
let failed = 0;
for (const s of mustContain) {
  const ok = haystack.includes(normalize(s)) || compact.includes(s.replace(/\s+/g, ''));
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${s}`);
}
if (expected.expectedPages !== undefined) {
  const ok = pdf.numPages === expected.expectedPages;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} pages = ${pdf.numPages} (expected ${expected.expectedPages})`);
}
for (const s of expected.mustContainOnEveryPage ?? []) {
  const missing = pageTexts.map((t, i) => (normalize(t).includes(normalize(s)) ? null : i + 1)).filter((v) => v !== null);
  if (missing.length) failed++;
  console.log(`${missing.length ? 'FAIL' : 'ok  '} on every page: ${s}${missing.length ? ` (missing on page ${missing.join(', ')})` : ''}`);
}
console.log(`\npages: ${pdf.numPages}, title: ${meta.info.Title ?? '(none)'}, producer: ${meta.info.Producer}`);
console.log(failed ? `\n${failed} string(s) missing from extracted text` : '\nall expected strings present');
process.exit(failed ? 1 : 0);
