# Receipt html to pdf

`@hidemikimura/receipt-html-to-pdf`

ブラウザ内だけで HTML/CSS を**テキスト選択・検索可能なベクター PDF** に変換する JavaScript ライブラリ。第一の用途は日本の適格請求書（インボイス）要件を満たす領収証の PDF 出力。

- サーバー不要、ランタイム依存ゼロ、素の JavaScript（ESM）+ JSDoc 型
- レイアウトはブラウザに任せ（非表示 iframe で描画して計測）、描画だけを PDF 命令へ変換
- 日本語フォントをサブセット化して埋め込み（TrueType `glyf` アウトラインの静的 TTF）

**ドキュメント: https://hidemikimura.github.io/receipt-html-to-pdf/** （[デモ](https://hidemikimura.github.io/receipt-html-to-pdf/demo.html) / [API リファレンス](https://hidemikimura.github.io/receipt-html-to-pdf/api.html) / [対応 CSS 一覧](https://hidemikimura.github.io/receipt-html-to-pdf/css.html)）

> **v0.1.0**（初回公開）— テキスト・背景・ボーダー・画像・角丸・2D transform・擬似要素・`overflow: hidden`・複数ページ（行を跨がない分割、`break-*`、`thead` / `tfoot` の繰り返し、ヘッダー／フッター）に対応。依存ゼロ、minify バンドルは gzip 19KB。
> Chromium / Firefox / WebKit の 3 ブラウザで Playwright テスト（テキスト抽出・ページ分割・画素差分）に合格。対応 CSS は [docs/css-support.md](docs/css-support.md)、設計と経緯は [docs/design.md](docs/design.md)、変更履歴は [CHANGELOG.md](CHANGELOG.md)。

## 使い方

```js
import { registerFont, htmlToPdf, downloadPdf } from '@hidemikimura/receipt-html-to-pdf';

await registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
await registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' });

const pdf = await htmlToPdf(document.querySelector('#receipt'), {
  page: { size: 'A4', margin: '15mm' },
  footer: '<div style="text-align:center;font-size:8pt">{{pageNumber}} / {{totalPages}}</div>',
  metadata: { title: '領収証 No. R-2026-000123' },
  onWarning: (w) => console.warn(w),
});
downloadPdf(pdf, 'receipt.pdf');
```

## API

| 関数 | 説明 |
|---|---|
| `registerFont({ family, weight?, style?, src })` | フォントを登録する。`src` は URL か `ArrayBuffer`。TrueType（glyf）の静的 TTF のみ。`@font-face` と同じファイルを渡す |
| `htmlToPdf(input, options?)` | `Element` または HTML 文字列を PDF にする。既定は `Blob` を返す（`output: 'uint8array' \| 'dataurl'`） |
| `downloadPdf(pdf, filename)` | ブラウザでダウンロードさせる補助 |
| `listFonts()` / `version` | 登録済みフォントの一覧、ライブラリのバージョン |

主なオプション（`ConvertOptions`、型は `types/index.d.ts`）: `page: { size, orientation, margin }`、`header` / `footer`（`{{pageNumber}}` `{{totalPages}}`）、`stylesheets: 'inherit' | 'none' | [url または CSS 文字列]`、`mediaPrint`、`fontFallback`、`metadata`、`compress`、`baseUrl`、`onWarning`。

サンプル: [`examples/vanilla.html`](examples/vanilla.html)（`npm run dev` 後に `/examples/vanilla.html`）、[`examples/react.jsx`](examples/react.jsx)、[`examples/lit.js`](examples/lit.js)（Shadow DOM では `stylesheets` に CSS を明示的に渡す）。

## インストール

```sh
npm install @hidemikimura/receipt-html-to-pdf
```

`import ... from '@hidemikimura/receipt-html-to-pdf'` でソース（ESM）、`'@hidemikimura/receipt-html-to-pdf/min'` で minify 済み単一ファイル（`npm run build` で生成）を読み込める。

## 開発

```sh
npm install
npm run fonts          # 参照フォント（BIZ UDPGothic）を fonts/ に取得
npm run dev            # http://localhost:5173/fixtures/receipt-invoice/ でフィクスチャを表示
npm run typecheck      # JSDoc 型検査
npm test               # 単体テスト（Vitest）
npm run e2e            # Chromium でフィクスチャを PDF 化 → out/*.pdf → pdf.js でテキスト抽出を検証
npm run test:browser   # Playwright: Chromium / Firefox / WebKit で変換・抽出・画素差分（要 npx playwright install）
npm run build -- --check   # dist/ に minify バンドルを生成し gzip 40KB 以下を検査
npm run types          # JSDoc から types/*.d.ts を生成
```

ブラウザテストの初回セットアップ（macOS）:

```sh
npx playwright install chromium firefox webkit   # ブラウザ本体を取得（Chromium は headless shell も含む）
brew install poppler                             # pdftoppm: 画素差分テストに必要（無ければスキップされる）
brew install qpdf                                # 任意: 生成 PDF の構造検査
```

環境変数: `CHROMIUM_PATH=/path/to/chrome` で Playwright 同梱以外の Chromium を使う。`BROWSERS=chromium,webkit` で `test:browser` の対象を絞る。画素差分テストは `pdftoppm`（poppler-utils）が無ければスキップされる。

