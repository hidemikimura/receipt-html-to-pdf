// ドキュメントサイト（site/）のビルド。
// 依存ゼロの静的サイトなので「ライブラリ本体とデモ用フォントを site/assets/ に配置する」だけ。
//   node scripts/build-site.mjs
// フォントのサブセット化には fonttools（pyftsubset）が要る:  pip install fonttools
// 無い場合はスキップし、デモページが案内を出す。
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const root = resolve(new URL('..', import.meta.url).pathname);
const site = join(root, 'site');
const exists = (p) => access(p).then(() => true, () => false);

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

// 1. ライブラリ本体（minify 済み）を配置する
await mkdir(join(site, 'assets', 'lib'), { recursive: true });
const dist = join(root, 'dist', 'receipt-html-to-pdf.min.js');
if (!(await exists(dist))) {
  console.error('dist が無い。先に `npm run build` を実行すること。');
  process.exit(1);
}
await copyFile(dist, join(site, 'assets', 'lib', 'receipt-html-to-pdf.min.js'));

// 2. サイトに埋め込むメタ情報（バージョン等）を生成する
await writeFile(
  join(site, 'assets', 'lib', 'meta.js'),
  `// scripts/build-site.mjs が生成。直接編集しない。\n` +
    `export const meta = ${JSON.stringify({ version: pkg.version, name: pkg.name, repository: pkg.repository.url.replace(/^git\+|\.git$/g, '') }, null, 2)};\n`,
);

// 3. デモ用フォント（JIS 第1水準まで）を生成する
await mkdir(join(site, 'assets', 'fonts'), { recursive: true });
const charset = join(root, 'scripts', 'demo-charset.txt');
let made = 0;
for (const weight of ['Regular', 'Bold']) {
  const src = join(root, 'fonts', `BIZUDPGothic-${weight}.ttf`);
  const out = join(site, 'assets', 'fonts', `BIZUDPGothic-${weight}-subset.ttf`);
  if (await exists(out)) {
    console.log(`skip  ${out} (既にある)`);
    made++;
    continue;
  }
  if (!(await exists(src))) {
    console.warn(`warn  ${src} が無い。\`npm run fonts\` で取得する。`);
    continue;
  }
  try {
    await run('pyftsubset', [
      src,
      `--text-file=${charset}`,
      '--layout-features=',
      '--no-hinting',
      '--drop-tables+=DSIG,GSUB,vhea,vmtx,meta',
      `--output-file=${out}`,
    ]);
    const { size } = await import('node:fs').then((m) => m.promises.stat(out));
    console.log(`build ${out} (${(size / 1024).toFixed(0)} KB)`);
    made++;
  } catch (e) {
    console.warn(`warn  pyftsubset に失敗した（pip install fonttools が必要）: ${e.message.split('\n')[0]}`);
  }
}

await writeFile(join(site, 'assets', 'fonts', 'STATUS.json'), JSON.stringify({ ready: made === 2 }) + '\n');
console.log(made === 2 ? 'site/ の準備ができた。' : 'フォントが揃っていない。デモは案内を表示する。');

// 4. docs/css-support.md から site/css.html を生成する（一次情報を二重に持たないため）
const md = await readFile(join(root, 'docs', 'css-support.md'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/✅/g, '<span class="yes">✅</span>')
    .replace(/⚠️/g, '<span class="partial">⚠️</span>')
    .replace(/❌/g, '<span class="no">✕</span>');

/** md の限られた構文（見出し・表・段落）だけを HTML にする */
function renderMarkdown(src) {
  const lines = src.split('\n');
  const out = [];
  const headings = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,3} /.test(line)) {
      flush();
      const level = line.match(/^#+/)[0].length;
      const text = line.replace(/^#+ /, '');
      if (level === 1) continue; // h1 はページ側で出す
      const id = `sec-${headings.length + 1}`;
      headings.push({ id, text });
      out.push(`<h2 id="${id}">${inline(text)}</h2>`);
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.slice(1, r.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
          body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
          `</tbody></table>`,
      );
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return { html: out.join('\n'), headings };
}

const { html: cssBody, headings } = renderMarkdown(md);
const nav = (current) =>
  [
    ['./', 'はじめに'],
    ['./demo.html', 'デモ'],
    ['./api.html', 'API'],
    ['./css.html', '対応 CSS'],
  ]
    .map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('\n    ');

await writeFile(
  join(site, 'css.html'),
  `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>対応 CSS 一覧 — Receipt html to pdf</title>
<meta name="description" content="どの CSS プロパティが PDF に出力され、どれが無視されるかの一覧。">
<link rel="stylesheet" href="./assets/site.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='14'>🧾</text></svg>">
</head>
<body>
<header class="site-header">
  <a class="brand" href="./">Receipt html to pdf<span class="ver" data-version>v${pkg.version}</span></a>
  <nav class="site-nav">
    ${nav('./css.html')}
  </nav>
  <span class="spacer"></span>
  <a class="ext" href="https://github.com/hidemikimura/receipt-html-to-pdf">GitHub</a>
  <a class="ext" href="https://www.npmjs.com/package/@hidemikimura/receipt-html-to-pdf">npm</a>
</header>

<main>
  <h1>対応 CSS 一覧</h1>
  <p class="lead">v${pkg.version} 時点で、どの CSS プロパティが PDF に出力され、どれが無視されるかの一覧です。</p>
  <div class="toc">
    <strong>目次</strong>
    <ul>${headings.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul>
  </div>
${cssBody}
  <div class="note">
    <p>このページは <a href="https://github.com/hidemikimura/receipt-html-to-pdf/blob/main/docs/css-support.md"><code>docs/css-support.md</code></a> から生成しています。内容の修正はそちらへ。</p>
  </div>
</main>

<footer class="site-footer">
  <a href="https://github.com/hidemikimura/receipt-html-to-pdf">GitHub</a> ·
  <a href="./demo.html">デモ</a> ·
  <a href="./api.html">API リファレンス</a>
</footer>
</body>
</html>
`,
);
console.log('build site/css.html (docs/css-support.md から生成)');
