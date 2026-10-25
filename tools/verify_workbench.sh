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

# 同一批 Rust 用例，**在代理环境变量下**再跑一遍。
#
# 为什么：用户系统里配了 HTTP_PROXY 时，本地模型的请求会被交给代理而不是
# 本机服务（这是真实缺陷，见 docs/SMOOTHNESS.md）。CI 环境干净，跑一次
# 常规 cargo test 抓不到它——所以这里显式造一个代理环境。
# 清空 NO_PROXY 是关键：它本来可能含回环地址，那样问题就被掩盖了。
env -u NO_PROXY -u no_proxy \
  HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
  cargo test --locked --lib http::tests

# 脚本里的 bash 陷阱（$VAR 紧跟全角标点会被并进变量名）只在 UTF-8 locale 下复现，
# 本仓库的脚本里中文很多，顺手在本地门禁里挡一道。
cd "$ROOT"
./tools/lint_shell_vars.sh

# MCP 是外部 agent 读写这个库的入口，坏掉不会有界面报错——纳入门禁。
node tools/mcp_smoke.mjs
# 独立临时库的正常实现也必须通过，不能只运行预期失败的退化版本。
node tools/mcp_server_smoke.mjs

# MCP 安装接入（T10，审计 KF-013）：安装用户复制配置就能用——
# 绝对路径 + --dir 库目录、任意 cwd、默认只读、显式授权写成功、
# 模块停用后独立进程被阻断。这套不需要浏览器，CI 上也能跑。
node tools/mcp_install_smoke.mjs

# MCP 素材检索的断言**真的**能抓住缺陷吗？
# 断言「绿」不等于「在守东西」——把实现改回缺陷状态，它可能照样绿。
# 这一步把实现逐个改坏，确认对应断言会报红。
node tools/mcp_material_search_reverse_test.mjs

# 品味与可用性门禁：验「看起来对不对、用起来顺不顺」——对比度、点击目标、
# 焦点可见性、侧栏层级与裁切、重复 CTA。这些是用户能感知、而功能测试查不出的。
# 此前它只在本地跑，界面退化不会被 CI 拦住。
# 缺 agent-browser 时脚本自己 SKIP（CI 环境没有那个工具）——守卫用 promisify 过的 exec，
# 原始 execFile 回调版不抛错，守卫会永远返回 true。
node tools/taste_usability_gate.mjs

# 来源矩阵：每种来源都要能进收件箱、被搜到、转成卡并回溯。
# 此前每类来源各有一套冒烟，但没有一套覆盖全部来源——这条线是拼起来的，不是验过的。
node tools/source_matrix_smoke.mjs

# 跨端回环判定对照：Rust 桌面壳与 TypeScript 前端必须给出同一答案。
# 回环判定散落三处、各写一套字符串比较，迟早漂；ADR-0002 §3 要求同一份
# settings.json 在两端行为相同。安卓那侧由它的镜像用例保证。
node tools/check_loopback_parity.mjs

# 文档一致性：描述「当前状态」的文档里的数字与命令要和实际相符。
# （Rust 那项只提示不报错——三端测试数量因 #[cfg(target_os)] 平台门而不同。）
# 输出走 UTF-8 字节：Windows 控制台默认 cp1252，直接 print 中文会 UnicodeEncodeError。
# 这轮手工核对时发现 README / UI_CONSOLIDATION 写的门禁内容已经差了好几轮——
# 靠人查迟早会再犯，交给脚本。
python3 -m unittest discover -s tools -p test_check_doc_consistency.py
python3 -m unittest discover -s tools -p test_workflow_paths.py
python3 -m unittest discover -s tools -p test_desktop_ci_triggers.py
python3 -m unittest discover -s tools -p test_check_tauri_permissions.py
python3 -m unittest discover -s tools -p test_check_rust_error_messages.py
python3 -m unittest discover -s tools -p test_check_frontend_error_text.py
python3 -m unittest discover -s tools -p test_check_user_facing_content.py
python3 -m unittest discover -s tools -p test_check_destructive_confirm.py
python3 -m unittest discover -s tools -p test_check_test_assertions.py
python3 -m unittest discover -s tools -p test_check_responsibility.py
python3 -m unittest discover -s tools -p test_check_source_labels.py
python3 -m unittest discover -s tools -p test_windows_console.py
python3 tools/check_doc_consistency.py
# Tauri 命令 / build.rs 声明 / capability 授权必须三处一致。
# 少一处 → 前端调用被 ACL 拒绝（界面上冒英文的「not allowed by ACL」）。
# 浏览器冒烟测不到这个：浏览器模式根本不走 Tauri。
python3 tools/check_tauri_permissions.py
# 面向用户的错误消息必须是中文——英文的界面等于让用户卡住。
python3 tools/check_rust_error_messages.py
# 前端把错误原样交给用户的地方也要有中文兜底。
python3 tools/check_frontend_error_text.py
# 会**落进用户数据**的文案也要中文（收件箱里直接显示的那些）。
python3 tools/check_user_facing_content.py
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

# 全部浏览器冒烟：13 套界面级回归。
# 它们要真实浏览器与运行中的 Vite，CI 环境两者都没有（脚本会 SKIP）；
# 但在本机，门禁应当把它们一起跑完——否则界面退化只在「谁记得手动跑」时才被发现。
./tools/run_all_smokes.sh
