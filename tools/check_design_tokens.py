#!/usr/bin/env python3
"""界面设计令牌与规格守卫（docs/UI_DESIGN_SPEC_2026-10-19.md）。

为什么要有这个守卫：规格 §3 写死了「圆角只用 4px（控件）/ 8px（面板），
删除现有 6/7/9/10/12/20px」，但代码里长期散着 6px，而且没人发现——因为
**没有任何东西在守它**。同理还有三个反复出现的漂移：

1. **未定义的颜色令牌**：`var(--paper)`（我新加页面时用过）、`var(--fg)`
   （无 fallback，等于颜色失效）、`var(--danger)`（无 fallback）。
   令牌表在 `tokens.css`，不在那里的变量一律视为未定义。
2. **裸 `--accent` 当文字色**：系统 AccentColor 在浅色模式下约 3.4:1，
   14px 正文不达 WCAG AA 4.5；文字链接必须用压深后的 `--accent-text`。
3. **Markdown 语法漏进纯文本**：`<p>` 里的 `**加粗**` 会原样显示 `**`——
   界面文案里出现标记符号。

检查范围：工作台的 CSS 与 TSX 源码。静态扫描，不解析 CSS AST。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKBENCH = ROOT / "apps/workbench/src/ui/workspace"
TOKENS = WORKBENCH / "tokens.css"

sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402

# 规格 §3 允许的圆角：控件 4px、面板 8px。
# 白名单例外：药丸（999px）、圆形（50%）、无圆角（0）、装饰细条（2px）。
ALLOWED_RADII = {"4px", "8px", "999px", "50%", "0", "2px"}
# 原生药丸形态，不属于「控件圆角」范畴：
# - 滚动条滑块（webkit 惯例）
# - 开关滑块（macOS 开关本身就是药丸；用 4px 会变成方块，与平台原生不符）
NATIVE_PILL_RULES = ("::-webkit-scrollbar-thumb", ".ws-switch-slider")
# 令牌里定义的变量之外，还有 JS 注入的布局宽度（style={{"--nav-w": …}}）。
JS_INJECTED_VARS = {"--nav-w", "--list-w"}

# 纯文本语境里出现 ** 会原样显示——这些容器不解析 Markdown。
PLAIN_TEXT_TAGS = ("<p", "<span", "<div", "<h1", "<h2", "<h3", "<li", "<td", "<label")


def defined_tokens() -> set[str]:
    text = TOKENS.read_text(encoding="utf-8")
    return set(re.findall(r"^\s*(--[a-z0-9-]+)\s*:", text, re.MULTILINE))


def check(problems: list[str]) -> list[str]:
    tokens = defined_tokens()
    allowed_tokens = tokens | JS_INJECTED_VARS

    # ---- 1. 圆角只允许 4px / 8px（加白名单例外）----
    # 属性常与选择器分行，所以要跟踪当前所处的规则块。
    for css in sorted(WORKBENCH.glob("*.css")):
        lines = css.read_text(encoding="utf-8").splitlines()
        current_selector = ""
        for lineno, line in enumerate(lines, start=1):
            sel = re.match(r"^([^@}\s][^{]*)\{\s*$", line.strip())
            if sel:
                current_selector = sel.group(1).strip()
            m = re.search(r"border-radius:\s*([^;]+);", line)
            if not m:
                continue
            # 原生药丸形态整体放行（选择器或本行命中都算）
            if any(rule in line or rule in current_selector for rule in NATIVE_PILL_RULES):
                continue
            value = m.group(1).strip()
            if value.startswith("var("):
                continue  # 令牌化的圆角由 tokens.css 决定
            if value not in ALLOWED_RADII:
                problems.append(
                    f"{css.relative_to(ROOT)}:{lineno} 圆角 {value}（{current_selector or '?'}）——"
                    "规格 §3 只允许 4px（控件）/ 8px（面板）"
                    "（药丸 999px、圆形 50%、装饰细条 2px 除外）"
                )

    # ---- 2. 不得使用未定义的颜色令牌 ----
    for css in sorted(WORKBENCH.glob("*.css")):
        for lineno, line in enumerate(css.read_text(encoding="utf-8").splitlines(), start=1):
            for var in re.findall(r"var\(\s*(--[a-z0-9-]+)\s*([,)])", line):
                name, tail = var
                if name not in allowed_tokens:
                    problems.append(
                        f"{css.relative_to(ROOT)}:{lineno} 用了未定义的令牌 {name}"
                        + ("（且无 fallback——颜色实际失效）" if tail == ")" else "")
                    )

    # ---- 3. 裸 --accent 不得当文字色 ----
    for css in sorted(WORKBENCH.glob("*.css")):
        for lineno, line in enumerate(css.read_text(encoding="utf-8").splitlines(), start=1):
            # 只看真正的 color 属性——accent-color / border-color / background-color
            # 里都含 "color:"，用负向断言排掉前缀。
            if re.search(r"(?<![\w-])color:\s*var\(\s*--accent\s*\)", line):
                problems.append(
                    f"{css.relative_to(ROOT)}:{lineno} 裸 --accent 当文字色——系统强调色浅色模式下约 3.4:1，"
                    "不达 AA 4.5；文字请用 --accent-text"
                )

    # ---- 4. 错误色不得写死（深色模式要能提亮）----
    # 硬编码 #b3261e 在深色底上偏暗、对比度不足；令牌 --danger 已按浅/深两档定义。
    for css in sorted(WORKBENCH.glob("*.css")):
        if css.name == "tokens.css":
            continue  # 令牌定义处当然要写值
        for lineno, line in enumerate(css.read_text(encoding="utf-8").splitlines(), start=1):
            if re.search(r"#b3261e\b", line, re.IGNORECASE):
                problems.append(
                    f"{css.relative_to(ROOT)}:{lineno} 错误色写死为 #b3261e——"
                    "请用 var(--danger)（深色模式会提亮，硬编码在深底上对比度不足）"
                )

    # ---- 5. 字号不得小于 12px（规格 §2「最小 12px，不再出现 8–11px」）----
    for css in sorted(WORKBENCH.glob("*.css")):
        for lineno, line in enumerate(css.read_text(encoding="utf-8").splitlines(), start=1):
            m = re.search(r"font-size:\s*(\d+)px", line)
            if m and int(m.group(1)) < 12:
                problems.append(
                    f"{css.relative_to(ROOT)}:{lineno} 字号 {m.group(1)}px——规格 §2 最小 12px"
                )

    # ---- 6. 纯文本语境里的 Markdown 标记 ----
    for tsx in sorted(WORKBENCH.glob("*.tsx")):
        if tsx.name.endswith(".test.tsx"):
            continue
        lines = tsx.read_text(encoding="utf-8").splitlines()
        for lineno, line in enumerate(lines, start=1):
            if "**" not in line:
                continue
            stripped = line.strip()
            # 注释行与 Markdown 渲染器自身不算
            if stripped.startswith(("//", "*", "/*")):
                continue
            if "MarkdownRenderer" in line or "noteReference" in line:
                continue
            # 只有落在纯文本容器里的 ** 才会原样显示
            if any(tag in line for tag in PLAIN_TEXT_TAGS):
                problems.append(
                    f"{tsx.relative_to(ROOT)}:{lineno} 纯文本里出现 Markdown 标记 **——"
                    "界面会原样显示星号，请去掉标记或改用 Markdown 渲染"
                )
    return problems


def main() -> int:
    problems = check([])
    if problems:
        emit("界面设计令牌有出入：")
        for p in problems:
            emit(f"  - {p}")
        emit("")
        emit("（共 %d 处）" % len(problems))
        return 1
    emit(
        "设计令牌检查通过：圆角只用 4px/8px、颜色令牌都已定义、文字色不用裸 accent、"
        "错误色走令牌、字号不小于 12px、纯文本里没有 Markdown 标记。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
