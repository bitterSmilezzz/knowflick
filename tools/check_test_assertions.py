#!/usr/bin/env python3
"""核对测试里的 `expect(...)` 都**带 matcher**。

为什么要有这条：vitest 的 `expect(actual, message)` **后面不接 matcher 时什么也不断言**——
它只是构造一个对象，测试照样通过。

这在写断言时很容易发生：想写 `expect(x, "说明").toBe(y)`，
却只写了 `expect(x, "说明")`。测试**绿着**，但什么都没检查。

踩过的坑（2026-10-23）：来源类型标签那条断言就是这么写的，
本轮新写的标签检查因此一度通过，直到补上 matcher 才拒绝英文标签。

判据：`expect(...)` 这个调用，若后面**没有真正执行的 matcher**
（如 `.toBe(...)` / `.toEqual(...)` / `.toThrow(...)`，而 `.not` / `.resolves` 本身不算 matcher），
就是空断言——它只是构造一个对象，测试照样通过。

**为什么不用正则**（第一版就是这么写的，抓不住真回归）：
- 正则配不平**嵌套括号**。真实的回归形态是
  ```
  expect(
    /[一-鿿]/.test(label),
    `msg ${type}`,
  );
  ```
  里面那对括号让正则的括号计数彻底失准——这条断言就漏过去了。
- 正则按**行**判断，于是「一行到头、后面什么也没有」的 `expect(x)`（没写分号）
  被当成「后面没东西 = 没问题」而放过。
- 正则**认得** `.not` 就算完，于是 `expect(x).not` 这种断在半路的链子能过关。

所以改成用 **TypeScript 编译器 API 走 AST**：`tools/check_test_assertions.mjs`
（用仓库里已有的 `apps/workbench/node_modules/typescript`，不新增依赖）。
本文件只负责：找到要扫的目录、调用 node、把人能读的结论打出来。

**它查什么**
- 裸 `expect(x)`：后面一环都没有 —— 什么都不检查。
- 断在半路的链子：`expect(x).not` / `.resolves` / `.rejects` / `.toBe`（写了没调用）。
- 合法写法一律放过：`expect.any(...)` 等非对称匹配器、`expect(...).toThrow(...)`、
  `expect(x).not.toBe(...)`、`expect(p).resolves.toBe(...)`。

**作用域**：只扫 `apps/workbench/src` 下的 `*.test.ts` / `*.test.tsx`。
别的端（安卓、Kotlin）没有 vitest 的 `expect`，规则不适用。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/workbench/src"
SCANNER = ROOT / "tools/check_test_assertions.mjs"

sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402


def run_scanner(target: Path) -> dict:
    """跑 AST 扫描器，返回它的 JSON 结果。

    扫描器自己失败（找不到 typescript、路径不存在）时抛异常——不能把
    「没跑成」当成「没问题」。
    """
    proc = subprocess.run(
        ["node", str(SCANNER), str(target)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"AST 扫描器跑失败（退出码 {proc.returncode}）：{detail}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:  # pragma: no cover - 扫描器输出异常
        raise RuntimeError(f"AST 扫描器的输出不是 JSON：{proc.stdout[:200]}") from exc


def describe(problem: dict) -> str:
    """把一条问题说成人话：哪一行、什么形态、为什么是问题。"""
    path = problem["file"]
    try:
        rel = Path(path).resolve().relative_to(ROOT)
    except ValueError:
        rel = Path(path)
    where = f"{rel}:{problem['line']}"
    kind = problem.get("kind")
    if kind == "parse-error":
        return f"{where} 的文件解析不过——守卫看不懂它，先修语法"
    if kind == "bare":
        return (
            f"{where} 的 expect(...) 后面没有 matcher——"
            f"这条断言什么都不检查：{problem.get('text', '')}"
        )
    modifier = problem.get("modifier") or "matcher"
    return (
        f"{where} 的 expect(...) 链断在 .{modifier} 上——"
        f"后面没有真正执行的 matcher，这条断言什么都不检查：{problem.get('text', '')}"
    )


def main(target: Path | None = None) -> int:
    """扫 `target`（默认整个 `apps/workbench/src`），空断言就返回 1。

    `target` 可传入别处——回归测试用临时目录，不动仓库里的文件。
    """
    scan_root = Path(target) if target is not None else SRC
    if not scan_root.exists():
        emit(f"找不到 {scan_root}——前端源码目录变了，守卫要跟着改")
        return 1
    if not SCANNER.exists():
        emit(f"找不到 {SCANNER.relative_to(ROOT)}——AST 扫描器丢了，守卫没法干活")
        return 1

    try:
        result = run_scanner(scan_root)
    except RuntimeError as exc:
        emit(f"空断言守卫跑不起来：{exc}")
        return 1

    problems = result.get("problems", [])
    scanned = result.get("scanned", [])

    if problems:
        emit("有空断言（expect 后面没有 matcher，什么都不检查）：")
        for problem in problems:
            emit(f"  - {describe(problem)}")
        return 1

    emit(f"测试里的 expect 都带 matcher：{len(scanned)} 个测试文件，没有空断言")
    return 0


if __name__ == "__main__":
    sys.exit(main())
