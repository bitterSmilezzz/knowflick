#!/usr/bin/env python3
"""解析 GitHub workflow 的 `paths` 过滤列表。

单独成模块是因为**两处都要用**：`check_doc_consistency.py`（守卫）
与 `test_desktop_ci_triggers.py`（回归）。两份实现各写一遍，迟早漂——
而漂移的方向通常是「一边认得、一边不认」，结果是守卫报绿而实际没生效。

只支持当前仓库实际使用的写法：每行一个带引号的路径。格式不认识时
**明确报错**，不猜、不假装支持。
"""
from __future__ import annotations

import re

# 一行一个条目：`- 'path'`，可带行尾注释（YAML 允许，GitHub 也认）。
_ENTRY = re.compile(r"      - '([^']+)'(?:\s*#.*)?\s*$")

# 整行注释要跳过。
_COMMENT = re.compile(r"^\s*#")

# `paths:` 块：一行一个条目，缩进 6 空格。
_BLOCK = re.compile(r"^    paths:\n((?:^      .*\n?)+)", re.M)


def paths_for(text: str, event: str) -> list[str]:
    """取某个事件（push / pull_request）下的 paths 列表。

    没有 paths 段时抛 ValueError——「这个事件没有 paths 过滤」与
    「paths 过滤了但格式不认识」是两回事，不能混为一谈。
    """
    event_block = re.search(
        rf"^  {event}:\n(.*?)(?=^  \w|^\S|\Z)", text, re.M | re.S
    )
    if not event_block:
        raise ValueError(f"Missing {event} event")
    block = _BLOCK.search(event_block[1])
    if not block:
        raise ValueError(f"Missing {event}.paths")
    patterns: list[str] = []
    for line in block[1].splitlines():
        if not line.strip() or _COMMENT.match(line):
            continue
        entry = _ENTRY.match(line)
        if not entry:
            raise ValueError(f"Unsupported paths entry: {line}")
        patterns.append(entry.group(1))
    return patterns


def matches(path: str, pattern: str) -> bool:
    """路径是否被某条过滤规则覆盖。

    只支持字面路径与尾部 `/**`——这是当前仓库实际在用的两种。
    其它语法明确报错，不假装实现 GitHub 的完整 glob 语义。
    """
    if pattern.endswith("/**"):
        prefix = pattern[:-3]
        if any(c in prefix for c in "*?![]{}"):
            raise ValueError(f"Unsupported glob: {pattern}")
        return path.startswith(prefix + "/")
    if any(c in pattern for c in "*?![]{}"):
        raise ValueError(f"Unsupported glob: {pattern}")
    return path == pattern
