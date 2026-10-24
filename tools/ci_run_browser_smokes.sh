#!/usr/bin/env bash
# 在 CI 上真的跑浏览器冒烟。
#
# 背景：13 套浏览器冒烟此前只在本机跑（`run_all_smokes.sh` 缺 agent-browser 时
# 打印 SKIP 并 exit 0）。于是验收清单里 19 条「已修缺陷 → 证据测试」的登记，
# 在 CI 上**一条断言都不产生**，却仍被算成「已覆盖」——证据被改弱时无人察觉。
#
# 这个脚本把三件事凑齐：agent-browser（含浏览器二进制）、运行中的 Vite、13 套冒烟。
# 单独成 job 而不是塞进 verify 步骤：它要装浏览器、要起服务，失败原因与
# 编译/单测不同，混在一起会让日志难读；也会拖慢每个 PR 的主门禁。
#
# 用法：tools/ci_run_browser_smokes.sh
# 环境变量：
#   KNOWFLICK_UI_URL  前端地址（默认 http://localhost:1420）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

URL="${KNOWFLICK_UI_URL:-http://localhost:1420}"

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "::error::CI 上没有 agent-browser，浏览器冒烟无法执行" >&2
  exit 1
fi

# agent-browser 还要自己的浏览器二进制；没有它时冒烟会在开页面那一步失败。
if ! agent-browser install 2>&1 | tail -3; then
  echo "::error::agent-browser 浏览器二进制安装失败" >&2
  exit 1
fi

# 起 Vite：冒烟要一个真实运行的前端。
# 端口占用时 strictPort 会直接失败——那是真问题，不要静默改端口。
VITE_LOG="$(mktemp -t knowflick-vite.XXXXXX.log)"
npm --prefix apps/workbench run dev -- --port 1420 --strictPort >"$VITE_LOG" 2>&1 &
VITE_PID=$!
cleanup() {
  if [ -n "${VITE_PID:-}" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 等前端就绪。冒烟脚本自己也探测一次，但这里要先确认服务真的起来了——
# 否则 13 套会各自报「打不开页面」，看不出是服务没起还是断言失败。
up=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "$URL" >/dev/null 2>&1; then
    up=1
    break
  fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "::error::Vite 进程已退出，日志：" >&2
    cat "$VITE_LOG" >&2
    exit 1
  fi
  sleep 2
done
if [ "$up" -ne 1 ]; then
  echo "::error::前端没在 60 秒内就绪（${URL}），日志：" >&2
  cat "$VITE_LOG" >&2
  exit 1
fi
echo "前端已就绪：$URL"

# 逐套跑，不用 run_all_smokes.sh：那个脚本在缺 agent-browser 时 exit 0，
# 在 CI 上会变成「什么都没跑也算成功」。这里自己遍历，缺任何一套都算失败。
SUITES=(
  taste_usability_gate
  workspace_ui_smoke
  brain_ui_smoke
  import_ui_smoke
  notes_ui_smoke
  notes_editor_smoke
  mailbox_ui_smoke
  review_ui_smoke
  scale_ui_smoke
  settings_plugins_smoke
  subscriptions_ui_smoke
  source_matrix_smoke
  usability_journey_smoke
  desktop_interaction_smoke
)

failed=""
for suite in "${SUITES[@]}"; do
  echo "=============== $suite"
  if node "tools/$suite.mjs"; then
    echo "OK $suite"
  else
    echo "::error::$suite 失败" >&2
    failed="$failed $suite"
  fi
done

if [ -n "$failed" ]; then
  echo "::error::以下冒烟套件失败：$failed" >&2
  exit 1
fi
echo "全部 ${#SUITES[@]} 套浏览器冒烟在 CI 上通过。"
