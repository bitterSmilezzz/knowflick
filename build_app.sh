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

# ---------- 配置 ----------
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

APP_NAME="KnowFlick"
DIST_DIR="$PROJECT_DIR/dist"
APP_DIR="$DIST_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

BINARY_SRC="$PROJECT_DIR/.build/release/$APP_NAME"
# SwiftPM 生成的资源 bundle, library target 命名规则: <Package>_<Target>.bundle
RESOURCE_BUNDLE_SRC="$PROJECT_DIR/.build/release/${APP_NAME}_${APP_NAME}Core.bundle"
RESOURCE_BUNDLE_NAME="$(basename "$RESOURCE_BUNDLE_SRC")"

# ---------- 1. 构建 ----------
echo "==> [1/3] swift build -c release"
swift build -c release

if [[ ! -x "$BINARY_SRC" ]]; then
    echo "错误: 未找到可执行文件 $BINARY_SRC" >&2
    exit 1
fi

# ---------- 2. 组装 app 目录 ----------
echo "==> [2/3] 组装 $APP_DIR"
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
	<string>2.8.0</string>
	<key>CFBundleVersion</key>
	<string>2.8.0</string>
	<key>LSMinimumSystemVersion</key>
	<string>14.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.education</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
</dict>
</plist>
PLIST

cp "$BINARY_SRC" "$MACOS_DIR/$APP_NAME"
chmod +x "$MACOS_DIR/$APP_NAME"

# ---------- 3. 复制应用图标与资源 bundle ----------
if [[ -f "$PROJECT_DIR/Resources/AppIcon.icns" ]]; then
    echo "==> [3/3] 复制应用图标与资源"
    cp "$PROJECT_DIR/Resources/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"
    echo "    已复制 AppIcon.icns"
fi

if [[ -d "$RESOURCE_BUNDLE_SRC" ]]; then
    echo "    复制资源 bundle ($RESOURCE_BUNDLE_NAME)"
    cp -R "$RESOURCE_BUNDLE_SRC" "$RESOURCES_DIR/"
    if [[ -f "$RESOURCES_DIR/$RESOURCE_BUNDLE_NAME/seed_cards.json" ]]; then
        echo "    确认 seed_cards.json 已随 bundle 复制"
    else
        echo "警告: bundle 中未找到 seed_cards.json" >&2
    fi
else
    echo "警告: 未找到资源 bundle $RESOURCE_BUNDLE_SRC, 跳过资源复制" >&2
fi

# ---------- 校验与刷新 ----------
plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null
touch "$APP_DIR"
echo "完成: $APP_DIR"
