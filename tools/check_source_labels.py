#!/usr/bin/env python3
"""核对**会被写进库的来源类型**都有中文标签。

背景：素材的 `source_type` 决定界面上显示的来源标签（`Icon.tsx` 的 `META` 表）。
`META` 里没有的类型会**原样显示英文内部名**——用户看到「note」这种词。

踩过的坑：MCP 的 `add_material` 在**没有链接**时写 `source_type = "note"`，
而 `"note"` 不在 `META` 表里。于是用户通过 Cursor 存进来的一条素材，
来源标签写着英文的 "note"——而他在应用里手动记的闪念显示的是「随手灵感」。
**同一件事两种说法。**

为什么不放在前端单测里：那条测试要读源码找来源类型，就得用 `node:fs`，
而前端的 tsconfig 没有 Node 类型（`tsc --noEmit` 会红）。所以放这边——
仓库里已有好几个同类的 Python 守卫。

静态检查范围：sourceType/source_type 字段的直接字面量赋值与简单三元表达式。
不解析任意 SQL 参数、动态值或复杂控制流；stdio MCP 写入类型由真实协议冒烟验证。
对已识别的赋值及 META 登记（含旧别名），检查是否有中文标签。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/workbench/src"
TOOLS = ROOT / "tools"
RUST = ROOT / "apps/workbench/src-tauri/src"
ICON = SRC / "ui/workspace/Icon.tsx"

sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402

# `sourceType: "x"` / `source_type, "x"` / `sourceType: cond ? "x" : "y"`
# —— 三元表达式那种写法最容易被漏掉，而 MCP 写的正是它。
#
# 只认「值是字面量」或「值是字面量组成的三元」，
# 不能匹配 `m.sourceType==='email'` 这种**比较**——
# 否则会把整行后面的 `inboxStatus==='processed'` 一并吞进来。
ASSIGN = re.compile(
    r"""source_?[Tt]ype"?\s*[:,=]\s*"""
    r"""(?:[a-z_][a-zA-Z0-9_]*\s*\?\s*)?["']([a-z][a-z-]*)["']"""
    r"""(?:\s*:\s*["']([a-z][a-z-]*)["'])?"""
)

# 卡片类型与界面状态不属于素材来源；note 是旧素材类型，需要保留检查。
NOT_A_SOURCE = {
    "card", "material", "inbox", "archive", "local", "seed", "ai", "imported",
}


def written_source_types() -> set[str]:
    found: set[str] = set()
    roots = [SRC, TOOLS, RUST]
    for root in roots:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            if not re.search(r"\.(ts|tsx|mjs|rs)$", path.name):
                continue
            if re.search(r"\.test\.|\.spec\.|__probe|test_|_tests", path.name):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for match in ASSIGN.finditer(text):
                found.add(match.group(1))
                if match.group(2):
                    found.add(match.group(2))
    for noise in NOT_A_SOURCE:
        found.discard(noise)
    return found


def registered_labels() -> dict[str, str]:
    """从 Icon.tsx 的 META 表里读出「类型 → 标签」。"""
    text = ICON.read_text(encoding="utf-8")
    block = re.search(r"const META[^=]*=\s*\{(.*?)\n\};", text, re.S)
    if not block:
        return {}
    labels: dict[str, str] = {}
    pattern = re.compile(
        r"""["']?([a-z][a-z-]*)["']?\s*:\s*\{[^}]*label:\s*["']([^"']+)["']"""
    )
    for match in pattern.finditer(block.group(1)):
        labels[match.group(1)] = match.group(2)
    return labels


def main() -> int:
    if not ICON.exists():
        emit(f"找不到 {ICON.relative_to(ROOT)}——来源标签表变了，守卫要跟着改")
        return 1

    labels = registered_labels()
    if not labels:
        emit("读不出来源标签表（META 的形状变了？）")
        return 1

    problems: list[str] = []
    written = written_source_types()
    if not written:
        problems.append("没有扫描到来源类型，请检查扫描路径与支持的赋值写法")
    # 也检查已登记的旧数据别名，避免它不再被写入后就失去检查。
    for kind in sorted(written | labels.keys()):
        label = labels.get(kind)
        if label is None:
            problems.append(
                f"来源类型「{kind}」没有登记来源标签——界面上会显示英文的内部名"
            )
        elif not re.search(r"[一-鿿]", label):
            problems.append(f"来源类型「{kind}」的标签「{label}」不是中文")

    if problems:
        emit("有来源类型会显示英文：")
        for p in problems:
            emit(f"  - {p}")
        return 1

    emit(f"来源标签静态检查通过：识别 {len(written)} 种写入类型，检查 {len(labels)} 个登记标签")
    return 0


if __name__ == "__main__":
    sys.exit(main())
