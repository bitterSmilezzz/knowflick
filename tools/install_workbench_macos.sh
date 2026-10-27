#!/usr/bin/env bash
# 本地「打包 -> 安装 -> 启动」一条链，macOS 专用。
#
# 为什么要有这个脚本：`tauri build --bundles dmg` 每次失败都会在 /Volumes 留下
# 一个 dmg.XXXXXX 挂载点，下一次打包因目录被占而再次失败——连续踩过三次，
# 每次都要人工 hdiutil detach。这里把清理、打包、安装、启动串起来。
#
# 用法：
#   ./tools/install_workbench_macos.sh             # 打包 + 安装 + 启动
#   ./tools/install_workbench_macos.sh --no-build  # 用现有 DMG 重装
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="KnowFlick"
TARGET="/Applications/${APP_NAME}.app"
DMG="$ROOT/apps/workbench/src-tauri/target/release/bundle/dmg/${APP_NAME}_0.1.0_aarch64.dmg"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "这个脚本只在 macOS 上有意义（DMG + /Applications）。" >&2
  exit 1
fi

cleanup_mounts() {
  # 只卸载名字形如 /Volumes/dmg.* 的残留挂载，不碰用户自己的卷。
  for vol in /Volumes/dmg.*; do
    [[ -d "$vol" ]] || continue
    echo "清理残留挂载：${vol}"
    hdiutil detach "$vol" -force >/dev/null 2>&1 || true
  done
  if [[ -d "/Volumes/${APP_NAME}" ]]; then
    hdiutil detach "/Volumes/${APP_NAME}" -quiet >/dev/null 2>&1 || true
  fi
}

cleanup_mounts
# 运行中的 app 会锁住 /Applications 里的包，先退掉。
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
pkill -f "${APP_NAME}.app/Contents/MacOS" >/dev/null 2>&1 || true
sleep 1

if [[ "${1:-}" != "--no-build" ]]; then
  echo "打包中…"
  ( cd "$ROOT/apps/workbench" && npm run tauri build -- --bundles dmg )
fi

[[ -f "$DMG" ]] || { echo "找不到 DMG：${DMG}" >&2; exit 1; }

echo "安装中…"
MOUNT_DIR="$(mktemp -d /tmp/knowflick-dmg.XXXXXX)"
cleanup_all() {
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
}
trap cleanup_all EXIT
hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$MOUNT_DIR"
# 先拷到临时名再替换：直接覆盖会留下半新半旧的 .app。
rm -rf "${TARGET}.new"
cp -R "$MOUNT_DIR/${APP_NAME}.app" "${TARGET}.new"
rm -rf "$TARGET"
mv "${TARGET}.new" "$TARGET"
hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
trap - EXIT
rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true

open -a "$TARGET"
sleep 4
if pgrep -f "${APP_NAME}.app/Contents/MacOS" >/dev/null; then
  echo "已安装并启动：${TARGET}（$(stat -f '%Sm' "$TARGET")）"
else
  echo "已安装，但进程没有起来——请手动打开一次看是否有报错。" >&2
  exit 1
fi
