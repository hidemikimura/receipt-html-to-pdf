# Receipt html to pdf 設計書

- 作成日: 2026-09-16（同日、方針確定）
- 作成者: 木村英実（ecx Inc.）
- ステータス: **0.1.0 公開済み**（2026-09-18）。機能は内部マイルストーン v1.0 まで完了、API は 1.0.0 まで変更の可能性あり
- ライブラリ名: **Receipt html to pdf**
- npm パッケージ名: `@hidemikimura/receipt-html-to-pdf` — **0.1.0 を npm に公開済み**（2026-09-18。`npm view` で version 0.1.0 / 41 ファイルを確認、別プロジェクトからのインストールと import も確認）
- 実装言語: 素の JavaScript（ESM）+ JSDoc 型注釈（`checkJs` で型検査、`.d.ts` は JSDoc から生成）
- ライセンス: MIT
- リポジトリ: `/Users/hidemikimura/Downloads/receipt-html-to-pdf`
- 最初のフィクスチャ: 日本の適格請求書（インボイス）要件を満たす領収証テンプレート（`fixtures/receipt-invoice/index.html`）

---

## 1. 目的とスコープ

### 1.1 目的

ブラウザ内だけで完結し、HTML/CSS で記述した文書をテキスト選択・検索可能な**ベクター PDF** に変換する JavaScript ライブラリを開発する。第一の用途は EC サイト等で発行する**領収証**の PDF 出力である。サーバー側に PDF 生成基盤を持たず、ユーザーのブラウザ上で即時にダウンロードさせることを狙う。

### 1.2 なぜ既存ライブラリでは不十分か

| 既存の選択肢 | 方式 | 領収証用途での問題 |
|---|---|---|
| html2canvas + jsPDF | DOM を canvas に描画して画像として PDF に埋め込む（ラスター） | テキスト選択・検索不可、文字がにじむ、ファイルが重い、印刷品質が低い |
| jsPDF `.html()` | 内部で html2canvas を使用 | 上と同じ |
| pdfmake / pdf-lib / jsPDF 直接 | 独自 DSL または低レベル API で描画 | HTML/CSS で書けない。デザイン変更のたびに座標計算をやり直す |
| @react-pdf/renderer | 独自レイアウトエンジン（Yoga） | React 依存、CSS のサブセットが独自で HTML を受け付けない |
| Paged.js / Vivliostyle | ブラウザの印刷機能で PDF 化 | `window.print()` の印刷ダイアログを経由するため、プログラムから Blob を得られず自動保存やアップロードができない |
| Puppeteer / Playwright / WeasyPrint | headless ブラウザ・サーバー側 | サーバーが必要（本ライブラリの前提と矛盾） |

「HTML で書ける」「ブラウザだけで動く」「ベクターで出力できる」の 3 点を同時に満たすものが存在しないことが本ライブラリの存在理由である。

### 1.3 スコープ（v1.0 まで）

**含む**

- HTML 要素（または HTML 文字列）を入力とし、PDF の `Uint8Array` / `Blob` を返す API
- テキスト（日本語を含む）のベクター描画、フォントのサブセット埋め込み
- ボックス描画: 背景色、ボーダー（辺ごと・角丸）、`opacity`
- 画像: PNG / JPEG（社判・角印・ロゴ・QR コード）、`<img>` および `background-image`（単一画像）
- テーブル、Flexbox、Grid など**ブラウザが計算したレイアウトの忠実な再現**
- 複数ページ（改ページ制御、ヘッダー／フッター、ページ番号）
- PDF メタデータ（タイトル・作成者・日本語対応）、ストリーム圧縮

**含まない（v1.0 では対象外）**

- 縦書き、ルビ
- `box-shadow`、グラデーション、`filter`、`mix-blend-mode`
- SVG のベクター変換（v1.0 では画像化してラスター埋め込み）
- フォーム（AcroForm）、注釈、リンク、電子署名、PDF/A 準拠
- 独自レイアウトエンジン（レイアウトは常にブラウザに任せる）

---

## 2. 基本方針（アーキテクチャ上の最重要判断）

### 2.1 レイアウトはブラウザに任せ、描画だけを自前で行う

HTML→PDF の難しさの 9 割は CSS レイアウトの実装にある。本ライブラリは**レイアウトエンジンを一切実装しない**。代わりに次の手順をとる。

1. 入力 HTML を、非表示の `<iframe>` 内に用紙幅（例: A4 = 210mm = 793.7px）で描画させる。
2. ブラウザが計算した結果を `getBoundingClientRect()`、`Range.getClientRects()`、`getComputedStyle()` で読み取る。
3. 読み取った矩形・色・フォント情報を PDF のコンテンツストリーム命令（`re f`、`BT … Tj … ET` など）に変換する。

この方式により、Flexbox / Grid / テーブル / 禁則処理 / 行分割 / `white-space` / `letter-spacing` などはすべてブラウザの実装をそのまま利用できる。ライブラリが責任を持つのは「ブラウザが表示しているものを、同じ位置・同じ見え方で PDF に書き出すこと」だけである。

これは html2canvas と同じ「DOM を読み取って再描画する」アプローチだが、描画先が canvas（ラスター）ではなく PDF のベクター命令である点が本質的な違いである。

### 2.2 依存ゼロのコア

PDF ライター、フォントパーサー／サブセッター、DOM ウォーカーはすべて自前実装とし、ランタイム依存を持たない。理由は次のとおり。

- 領収証用途ではバンドルサイズが顧客のページ表示速度に直結する（目標: gzip 後 40KB 以下）
- 必要な PDF 仕様の範囲は小さく（矩形・パス・テキスト・画像 XObject・CIDFont）、既存の重量級ライブラリを引き込む理由がない
- フォント処理は TrueType/OpenType の `cmap` / `glyf` / `loca` / `hmtx` / `hhea` / `head` / `maxp` / `OS/2` テーブルだけ読めればサブセット化できる

圧縮は Web 標準の `CompressionStream('deflate')` を使い、未対応環境では無圧縮で出力する（PDF は無圧縮でも正当）。

### 2.3 フォントはユーザーが供給する

