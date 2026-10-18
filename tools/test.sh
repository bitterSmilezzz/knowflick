#!/bin/bash
# Swift 第二实现（apps/mac）已删除。共享端测试在 apps/android 里跑。
echo "apps/mac 已退役。共享端测试：" >&2
echo "  cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test" >&2
exit 1
