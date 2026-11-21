#!/usr/bin/env python3
"""职责边界守卫的反向验证：把实现改坏，确认守卫会报红。

守卫「绿」不等于「在守东西」——把它依赖的每个不变量都破坏一次，
对应断言必须报出。样本写在临时目录里，不修改工作树。
"""
from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_responsibility as checker


class ResponsibilityGuardTest(unittest.TestCase):
    def run_guard(self, workspace_src: str, notes_view_src: str, collect_src: str, restore_rules_src: str,
                  domain_extra: dict[str, str] | None = None) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            domain = root / "apps/workbench/src/domain"
            ui = root / "apps/workbench/src/ui/workspace"
            domain.mkdir(parents=True)
            ui.mkdir(parents=True)
            (ui / "Workspace.tsx").write_text(workspace_src, encoding="utf-8")
            (ui / "NotesView.tsx").write_text(notes_view_src, encoding="utf-8")
            (ui / "backupCollect.ts").write_text(collect_src, encoding="utf-8")
            (domain / "restoreRules.ts").write_text(restore_rules_src, encoding="utf-8")
            for name, content in (domain_extra or {}).items():
                (domain / name).write_text(content, encoding="utf-8")
            output = io.StringIO()
            with patch.multiple(
                checker,
                ROOT=root,
                SRC=root / "apps/workbench/src",
                DOMAIN=domain,
                UI=ui,
                WORKSPACE=ui / "Workspace.tsx",
                NOTES_VIEW=ui / "NotesView.tsx",
                COLLECT=ui / "backupCollect.ts",
                BACKUP_RESTORE=ui / "backupRestore.ts",
            ):
                with contextlib.redirect_stdout(output):
                    code = checker.main()
            return code, output.getvalue()

    GOOD_WORKSPACE = (
        'import { collectBackupSnapshot } from "./backupCollect";\n'
        'const x = collectBackupSnapshot();\n'
        'setError("备份恢复失败：x（尚未写入任何内容）");\n'
    )
    GOOD_NOTES = 'const s = new NoteSession(note, io);\n'
    GOOD_COLLECT = 'export function backupReceipt() { return "x"; }\n'
    GOOD_RULES = (
        "export function restorableMaterials() { return []; }\n"
        "export function restorableCards() { return []; }\n"
        "export function restorableArtifacts() { return []; }\n"
    )

    def test_clean_code_passes(self):
        code, out = self.run_guard(self.GOOD_WORKSPACE, self.GOOD_NOTES, self.GOOD_COLLECT, self.GOOD_RULES)
        self.assertEqual(code, 0, out)

    def test_duplicate_restore_rule_in_view_is_caught(self):
        src = self.GOOD_WORKSPACE + '\nconst x = restorableMaterials(items);\n'
        code, out = self.run_guard(src, self.GOOD_NOTES, self.GOOD_COLLECT, self.GOOD_RULES)
        self.assertEqual(code, 1)
        self.assertIn("restorableMaterials", out)

    def test_duplicate_export_receipt_in_workspace_is_caught(self):
        src = self.GOOD_WORKSPACE + '\nsetNotice("已导出完整备份包 (.kfbackup)");\n'
        code, out = self.run_guard(src, self.GOOD_NOTES, self.GOOD_COLLECT, self.GOOD_RULES)
        self.assertEqual(code, 1)
        self.assertIn("导出回执字面量", out)

    def test_unconditional_unaffected_claim_is_caught(self):
        src = self.GOOD_WORKSPACE + '\nsetError("备份恢复失败，本地内容未受影响");\n'
        code, out = self.run_guard(src, self.GOOD_NOTES, self.GOOD_COLLECT, self.GOOD_RULES)
        self.assertEqual(code, 1)
        self.assertIn("本地内容未受影响", out)

    def test_view_owning_revision_baseline_is_caught(self):
        code, out = self.run_guard(self.GOOD_WORKSPACE, "const savedRevision = useRef(0);\n", self.GOOD_COLLECT, self.GOOD_RULES)
        self.assertEqual(code, 1)
        self.assertIn("savedRevision", out)

    def test_rule_module_depending_on_host_is_caught(self):
        code, out = self.run_guard(
            self.GOOD_WORKSPACE,
            self.GOOD_NOTES,
            self.GOOD_COLLECT,
            self.GOOD_RULES,
            {"reviewFacts.ts": 'import type { RawMaterial } from "../shell/store";\n'},
        )
        self.assertEqual(code, 1)
        self.assertIn("shell/store", out)


if __name__ == "__main__":
    unittest.main()
