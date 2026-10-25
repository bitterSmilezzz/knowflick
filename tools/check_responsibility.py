#!/usr/bin/env python3
"""职责收口的静态守卫（T11，审计 KF-014）。

审计的结论：保存、备份与副作用由多处编排，改一处牵连另一处。这里把
「哪些决定只能有一处做」写成断言——将来有人再把规则抄一份到界面里，
守卫会报红。

为什么放 Python 而不是前端单测：这些检查要读源码，就得用 `node:fs`，
而前端 tsconfig 没有 Node 类型（`tsc --noEmit` 会红）。仓库里已有好几个
同类的 Python 守卫（check_source_labels / check_user_facing_content …）。

检查项：
1. 恢复规则只有一个入口：界面不自己判断哪些条目该恢复；
2. 备份采集只有一个入口：顶栏与设置页共用一份快照与一份回执判定；
3. 恢复失败文案只有一个判定入口：界面不再各写一套「未受影响」；
4. 笔记保存由会话拥有：界面不再自己维护修订基线；
5. 纯规则模块不依赖 Tauri 宿主：规则与 DTO 不从 shell/store 取。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/workbench/src"
DOMAIN = SRC / "domain"
UI = SRC / "ui" / "workspace"
WORKSPACE = UI / "Workspace.tsx"
NOTES_VIEW = UI / "NotesView.tsx"
COLLECT = UI / "backupCollect.ts"
BACKUP_RESTORE = UI / "backupRestore.ts"

sys.path.insert(0, str(ROOT / "tools"))
from windows_console import emit  # noqa: E402

# 纯规则模块：不碰模型/存储的那些。规则与 DTO 不该从宿主拿。
PURE_RULE_MODULES = [
    "note.ts",
    "noteReference.ts",
    "restoreRules.ts",
    "reviewFacts.ts",
    "nearDuplicate.ts",
    "importReport.ts",
]

# 「恢复该放回哪些条目」的判定函数——只在恢复编排层里用一次
RESTORE_RULE_CALLS = ["restorableMaterials", "restorableCards", "restorableArtifacts"]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def code_lines(text: str) -> list[str]:
    """去掉整行注释——注释里提到旧说法不算违规。"""
    return [line for line in text.splitlines() if not line.strip().startswith("//")]


def check(problems: list[str]) -> list[str]:
    # 1. 恢复规则只有一个入口
    rules = read(DOMAIN / "restoreRules.ts")
    for fn in RESTORE_RULE_CALLS:
        if fn not in rules:
            problems.append(f"domain/restoreRules.ts 里没有 {fn}——恢复规则应当集中在这里")
    for file in sorted(UI.glob("*.ts")) + sorted(UI.glob("*.tsx")):
        if file.name in {"backupRestore.ts"} or ".test." in file.name:
            continue
        text = read(file)
        for fn in RESTORE_RULE_CALLS:
            if fn in text:
                problems.append(f"{file.name} 直接调用了 {fn}——恢复规则应只在恢复编排层里用一次")

    # 2. 备份采集与回执只有一个入口
    workspace = read(WORKSPACE)
    if "collectBackupSnapshot" not in workspace:
        problems.append("Workspace.tsx 没有走 collectBackupSnapshot——导出必须走权威采集入口")
    if "export function backupReceipt" not in read(COLLECT):
        problems.append("backupCollect.ts 里没有 backupReceipt——导出回执判定应当只有一处")
    for literal in ("已导出完整备份包", "已导出**部分**备份包"):
        if literal in workspace:
            problems.append(f"Workspace.tsx 里出现了导出回执字面量「{literal}」——判定应当在 backupCollect 一处")

    # 3. 恢复失败文案只有一个判定入口
    visible = "\n".join(code_lines(workspace))
    if "本地内容未受影响" in visible:
        problems.append(
            "Workspace.tsx 里仍然对用户说「本地内容未受影响」——写入中途失败时这句话是假的，"
            "应当只保留「尚未写入任何内容」（写入之前失败）"
        )
    if "尚未写入任何内容" not in visible:
        problems.append("Workspace.tsx 里没有「尚未写入任何内容」——写入前失败要如实说明")

    # 4. 笔记保存由会话拥有
    view = read(NOTES_VIEW)
    if "NoteSession" not in view:
        problems.append("NotesView.tsx 没有用 NoteSession——保存状态不该由界面自己维护")
    if "savedRevision" in view:
        problems.append("NotesView.tsx 里还有 savedRevision——修订基线属于会话，不属于界面")

    # 5. 纯规则模块不依赖宿主
    for name in PURE_RULE_MODULES:
        path = DOMAIN / name
        if not path.exists():
            continue
        text = read(path)
        if "shell/store" in text:
            problems.append(f"domain/{name} 引了 shell/store——纯规则模块不该依赖宿主模块")

    return problems


def main() -> int:
    problems = check([])
    if problems:
        emit("职责边界有出入：")
        for p in problems:
            emit(f"  - {p}")
        emit("")
        emit("（共 %d 处）" % len(problems))
        return 1
    emit("职责边界检查通过：恢复/备份/保存的规则各只有一处入口，纯规则模块不依赖宿主。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
