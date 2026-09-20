---
name: receipt-html-to-pdf
description: ブラウザ内で HTML/CSS をテキスト選択可能なベクター PDF に変換する @hidemikimura/receipt-html-to-pdf を使うときに読む。領収証・請求書・納品書など日本語帳票の PDF 出力、htmlToPdf / registerFont の使い方、フォント選定の制約、対応 CSS、複数ページ制御、よくあるエラーの対処を含む。
---

# Receipt html to pdf

サーバーを使わず、ブラウザの中だけで HTML/CSS を**テキスト選択・検索できるベクター PDF** に変換するライブラリ。日本の領収証・適格請求書の出力を主な用途に作られている。依存ゼロ、minify で gzip 19KB。

レイアウトエンジンは持たない。非表示 iframe に HTML を描画してブラウザが計算した座標を読み取り、それを PDF の描画命令に変換する。つまり **Flexbox・Grid・テーブル・日本語の行分割と禁則は、ブラウザが表示したとおりに出る**。実装が担当するのは「見えているものを同じ位置に PDF へ書き出すこと」だけ。

## 最初に確認すること

作業を始める前に、次の 3 点を満たせるか確かめる。満たせないなら設計を変える必要がある。

1. **ブラウザで動くか** — Node では動かない（DOM のレイアウト計算が必要）。サーバー側で PDF が要るなら Puppeteer など別の手段を使う。
2. **埋め込むフォントファイルを用意できるか** — ブラウザは OS のフォントを読めないので、アプリ側が TTF を渡す。後述の制約あり。
3. **必要な CSS が対応範囲か** — `box-shadow`・グラデーション・縦書きなどは出力されない（例外にはならず警告が出る）。

## 使い方

```sh
npm install @hidemikimura/receipt-html-to-pdf
```

```js
import { registerFont, htmlToPdf, downloadPdf } from '@hidemikimura/receipt-html-to-pdf';

// 1. フォント登録はアプリ起動時に 1 回だけ。パース結果はキャッシュされる。
await registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' });
await registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' });

// 2. 変換する要素は DOM 上にあり、スタイルが適用済みであること。
const pdf = await htmlToPdf(document.getElementById('receipt'), {
  page: { size: 'A4', margin: '15mm' },
  metadata: { title: '領収証 No. R-2026-000123', author: '株式会社サンプル商店' },
  onWarning: (w) => console.warn(w.code, w.message),
});

downloadPdf(pdf, 'receipt.pdf');
```

`htmlToPdf` は既定で `Blob` を返す。`output: 'uint8array'` でバイト列、`'dataurl'` で data URL。サーバーへ送るなら `Blob` のまま `FormData` に入れればよい。

## フォント: ここが一番詰まる

**HTML 側の `@font-face` と `registerFont` に同じファイルを渡すこと。** ブラウザが計測に使うフォントと PDF に埋め込むグリフが一致していないと、文字幅がずれる。

```css
@font-face { font-family: "BIZ UDPGothic"; font-weight: 400; src: url("/fonts/BIZUDPGothic-Regular.ttf"); }
```

使えるフォントファイルの制約:

| 形式 | 可否 |
|---|---|
| TrueType（`glyf` アウトライン）の**静的** TTF | ✅ |
| OpenType/CFF（`.otf` の多く） | ❌ `CFF outlines are not supported` で例外 |
| 可変フォント（`fvar` あり） | ⚠️ デフォルトインスタンスだけ埋め込まれ、Bold などは出ない（console.warn） |
| WOFF / WOFF2 / TTC | ❌ 例外 |

推奨は **BIZ UDPGothic**（Regular / Bold、SIL OFL、Google Fonts の静的 TTF）。

**Noto Sans JP に注意**: Google Fonts 配布版は可変フォント（`NotoSansJP[wght].ttf`）で Bold が出ない。GitHub の notofonts 配布版 OTF は CFF で埋め込めない。Noto を使うなら `fonttools varLib.instancer` で静的 TTF にインスタンス化したものを渡す。

日本語フォントは 4〜5MB ある。初回ロードを軽くしたいなら、使う文字に絞ってサブセット化した TTF を配信する（`pyftsubset` など）。`registerFont` は URL のほか `ArrayBuffer` も受け取る。

## 主なオプション

| オプション | 既定 | 説明 |
|---|---|---|
| `page.size` | `'A4'` | `A3` `A4` `A5` `B4` `B5` `Letter` `Legal` または `{ width: '80mm', height: '200mm' }` |
| `page.orientation` | `'portrait'` | `'landscape'` |
| `page.margin` | `'15mm'` | 文字列で四辺共通、`{ top, right, bottom, left }` で個別 |
| `header` / `footer` | `null` | 各ページに合成する HTML。`{{pageNumber}}` `{{totalPages}}` を置換 |
| `stylesheets` | `'inherit'` | 親文書の `<style>` / `<link>` を継承。`'none'`、または URL・CSS 文字列の配列 |
| `mediaPrint` | `false` | `@media print {}` の中身を通常ルールとして適用（`@media screen {}` は除去） |
| `fontFallback` | `[]` | 未登録ファミリーが要求されたときに試す family 名の順序 |
| `metadata` | — | `title` `author` `subject` `keywords` `creator` `creationDate`。日本語可 |
| `compress` | `true` | `CompressionStream` があれば FlateDecode |
| `baseUrl` | 現在の文書 | 相対 URL（フォント・画像）の基準 |
| `output` | `'blob'` | `'uint8array'` `'dataurl'` |
| `onWarning` | — | 未対応 CSS・欠落グリフ・画像失敗の通知。**必ず配線する** |

