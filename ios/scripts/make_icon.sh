#!/usr/bin/env bash
# 生成 App 图标：App/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png（1024×1024）。
# iOS 15 起只要这一张，其余尺寸 Xcode 自己缩。
#
# 源图是 App/Resources/icon-source.png，它是 Android 的
# ble-finder/res/drawable/ic_launcher.png 原样拷过来的（512×512，RGB，没有透明通道），
# 这样公开仓里没有 Android 的 res/ 也能编。Android 那张图换了的话：
#   ./scripts/make_icon.sh --refresh    从 ../ble-finder/res 重新拷源图，再重新生成
#   ./scripts/make_icon.sh --force      源图不动，只重新生成
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/App/Resources/icon-source.png"
OUT="$HERE/App/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
ANDROID="$HERE/../ble-finder/res/drawable/ic_launcher.png"
FORCE=0

case "${1:-}" in
  --refresh)
    if [ ! -f "$ANDROID" ]; then
      echo "找不到 Android 的图标：$ANDROID" >&2
      exit 1
    fi
    cp "$ANDROID" "$SRC"
    FORCE=1
    ;;
  --force) FORCE=1 ;;
  "") ;;
  *) echo "不认识的参数：$1" >&2; exit 2 ;;
esac

if [ ! -f "$SRC" ]; then
  echo "找不到图标源图：$SRC" >&2
  exit 1
fi
if [ -s "$OUT" ] && [ "$FORCE" = "0" ] && [ ! "$SRC" -nt "$OUT" ]; then
  echo "图标已经有了：$OUT"
  exit 0
fi

if command -v sips >/dev/null 2>&1; then
  # macOS 自带。
  sips -s format png -z 1024 1024 "$SRC" --out "$OUT" >/dev/null
elif command -v magick >/dev/null 2>&1; then
  magick "$SRC" -resize 1024x1024! -alpha off "$OUT"
elif command -v convert >/dev/null 2>&1; then
  convert "$SRC" -resize 1024x1024! -alpha off "$OUT"
elif python3 -c "import PIL" >/dev/null 2>&1; then
  python3 - "$SRC" "$OUT" <<'PY'
import sys
from PIL import Image
Image.open(sys.argv[1]).convert("RGB").resize((1024, 1024), Image.LANCZOS).save(sys.argv[2], "PNG")
PY
else
  echo "没有能缩放图片的工具（sips / ImageMagick / Python Pillow）。在 Mac 上跑就有 sips。" >&2
  exit 1
fi
echo "已生成图标：$OUT"
