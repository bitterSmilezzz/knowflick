#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v wails3 >/dev/null; then
  go_bin=$(go env GOBIN)
  export PATH="${go_bin:-$(go env GOPATH)/bin}:$PATH"
fi
if [[ "$(wails3 version 2>&1)" != 'v3.1.0' ]]; then
  echo '需要 Wails CLI v3.1.0（go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0）' >&2
  exit 1
fi
(
  cd "$root/apps/workbench-go"
  wails3 generate bindings -ts -i -b -names -noevents -d ../workbench/go-preview/bindings
)
(
  cd "$root/apps/workbench"
  ./node_modules/.bin/tsc --project go-preview/tsconfig.json
  ./node_modules/.bin/vite build --config go-preview/vite.config.mts
)
(
  cd "$root/apps/workbench-go"
  # 与 packaging/macos/Info.plist 的 LSMinimumSystemVersion 对齐：Wails 的依赖对象
  # 按 macOS 13 构建，链接目标写 11 会得到「built for newer macOS」警告且最低系统版本不实。
  export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.0}"
  # 只设 MACOSX_DEPLOYMENT_TARGET 不改变最终链接的 minos（实测仍是 11.0）；
  # cgo 的外部链接要显式 -mmacosx-version-min，才能让 LC_BUILD_VERSION 与 Info.plist 一致。
  export CGO_LDFLAGS="-mmacosx-version-min=13.0 ${CGO_LDFLAGS:-}"
  link_flags='-s -w'
  if [[ "$(go env GOOS)" == darwin ]]; then
    link_flags+=' -extldflags=-Wl,-sectcreate,__TEXT,__info_plist,Info.plist'
  fi
  go build -tags production -trimpath -ldflags="$link_flags" -o bin/knowflick-go-preview .
)
