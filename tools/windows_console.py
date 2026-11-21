"""打印可能含中文的文本——Windows 控制台是 cp1252，会直接抛 UnicodeEncodeError。

仓库里好几个检查脚本都会打印中文。第一版每个脚本自己写一遍 `emit()`，
结果**新加的脚本又忘了**——Windows CI 上直接打红（实测两次）。

所以抽成共享模块：要用就 `from windows_console import emit`。
`emit` 与 `print` **同签名**，`print(a, b, file=sys.stderr)` 直接换成
`emit(a, b, file=sys.stderr)` 即可——机械替换不会改坏调用。
"""
from __future__ import annotations

import sys
from typing import Any, TextIO


def emit(*args: Any, sep: str = " ", end: str = "\n", file: TextIO | None = None) -> None:
    """打印一段可能含中文的文本（`print` 的替身）。

    Windows 控制台默认 cp1252，直接 print 中文会 UnicodeEncodeError
    （实测在 Windows CI 上把门禁打红）。所以按 UTF-8 写字节，绕开编码器。

    位置参数用 `sep` 连接、`end` 收尾、`file` 指定流，与 `print` 一致。
    """
    text = sep.join(str(arg) for arg in args)
    stream = sys.stdout if file is None else file
    try:
        stream.write(text + end)
    except UnicodeEncodeError:
        buffer = getattr(stream, "buffer", None)
        if buffer is None:
            raise
        stream.flush()
        buffer.write(text.encode("utf-8", errors="replace") + end.encode("utf-8", errors="replace"))
        buffer.flush()
