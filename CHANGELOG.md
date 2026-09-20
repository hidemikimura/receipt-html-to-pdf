# Changelog

設計と経緯の詳細は docs/design.md。

## 0.2.0 — シャドウ DOM 対応（2026-09-20）

### 追加

- **シャドウ DOM 対応**。カスタム要素のホストをそのまま `htmlToPdf()` に渡せるようになった。`open` なシャドウルートを宣言的シャドウ DOM（`<template shadowrootmode>`）として直列化し、計測用 iframe でブラウザに復元させる方式（docs/design.md 18 章）
  - `<slot>` の割り当てを flat tree で解決する。割り当てが無ければフォールバック内容を描く
  - `:host` / `::slotted()` / `::part()` が適用される
  - `adoptedStyleSheets`（Lit の `static styles`）と `document.adoptedStyleSheets` を CSS として持ち込む
  - シャドウルート内の要素を渡した場合、そのツリーのスタイルを `stylesheets: 'inherit'`（既定）で拾う
  - iframe 内にカスタム要素名の空のスタブを定義し、`:defined` をマッチさせる
  - `::before` / `::after` の実体化をシャドウツリーにも適用
  - 制約: `closed` なシャドウルートと、`Element.getHTML()` の無いブラウザは対象外（警告を出して light DOM だけ変換）
- ドキュメント: `docs/css-support.md` に「Web Components」の節、`display: none` / `visibility: hidden` の行
- AI エージェント向け skill（`skills/receipt-html-to-pdf/`）と GitHub Pages のドキュメントサイト（`site/`）

### その他

- minify バンドル: gzip 18.8KB → 19.6KB

## 0.1.0 — 初回公開（2026-09-18）

npm への最初の公開バージョン。開発中の内部マイルストーン（下記 0.1〜1.0）をまとめて 0.1.0 として出す。
API（`registerFont` / `htmlToPdf` / `downloadPdf` / `listFonts` / `version`、`ConvertOptions`）は 1.0.0 までは変更の可能性がある。

### 開発マイルストーン（内部、未公開）

#### 1.0 相当

- npm 公開準備: `private` を外し `publishConfig.access: public`、`repository` / `homepage` / `bugs`、`prepublishOnly`（typecheck → test → types → build --check）、`files` 許可リスト、tarball からのインストール検証

- `overflow: hidden` / `clip` / `auto` / `scroll` の要素で子孫を padding-box（角丸込み）にクリップ。完全にはみ出した命令は捨て、抽出テキストにも残らない
- `<tfoot>` を、表が次ページへ続く各ページの最後の行の直下に繰り返す
- サンプル（`examples/`: Vanilla JS / React / Lit）、`version` エクスポート、CHANGELOG

#### 0.4 相当

- Playwright ブラウザテスト（Chromium / Firefox / WebKit）: テキスト抽出照合・ページ数・thead の繰り返し・画素差分・エラー／警告
- esbuild による minify バンドル（`dist/`、`./min` エクスポート）と gzip 40KB 以下の検査（実測 18KB）
- `docs/css-support.md`、GitHub Actions ワークフロー（3 ブラウザ + qpdf --check）
- 修正: Desktop Safari プリセットの `deviceScaleFactor: 2` で画素差分が破綻していた

#### 0.3 相当

- 複数ページ: テキスト行・`tr`・`thead`・`<img>`・`break-inside: avoid` を跨がない分割、`break-before/after: page`
- `<thead>` を 2 ページ目以降の先頭に繰り返す
- `header` / `footer` テンプレート（`{{pageNumber}}` `{{totalPages}}`）
- 明細 60 行のフィクスチャ `fixtures/receipt-invoice-long`

#### 0.2 相当

- 画像: `<img>`（PNG 透過 → SMask、JPEG → DCTDecode そのまま）、`background-image: url()`、`object-fit` / `background-size` / `position`
- `border-radius`、2D `transform`（`transform-origin` 込み）、`::before` / `::after` の文字列 content、画像への `opacity`
- 要素入力時に `<html>` / `<body>` の属性を iframe に写す（`body.reissue .x` などの祖先依存セレクタ）

#### 0.1 相当

- PDF Writer（xref・FlateDecode・日本語メタデータ）、TrueType パース／サブセット／CIDFontType2 + ToUnicode
- iframe レンダラー、DOM Walker（テキスト・背景・ボーダー）、単一ページ出力
- ベースラインはプローブ方式、グリフ位置は 1 文字ずつ実測して `TJ` の調整値に
