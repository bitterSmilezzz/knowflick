#!/usr/bin/env python3
"""核对「当前状态」类文档里的数字与实际是否相符。

# 改这个文件应当触发 CI（路径过滤里列了它）——这一行就是验证用的。

背景：这轮手工核对时发现 README / UI_CONSOLIDATION 写着的门禁内容与实际
已经差了好几轮（文档说「npm test + tsc + cargo test」，实际还有 MCP、
来源矩阵、taste gate 与 13 套浏览器冒烟）。这类漂移靠人查迟早会再犯。

范围只管**描述当前状态的文档**——CHANGELOG 记的是「当时的事实」，
历史条目的数字本来就不该跟着变，不在检查范围内。

检查项：
1. 文档里写的「前端 N 项」「Rust N 项」与实际跑出来的数量一致；
2. 文档里写的「N 套浏览器冒烟」与 tools/ 下 *_smoke.mjs 的实际套数一致；
3. 文档里提到的命令行脚本确实存在。

退出码 0 = 全部相符；1 = 有漂移。
"""

from __future__ import annotations

from pathlib import Path

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 只检查这些：它们描述的是「现在是什么样」，不是历史。
CURRENT_STATE_DOCS = [
    "README.md",
    "AGENTS.md",
    "docs/MULTI_PLATFORM.md",
    "docs/UI_CONSOLIDATION.md",
    "docs/FIRST_VERSION_ACCEPTANCE.md",
    "docs/DATA_EGRESS.md",
    "docs/WINDOWS_ONBOARDING.md",
]

# 描述「当前状态」的措辞——带这些词的行才拿来核对。
CURRENT_MARKERS = ("门禁", "当前", "现在", "全量回归", "验证")


def count_frontend_tests() -> int | None:
    """从前端测试文件里数出测试用例数（it/test 声明）。"""
    total = 0
    for path in (ROOT / "apps/workbench/src").rglob("*.test.ts*"):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        total += len(re.findall(r"\b(?:it|test)\s*\(", text))
    return total or None


def count_rust_tests() -> int | None:
    """数 Rust 的 #[test] 数量。"""
    total = 0
    for path in (ROOT / "apps/workbench/src-tauri/src").rglob("*.rs"):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        total += len(re.findall(r"#\[(?:tokio::)?test\]", text))
    return total or None


def count_smoke_suites() -> int:
    """**浏览器**冒烟的套数。

    以 tools/run_all_smokes.sh 的 SUITES 列表为准——那是真正被跑的一组。
    不能直接数 tools/*_smoke.mjs：mcp_smoke 与 mcp_server_smoke 不需要浏览器，
    已在门禁里单独跑，不属于「浏览器冒烟」。
    """
    runner = ROOT / "tools/run_all_smokes.sh"
    if not runner.exists():
        return 0
    text = runner.read_text(encoding="utf-8")
    match = re.search(r"SUITES=\((.*?)\)", text, re.S)
    if not match:
        return 0
    return len(re.findall(r"^\s+[a-z_]+$", match.group(1), re.M))


def emit(text: str) -> None:
    """打印一段可能含中文的文本。

    Windows 控制台默认 cp1252，直接 print 中文会 UnicodeEncodeError
    （实测在 Windows CI 上把门禁打红了）。所以按 UTF-8 写字节，绕开编码器。
    """
    try:
        print(text)
    except UnicodeEncodeError:
        import sys
        sys.stdout.buffer.write(text.encode("utf-8", errors="replace") + b"\n")
        sys.stdout.flush()


def gate_contents() -> str:
    """门禁脚本的全文——用来核对「在门禁里」这类说法。"""
    gate = ROOT / "tools/verify_workbench.sh"
    return gate.read_text(encoding="utf-8") if gate.exists() else ""


def check_gate_claims(problems: list[str]) -> None:
    """文档说某个检查「在门禁里」，门禁里就得真的有它。

    反过来的漂移我踩过：验收清单写「taste gate 未纳入门禁」，而它早就接进去了。
    """
    gate = gate_contents()
    if not gate:
        return
    for rel in CURRENT_STATE_DOCS:
        path = ROOT / rel
        if not path.exists():
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "在门禁里" not in line and "已纳入门禁" not in line:
                continue
            # 只核对**紧挨着「在门禁里」的那个**脚本名——
            # 一行里可能提到好几个脚本，别的未必声称在门禁里。
            for match in re.finditer(
                r"([a-z0-9_]+\.(?:mjs|py))[^。；;]{0,12}?在门禁里", line
            ):
                script = match.group(1)
                if script not in gate:
                    problems.append(
                        f"{rel}:{lineno} 说「{script} 在门禁里」，但 verify_workbench.sh 里没有它"
                    )


