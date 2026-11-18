#!/usr/bin/env bash
# Build a release-mode QA app with a compile-time data root inside .scratch.
# The normal release workflow does not enable qa-release-data-root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QA_ROOT="$ROOT/.scratch/r4-qa-restore"
QA_DATA_ROOT="$QA_ROOT/data"
QA_CONFIG="$QA_ROOT/tauri.qa.release.conf.json"

mkdir -p "$QA_ROOT"
cat > "$QA_CONFIG" <<'EOF'
{
  "productName": "KnowFlick QA Release",
  "identifier": "com.knowflick.qa.release"
}
EOF

cd "$ROOT/apps/workbench/src-tauri"
KNOWFLICK_QA_RELEASE_DATA_ROOT="$QA_DATA_ROOT" \
  cargo test --locked --features qa-release-data-root --lib store::tests::qa_release_data_root_is_fixed_path

cd "$ROOT/apps/workbench"
KNOWFLICK_QA_RELEASE_DATA_ROOT="$QA_DATA_ROOT" \
  npm run tauri -- build --features qa-release-data-root --bundles app --config "$QA_CONFIG"
