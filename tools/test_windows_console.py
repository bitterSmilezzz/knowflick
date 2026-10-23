#!/usr/bin/env python3
"""回归：会打印中文的脚本在 Windows 控制台（cp1252）下不能崩。

我连着**三次**在 Windows CI 上踩这个：
1. `check_tauri_permissions.py` 直接 print 中文；
2. `check_rust_error_messages.py` 直接 print 中文；
3. `destructive_confirm_reverse_test.py` 直接 print 中文。

根因是「每个脚本自己写一份 print 防护」，**新脚本总会忘**——
第三次的时候，抽出来的共享模块 `tools/windows_console.py` 已经存在，
我还是忘了用它。

所以名单**由扫描得出**，不手写：凡是在 `tools/` 下、真的会打印中文的脚本，
都必须用共享的 `emit`，并且必须在 cp1252 控制台下跑通。

跑通用 `PYTHONIOENCODING=cp1252` 复现 Windows 控制台，并且**按真实方式调用**
（`python3 tools/<name>.py`）。用 `python3 -c` 包一层会改掉 `sys.path[0]`：
脚本里的 `import taxonomy` 之类直接 ModuleNotFoundError，退出码 1 又被当成
「预期失败的守卫」放过——实测 `classify_ui_portability.py` 连启动都启动不了，
这条测试照样是绿的。
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"

SKIP = {
    "windows_console.py",  # 共享模块本身（`test_` 前缀已经盖住本文件）
}

# 需要**仓库外**资源才能跑的脚本：它们退出非零是环境的事，不是「崩了」。
# 仍然要 import emit（会打印中文），只是不参与「跑一遍」那步。
NEEDS_EXTERNAL_RESOURCES = {
    "generate_app_icons.py",  # 要 PIL 与 shared/icons/AppIcon.iconset（母版未入库）
    "import_lessons.py",      # 要仓库外的内容数据源（~/workspace/.../kj-content.json）
}

# `print(` / `emit(` 的调用点（排除 `x.print(` 这类方法调用）。
_PRINT_CALL = re.compile(r"(?<![\w.])(?:print|emit)\s*\(")


def scripts_printing_chinese() -> list[str]:
    """找出 tools/ 下**会打印**中文的脚本。

    判据是「含中文」**且**「有 print/emit 调用」。只看前者会把
    `taxonomy.py` / `workflow_paths.py` 这种只在注释里提了中文、
    根本不打印任何东西的库模块也拖进来。
    """
    found: list[str] = []
    for path in sorted(TOOLS.glob("*.py")):
        if path.name in SKIP or path.name.startswith("test_"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if not re.search(r"[\u4e00-\u9fff]", text):
            continue
        if not _PRINT_CALL.search(text):
            continue
        found.append(path.name)
    return found


class WindowsConsoleTest(unittest.TestCase):
    def test_shared_emit_module_exists(self):
        self.assertTrue(
            (TOOLS / "windows_console.py").exists(),
            "共享的 windows_console.emit 应该在——每个脚本自己写一份，新脚本总会忘",
        )

    def test_the_scan_finds_the_known_offenders(self):
        """扫描本身要能认出那些**曾经**在 Windows 上崩过的脚本。"""
        found = scripts_printing_chinese()
        for name in ("check_tauri_permissions.py", "check_rust_error_messages.py"):
            self.assertIn(name, found, f"{name} 打印中文，扫描却没认出来")

    def test_the_scan_ignores_modules_that_never_print(self):
        """只在注释里提中文、根本不打印的模块不该被拖进来。"""
        found = scripts_printing_chinese()
        for name in ("taxonomy.py", "workflow_paths.py"):
            self.assertNotIn(name, found, f"{name} 不打印任何东西，扫描不该认它")

    def test_checks_print_chinese_via_the_shared_helper(self):
        """会打印中文的脚本要用共享的 emit，而不是裸 print。"""
        for name in scripts_printing_chinese():
            text = (TOOLS / name).read_text(encoding="utf-8")
            self.assertIn(
                "from windows_console import emit",
                text,
                f"{name} 打印中文却没用共享的 emit（Windows 控制台是 cp1252）",
            )

    def test_each_check_runs_under_a_cp1252_console(self):
        """按真实调用方式在 cp1252 控制台下跑一遍。"""
        env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
        for name in scripts_printing_chinese():
            if name in NEEDS_EXTERNAL_RESOURCES:
                continue
            with self.subTest(script=name):
                # 用 bytes 收：emit 的兜底是按 UTF-8 写字节的，
                # 按本地编码解会解出乱码，甚至先崩在测试自己身上。
                result = subprocess.run(
                    [sys.executable, str(TOOLS / name)],
                    capture_output=True,
                    cwd=str(ROOT),
                    env=env,
                )
                stderr = result.stderr.decode("utf-8", errors="replace")
                self.assertNotIn(
                    "UnicodeEncodeError",
                    stderr,
                    f"{name} 在 cp1252 控制台下崩了：{stderr[:300]}",
                )
                # Traceback = 脚本根本没跑到该打印的地方。退出码可能是 1
                # （正好落进「预期失败的守卫」这个口径），所以必须单独看。
                self.assertNotIn(
                    "Traceback (most recent call last)",
                    stderr,
                    f"{name} 在 cp1252 控制台下抛异常了：{stderr[:300]}",
                )


if __name__ == "__main__":
    unittest.main()
