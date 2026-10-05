#!/usr/bin/env bash
#
# 把 shared/assets 的共享资源同步进 mac 端的 SwiftPM 资源目录。
#
# 为什么不用符号链接：SwiftPM 是否把指向 target 之外的符号链接打进资源 bundle，
# 在不同工具链上行为不一致——本地 CLT 27 正常，CI 的 Xcode 26.3 下 bundle 里就没有
# 内容。改为显式复制真文件，结果可预期。
#
# shared/assets 始终是唯一事实来源；本脚本生成的文件不入 Git（见 .gitignore）。
# tools/test.sh 与 apps/mac/build_app.sh 都会先调用本脚本。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT_DIR/shared/assets"
DEST="$ROOT_DIR/apps/mac/Sources/KnowFlickCore/Resources"

if [[ ! -d "$SRC" ]]; then
    echo "错误: 找不到共享资源目录 $SRC" >&2
    exit 1
fi
# 只清理本脚本生成的产物，保留 .gitkeep（无它则 clone 后目录不存在，
# SwiftPM 会因「资源目录缺失」直接报错）。
rm -rf "$DEST/bg" "$DEST/README.txt"
mkdir -p "$DEST/bg"

cp "$SRC"/bg/*.webp "$DEST/bg/"
printf 'mac 端资源由 tools/sync_shared_assets.sh 从 shared/assets 生成，请勿在此提交内容。\n' > "$DEST/README.txt"

IMAGES="$(find "$DEST/bg" -name '*.webp' | wc -l | tr -d ' ')"
if [[ "$IMAGES" -eq 0 ]]; then
    echo "错误: $SRC/bg 下没有任何底图" >&2
    exit 1
fi
echo "已同步共享资源到 apps/mac：底图 $IMAGES 张"
