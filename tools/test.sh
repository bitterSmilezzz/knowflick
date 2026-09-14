#!/bin/bash
# Run Swift Testing with either Xcode or the Command Line Tools framework layout.
# macOS 端的 SwiftPM 工程位于 apps/mac/，这里切换过去再执行。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAC_DIR="$ROOT_DIR/apps/mac"
if [[ ! -f "$MAC_DIR/Package.swift" ]]; then
    echo "错误: 未找到 $MAC_DIR/Package.swift" >&2
    exit 1
fi
cd "$MAC_DIR"
# 共享资源（种子卡 / 底图）需先落到 mac 端资源目录，否则 swift test 会因种子卡缺失而失败
"$ROOT_DIR/tools/sync_shared_assets.sh"
TASK_BUILD_ROOT="${TMPDIR:-/tmp}/knowflick-swift"
mkdir -p "$TASK_BUILD_ROOT"
export CLANG_MODULE_CACHE_PATH="$TASK_BUILD_ROOT/clang"
export SWIFTPM_MODULECACHE_OVERRIDE="$TASK_BUILD_ROOT/modules"
if ! DEVELOPER_ROOT="$(xcode-select -p 2>/dev/null)"; then
    echo "错误: 未配置开发者目录。请运行 'xcode-select --install'，或 'sudo xcode-select -s /Applications/Xcode.app'" >&2
    exit 1
fi
TEST_FRAMEWORKS="$DEVELOPER_ROOT/Library/Developer/Frameworks"
TEST_ARGS=(--disable-xctest)
if [[ "$DEVELOPER_ROOT" == */CommandLineTools && -d "$TEST_FRAMEWORKS/Testing.framework" ]]; then
    TEST_ARGS+=(-Xswiftc "-F$TEST_FRAMEWORKS" -Xlinker -rpath -Xlinker "$TEST_FRAMEWORKS" -Xlinker -rpath -Xlinker "$DEVELOPER_ROOT/Library/Developer/usr/lib")
fi
swift test "${TEST_ARGS[@]}" "$@"
