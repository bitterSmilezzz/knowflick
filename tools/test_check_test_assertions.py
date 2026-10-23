#!/usr/bin/env python3
"""回归：空断言守卫要真的抓得住空断言。

`expect(actual, message)` 后面不接 matcher 时，vitest **什么都不检查**，
测试照样绿。这条守卫就是防这个的。

这里把一处断言改回空断言形态，确认守卫报出来。
"""
from __future__ import annotations

import unittest
from pathlib import Path

import check_test_assertions as checker


class EmptyAssertionGuardTest(unittest.TestCase):
    def test_repository_has_no_empty_assertions(self):
        problems = self._problems()
        self.assertEqual(problems, [], "有空断言：\n" + "\n".join(problems))

    def test_guard_reports_an_expect_without_matcher(self):
        path = checker.SRC / "domain" / "mcpServer.test.ts"
        backup = path.read_text(encoding="utf-8")
        try:
            # `expect(x, "说明")` —— 没有 matcher，什么都不检查。
            path.write_text(
                backup.replace(
                    "expect(onAddCard).toHaveBeenCalledTimes(1);",
                    'expect(onAddCard, "回调没被调用");',
                    1,
                ),
                encoding="utf-8",
            )
            problems = self._problems()
            self.assertTrue(
                any("mcpServer.test.ts" in p for p in problems),
                f"守卫没报出空断言：{problems}",
            )
        finally:
            path.write_text(backup, encoding="utf-8")

    def test_guard_ignores_valid_matchers(self):
        path = checker.SRC / "domain" / "mcpServer.test.ts"
        backup = path.read_text(encoding="utf-8")
        try:
            path.write_text(
                backup.replace(
                    "expect(onAddCard).toHaveBeenCalledTimes(1);",
                    'expect(onAddCard, "说明").toHaveBeenCalledTimes(1);',
                    1,
                ),
                encoding="utf-8",
            )
            self.assertEqual(self._problems(), [], "带 matcher 的写法不该被报")
        finally:
            path.write_text(backup, encoding="utf-8")

    def _problems(self) -> list[str]:
        import contextlib
        import io

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            checker.main()
        text = buf.getvalue()
        if "空断言" in text:
            return [line.strip() for line in text.splitlines() if line.strip().startswith("-")]
        return []


if __name__ == "__main__":
    unittest.main()
