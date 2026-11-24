#!/usr/bin/env python3
"""核对 Go 后端**面向用户的错误消息**是中文。

界面上的错误消息是用户唯一的线索。中文软件里冒出一句英文，
用户既看不懂也不知道下一步该做什么——只能卡住。

已经踩过的：邮件模块里 24 条校验错误是英文的
（\"Invalid account email\"、\"Enter the password again...\"），
而前端的 `errorText()` 只做密钥脱敏、**不翻译**，于是英文原样显示。

判据：`errors.New(\"...\")` / `fmt.Errorf(\"...\")` 的字面量里
**不含中文**就是漏网的。（技术术语像 ZIP / UTF-8 出现在中文句子里没问题——
判据看的是「有没有中文」，不是「有没有英文」。）

**迁移说明**（ADR-0042 删掉 Rust 壳时）：这条守卫原来扫 `src-tauri/src`，
现在扫 `apps/workbench-go`。两类判据都保留：
1. 整句英文（不含中文）；
2. 半中半英：`fmt.Errorf(\"前缀：%w\", err)` 把底层英文直接拼进用户消息——
   改用 `errtext.Wrap(前缀, err)`（中文原因 + 下一步，原始英文留在括号里）。
`internal/errtext` 自身用它自己的实现，不在扫描范围。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from windows_console import emit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GO_ROOT = ROOT / "apps/workbench-go"

PATTERNS = [
    re.compile(r'\berrors\.New\(\s*"([^"]*)"'),
    re.compile(r'\bfmt\.Errorf\(\s*"([^"]*)"'),
]

# 第二类：**半中半英**——中文前缀后面直接拼底层错误（fmt.Errorf("…：%w", err)）。
# Rust 版对应的是把 {e} 拼进消息；Go 侧要改成 errtext.Wrap(前缀, err)，
# 中文前缀 + 原因/下一步，原始英文留在括号里。
WRAP_FMT = re.compile(r'\bfmt\.Errorf\(\s*"([^"]*)"')
ERR_ARG = re.compile(r',\s*(?:err|scanErr|e|err2|closeErr)\s*\)')

# 这些是**内部哨兵**，不是给用户看的：唯一的调用方会包成中文。
ALLOW = {
    "not utf-8",  # internal/archive：`fmt.Errorf("%s 不是 UTF-8", entry.Name)` 包住
}


def has_chinese(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def problems_in(root: Path, display: str = "") -> list[str]:
    """扫描 root 下的 Go 源码，返回「面向用户的错误消息是英文」的清单。"""
    problems: list[str] = []
    for path in sorted(root.rglob("*.go")):
        if path.name.endswith("_test.go") or "vendor" in path.parts:
            continue  # 测试里的英文是故意的；vendor 是第三方
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("//"):
                continue
            for pattern in PATTERNS:
                for message in pattern.findall(line):
                    message = message.strip()
                    if not message or message.lower() in ALLOW:
                        continue
                    if not has_chinese(message):
                        where = f"{display}/{path.relative_to(root)}" if display else str(path.relative_to(root))
                        problems.append(
                            f"{where}:{lineno} 的错误消息是英文，用户看不懂：{message!r}"
                        )
            wrap = WRAP_FMT.search(line)
            if wrap and "errtext." not in line:
                fmtstr = wrap.group(1)
                direct = "%w" in fmtstr or ("%v" in fmtstr and ERR_ARG.search(line) is not None)
                if direct:
                    where = f"{display}/{path.relative_to(root)}" if display else str(path.relative_to(root))
                    problems.append(
                        f"{where}:{lineno} 把底层错误直接拼进用户消息，会出现半中半英：{fmtstr!r}"
                        "——改用 errtext.Wrap(前缀, err)"
                    )
    return problems


def main() -> int:
    problems = problems_in(GO_ROOT, "apps/workbench-go")
    if problems:
        emit("面向用户的错误消息里混着英文：")
        for p in problems:
            emit(f"  - {p}")
        return 1
    emit("Go 侧错误消息全中文：没有整句英文的消息")
    return 0


if __name__ == "__main__":
    sys.exit(main())
