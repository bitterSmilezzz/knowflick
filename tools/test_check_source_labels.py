#!/usr/bin/env python3
"""回归：来源标签守卫要真的抓得住「没登记的来源类型」。

素材的 `source_type` 决定界面上的来源标签。`META` 里没有的类型会
**原样显示英文内部名**——用户看到「note」这种词。

守卫：`tools/check_source_labels.py`。
"""
from __future__ import annotations

import unittest

import check_source_labels as checker


class SourceLabelGuardTest(unittest.TestCase):
    def test_repository_has_no_english_source_labels(self):
        problems = self._problems()
        self.assertEqual(problems, [], "有来源类型会显示英文：\n" + "\n".join(problems))

    def test_guard_reports_an_unregistered_source_type(self):
        """造一个没登记的类型，守卫必须报出来。"""
        path = checker.SRC / "domain" / "mcpServer.ts"
        backup = path.read_text(encoding="utf-8")
        try:
            path.write_text(
                backup.replace(
                    'sourceType: sourceUrl ? "web" : "manual",',
                    'sourceType: sourceUrl ? "web" : "brandnewkind",',
                    1,
                ),
                encoding="utf-8",
            )
            problems = self._problems()
            self.assertTrue(
                any("brandnewkind" in p for p in problems),
                f"守卫没报出未登记的来源类型：{problems}",
            )
        finally:
            path.write_text(backup, encoding="utf-8")

    def test_guard_ignores_comparisons(self):
        """`m.sourceType==='email'` 是**比较**，不是写入——不该被当成来源类型。

        踩过的坑：正则太松，把 `m.inboxStatus==='processed'` 一并吞进来，
        于是守卫误报了一个根本不存在的来源类型。
        """
        found = checker.written_source_types()
        self.assertNotIn("processed", found, "比较表达式不该被当成来源类型")
        # "email" 确实会被写入（邮件路径），所以它在列表里是对的。
        self.assertIn("email", found)

    def test_known_source_types_are_all_registered(self):
        labels = checker.registered_labels()
        for kind in ("manual", "email", "email-digest", "web", "document", "audio", "image", "ink"):
            self.assertIn(kind, labels, f"来源类型「{kind}」没登记标签")

    def _problems(self) -> list[str]:
        import contextlib
        import io

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            checker.main()
        text = buf.getvalue()
        if "会显示英文" in text:
            return [line.strip() for line in text.splitlines() if line.strip().startswith("-")]
        return []


if __name__ == "__main__":
    unittest.main()
