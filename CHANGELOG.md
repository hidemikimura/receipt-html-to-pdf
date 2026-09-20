# Changelog

設計と経緯の詳細は docs/design.md。

## 0.4.0 — リンク注釈としおり（2026-09-20）

### 追加

- **リンク注釈に対応**。`<a href>` を PDF のリンク注釈（`/Annot /Link`）にする。既定で有効、止めるなら `links: false`（docs/design.md 26 章）
  - 外部 URL・`mailto:` / `tel:`・文書内リンク（`href="#id"` → その要素が載るページへ `/Dest [page /XYZ]`）。`<a name>` も飛び先になる
  - 折り返したインラインリンクは行ごとに、ページ境界を跨ぐリンクはページごとに切り取って注釈を作る
  - ヘッダー／フッターの中のリンクも各ページに出る
  - `javascript:` と、飛び先の無い `#id` は注釈にしない。相対 URL は `baseUrl` で解決する
  - `transform` の中のリンクは外接矩形で近似する（PDF の注釈は軸並行の矩形しか持てないため）
- **`outline: true` でしおり（`/Outlines`）を作る**。`h1`〜`h6` の入れ子から目次の木を組み立て、各項目をその見出しのページへ飛ばす。既定は作らない

## 0.3.0 — 描画と大きな文書の強化（2026-09-20）

### 追加

- **`onProgress` を追加**。`render` → `walk` → `layout`（総ページ数が確定）→ `page`（1 ページずつ）→ `done` の順に進み具合を通知する（docs/design.md 25 章）
- **長い変換でメインスレッドを占有しなくなった**。12ms ごとにイベントループへ戻す（`scheduler.yield()` があればそれを使う）。3000 行・130 ページの文書で、走査中に描画されるフレーム数が 0 → 5、変換全体の最長フレーム間隔が 934ms → 181ms。所要時間の増加は約 9%
- **埋め込み後にデコード済み画像データを解放する**。以前はデコード結果（RGB・アルファ）が URL キーのキャッシュに永久に残っていた。600×600 の透過 PNG 12 枚で、変換後に残るメモリが約 17MB → 1.3MB。次の変換では読み直しになる（速度よりメモリを優先）
- **`background-repeat` に対応**。`repeat` / `no-repeat` / `repeat-x` / `repeat-y` / `space` / `round` と、軸ごとの 2 値指定（`repeat space` など）
  - タイルは同じ画像 XObject を参照するので、繰り返しても画像の埋め込みは 1 回だけ
  - `round` はタイルの大きさを調整して整数個収め、`space` は余りを隙間に等分する（CSS 仕様どおり）
  - タイルが 4000 枚を超える場合のみ、1 枚だけ描いて警告する
- **GSUB の単一置換に対応**。ブラウザが `font-variant-numeric` / `-caps` / `-east-asian` / `font-feature-settings` で有効にした機能と同じグリフ置換を PDF でも行う（docs/design.md 23 章）
  - `zero`（スラッシュ付きゼロ）、`jp78` / `jp83` / `jp90` / `jp04` / `nlck` / `trad` / `smpl`（旧字体・異体字）、`fwid` / `hwid`、`smcp` など
  - 置換は埋め込み前に解決するので、GSUB テーブル自体は PDF に入らない。抽出テキストは元の文字のまま（ToUnicode は変えない）
  - 合字（`liga` / `dlig`、Lookup タイプ 4）は未対応。既定で有効な機能（`ccmp` / `liga` / `calt`）は適用しない
  - 調査の結果 `tabular-nums` は日本語フォントに `tnum` 機能が無く効かないことが分かったため、数字の桁揃えはフォント選択で解決する旨をドキュメントに明記した
- **インライン `<svg>` のベクター変換に対応**。ラスタライズせず PDF のパスとして出すので、拡大しても滑らかで、テキスト以外の図形はそのまま印刷品質になる（docs/design.md 22 章）
  - `<path>` の全コマンド（`M L H V C S Q T A Z`、相対・絶対）。円弧と二次ベジェは 3 次ベジェへ変換
  - `<rect>`（`rx` / `ry`）・`<circle>`・`<ellipse>`・`<line>`・`<polyline>`・`<polygon>`・`<g>`・入れ子の `<svg>`
  - `fill` / `fill-rule` / `fill-opacity`、`stroke` と `-width` / `-opacity` / `-linecap` / `-linejoin` / `-miterlimit` / `-dasharray` / `-dashoffset`、`opacity`、`visibility`
  - `viewBox` / `preserveAspectRatio` / `transform` は `getScreenCTM()` の結果をそのまま使う
  - `<svg>` はページ境界で分割しない
  - `<text>` / `<use>` / paint server（`fill="url(#id)"`）は警告して飛ばす。`<img src="x.svg">` は従来どおりラスタライズ
- **`linear-gradient` に対応**。PDF の軸シェーディング（ShadingType 2）としてベクター出力するので、拡大しても滑らかで、ファイルも軽い（docs/design.md 21 章）
  - 角度（`<n>deg` / `to <side>` / `to <side> <side>`）、色止めの `%` / `px` / 位置省略（等間隔）/ 二重指定、単調化に対応
  - 色止めごとにアルファが変わる場合（`transparent` → `black` など）は輝度ソフトマスクで正確に再現する
  - `background-origin` / `background-clip` / `border-radius` を尊重する
  - `repeating-linear-gradient` / `radial-gradient` / `conic-gradient` / 複数背景は従来どおり警告
- **`break-before: avoid` / `break-after: avoid`（`page-break-*: avoid`）に対応**。隣の箱との間にページ境界を置かず、置きそうなら前の箱の先頭まで境界を戻す。見出しがページ末尾に取り残されるのを防げる
  - 兄弟が無ければ親をさかのぼるので、`<section>` の最後の見出しに書いても次の `<section>` と結びつく
  - 境界は次の箱の上端ではなく**最初の行**まで判定する（`line-height` の半行分だけ箱の上端より下に来るため）
  - 結んだ範囲が 1 ページに収まらない場合と、戻すとページが空になる場合は諦めて普通に分割する

## 0.2.1 — 右端が切れる不具合の修正（2026-09-20）

### 追加

- 内容が本文領域より横に広いとき、`onWarning` に `other` の警告を出すようにした（はみ出し量つき）。これまでは右端が黙って切れていた

### 修正

- **親文書の `body` マージンが PDF に持ち込まれ、内容が右へずれて右端が切れていた**。iframe に差し込むリセットは収集したスタイルより前に置かれるため、ページ側の `body { margin: … }` に負けていた。`!important` で確実に打ち消すようにした（用紙の余白は `options.page.margin` が受け持つ）
- `examples/cdn.html` の `#receipt` に `box-sizing: border-box` が無く、`padding` と `border` の分だけ右端が切れていた

### ドキュメント

- CDN から読み込む使い方を追加（README / API リファレンス / サイトのクイックスタート / skill）。`dist/` の minify 済みファイルは依存ゼロの単一 ESM なので、jsDelivr や unpkg の URL をそのまま `import` できる
- `examples/cdn.html` を追加。ファイル 1 つ、ビルドもバンドラーも無しで動く領収証 PDF の例
- 通常の `<script>` から使う方法（`import * as ReceiptHtmlToPdf` して `window` に載せる）と、モジュールスクリプトの実行順の注意を明記

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
