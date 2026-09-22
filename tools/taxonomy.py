#!/usr/bin/env python3
"""学科体系契约的 Python 侧读取与校验。

单一事实来源是 `shared/assets/taxonomy_map.json`。双端 `SubjectRegistry` 各自内嵌同一张表
（运行时不读文件，避开 SwiftPM 资源 bundle 与 APK 资产的历史坑），并由两端各自的 parity 测试
逐条比对；本模块则给导入管道与 CI 提供同一套校验口径，避免「App 认为合法、管道写出非法卡」。

注意 `level`（内容难度 1..5）与 FSRS 的 `difficulty`（记忆难度）是两回事。
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MAP = REPO_ROOT / "shared" / "assets" / "taxonomy_map.json"

LEVEL_RANGE = range(1, 6)


def load_map(path: Path | str = DEFAULT_MAP) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    for key in ("levels", "subjects", "legacyCategoryMap"):
        if key not in data:
            raise ValueError(f"taxonomy_map.json 缺少必需键 {key!r}")
    return data


def index(data: dict) -> dict:
    """把学科表拍平成 {subject: {name, tracks, branches:{branch:name}}} 便于查表。"""
    out = {}
    for subject in data["subjects"]:
        out[subject["slug"]] = {
            "name": subject["name"],
            "tracks": subject.get("tracks") or [],
            "branches": {b["slug"]: b["name"] for b in subject.get("branches") or []},
        }
    return out


def legacy_mapping(data: dict, category: str) -> dict | None:
    """历史单层 category → 学科坐标；未收录的分类保持未分级，不做臆测。"""
    return data["legacyCategoryMap"].get(category)


def order_key(subject: str, branch: str | None, index_no: int) -> str:
    """分支内序号：决定「一点点看」的推进顺序，零填充保证字典序即数值序。"""
    return f"{subject}/{branch or 'all'}/{index_no:04d}"


def validate_map(data: dict) -> list[str]:
    """契约文件自身的合法性：重复 slug、悬空引用、越界难度都要在源头拦住。"""
    issues: list[str] = []
    seen: set[str] = set()
    for subject in data["subjects"]:
        slug = subject.get("slug") or ""
        if not slug:
            issues.append("存在 slug 为空的学科")
            continue
        if slug in seen:
            issues.append(f"学科 slug 重复：{slug}")
        seen.add(slug)
        branches = {b["slug"] for b in subject.get("branches") or []}
        if len(branches) != len(subject.get("branches") or []):
            issues.append(f"学科 {slug} 内分支 slug 重复")
        for track in subject.get("tracks") or []:
            if not track.strip():
                issues.append(f"学科 {slug} 有空白标尺名")

    for key, mapping in data["legacyCategoryMap"].items():
        target = mapping.get("subject")
        if target not in seen:
            issues.append(f"分类 {key!r} 指向未知学科 {target!r}")
            continue
        branch = mapping.get("branch")
        if branch and branch not in index(data)[target]["branches"]:
            issues.append(f"分类 {key!r} 指向学科 {target} 不存在的分支 {branch!r}")
        track = mapping.get("track")
        if track and track not in index(data)[target]["tracks"]:
            issues.append(f"分类 {key!r} 指向学科 {target} 未登记的标尺 {track!r}")

    for level in data["levels"]:
        try:
            if int(level) not in LEVEL_RANGE:
                issues.append(f"难度档位越界：{level}")
        except ValueError:
            issues.append(f"难度档位键必须是数字：{level}")
    return issues


def derive(card: dict, data: dict) -> dict:
    """卡片生效的学科坐标：显式字段优先，缺失时按旧 category 派生（与双端一致）。"""
    mapping = legacy_mapping(data, card.get("category") or "") or {}
    return {
        "subject": card.get("subject") or mapping.get("subject"),
        "branch": card.get("branch") or mapping.get("branch"),
        "level": card.get("level"),
        "track": card.get("track") or mapping.get("track"),
        "orderKey": card.get("orderKey"),
    }


def validate_card(card: dict, data: dict) -> list[str]:
    """单卡校验，与双端 `SubjectRegistry.validationIssues` 同口径。"""
    issues: list[str] = []
    subjects = index(data)
    taxonomy = derive(card, data)
    subject, branch, track, level = (
        taxonomy["subject"], taxonomy["branch"], taxonomy["track"], taxonomy["level"])

    if subject and subject not in subjects:
        issues.append(f"未知学科 slug：{subject}")
    elif subject and branch and branch not in subjects[subject]["branches"]:
        issues.append(f"分支 {branch} 不属于学科 {subject}")
    if level is not None and level not in LEVEL_RANGE:
        issues.append(f"难度必须落在 1..5，当前 {level}")
    if track and subject and subjects[subject]["tracks"] and track not in subjects[subject]["tracks"]:
        issues.append(f"标尺 {track} 不在学科 {subject} 的候选里")
    return issues


def distribution(cards: list[dict], data: dict) -> dict:
    """按「学科 / 未分级」统计，供 CI 打印内容覆盖度。"""
    counts: dict[str, int] = {}
    for card in cards:
        subject = derive(card, data)["subject"] or "未分级"
        counts[subject] = counts.get(subject, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))
