#!/usr/bin/env python3
"""回归：会打印中文的检查脚本在 Windows 控制台（cp1252）下不能崩。

我连着两次在 Windows CI 上踩这个：第一次是 `check_tauri_permissions.py`，
第二次是 `check_rust_error_messages.py`——每次都得单独修一遍。
根因是「每个脚本自己写一份 print 防护」，**新脚本总会忘**。

所以：抽出共享模块 `tools/windows_console.py`，并用这条测试守住——
**所有会打印中文的检查脚本，都必须在 cp1252 控制台下跑通**。
"""
from __future__ import annotations

import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"

# 这些脚本会打印中文（消息里带中文或输出含中文文案）
CANDIDATES = [
    "check_doc_consistency.py",
    "check_tauri_permissions.py",
    "check_rust_error_messages.py",
]

CP1252_HARNESS = '''
import sys, io, runpy
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="cp1252", errors="strict", line_buffering=True)
sys.argv = [SCRIPT]
runpy.run_path(SCRIPT, run_name="__main__")
'''


class WindowsConsoleTest(unittest.TestCase):
    def test_shared_emit_module_exists(self):
        self.assertTrue(
            (TOOLS / "windows_console.py").exists(),
            "共享的 windows_console.emit 应该在——每个脚本自己写一份，新脚本总会忘",
        )

    def test_checks_print_chinese_via_the_shared_helper(self):
        """检查脚本里出现中文时，要用共享的 emit，而不是裸 print。"""
        for name in CANDIDATES:
            path = TOOLS / name
            self.assertTrue(path.exists(), f"{name} 不存在")
            text = path.read_text(encoding="utf-8")
            self.assertIn(
                "from windows_console import emit",
                text,
                f"{name} 应该用共享的 emit（Windows 控制台是 cp1252）",
            )

    def test_each_check_runs_under_a_cp1252_console(self):
        for name in CANDIDATES:
            with self.subTest(script=name):
                # **不要用 text=True**：Windows 上子进程的输出是本地编码
                # （cp1252/GBK）的字节，Python 会用 cp1252 去解码它们——
                # 遇到中文就抛 UnicodeDecodeError，测试自己先崩了。
                # 用 bytes 收，自己按 UTF-8 解；解不动就退回 replace。
                result = subprocess.run(
                    [sys.executable, "-c", f"SCRIPT = {str(TOOLS / name)!r}\n" + CP1252_HARNESS],
                    capture_output=True,
                    cwd=str(ROOT),
                )
                stderr = result.stderr.decode("utf-8", errors="replace")
                self.assertNotIn(
                    "UnicodeEncodeError",
                    stderr,
                    f"{name} 在 cp1252 控制台下崩了：{stderr[:300]}",
                )

    def test_the_guard_itself_catches_a_english_message(self):
        """守卫本身要能报出英文消息——不然它就是个摆设。"""
        result = subprocess.run(
            [sys.executable, str(TOOLS / "check_rust_error_messages.py")],
            capture_output=True,
            cwd=str(ROOT),
        )
        stdout = result.stdout.decode("utf-8", errors="replace")
        stderr = result.stderr.decode("utf-8", errors="replace")
        self.assertEqual(result.returncode, 0, stdout + stderr)
        self.assertIn("全中文", stdout)


if __name__ == "__main__":
    unittest.main()