# 已修缺陷 → 证据测试。回归防护的**自我审查**：
# 缺陷修好后，它的测试可能��后来某次改动里被改弱或删掉——那时缺陷就悄悄回来了。
# 这张表把「缺陷」和「证据」绑在一起，证据不在了就报警。
EVIDENCE_MAP: list[tuple[str, str, str]] = [
    ("压缩 PDF 解析出源码", "apps/workbench/src/domain/fixtures.test.ts", "FlateDecode"),
    ("浏览器不给 MIME 时 JPEG 存成 png", "apps/workbench/src/domain/mediaMime.test.ts", "imageMimeOf"),
    ("订阅源相对链接", "apps/workbench/src/domain/fixtures.test.ts", "相对链接"),
    ("AI 错误回显密钥", "apps/workbench/src/shell/store.redact.test.ts", "不该回显"),
    ("Embedding 错误回显密钥", "apps/workbench/src-tauri/src/http.rs", "embeddings_api_error"),
    ("导出包带走密钥", "apps/workbench/src/domain/dataEgress.test.ts", "SENTINEL"),
    ("归档被当成讨厌来源", "apps/workbench/src/domain/insights.test.ts", "归档"),
    ("恢复丢弃空标题", "apps/workbench/src/domain/restoreRules.test.ts", "空标题"),
    ("模型输出带引用编号", "apps/workbench/src/domain/ingest.aiPreview.test.ts", "引用编号"),
    ("details 折叠失效", "tools/taste_usability_gate.mjs", "最后一行完整可见"),
    ("侧栏四段约定", "tools/taste_usability_gate.mjs", "四段主线分组"),
    ("一级入口数", "tools/taste_usability_gate.mjs", "一级入口"),
    ("测验入口", "tools/workspace_ui_smoke.mjs", "知识测验"),
    ("测验空态措辞", "tools/workspace_ui_smoke.mjs", "没有可以测验的知识卡"),
    ("统计页", "tools/workspace_ui_smoke.mjs", "统计页"),
    (".eml 导入", "tools/import_ui_smoke.mjs", "eml"),
    ("AI 出卡链路", "tools/workspace_ui_smoke.mjs", "AI 提炼"),
    ("数据库损坏报错", "apps/workbench/src-tauri/src/db.rs", "数据库已损坏"),
    ("Anki TSV 两端同格式", "apps/android/shared-data/src/jvmTest/kotlin/com/knowflick/app/data/CardExportEngineTest.kt", "exportAnkiTSV"),
    ("来源矩阵", "apps/workbench/src/ui/workspace/sourceMatrix.test.ts", "来源矩阵"),
    # —— 以下为第二批补齐的证据 ——
    ("复习闭环：间隔算出来并存住", "tools/review_ui_smoke.mjs", "重载后复习间隔仍在"),
    ("搜索无结果没有清空入口", "tools/workspace_ui_smoke.mjs", "clear-search"),
    ("MCP 服务器没有回归", "tools/mcp_smoke.mjs", "MCP smoke"),
    ("MCP 工具自身回归", "apps/workbench/src/domain/mcpServer.test.ts", "mcpServer"),
    ("跨端导入丢精度（间隔被改写）", "apps/android/shared-data/src/jvmTest/kotlin/com/knowflick/app/data/WorkbenchExportImportTest.kt", "WorkbenchExportImport"),
    ("跨端契约 cards.json", "apps/android/domain/src/jvmTest/kotlin/com/knowflick/app/domain/CardJsonCrossEndTest.kt", "CrossEnd"),
    ("统计页没有入口", "apps/workbench/src/ui/workspace/StatsView.tsx", "StatsView"),
    ("笔记转知识卡没有入口", "apps/workbench/src/domain/notes.test.ts", "parseNotesFile"),
    ("操作音效开关只存不用", "apps/workbench/src/shell/sounds.test.ts", "setSoundEffectsEnabled"),
    ("批量栏缺导出选中", "tools/workspace_ui_smoke.mjs", "导出选中"),
    ("规模 4000 条下的交互", "tools/scale_ui_smoke.mjs", "逐字输入"),
    ("产物看不到依据哪几张卡", "tools/brain_ui_smoke.mjs", "能看见依据的具体卡片"),
    ("已保存的产物对问答不可见", "tools/brain_ui_smoke.mjs", "产物标题或结论出现在回答依据里"),
    ("问答引用指向已删除的卡片", "tools/brain_ui_smoke.mjs", "已删除的引用要标出来"),
    ("订阅来源在收件箱认不出来", "apps/workbench/src/domain/subscription.test.ts", "subscriptionId"),
    ("两个隐藏 input 缺 data-role", "tools/import_ui_smoke.mjs", "data-role=import-files"),
    ("数据库损坏时只甩英文错误", "apps/workbench/src-tauri/src/db.rs", "数据库已损坏"),
]


