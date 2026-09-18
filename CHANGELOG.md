# Changelog

すべて 2026-09-16 の作業。設計と経緯の詳細は docs/design.md。

## 1.0.0

- npm 公開準備: `private` を外し `publishConfig.access: public`、`repository` / `homepage` / `bugs`、`prepublishOnly`（typecheck → test → types → build --check）、`files` 許可リスト、tarball からのインストール検証

- `overflow: hidden` / `clip` / `auto` / `scroll` の要素で子孫を padding-box（角丸込み）にクリップ。完全にはみ出した命令は捨て、抽出テキストにも残らない
- `<tfoot>` を、表が次ページへ続く各ページの最後の行の直下に繰り返す
- サンプル（`examples/`: Vanilla JS / React / Lit）、`version` エクスポート、CHANGELOG
- API を凍結（`registerFont` / `htmlToPdf` / `downloadPdf` / `listFonts` と `ConvertOptions`）。以後の破壊的変更はメジャーバージョンを上げる

## 0.4.0

- Playwright ブラウザテスト（Chromium / Firefox / WebKit）: テキスト抽出照合・ページ数・thead の繰り返し・画素差分・エラー／警告
- esbuild による minify バンドル（`dist/`、`./min` エクスポート）と gzip 40KB 以下の検査（実測 18KB）
- `docs/css-support.md`、GitHub Actions ワークフロー（3 ブラウザ + qpdf --check）
- 修正: Desktop Safari プリセットの `deviceScaleFactor: 2` で画素差分が破綻していた

## 0.3.0

- 複数ページ: テキスト行・`tr`・`thead`・`<img>`・`break-inside: avoid` を跨がない分割、`break-before/after: page`
- `<thead>` を 2 ページ目以降の先頭に繰り返す
- `header` / `footer` テンプレート（`{{pageNumber}}` `{{totalPages}}`）
- 明細 60 行のフィクスチャ `fixtures/receipt-invoice-long`

## 0.2.0

- 画像: `<img>`（PNG 透過 → SMask、JPEG → DCTDecode そのまま）、`background-image: url()`、`object-fit` / `background-size` / `position`
- `border-radius`、2D `transform`（`transform-origin` 込み）、`::before` / `::after` の文字列 content、画像への `opacity`
- 要素入力時に `<html>` / `<body>` の属性を iframe に写す（`body.reissue .x` などの祖先依存セレクタ）

## 0.1.0

- PDF Writer（xref・FlateDecode・日本語メタデータ）、TrueType パース／サブセット／CIDFontType2 + ToUnicode
- iframe レンダラー、DOM Walker（テキスト・背景・ボーダー）、単一ページ出力
- ベースラインはプローブ方式、グリフ位置は 1 文字ずつ実測して `TJ` の調整値に
