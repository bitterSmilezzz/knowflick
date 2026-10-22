#!/bin/bash
# 测试入口指路牌。
#
# 历史上这里跑的是 Swift 第二实现（apps/mac）——它已随 ADR-0002 删除。
# 这个脚本保留下来是**指路**：不知道该跑什么的人，执行它会看到当前两套的
# 验证命令。它本身不跑任何测试，所以以 1 退出（别让人以为「跑通了」）。
#
# 两套的验证命令（详见 AGENTS.md「验证与交付」）：
#   第一套桌面（apps/workbench，Node + Rust）：主战场
#   共享端 / Android（只需 JDK 17）
echo "当前有两套需要分别验证，按你改的端选：" >&2
echo "" >&2
echo "  第一套桌面（apps/workbench —— Vite + React + Tauri）：" >&2
echo "    ./tools/verify_workbench.sh" >&2
echo "" >&2
echo "  共享端 / Android（apps/android —— 只需 JDK 17）：" >&2
echo "    cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test" >&2
echo "" >&2
echo "  契约一致性（改了 shared/ 或剪藏规则时）：" >&2
echo "    python3 tools/check_taxonomy.py && python3 tools/check_clip_parity.py" >&2
exit 1
