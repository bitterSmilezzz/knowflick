#!/usr/bin/env python3
"""核对测试里的 `expect(...)` 都**带 matcher**。

为什么要有这条：vitest 的 `expect(actual, message)` **后面不接 matcher 时什么也不断言**——
它只是构造一个对象，测试照样通过。

这在写断言时很容易发生：想写 `expect(x, "说明").toBe(y)`，
却只写了 `expect(x, "说明")`。测试**绿着**，但什么都没检查。

踩过的坑（2026-10-23）：来源类型标签那条断言就是这么写的，
于是「标签是英文 note」这个真实缺陷**绿着过了好几个月**。

判据：`expect(` 开头的调用，若在括号闭合后**没有** `.matcher`（`.toBe` / `.toEqual` /
`.toContain` / `.toMatch` / `.toThrow` / `.not` / `.resolves` 等），就是空断言。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/workbench/src"

sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402

# vitest / jest 的 matcher：链式调用，`.toBe` `.toEqual` `.toContain` `.toMatch`
# `.toThrow` `.not` `.resolves` `.rejects` `.toHaveLength` `.toBeTruthy` `.toBeGreaterThan`
# `.toBeLessThan` `.toStrictEqual` `.toBeDefined` `.toBeUndefined` `.toBeNull`
# `.toHaveBeenCalled` `.toHaveProperty` `.toMatchObject` `.toBeCloseTo` `.toBeInstanceOf`
MATCHER = re.compile(
    r"\.(toBe|toEqual|toStrictEqual|toContain|toContainEqual|toMatch|toMatchObject|toThrow|"
    r"toHaveLength|toHaveProperty|toHaveBeenCalled|toHaveBeenCalledTimes|toHaveBeenCalledWith|"
    r"toHaveBeenNthCalledWith|toHaveReturned|toHaveReturnedWith|toHaveLastReturnedWith|"
    r"toHaveNthReturnedWith|toHaveResolved|toHaveRejected|"
    r"toBeTruthy|toBeFalsy|toBeDefined|toBeUndefined|toBeNull|toBeNaN|"
    r"toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual|"
    r"toBeCloseTo|toBeInstanceOf|toSatisfy|toBeTypeOf|"
    r"not|resolves|rejects)\b"
)


def main() -> int:
    problems: list[str] = []
    for path in sorted(SRC.rglob("*.ts")) + sorted(SRC.rglob("*.tsx")):
        if not path.name.endswith((".test.ts", ".test.tsx")):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for lineno, line in enumerate(text.split("\n"), 1):
            stripped = line.strip()
            if "expect(" not in stripped:
                continue
            # 找到 expect( 的位置，看这一行后面有没有 matcher。
            # 多行的 expect(\n  actual,\n  message,\n) 单独处理。
            idx = stripped.index("expect(")
            depth = 0
            end = -1
            for i in range(idx + len("expect(") - 1, len(stripped)):
                if stripped[i] == "(":
                    depth += 1
                elif stripped[i] == ")":
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            if end < 0:
                # 括号没在本行闭合——多行写法，交给下面的块级检查。
                continue
            rest = stripped[end + 1:].strip()
            if rest and not MATCHER.search(rest):
                problems.append(
                    f"{path.relative_to(ROOT)}:{lineno} 的 expect(...) 后面没有 matcher——"
                    f"这条断言什么都不检查：{stripped[:80]}"
                )

    # 多行写法：expect(\n ... \n); 后面没有 .matcher
    for path in sorted(SRC.rglob("*.test.ts")) + sorted(SRC.rglob("*.test.tsx")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for match in re.finditer(r"expect\(\s*\n(?:[^)]*?\n)*?\s*\);", text):
            lineno = text[: match.start()].count("\n") + 1
            after = text[match.end() : match.end() + 40].lstrip()
            if not after.startswith("."):
                problems.append(
                    f"{path.relative_to(ROOT)}:{lineno} 的 expect(...) 后面没有 matcher——"
                    "这条断言什么都不检查"
                )

    if problems:
        emit("有空断言（expect 后面没有 matcher，什么都不检查）：")
        for p in problems:
            emit(f"  - {p}")
        return 1

    emit("测试里的 expect 都带 matcher：没有空断言")
    return 0


if __name__ == "__main__":
    sys.exit(main())
