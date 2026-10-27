#!/usr/bin/env python3
"""核对 Rust 侧**面向用户的错误消息**是中文。

界面上的错误消息是用户唯一的线索。中文软件里冒出一句英文，
用户既看不懂也不知道下一步该做什么——只能卡住。

已经踩过的：邮件模块里 24 条校验错误是英文的
（"Invalid account email"、"Enter the password again..."），
而前端的 `errorText()` 只做密钥脱敏、**不翻译**，于是英文原样显示。

判据：`Err("...")` 字面量里**不含中文**就是漏网的。
（技术术语像 UUID / IMAP / MIME 出现在中文句子里没问题——判据看的是
「有没有中文」，不是「有没有英文」。）

也查 `anyhow!` / `bail!` / `format!` 里的英文——它们同样会显示给用户。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from windows_console import emit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/workbench/src-tauri/src"

# Err("...") / .into() / anyhow!("...") / bail!("...")
PATTERNS = [
    re.compile(r'\bErr\(\s*"([^"]*)"'),
    re.compile(r'\banyhow!\(\s*"([^"]*)"'),
    re.compile(r'\bbail!\(\s*"([^"]*)"'),
    re.compile(r'\breturn\s+Err\(\s*format!\(\s*"([^"]*)"'),
]

# 这些是**内部标记**，不是给用户看的，不算漏网。
ALLOW = {
    # 测试与内部常量
    "internal",
}


def has_chinese(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def main() -> int:
    problems: list[str] = []
    for path in sorted(SRC.glob("*.rs")):
        if path.name.endswith("_tests.rs"):
            continue  # 测试里的英文是故意的
        text = path.read_text(encoding="utf-8", errors="ignore")
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("///"):
                continue
            for pattern in PATTERNS:
                for message in pattern.findall(line):
                    if not message.strip():
                        continue
                    if message.strip().lower() in ALLOW:
                        continue
                    if not has_chinese(message):
                        problems.append(
                            f"{path.relative_to(ROOT)}:{lineno} 的错误消息是英文，"
                            f"用户看不懂：{message!r}"
                        )

    # 第二类：**半中半英**——中文前缀后面跟着底层的英文报错。
    # 「下载模型失败: error sending request for url ...」这种，
    # 用户看懂了「下载模型失败」，但不知道**为什么**、更不知道**下一步**。
    for path in sorted(SRC.glob("*.rs")):
        if path.name.endswith("_tests.rs"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("///"):
                continue
            for m in re.finditer(r'format!\(\s*"([^"]*\{e\}[^"]*)"', stripped):
                message = m.group(1)
                # 「{e}」是底层错误——直接拼进面向用户的消息里就是半中半英。
                problems.append(
                    f"{path.relative_to(ROOT)}:{lineno} 把底层错误 {{e}} 直接拼进消息，"
                    f"用户会看到半中半英：{message!r}——用 crate::error_text::explain(...) 代替"
                )

    if problems:
        emit("面向用户的错误消息里混着英文：")
        for p in problems:
            emit(f"  - {p}")
        return 1

    emit("Rust 侧错误消息全中文：没有英文漏网")
    return 0


if __name__ == "__main__":
    sys.exit(main())
