#!/usr/bin/env python3
"""Regression tests for the Tauri command check in the verification gate."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_doc_consistency as checker


class TauriCommandCheckTest(unittest.TestCase):
    def check_commands(self, registrations: str, callers: dict[str, str]) -> list[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lib = root / "apps/workbench/src-tauri/src/lib.rs"
            lib.parent.mkdir(parents=True)
            lib.write_text(
                ".invoke_handler(tauri::generate_handler![\n"
                + registrations
                + "\n])",
                encoding="utf-8",
            )
            for relative, content in callers.items():
                path = root / "apps/workbench/src" / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            problems: list[str] = []
            with patch.object(checker, "ROOT", root):
                checker.check_tauri_commands(problems)
            return problems

    def test_last_registration_without_trailing_comma_is_valid(self):
        problems = self.check_commands(
            "    load_store,\n    db_list_stale_embedding_card_ids",
            {"shell/store.ts": 'invoke("db_list_stale_embedding_card_ids");'},
        )
        self.assertEqual(problems, [])

    def test_registration_with_trailing_comma_is_valid(self):
        self.assertEqual(
            self.check_commands("    load_store,", {"shell/store.ts": 'invoke("load_store");'}),
            [],
        )

    def test_missing_command_in_ts_is_reported(self):
        problems = self.check_commands(
            "    load_store,", {"shell/store.ts": 'invoke("missing_command");'}
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("missing_command", problems[0])

    def test_missing_command_in_tsx_is_reported(self):
        problems = self.check_commands(
            "    load_store,", {"ui/Capsule.tsx": 'invoke("hide_capsule");'}
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("hide_capsule", problems[0])

    def test_component_generic_and_single_quoted_call_is_reported(self):
        problems = self.check_commands(
            "    load_store,",
            {"ui/Settings.tsx": "invoke<{ registered: boolean }>('get_shortcut_status');"},
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("get_shortcut_status", problems[0])

    def test_duplicate_registration_is_reported(self):
        problems = self.check_commands(
            "    load_store,\n    load_store,",
            {"shell/store.ts": 'invoke("load_store");'},
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("load_store", problems[0])

    def test_test_files_do_not_add_production_commands(self):
        problems = self.check_commands(
            "    load_store,",
            {
                "domain/probe.test.ts": 'invoke("fake_from_ts_test");',
                "ui/Probe.test.tsx": 'invoke("fake_from_tsx_test");',
            },
        )
        self.assertEqual(problems, [])


class CISmokeSuiteDiscoveryTest(unittest.TestCase):
    """CI 浏览器冒烟的套件名单必须**结构化**地读出来。

    踩过的坑：第一版用全文 grep 判断「某套件在不在 CI 的冒烟里」，
    于是「把它从执行列表删掉、只在注释里留个名字」也能通过检查——
    守卫报绿，而 CI 上那一套其实已经不跑了。
    """

    def suites_from(self, body: str) -> set[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "tools/ci_run_browser_smokes.sh"
            script.parent.mkdir(parents=True)
            script.write_text(body, encoding="utf-8")
            with patch.object(checker, "ROOT", root):
                return checker.ci_browser_smoke_suites()

    def test_reads_array_entries(self):
        suites = self.suites_from(
            "#!/usr/bin/env bash\nSUITES=(\n  alpha_smoke\n  beta_smoke\n)\n"
        )
        self.assertEqual(suites, {"alpha_smoke", "beta_smoke"})

    def test_ignored_comments_are_not_suites(self):
        suites = self.suites_from(
            "SUITES=(\n  # alpha_smoke 已移除\n  beta_smoke\n)\n"
        )
        self.assertEqual(suites, {"beta_smoke"})
        self.assertNotIn("alpha_smoke", suites)

    def test_suite_mentioned_only_in_a_comment_is_not_counted(self):
        suites = self.suites_from(
            "SUITES=(\n  beta_smoke\n)\n# alpha_smoke 以前跑过\n"
        )
        self.assertNotIn("alpha_smoke", suites)

    def test_missing_array_is_an_error_not_a_silent_pass(self):
        with self.assertRaises(ValueError):
            self.suites_from("#!/usr/bin/env bash\necho 没有数组\n")

    def test_unparsable_entry_is_an_error(self):
        with self.assertRaises(ValueError):
            self.suites_from('SUITES=(\n  "quoted_smoke"\n)\n')

    def test_missing_script_yields_no_suites(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(checker, "ROOT", Path(directory)):
                self.assertEqual(checker.ci_browser_smoke_suites(), set())


if __name__ == "__main__":
    unittest.main()
