# fonts/

参照フォントの置き場所。フォントファイル本体はリポジトリにコミットしない。

```sh
npm run fonts   # BIZUDPGothic-Regular.ttf / BIZUDPGothic-Bold.ttf を取得
```

- BIZ UDPGothic — Morisawa Inc. / SIL Open Font License 1.1。PDF への埋め込み・再配布が許可されている。
- 静的 TTF（`glyf` アウトライン）であることが必須。CFF アウトラインの OTF、可変フォント、WOFF/WOFF2 は v1.0 では埋め込み対象外。
