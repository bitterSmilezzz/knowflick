#!/usr/bin/env python3
"""学科契约的 CI 守门：契约文件自洽、种子卡合法、双端内嵌表与契约逐条一致。

用法：
    python3 tools/check_taxonomy.py                     # 校验默认路径
    python3 tools/check_taxonomy.py --strict-map        # 额外要求每个学科都有卡（内容覆盖度告警）

退出码非 0 表示发现问题，CI 直接红。双端 Swift/Kotlin 的等价测试只保证「各自 == 契约」，
这里补上「契约自身合法」和「种子内容合法」——否则非法内容要等 App 运行时才暴露。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import taxonomy

REPO_ROOT = Path(__file__).resolve().parent.parent

SWIFT_REGISTRY = REPO_ROOT / "apps/mac/Sources/KnowFlickCore/Models/SubjectRegistry.swift"
KOTLIN_REGISTRY = REPO_ROOT / "apps/android/app/src/main/kotlin/com/knowflick/app/domain/SubjectRegistry.kt"


def check_regilities(data: dict) -> list[str]:
    return taxonomy.validate_map(data)


def check_embedded_tables(data: dict) -> list[str]:
    """三处事实来源（契约 JSON、Swift、Kotlin）必须给出同一串学科与同一批分支。

    逐学科的归属关系由两端各自的 parity 测试保证（它们会构造完整对象比对）；
    这里做的是更粗但更早的一层：总量与顺序不一致时，连编译/测试都不用等就能看到差异。
    """
    issues: list[str] = []
    expected_subjects = [subject["slug"] for subject in data["subjects"]]
    expected_branches = sorted(
        branch["slug"] for subject in data["subjects"] for branch in (subject.get("branches") or [])
    )

    swift_text = SWIFT_REGISTRY.read_text(encoding="utf-8")
    kotlin_text = KOTLIN_REGISTRY.read_text(encoding="utf-8")

    swift_subjects = re.findall(r'SubjectSpec\(slug:\s*"([^"]+)"', swift_text)
    kotlin_subjects = re.findall(r'SubjectSpec\(\s*"([^"]+)"', kotlin_text)
    if swift_subjects != expected_subjects:
        issues.append(f"mac 端学科表与契约不一致：{swift_subjects} != {expected_subjects}")
    if kotlin_subjects != expected_subjects:
        issues.append(f"Android 端学科表与契约不一致：{kotlin_subjects} != {expected_subjects}")

    swift_branches = sorted(re.findall(r'BranchSpec\(slug:\s*"([^"]+)"', swift_text))
    kotlin_branches = sorted(re.findall(r'BranchSpec\("([^"]+)"', kotlin_text))
    if swift_branches != expected_branches:
        issues.append(f"mac 端分支条目与契约不一致：缺 {set(expected_branches) - set(swift_branches)}"
                      f"，多 {set(swift_branches) - set(expected_branches)}")
    if kotlin_branches != expected_branches:
        issues.append(f"Android 端分支条目与契约不一致：缺 {set(expected_branches) - set(kotlin_branches)}"
                      f"，多 {set(kotlin_branches) - set(expected_branches)}")

    # 历史映射表：三处的键集合必须完全相同
    expected_legacy = sorted(data["legacyCategoryMap"].keys())
    swift_legacy = sorted(re.findall(r'"([^"]+)":\s*LegacyMapping\(subject:', swift_text))
    kotlin_legacy = sorted(re.findall(r'"([^"]+)"\s+to LegacyMapping\(', kotlin_text))
    if swift_legacy != expected_legacy:
        issues.append(f"mac 端历史分类映射与契约不一致：{set(expected_legacy) ^ set(swift_legacy)}")
    if kotlin_legacy != expected_legacy:
        issues.append(f"Android 端历史分类映射与契约不一致：{set(expected_legacy) ^ set(kotlin_legacy)}")
    return issues


def check_seed(seed_path: Path, data: dict, strict_map: bool) -> tuple[list[str], dict]:
    cards = json.loads(seed_path.read_text(encoding="utf-8"))
    issues: list[str] = []
    for card in cards:
        for problem in taxonomy.validate_card(card, data):
            issues.append(f"{card.get('headline', '?')[:24]}：{problem}")
    if strict_map:
        covered = {taxonomy.derive(card, data)["subject"] for card in cards}
        for subject in [s["slug"] for s in data["subjects"]]:
            if subject not in covered:
                issues.append(f"学科 {subject} 一张卡都没有（内容覆盖度不足）")
    return issues, taxonomy.distribution(cards, data)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--map", default=str(taxonomy.DEFAULT_MAP), help="taxonomy_map.json 路径")
    ap.add_argument("--seed", default=str(REPO_ROOT / "shared/assets/seed_cards.json"), help="种子卡路径")
    ap.add_argument("--strict-map", action="store_true", help="要求每个学科都至少有一张卡")
    args = ap.parse_args()

    data = taxonomy.load_map(Path(args.map))
    issues = check_regilities(data)
    if not issues:
        issues += check_embedded_tables(data)
    seed_issues, distribution = check_seed(Path(args.seed), data, args.strict_map)
    issues += seed_issues

    print("学科内容分布:", json.dumps(distribution, ensure_ascii=False))
    ungraded = distribution.get("未分级", 0)
    print(f"未分级卡片: {ungraded}（历史内容允许未分级，分级由导入管道逐步补齐）")

    if issues:
        print(f"\n发现 {len(issues)} 个问题：", file=sys.stderr)
        for issue in issues[:40]:
            print(f"  - {issue}", file=sys.stderr)
        if len(issues) > 40:
            print(f"  …另有 {len(issues) - 40} 条", file=sys.stderr)
        return 1
    print("学科契约校验通过：契约自洽、双端内嵌表一致、种子卡合法。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
