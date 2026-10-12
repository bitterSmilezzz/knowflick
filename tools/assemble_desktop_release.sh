#!/usr/bin/env bash
# 组装桌面端 Release 附件：三系统安装包统一命名 + 校验和（可选直接发布）。
#
# 为什么是脚本而不是写在 workflow 里的一坨 shell：这条通道**只有打 tag 才会走**，
# 而打 tag 是低频且不可轻易回退的动作。把逻辑放进可本地执行的脚本后，任何人都能拿
# 本机真实产物 + 两个占位文件空跑一遍，确认命名映射、校验和、tag 版本校验都对。
#
# 目录布局 = actions/download-artifact 落盘后的样子（workflow 里不 merge）：
#   <root>/desktop-dmg/*.dmg   <root>/desktop-msi/*.msi   <root>/desktop-deb/*.deb
#
# 用法：
#   tools/assemble_desktop_release.sh --tag desktop-v0.1.0 [--artifacts-dir .] [--out out] [--publish]
#   （--tag 缺省取 ${GITHUB_REF_NAME}；不带 --publish 时只组装、不碰 GitHub）
set -euo pipefail

TAG="${GITHUB_REF_NAME:-}"
ARTIFACTS_DIR="."
OUT_DIR="out"
PUBLISH=0
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?--tag 需要值}"; shift 2 ;;
    --artifacts-dir) ARTIFACTS_DIR="${2:?}"; shift 2 ;;
    --out) OUT_DIR="${2:?}"; shift 2 ;;
    --publish) PUBLISH=1; shift ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [ -z "$TAG" ]; then
  echo "::error::缺少 tag（--tag 或 \${GITHUB_REF_NAME}）" >&2
  exit 2
fi
case "$TAG" in
  desktop-v*) ;;
  *) echo "::error::tag 必须以 desktop-v 开头（桌面端独立版本序列）：$TAG" >&2; exit 2 ;;
esac

VERSION="${TAG#desktop-v}"

# 与 macos.yml 同一条纪律：tag 与产物版本不符时，下载者拿到名不副实的安装包且事后难察觉。
# 取第一处 packageVersion —— macOS 块里的 1.0.0 是 jpackage 要求的 MAJOR>0 别名，不是产品版本。
CONFIGURED="$(grep -m1 'packageVersion = ' "$REPO_ROOT/apps/android/desktop/build.gradle.kts" | sed 's/.*"\(.*\)".*/\1/')"
if [ "$VERSION" != "$CONFIGURED" ]; then
  echo "::error::tag 里的版本 $VERSION 与 build.gradle.kts 的 packageVersion $CONFIGURED 不一致" >&2
  exit 1
fi
echo "✓ tag $TAG 与配置版本一致：$VERSION"

# shasum 不一定在（Debian 系默认是 sha256sum），两头都兜住，免得只在 CI 上炸
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

rm -rf "$OUT_DIR" && mkdir -p "$OUT_DIR"

# jpackage 的 macOS 包版本要求 MAJOR>0，DMG 文件名会是 KnowFlick-1.0.0.dmg；
# Windows/Linux 用产品版本。对外统一用**产品版本**，命名对齐 mac/android 的产物习惯。
copy_one() {
  local kind="$1" target="$2"   # 三者的扩展名与 artifact 名同名（dmg / msi / deb）
  local src
  src="$(ls "$ARTIFACTS_DIR/desktop-$kind"/*."$kind" 2>/dev/null | head -1 || true)"
  if [ -z "$src" ]; then
    echo "::error::没找到 $kind 产物（$ARTIFACTS_DIR/desktop-$kind/*.${kind}）" >&2
    exit 1
  fi
  cp "$src" "$OUT_DIR/$target"
  echo "  · $(basename "$src")  →  $target"
}

echo "组装附件（产品版本 ${VERSION}）："
copy_one dmg "KnowFlick-$VERSION-macos.dmg"
copy_one msi "KnowFlick-$VERSION-windows.msi"
copy_one deb "KnowFlick-$VERSION-linux.deb"

( cd "$OUT_DIR" && sha256 ./* > SHA256SUMS.txt )
echo "--- 附件清单 ---"
ls -l "$OUT_DIR" | tail -n +2

if [ "$PUBLISH" != "1" ]; then
  echo "（空跑模式：未发布。加 --publish 才会调 gh）"
  exit 0
fi

: "${GH_TOKEN:?发布需要 GH_TOKEN}"
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$OUT_DIR"/* --clobber
else
  gh release create "$TAG" "$OUT_DIR"/* \
    --title "KnowFlick Desktop $VERSION" \
    --notes "同一份代码在 Windows / macOS / Linux 三处发布（见 docs/adr/0001）。安装包由三台 runner 各自构建：jpackage 不支持交叉编译。"
fi
echo "✓ 已发布 $TAG"
