#!/usr/bin/env python3
"""剪藏规则表的跨端一致性检查：Kotlin 与 TypeScript 两份实现必须逐条相同（字符集窗口含壳里实际生效的 Rust，共三处）。

为什么需要它：这两份实现语言不同——Kotlin 给 Android 与冻住的 `:desktop`，TypeScript 给第一套桌面
`apps/workbench`——但**它们服务的是同一篇文章**。同一页进两个 App，抽出来的正文不该不一样，
所以 [CONTEXT.md](../CONTEXT.md) 把这张表定为「按同一份规则表实现的两套代码」。

靠人眼同步是不行的。2026-10-13 实测撞到过：Kotlin 侧 `JUNK_TOKENS` 里有三条写成了大写
（`APP下载` / `Cookie` / `JavaScript`），而 `isJunkLine` 比对前先把整行 `lowercase()`——
于是那三条永远不命中，TS 侧（小写）却能命中。同一张「逐条对齐」的表，行为是分叉的。

本脚本抽取两边的表与阈值逐项比对；不一致即非零退出。CI 在 android.yml 与 workbench.yml
各跑一次（两边的路径过滤都包含对端的规则表文件，改任意一端都会触发）。

用法：
    python3 tools/check_clip_parity.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KOTLIN = ROOT / "apps/android/domain/src/jvmAndAndroidMain/kotlin/com/knowflick/app/domain/WebClipEngine.kt"
TS = ROOT / "apps/workbench/src/domain/clipEngine.ts"
# 真正跑在 workbench 上的那份字节解码在壳里（抓取在壳做，绕开浏览器同源策略），
# 所以窗口值也得一起守——第一版它写 4096，与另两份的 1024 分叉过。
RUST = ROOT / "apps/workbench/src-tauri/src/http.rs"

# (Kotlin 名, TS 名, 语义) —— ordered 表示顺序也有意义（抽取逻辑按序取首个命中）
TABLE_PAIRS: list[tuple[str, str, str]] = [
    ("DROP_TAGS", "DROP_TAGS", "unordered"),
    ("VOID_TAGS", "VOID_TAGS", "unordered"),
    ("BLOCK_TAGS", "BLOCK_TAGS", "unordered"),
    ("SEMANTIC_CANDIDATE_TAGS", "SEMANTIC", "unordered"),
    ("CANDIDATE_HINTS", "HINTS", "ordered"),
    ("CANDIDATE_VETOES", "VETOES", "ordered"),
    ("JUNK_TOKENS", "JUNK", "ordered"),
]

NUMBER_PAIRS: list[tuple[str, str]] = [
    ("MAX_TEXT_CHARACTERS", "MAX_TEXT_CHARACTERS"),
    ("MIN_LINE_CHARACTERS", "MIN_LINE_CHARACTERS"),
    ("META_LINE_CHARACTERS", "META_LINE_CHARACTERS"),
    ("JUNK_TOKEN_MAX_LINE_CHARACTERS", "JUNK_TOKEN_MAX_LINE_CHARACTERS"),
]

STRING_LITERAL = re.compile(r'"((?:[^"\\]|\\.)*)"')


def kotlin_table(text: str, name: str) -> list[str] | None:
    match = re.search(rf"\b{name}\s*=\s*(?:listOf|setOf)\(([^)]*)\)", text, re.S)
    return STRING_LITERAL.findall(match.group(1)) if match else None


def ts_table(text: str, name: str) -> list[str] | None:
    match = re.search(rf"\b{name}\s*=\s*(?:new Set\()?\[([^\]]*)\]", text)
    return STRING_LITERAL.findall(match.group(1)) if match else None


def kotlin_number(text: str, name: str) -> int | None:
    match = re.search(rf"\b{name}\s*=\s*([0-9][0-9_]*)", text)
    return int(match.group(1).replace("_", "")) if match else None


def ts_number(text: str, name: str) -> int | None:
    match = re.search(rf"\b{name}\s*=\s*([0-9][0-9_]*)", text)
    return int(match.group(1).replace("_", "")) if match else None


def rust_number(text: str, name: str) -> int | None:
    match = re.search(rf"\b{name}\s*:\s*usize\s*=\s*([0-9][0-9_]*)", text)
    return int(match.group(1).replace("_", "")) if match else None


def describe(values: list[str], limit: int = 6) -> str:
    shown = ", ".join(values[:limit])
    return f"[{shown}{' …' if len(values) > limit else ''}]（{len(values)} 条）"


def main() -> int:
    for path in (KOTLIN, TS, RUST):
        if not path.is_file():
            print(f"::error::找不到规则表文件：{path.relative_to(ROOT)}", file=sys.stderr)
            return 2

    kotlin_text = KOTLIN.read_text(encoding="utf-8")
    ts_text = TS.read_text(encoding="utf-8")
    rust_text = RUST.read_text(encoding="utf-8")
    issues: list[str] = []

    for k_name, t_name, semantics in TABLE_PAIRS:
        k_values = kotlin_table(kotlin_text, k_name)
        t_values = ts_table(ts_text, t_name)
        if k_values is None:
            issues.append(f"Kotlin 侧解析不到 {k_name}（改了写法就同步改本脚本）")
            continue
        if t_values is None:
            issues.append(f"TS 侧解析不到 {t_name}（改了写法就同步改本脚本）")
            continue
        if semantics == "ordered":
            same = k_values == t_values
        else:
            same = set(k_values) == set(t_values)
        label = f"{k_name} ↔ {t_name}"
        if same:
            print(f"✓ {label}：{describe(k_values)}")
            continue
        extra_k = [v for v in k_values if v not in t_values]
        extra_t = [v for v in t_values if v not in k_values]
        detail = []
        if extra_k:
            detail.append(f"只在 Kotlin：{describe(extra_k)}")
        if extra_t:
            detail.append(f"只在 TS：{describe(extra_t)}")
        if not detail:
            detail.append("两边条目相同但顺序不同（该表按序生效）")
        issues.append(f"{label} 不一致——" + "；".join(detail))

        # 大小写是这套表最容易踩的坑：比对前整行已 lowercase()，写成大写的 token 永不命中
        for side, values in (("Kotlin", k_values), ("TS", t_values)):
            bad = [v for v in values if v != v.lower()]
            if bad:
                issues.append(f"{side} 的 {label.split(' ↔ ')[0]} 里有非小写 token，永不命中：{describe(bad)}")

    for k_name, t_name in NUMBER_PAIRS:
        k_value = kotlin_number(kotlin_text, k_name)
        t_value = ts_number(ts_text, t_name)
        if k_value is None or t_value is None:
            issues.append(f"解析不到阈值 {k_name}（Kotlin={k_value} / TS={t_value}）")
            continue
        if k_value == t_value:
            print(f"✓ {k_name} ↔ {t_name}：{k_value}")
        else:
            issues.append(f"{k_name} ↔ {t_name} 不一致：Kotlin={k_value} / TS={t_value}")

    # 字符集嗅探窗口三处一致（含壳里那份实际生效的 Rust）。值本身不写死，只要求三方相同。
    sniff = {
        "Kotlin": kotlin_number(kotlin_text, "META_SNIFF_BYTES"),
        "TypeScript": ts_number(ts_text, "META_SNIFF_BYTES"),
        "Rust": rust_number(rust_text, "META_SNIFF_BYTES"),
    }
    if None in sniff.values():
        issues.append(
            "解析不到 META_SNIFF_BYTES：" + " / ".join(f"{k}={v}" for k, v in sniff.items())
        )
    elif len(set(sniff.values())) != 1:
        issues.append(
            "META_SNIFF_BYTES 三处不一致（同一页可能解出不同编码）："
            + " / ".join(f"{k}={v}" for k, v in sniff.items())
        )
    else:
        print(f"✓ META_SNIFF_BYTES（Kotlin / TypeScript / Rust 三处一致）：{sniff['Kotlin']}")

    if issues:
        print(f"\n发现 {len(issues)} 处跨端不一致：", file=sys.stderr)
        for issue in issues:
            print(f"  - {issue}", file=sys.stderr)
        print(
            "\n这两份实现服务同一篇文章，规则表必须同源；改一端就把另一端一起改。",
            file=sys.stderr,
        )
        return 1

    print("\n剪藏规则表逐条一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
