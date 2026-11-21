#!/usr/bin/env bash
# 让 CI 的 Gradle wrapper 走官方源，本地继续走国内镜像。
#
# 背景：gradle-wrapper.properties 里的 distributionUrl 是**硬编码**的，Gradle
# 不支持在那里读环境变量。仓库里其它依赖源（settings.gradle.kts）已经用
# `System.getenv("CI") == null` 做了「CI 用官方、本地用镜像」的分流，
# 但 wrapper 下载**漏了这一步**——CI runner 在美国，却要去撞国内镜像。
#
# 代价是真实发生过的：2026-10-23 一次 Desktop workflow 失败在
# 「Verification of Gradle distribution failed」——镜像返回的字节与官方
# 校验和不符（wrapper 的校验和机制正确地拒绝了坏包，但 CI 就挂了）。
#
# 这里在 CI 里把 distributionUrl 改写成官方地址。**校验和保持不变**，
# 所以完整性照样由 wrapper 自己保证：官方源被篡改一样会失败。
set -euo pipefail

WRAPPER_PROPS="${1:-apps/android/gradle/wrapper/gradle-wrapper.properties}"
OFFICIAL="https\\\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip"

if [ ! -f "$WRAPPER_PROPS" ]; then
  echo "找不到 $WRAPPER_PROPS" >&2
  exit 1
fi

# 已经指向官方源就别动文件——避免无谓地弄脏工作树（缓存 key 依赖这个文件）。
# 判据只看 distributionUrl 那一行：注释里也提到了官方地址，按整份文件 grep 会误判。
if grep -q "^distributionUrl=.*services\.gradle\.org" "$WRAPPER_PROPS"; then
  echo "Gradle wrapper 已指向官方源，无需改动。"
  exit 0
fi

if grep -q "distributionUrl=" "$WRAPPER_PROPS"; then
  # 用 | 而非 / 作分隔符：URL 里有斜杠。
  sed -i.bak "s|distributionUrl=.*|distributionUrl=${OFFICIAL}|" "$WRAPPER_PROPS"
  rm -f "$WRAPPER_PROPS.bak"
  echo "已把 wrapper 切到官方源（校验和不变）。"
else
  echo "这份 wrapper properties 里没有 distributionUrl，格式可能变了，请人工确认。" >&2
  exit 1
fi
