#!/usr/bin/env python3
"""把「启明学堂」课程 JSON 批量转换为 KnowFlick 知识卡片，追加到 seed_cards.json。

数据源结构（与 ai-learning-site 的 build 脚本一致）:
    {parts: [{id, title, desc, topics: [{title, desc, lessons: [{file, title, desc, tag, tldr, text}]}]}]}

每条 lesson 生成一张卡片，字段与 AppStore.loadSeedCards() 的 SeedCard 解码结构一致:
    {category, headline, summary, details, links: []}
（id / source / createdAt 由 App 在加载 seed 时补齐，JSON 中不需要。）

用法:
    python3 tools/import_lessons.py
    # 或指定路径:
    python3 tools/import_lessons.py \
        --sources ../ai-learning-site/kj-content.json ../ai-learning-site/ai-content.json \
                  ../ai-learning-site/code-content.json ../ai-learning-site/en-content.json \
        --output Sources/KnowFlick/Resources/seed_cards.json
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# 学科文件 → 卡片分类
CATEGORY_MAP = {
    "kj": "会计",     # 中级会计
    "ai": "科技",     # AI 学堂
    "code": "科技",   # 编程
    "en": "语言",     # 英语
}

# headline 硬限制
MAX_HEADLINE_LEN = 40

# 个别超长标题的手工压缩（保留题干主干，≤40 字）
HEADLINE_OVERRIDES = {
    # kj 自测题（题干含完整数据，超 40 字，压缩掉次要数据）
    "A 产品成本 100 万，预计售价 90 万，估计销售费用及税费 7 万，应计提跌价准备（　）万":
        "产品成本 100 万、预计售价 90 万，应计提跌价准备（　）万",
    "设备原值 100 万、净残值 5 万、年限 5 年，双倍余额递减法第 2 年折旧额（　）万":
        "双倍余额递减法第 2 年折旧额（　）万",
    "自用办公楼转公允模式投资性房地产，公允 800 万、账面 700 万，差额 100 万计入（　）":
        "办公楼转公允模式投资性房地产，差额计入（　）",
    "支付 3000 万取得 30% 股权（重大影响），被投资方可辨认净资产公允价值 11000 万，长期股权投资入账价值（　）万":
        "支付 3000 万取得 30% 股权（重大影响），长投入账价值（　）万",
    "债务人以账面价值 80 万的存货抵偿 100 万债务（存货公允 85 万），债务人确认债务重组收益（　）万":
        "债务人以存货抵偿债务，确认债务重组收益（　）万",
    # ai 标题
    "workflow / schedule / plan / todo：编排原语的取舍":
        "workflow/schedule/plan/todo：编排原语的取舍",
}

SELFTEST = re.compile(r"^答案[:：]", re.M)          # 自测题答案块特征


def load_lessons(path: Path, key: str):
    """读取一个学科 JSON，返回 [(lesson_dict, category), ...]"""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    lessons = [
        lesson
        for part in data["parts"]
        for topic in part["topics"]
        for lesson in topic["lessons"]
    ]
    return [(lesson, CATEGORY_MAP[key]) for lesson in lessons]


def first_sentence(text: str, limit: int = 40) -> str:
    """从 text 首句提炼一句话要点。"""
    t = text.strip().replace("\n", "。")
    for sep in ("。", "；", "！", "？"):
        idx = t.find(sep)
        if idx > 0:
            t = t[: idx + 1]
            break
    return truncate(t, limit)


def truncate(s: str, n: int, ellipsis: str = "") -> str:
    s = s.strip()
    if len(s) <= n:
        return s
    return s[: n - len(ellipsis)] + ellipsis


def compress_headline(title: str) -> str:
    """headline：先用手工表，再走通用压缩，硬性 ≤40 字。"""
    t = title.strip()
    if t in HEADLINE_OVERRIDES:
        t = HEADLINE_OVERRIDES[t]
    if len(t) <= MAX_HEADLINE_LEN:
        return t
    # 通用兜底：去掉空格与括号注释后仍超长 → 按标点截到 ≤40
    t2 = re.sub(r"\s+", "", t)
    t2 = re.sub(r"（[^）]*）", "", t2)
    if len(t2) <= MAX_HEADLINE_LEN:
        return t2
    for sep in ("，", ",", "；", "。", "：", ":"):
        idx = t2.find(sep)
        if 0 < idx <= MAX_HEADLINE_LEN:
            return t2[:idx]
    return truncate(t2, MAX_HEADLINE_LEN, "…")


def format_selftest(text: str) -> str:
    """把「答案：X\\nA. …　B. …\\n解析：…」格式化为易读段落（选项分行、解析单独一段）。"""
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    parts = []
    for ln in lines:
        if re.match(r"^答案[:：]", ln):
            parts.append(ln)
        elif re.match(r"^解析[:：]", ln):
            parts.append(ln)
        elif re.match(r"^[A-Za-z][.、．]", ln):
            options = [o.strip() for o in re.split(r"\u3000+|\s{2,}", ln) if o.strip()]
            parts.append("\n".join(options))
        else:
            parts.append(ln)
    return "\n\n".join(parts)


def selftest_summary(text: str) -> str:
    """自测题副标题：取「解析：」后的要点（≤60 字），无解析则用「答案：X」。"""
    m = re.search(r"解析[:：]\s*(.+)", text)
    if m:
        return truncate(m.group(1).strip(), 60, "…")
    first_line = text.strip().split("\n")[0].strip()
    return truncate(first_line, 40)


def make_card(lesson: dict, category: str) -> dict:
    title = (lesson.get("title") or "").strip()
    tldr = (lesson.get("tldr") or "").strip()
    text = (lesson.get("text") or "").strip()
    is_selftest = bool(SELFTEST.search(text))

    headline = compress_headline(title)
    if not headline:
        headline = truncate(first_sentence(text, 40) if not tldr else tldr, MAX_HEADLINE_LEN)

    if is_selftest:
        summary = selftest_summary(text)
        details = format_selftest(text)
    else:
        summary = tldr if tldr else first_sentence(text, 40)
        details = text

    # 兜底：任一必填字段为空则报错，绝不产出坏卡
    if not summary:
        raise ValueError(f"summary 为空: {title}")
    if not details:
        raise ValueError(f"details 为空: {title}")

    return {
        "category": category,
        "headline": headline,
        "summary": summary,
        "details": details,
        "links": [],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--sources",
        nargs="+",
        default=[
            REPO_ROOT.parent / "ai-learning-site" / "kj-content.json",
            REPO_ROOT.parent / "ai-learning-site" / "ai-content.json",
            REPO_ROOT.parent / "ai-learning-site" / "code-content.json",
            REPO_ROOT.parent / "ai-learning-site" / "en-content.json",
        ],
        help="启明学堂课程 JSON（默认 4 个学科文件）",
    )
    ap.add_argument(
        "--output",
        default=REPO_ROOT / "Sources" / "KnowFlick" / "Resources" / "seed_cards.json",
        help="输出 seed_cards.json 路径",
    )
    args = ap.parse_args()

    sources = [Path(p) for p in args.sources]
    output = Path(args.output)
    if len(sources) != 4:
        ap.error("需要且仅需要 4 个数据源（kj/ai/code/en）")
    for p in sources:
        if not p.exists():
            ap.error(f"数据源不存在: {p}")

    new_cards = []
    for path in sources:
        key = path.name.split("-")[0]
        for lesson, category in load_lessons(path, key):
            new_cards.append(make_card(lesson, category))

    # 读现有种子卡，原样追加
    existing = json.loads(output.read_text(encoding="utf-8"))
    original_count = len(existing)
    existing.extend(new_cards)

    tmp = output.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)
    tmp.replace(output)

    # 输出统计
    from collections import Counter

    stats = Counter(c["category"] for c in existing)
    per_source = {p.name: len(load_lessons(p, p.name.split("-")[0])) for p in sources}
    print(f"原有种子卡: {original_count}")
    print(f"新增卡片:   {len(new_cards)}")
    print(f"总数:       {len(existing)}")
    print("分学科:", {k: v for k, v in sorted(per_source.items())})
    print("分类分布:", dict(stats))

    # 字段校验
    bad_headline = [c["headline"] for c in new_cards if not c["headline"] or len(c["headline"]) > MAX_HEADLINE_LEN]
    bad_summary = [c["headline"] for c in new_cards if not c["summary"]]
    bad_details = [c["headline"] for c in new_cards if not c["details"]]
    assert not bad_headline, f"headline 空/超长: {bad_headline}"
    assert not bad_summary, f"summary 为空: {bad_summary}"
    assert not bad_details, f"details 为空: {bad_details}"
    assert len(existing) == original_count + len(new_cards)

    # 确认原有 30 张未被改动
    reloaded = json.loads(output.read_text(encoding="utf-8"))
    assert reloaded[:original_count] == existing[:original_count]
    print(f"校验通过：headline≤{MAX_HEADLINE_LEN} 字、summary/details 均非空、原有 {original_count} 张原样保留。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