ブラウザは OS のフォントファイルへアクセスできないため、**PDF に埋め込むフォントファイル（TTF/OTF/WOFF2 は非対応）はアプリケーション側が URL または ArrayBuffer で渡す**。同じフォントを `@font-face` で HTML 側にも適用してもらうことで、ブラウザのレイアウト計測と PDF 埋め込みグリフが一致する。

推奨フォント（参照実装で使用）: **BIZ UDPGothic**（Regular / Bold、SIL OFL、Google Fonts 配布の静的 TTF で `glyf` アウトライン）。領収証では 1〜2 書体で足りる。

Noto Sans JP について: Google Fonts 配布版は**可変フォント（`NotoSansJP[wght].ttf`）**であり、`glyf` にはデフォルトインスタンス（Regular）のアウトラインしか入っていない。Bold を得るには `gvar` を適用したインスタンス化が必要で、v1.0 では非対応とする。また GitHub の notofonts 配布版 OTF は CFF アウトラインで埋め込み不可。したがって Noto を使う場合は事前に静的 TTF へインスタンス化（`fonttools varLib.instancer`）したものを渡してもらう。

---

## 3. 全体アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│  Public API   htmlToPdf(input, options) → Promise<Blob>  │
└───────────────┬──────────────────────────────────────────┘
                │
   ┌────────────▼────────────┐
   │ 1. Renderer (iframe)     │ HTML を用紙幅で描画、フォント読み込み完了を待つ
   └────────────┬────────────┘
                │ Document
   ┌────────────▼────────────┐
   │ 2. DOM Walker            │ 要素・テキストノードを走査し中間表現 (DisplayList) を生成
   │    - BoxPainter          │   背景 / ボーダー / 画像
   │    - TextExtractor       │   Range → 行ごとのテキストラン + 位置
   └────────────┬────────────┘
                │ DisplayList (用紙座標系 pt)
   ┌────────────▼────────────┐
   │ 3. Paginator             │ ページ高さで分割、改ページ制御、ヘッダー/フッター挿入
   └────────────┬────────────┘
                │ Page[] (DisplayList のスライス)
   ┌────────────▼────────────┐
   │ 4. Font Engine           │ 使用グリフ収集 → サブセット化 → CIDFontType2 生成
   └────────────┬────────────┘
                │
   ┌────────────▼────────────┐
   │ 5. PDF Writer            │ オブジェクト管理 / コンテンツストリーム / xref / 圧縮
   └────────────┬────────────┘
                │
              Uint8Array / Blob
```

### 3.1 モジュール構成（ディレクトリ案）

```
src/
  index.js              公開 API
  renderer.js           iframe 生成・スタイル注入・フォント読込待ち
  walker/
    walk.js             DOM 走査、スタッキング順の解決
    box.js              背景・ボーダー・角丸 → DisplayList
    text.js             Range.getClientRects によるテキストラン抽出
    image.js            <img> / background-image のデコード
  paginate.js           ページ分割、break-before/after/inside、ヘッダー・フッター
  font/
    parse.js            sfnt テーブル読み取り (cmap, glyf, loca, hmtx, ...)
    subset.js           使用グリフのみで glyf/loca/hmtx を再構築
    cid.js              CIDFontType2 / CIDToGIDMap / ToUnicode CMap 生成
  pdf/
    writer.js           オブジェクト割当・xref・trailer
    content.js          コンテンツストリームビルダー (q/Q, re, f, BT/ET, Tj, cm ...)
    image.js            PNG → FlateDecode(予測子なし再エンコード) / JPEG → DCTDecode
    compress.js         CompressionStream ラッパー
  units.js              px ↔ pt ↔ mm 変換、色変換
```

コアはフレームワーク非依存の素の JavaScript（ESM）で実装し、必要に応じて薄いラッパー（Web Components / React hook）を別パッケージとして後から追加する。

---

## 4. 各コンポーネントの設計

### 4.1 Renderer（iframe レイヤー）

- `document.body` 直下に `position:fixed; left:-10000px; visibility:hidden`（`display:none` はレイアウトされないので不可）の `<iframe>` を生成する。
- iframe の幅 = 用紙幅 − 左右マージン（px 換算）。`html, body { margin:0 }` を強制し、`-webkit-text-size-adjust:100%` を付与する。
- 入力が要素の場合は `outerHTML` と、親ドキュメントの `<link rel=stylesheet>` / `<style>` を複製して注入する（`options.stylesheets` で明示指定も可）。
- `document.fonts.ready` と全 `<img>` の `decode()` 完了を待ってから走査に入る。
- iframe 内で `@media print` は適用されないため、`options.mediaPrint: true` のときは `<style>` 内の `@media print` ブロックを展開して通常ルールとして注入する。

### 4.2 DOM Walker と DisplayList

中間表現 **DisplayList** はページ分割・フォント収集・PDF 出力の 3 者を疎結合にするための単純な配列である。座標は用紙左上原点の pt（1px = 0.75pt）に変換済み、y は下向きのまま保持し、PDF Writer が最後に `y' = pageHeight − y` で反転する。

```js
// 命令の例
{ type: 'rect',  x, y, w, h, fill: [r,g,b], radius?: [tl,tr,br,bl], opacity? }
{ type: 'border', x, y, w, h, sides: {top:{width,color,style}, ...}, radius? }
{ type: 'image', x, y, w, h, src: ImageRef, clip?: Path }
{ type: 'text',  x, y /*baseline*/, font: FontRef, size, color, glyphs: [{gid, advance}], letterSpacing? }
{ type: 'clip',  path }  /  { type: 'endclip' }
{ type: 'break', mode: 'before'|'after'|'avoid', y }   // ページ分割ヒント
```

**走査順序**: `z-index` を持つ要素・`position` 指定要素・`opacity < 1` の要素はスタッキングコンテキストを形成するため、CSS の描画順（背景 → 負の z-index → ブロック背景 → フロート → インライン → 正の z-index）に従って並べ替える。v0.1 では文書順 + `z-index` の安定ソートで近似し、必要に応じて厳密化する。

**除外**: `display:none`、`visibility:hidden`、`<script>`、`<noscript>`、`aria-hidden` は描画しないが、`visibility:hidden` は子孫が `visible` になり得るため個別判定する。

### 4.3 Box Painter

