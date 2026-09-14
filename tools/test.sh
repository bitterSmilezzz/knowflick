#!/bin/bash
# Run Swift Testing with either Xcode or the Command Line Tools framework layout.
# macOS 端的 SwiftPM 工程位于 apps/mac/，这里切换过去再执行。
#
# 用法：
#   ./tools/test.sh                 全部测试（需要完整 Xcode：执行文件依赖 SwiftUI 宏）
#   ./tools/test.sh --core-only     只跑 KnowFlickCoreTests（仅装 CommandLineTools 也能跑）
#
# 为什么需要 --core-only：KnowFlick 执行文件用了 SwiftUI 的宏（@State 等），
# 其宏实现 libSwiftUIMacros.dylib 只在完整 Xcode 里提供，CommandLineTools 不带。
# 只装 CLT 时 `swift test` 会尝试构建执行文件并失败，导致 170 多项 Core 测试
# 一个都跑不了。--core-only 只构建测试目标，绕开这个依赖。
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
    # CommandLineTools 把 Swift Testing 的宏实现放在 plugins/testing/ 下，且不在默认插件
    # 搜索路径里。缺了它，所有 @Test/@Suite 都会报 "TestingMacros ... plugin not found"，
    # 而报错和成功在多次运行间还会漂移（取决于缓存状态），非常难判断。
    TESTING_PLUGIN_DIR="$DEVELOPER_ROOT/usr/lib/swift/host/plugins/testing"
    if [[ -d "$TESTING_PLUGIN_DIR" ]]; then
        TEST_ARGS+=(-Xswiftc -plugin-path -Xswiftc "$TESTING_PLUGIN_DIR")
    fi
fi

# SwiftUI 宏插件只在完整 Xcode 中提供；缺失时执行文件目标无法编译
SWIFTUI_MACROS="$DEVELOPER_ROOT/usr/lib/swift/host/plugins/libSwiftUIMacros.dylib"
CORE_ONLY=0
PASSTHROUGH=()
for arg in "$@"; do
    if [[ "$arg" == "--core-only" ]]; then
        CORE_ONLY=1
    else
        PASSTHROUGH+=("$arg")
    fi
done

if [[ $CORE_ONLY -eq 1 ]]; then
    if [[ ! -e "$SWIFTUI_MACROS" ]]; then
        echo "提示: 当前开发者目录缺少 SwiftUI 宏插件，只构建测试目标（KnowFlickCoreTests）。"
    fi
    # 先只构建测试目标，再用 --skip-build 运行，避免连带构建依赖 SwiftUI 宏的执行文件
    swift build --target KnowFlickCoreTests "${TEST_ARGS[@]:1}" \
        || { echo "错误: KnowFlickCoreTests 构建失败" >&2; exit 1; }
    swift test --skip-build "${TEST_ARGS[@]}" "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
    exit $?
fi

if [[ ! -e "$SWIFTUI_MACROS" ]]; then
    echo "警告: 当前开发者目录（$DEVELOPER_ROOT）缺少 SwiftUI 宏插件，执行文件目标无法编译。" >&2
    echo "      Core 测试可用 './tools/test.sh --core-only' 运行；全部测试需要完整 Xcode。" >&2
fi

swift test "${TEST_ARGS[@]}" "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
