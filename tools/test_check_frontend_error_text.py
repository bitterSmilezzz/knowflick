#!/usr/bin/env python3
"""回归：前端把错误原样交给用户的地方，都要走中文兜底。

Rust 侧的错误都有中文了（`check_rust_error_messages.py` 盯着），
但前端有十几处 `setError(String(err))`——一点中文都没有。
这类点分散在 10 个文件，逐个改总会漏，所以用共享兜底 `userError()`
+ 一条守卫守住。
"""
from __future__ import annotations

import io
import contextlib
import unittest
from pathlib import Path

import check_frontend_error_text as checker


class FrontendErrorTextTest(unittest.TestCase):
    def test_repository_has_no_bare_error_passthrough(self):
        problems = self._problems()
        self.assertEqual(
            problems, [], "前端有把错误原样交给用户的地方：\n" + "\n".join(problems)
        )

    def test_shared_helper_exists(self):
        self.assertTrue(
            (checker.UI / "workspace" / "userError.ts").exists(),
            "共享兜底 userError() 应该在",
        )

    def test_check_detects_a_bare_passthrough(self):
        """塞一处裸写法，守卫必须报出来。"""
        path = checker.UI / "workspace" / "EntryInspector.tsx"
        backup = path.read_text(encoding="utf-8")
        try:
            path.write_text(
                backup.replace("setError(userError(e));", "setError(String(e));", 1),
                encoding="utf-8",
            )
            problems = self._problems()
            self.assertTrue(
                any("EntryInspector" in p for p in problems),
                f"守卫没报出裸透出：{problems}",
            )
        finally:
            path.write_text(backup, encoding="utf-8")

    def _problems(self) -> list[str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            checker.main()
        text = buf.getvalue()
        if "原样交给用户" in text:
            return [line.strip() for line in text.splitlines() if line.strip().startswith("-")]
        return []


if __name__ == "__main__":
    unittest.main()