def check_evidence(problems: list[str]) -> None:
    """每条已修缺陷都要还有证据测试。"""
    for label, rel, needle in EVIDENCE_MAP:
        path = ROOT / rel
        if not path.exists():
            problems.append(f"「{label}」的证据文件没了：{rel}")
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if needle not in text:
            problems.append(f"「{label}」的证据在 {rel} 里找不到「{needle}」——测试可能被改弱了")


def check_evidence_is_executed(problems: list[str]) -> None:
    """证据测试**确实会被执行**。

    「文件里有断言」不够——它还得真的被跑：
    - 浏览器冒烟要在 run_all_smokes 的列表里（或门禁单独调），否则永远不跑；
    - Android 测试的模块要被 CI 显式点名（AGENTS.md 记着：漏了会静默少跑）；
    - 前端单测要在 vitest 的收集范围（apps/workbench/src）里。
    """
    runner = (ROOT / "tools/run_all_smokes.sh").read_text(encoding="utf-8")
    gate = gate_contents()
    ci = (ROOT / ".github/workflows/android.yml").read_text(encoding="utf-8")

    for label, rel, _needle in EVIDENCE_MAP:
        if not rel.endswith((".mjs", ".kt", ".test.ts", ".test.tsx")):
            continue  # 实现文件（.ts/.rs）本身不是「测试」
        if rel.endswith(".mjs"):
            name = Path(rel).stem
            if name not in runner and name not in gate:
                problems.append(
                    f"「{label}」的证据 {rel} 不会被执行：既不在 run_all_smokes.sh 也不在门禁里"
                )
        elif rel.endswith(".kt"):
            module = rel.split("apps/android/")[1].split("/")[0]
            if f":{module}:jvmTest" not in ci and f":{module}:test" not in ci:
                problems.append(
                    f"「{label}」的证据 {rel} 所在模块 {module} 没被 CI 点名，不会被跑"
                )
        else:
            if "apps/workbench/src/" not in rel:
                problems.append(f"「{label}」的证据 {rel} 不在 vitest 的收集范围内")


def main() -> int:
    problems: list[str] = []

    frontend = count_frontend_tests()
    rust = count_rust_tests()
    smokes = count_smoke_suites()

    for rel in CURRENT_STATE_DOCS:
        path = ROOT / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), start=1):
            if not any(marker in line for marker in CURRENT_MARKERS):
                continue

            # 「前端 N 项」
            for match in re.finditer(r"前端\s*(\d+)\s*项", line):
                claimed = int(match.group(1))
                if frontend and claimed != frontend:
                    problems.append(
                        f"{rel}:{lineno} 说「前端 {claimed} 项」，实际 {frontend} 项"
                    )
            # 「Rust N 项」**不核对**：Rust 测试里有 #[cfg(target_os = "macos")] /
            # #[cfg(unix)] 这类平台门，三端跑出来的数量本来就不一样
            # （实测 macOS 87 项 / Windows 84 项）。文档写一个数必然有一端对不上，
            # 所以只提示、不报错。
            for match in re.finditer(r"Rust\s*(\d+)\s*项", line):
                claimed = int(match.group(1))
                if rust and claimed != rust:
                    emit(
                        f"  提示 {rel}:{lineno} 的「Rust {claimed} 项」与本机 {rust} 项不同"
                        "（三端数量本就不同，不算漂移）"
                    )
            # 「N 套浏览器冒烟」
            for match in re.finditer(r"(\d+)\s*套浏览器冒烟", line):
                claimed = int(match.group(1))
                if claimed != smokes:
                    problems.append(
                        f"{rel}:{lineno} 说「{claimed} 套浏览器冒烟」，实际 {smokes} 套"
                    )

    # 文档提到的脚本必须存在——但「已随某端删除」这类**历史说明**不算。
    deleted_note = re.compile(r"(已.{0,6}删除|已.{0,6}移除|不存在)")
    for rel in CURRENT_STATE_DOCS:
        path = ROOT / rel
        if not path.exists():
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not any(marker in line for marker in CURRENT_MARKERS):
                continue
            for script in re.findall(r"tools/([a-z0-9_]+\.(?:mjs|py|sh|swift))", line):
                if (ROOT / "tools" / script).exists():
                    continue
                if deleted_note.search(line):
                    continue  # 这是「该脚本已删除」的历史说明
                problems.append(f"{rel}:{lineno} 提到 tools/{script}，但该文件不存在")

    check_gate_claims(problems)
    check_evidence(problems)
    check_evidence_is_executed(problems)

    if problems:
        emit("文档与实际有出入：")
        for item in problems:
            emit(f"  - {item}")
        emit(f"\n（共 {len(problems)} 处）")
        return 1

    emit(
        f"文档与实际一致：前端 {frontend} 项、Rust {rust} 项、{smokes} 套浏览器冒烟，"
        f"文档里提到的脚本都存在，{len(EVIDENCE_MAP)} 条已修缺陷的证据测试都在"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