- 背景色: `background-color` → `rect`。`border-radius` があれば角丸パス（4 隅を 3 次ベジェで近似、係数 0.5523）。
- ボーダー: 4 辺を個別の塗り矩形（または台形）として出力する。`style: dashed/dotted` は `d` 演算子で破線パターンを設定してストロークに切り替える。`double` は 2 本のストローク。
- `overflow:hidden` は `clip` / `endclip` 命令でラップする。
- `background-image`: 単一の `url()` のみ対応。`background-size: cover/contain/数値`、`background-position`、`no-repeat` を解釈し、`clip` 付きの `image` 命令にする。`repeat` は v1.0 では非対応（エラーではなく警告 + `no-repeat` 扱い）。

### 4.4 Text Extractor（最も重要かつ難しい部分）

**行の検出**: 各テキストノードに対して `Range` を張り、`getClientRects()` で行ボックスを得る。1 つの `ClientRect` が 1 行分のテキストランに対応する。どの文字がどの矩形に属するかは、矩形が増えた境界を二分探索で特定する（文字を 1 つずつ `Range` に追加して矩形数の変化を見る。1 行あたり O(log n) 回の計測）。

**グリフ位置**: 行内の各文字の x 座標は、原則としてフォントの `hmtx`（advance width）× fontSize/unitsPerEm + `letter-spacing` から計算する。ブラウザのカーニングや `font-feature-settings` で誤差が出るため、以下の場合は 1 文字ずつ `Range.getBoundingClientRect()` で実測にフォールバックする（`options.textMeasure: 'font' | 'measure' | 'auto'`）。

- `text-align: justify`、`text-align-last`
- `font-kerning` が `normal` かつ欧文が含まれる
- `word-spacing`、`text-indent` を含む行
- フォントフォールバックが発生した文字（次項）

**フォントフォールバック検出**: 指定フォントの `cmap` にコードポイントが無い場合、ブラウザは別フォントで描画しているため、`options.fonts` に登録された次候補（`fallback` チェーン）から探す。どこにも無ければ `.notdef` を出力せず、`onMissingGlyph` コールバックで通知して U+25A1 (□) に置換する。領収証では丸囲み数字・㈱・〒・㍿ などが典型的な落とし穴である。

**ベースライン計算**: `getClientRects()` は行ボックスの上端しか返さないため、ベースライン y を次で求める。

```
lineHeight   = rect.height
contentH     = (ascender − descender) × size / unitsPerEm     // hhea または OS/2 typo 値
halfLeading  = (lineHeight − contentH) / 2
baselineY    = rect.top + halfLeading + ascender × size / unitsPerEm
```

Chrome / Safari / Firefox で `ascender` の参照元（hhea vs OS/2 win/typo）が異なる問題があるため、初期化時に対象フォントで 1 回だけ `<span>` と `<span style="vertical-align:baseline">` の位置差を実測してオフセットを補正する（キャリブレーション）。

**その他**: `text-decoration: underline / line-through` は行ラン矩形から `rect` を生成する。`text-transform` は `getComputedStyle` の値を見て文字列側で変換する（ブラウザは変換後の文字を描画しているため）。`::before / ::after` の `content` は `getComputedStyle(el, '::before').content` から文字列を取り出して仮想テキストノードとして扱う（v0.2）。

### 4.5 Paginator

- 用紙サイズと余白から 1 ページの本文領域（px）を決める。iframe は縦に無限なので、DisplayList の y を本文領域の高さで割ってページ番号を決める。
- **行ボックスをまたがない**: `text` 命令はページ境界を跨げないため、境界にかかるテキストランは次ページへ送り、同じ y 以降の命令をすべて同じ量だけ下にずらす（シフト方式）。矩形（`rect`/`border`）は境界で 2 つに分割する。
- `break-before: page` / `break-after: page` / `break-inside: avoid`（および旧 `page-break-*`）を `getComputedStyle` で読み取り、`break` 命令として DisplayList に挿入して分割位置を決める。
- `thead` は各ページ先頭で繰り返す（`options.repeatTableHeader`、デフォルト true）。
- ヘッダー／フッター: `options.header` / `options.footer` に HTML テンプレートを渡すと、別 iframe で描画して各ページに合成する。`{{pageNumber}}` `{{totalPages}}` を置換する。領収証は原則 1 ページのため v0.3 まで後回しにする。

### 4.6 Font Engine

- 入力: TTF / OTF（TrueType アウトライン）。CFF アウトライン（`.otf` の一部）は v1.0 では非対応（Noto Sans JP の OTF 版は CFF なので、**TTF 版または Variable でない静的 TTF を案内する**）。WOFF2 は Brotli 展開が必要なため非対応。
- サブセット化: 使用グリフ ID の集合（+ gid 0）を集め、`glyf` / `loca` / `hmtx` を再構築する。複合グリフ（composite）の参照先グリフも再帰的に含める。`cmap` はサブセットには不要（CIDToGIDMap で直接マッピングするため）だが、一部ビューアの互換性のために最小の `cmap` を残す。
- PDF 上の表現: `Type0` フォント + `CIDFontType2` 子孫 + `Identity-H` エンコーディング。テキストは 2 バイト CID（= サブセット後 GID）の 16 進文字列で `Tj` に渡す。**ToUnicode CMap** を必ず生成し、テキスト選択・コピー・検索を保証する。
- サブセットフォント名には `ABCDEF+` 形式のタグを付ける。
- `W` 配列（グリフ幅）を出力する。ここが不正確だとテキスト選択ハイライトがずれる。
- 太字 / 斜体: 合成（synthetic bold）は行わない。`font-weight: 700` に対応する実フォントが未登録なら `onMissingFont` で通知して通常ウェイトで代替する。

### 4.7 PDF Writer

- PDF 1.7、オブジェクトはメモリ上に配列で保持し、最後に一括シリアライズする（領収証規模では十分。数百ページ規模でのストリーミング出力は将来課題）。
- コンテンツストリーム: 数値は小数第 3 位で丸め、`q`/`Q` の対応を型で強制する。
- 画像: JPEG は `DCTDecode` でバイト列をそのまま埋め込む。PNG は `<canvas>` でデコードして RGB + アルファに分離し、RGB を `FlateDecode`、アルファを `SMask` として埋め込む（PNG のチャンクを直接パースしない方が単純で確実）。
- メタデータ: `Info` 辞書に Title / Author / Subject / Creator / Producer / CreationDate。日本語は UTF-16BE + BOM で書く。
- 圧縮: `CompressionStream('deflate')` が使えれば全ストリームに `FlateDecode` を付与。

