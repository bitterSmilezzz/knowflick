#!/usr/bin/env python3
"""核对**会落进用户数据**的英文字面量。

和「错误消息要中文」是同一类问题，但更隐蔽：错误消息只在出错时出现，
而**内容**是常态——一封无主题的邮件以前落成 `"(No subject)"`，
收件箱里就**一直**写着它（`Workspace.tsx` 直接渲染 `e.title`）。

判据：Go 里会被写进 `Material` / `KnowledgeCard` 的字段
（`Title` / `RawText` / `Summary` / `Description` / `CleanedMarkdown`）的字面量，
若**不含中文**且有 ≥2 个英文单词，就算漏网。

技术词（`GitHub`、`INBOX`）不算——那是要原样显示的标识符。

迁移说明（ADR-0042）：这条守卫原来扫 `src-tauri/src/*.rs` 的 Rust 结构体字面量，
Rust 壳删除后改扫 `apps/workbench-go` 的 Go 结构体字面量与标题赋值。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from windows_console import emit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GO_ROOT = ROOT / "apps/workbench-go"

# 会进用户数据的字段。Go 的字段名首字母大写；`title = …` 是邮件导入的兜底标题。
FIELD_PATTERNS = [
    re.compile(r"\bTitle:\s*\"([^\"]*)\""),
    re.compile(r"\bRawText:\s*\"([^\"]*)\""),
    re.compile(r"\bSummary:\s*\"([^\"]*)\""),
    re.compile(r"\bDescription:\s*\"([^\"]*)\""),
    re.compile(r"\bCleanedMarkdown:\s*\"([^\"]*)\""),
    re.compile(r"\btitle\s*[:=]=\s*\"([^\"]*)\""),
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


def problems_in(root: Path, display: str = "") -> list[str]:
    problems: list[str] = []
    for path in sorted(root.rglob("*.go")):
        if path.name.endswith("_test.go") or "vendor" in path.parts:
            continue  # 测试夹具里的英文不是用户看到的内容
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if line.strip().startswith("//"):
                continue
            for pattern in FIELD_PATTERNS:
                for value in pattern.findall(line):
                    value = value.strip()
                    if not value or has_chinese(value):
                        continue
                    if value in ALLOW:
                        continue
                    if english_word_count(value) < 2:
                        continue  # 单个短词多半是标识符
                    where = f"{display}/{path.relative_to(root)}" if display else str(path.relative_to(root))
                    problems.append(
                        f"{where}:{lineno} 有会落进用户数据的英文字面量："
                        f"{value!r}——用户会在收件箱/卡库里直接看到它"
                    )
    return problems


def main() -> int:
    problems = problems_in(GO_ROOT, "apps/workbench-go")
    if problems:
        emit("会落进用户数据的英文字面量：")
        for p in problems:
            emit(f"  - {p}")
        return 1
    emit("会落进用户数据的文案全中文：没有英文漏网")
    return 0


if __name__ == "__main__":
    sys.exit(main())
