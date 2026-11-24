#!/usr/bin/env python3
"""设计令牌守卫的反向验证：把实现改坏，确认守卫会报红。

守卫「绿」不等于「在守东西」。这里对每条不变量各破坏一次，
对应断言必须报出。样本写在临时目录里，不修改工作树。
"""
from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_design_tokens as checker


class DesignTokenGuardTest(unittest.TestCase):
    def run_guard(self, css: str = "", tsx: str = "", tokens: str = "") -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui = root / "apps/workbench/src/ui/workspace"
            ui.mkdir(parents=True)
            (ui / "workspace.css").write_text(css, encoding="utf-8")
            (ui / "Sample.tsx").write_text(tsx, encoding="utf-8")
            (ui / "tokens.css").write_text(
                tokens
                or ":root {\n  --ink: #1c1e20;\n  --surface: #fff;\n  --accent: #0075ff;\n  --accent-text: #005fcc;\n}\n",
                encoding="utf-8",
            )
            output = io.StringIO()
            with patch.multiple(
                checker,
                ROOT=root,
                WORKBENCH=ui,
                TOKENS=ui / "tokens.css",
            ):
                with contextlib.redirect_stdout(output):
                    code = checker.main()
            return code, output.getvalue()

    def test_clean_code_passes(self):
        code, out = self.run_guard(
            css=".ws-a {\n  border-radius: 4px;\n  color: var(--accent-text);\n  background: var(--surface);\n}\n",
            tsx="export function X() {\n  return <p className=\"ws-hint\">普通文案</p>;\n}\n",
        )
        self.assertEqual(code, 0, out)

    def test_non_conforming_radius_is_caught(self):
        code, out = self.run_guard(css=".ws-a {\n  border-radius: 6px;\n}\n")
        self.assertEqual(code, 1)
        self.assertIn("圆角 6px", out)

    def test_radius_in_split_rule_block_is_caught(self):
        # 属性与选择器分行时也要抓得到（守卫要跟踪规则块）
        code, out = self.run_guard(css=".ws-a {\n  color: red;\n  border-radius: 12px;\n}\n")
        self.assertEqual(code, 1)
        self.assertIn("圆角 12px", out)

    def test_undefined_token_is_caught(self):
        code, out = self.run_guard(css=".ws-a {\n  background: var(--paper);\n}\n")
        self.assertEqual(code, 1)
        self.assertIn("--paper", out)

    def test_bare_accent_as_text_color_is_caught(self):
        code, out = self.run_guard(css=".ws-a {\n  color: var(--accent);\n}\n")
        self.assertEqual(code, 1)
        self.assertIn("--accent", out)

    def test_accent_color_property_is_not_a_text_color(self):
        # accent-color: var(--accent) 是原生控件着色，不是文字色——不能误报
        code, out = self.run_guard(css=".ws-a input {\n  accent-color: var(--accent);\n}\n")
        self.assertEqual(code, 0, out)

    def test_markdown_marker_in_plain_text_is_caught(self):
        code, out = self.run_guard(
            tsx='export function X() {\n  return <p className="ws-hint">这是**单向备份**</p>;\n}\n'
        )
        self.assertEqual(code, 1)
        self.assertIn("Markdown", out)

    def test_hardcoded_error_color_is_caught(self):
        code, out = self.run_guard(css=".ws-a {\n  color: #b3261e;\n}\n")
        self.assertEqual(code, 1)
        self.assertIn("--danger", out)

    def test_font_size_below_minimum_is_caught(self):
        code, out = self.run_guard(css=".ws-a {\n  font-size: 10px;\n}\n")
        self.assertEqual(code, 1)
        self.assertIn("12px", out)

    def test_native_pill_shapes_are_allowed(self):
        code, out = self.run_guard(
            css=".ws-switch-slider {\n  border-radius: 22px;\n}\n"
            ".x::-webkit-scrollbar-thumb {\n  border-radius: 22px;\n}\n"
        )
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    unittest.main()
