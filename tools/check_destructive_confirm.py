#!/usr/bin/env python3
"""核对**不可撤销的删除**在界面上都有二次确认。

背景：几处删除，只有两处有确认——
- 删除知识卡：二次点击确认（点一下变成「确认」，四秒后自动收回）；
- 删除认知产物：`window.confirm`；
- **删除订阅：没有**——一个「×」图标按钮，点一下订阅就永久消失
  （`db_delete_subscription` 是硬删除，没有回收站），
  而它就挨着「立即抓取」与开关，很容易误点；
- **清空手写笔迹**：也没有——一笔一下就没了，而「撤销」只退一笔。

**为什么用脚本守，而不是单测**：前端没有 DOM 测试环境
（`vite.config.ts` 是 `environment: "node"`，也没装 jsdom / testing-library），
服务端渲染看不到**点击之后**的状态——所以「点了直接删」的退化版本，
单测照样绿。脚本读源码，能看见接线。

判据：**点一下就直接做不可逆的事的点击处理器，它自己必须经由确认入口。**
不是「这个文件里有没有确认」——那样只要文件里别处有确认就糊弄过去了。

范围说明：这条查的是**界面入口**（用户点下去的那一下）。
更底层的存储调用在数据层，由界面入口挡在确认之后——不在本守卫范围内。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "apps/workbench/src/ui/workspace"

sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402

# 点击处理器里出现这些，就是「点一下就不可逆」。
DESTRUCTIVE = re.compile(
    r"\b(onDelete|dbDelete\w*|deleteCard|deleteArtifact|deleteMaterial|"
    r"clearInk|clearAll|clearList|resetAll)\b"
)

# 二次确认的入口。**必须出现在这个处理器自己身上**。
CONFIRMATION = re.compile(
    r"(useDeleteConfirm\s*\(|deleteConfirmLabels\s*\(|window\.confirm\s*\(|"
    r"confirmDelete|confirm\.request\s*\(|requestDelete\s*\(|requestClear\s*\()"
)

# `onClick={...}` / `onClick={() => ...}` / `onClick={handler}`。
ON_CLICK = re.compile(r"onClick=(?P<body>\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[A-Za-z_$][\w.$]*)")


def handlers(text: str):
    """逐个取出 onClick 处理器的代码。"""
    for match in ON_CLICK.finditer(text):
        body = match.group("body")
        line = text[: match.start()].count("\n") + 1
        yield line, body


# 处理器里调用了某个本地函数时，要跟着看**那个函数**有没有确认。
LOCAL_CALL = re.compile(r"\b([A-Za-z_$][\w$]*)\s*\(")


def called_functions(text: str, body: str) -> list[str]:
    """取出处理器里调用的本地函数名（排除 React 与内建）。"""
    known = set(LOCAL_CALL.findall(text))
    used = [name for name in LOCAL_CALL.findall(body) if name in known]
    return used


def function_bodies(text: str) -> dict[str, list[str]]:
    """文件里每个本地函数体（按 `function 名(` 或 `const 名 = (` 找）。"""
    result: dict[str, list[str]] = {}
    lines = text.splitlines()
    for index, line in enumerate(lines):
        match = re.match(r"\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", line)
        if not match:
            match = re.match(
            r"\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?:=>|:\s*async)",
            line,
        )
        if not match:
            continue
        name = match.group(1)
        depth = 0
        body: list[str] = []
        for probe in lines[index:]:
            body.append(probe)
            depth += probe.count("{") - probe.count("}")
            if depth <= 0 and "{" in "".join(body):
                break
        result[name] = body
    return result


def main() -> int:
    problems: list[str] = []
    checked = 0

    for path in sorted(UI.glob("*.tsx")):
        if path.name.endswith(".test.tsx"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        lines = text.splitlines()
        functions = function_bodies(text)
        for lineno, body in handlers(text):
            checked += 1
            if CONFIRMATION.search(body):
                continue

            # 处理器自己可能就写着破坏性调用，也可能只是调一个本地函数
            # （删除产物的点击调的是 `remove(artifact)`，破坏性在 `remove` 里）。
            # 所以「破坏性」要在处理器**和它调用的函数**里一起找。
            called = [
                name
                for name in called_functions(text, body)
                if name not in ("setState", "useState", "useEffect", "useRef", "useMemo", "useCallback")
            ]
            targets = [body] + ["\n".join(functions[name]) for name in called if name in functions]
            if not any(DESTRUCTIVE.search(target) for target in targets):
                continue

            # 确认必须在**其中之一**里。
            if any(CONFIRMATION.search(target) for target in targets):
                continue
            try:
                shown = path.relative_to(ROOT)
            except ValueError:
                shown = path
            problems.append(
                f"{shown}:{lineno} 的点击处理器直接做不可撤销的事，"
                f"没有经由二次确认：{lines[lineno - 1].strip()[:90]}"
            )

    if problems:
        emit("有不可撤销的操作缺二次确认：")
        for p in problems:
            emit(f"  - {p}")
        return 1

    emit(f"不可撤销的删除都有二次确认：检查了 {checked} 个点击处理器")
    return 0


if __name__ == "__main__":
    sys.exit(main())
