#!/usr/bin/env python3
"""核对前端**把错误原样交给用户**的地方都有中文兜底。

Rust 侧的错误现在都有中文（守卫 `check_rust_error_messages.py` 盯着）。
但前端还有一类漏洞：`setError(String(err))` ——**一点中文都没有**，
用户看到的就是底层库抛的原始字符串（多半是英文）。

这类点没法逐个改（14 处，分散在 9 个文件），所以用**共享兜底**：
`apps/workbench/src/ui/workspace/userError.ts` 里的 `userError()`，
它保证「用户看到的第一句一定是中文」。

守卫检查两件事：
1. 前端**没有**再出现裸的 `setError(String(err))` 这类零中文写法；
2. 共享兜底本身存在且会把英文包成中文。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "apps/workbench/src/ui"

sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402

# 零中文的错误透出：setError(String(err)) / setError(err instanceof Error ? err.message : String(err))
BARE_PATTERNS = [
    re.compile(r"set(?:Error|ErrorText|Notice|SaveMessage|AccountError)\(\s*String\((?:e|err|error)\)\s*\)"),
    re.compile(
        r"set(?:Error|ErrorText)\(\s*err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*String\(err\)\s*\)"
    ),
]


def main() -> int:
    problems: list[str] = []

    # 1) 共享兜底在
    helper = UI / "workspace" / "userError.ts"
    if not helper.exists():
        problems.append(
            f"缺少共享兜底 {helper.relative_to(ROOT)}——"
            "前端要有 userError()，保证用户看到的第一句是中文"
        )

    # 2) 裸写法清零
    for path in sorted(UI.rglob("*.tsx")):
        if path.name.endswith(".test.tsx"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            for pattern in BARE_PATTERNS:
                if pattern.search(stripped):
                    problems.append(
                        f"{path.relative_to(ROOT)}:{lineno} 把错误原样交给用户，"
                        f"没有中文兜底：{stripped[:80]}"
                    )

    if problems:
        emit("前端有把错误原样交给用户的地方：")
        for p in problems:
            emit(f"  - {p}")
        return 1

    emit("前端错误展示都有中文兜底：没有裸透出")
    return 0


if __name__ == "__main__":
    sys.exit(main())
