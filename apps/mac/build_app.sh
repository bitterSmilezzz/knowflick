#!/bin/bash
# build_app.sh — 将 SwiftPM 构建产物打包成 KnowFlick.app
#
# 用法:
#   ./build_app.sh
#
# 产物:
#   dist/KnowFlick.app
#
# 依赖:
#   - swift (Xcode 命令行工具, 需支持 macOS 14 SDK)
#   - 项目根目录需存在 Package.swift

set -euo pipefail

# 组装中途失败时清理半成品 .app，避免留下表面完整的残缺产物。
# 只在本次运行已经动过产物目录后才清理：若在编译阶段就失败，dist 里可能是上一次的成功产物，
# 不能因为这次失败把它删掉（此前会误删，2026-09-14 实际发生过一次）。
app_dir_owned=0
cleanup_on_failure() {
    local status=$?
    if [[ $status -ne 0 && "$app_dir_owned" -eq 1 && -d "$APP_DIR" ]]; then
        rm -rf "$APP_DIR"
        echo "构建失败，已清理半成品 $APP_DIR" >&2
    fi
}
trap cleanup_on_failure EXIT

# ---------- 配置 ----------
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"
# 仓库根：共享工具与产物目录都在那里，多端产物统一收敛到根 dist/
ROOT_DIR="$(cd "$PROJECT_DIR/../.." && pwd)"

APP_NAME="KnowFlick"
DIST_DIR="$ROOT_DIR/dist"
APP_DIR="$DIST_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

BINARY_SRC="$PROJECT_DIR/.build/release/$APP_NAME"
# SwiftPM 生成的资源 bundle, library target 命名规则: <Package>_<Target>.bundle
RESOURCE_BUNDLE_SRC="$PROJECT_DIR/.build/release/${APP_NAME}_${APP_NAME}Core.bundle"
RESOURCE_BUNDLE_NAME="$(basename "$RESOURCE_BUNDLE_SRC")"

# 版本单一来源：从 KnowFlickCore 的 AppVersion.swift 读取，避免 Info.plist 与代码版本漂移
APP_VERSION="$(sed -n 's/^    public static let current = "\(.*\)"$/\1/p' "$PROJECT_DIR/Sources/KnowFlickCore/Support/AppVersion.swift")"
if [[ -z "$APP_VERSION" ]]; then
    echo "错误: 未能从 Sources/KnowFlickCore/Support/AppVersion.swift 解析出版本号" >&2
    exit 1
fi

# ---------- 1. 构建 ----------
echo "==> [1/3] 同步共享资源 + 图标校验 + swift build -c release"
swift "$ROOT_DIR/tools/verify_icon.swift" Resources/AppIcon.icns Resources/AppIcon.png
# 种子卡与底图来自仓库根 shared/assets，需先落到本 target 的资源目录
"$ROOT_DIR/tools/sync_shared_assets.sh"
swift build -c release "$@"

if [[ ! -x "$BINARY_SRC" ]]; then
    echo "错误: 未找到可执行文件 $BINARY_SRC" >&2
    exit 1
fi

# 构建资源是必需项：缺失时不能生成表面成功但无卡片的应用。
# SwiftPM 的资源 bundle 有扁平与 Contents/Resources 两种布局，按文件名查找以兼容两者。
if ! find "$RESOURCE_BUNDLE_SRC" -name seed_cards.json -type f -print -quit | grep -q .; then
    echo "错误: 资源 bundle 内缺少 seed_cards.json（${RESOURCE_BUNDLE_SRC}）" >&2
    find "$RESOURCE_BUNDLE_SRC" -maxdepth 3 | head -20 >&2
    exit 1
fi

# ---------- 2. 组装 app 目录 ----------
echo "==> [2/3] 组装 $APP_DIR"
# 从这里开始产物目录归本次运行所有，失败时由 cleanup_on_failure 清理
app_dir_owned=1
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>KnowFlick</string>
	<key>CFBundleDisplayName</key>
	<string>KnowFlick</string>
	<key>CFBundleIdentifier</key>
	<string>com.knowflick.app</string>
	<key>CFBundleExecutable</key>
	<string>KnowFlick</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>__APP_VERSION__</string>
	<key>CFBundleVersion</key>
	<string>__APP_VERSION__</string>
	<key>LSMinimumSystemVersion</key>
	<string>14.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.education</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon.icns</string>
</dict>
</plist>
PLIST

cp "$BINARY_SRC" "$MACOS_DIR/$APP_NAME"
chmod +x "$MACOS_DIR/$APP_NAME"
cp "$PROJECT_DIR/Resources/AppIcon.png" "$RESOURCES_DIR/AppIcon.png"

# ---------- 3. 复制应用图标与资源 bundle ----------
if [[ -f "$PROJECT_DIR/Resources/AppIcon.icns" ]]; then
    echo "==> [3/3] 复制应用图标与资源"
    cp "$PROJECT_DIR/Resources/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"
    echo "    已复制 AppIcon.icns"
fi

if [[ -d "$RESOURCE_BUNDLE_SRC" ]]; then
    # 资源 bundle 放在 .app/Contents/Resources（标准位置，签名要求）。
    # 注意不能放 .app 根目录：那样会破坏代码签名
    # （unsealed contents present in the bundle root）。
    # 代码侧（CoreResources）已按多个候选位置查找，兼容各工具链的 accessor 差异。
    echo "    复制资源 bundle ($RESOURCE_BUNDLE_NAME)"
    cp -R "$RESOURCE_BUNDLE_SRC" "$RESOURCES_DIR/"
else
    echo "警告: 未找到资源 bundle $RESOURCE_BUNDLE_SRC, 跳过资源复制" >&2
fi

# ---------- 校验与刷新 ----------
sed -i '' "s/__APP_VERSION__/$APP_VERSION/g" "$CONTENTS_DIR/Info.plist"
plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null
codesign --force --deep --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"

# 启动自检：确认 Bundle.module 真的能找到资源。
# 这条检查是必需的——资源 bundle 位置放错时，编译、签名、复制都会通过，
# 只有真正启动才暴露 "could not load resource bundle" 崩溃（此前长期漏检）。
# 判定只看是否出现该致命错误：无 GUI 会话的环境下进程可能正常退出，不应误报。
echo "==> 启动自检"
SMOKE_LOG="$(mktemp)"
"$APP_DIR/Contents/MacOS/$(basename "$BINARY_SRC")" >"$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!
sleep 3
# 收尾必须容错：被 kill 的子进程会让 wait 返回 143，而 set -e 下这会直接终止脚本
# （此前误报为「打包失败」）。真实判据只有日志里有没有资源加载错误。
kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
if grep -q "could not load resource bundle" "$SMOKE_LOG"; then
    echo "错误: 资源 bundle 无法加载，产物启动即崩" >&2
    sed -n '1,5p' "$SMOKE_LOG" >&2
    rm -f "$SMOKE_LOG"
    exit 1
fi
echo "    启动自检通过"
rm -f "$SMOKE_LOG"

touch "$APP_DIR"
echo "完成: $APP_DIR"
