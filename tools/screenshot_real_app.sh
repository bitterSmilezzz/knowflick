#!/usr/bin/env bash
# 真实桌面应用截图。
#
# 显示器息屏时 screencapture 只会截到黑屏（106KB），而唤醒后能截到完整画面
# （4MB）。所以先唤醒显示器、把应用置前，再截指定窗口。
#
# 用法：tools/screenshot_real_app.sh [输出路径] [窗口标题匹配]
set -uo pipefail

OUT="${1:-.scratch/real-app.png}"
TITLE="${2:-KnowFlick}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$(dirname "$OUT")"

# 唤醒显示器：caffeinate -u 断言显示器已醒
caffeinate -u -t 3 >/dev/null 2>&1 || true
osascript -e 'tell application "System Events" to key code 62' >/dev/null 2>&1 || true
osascript -e "tell application \"${TITLE}\" to activate" >/dev/null 2>&1 || true
sleep 3

# 只截应用窗口（截整屏会带进别的应用与桌面壁纸）。
# screencapture -l 要 CGWindowID，AppleScript 给的是 AXUIElement id，两者不同；
# 这台机器没有 pyobjc 拿不到 Quartz，所以按窗口坐标用 -R 裁剪。
GEOM="$(osascript -e 'tell application "System Events" to tell process "KnowFlick" to get {position, size} of front window' 2>/dev/null || true)"
if [ -n "$GEOM" ]; then
  # 输出形如 "248, 31, 1040, 728"：x, y, 宽, 高
  X=$(echo "$GEOM" | cut -d, -f1 | tr -d ' ')
  Y=$(echo "$GEOM" | cut -d, -f2 | tr -d ' ')
  W=$(echo "$GEOM" | cut -d, -f3 | tr -d ' ')
  H=$(echo "$GEOM" | cut -d, -f4 | tr -d ' ')
  if [ -n "${W:-}" ] && [ "${W:-0}" -gt 0 ] 2>/dev/null; then
    # 多显示器时坐标可能带负数，-R 不接受；此时退回整屏。
    if [ "${X:-0}" -ge 0 ] && [ "${Y:-0}" -ge 0 ]; then
      screencapture -x -R "${X},${Y},${W},${H}" "$OUT" 2>/dev/null || screencapture -x "$OUT"
    else
      screencapture -x "$OUT"
    fi
  else
    screencapture -x "$OUT"
  fi
else
  screencapture -x "$OUT"
fi

if [ -f "$OUT" ]; then
  SIZE="$(stat -f%z "$OUT")"
  # 息屏时截到的是纯黑（几十 KB）；正常画面是几百 KB 到几 MB。
  if [ "$SIZE" -lt 150000 ]; then
    echo "警告：截图只有 ${SIZE} 字节，可能是屏幕仍处于休眠状态" >&2
  else
    echo "已截图：${OUT}（${SIZE} 字节）"
  fi
else
  echo "截图失败：${OUT} 未生成" >&2
  exit 1
fi
