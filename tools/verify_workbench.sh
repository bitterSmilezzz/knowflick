#!/usr/bin/env bash
# ADR-0002 第一套桌面：与 .github/workflows/workbench.yml 同口径的本地门禁。
#
# 用法：
#   ./tools/verify_workbench.sh           # 全部（本机默认：含 18 套浏览器冒烟）
#   ./tools/verify_workbench.sh web       # 只前端：单测 + 类型检查 + 全部守卫
#   ./tools/verify_workbench.sh go        # 只 Go 后端：go vet + go test ./...
#
# 为什么要能分片：CI 里前端那半几分钟就绿，Go 那半要编译 Wails 依赖与整棵服务代码，
# 两者绑在一个 job 里时，慢的那半会把「门禁是否通过」的信号一直拖住。
# 拆成两个 job 各跑一段，信号来得快，失败也能一眼看出是哪一半。
set -euo pipefail
SCOPE="${1:-all}"
case "$SCOPE" in
  all|web|go) ;;
  *)
    echo "用法：${0} [all|web|go]（收到：${SCOPE}）" >&2
    exit 2
    ;;
esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

trap 'status=$?; echo "::error::门禁失败（退出码 ${status}）：第 ${LINENO} 行：${BASH_COMMAND}" >&2; exit ${status}' ERR

# 跑一步并把**失败现场**写成 CI 注解。
#
# 为什么：ERR trap 只说得清「哪一行挂了」，说不清「哪条断言挂了」。公开仓库的
# job 日志要 admin 权限才拿得到，注解是唯一读得到的失败细节——所以把该步输出的
# 尾部逐行打成 ::error::。正常输出照常流到日志（tee），看日志的人不受影响。
run_step() {
  local label="$1"
  shift
  local log
  log="$(mktemp -t "kf-step.XXXXXX.log")"
  if "$@" 2>&1 | tee "$log"; then
    rm -f "$log"
    return 0
  fi
  echo "::error::步骤失败：${label}" >&2
  # 注解配额一步只有 10 条：先放**最像原因**的行，再用尾部收口。
  # 为什么改：Windows 的 cmake 失败那次只放 tail -10，真正的「CMake Error」被挤出去了，
  # 留下来的是 panic 的尾巴与几行空行——知道挂了，不知道为什么挂。
  # 只给「命中行」还不够：CMake Error 的下一行才是具体原因（缺编译器/找不到库）。
  # 所以每条关键行后面再带两行上下文——那两行通常就是真正能动手修的东西。
  local hits
  hits="$(grep -niE 'error|panick|cannot find|not found|failed|could not' "$log" | head -3 | cut -d: -f1 || true)"
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" | while IFS= read -r line; do
      sed -n "${line},$((line + 2))p" "$log" | while IFS= read -r ctx; do
        echo "::error::${label} 关键行：${ctx}" >&2
      done
    done
  fi
  tail -4 "$log" | while IFS= read -r line; do
    echo "::error::${label} 现场：${line}" >&2
  done
  rm -f "$log"
  return 1
}
if [ "$SCOPE" != go ]; then
  cd "$ROOT/apps/workbench"
  run_step "前端单测" npm test
  run_step "TypeScript 类型检查" npx tsc --noEmit
fi

# Go 那半单独成段：go test ./... 要编译 Wails 依赖与整棵服务代码，慢得多。
if [ "$SCOPE" != web ]; then
  cd "$ROOT/apps/workbench-go"
  # 分片只守后端本身；前端与守卫仍走 web 分片，CI 两 job 并行。
  run_step "Go 静态检查" go vet ./...
  run_step "Go 单测" go test ./...
  # 回环判定要与 TypeScript 逐条对拍：这一条要 Go + 前端 node_modules 两套都在。
  # 它在 go 分片里，因为主要成本是编译 Go；CI 的 go-checks job 先跑过 npm ci。
  cd "$ROOT"
  run_step "回环判定两端对照" node tools/check_loopback_parity.mjs
