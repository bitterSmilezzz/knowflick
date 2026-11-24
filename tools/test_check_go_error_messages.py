#!/usr/bin/env python3
"""回归：Go 后端面向用户的错误消息不能整句英文。

守卫：`tools/check_go_error_messages.py`（原 Rust 版是 `check_rust_error_messages.py`，
Rust 壳已随 ADR-0042 删除，同一判据迁到 Go）。
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import check_go_error_messages as checker


class GoErrorMessageTest(unittest.TestCase):
    def scan(self, name: str, source: str) -> list[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / name).write_text(source, encoding="utf-8")
            return checker.problems_in(root)

    def test_repository_has_no_english_messages(self):
        problems = checker.problems_in(checker.GO_ROOT)
        self.assertEqual(
            problems, [], "有面向用户的英文错误消息：\n" + "\n".join(problems)
        )

    def test_english_error_is_reported(self):
        problems = self.scan(
            "mail.go",
            'package workbench\n\nfunc f() error { return errors.New("Invalid account email") }\n',
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("Invalid account email", problems[0])

    def test_chinese_error_is_accepted(self):
        self.assertEqual(
            self.scan("mail.go", 'package workbench\n\nvar err = errors.New("邮箱地址无效")\n'),
            [],
        )

    def test_half_chinese_wrap_is_reported(self):
        problems = self.scan(
            "db.go",
            'package workbench\n\nvar err = fmt.Errorf("打开资料库失败：%w", io.EOF)\n',
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("errtext.Wrap", problems[0])

    def test_errtext_wrap_is_accepted(self):
        self.assertEqual(
            self.scan("db.go", 'package workbench\n\nvar err = errtext.Wrap("打开资料库失败", io.EOF)\n'),
            [],
        )

    def test_test_files_are_ignored(self):
        self.assertEqual(
            self.scan("mail_test.go", 'package workbench\n\nvar e = errors.New("Invalid account email")\n'),
            [],
        )


if __name__ == "__main__":
    unittest.main()
