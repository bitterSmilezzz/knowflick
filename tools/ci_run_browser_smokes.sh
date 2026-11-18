#!/usr/bin/env bash
# 在 CI 上真的跑浏览器冒烟。
#
# 背景：整套浏览器冒烟此前只在本机跑（`run_all_smokes.sh` 缺 agent-browser 时
# 打印 SKIP 并 exit 0）。于是验收清单里 19 条「已修缺陷 → 证据测试」的登记，
# 在 CI 上**一条断言都不产生**，却仍被算成「已覆盖」——证据被改弱时无人察觉。
#
# 这个脚本准备 agent-browser（含浏览器二进制）和 Vite，然后运行全部浏览器冒烟。
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
# 前端未就绪时统一报告启动失败。
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

# 先用一个临时会话把首屏与 React 依赖图预热一遍。
#
# 为什么：Vite 是按需转译的。第一套冒烟打开页面时，Vite 才现编 React、样式与
# 工作台首屏那一大票模块；本机 SSD 上几百毫秒，CI 的共享 runner 上能压到几秒，
# 而那段一次性代价算在第一套套件的等待预算里，看起来就像「界面没渲染出来」。
# 预热用真实浏览器打开一次页面并等到工作台出现，等价于把这段代价挪出套件预算；
# 它不改任何断言——预热失败也不影响后续判断，各套自己还会再等。
agent-browser --session kf-ci-warmup open "$URL" >/dev/null 2>&1 || true
for _ in $(seq 1 60); do
  if [ "$(agent-browser --session kf-ci-warmup eval 'JSON.stringify(!!document.querySelector(".ws"))' 2>/dev/null | tail -1)" = "true" ]; then
    echo "首屏预热完成"
    break
  fi
  sleep 2
done
agent-browser --session kf-ci-warmup close >/dev/null 2>&1 || true

# 逐套跑，不用 run_all_smokes.sh：那个脚本在缺 agent-browser 时 exit 0，
# 在 CI 上会变成「什么都没跑也算成功」。这里自己遍历，缺任何一套都算失败。
SUITES=(
  taste_usability_gate
  workspace_ui_smoke
  brain_ui_smoke
  import_ui_smoke
  notes_ui_smoke
  notes_editor_smoke
  note_retrieval_smoke
  creative_smoke
  review_reminder_smoke
  goal_scope_smoke
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
  # 把每套的输出留在文件里：失败时只写「失败」两个字的注解，等于把定位工作
  # 全推给「本机复现一下」——而 CI 与本机的差异（更慢的机器、更小的视口）
  # 恰恰是这些套件失败的原因。这里把尾部输出打进注解，一眼能看出卡在哪条断言。
  suite_log="$(mktemp -t "knowflick-$suite.XXXXXX.log")"
  if node "tools/$suite.mjs" 2>&1 | tee "$suite_log"; then
    echo "OK $suite"
  else
    echo "::error::$suite 失败" >&2
    tail -25 "$suite_log" | while IFS= read -r line; do
      echo "::error::$suite 现场：$line" >&2
    done
    failed="$failed $suite"
  fi
  rm -f "$suite_log"
  # 浏览器会话异步关闭，给下一套留出与本机门禁相同的清理时间。
  sleep 1
done

if [ -n "$failed" ]; then
  echo "::error::以下冒烟套件失败：$failed" >&2
  exit 1
fi
echo "全部 ${#SUITES[@]} 套浏览器冒烟在 CI 上通过。"
