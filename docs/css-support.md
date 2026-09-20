# 対応 CSS 一覧

レイアウト（位置・サイズ・行分割）はすべてブラウザの計算結果をそのまま使うため、`display` / Flexbox / Grid / テーブル / `position` / `margin` / `padding` / `width` / `height` / `white-space` / `word-break` / `text-align` / `vertical-align` / `line-height` / `letter-spacing` / `text-indent` などのレイアウト系プロパティは**追加実装なしで再現される**。以下は「描画」に関わるプロパティの対応状況。

未対応のプロパティが指定されていても例外にはならず、`onWarning` に `code: 'unsupported-css'` の警告が 1 プロパティにつき 1 回届く。

## テキスト

| プロパティ | 対応 | 備考 |
|---|---|---|
| `font-family` / `font-size` / `font-weight` / `font-style` | ✅ | `registerFont` で登録したフォントから CSS Fonts のマッチング規則（簡略版）で選ぶ。未登録ファミリーは `fontFallback` → 登録済み全フォントの順で探す |
| `color` | ✅ | `rgba()` のアルファは ExtGState で再現 |
| `letter-spacing` / `word-spacing` / `text-align: justify` / カーニング | ✅ | グリフ位置を 1 文字ずつ実測して `TJ` の調整値として出力するため、ブラウザの結果がそのまま出る |
| `text-decoration: underline` / `line-through` | ✅ | 位置・太さはフォントサイズからの近似（下線 = ベースライン + 0.08em、太さ = max(1px, size/14)） |
| `text-decoration: overline` / `wavy` / `dotted` | ❌ | 無視 |
| `text-transform` | ✅ | 文字数が変わらない変換のみ（`ß → SS` は無視） |
| `text-shadow` | ❌ | 警告 |
| `font-variant-*` / `font-feature-settings` | ⚠️ | 位置は実測なので合うが、GSUB によるグリフ置換（合字・tabular-nums）は反映されない（標準グリフで描く） |
| `writing-mode: vertical-*` | ❌ | 警告。縦書きは v1.x |
| `::before` / `::after` の `content` | ✅ | 引用文字列（`"※ "`、`\203B` エスケープ）のみ。`counter()` / `attr()` / `url()` は警告 |
| `opacity` | ✅ | 子孫の色・画像に乗算。グループ透過（重なり部分の合成）ではない |

## ボックス

| プロパティ | 対応 | 備考 |
|---|---|---|
| `display: none` | ✅ | その要素と子孫を走査せず、PDF に出力しない。場所も取らない。変換対象として渡したルート要素自身が `display: none` だと空の PDF になる |
| `visibility: hidden` / `collapse` | ✅ | その要素自身（背景・ボーダー・テキスト）は描かないが、レイアウト上の場所は残るため PDF では空白になり、ページ分割の判定にも効く。子孫で `visibility: visible` に戻せばその子孫だけ描画する |
| `background-color` | ✅ | border-box に塗る |
| `background-image: url()` | ✅ | 単一の `url()` のみ。`background-size`（auto / cover / contain / 長さ / %）、`background-position`、`background-clip`、`background-origin` に対応 |
| `background-repeat` | ⚠️ | `no-repeat` のみ。`repeat` 系は 1 回だけ描いて警告 |
| グラデーション / 複数背景 | ❌ | 警告 |
| `border-*-width` / `-style` / `-color` | ✅ | 辺ごと。`solid` は塗り矩形、`dashed` / `dotted` は破線ストローク、`double` / `groove` / `ridge` / `inset` / `outset` は solid で近似 |
| `border-collapse: collapse` | ✅ | セル境界の中心に線を描き、隣接セルで二重にならないようにする |
| `border-radius` | ✅ | 背景は角丸パス。ボーダーは 4 辺が同じ幅・色・スタイルのときだけ角丸ストローク、そうでなければ直線で近似して警告。楕円半径は水平方向の値で近似 |
| `box-shadow` | ❌ | 警告 |
| `outline` | ❌ | 警告 |
| `overflow: hidden` / `clip` / `auto` / `scroll` | ✅ | 子孫を padding-box（角丸込み）でクリップ。完全にはみ出した命令は出力せず、抽出テキストにも残らない。スクロール位置は 0 として扱う |
| `clip-path` / `mask` | ❌ | 警告 |
| `filter` / `backdrop-filter` / `mix-blend-mode` | ❌ | 警告 |
| `z-index` | ⚠️ | `position` 指定 + 数値 `z-index` の要素を安定ソート。厳密なスタッキングコンテキストの描画順ではない |

画面には出さずに PDF にだけ載せたい要素がある場合、`display: none` では消えてしまうので、画面外へ逃がす（`position: absolute; left: -10000px`）か、`@media print` に書いて `mediaPrint: true` で変換する。

```css
.pdf-only { display: none; }
@media print { .pdf-only { display: block; } }
```

## 画像

