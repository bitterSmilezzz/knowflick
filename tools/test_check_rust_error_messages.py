#!/usr/bin/env python3
"""回归：面向用户的错误消息必须是中文。

邮件模块里 24 条校验错误是英文的（"Invalid account email"），
前端的 `errorText()` 只做密钥脱敏、**不翻译**——于是英文原样显示给用户。

守卫：`tools/check_rust_error_messages.py`。
"""
from __future__ import annotations

import io
import contextlib
import unittest
from pathlib import Path

import check_rust_error_messages as checker


class RustErrorMessageTest(unittest.TestCase):
    def test_repository_has_no_english_error_messages(self):
        problems = self._problems()
        self.assertEqual(
            problems, [], "面向用户的错误消息里混着英文：\n" + "\n".join(problems)
        )

    def test_mail_module_is_clean(self):
        """邮件模块是重灾区——24 条错误以前全是英文。"""
        text = (checker.SRC / "mail.rs").read_text(encoding="utf-8")
        import re

        offenders = [
            m
            for m in re.findall(r'\bErr\(\s*"([^"]*)"', text)
            if m.strip() and not checker.has_chinese(m)
        ]
        self.assertEqual(offenders, [], f"邮件模块里还有英文错误：{offenders}")

    def test_known_messages_are_translated(self):
        """具体那几条：不能只是「恰好有中文」，得真的改过。"""
        text = (checker.SRC / "mail.rs").read_text(encoding="utf-8")
        for english in (
            "Invalid account email",
            "Enter the password again when changing server or username",
            "Mail server rejected the request",
            "Unsupported media type",
        ):
            self.assertNotIn(english, text, f"「{english}」还没翻译")

    def test_check_detects_an_english_message(self):
        """塞一条英文进去，守卫必须报出来。"""
        path = checker.SRC / "mail.rs"
        backup = path.read_text(encoding="utf-8")
        try:
            path.write_text(
                backup.replace(
                    '"邮箱地址格式不对，请检查是否写全了"',
                    '"Invalid account email"',
                    1,
                ),
                encoding="utf-8",
            )
            problems = self._problems()
            self.assertTrue(
                any("Invalid account email" in p for p in problems),
                f"守卫没报出英文错误消息：{problems}",
            )
        finally:
            path.write_text(backup, encoding="utf-8")

    def _problems(self) -> list[str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            checker.main()
        text = buf.getvalue()
        if "混着英文" in text:
            return [line.strip() for line in text.splitlines() if line.strip().startswith("-")]
        return []


if __name__ == "__main__":
    unittest.main()
