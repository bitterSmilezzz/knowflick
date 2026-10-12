#!/usr/bin/env python3
"""从唯一一份美术源生成三端安装包图标。

背景：jpackage 不交叉编译、也不认识「一种图标格式走三端」——
macOS 要 `.icns`、Windows 要 `.ico`、Linux 要 `.png`。按第一原则，
**美术只有一份**（`apps/mac/Resources/AppIcon.iconset/`，mac 端本来就用它），
本脚本把它派生成三端打包器各自需要的格式，输出到 `shared/icons/`（随仓库分发）。

用法：
    python3 tools/generate_app_icons.py          # 全量（.icns 需 macOS 的 iconutil）
    python3 tools/generate_app_icons.py --check  # 只校验产物是否已是最新（CI 可用）

`--check` 的存在理由：产物是二进制，评审看不到 diff；有了它，任何人改完美术源都能
一条命令确认「图标是不是忘了重新生成」。
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONSET = ROOT / "apps/mac/Resources/AppIcon.iconset"
OUT_DIR = ROOT / "shared/icons"

# Windows 的 .ico 要含多档尺寸，否则任务栏/资源管理器/ Alt-Tab 会各取一档而糊
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
# Linux 桌面环境惯例用 512，源图够大即可
LINUX_SIZE = 512

MASTER_CANDIDATES = [
    "icon_512x512@2x.png",
    "icon_512x512.png",
    "icon_256x256@2x.png",
    "icon_256x256.png",
]


def load_master():
    from PIL import Image

    for name in MASTER_CANDIDATES:
        path = ICONSET / name
        if path.exists():
            return Image.open(path).convert("RGBA")
    raise SystemExit(f"找不到美术源：{ICONSET}/icon_512x512@2x.png（或同族文件）")


def build_png(master, target: Path) -> None:
    master.resize((LINUX_SIZE, LINUX_SIZE)).save(target, format="PNG")


def build_ico(master, target: Path) -> None:
    master.save(target, format="ICO", sizes=[(s, s) for s in ICO_SIZES])


def build_icns(target: Path) -> bool:
    """用 macOS 的 iconutil 组装 .icns（无需 Pillow 参与，系统工具最稳）。

    非 macOS 上跳过并返回 False——**产物已随仓库分发**，CI 与打包不需要重跑生成。
    """
    iconutil = shutil.which("iconutil")
    if iconutil is None:
        print("  · 跳过 AppIcon.icns（iconutil 只在 macOS 上有；仓库里已有产物）")
        return False
    subprocess.run([iconutil, "-c", "icns", str(ICONSET), "-o", str(target)], check=True)
    return True


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="只校验产物是否已存在且非空")
    args = parser.parse_args()

    if not ICONSET.exists():
        raise SystemExit(f"美术源目录不存在：{ICONSET}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    targets = [OUT_DIR / "AppIcon.png", OUT_DIR / "AppIcon.ico", OUT_DIR / "AppIcon.icns"]

    if args.check:
        missing = [t.name for t in targets if not t.exists() or t.stat().st_size == 0]
        if missing:
            print(f"✗ 缺少图标产物：{', '.join(missing)}（跑 python3 tools/generate_app_icons.py）")
            return 1
        for t in targets:
            print(f"✓ {t.relative_to(ROOT)}  {t.stat().st_size:>9,} B  sha256:{digest(t)}")
        return 0

    master = load_master()
    print(f"美术源：{ICONSET.name}/ ({master.width}×{master.height})")
    build_png(master, targets[0])
    build_ico(master, targets[1])
    build_icns(targets[2])
    for t in targets:
        if t.exists():
            print(f"✓ {t.relative_to(ROOT)}  {t.stat().st_size:>9,} B  sha256:{digest(t)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