| 対象 | 対応 | 備考 |
|---|---|---|
| `<img>` PNG / GIF / WebP / SVG | ✅ | `<canvas>` でデコードして RGB + SMask（アルファ）で埋め込む。SVG はラスタライズされる |
| `<img>` JPEG | ✅ | 3 成分 JPEG は再圧縮せず DCTDecode でそのまま埋め込む。CMYK / グレースケールは canvas 経由で RGB 化 |
| `object-fit` / `object-position` | ✅ | fill / contain / cover / none / scale-down |
| クロスオリジン画像 | ⚠️ | `crossorigin="anonymous"` と CORS ヘッダーが必要。無いと `image-failed` 警告で枠だけになる |
| `<canvas>` / `<video>` / `<svg>`（インライン） | ❌ | 描かれない。`<svg>` は `<img src="x.svg">` にすれば画像として扱える |

## 変形

| プロパティ | 対応 | 備考 |
|---|---|---|
| `transform`（2D: translate / rotate / scale / skew / matrix） | ✅ | `transform-origin` 込み。要素の変形を一時的に外して計測し、`cm` で囲む |
| `transform: matrix3d()` / `perspective` | ❌ | 警告して無変形で描く |

## ページ

| プロパティ | 対応 | 備考 |
|---|---|---|
| `break-before: page` / `break-after: page`（`page-break-*: always`） | ✅ | 要素の上端／下端で強制改ページ |
| `break-inside: avoid`（`page-break-inside: avoid`） | ✅ | 要素をページ境界で分割しない |
| テキスト行・`<tr>`・`<thead>`・`<tfoot>`・`<img>` | ✅ | 常に分割しない |
| `<thead>` の繰り返し | ✅ | 表が次ページへ続くとき、先頭に thead を再描画 |
| `<tfoot>` の繰り返し | ✅ | 表が次ページへ続くとき、そのページの最後の行の直下に tfoot を再描画（ブラウザ印刷と同じ位置） |
| `break-before: avoid` / `break-after: avoid` / `orphans` / `widows` | ❌ | 無視（`break-inside: avoid` で代替） |
| `@page` | ❌ | 用紙サイズ・余白は `options.page` で指定 |
| `@media print` | ✅ | `mediaPrint: true` で `@media print {}` の中身を通常ルールとして適用（`@media screen {}` は除去） |
| ヘッダー／フッター | ✅ | `options.header` / `options.footer` の HTML テンプレート。`{{pageNumber}}` `{{totalPages}}` |

## Web Components

シャドウ DOM に対応している。変換時に対象要素を**宣言的シャドウ DOM**（`<template shadowrootmode>`）として直列化し、計測用の iframe 側でブラウザに本物のシャドウルートとして復元させるため、`<slot>` の割り当ても `:host` / `::slotted()` もブラウザが解決した結果がそのまま出る。

| 対象 | 対応 | 備考 |
|---|---|---|
| light DOM のカスタム要素 | ✅ | ホスト要素を直接渡してよい |
| シャドウ DOM のホスト要素 | ✅ | `open` なシャドウルートは `Element.getHTML()` で直列化して持ち込む。入れ子のシャドウ DOM も辿る |
| シャドウルート内の要素 | ✅ | `renderRoot.querySelector()` で取った要素も渡せる。そのツリーの `<style>` と `adoptedStyleSheets` は `stylesheets: 'inherit'`（既定）で引き継がれる |
| `<slot>` の割り当て解決 | ✅ | flat tree（`assignedNodes({ flatten: true })`）を辿る。割り当てが無ければフォールバック内容を描く |
| `:host` / `::slotted()` / `::part()` | ✅ | iframe 内にも本物のシャドウルートがあるため通常どおり適用される |
| `:defined` | ✅ | 文書に出てくるカスタム要素名の空のスタブを iframe 内に定義してマッチさせる |
| `adoptedStyleSheets` | ✅ | 直列化されないため、`sheet.cssRules` から CSS を取り出して `<style>` として持ち込む（文書・シャドウルートの両方） |
| `sheet.insertRule()` | ✅ | 上と同じ経路で反映される |
| `el.style.xxx = ...` | ✅ | `style` 属性として直列化されるので反映される |
| `closed` なシャドウルート | ❌ | 外から参照できないため直列化できない。中身は出ない |
| `Element.getHTML()` の無いブラウザ | ⚠️ | シャドウ DOM を持ち込めないので警告を出し、light DOM だけで変換する |

カスタム要素は iframe 側ではアップグレードされない（空のスタブが定義されるだけ）。JavaScript で後から DOM やスタイルを組み立てる要素は、**組み上がってから**変換する。

```js
await customElements.whenDefined('my-receipt');
await document.fonts.ready;
const pdf = await htmlToPdf(document.querySelector('my-receipt'));
```

## フォントファイル

| 形式 | 対応 |
|---|---|
| TrueType（`glyf` アウトライン）の静的 TTF | ✅ |
| OpenType/CFF（`.otf` の多く） | ❌ 明確なエラー |
| 可変フォント | ⚠️ デフォルトインスタンスのみ埋め込み（console.warn） |
| WOFF / WOFF2 / TTC | ❌ 明確なエラー |
