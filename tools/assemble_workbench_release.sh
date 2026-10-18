#!/usr/bin/env bash
# 组装第一套桌面（apps/workbench，Web + Tauri）的 Release 附件：三系统安装包统一命名 + 校验和（可选直接发布）。
#
# 与 tools/assemble_desktop_release.sh 同一条纪律，理由也一样：这条通道**只有打 tag 才会走**，
# 打 tag 低频且不好回退，所以逻辑放在可本地执行的脚本里，而不是塞进 YAML。
# 本机可以拿真实 DMG + 两个占位文件空跑，逐条验证版本校验、命名映射与守卫。
#
# 版本序列与冻结的 JVM 桌面（tag `desktop-v*`，产物 `KnowFlick-<版本>-<系统>.<扩展名>`）**分开**：
# 这里是 tag `workbench-v*`、产物 `KnowFlick-Workbench-<版本>-<系统>.<扩展名>`。
# 两套都在做「一个桌面」这件事，产物名必须能一眼区分，否则下载者拿错包。
#
# 目录布局 = actions/download-artifact 落盘后的样子（workflow 里不 merge）：
#   <root>/workbench-dmg/*.dmg   <root>/workbench-msi/*.msi   <root>/workbench-deb/*.deb
#
# 用法：
#   tools/assemble_workbench_release.sh --tag workbench-v0.1.0 [--artifacts-dir .] [--out out] [--publish]
#   （--tag 缺省取 ${GITHUB_REF_NAME}；不带 --publish 时只组装、不碰 GitHub）
set -euo pipefail

TAG="${GITHUB_REF_NAME:-}"
ARTIFACTS_DIR="."
OUT_DIR="out"
PUBLISH=0
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WB_DIR="$REPO_ROOT/apps/workbench"

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
  workbench-v*) ;;
  *) echo "::error::tag 必须以 workbench-v 开头（第一套桌面独立版本序列）：$TAG" >&2; exit 2 ;;
esac

VERSION="${TAG#workbench-v}"

# tag 与产物版本不符时，下载者拿到名不副实的安装包且事后难察觉（与 macos.yml / desktop.yml 同一条纪律）。
# 两处声明都要对：Tauri 打包读 tauri.conf.json 的 version，npm 读 package.json 的 version。
json_version() {
  grep -m1 '"version"' "$1" | sed 's/.*: *"\([^"]*\)".*/\1/'
}
CONF_VERSION="$(json_version "$WB_DIR/src-tauri/tauri.conf.json")"
PKG_VERSION="$(json_version "$WB_DIR/package.json")"
if [ "$VERSION" != "$CONF_VERSION" ]; then
  echo "::error::tag 里的版本 $VERSION 与 tauri.conf.json 的 version $CONF_VERSION 不一致" >&2
  exit 1
fi
if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "::error::tag 里的版本 $VERSION 与 package.json 的 version $PKG_VERSION 不一致" >&2
  exit 1
fi
echo "✓ tag $TAG 与 tauri.conf.json / package.json 的版本一致：$VERSION"

# shasum 不一定在（Debian 系默认是 sha256sum），两头都兜住，免得只在 CI 上炸
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

rm -rf "$OUT_DIR" && mkdir -p "$OUT_DIR"

# Tauri 的产物名是 KnowFlick_<版本>_<架构>.dmg / KnowFlick_<版本>_x64_en-US.msi / KnowFlick_<版本>_amd64.deb，
# 架构与语言后缀随 runner 变。对外统一成「产品 + 套 + 版本 + 系统」，与 mac/android 的产物习惯对齐。
copy_one() {
  local kind="$1" target="$2"   # 三者的扩展名与 artifact 名同名（dmg / msi / deb）
  local src
  src="$(ls "$ARTIFACTS_DIR/workbench-$kind"/*."$kind" 2>/dev/null | head -1 || true)"
  if [ -z "$src" ]; then
    echo "::error::没找到 $kind 产物（$ARTIFACTS_DIR/workbench-$kind/*.${kind}）" >&2
    exit 1
  fi
  cp "$src" "$OUT_DIR/$target"
  echo "  · $(basename "$src")  →  $target"
}

echo "组装附件（第一套桌面版本 ${VERSION}）："
copy_one dmg "KnowFlick-Workbench-$VERSION-macos.dmg"
copy_one msi "KnowFlick-Workbench-$VERSION-windows.msi"
copy_one deb "KnowFlick-Workbench-$VERSION-linux.deb"

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
    --title "KnowFlick Workbench $VERSION" \
    --notes "第一套桌面（Web + Tauri）的安装包，覆盖 Windows / Linux / macOS（见 docs/adr/0002）。三台 runner 各构建各系统：Tauri 与 jpackage 一样不支持交叉编译。与冻结的 JVM 桌面是两条独立版本序列。"
fi
echo "✓ 已发布 $TAG"
