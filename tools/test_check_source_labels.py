#!/usr/bin/env python3
"""来源标签扫描的限定语法回归；样本写入临时目录，不修改工作树。"""
from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_source_labels as checker


class SourceLabelGuardTest(unittest.TestCase):
    def check_fixture(self, source: str, labels: str = 'manual: { label: "随手灵感" },') -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            src = root / 'apps/workbench/src'
            tools = root / 'tools'
            rust = root / 'apps/workbench/src-tauri/src'
            icon = src / 'ui/workspace/Icon.tsx'
            icon.parent.mkdir(parents=True)
            tools.mkdir(parents=True)
            rust.mkdir(parents=True)
            icon.write_text('const META = {\n' + labels + '\n};', encoding='utf-8')
            (src / 'writer.ts').write_text(source, encoding='utf-8')
            output = io.StringIO()
            with patch.multiple(checker, ROOT=root, SRC=src, TOOLS=tools, RUST=rust, ICON=icon):
                with contextlib.redirect_stdout(output):
                    result = checker.main()
            return result, output.getvalue()

    def test_repository_labels(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checker.main(), 0)

    def test_ternary_detects_new_type(self):
        code, text = self.check_fixture('const m = { sourceType: url ? "manual" : "newkind" };')
        self.assertEqual(code, 1)
        self.assertIn('newkind', text)

    def test_comparisons_do_not_add_types(self):
        code, text = self.check_fixture(
            'const m = { sourceType: "manual" };\n'
            'm.sourceType === "email" && m.inboxStatus === "processed";'
        )
        self.assertEqual(code, 0, text)

    def test_note_is_a_real_legacy_type(self):
        code, text = self.check_fixture('const m = { sourceType: "note" };')
        self.assertEqual(code, 1)
        self.assertIn('note', text)

    def test_registered_legacy_label_must_be_chinese(self):
        code, text = self.check_fixture(
            'const m = { sourceType: "manual" };',
            'manual: { label: "随手灵感" },\nnote: { label: "note" },',
        )
        self.assertEqual(code, 1)
        self.assertIn('note', text)

    def test_empty_scan_fails(self):
        code, text = self.check_fixture('const x = 1;')
        self.assertEqual(code, 1)
        self.assertIn('没有扫描到', text)


if __name__ == '__main__':
    unittest.main()
