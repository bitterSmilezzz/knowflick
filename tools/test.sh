#!/bin/bash
# Run Swift Testing with either Xcode or the Command Line Tools framework layout.
set -euo pipefail
cd "$(dirname "$0")/.."
TASK_BUILD_ROOT="${TMPDIR:-/tmp}/knowflick-swift"
mkdir -p "$TASK_BUILD_ROOT"
export CLANG_MODULE_CACHE_PATH="$TASK_BUILD_ROOT/clang"
export SWIFTPM_MODULECACHE_OVERRIDE="$TASK_BUILD_ROOT/modules"
DEVELOPER_ROOT="$(xcode-select -p)"
TEST_FRAMEWORKS="$DEVELOPER_ROOT/Library/Developer/Frameworks"
TEST_ARGS=(--disable-xctest)
if [[ "$DEVELOPER_ROOT" == */CommandLineTools && -d "$TEST_FRAMEWORKS/Testing.framework" ]]; then
    TEST_ARGS+=(-Xswiftc "-F$TEST_FRAMEWORKS" -Xlinker -rpath -Xlinker "$TEST_FRAMEWORKS" -Xlinker -rpath -Xlinker "$DEVELOPER_ROOT/Library/Developer/usr/lib")
fi
swift test "${TEST_ARGS[@]}" "$@"
