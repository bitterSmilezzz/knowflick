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