fi

  if [ "$SCOPE" != go ]; then
    # 守卫与冒烟不需要编译 Go：go 分片不跑它们。
  # 脚本里的 bash 陷阱（$VAR 紧跟全角标点会被并进变量名）只在 UTF-8 locale 下复现，
  # 本仓库的脚本里中文很多，顺手在本地门禁里挡一道。
  cd "$ROOT"
  ./tools/lint_shell_vars.sh

  # MCP 是外部 agent 读写这个库的入口，坏掉不会有界面报错——纳入门禁。
  run_step "MCP smoke" node tools/mcp_smoke.mjs
  # 独立临时库的正常实现也必须通过，不能只运行预期失败的退化版本。
  run_step "MCP 独立临时库 smoke" node tools/mcp_server_smoke.mjs

  # 项目授权、撤销与事务审计的反例测试（实际入口接入前也持续验证底层策略）。
  run_step "MCP 项目授权反例" node --test tools/mcp_access_test.mjs
  run_step "MCP 范围化服务端" node --test tools/mcp_scoped_server_test.mjs
  # 旧卡片 MCP 也要遵守同一授权，保留其检索与人工暂存回归。
  run_step "旧卡片 MCP" node --test tools/knowflick-mcp/test.mjs

  # MCP 安装接入（T10，审计 KF-013）：安装用户复制配置就能用——
  # 绝对路径 + --dir 库目录、任意 cwd、默认只读、显式授权写成功、
  # 模块停用后独立进程被阻断。这套不需要浏览器，CI 上也能跑。
  run_step "MCP 安装接入" node tools/mcp_install_smoke.mjs

  # MCP 素材检索的断言**真的**能抓住缺陷吗？
  # 断言「绿」不等于「在守东西」——把实现改回缺陷状态，它可能照样绿。
  # 这一步把实现逐个改坏，确认对应断言会报红。
  run_step "MCP 素材检索反例" node tools/mcp_material_search_reverse_test.mjs

  # 品味与可用性门禁：验「看起来对不对、用起来顺不顺」——对比度、点击目标、
  # 焦点可见性、侧栏层级与裁切、重复 CTA。这些是用户能感知、而功能测试查不出的。
  # 此前它只在本地跑，界面退化不会被 CI 拦住。
  # 缺 agent-browser 时脚本自己 SKIP（CI 环境没有那个工具）——守卫用 promisify 过的 exec，
  # 原始 execFile 回调版不抛错，守卫会永远返回 true。
  node tools/taste_usability_gate.mjs

  # 来源矩阵：每种来源都要能进收件箱、被搜到、转成卡并回溯。
  # 此前每类来源各有一套冒烟，但没有一套覆盖全部来源——这条线是拼起来的，不是验过的。
  node tools/source_matrix_smoke.mjs


  # 文档一致性：描述「当前状态」的文档里的数字与命令要和实际相符。
  # 输出走 UTF-8 字节：Windows 控制台默认 cp1252，直接 print 中文会 UnicodeEncodeError。
  # 这轮手工核对时发现 README / UI_CONSOLIDATION 写的门禁内容已经差了好几轮——
  # 靠人查迟早会再犯，交给脚本。
  python3 -m unittest discover -s tools -p test_check_doc_consistency.py
  python3 -m unittest discover -s tools -p test_workflow_paths.py
  python3 -m unittest discover -s tools -p test_desktop_ci_triggers.py
  python3 -m unittest discover -s tools -p test_check_frontend_error_text.py
  python3 -m unittest discover -s tools -p test_check_user_facing_content.py
  python3 -m unittest discover -s tools -p test_check_destructive_confirm.py
  python3 -m unittest discover -s tools -p test_check_test_assertions.py
  python3 -m unittest discover -s tools -p test_check_responsibility.py
  python3 -m unittest discover -s tools -p test_check_design_tokens.py
  python3 -m unittest discover -s tools -p test_check_source_labels.py
  python3 -m unittest discover -s tools -p test_windows_console.py
  python3 tools/check_doc_consistency.py
  # 前端把错误原样交给用户的地方也要有中文兜底。
  python3 tools/check_frontend_error_text.py
  # 会**落进用户数据**的文案也要中文（收件箱里直接显示的那些）。
  python3 tools/check_user_facing_content.py
  # 面向用户的错误消息整句英文是同一类问题；扫的是 Go 后端（Rust 壳已随 ADR-0042 删除）。
  python3 tools/check_go_error_messages.py
  # 不可撤销的删除都要有二次确认——「一点即删」用户救不回来。
  python3 tools/check_destructive_confirm.py
  # 这个守卫真的抓得住缺确认的写法吗？把实现改坏，确认守卫会报红。
  python3 tools/destructive_confirm_reverse_test.py
  # 测试里的 expect(...) 都得带 matcher——空断言什么都不检查，测试却照样绿。
  python3 tools/check_test_assertions.py
  # 会被写进库的来源类型都要有中文标签——没登记的类型会显示英文内部名。
  python3 tools/check_source_labels.py
  # 职责边界（T11）：恢复/备份/保存的规则各只能有一处入口，纯规则模块不依赖宿主。
  python3 tools/check_responsibility.py
  # 设计令牌（UI_DESIGN_SPEC_2026-10-19 §2–§4）：圆角只用 4/8px、颜色令牌都得定义、
  # 文字色不用裸 accent、纯文本里不留 Markdown 标记。
  python3 tools/check_design_tokens.py

  # 全部浏览器冒烟：18 套界面级回归。
  # 它们要真实浏览器与运行中的 Vite，CI 环境两者都没有（脚本会 SKIP）；
  # 但在本机，门禁应当把它们一起跑完——否则界面退化只在「谁记得手动跑」时才被发现。
  if [ "$SCOPE" = all ]; then ./tools/run_all_smokes.sh; fi
fi
