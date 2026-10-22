#!/usr/bin/env bash
# ADR-0002 第一套桌面：与 .github/workflows/workbench.yml 同口径的本地门禁。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/workbench"
npm test
npx tsc --noEmit
cd src-tauri
# --locked：默认行为在 Cargo.lock 过期时会静默改写它再继续，CI 上完全看不出来；
# 加上之后 lock 与 Cargo.toml 一漂移就红。
cargo test --locked

# 脚本里的 bash 陷阱（$VAR 紧跟全角标点会被并进变量名）只在 UTF-8 locale 下复现，
# 本仓库的脚本里中文很多，顺手在本地门禁里挡一道。
cd "$ROOT"
./tools/lint_shell_vars.sh

# MCP 是外部 agent 读写这个库的入口，坏掉不会有界面报错——纳入门禁。
node tools/mcp_smoke.mjs

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
# （Rust 那项只提示不报错——三端测试数量因 #[cfg(target_os)] 平台门而不同。）
# 这轮手工核对时发现 README / UI_CONSOLIDATION 写的门禁内容已经差了好几轮——
# 靠人查迟早会再犯，交给脚本。
python3 tools/check_doc_consistency.py

# 全部浏览器冒烟：13 套界面级回归。
# 它们要真实浏览器与运行中的 Vite，CI 环境两者都没有（脚本会 SKIP）；
# 但在本机，门禁应当把它们一起跑完——否则界面退化只在「谁记得手动跑」时才被发现。
./tools/run_all_smokes.sh
