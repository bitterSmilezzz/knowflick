#!/usr/bin/env python3
"""共享的 workflow paths 解析器的回归。

为什么单独测：守卫（`check_doc_consistency.py`）与回归
（`test_desktop_ci_triggers.py`）都靠它判断「这个文件改了会不会触发 CI」。
解析一旦**漏认**一种合法写法，守卫就会在配置漂移时报绿——那比不检查更糟。

踩过的坑：
- 只认整行只有路径的写法 → `- 'path'  # 备注`（YAML 合法）被漏判；
- 整行注释与行尾注释要分别处理；
- 格式不认识时必须**报错**，不能当成「没有这条路径」。
"""
from __future__ import annotations

import unittest

from workflow_paths import matches, paths_for


class PathsForTest(unittest.TestCase):
    def test_reads_plain_entries(self):
        text = (
            "  push:\n    paths:\n      - 'a/**'\n      - 'b/c.txt'\n"
            "  pull_request:\n    paths:\n      - 'd/**'\n"
        )
        self.assertEqual(paths_for(text, "push"), ["a/**", "b/c.txt"])
        self.assertEqual(paths_for(text, "pull_request"), ["d/**"])

    def test_skips_whole_line_comments(self):
        text = (
            "  push:\n    paths:\n      # 这行是说明\n      - 'a/**'\n"
            "  pull_request:\n    paths:\n      - 'b/**'\n"
        )
        self.assertEqual(paths_for(text, "push"), ["a/**"])

    def test_tolerates_trailing_comment(self):
        # YAML 允许 `- 'path'  # 备注`，GitHub 也认。漏认这类会漏判漂移。
        text = (
            "  push:\n    paths:\n      - 'a/**'  # 说明\n"
            "  pull_request:\n    paths:\n      - 'b/**'  # 另一句\n"
        )
        self.assertEqual(paths_for(text, "push"), ["a/**"])
        self.assertEqual(paths_for(text, "pull_request"), ["b/**"])

    def test_missing_event_is_an_error(self):
        with self.assertRaises(ValueError):
            paths_for("  push:\n    paths:\n      - 'a/**'\n", "pull_request")

    def test_missing_paths_block_is_an_error(self):
        # 「没有 paths 过滤」与「paths 格式不认识」是两回事，不能混。
        with self.assertRaises(ValueError):
            paths_for("  push:\n    branches: [main]\n", "push")

    def test_unsupported_entry_is_an_error(self):
        with self.assertRaises(ValueError):
            paths_for("  push:\n    paths:\n      - [a, b]\n", "push")

    def test_double_quoted_entry_is_an_error(self):
        with self.assertRaises(ValueError):
            paths_for('  push:\n    paths:\n      - "a/**"\n', "push")


class MatchesTest(unittest.TestCase):
    def test_literal_path_matches_only_itself(self):
        self.assertTrue(matches("a/b.txt", "a/b.txt"))
        self.assertFalse(matches("a/c.txt", "a/b.txt"))

    def test_double_star_matches_directory_contents(self):
        self.assertTrue(matches("shared/assets/x", "shared/assets/**"))
        self.assertTrue(matches("shared/assets/deep/x", "shared/assets/**"))

    def test_double_star_does_not_match_sibling_prefix(self):
        self.assertFalse(matches("shared/assets-old/x", "shared/assets/**"))

    def test_unsupported_glob_is_an_error(self):
        with self.assertRaises(ValueError):
            matches("a/b", "a/*/c")
        with self.assertRaises(ValueError):
            matches("a/b", "a/!b")


if __name__ == "__main__":
    unittest.main()
