#!/usr/bin/env python3
"""核对 Tauri 命令的三处清单必须一致。

背景：Tauri v2 里自定义命令要在**两个地方**声明，缺一个就出问题：

1. `src-tauri/build.rs` 的 `AppManifest::new().commands(&[...])`
   —— 决定 tauri-build **为哪些命令生成权限文件**。
   少了某个命令 → 没有权限文件 → capability 里写 `allow-xxx` 会**构建失败**。
2. `src-tauri/capabilities/*.json` 的 `permissions`
   —— 决定前端**能不能调用**这个命令。
   少了 → 运行时抛 `Command xxx not allowed by ACL`，界面上直接冒英文错误。
3. `src-tauri/src/lib.rs` 的 `generate_handler![...]`
   —— 决定命令**有没有被注册**。

我实际踩到的：13 个命令（**整个邮箱功能** 9 个 + 语音附件 2 个 + 产物删除 + 我自己新加的
`db_library_signature`）在 build.rs 里没列 → 没有权限文件 → capability 里授权不了
→ 前端调用被 ACL 拒绝。界面上是「! Command mail_list_accounts not allowed by ACL」。

浏览器冒烟**测不到这个**：浏览器模式根本不走 Tauri。
所以这里静态核对三处清单，并要求「前端调用到的命令」必须有权限。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from windows_console import emit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC_TAURI = ROOT / "apps/workbench/src-tauri"


def registered_commands() -> set[str]:
    """lib.rs 里 generate_handler! 注册的命令。"""
    text = (SRC_TAURI / "src/lib.rs").read_text(encoding="utf-8")
    match = re.search(r"generate_handler!\s*\[(.*?)\]\s*\)", text, re.S)
    if not match:
        raise ValueError("lib.rs 里找不到 generate_handler![...]")
    body = re.sub(r"//[^\n]*", "", match.group(1))
    return {c.strip() for c in body.split(",") if c.strip()}


def manifest_commands() -> set[str]:
    """build.rs 里 AppManifest 声明的命令（决定生成哪些权限文件）。"""
    text = (SRC_TAURI / "build.rs").read_text(encoding="utf-8")
    match = re.search(r"commands\s*\(&\s*\[(.*?)\]\s*\)", text, re.S)
    if not match:
        raise ValueError("build.rs 里找不到 commands(&[...])")
    body = re.sub(r"//[^\n]*", "", match.group(1))
    return {c.strip().strip('"') for c in body.split(",") if c.strip().strip('"')}


def permitted_commands(cap_dir: Path) -> set[str]:
    """capability 里授权的命令（allow-xxx 里的 xxx）。"""
    names: set[str] = set()
    for path in sorted(cap_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for perm in data.get("permissions", []):
            if perm.startswith("allow-"):
                names.add(perm[len("allow-"):].replace("-", "_"))
    return names


def frontend_commands() -> set[str]:
    """前端 invoke("xxx") 用到的命令。"""
    names: set[str] = set()
    pattern = re.compile(r'invoke\(\s*["\']([a-z0-9_]+)["\']')
    for path in (ROOT / "apps/workbench/src").rglob("*.ts*"):
        if path.name.endswith(".d.ts"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        names.update(pattern.findall(text))
    return names


def main() -> int:
    problems: list[str] = []

    registered = registered_commands()
    manifest = manifest_commands()
    permitted = permitted_commands(SRC_TAURI / "capabilities")
    called = frontend_commands()

    # 1) 注册了但没在 build.rs 声明 → 没有权限文件 → capability 里授权不了
    for cmd in sorted(registered - manifest):
        problems.append(
            f"命令 {cmd} 注册在 invoke_handler 里，但没写进 build.rs 的 AppManifest"
            "——tauri-build 不会为它生成权限文件，capability 里也就无法授权，"
            "前端调用会报「not allowed by ACL」"
        )

    # 2) 在 build.rs 声明了、capability 也授权了，但**没注册** → 运行时「命令不存在」。
    #
    # 这一条是补的洞：本轮给 `write_text_file` 补齐三处时，先写了 build.rs 与权限文件、
    # 后补 generate_handler，中间那次守卫**报了「133 条已注册 / 134 条声明」却仍然通过**——
    # 只比了「注册 - 声明」与「前端调用 - 注册」，没人比「声明 - 注册」。
    # 漏注册的命令如果前端还没调用到（或被动态调用），这个洞就一直静默存在。
    for cmd in sorted(manifest - registered):
        problems.append(
            f"命令 {cmd} 写进了 build.rs 的 AppManifest，但 lib.rs 的 invoke_handler 里没有注册"
            "——权限文件会生成、ACL 也会放行，可是运行时根本没有这个命令"
        )

    # 3) 声明并注册了，但 capability 没授权 → 前端调不到。
    # 与「前端调用 - 授权」互补：那条只管已经调用到的命令，这条管还没被调用的。
    for cmd in sorted(manifest - permitted):
        problems.append(
            f"命令 {cmd} 已声明并注册，但 capabilities/*.json 里没有 allow-{cmd.replace('_', '-')}"
            "——现在没人调用不代表以后不会，缺授权时要到运行时才发现"
        )

    # 4) 前端调用了但没注册 → 运行时找不到命令
    for cmd in sorted(called - registered):
        problems.append(
            f"前端 invoke(\"{cmd}\")，但 lib.rs 的 invoke_handler 里没有注册这个命令"
        )

    # 5) 前端调用了但 capability 没授权 → 运行时 ACL 拒绝
    for cmd in sorted(called - permitted):
        if cmd in ("main",):
            continue
        problems.append(
            f"前端 invoke(\"{cmd}\")，但 capabilities/*.json 里没有 allow-{cmd.replace('_', '-')}"
            "——运行时会被 ACL 拒绝，界面上冒「Command xxx not allowed by ACL」"
        )

    if problems:
        emit("Tauri 命令与权限对不上：")
        for p in problems:
            emit(f"  - {p}")
        return 1

    emit(
        f"Tauri 命令与权限一致：{len(registered)} 条命令已注册，"
        f"{len(manifest)} 条在 build.rs 声明，{len(permitted)} 条已授权，"
        f"前端用到的 {len(called)} 条全部覆盖"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