---

## 5. 公開 API

```js
import { htmlToPdf, registerFont } from '@hidemikimura/receipt-html-to-pdf';

// フォントは一度登録すれば以降の呼び出しで再利用（パース結果をキャッシュ）
await registerFont({
  family: 'BIZ UDPGothic',
  weight: 400,
  style: 'normal',
  src: '/fonts/BIZUDPGothic-Regular.ttf',   // URL or ArrayBuffer
});
await registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' });

const blob = await htmlToPdf(document.querySelector('#receipt'), {
  page: { size: 'A4', orientation: 'portrait', margin: '15mm' },   // size: 'A4'|'A5'|'B5'|'Letter'|{width:'80mm',height:'200mm'}
  fontFallback: ['BIZ UDPGothic'],          // 未登録ファミリーが要求されたときの代替順
  stylesheets: 'inherit',                  // 'inherit' | 'none' | [url|cssText]
  mediaPrint: true,
  compress: true,
  metadata: { title: '領収証 No.2026-0001', author: 'ecx Inc.' },
  header: null,
  footer: '<div style="text-align:center;font-size:8pt">{{pageNumber}} / {{totalPages}}</div>',
  textMeasure: 'auto',
  onWarning: (w) => console.warn(w),       // 未対応 CSS、欠落グリフ、欠落フォントなど
});

// 保存
const url = URL.createObjectURL(blob);
a.href = url; a.download = 'receipt.pdf'; a.click();
```

設計上のポイント

- 返り値は `Blob`（`options.output: 'uint8array' | 'blob' | 'dataurl'` で切替）。
- 未対応の CSS は**例外にせず警告**として `onWarning` に流す。領収証の出力が「一部装飾が落ちる」程度で止まらないことを優先する。
- 同期処理をブロックしない。DOM 走査は `requestIdleCallback` / チャンク分割で 16ms 単位に分けられるようにしておく（v1.0 で必須ではないがフック点を用意する）。

---

## 6. 領収証用途に固有の要件と対応

| 要件 | 対応 |
|---|---|
| 金額の桁区切り・右寄せ（`text-align:right`、等幅数字） | 右寄せはブラウザの計算位置をそのまま使うため追加実装なし。`font-variant-numeric: tabular-nums` は GSUB の解釈が必要なため **v1.0 では非対応**。数字が元から等幅のフォント（Noto Sans JP は等幅）を推奨 |
| 但し書き、宛名の長文折り返し | ブラウザの行分割・禁則処理をそのまま利用 |
| 社判・角印・ロゴ（透過 PNG） | `SMask` 付き画像 XObject |
| 収入印紙欄（点線枠） | `border-style: dashed/dotted` を破線ストロークで再現 |
| 適格請求書発行事業者登録番号（T+13 桁）、税率別内訳表 | テーブル描画、`thead` 対応 |
| 発行日時、通番のメタデータ化 | `metadata` オプション → Info 辞書 |
| 「再発行」透かし文字 | `opacity` + `position:absolute` + `transform: rotate()`。**`transform` は v0.2 で 2D アフィン（`cm` 演算子）に対応** |
| モバイル Safari での動作 | `CompressionStream` は iOS 16.4+。未対応なら無圧縮出力。iframe の `visibility:hidden` 配置でメモリ上問題なし |
| フォントサイズ 8pt 程度の注記でも鮮明 | ベクター出力なので拡大しても劣化しない |

---

## 7. 品質とテスト戦略

- **単体テスト**（Vitest, Node）: フォントパーサー、サブセッター、PDF Writer、単位変換。生成 PDF を `pdf.js`（pdfjs-dist）で読み戻し、テキスト抽出結果が元の HTML テキストと一致することを検証する（ToUnicode の正しさの検証）。
- **ブラウザテスト**（Playwright: Chromium / WebKit / Firefox）: フィクスチャ HTML → PDF 生成 → pdf.js で 2x ラスタライズ → 同 HTML のスクリーンショットと画素差分（pixelmatch）。しきい値は 1〜2%。フォントのアンチエイリアス差があるため完全一致は求めない。
- **ゴールデン PDF**: 領収証テンプレート 3 種（シンプル / インボイス対応 / 複数明細で 2 ページ）を Acrobat Reader、macOS プレビュー、Chrome、iOS Safari で目視確認する手順をリリースチェックリスト化する。
- **バリデーション**: `qpdf --check` と `verapdf`（構造のみ）を CI で流し、xref・ストリーム長・フォント辞書の壊れを検出する。

---

## 8. 既知のリスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| ブラウザ間で `getClientRects` の丸め・サブピクセル挙動が異なる | 文字位置が 0.5px 程度ずれる | pt 変換時に丸めず、ページ座標で最後に 1 回だけ丸める。差分テストで監視 |
| 行高・ベースライン計算のフォント依存 | 文字が上下にずれる | 初期化時のキャリブレーション（4.4 節）。`line-height: normal` はフォント依存が大きいため数値指定を推奨と明記 |
| 大きな日本語フォント（Noto Sans JP TTF ≈ 5MB）の初回ロード | 初回表示が遅い | Service Worker / Cache API でのキャッシュを README で案内。将来的にサブセット済みフォント生成 CLI を提供 |
| CFF アウトラインの OTF が渡される | 埋め込み不可 | `registerFont` で `CFF ` テーブル検出時に明確なエラーメッセージを出す |
| 未対応 CSS（`box-shadow` 等）の多用 | 見た目の差 | `onWarning` で通知。ドキュメントに対応 CSS 一覧を掲載 |
| iframe 内でのクロスオリジン画像 | canvas デコード時に汚染エラー | `crossorigin="anonymous"` 必須と明記。失敗時は画像を枠のみで出力し警告 |
| GSUB / GPOS を解釈しない | 合字・等幅数字・カーニングが再現できない | `textMeasure: 'measure'` の実測フォールバックで位置は合う。グリフ選択（GSUB）は v1.x で検討 |

