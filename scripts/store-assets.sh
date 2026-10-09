#!/usr/bin/env bash
# 渲染 Chrome 商店素材：docs/store/assets/src/*.html → docs/store/assets/*.png
#   截图 1280×800、小宣传图 440×280，24 位 PNG、无 alpha（商店要求）。
#   用本机 Google Chrome headless 渲染（独立临时 profile，不碰日常 profile），ImageMagick 压平 alpha 并核对尺寸。
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC="docs/store/assets/src"
OUT="docs/store/assets"
[ -x "${CHROME}" ] || { echo "找不到 Google Chrome: ${CHROME}" >&2; exit 1; }
command -v magick >/dev/null || { echo "找不到 ImageMagick (magick)" >&2; exit 1; }

render() {
  local name="$1" w="$2" h="$3"
  local tmp
  tmp="$(mktemp -d)"
  # Chrome 154 偶尔在截图写完后不退出，所以用 timeout 兜底，只看截图文件是否生成；结束后清掉这个临时 profile 的残留进程
  timeout 45 "${CHROME}" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="${tmp}/profile" --force-device-scale-factor=1 --timeout=8000 \
    --window-size="${w},${h}" --screenshot="${tmp}/shot.png" "file://${PWD}/${SRC}/${name}.html" >/dev/null 2>&1 || true
  pkill -f "${tmp}/profile" 2>/dev/null || true
  [ -s "${tmp}/shot.png" ] || { echo "截图没有生成: ${name}" >&2; exit 1; }
  magick "${tmp}/shot.png" -background white -alpha remove -alpha off "PNG24:${OUT}/${name}.png"
  rm -rf "${tmp}"
  local info
  info="$(magick identify -format '%w %h %[channels] %[bit-depth]' "${OUT}/${name}.png")"
  echo "${name}.png  ${info}"
  case "${info}" in
    "${w} ${h} srgb "*) ;;
    *) echo "尺寸或通道不对（期望 ${w} ${h} srgb）: ${info}" >&2; exit 1 ;;
  esac
}

# 用法：bash scripts/store-assets.sh [名字…]；不带参数渲染全部
ALL="01-save 02-files 03-kinds 04-ways 05-privacy promo-440x280"
for name in ${*:-${ALL}}; do
  case "${name}" in
    promo-440x280) render "${name}" 440 280 ;;
    *) render "${name}" 1280 800 ;;
  esac
done
echo "store assets: OK"
