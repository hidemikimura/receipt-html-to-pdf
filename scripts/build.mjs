// esbuild で単一ファイル（ESM・minify）にバンドルし、gzip / brotli サイズを表示する。
// 使い方: node scripts/build.mjs [--check]   --check で gzip 40KB 超なら非 0 終了
import { build } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const LIMIT_GZIP = 40 * 1024;
const outfile = join(root, 'dist', 'receipt-html-to-pdf.min.js');
await mkdir(join(root, 'dist'), { recursive: true });

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
// src/index.js の version 定数が package.json と一致していることを確認する
const indexSrc = await readFile(join(root, 'src', 'index.js'), 'utf8');
const m = /export const version = '([^']+)'/.exec(indexSrc);
if (!m || m[1] !== pkg.version) {
  console.error(`src/index.js の version (${m?.[1]}) が package.json (${pkg.version}) と一致しません`);
  process.exit(1);
}
await build({
  entryPoints: [join(root, 'src', 'index.js')],
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome110', 'firefox113', 'safari16.4'],
  minify: true,
  sourcemap: true,
  outfile,
  banner: { js: `/* ${pkg.name} v${pkg.version} | MIT */` },
  legalComments: 'none',
});

const code = await readFile(outfile);
const gz = gzipSync(code, { level: 9 }).length;
const br = brotliCompressSync(code).length;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`dist/receipt-html-to-pdf.min.js  raw ${kb(code.length)}  gzip ${kb(gz)}  brotli ${kb(br)}  (limit gzip ${kb(LIMIT_GZIP)})`);
if (process.argv.includes('--check') && gz > LIMIT_GZIP) {
  console.error(`bundle exceeds gzip size limit: ${gz} > ${LIMIT_GZIP}`);
  process.exit(1);
}