---

## 9. ロードマップ

| バージョン | 内容 | 完了条件 |
|---|---|---|
| **v0.1** 基盤 ✅ | PDF Writer、フォントパース＋サブセット、テキスト＋矩形＋ボーダーの単一ページ出力。`registerFont` / `htmlToPdf` の最小 API | **達成**: `fixtures/receipt-invoice` が Chromium で出力され、pdf.js でのテキスト抽出が `expected.json` の 20 文字列すべてと一致。qpdf --check エラーなし。Chromium スクリーンショットとの画素差分は 2.45%（アンチエイリアス差のみ、位置ずれなし） |
| **v0.2** 忠実度 ✅ | 画像（PNG/JPEG、SMask）、角丸、破線、`opacity`、2D `transform`、`::before/::after`、テキスト装飾、フォントフォールバック検出 | **達成（Chromium）**: `fixtures/receipt-invoice` に角印 PNG（透過）・ロゴ JPEG・角丸・`::before`・再発行透かし（`transform` + `opacity`）を追加。通常版・再発行版ともテキスト抽出照合に合格、画素差分 2.4%（v0.1 と同水準、AA 差のみ）。Firefox / WebKit での確認は v0.4 の CI 整備時に行う |
| **v0.3** 複数ページ ✅ | Paginator、`break-*`、`thead` 繰り返し、ヘッダー／フッター、ページ番号 | **達成**: 明細 60 行の `fixtures/receipt-invoice-long` が 3 ページに分割され（A4・余白 15mm・フッター付きでは 60 行は 3 ページになる）、行が跨がれず、thead が 2・3 ページ目に繰り返され、フッターの `1 / 3`〜`3 / 3` が抽出できる。60 行が重複なく 1 回ずつ抽出される |
| **v0.4** 堅牢化 ✅ | 警告体系の整備、対応 CSS 一覧ドキュメント、Playwright 差分テスト CI、qpdf/verapdf 検証、バンドルサイズ計測 | **達成（3 ブラウザ）**: `tests/browser` が Chromium（Linux）で 8 件、Firefox / WebKit（macOS）で各 5 件合格（画素差分は pdftoppm 未導入のためスキップ）。Chromium での画素差分 2.4〜3%。GitHub Actions に 3 ブラウザ × qpdf --check のワークフローを用意。minify バンドルは gzip **18.2KB**（目標 40KB） |
| **v1.0** 公開 ✅ | API 凍結、TypeScript 型定義（`.d.ts` を JSDoc から生成）、README・サンプル（Vanilla / Lit / React） | **達成（npm 公開は保留）**: `overflow: hidden` クリップと `tfoot` 繰り返しを追加、`examples/` 3 種、CHANGELOG、`version` エクスポート（package.json との一致をビルドで検査）。`private: true` のまま `publishConfig` を用意し、公開の判断は別途 |
| v1.x 検討 | GSUB（合字・tabular-nums）、CFF フォント、SVG ベクター変換、グラデーション、縦書き、ストリーミング出力、リンク注釈 | — |

---

## 10. 決定事項（2026-09-16 確定）

1. **ライブラリ名**: Receipt html to pdf。npm パッケージ名は `@hidemikimura/receipt-html-to-pdf`、当面は npm に公開しない（`"private": true`）
2. **実装言語**: 素の JavaScript（ESM）+ JSDoc 型注釈。`jsconfig.json` の `checkJs` で型検査し、公開時は `tsc --declaration --emitDeclarationOnly` で `.d.ts` を生成する
3. **ライセンス**: MIT
4. **リポジトリ配置**: `/Users/hidemikimura/Downloads/receipt-html-to-pdf`
5. **最初のフィクスチャ**: 既存フォーマットが無いため、日本の法令要件を満たす領収証テンプレートを新規に作成し v0.1 の完了条件とする（詳細は 11 章）

## 11. フィクスチャ「適格請求書対応 領収証」の要件

領収証は民法 486 条に基づく受取証書であり、加えてインボイス制度（2023 年 10 月〜）下で買い手が仕入税額控除を受けるには、領収証が**適格請求書（または適格簡易請求書）の記載事項**を満たす必要がある。フィクスチャは適格請求書として次の 6 項目をすべて含む。

| # | 記載事項（消費税法 57 条の 4） | フィクスチャ上の表現 |
|---|---|---|
| 1 | 適格請求書発行事業者の氏名または名称、および登録番号 | 発行者ブロックに社名と `登録番号 T1234567890123` |
| 2 | 取引年月日 | `発行日` |
| 3 | 取引内容（軽減税率対象品目である旨） | 明細行の品名、軽減税率対象品は `※` を付し欄外に「※は軽減税率対象」 |
| 4 | 税率ごとに区分して合計した対価の額（税抜または税込）および適用税率 | 内訳表の `10% 対象` / `8% 対象` 行に税抜金額 |
| 5 | 税率ごとに区分した消費税額等 | 内訳表の `消費税` 列 |
| 6 | 書類の交付を受ける事業者の氏名または名称 | 宛名 `○○ 御中`（適格簡易請求書として使う場合は省略可） |

その他の設計上の判断

- **端数処理**: 消費税額の端数処理は「1 つの適格請求書につき、税率ごとに 1 回」しか認められない。明細行ごとに税額を丸めてはならないため、フィクスチャの内訳表は税率ごとの税抜合計に税率を掛けて 1 回だけ切り捨てる。ライブラリ側は計算に関与しないが、サンプルの数値はこのルールで作る。
- **収入印紙**: 売上代金の受取書は記載金額（税抜金額が区分記載されていれば税抜）5 万円以上で印紙税の課税対象になるが、**電子データ（PDF）で交付する領収証は課税文書に該当せず印紙不要**。フィクスチャには印紙欄を設けず、フッターに「本書は電子的に交付された領収証であり、収入印紙は不要です」と明記する。紙に印刷して交付する運用では 5 万円以上で印紙が必要になる点を README に注記する。
- **但し書き**: 「下記の通り商品代として」とし、具体的内容は明細表に委ねる（「お品代」だけでは取引内容の要件を満たさないため）。
- **金額表示**: 税込合計を `￥41,936-` の形式で大書し、改ざん防止の慣例として先頭に `￥`、末尾に `-` を付ける。
- **社判**: 角印は透過 PNG で `position:absolute` に重ねる想定だが、v0.1 では画像未対応のため枠線のみのプレースホルダーとし、v0.2 で PNG に差し替える。
- **サンプル金額**（税抜合計 38,200 円、税込 41,936 円）: 10% 対象 34,000 円（税 3,400 円）、8% 対象 4,200 円（税 336 円）。ライブラリの動作確認では、この金額と文字列が PDF から正しくテキスト抽出できることをテストの合格条件にする。

