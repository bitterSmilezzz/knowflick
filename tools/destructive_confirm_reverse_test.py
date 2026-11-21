#!/usr/bin/env python3
"""反向验证：不可撤销删除的守卫**真的**抓得住缺确认的写法。

守卫：`tools/check_destructive_confirm.py`。

守卫自己也会骗自己——「它报绿」不等于「它在守东西」。
这里把四种真实的退化逐个塞进去，确认守卫**报红**：

1. 删除订阅：回到「一点即删」（本轮修掉的缺陷）；
2. 清空手写笔迹：回到「一点即没」（本轮修掉的缺陷）；
3. 删除知识卡：去掉二次确认（本来就有的功能，被改坏）；
4. 删除认知产物：去掉 `window.confirm`（同上）。

第 3、4 条是**反向**检查：守卫不能对这两处误报——
它们本来就有确认，守卫放过才是对的。

每次跑完都把文件恢复原状。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Windows 控制台默认 cp1252，直接 print 中文会 UnicodeEncodeError。
# 用共享的 emit——这已经是同一个坑第三次出现了。
sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402
UI = ROOT / "apps/workbench/src/ui/workspace"
GUARD = ROOT / "tools/check_destructive_confirm.py"


def run_guard() -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, str(GUARD)], cwd=ROOT, capture_output=True
    )
    return proc.returncode, (proc.stdout + proc.stderr).decode("utf-8", errors="replace")


# (说明, 文件, 原文片段, 退化片段, 期望守卫报出)
CASES = [
    (
        "删除订阅一点即删",
        "SubscriptionsView.tsx",
        "{subscriptionDeleteButton(sub, confirm.isArmed(sub.id), requestDelete, busy)}",
        "<button onClick={() => void onDelete(sub)}>删除</button>",
        True,
    ),
    (
        "清空笔迹一点即没",
        "NotePads.tsx",
        'onClick={() => confirmClear.request("ink")}',
        "onClick={() => setDoc(clearInk)}",
        True,
    ),
    (
        "删除知识卡去掉确认",
        "EntryInspector.tsx",
        "onClick={() => confirm.request(entry.id)}",
        "onClick={() => void run(onDelete)}",
        True,
    ),
    (
        "删除产物去掉 confirm",
        "ArtifactsView.tsx",
        "if (!window.confirm(`删除产物「${artifact.title}」？`)) return;",
        "",
        True,
    ),
]


def main() -> int:
    failures = 0
    baseline_code, baseline_out = run_guard()
    if baseline_code != 0:
        emit("FAIL 正常实现必须先通过守卫")
        emit(baseline_out)
        return 1

    for label, filename, original, degraded, expect_report in CASES:
        path = UI / filename
        backup = path.read_text(encoding="utf-8")
        try:
            if original not in backup:
                emit(f"FAIL {label} → 锚点没找到，这个用例测不到任何东西")
                failures += 1
                continue
            path.write_text(backup.replace(original, degraded, 1), encoding="utf-8")
            code, out = run_guard()
            reported = code == 1 and "缺二次确认" in out
            if reported == expect_report:
                emit(f"PASS {label} → 守卫{'报出' if reported else '放过'}（符合预期）")
            else:
                emit(f"FAIL {label} → 守卫{'报出' if reported else '放过'}，与预期不符")
                failures += 1
        finally:
            path.write_text(backup, encoding="utf-8")

    code, out = run_guard()
    if code != 0:
        emit("FAIL 恢复后守卫必须通过")
        emit(out)
        failures += 1
    else:
        emit("PASS 恢复后守卫通过")

    if failures:
        emit(f"\n反向验证有 {failures} 项没通过")
        return 1
    emit(f"\n反向验证全部通过：{len(CASES)} 个退化用例的断言都真的在守东西")
    return 0


if __name__ == "__main__":
    sys.exit(main())
