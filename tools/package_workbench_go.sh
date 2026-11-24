#!/usr/bin/env bash
# 第一套桌面（Go/Wails v3）的安装包：macOS DMG、Linux DEB、Windows NSIS 安装器。
#
# 三个平台都只能在自己的系统上构建（cgo + 平台框架，不支持交叉编译），CI 的矩阵与这里一一对应。
# 命名统一为 KnowFlick-Workbench-<版本>-<系统>-<架构>.<扩展名>。
#
# 用法：
#   ./tools/package_workbench_go.sh [--version 0.1.0] [--out dist/workbench] [--skip-build]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=""
OUT=""
SKIP_BUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:?--version 需要值}"; shift 2 ;;
    --out) OUT="${2:?--out 需要值}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

PKG_VERSION="$(grep -m1 '"version"' "$ROOT/apps/workbench/package.json" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")"
if [ -z "$VERSION" ]; then VERSION="$PKG_VERSION"; fi
if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "::error::版本 $VERSION 与 apps/workbench/package.json 的 $PKG_VERSION 不一致" >&2
  exit 1
fi

if [ -z "$OUT" ]; then OUT="$ROOT/dist/workbench"; fi
mkdir -p "$OUT"
# 统一成绝对路径：CI 里 --out 传的是相对路径，NSIS 的 File 会按脚本目录解析相对路径而找不到产物。
OUT="$(cd "$OUT" && pwd)"

if [ "$SKIP_BUILD" = 0 ]; then
  "$ROOT/tools/build_workbench_go.sh"
fi
BIN="$ROOT/apps/workbench-go/bin/knowflick-go-preview"
if [ ! -x "$BIN" ]; then echo "::error::没有可执行文件：${BIN}（先跑 tools/build_workbench_go.sh）" >&2; exit 1; fi

OS="$(go env GOOS)"
ARCH_RAW="$(go env GOARCH)"
case "$ARCH_RAW" in
  arm64) ARCH=arm64 ;;
  amd64) ARCH=x64 ;;
  *) ARCH="$ARCH_RAW" ;;
esac

case "$OS" in
  darwin)
    APP="$OUT/KnowFlick.app"
    rm -rf "$APP"
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
    cp "$BIN" "$APP/Contents/MacOS/KnowFlick"
    cp "$ROOT/shared/icons/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
    BUILD_NUMBER="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 0)"
    sed -e "s/__VERSION__/$VERSION/g" -e "s/__BUILD__/$BUILD_NUMBER/g" \
      "$ROOT/packaging/macos/Info.plist" > "$APP/Contents/Info.plist"
    chmod +x "$APP/Contents/MacOS/KnowFlick"
    plutil -lint "$APP/Contents/Info.plist" >/dev/null
    # ad-hoc 签名：本机可运行；正式分发仍需 Developer ID 与公证（未接入）。
    codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
    STAGE="$(mktemp -d)"
    cp -R "$APP" "$STAGE/"
    ln -s /Applications "$STAGE/Applications"
    DMG="$OUT/KnowFlick-Workbench-$VERSION-macos-$ARCH.dmg"
    rm -f "$DMG"
    hdiutil create -volname "KnowFlick" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
    rm -rf "$STAGE"
    echo "✓ $DMG"
    ;;
  linux)
    command -v dpkg-deb >/dev/null 2>&1 || { echo "::error::缺少 dpkg-deb（Debian 系系统上才能打 .deb）" >&2; exit 1; }
    DEB_ARCH="$ARCH_RAW"
    PKGDIR="$OUT/pkg-linux"
    rm -rf "$PKGDIR"
    mkdir -p "$PKGDIR/DEBIAN" "$PKGDIR/usr/bin" "$PKGDIR/usr/share/applications" "$PKGDIR/usr/share/icons/hicolor/512x512/apps"
    install -m 755 "$BIN" "$PKGDIR/usr/bin/knowflick"
    install -m 644 "$ROOT/packaging/linux/knowflick.desktop" "$PKGDIR/usr/share/applications/knowflick.desktop"
    install -m 644 "$ROOT/shared/icons/AppIcon.png" "$PKGDIR/usr/share/icons/hicolor/512x512/apps/knowflick.png"
    SIZE_KB="$(du -sk "$PKGDIR/usr" | cut -f1)"
    sed -e "s/__VERSION__/$VERSION/g" -e "s/__ARCH__/$DEB_ARCH/g" -e "s/__SIZE__/$SIZE_KB/g" \
      "$ROOT/packaging/linux/control" > "$PKGDIR/DEBIAN/control"
    chmod 644 "$PKGDIR/DEBIAN/control"
    DEB="$OUT/KnowFlick-Workbench-$VERSION-linux-$ARCH_RAW.deb"
    rm -f "$DEB"
    dpkg-deb --root-owner-group --build "$PKGDIR" "$DEB" >/dev/null
    rm -rf "$PKGDIR"
    echo "✓ $DEB"
    ;;
  windows|msys*|cygwin*)
    command -v makensis >/dev/null 2>&1 || { echo "::error::缺少 makensis（CI 上先 choco install nsis）" >&2; exit 1; }
    EXE="$OUT/KnowFlick.exe"
    cp "$BIN" "$EXE"
    if command -v cygpath >/dev/null 2>&1; then
      WIN_EXE="$(cygpath -w "$EXE")"
      WIN_ICON="$(cygpath -w "$ROOT/shared/icons/AppIcon.ico")"
      WIN_OUT="$(cygpath -w "$OUT/KnowFlick-Workbench-$VERSION-windows-$ARCH.exe")"
    else
      WIN_EXE="$EXE"; WIN_ICON="$ROOT/shared/icons/AppIcon.ico"
      WIN_OUT="$OUT/KnowFlick-Workbench-$VERSION-windows-$ARCH.exe"
    fi
    ( cd "$ROOT" && makensis -V1 -DVERSION="$VERSION" -DOUT="$WIN_OUT" -DBIN="$WIN_EXE" -DICON="$WIN_ICON" packaging/windows/installer.nsi >/dev/null )
    rm -f "$EXE"
    echo "✓ $WIN_OUT"
    ;;
  *)
    echo "::error::$OS 不支持（CI 矩阵只覆盖 darwin / linux / windows）" >&2
    exit 1
    ;;
esac