---

## 12. v0.1 実装記録（2026-09-16）

実装したモジュール: `units.js`、`pdf/{writer,content,compress}.js`、`font/{parse,subset,cid,registry}.js`、`renderer.js`、`walker/{walk,text}.js`、`page.js`、`index.js`。ランタイム依存ゼロ、ソース合計約 1,600 行。生成 PDF は 49KB（フォント 2 書体サブセット埋め込み・Flate 圧縮込み）、変換時間はブラウザ内で約 130ms。

設計からの変更・確認できたこと

- **ベースライン**: 4.4 節で予定していた「フォントメトリクスから計算 + キャリブレーション」ではなく、**プローブ方式のみ**にした。同じ font 指定の `<div>` に `inline-block; vertical-align: baseline` の 0×0 マーカーを置き、その下端と Range 矩形上端の差をベースラインオフセットとして 1 回計測してキャッシュする。ブラウザ間の ascent 参照元（hhea / typo / win）の差を気にせず正確に一致した。
- **グリフ位置**: `textMeasure` の既定を「全文字実測」にした。1 文字ずつ Range を張り `getClientRects()` で矩形を得る（1 文字あたり 1 回の計測、領収証 1 枚で約 600 回・数十 ms）。得たペン位置とフォント advance との差を `TJ` の調整値として出力するので、カーニング・letter-spacing・両端揃えが自動的に再現される。フォント幅からの計算モードは速度が必要になったときに実装する。
- **border-collapse**: collapse モードのテーブルセルでは、境界線をセル境界の**中心**に描く（通常モードは内側）。Chromium では隣接セルの矩形が同じ座標で接しているため、これで二重線にならないことを確認した。
- **cmap 省略**: サブセットに `cmap` を含めない（CIDToGIDMap /Identity のため不要）。poppler / pdf.js / qpdf で問題なし。パーサー側は cmap 無しのフォントも読めるようにした。
- **Node の Buffer**: `Buffer#slice` はコピーではなくビューを返すため、テーブルコピーは `new Uint8Array(subarray)` で行う（テストで発覚）。
- **可変フォント**: `fvar` を検出したら `registerFont` が console.warn する。
- **暫定ページ分割**: 本文領域の高さで機械的に切り、境界にかかる命令はクリップする。行を跨がない分割は v0.3。

検証手段: `npm test`（Vitest 14 件: シリアライズ、xref オフセット、色・単位、フォントパース、サブセットの往復、フェイス選択）、`npm run e2e`（Playwright Chromium → `out/receipt-invoice.pdf` → pdf.js でテキスト抽出照合）。fontTools でサブセットの全グリフがデコード可能であること、DejaVu Sans で複合グリフの GID 書き換えが正しいことも確認した。

## 13. v0.2 実装記録（2026-09-16）

追加モジュール: `walker/image.js`（読み込み・デコード・配置計算）、`pdf/image.js`（XObject 出力）。`walker/walk.js` は非同期化し、`group` / `image` / `stroke-rrect` 命令を追加。`renderer.js` に擬似要素の実体化を追加。単体テスト 21 件、生成 PDF は画像 2 点込みで 120KB。

設計判断と確認できたこと

- **画像の埋め込み経路**: まず `fetch` でバイト列を取り、JPEG（SOF が 3 成分）なら再圧縮せず `DCTDecode` でそのまま埋め込む。それ以外は `<canvas>` でデコードし RGB と アルファを分離、アルファがあるときだけ `SMask` を付ける。透明ピクセルの RGB はノイズになり得るので白に寄せる。同じ URL は 1 つの XObject を共有する。
- **transform の扱い**: 要素の `transform` を一時的に `none` にして無変形の座標で子孫を走査し、`group` 命令に包む。PDF 側では CSS 行列を y 反転座標系へ写した `cm`（a, −b, −c, d と原点補正）で囲む。`transform-origin` と `translate(-50%, -50%)` の組み合わせ（透かしの中央寄せ）が Chromium の描画と一致した。3D 変換は警告して無変形で描く。
- **::before / ::after**: 擬似要素は Range で計測できないため、`getComputedStyle(el, '::before')` の全プロパティを写した `<span>` を同じ位置に挿入し、元の擬似要素を `content: none !important` で消す。文字列 content のみ対応（`counter()` / `url()` は警告）。`\203B` 形式のエスケープも復号する。
- **角丸**: 背景は角丸パスで塗る。ボーダーは 4 辺が同じ幅・色・スタイルのときだけ角丸パスをストロークし（幅の半分だけ内側にオフセット）、そうでなければ直線ボーダーで近似して警告する。画像は角丸でクリップする。
- **祖先依存のセレクタ**: 要素を入力にしたとき、`<html>` / `<body>` の属性（class, lang, data-*）を iframe 側にも写す。`body.reissue .watermark { display: block }` のような切り替えがそのまま効く。
- **iframe 越しの instanceof**: iframe 内の要素は親ウィンドウの `HTMLImageElement` / `HTMLElement` の `instanceof` に失敗する。タグ名とプロパティで判定する（v0.2 で最初に踏んだバグ）。
- **画像の opacity**: `ExtGState` の `ca` を `Do` の前に設定して要素の `opacity` を反映する。

未対応のまま v0.3 以降に持ち越すもの: `background-repeat`（repeat は 1 回描画に丸めて警告）、グラデーション、`overflow: hidden` によるクリップ、`box-shadow`。

## 14. v0.3 実装記録（2026-09-16）

追加モジュール: `paginate.js`。`walker/walk.js` はアトム・強制改ページ・テーブル情報を併せて返す `WalkResult` に変更、`page.js` は `Painter` クラスに整理して「本文（範囲指定）→ 繰り返し thead → ヘッダー → フッター」の順に描く。単体テスト 27 件。

