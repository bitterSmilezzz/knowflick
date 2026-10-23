#!/usr/bin/env bash
# 跑全部浏览器冒烟。
#
# 为什么要单独一个脚本：这些都要真实浏览器（agent-browser）与运行中的 Vite，
# **CI 环境两者都没有**（CI 上它们只能 SKIP）。于是它们此前只在本机手动跑，
# 界面退化不会被 CI 拦住——这是已知盲区。
#
# 这个脚本把「手动逐个跑」变成「一条命令跑完」，并接到 verify_workbench.sh
# 末尾（本机有 agent-browser 时自动执行；CI 会跳过）。
#
# 用法：tools/run_all_smokes.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "SKIP 浏览器冒烟需要 agent-browser（CI 环境没有）" >&2
  exit 0
fi

# 需要 Vite 在跑（KNOWFLICK_UI_URL，默认 http://localhost:1420）
URL="${KNOWFLICK_UI_URL:-http://localhost:1420}"
# 重试几次：Vite 可能正在启动（刚重启就跑门禁会撞上），一次探测就放弃太脆。
vite_up=0
for _ in 1 2 3 4 5; do
  if curl -fsS --max-time 3 "$URL" >/dev/null 2>&1; then vite_up=1; break; fi
  sleep 2
done
if [ "$vite_up" -ne 1 ]; then
  echo "SKIP 浏览器冒烟需要运行中的 Vite（$URL 不通）" >&2
  exit 0
fi

# 顺序有意：先跑便宜的（界面级），最后跑重的（桌面交互）。
SUITES=(
  taste_usability_gate
  workspace_ui_smoke
  brain_ui_smoke
  import_ui_smoke
  notes_ui_smoke
  mailbox_ui_smoke
  review_ui_smoke
  scale_ui_smoke
  settings_plugins_smoke
  subscriptions_ui_smoke
  source_matrix_smoke
  usability_journey_smoke
  desktop_interaction_smoke
)

# 真机专有：需要**已安装并运行**的桌面客户端。浏览器冒烟与 CI 都没有这个条件，
# 所以单独列出——混进 SUITES 会让「套数」与「浏览器冒烟」这个说法都不准。
DESKTOP_ONLY_SUITES=(
  desktop_external_write_smoke
)

failed=0
for suite in "${SUITES[@]}"; do
  script="tools/${suite}.mjs"
  [ -f "$script" ] || { echo "缺少 ${script}，跳过" >&2; continue; }
  printf '%-30s ' "$suite"
  if out="$(node "$script" 2>&1)"; then
    echo "$out" | tail -1
  else
    echo "失败"
    echo "$out" | tail -20
    failed=1
  fi
  # 每套结束时关掉自己的浏览器会话，但那是**异步**的——不等它关完就起下一套，
  # 两套会抢同一个 agent-browser 服务。实测这样会让 scale 冒烟在连跑时
  # 偶发超时（单跑时最慢 51-76ms，连跑时可能超预算）。给一点间隔。
  sleep 1
done

# 真机专有那几套：需要已安装并运行的桌面客户端。
# 条件不满足时它们自己会 SKIP 并说明原因（不假装通过，也不假装失败）。
for suite in "${DESKTOP_ONLY_SUITES[@]}"; do
  script="tools/${suite}.mjs"
  [ -f "$script" ] || { echo "缺少 ${script}，跳过" >&2; continue; }
  printf '%-30s ' "$suite"
  if out="$(node "$script" 2>&1)"; then
    echo "$out" | tail -1
  else
    echo "失败"
    echo "$out" | tail -20
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "有冒烟套件失败" >&2
  exit 1
fi
echo "全部浏览器冒烟通过（${#SUITES[@]} 套）"
