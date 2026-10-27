#!/usr/bin/env python3
"""核对**会落进用户数据**的英文字面量。

和「错误消息要中文」是同一类问题，但更隐蔽：错误消息只在出错时出现，
而**内容**是常态——一封无主题的邮件以前落成 `"(No subject)"`，
收件箱里就**一直**写着它（`Workspace.tsx` 直接渲染 `e.title`）。

判据：Rust 里会被写进 `RawMaterialDto` / `KnowledgeCardDto` 的字段
（`title` / `raw_text` / `summary` / `description`）的字面量，
若**不含中文**且有 ≥2 个英文单词，就算漏网。

技术词（`GitHub`、`INBOX`）不算——那是要原样显示的标识符。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/workbench/src-tauri/src"

sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402

# 会进用户数据的字段
# 字段的字面量。注意 `if cond {` 与字面量**可能分在两行**，
# 所以要用 DOTALL（`re.S`）而不是只匹配同一行——不然会漏掉
# `title: if subject.trim().is_empty() {\n    "(No subject)".into()\n}`
# 这种最常见的写法。
FIELD_PATTERNS = [
    re.compile(r"\btitle:\s*if\b.*?\{\s*\"([^\"]*)\"", re.S),
    re.compile(r"\btitle:\s*\"([^\"]*)\""),
    re.compile(r"\braw_text:\s*if\b.*?\{\s*\"([^\"]*)\"", re.S),
    re.compile(r"\braw_text:\s*\"([^\"]*)\""),
    re.compile(r"\bsummary:\s*\"([^\"]*)\""),
    re.compile(r"\bdescription:\s*\"([^\"]*)\""),
    re.compile(r"\bcleaned_markdown:\s*\"([^\"]*)\""),
]

# 这些是**要原样显示**的技术标识符，不算漏网。
ALLOW = {
    "GitHub",
    "INBOX",
    "Sent",
    "Drafts",
    "Trash",
    "Junk",
    "Archive",
}


def has_chinese(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def english_word_count(text: str) -> int:
    # 单词按 **≥2 个字母** 算——否则 "(No subject)" 这种
    # 只算 1 个词而被当成「短标识符」放过去，而它恰恰是最该抓的。
    return len(re.findall(r"[A-Za-z]{2,}", text))


def main() -> int:
    problems: list[str] = []
    for path in sorted(SRC.glob("*.rs")):
        if path.name.endswith("_tests.rs"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        # 跳过 #[cfg(test)] 之后的内容——那里的字符串是**测试夹具**，
        # 不是用户看到的内容。（不跳过会误报：db.rs 的测试里有一条卡片，
        # 它的链接标题是 "Database Internals"。）
        lines = text.splitlines()
        test_from = next(
            (i for i, l in enumerate(lines) if l.strip().startswith("#[cfg(test)]")),
            len(lines),
        )
        # **按整段扫描**，不是按行——`title: if cond {\n    "…".into()\n}`
        # 的字面量在**下一行**，按行扫就永远看不到它。
        body = "\n".join(lines[:test_from])
        for pattern in FIELD_PATTERNS:
            for match in pattern.finditer(body):
                value = match.group(1).strip()
                if not value or has_chinese(value):
                    continue
                if value in ALLOW:
                    continue
                if english_word_count(value) < 2:
                    continue  # 单个短词多半是标识符
                lineno = body[: match.start()].count("\n") + 1
                problems.append(
                    f"{path.relative_to(ROOT)}:{lineno} 有会落进用户数据的英文字面量："
                    f"{value!r}——用户会在收件箱/卡库里直接看到它"
                )

    if problems:
        emit("会落进用户数据的英文字面量：")
        for p in problems:
            emit(f"  - {p}")
        return 1

    emit("会落进用户数据的文案全中文：没有英文漏网")
    return 0


if __name__ == "__main__":
    sys.exit(main())
