#!/bin/sh
# 参照フォント（BIZ UDPGothic Regular / Bold, SIL OFL 1.1）を fonts/ に取得する。
# Google Fonts のリポジトリから静的 TTF（glyf アウトライン）を取得する。
set -eu

cd "$(dirname "$0")/.."
mkdir -p fonts

BASE="https://raw.githubusercontent.com/google/fonts/main/ofl/bizudpgothic"

for f in BIZUDPGothic-Regular.ttf BIZUDPGothic-Bold.ttf; do
  if [ -f "fonts/$f" ]; then
    echo "skip  fonts/$f (exists)"
  else
    echo "fetch fonts/$f"
    curl -fsSL -o "fonts/$f" "$BASE/$f"
  fi
done

echo "done."