設計判断と確認できたこと

- **命令を動かさない分割**: 4.5 節で予定した「境界にかかる行を次ページに送り、以降を下にずらす」方式ではなく、**ページごとに描くドキュメント y の範囲 [start, end) を決めるだけ**にした。境界はアトム（テキスト行・`tr`・`thead`/`tfoot`・`<img>`・`break-inside: avoid` の要素）を跨がない位置まで上へ戻し、次ページはその位置から始める。命令の座標は不変なので、テーブルの縦罫線や背景は境界で自然に切れ、ページ下部の余りは空白になる。実装が単純で、ずらしに伴う矛盾（絶対配置要素や transform グループの扱い）が発生しない。
- **アトムの連鎖**: 境界を 1 つのアトムの上端に上げると別のアトム（例: 行を包む `break-inside: avoid` ブロック）にかかることがあるため、動かなくなるまで繰り返す。ページ容量より大きいアトムは無視して容量いっぱいで切る（空ページを作らない）。
- **テキストの選択基準**: 矩形や画像はページ範囲と「重なれば」描いてクリップに任せるが、テキストは行の中心がページ範囲に入る場合だけ描く。クリップで見えなくなった文字が抽出テキストに残る（ページを跨いで重複する）ことを防ぐため。60 行のフィクスチャで各行が 1 回ずつ抽出されることを確認した。
- **thead の繰り返し**: 走査中に `thead` の描画命令を表ごとに記録しておき、表の途中から始まるページでは先頭に thead をそのまま（y を平行移動して）描き、本文をその高さ分だけ下げる。Paginator はその分だけ容量を減らして境界を計算する。
- **ヘッダー／フッター**: テンプレートの `{{pageNumber}}` `{{totalPages}}` を置換した HTML を、本文と同じ幅・スタイルシートで別 iframe に描画して走査する。高さは 1 ページ目相当で 1 回測り、全ページ同じとみなす（ページ番号で高さが変わる設計は想定しない）。総ページ数はヘッダー／フッターの高さを引いた本文領域で決まるため、先に高さを測ってから分割し、その後ページごとに描画する。同じ (page, total) の結果はキャッシュする。
- **文書の高さ**: `body.scrollHeight` は iframe のビューポート高さまで膨らむため使わず、`body` の下端と命令の下端の大きい方を使う。フッターの高さ計測で最初に踏んだ。
- **強制改ページ**: `break-before: page` / `page-break-before: always` を要素上端、`break-after` を要素下端の境界として扱う。`avoid` 系の before/after は v0.3 では未対応（アトムで代替可能）。

## 15. v0.4 実装記録（2026-09-16）

追加: `playwright.config.js` と `tests/browser/`（Chromium / Firefox / WebKit の 3 プロジェクトで、テキスト抽出照合・ページ数・全ページの thead・PDF ヘッダー／フッター・pdftoppm があれば画素差分・フォント未登録エラー・未対応 CSS 警告を検証）、`scripts/build.mjs`（esbuild で minify バンドル + gzip サイズ検査）、`docs/css-support.md`（対応 CSS 一覧）、`.github/workflows/ci.yml`（typecheck → unit → size、3 ブラウザ並列で browser テスト → 生成 PDF を qpdf --check → レポートをアーティファクト保存）。`package.json` に `./min` エクスポート（`dist/receipt-html-to-pdf.min.js`）を追加し、`npm run types` で `.d.ts` を生成できることを確認した。

確認できたこと・制約

- **バンドルサイズ**: 依存ゼロのまま raw 46.5KB / gzip 18.2KB / brotli 16.3KB。目標 40KB の半分以下で、画像・複数ページ・擬似要素を含めた状態。
- **画素差分の測り方の罠**: スクリーンショット用に本文へ `body{padding-top}` を足すと、その `<style>` が `stylesheets: 'inherit'` で iframe にも継承されて PDF 側もずれる。変換を先に済ませてからスタイルを足す順序にした（テストコードにコメントで残した）。
- **Firefox / WebKit（2026-09-16、macOS arm64 で実行）**: テキスト抽出照合・ページ数・全ページの thead・フォント未登録エラー・未対応 CSS 警告の 5 件 × 2 ブラウザが**すべて合格**。3 フィクスチャの期待文字列（20 + 1 + 15 個）が両ブラウザの出力から抽出でき、60 行フィクスチャは Chromium と同じ 3 ページに分割された。事前に懸念していたベースライン（プローブ方式）・`border-collapse` の座標・Range 矩形の丸め・`CompressionStream` はいずれも問題を起こさなかった。画素差分はローカルに pdftoppm が無くスキップされたため、`brew install poppler` 後の再実行か CI で確認する。同じ実行で Chromium が 8 件失敗しているのは `npx playwright install chromium` 未実行（headless shell 本体が無い）ためで、ライブラリの問題ではない。
- **WebKit の画素差分（2 回目の実行で発覚）**: Playwright の `Desktop Safari` プリセットは `deviceScaleFactor: 2` を含むため、スクリーンショットが 1588×2246 になり、96dpi の PDF ラスター（794×1123）と比較して 6.8〜7.2% の差が出ていた。全プロジェクトで `deviceScaleFactor: 1` に固定し、念のため比較側でも整数倍のスクリーンショットをボックス平均で縮小するようにした。縮小後の WebKit の差は約 3.7%（アンチエイリアスの差のみ）で、しきい値は 4% → 5% に緩めた（位置ずれは 7% 前後になるので判別できる）。
- **qpdf**: 3 フィクスチャすべて `--check` エラーなし。verapdf（PDF/A）はスコープ外なので CI には入れていない。

v1.0 に向けて残っているもの: `overflow: hidden` のクリップ、`tfoot` 繰り返し、README のサンプル（Vanilla / Lit / React）、CHANGELOG、`npm publish` 用のメタデータ整理（`private: true` を外すか判断）。

## 16. v1.0 実装記録（2026-09-16）