## 対応している CSS の要点

レイアウト系（`display` 全般・Flexbox・Grid・テーブル・`position`・`margin`・`padding`・`white-space`・`word-break`・`text-align`・`line-height`・`letter-spacing`）は**ブラウザの計算結果をそのまま使うので全部そのとおりに出る**。追加実装は不要。

描画系で対応しているもの: `color`、`background-color`、`background-image: url()`（単一・`no-repeat`）、`border-*`（辺ごと、solid / dashed / dotted）、`border-collapse: collapse`、`border-radius`、`opacity`、`text-decoration`（underline / line-through）、`overflow: hidden` のクリップ、`<img>`（PNG 透過・JPEG・`object-fit`）、2D `transform`、`::before` / `::after`（引用文字列の `content` のみ）。

**出力されないもの**（`onWarning` に `unsupported-css` が届く）: `box-shadow`、`text-shadow`、グラデーション、`filter`、`clip-path`、`outline`、縦書き、3D transform、`counter()` の content、インライン `<svg>` / `<canvas>` / `<video>`。

代替の指針: 影 → ボーダーか薄い背景色。グラデーション → 単色か画像。インライン SVG → `<img src="x.svg">`（ラスタライズされて埋め込まれる）。

全プロパティの詳細表は `docs/css-support.md`。

## 複数ページ

ページ分割は「命令を動かさず、ページごとに描く範囲を決める」方式。境界は次のものを跨がない位置まで自動で繰り上がる。

- テキストの行、`<tr>`、`<thead>`、`<tfoot>`、`<img>`
- `break-inside: avoid`（`page-break-inside: avoid`）を指定した要素

強制改ページは `break-before: page` / `break-after: page`（`page-break-*: always` も可）。表が次ページへ続くときは **`<thead>` が各ページ先頭に、`<tfoot>` がそのページ最後の行の直下に**自動で繰り返される。

ページ番号を入れるなら:

```js
footer: '<div style="text-align:center;font-size:8pt">{{pageNumber}} / {{totalPages}}</div>'
```

`orphans` / `widows` / `break-*: avoid` / `@page` は未対応。用紙サイズと余白は `options.page` で指定する。

## 変換対象の要素についての決まり

- 要素は **DOM 上にあり、スタイルとフォントが適用済み**であること。`document.fonts.ready` を待ってから呼ぶと確実。
- 要素を渡すと、親文書の `<html>` / `<body>` の属性（class・lang・data-*）も内部 iframe に写される。`body.reissue .watermark { display: block }` のような祖先依存のセレクタがそのまま効く。
- **Web Components**: light DOM のカスタム要素はホスト要素をそのまま渡してよい。**シャドウ DOM のホスト要素を渡すと中身が出ない**（`outerHTML` にシャドウルートが含まれず、走査も `shadowRoot` を辿らない）。`renderRoot.querySelector('.receipt')` のようにシャドウルート内の要素を渡し、親文書のスタイルは継承されないので `stylesheets: [cssText]` で CSS を明示する（Lit などで必要。`examples/lit.js` 参照）。`<slot>` の割り当ても解決しない。
- iframe 側ではカスタム要素の定義が読み込まれずアップグレードされないので、`:defined` はマッチしない（`my-el:defined { display: block }` は効かず既定の `display: inline` で組まれる）。`adoptedStyleSheets` と `sheet.insertRule()` で足したルールも `stylesheets: 'inherit'` では拾えない。`el.style.xxx` は `style` 属性として直列化されるので反映される。
- `connectedCallback` で DOM を組む要素は、`customElements.whenDefined()` と `document.fonts.ready` を待ってから変換する。
- HTML 文字列も渡せる。その場合 `stylesheets` を明示するのが確実。
- `display: none` の要素は子孫ごと出力されない（場所も取らない）。渡したルート要素自身が `display: none` だと空の PDF になる。`visibility: hidden` は描かれないが場所は残るので、PDF 上は空白になる。
- **画面に出さずに PDF にだけ載せたい**ときは `display: none` ではなく、画面外へ逃がす（`position: absolute; left: -10000px`）か、`@media print` に書いて `mediaPrint: true` で変換する。
- クロスオリジン画像には `crossorigin="anonymous"` と CORS ヘッダーが要る。無いと `image-failed` 警告になり、その画像だけ描かれない。

## 日本の領収証を作るとき

適格請求書（インボイス）の記載事項、消費税の端数処理、収入印紙の扱いは `references/receipt-format.md` を読む。**領収証 HTML を新しく生成するなら必ず参照すること**（記載漏れがあると買い手が仕入税額控除を受けられない）。

## エラーが出たら

`references/troubleshooting.md` に症状別の原因と対処をまとめてある。よくあるもの:

- `no fonts registered` → `registerFont` を `htmlToPdf` より先に await する
- `CFF outlines are not supported` → OTF ではなく静的 TTF を渡す
- 文字が □ になる → そのフォントにグリフが無い（`missing-glyph` 警告に該当文字が出る）
- 文字がずれる → `@font-face` と `registerFont` のファイルが違う
- 何も描かれない → 要素が `display:none`、または Shadow DOM でスタイルが届いていない
