#!/usr/bin/env python3
"""回归：会落进用户数据的英文字面量不能漏网。

邮件模块里无主题的邮件以前落成 `"(No subject)"`、无正文落成
`"(No readable text body)"`——这两条**直接显示在收件箱里**
（`Workspace.tsx` 渲染 `e.title`），不是只在出错时出现。

守卫：`tools/check_user_facing_content.py`。

这守卫本身也踩过一个坑，值得记着：词数阈值用 `[A-Za-z]{3,}` 时，
`"(No subject)"` 只算 **1** 个词 → 被当成「短标识符」放过去——
**守卫抓不到自己该抓的东西**。改成 ≥2 个字母才算一个词。
"""
from __future__ import annotations

import io
import contextlib
import unittest
from pathlib import Path

import check_user_facing_content as checker


class UserFacingContentTest(unittest.TestCase):
    def test_repository_has_no_english_user_data(self):
        problems = self._problems()
        self.assertEqual(
            problems, [], "有会落进用户数据的英文字面量：\n" + "\n".join(problems)
        )

    def test_word_count_counts_short_words(self):
        """`(No subject)` 里有 **2** 个词——`No` 虽然只有两个字母，也是词。"""
        self.assertEqual(checker.english_word_count("(No subject)"), 2)
        self.assertEqual(checker.english_word_count("INBOX"), 1)

    def test_known_placeholders_are_translated(self):
        text = (checker.SRC / "mail.rs").read_text(encoding="utf-8")
        for english in ("(No subject)", "(No readable text body)"):
            self.assertNotIn(english, text, f"「{english}」还没翻译")

    def test_guard_detects_an_english_title(self):
        """把标题改回英文，守卫必须报出来。"""
        path = checker.SRC / "mail.rs"
        backup = path.read_text(encoding="utf-8")
        try:
            path.write_text(
                backup.replace("（无主题）", "(No subject)", 1), encoding="utf-8"
            )
            problems = self._problems()
            self.assertTrue(
                any("No subject" in p for p in problems),
                f"守卫没报出英文标题：{problems}",
            )
        finally:
            path.write_text(backup, encoding="utf-8")

    def test_guard_ignores_test_fixtures(self):
        """测试夹具里的英文不算——那不是用户看到的内容。"""
        text = (checker.SRC / "db.rs").read_text(encoding="utf-8")
        self.assertIn("Database Internals", text, "夹具还在（说明跳过逻辑有效）")
        self.assertEqual(self._problems(), [])

    def _problems(self) -> list[str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            checker.main()
        text = buf.getvalue()
        if "英文字面量" in text:
            return [line.strip() for line in text.splitlines() if line.strip().startswith("-")]
        return []


if __name__ == "__main__":
    unittest.main()