- **`overflow: hidden` のクリップ**: `overflow-x` / `overflow-y` が `visible` 以外の要素で、子孫の描画命令を `clip` 命令（padding-box、角丸込み）に包む。ボックスと重ならない命令はその場で捨てるので、見えない文字が抽出テキストに残らない（ブラウザテストで「隠れる二行目」が抽出されないことを確認）。同じ行の途中ではみ出す文字はクリップで消えるだけで抽出には残る（1 行を 1 命令にしているため）。transform グループは境界が回転するので常に残す。スクロール位置は 0 として扱う。
- **`tfoot` の繰り返し**: thead と同様に走査中に命令を記録し、Paginator は「表がこのページで終わらない」ページに tfoot を積む。必要かどうかは end に依存するので、tfoot 無しで end を求め → 必要な表があれば容量を減らして再計算、を収束するまで（最大 4 回）繰り返す。描く位置は本文領域の下端ではなく**そのページに載った最後の行の直下**にした（ブラウザ印刷と同じ）。
- **Painter の範囲フィルタ**: ページ範囲による命令の選別を `render()` に組み込み、transform / clip グループの子にも同じ規則を適用するようにした。
- **サンプル**: `examples/vanilla.html`（そのまま `npm run dev` で動く）、`react.jsx`、`lit.js`。Lit は Shadow DOM 内の要素を渡すと親文書のスタイルシートが継承されないため、`stylesheets` オプションで CSS を明示的に渡す形にした。
- **npm 公開準備（2026-09-18）**: 方針を変更し公開することになったため、`private` を外して `publishConfig.access: public` を設定。`prepublishOnly` で typecheck → 単体テスト → `.d.ts` 生成 → minify ビルド + gzip 40KB 検査を自動化。`files` を許可リストにし（src / dist / types / examples / README / LICENSE / CHANGELOG、41 ファイル・148KB、うち 234KB 分は minify の sourcemap）、フォント・フィクスチャ・テストは含めない。`npm pack` した tarball を別プロジェクトに `npm install` して、`.` と `./min` の両エクスポートが読み込め、Node で呼ぶと「ブラウザで実行してください」のエラーになることを確認した。`repository` 等の URL は `github.com/hidemikimura/receipt-html-to-pdf` を仮置き。実際の `npm login` と `npm publish` は木村さんの手で行う。

v1.x 候補（優先度順の私案）: `break-before/after: avoid`、`background-repeat`、グラデーション、SVG のベクター変換、GSUB（tabular-nums）、縦書き、リンク注釈、ストリーミング出力。

## 17. skill とドキュメントサイト（2026-09-20）

0.1.0 の公開後、AI エージェント向けの skill と人間向けのドキュメントサイトを追加した。

**skill（`skills/receipt-html-to-pdf/`）**: `SKILL.md` の frontmatter に「いつ読むか」を日本語で書き、本体には最初に確認すること（ブラウザ専用・フォントファイルが要る・CSS の適用範囲）、`registerFont` / `htmlToPdf` の使い方、フォント選定の制約、対応 CSS の要点、複数ページ制御、よくあるエラーを置いた。詳細は `references/receipt-format.md`（適格請求書の記載事項 6 項目、税率ごとに 1 回だけ端数処理する規則、電子交付なら印紙不要、`￥41,936-` などの慣習）と `references/troubleshooting.md`（例外／見た目／ページ分割の症状別の表）に分けている。`package.json` の `files` に `skills` を足したので npm パッケージからそのままコピーできる。

**サイト（`site/`）**: 依存ゼロの静的 HTML + CSS + ESM、日本語のみ。`index.html`（何ができるか・他手法との比較・仕組み・クイックスタート）、`demo.html`（ブラウザ内で実際に PDF を生成する）、`api.html`、`css.html` の 4 ページ。`scripts/build-site.mjs` が (1) `dist/` の minify バンドルを `site/assets/lib/` にコピー、(2) `docs/css-support.md` から `css.html` を生成（対応表の単一の出所を保つため）、(3) `pyftsubset` でデモに出る文字だけに絞った BIZ UDPGothic のサブセット（各 800KB 強）を作る。生成物は `.gitignore` に入れ、`.github/workflows/pages.yml` が main への push で組み立てて GitHub Pages に deploy する（Settings → Pages の Source を「GitHub Actions」にする必要がある）。

デモは実際に Chromium で動作を確認した（27.2KB / 74ms、警告なし、pdf.js で全期待文字列を抽出、A5 + フッターで 2 ページとページ番号）。途中で `.btn { display: inline-flex }` が UA の `[hidden] { display: none }` に勝ってしまい、生成前からダウンロードボタンが見えていたので、`site.css` に `[hidden] { display: none !important; }` を足した。

## 付録 A. 対応予定 CSS プロパティ一覧（v1.0）

**レイアウト系（ブラウザ計算をそのまま使用、追加実装不要）**: `display` 全般、`position`、`float`、`flex-*`、`grid-*`、`margin`、`padding`、`width/height`、`table-*`、`white-space`、`word-break`、`overflow-wrap`、`line-break`、`text-align`、`vertical-align`、`line-height`、`text-indent`

**描画系（本ライブラリが PDF 命令へ変換）**: `color`、`background-color`、`background-image`（単一 url、no-repeat）、`background-size`、`background-position`、`border-*`（width/style/color/radius、辺ごと）、`opacity`、`overflow: hidden`、`font-family/size/weight/style`、`letter-spacing`、`word-spacing`、`text-decoration`（underline / line-through）、`text-transform`、`visibility`、`z-index`、`transform`（2D、v0.2）、`break-before/after/inside`

**非対応（警告）**: `box-shadow`、`text-shadow`、`filter`、`backdrop-filter`、`mix-blend-mode`、`background-image` のグラデーション・複数指定・repeat、`writing-mode: vertical-*`、`text-emphasis`、`clip-path`、`mask`、`outline`、`border-image`、`font-variant-*`（GSUB 依存）

## 付録 B. 単位変換

- 1 CSS px = 0.75 pt（96dpi 基準）、1 mm = 2.8346 pt、A4 = 595.28 × 841.89 pt
- iframe 幅は `(用紙幅pt − 左右余白pt) / 0.75` px に設定し、`devicePixelRatio` は計測に影響しないので無視する
- 色は `getComputedStyle` の `rgb()/rgba()` 文字列をパースし、0〜1 の実数で `rg` / `RG` に渡す。アルファは `ExtGState` の `ca` / `CA` へ
