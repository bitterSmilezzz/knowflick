#!/usr/bin/env python3
"""回归：不可撤销删除的守卫要真的抓得住缺确认的写法。

守卫：`tools/check_destructive_confirm.py`。

它守的是「删除订阅」与「清空手写笔迹」这两处**曾经没有二次确认**的入口。
判据的难点在**接线**：破坏性调用可能写在处理器里，也可能写在它调用的
本地函数里（删除产物的点击调 `remove(artifact)`，确认在 `remove` 里）。
所以这些用例覆盖两种位置。
"""
from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_destructive_confirm as checker


class DestructiveConfirmGuardTest(unittest.TestCase):
    def test_repository_has_no_unguarded_destructive_action(self):
        problems = self._problems_for(checker.UI)
        self.assertEqual(problems, [], "有不可撤销的操作缺确认：\n" + "\n".join(problems))

    def _guard_with(self, filename: str, source: str) -> list[str]:
        """把一段源码放进临时目录，跑守卫，返回它报出的问题。"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui = root / "ui"
            ui.mkdir()
            (ui / filename).write_text(source, encoding="utf-8")
            buf = io.StringIO()
            with patch.object(checker, "UI", ui):
                with contextlib.redirect_stdout(buf):
                    code = checker.main()
            text = buf.getvalue()
            problems = [
                line.strip()
                for line in text.splitlines()
                if line.strip().startswith("-")
            ]
            if problems:
                self.assertEqual(code, 1, f"有问题时退出码必须是 1：{text}")
            else:
                self.assertEqual(code, 0, f"没问题时退出码必须是 0：{text}")
            return problems

    def test_direct_delete_without_confirm_is_reported(self):
        problems = self._guard_with(
            "Sample.tsx",
            """
            export function Sample({ onDelete }: { onDelete: () => void }) {
              return <button onClick={() => onDelete()}>删除</button>;
            }
            """,
        )
        self.assertTrue(problems, "直接删除且无确认，应被报出")

    def test_delete_through_a_local_function_is_reported(self):
        # 删除产物就是这种形状：点击调 `remove(artifact)`，破坏性在 `remove` 里。
        problems = self._guard_with(
            "Sample.tsx",
            """
            export function Sample({ artifact }: { artifact: { id: string } }) {
              const remove = async (item: { id: string }) => {
                await dbDeleteArtifact(item.id);
              };
              return <button onClick={() => void remove(artifact)}>删除</button>;
            }
            """,
        )
        self.assertTrue(problems, "经由本地函数的删除且无确认，应被报出")

    def test_confirmed_delete_is_allowed(self):
        problems = self._guard_with(
            "Sample.tsx",
            """
            export function Sample({ onDelete }: { onDelete: () => void }) {
              const confirm = useDeleteConfirm(() => onDelete());
              return <button onClick={() => confirm.request("x")}>删除</button>;
            }
            """,
        )
        self.assertEqual(problems, [], "有二次确认就不该被报")

    def test_window_confirm_counts_as_confirmation(self):
        problems = self._guard_with(
            "Sample.tsx",
            """
            export function Sample({ artifact }: { artifact: { id: string } }) {
              const remove = async () => {
                if (!window.confirm("删除？")) return;
                await dbDeleteArtifact(artifact.id);
              };
              return <button onClick={() => void remove()}>删除</button>;
            }
            """,
        )
        self.assertEqual(problems, [], "window.confirm 应算确认")

    def test_non_destructive_click_is_not_reported(self):
        problems = self._guard_with(
            "Sample.tsx",
            """
            export function Sample({ onSave }: { onSave: () => void }) {
              return <button onClick={() => onSave()}>保存</button>;
            }
            """,
        )
        self.assertEqual(problems, [], "普通点击不该被报")

    def _problems_for(self, directory: Path) -> list[str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            checker.main()
        text = buf.getvalue()
        if "缺二次确认" in text:
            return [line.strip() for line in text.splitlines() if line.strip().startswith("-")]
        return []


if __name__ == "__main__":
    unittest.main()
