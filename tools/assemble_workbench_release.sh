#!/usr/bin/env bash
# 组装第一套桌面（Go/Wails v3）的 Release 附件：校验命名与版本 → 生成 SHA256SUMS.txt →（可选）上传。
#
# 目录布局 = actions/download-artifact 落盘后的样子（workflow 里不 merge）：
#   <artifacts>/workbench-dmg/*-macos-arm64.dmg
#   <artifacts>/workbench-dmg-x64/*-macos-x64.dmg
#   <artifacts>/workbench-deb/*.deb
#   <artifacts>/workbench-exe/*.exe
#
# 为什么放在脚本里而不是 YAML：这条通道只有打 tag 才走，打 tag 低频且不好回退，
# 脚本可以在本机拿真实 DMG + 占位 deb/exe 空跑，逐条验证版本校验与命名映射。
#
# 用法：
#   tools/assemble_workbench_release.sh --tag workbench-v0.9.0-rc1 --artifacts-dir artifacts [--out out] [--publish]
set -euo pipefail

TAG="${GITHUB_REF_NAME:-}"
ARTIFACTS_DIR="artifacts"
OUT_DIR="out"
PUBLISH=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?--tag 需要值}"; shift 2 ;;
    --artifacts-dir) ARTIFACTS_DIR="${2:?}"; shift 2 ;;
    --out) OUT_DIR="${2:?}"; shift 2 ;;
    --publish) PUBLISH=1; shift ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [ -z "$TAG" ]; then echo "::error::缺少 tag（--tag 或 GITHUB_REF_NAME）" >&2; exit 2; fi
case "$TAG" in
  workbench-v*) ;;
  *) echo "::error::tag 必须以 workbench-v 开头：$TAG" >&2; exit 2 ;;
esac
VERSION="${TAG#workbench-v}"

PKG_VERSION="$(grep -m1 '"version"' "$ROOT/apps/workbench/package.json" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")"
if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "::error::tag 里的版本 $VERSION 与 apps/workbench/package.json 的 $PKG_VERSION 不一致" >&2
  exit 1
fi
echo "✓ tag $TAG 与 package.json 的版本一致：$VERSION"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

prefix="KnowFlick-Workbench-$VERSION"
files=("$prefix-macos-arm64.dmg" "$prefix-macos-x64.dmg" "$prefix-linux-amd64.deb" "$prefix-windows-x64.exe")
folders=(workbench-dmg workbench-dmg-x64 workbench-deb workbench-exe)
sources=()
for i in "${!files[@]}"; do
  src="$ARTIFACTS_DIR/${folders[i]}/${files[i]}"
  if [ ! -s "$src" ]; then
    echo "::error::缺少安装包或文件为空：$src" >&2
    exit 1
  fi
  sources+=("$src")
done

mkdir -p "$OUT_DIR"
cp "${sources[@]}" "$OUT_DIR/"
(
  cd "$OUT_DIR"
  sha256 "${files[@]}" > SHA256SUMS.txt
  sha256 -c SHA256SUMS.txt
  echo "✓ 组装完成：$OUT_DIR"
)

if [ "$PUBLISH" = 1 ]; then
  command -v gh >/dev/null 2>&1 || { echo "::error::--publish 需要 gh CLI" >&2; exit 1; }
  release_notes="$ROOT/docs/workbench_RELEASE_$VERSION.md"
  release_files=()
  for name in "${files[@]}" SHA256SUMS.txt; do
    release_files+=("$OUT_DIR/$name")
  done
  (
    cd "$OUT_DIR"
    sha256 -c SHA256SUMS.txt
  )
  if gh release view "$TAG" >/dev/null 2>&1; then
    gh release upload "$TAG" "${release_files[@]}" --clobber
  else
    args=(--verify-tag --title "KnowFlick Workbench $VERSION")
    if [[ "$VERSION" == *-* ]]; then args+=(--prerelease); fi
    if [ -f "$release_notes" ]; then
      args+=(--notes-file "$release_notes")
    else
      args+=(--generate-notes)
    fi
    gh release create "$TAG" "${release_files[@]}" "${args[@]}"
  fi
  echo "✓ 已上传到 Release $TAG"
fi
