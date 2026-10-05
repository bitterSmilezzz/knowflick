#!/usr/bin/env python3
"""
把旧面板（Editorial 视觉语言）切换为 Cutline 语言（Insight* 前缀）。

只做「视觉 token 替换」，不改任何业务逻辑、派生计算、手势、快捷键。
Core 层（KnowFlickCore）与已迁移的 Insight* 文件不动。

映射依据：InsightDesignSystem.swift 的 token 定义。
"""
import re
import sys
import pathlib

VIEWS = pathlib.Path("/Users/fangshoufanji/workspace/02-AI开发/ai-test/KnowFlick/apps/mac/Sources/KnowFlick/Views")

# 已迁移到 Insight 体系的新文件，跳过
SKIP = {
    "InsightDesignSystem.swift",
    "InsightComponents.swift",
    "InsightShell.swift",
    "InsightCardView.swift",
    "InsightMainView.swift",
    "InsightPlaceholderViews.swift",
}

# 颜色映射：EditorialColor.X -> InsightColor.Y
COLOR_MAP = {
    "canvasDark": "canvas",
    "canvasGradientTop": "canvas",
    "canvasGradientBottom": "canvas",
    "canvasGradient": "canvas",
    "panelBackground": "surfaceRaised",
    "glassSurface": "surface",
    "glassSurfaceHover": "surfaceRaised",
    "glassSurfaceActive": "surfaceRaised",
    "glassBorder": "border",
    "glassBorderHover": "borderStrong",
    "glassDivider": "divider",
    "fieldBorder": "borderStrong",
    "fieldBorderFocused": "textPrimary",
    "textPrimary": "textPrimary",
    "textSecondary": "textSecondary",
    "textTertiary": "textTertiary",
    "textMuted": "textMuted",
    "cardTextPrimary": "cardTextPrimary",
    "cardTextSecondary": "cardTextSecondary",
    "cardTextTertiary": "cardTextTertiary",
    "cardTextMuted": "cardTextMuted",
    "likeGreen": "success",
    "dislikeRed": "danger",
    "skipGray": "neutral",
    "aiAmber": "warning",
    "aiAmberBg": "warningSoft",
    "aiAmberBorder": "warning",
    "detailBlue": "accent",
}

# 字体映射：EditorialFont.X -> InsightFont.Y
FONT_MAP = {
    "heroHeadline": "largeTitle",
    "detailHeadline": "title",
    "modalTitle": "title",
    "sectionTitle": "headline",
    "statFigure": "statLarge",
    "statFigureSmall": "statMedium",
    "bodySerif": "body",
    "summarySerif": "body",
    "label": "bodyStrong",
    "labelSmall": "callout",
    "badge": "callout",
    "caption": "caption",
    "captionSmall": "captionSmall",
}

# 弹簧映射：EditorialSpring.X -> InsightMotion.Y
SPRING_MAP = {
    "micro": "card",
    "state": "pill",
    "content": "shell",
    "motion": "page",
    "standard": "value",
    "exit": "value",
}

RADIUS_MAP = {
    "card": "card",
    "modal": "card",
    "container": "inset",
    "pill": "pill",
    "control": "control",
}


def migrate(path: pathlib.Path) -> int:
    text = path.read_text()
    original = text

    # EditorialColor.dynamic(...) -> InsightColor.dynamic(...)（保留参数）
    text = text.replace("EditorialColor.dynamic", "InsightColor.dynamic")
    # EditorialColor.X -> InsightColor.Y
    for old, new in COLOR_MAP.items():
        text = re.sub(rf"\bEditorialColor\.{old}\b", f"InsightColor.{new}", text)
    # 兜底：未列出的 EditorialColor.* 统一映射到 textSecondary
    text = re.sub(r"\bEditorialColor\.\w+", "InsightColor.textSecondary", text)

    # EditorialFont.X -> InsightFont.Y
    for old, new in FONT_MAP.items():
        text = re.sub(rf"\bEditorialFont\.{old}\b", f"InsightFont.{new}", text)
    text = re.sub(r"\bEditorialFont\.\w+", "InsightFont.body", text)

    # EditorialSpring.X -> InsightMotion.Y
    for old, new in SPRING_MAP.items():
        text = re.sub(rf"\bEditorialSpring\.{old}\b", f"InsightMotion.{new}", text)
    text = re.sub(r"\bEditorialSpring\.\w+", "InsightMotion.card", text)

    # EditorialRadius.X -> InsightRadius.Y
    for old, new in RADIUS_MAP.items():
        text = re.sub(rf"\bEditorialRadius\.{old}\b", f"InsightRadius.{new}", text)
    text = re.sub(r"\bEditorialRadius\.\w+", "InsightRadius.control", text)

    # EditorialSpacing.X -> InsightSpacing.X（同名，换前缀即可）
    text = re.sub(r"\bEditorialSpacing\.(\w+)", r"InsightSpacing.\1", text)

    if text != original:
        path.write_text(text)
        return 1
    return 0


def main():
    targets = sys.argv[1:]
    if not targets:
        print("usage: migrate_panels.py <ViewFile.swift> ...")
        return
    changed = 0
    for name in targets:
        p = VIEWS / name
        if not p.exists():
            print(f"skip (not found): {name}")
            continue
        if name in SKIP:
            print(f"skip (already Insight): {name}")
            continue
        if migrate(p):
            changed += 1
            print(f"migrated: {name}")
        else:
            print(f"no change: {name}")
    print(f"--- {changed} file(s) changed ---")


if __name__ == "__main__":
    main()
