#!/usr/bin/env bash
# 编 Vue 界面并拷进 iOS 工程，再准备 App 图标。iOS 和 Android 用的是同一份界面源码、同一个产物。
#
#   ./build_ui.sh             npm ci（没装过依赖时）+ npm run build，然后拷贝
#   ./build_ui.sh --no-build  不跑 npm，只拷已经编好的 index.html
#
# 界面源码在哪里自动找，两种目录布局都认：
#   公开仓  evcity-ble-app：  ios/ 旁边的 ../ui
#   AC-V2：                   APP/ios/ 旁边的 ../ui（APP/ui）
# 也可以用环境变量 EVC_UI_DIR 直接指定。
#
# 注意：vite 的配置（ui/vite.config.js）会把单文件的 index.html 写到 ui 旁边：AC-V2 里是 Android 壳的
# ../android/assets/index.html（APP/android/assets），公开仓里是 ../assets/index.html。写之前先清空那个目录，
# 也就是说跑这个脚本等于顺便重编了 Android 用的界面文件。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "不认识的参数：$arg" >&2; exit 2 ;;
  esac
done

UI_DIR="${EVC_UI_DIR:-}"
if [ -z "$UI_DIR" ]; then
  for candidate in "$HERE/../ui"; do
    if [ -f "$candidate/package.json" ]; then
      UI_DIR="$candidate"
      break
    fi
  done
fi
if [ -z "$UI_DIR" ] || [ ! -f "$UI_DIR/package.json" ]; then
  echo "找不到 Vue 界面源码（../ui 没有 package.json）。" >&2
  echo "可以用 EVC_UI_DIR=<目录> 指定。" >&2
  exit 1
fi
UI_DIR="$(cd "$UI_DIR" && pwd)"
echo "界面源码：$UI_DIR"

if [ "$BUILD" = "1" ]; then
  if [ ! -d "$UI_DIR/node_modules" ] || [ "${CI:-}" = "true" ]; then
    (cd "$UI_DIR" && npm ci)
  fi
  (cd "$UI_DIR" && npm run build)
fi

# 和 Android 一样用单文件的 index.html（脚本和样式都内嵌）。
if [ -f "$UI_DIR/../android/AndroidManifest.xml" ]; then
  SINGLE="$UI_DIR/../android/assets/index.html"
else
  SINGLE="$UI_DIR/../assets/index.html"
fi
if [ ! -s "$SINGLE" ]; then
  echo "没有找到编好的界面：$SINGLE" >&2
  echo "去掉 --no-build 再跑一次。" >&2
  exit 1
fi
if ! grep -q "evcTryBack" "$SINGLE"; then
  echo "$SINGLE 不像是这个 App 的界面（里面没有 evcTryBack）。" >&2
  exit 1
fi

WEB_DIR="$HERE/App/Resources/Web"
mkdir -p "$WEB_DIR"
cp "$SINGLE" "$WEB_DIR/index.html"
echo "已拷贝：$WEB_DIR/index.html（$(wc -c < "$WEB_DIR/index.html" | tr -d ' ') 字节）"

if ! bash "$HERE/scripts/make_icon.sh"; then
  if [ "$(uname -s)" = "Darwin" ]; then
    exit 1
  fi
  # 不在 Mac 上（比如只是想在 Linux 上拷界面看看）：图标留到 Mac 上再生成。
  echo "提示：这台机器上没生成图标，到 Mac 上再跑一次本脚本即可。" >&2
fi
