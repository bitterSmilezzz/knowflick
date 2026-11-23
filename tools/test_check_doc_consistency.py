#!/usr/bin/env python3
"""Regression tests for the verification-gate checks.

（原先这里还有 Tauri 命令三处一致的回归；Rust 壳已随 ADR-0042 删除，
那套检查与它保护的 Tauri ACL 一起移除。）
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_doc_consistency as checker


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
            self.suites_from('SUITES=(\\n  "quoted_smoke"\\n)\\n')

    def test_missing_script_yields_no_suites(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(checker, "ROOT", Path(directory)):
                self.assertEqual(checker.ci_browser_smoke_suites(), set())


class EvidenceRegistrationTest(unittest.TestCase):
    """证据登记必须指向**可执行**的测试。

    踩过的坑：四条登记指向的是**实现文件**（`http.rs` / `db.rs` / `StatsView.tsx`），
    而守卫对实现文件只查「文件存在 + 标识在文件里」——那些标识**只出现在实现里、
    任何测试里都没有**，所以这条检查**永远不可能失败**，等于没守。

    现在那四条都指向真正断言该行为的测试/冒烟。这里锁住这个性质：
    凡是登记为「证据」的文件，标识必须**也出现在测试文件里**。
    """

    TEST_SUFFIXES = (".test.ts", ".test.tsx", ".kt", ".mjs", "_test.go")

    def test_registrations_point_at_executable_evidence(self):
        for label, rel, needle in checker.EVIDENCE_MAP:
            if not rel.endswith((".test.ts", ".test.tsx", ".kt", ".mjs", "_test.go")):
                continue
            path = checker.ROOT / rel
            self.assertTrue(path.exists(), f"「{label}」的证据文件没了：{rel}")
            text = path.read_text(encoding="utf-8", errors="ignore")
            self.assertIn(needle, text, f"「{label}」的标识在 {rel} 里找不到")

    def test_no_registration_points_at_a_bare_implementation_file(self):
        """实现文件当证据 = 守不住任何东西（标识不会出现在测试里）。"""
        offenders = []
        for label, rel, needle in checker.EVIDENCE_MAP:
            if rel.endswith(self.TEST_SUFFIXES):
                continue
            offenders.append((label, rel))
        self.assertEqual(
            offenders,
            [],
            "这些登记指向没有测试的实现文件："
            + "、".join(f"{label}→{rel}" for label, rel in offenders),
        )


if __name__ == "__main__":
    unittest.main()
