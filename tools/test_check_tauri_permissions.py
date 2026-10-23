#!/usr/bin/env python3
"""回归：Tauri 命令 / build.rs 声明 / capability 授权必须三处一致。

我实际踩到的：13 个命令（整个邮箱功能 9 个 + 语音附件 2 个 + 产物删除 +
新加的 db_library_signature）在 `build.rs` 里没列 → tauri-build 不为它们生成
权限文件 → capability 里授权不了 → 前端调用被 ACL 拒绝，界面上冒
「! Command mail_list_accounts not allowed by ACL」。

**浏览器冒烟测不到**：浏览器模式根本不走 Tauri。所以这里静态核对。
"""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path

import check_tauri_permissions as checker


class TauriPermissionConsistencyTest(unittest.TestCase):
    """在**真实仓库**上核对：现在就该是一致的。"""

    def test_repository_is_consistent(self):
        problems = self._problems()
        self.assertEqual(problems, [], "Tauri 命令与权限对不上：\n" + "\n".join(problems))

    def test_every_registered_command_is_declared_in_build_rs(self):
        registered = checker.registered_commands()
        manifest = checker.manifest_commands()
        self.assertEqual(
            sorted(registered - manifest),
            [],
            "这些命令注册了但没写进 build.rs——不会生成权限文件，"
            "capability 里也就无法授权（运行时 ACL 拒绝）",
        )

    def test_every_frontend_call_is_permitted(self):
        called = checker.frontend_commands()
        permitted = checker.permitted_commands(checker.SRC_TAURI / "capabilities")
        missing = sorted(called - permitted)
        self.assertEqual(
            missing,
            [],
            "前端调用了但 capability 没授权——运行时会被 ACL 拒绝",
        )

    def test_mail_commands_are_all_authorized(self):
        """邮箱功能整体在 capability 里授权过——它之前整块漏了。"""
        permitted = checker.permitted_commands(checker.SRC_TAURI / "capabilities")
        for cmd in (
            "mail_list_accounts",
            "mail_save_account",
            "mail_test_account",
            "mail_remove_account",
            "mail_sync_account",
            "mail_sync_history",
            "mail_list_rejected",
            "mail_retry_rejected",
            "mail_sync_due_accounts",
        ):
            self.assertIn(cmd, permitted, f"{cmd} 没被授权——整个邮箱功能都会报 ACL 错误")

    def test_media_commands_are_authorized(self):
        """语音笔记的附件存取——之前也没授权，保存会失败。"""
        permitted = checker.permitted_commands(checker.SRC_TAURI / "capabilities")
        self.assertIn("read_media", permitted)
        self.assertIn("save_media", permitted)

    # --- 反向验证用的辅助 ---

    def _problems(self) -> list[str]:
        """复用脚本自己的判定逻辑（不重复实现一遍）。"""
        import io
        import contextlib

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            checker.main()
        text = buf.getvalue()
        if "对不上" in text:
            return [line.strip() for line in text.splitlines() if line.strip().startswith("-")]
        return []

    def test_check_detects_a_command_missing_from_build_rs(self):
        """把一条命令从 build.rs 里拿掉，守卫必须报出来。"""
        build_rs = checker.SRC_TAURI / "build.rs"
        backup = build_rs.read_text(encoding="utf-8")
        try:
            build_rs.write_text(
                backup.replace('            "mail_list_accounts",\n', "", 1), encoding="utf-8"
            )
            problems = self._problems()
            self.assertTrue(
                any("mail_list_accounts" in p for p in problems),
                f"守卫没报出 build.rs 里少了一条命令：{problems}",
            )
        finally:
            build_rs.write_text(backup, encoding="utf-8")

    def test_check_detects_a_missing_capability_permission(self):
        """从 capability 里拿掉一条授权，守卫必须报出来。"""
        cap = checker.SRC_TAURI / "capabilities" / "default.json"
        backup = cap.read_text(encoding="utf-8")
        try:
            data = json.loads(backup)
            data["permissions"] = [p for p in data["permissions"] if p != "allow-save-media"]
            cap.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            problems = self._problems()
            self.assertTrue(
                any("save_media" in p for p in problems),
                f"守卫没报出 capability 里少了一条授权：{problems}",
            )
        finally:
            cap.write_text(backup, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
