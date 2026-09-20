# 症状別の原因と対処

## 例外になるもの

| エラーメッセージ | 原因 | 対処 |
|---|---|---|
| `htmlToPdf: no fonts registered` | `registerFont` を呼ぶ前、または await せずに `htmlToPdf` を呼んだ | フォント登録の Promise を保持して await してから変換する |
| `htmlToPdf must run in a browser` | Node で呼んだ | ブラウザで実行する。サーバー側 PDF が必要なら別の手段を検討 |
| `CFF outlines are not supported` | OpenType/CFF の `.otf` を渡した | TrueType（`glyf`）の静的 TTF を渡す |
| `WOFF/WOFF2 are not supported` | Web フォント形式を渡した | 元の `.ttf` を配信して渡す |
| `Not a TrueType font (bad sfnt version)` | フォント以外（HTML エラーページなど）を取得した | URL と配信サーバーの Content-Type を確認する |
| `Unknown page size "..."` | `page.size` の綴り違い | `A3` `A4` `A5` `B4` `B5` `Letter` `Legal` または `{width, height}` |
| `Page content area is empty` | 余白 + ヘッダー + フッターの高さが用紙を超えた | 余白を減らすか、ヘッダー／フッターを低くする |

## 見た目がおかしいもの

| 症状 | 原因 | 対処 |
|---|---|---|
| 文字が □ になる | そのフォントに該当グリフが無い（丸囲み数字・㈱・㍿ など） | `missing-glyph` 警告に該当文字が出る。グリフを持つフォントを `fontFallback` に足す |
| 文字幅が少しずつずれる | `@font-face` と `registerFont` のファイルが別物 | 同じ TTF を両方に渡す |
| Bold が Regular で出る | 可変フォントを渡した（console.warn が出る） | 静的 TTF の Bold を別途 `registerFont` する |
| 何も描かれない | 要素が `display:none`、または DOM 上に無い | 表示された状態の要素を渡す |
| スタイルが当たらない | Shadow DOM 内の要素を渡した | `stylesheets: [cssText]` で CSS を明示的に渡す |
| カスタム要素の中身が出ない（枠だけになる） | シャドウ DOM のホスト要素を渡した。`outerHTML` にシャドウルートは含まれない | `renderRoot.querySelector()` でシャドウルート内の要素を渡す。light DOM のカスタム要素ならホストのままでよい |
| カスタム要素だけレイアウトが崩れる | `:defined` が iframe 内でマッチせず、既定の `display: inline` で組まれた | `my-el:defined { display: block }` から `:defined` を外す |
| JS で足した CSS が効かない | `adoptedStyleSheets` や `sheet.insertRule()` は `stylesheets: 'inherit'` で拾えない | 同じ CSS を `stylesheets` に文字列で渡す |
| 画像が出ない | クロスオリジンで CORS ヘッダーが無い | `crossorigin="anonymous"` と `Access-Control-Allow-Origin` を設定する。`image-failed` 警告が出ている |
| 影や角丸グラデーションが消える | 未対応 CSS | `onWarning` の `unsupported-css` を見る。ボーダーや単色で代替する |
| テーブルの罫線が二重になる | `border-collapse: separate` のまま隣接セルに罫線を引いた | `border-collapse: collapse` を使う |

## ページ分割の症状

| 症状 | 原因 | 対処 |
|---|---|---|
| 意図しない位置で切れる | 分割禁止の指定が無い | 割りたくないブロックに `break-inside: avoid` |
| 表の見出しが 2 ページ目に無い | 見出し行が `<thead>` に入っていない | `<thead>` でマークアップする（自動で繰り返される） |
| ページ数が想定と違う | ヘッダー／フッターの高さぶん本文領域が縮む | フッターを付けると 1 ページあたりの行数が減る。実測して期待値を決める |
| ページ下部が大きく空く | 直後に分割禁止の大きなブロックがある | そのブロックを分割可能にするか、明示的に `break-before: page` を置く |

## 確認の手順

1. `onWarning` をコンソールに出して、未対応 CSS・欠落グリフ・画像失敗が出ていないか見る
2. 生成した PDF を開いてテキストを選択・コピーできるか確認する（できなければフォント埋め込みの問題）
3. `pdftotext` や pdf.js でテキストを抽出し、期待する文字列が全部入っているか照合する
4. 構造を疑うなら `qpdf --check` にかける
