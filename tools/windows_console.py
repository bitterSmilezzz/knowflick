"""打印可能含中文的文本——Windows 控制台是 cp1252，会直接抛 UnicodeEncodeError。

仓库里好几个检查脚本都会打印中文。第一版每个脚本自己写一遍 `emit()`，
结果**新加的脚本又忘了**——Windows CI 上直接打红（实测两次）。

所以抽成共享模块：要用就 `from windows_console import emit`。
"""
from __future__ import annotations

import sys


def emit(text: str) -> None:
    """打印一段可能含中文的文本。

    Windows 控制台默认 cp1252，直接 print 中文会 UnicodeEncodeError
    （实测在 Windows CI 上把门禁打红）。所以按 UTF-8 写字节，绕开编码器。
    """
    try:
        print(text)
    except UnicodeEncodeError:
        sys.stdout.buffer.write(text.encode("utf-8", errors="replace") + b"\n")
        sys.stdout.flush()