CI（`.github/workflows/ci.yml`）は typecheck → 単体テスト → サイズ検査の後、3 ブラウザ並列でブラウザテストを流し、生成された PDF を `qpdf --check` で検証する。

## 対応範囲（v0.1.0）

| 対応 | 未対応（onWarning で通知） |
|---|---|
| テキスト（日本語・サブセット埋め込み・ToUnicode）、`color`、`opacity`、`text-decoration` | `box-shadow`、`text-shadow`、`filter`、`clip-path`、`outline`、縦書き |
| `background-color`、`border-*`（solid / dashed / dotted、辺ごと）、`border-collapse`、`border-radius` | 非均一ボーダー + 角丸（直線で近似）、グラデーション、`background-repeat`（1 回描画） |
| `<img>`（PNG 透過 / JPEG、`object-fit`）、`background-image: url()`（size / position）、`overflow: hidden` のクリップ | SVG のベクター化（画像として埋め込む） |
| `transform`（2D、`transform-origin`）、`::before` / `::after`（文字列 content） | 3D transform、`counter()` / `url()` content |
| 複数ページ: 行・`tr`・`thead`・`tfoot`・`<img>`・`break-inside: avoid` を跨がない分割、`break-before/after: page`、`thead` / `tfoot` の各ページ繰り返し、`header` / `footer` テンプレート（`{{pageNumber}}` `{{totalPages}}`） | `break-before/after: avoid`、`orphans` / `widows`、ページ番号による高さ変化 |
| レイアウト全般（Flexbox / Grid / テーブル / 禁則 / letter-spacing）はブラウザ計算をそのまま利用 | |

## フィクスチャ

`fixtures/receipt-invoice/` — 適格請求書の記載事項 6 項目（発行者名と登録番号、取引年月日、取引内容と軽減税率対象の旨、税率ごとの対価の額と適用税率、税率ごとの消費税額、交付を受ける事業者名）を含む領収証。角印（透過 PNG）とロゴ（JPEG）は `assets/` にあるサンプル画像。`expected.json` に PDF テキスト抽出で必ず含まれるべき文字列と金額を定義し、`variants.reissue`（`<body class="reissue">` で「再発行」の透かしを表示）も検証する。

`fixtures/receipt-invoice-long/` — 同じテンプレートで明細を 60 行にした複数ページ検証用。`npm run fixtures` (`scripts/gen-fixture-long.mjs`) で生成する。A4・余白 15mm・フッター付きで 3 ページになり、`thead` が 2 ページ目以降に繰り返される。

紙で交付する場合、税抜 5 万円以上の領収証には収入印紙が必要になる。電子データ（PDF）として交付する場合は印紙税の課税対象外のため、フィクスチャは印紙欄を持たない。

## AI エージェント向け skill

`skills/receipt-html-to-pdf/` に、Claude などのコーディングエージェントがこのライブラリを使うときに読む skill を同梱している。npm パッケージにも含まれるので、インストール済みならそのままコピーできる。

```sh
mkdir -p .claude/skills
cp -r node_modules/@hidemikimura/receipt-html-to-pdf/skills/receipt-html-to-pdf .claude/skills/
```

`SKILL.md` に使い方・フォントの制約・対応 CSS の要点・複数ページ制御をまとめ、`references/receipt-format.md` に適格請求書の記載事項、`references/troubleshooting.md` によくあるエラーと対処を置いている。

## ドキュメントサイト

`site/` が GitHub Pages で公開する静的サイト（依存ゼロ、日本語）。`.github/workflows/pages.yml` が main への push で `npm run site` を実行して deploy する。初回はリポジトリの Settings → Pages で Source を「GitHub Actions」にする必要がある。

```sh
npm run site        # site/ を組み立てる（dist のコピー、デモ用フォントのサブセット、css.html の生成）
npm run site:dev    # 組み立てて http://localhost:5174 で表示
```

`site/css.html` は `docs/css-support.md` から生成し、デモ用のフォントは `pyftsubset`（`pip install fonttools`）でデモに出る文字だけに絞る。どちらも生成物なので git には入れていない。

## 公開手順（メンテナ向け）

1. `CHANGELOG.md` に変更を書き、`package.json` と `src/index.js` の `version` を上げる（不一致はビルドで失敗する）
2. `npm run pack:check` で tarball の内容を確認する（`files` で許可リスト管理。フォント・フィクスチャ・テストは含まれない）
3. `npm login`（スコープ `@hidemikimura` の所有者アカウント）
4. `npm publish` — `prepublishOnly` が typecheck → 単体テスト → `.d.ts` 生成 → minify ビルド + サイズ検査を自動で流す。`publishConfig.access` が `public` なのでスコープ付きでも無料で公開される
5. `git tag v0.1.0 && git push --tags`

初回公開前に `package.json` の `repository` / `homepage` / `bugs` の URL（`github.com/hidemikimura/receipt-html-to-pdf` を仮置き）を実際のリポジトリに合わせること。

## ライセンス

MIT © 2026 Hidemi Kimura。参照フォント BIZ UDPGothic は SIL Open Font License 1.1。
