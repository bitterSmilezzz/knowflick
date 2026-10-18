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
