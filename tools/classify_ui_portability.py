#!/usr/bin/env python3
"""可移植性分析：算出哪些文件能整体搬进共享模块（A 档）。

A 档含义 = 除「共享模块本身」外无需平台改造即可搬入；**含 java.* 的落 jvmAndAndroidMain，
不含的落 commonMain**。真正的平台信号只有 android.* / 各 Android 专有 API / 资源引用。

用法：
    python3 tools/classify_ui_portability.py [--json]



判据（不是印象，是静态算出来的）：
  1. 文件自身没有平台信号（android.* import / Android 专有 Compose API / 资源引用）；
  2. 它的**依赖闭包**全部可移植——依赖既包括 import，也包括同包内的直接符号引用
     （同包引用不带 import，只看 import 会漏判）；
  3. 闭包取不动点：只要闭包里有一个平台文件，整个闭包都不是 A 档。
"""
import re
import pathlib
import sys
from collections import defaultdict

# Windows 控制台默认 cp1252，直接 print 中文会 UnicodeEncodeError。
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from windows_console import emit  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent
PKG_ROOT = REPO / "apps/android/app/src/main/kotlin/com/knowflick/app"

PLATFORM_IMPORT_PREFIXES = (
    "android.",
    "androidx.activity.",
    "androidx.core.",
    "androidx.security.",
    "androidx.glance.",
    "androidx.preference.",
    "androidx.baselineprofile.",
    "androidx.test.",
)

# Android 专有（或桌面不可用）的 Compose / 框架 API：出现即不能进 commonMain
PLATFORM_PATTERNS = {
    "LocalContext": r"\bLocalContext\b",
    "stringResource": r"\bstringResource\s*\(",
    "androidResources(R.)": r"\bR\.(string|drawable|raw|xml|plurals|dimen|color|font|mipmap)\b",
    "painterResource": r"\bpainterResource\s*\(",
    "LocalConfiguration": r"\bLocalConfiguration\b",
    "Toast": r"\bToast\b",
    "Intent": r"\bIntent\s*\(",
    "Bitmap": r"\bBitmap\b",
    "AssetManager/assets": r"\bassets\b|\bAssetManager\b",
    "Uri": r"\bUri\.",
    "BuildConfig": r"\bBuildConfig\b",
    "android.util.Log": r"\bLog\.[dviwe]\s*\(",
    "ActivityResult": r"rememberLauncherForActivityResult|ActivityResultContract",
    # BackHandler 是 Android 独有的系统返回 API（CMP 1.8 没有公共替代）。前几轮漏检了它，
    # 因为它常以全限定调用出现（`androidx.activity.compose.BackHandler { … }`，没有括号没有 import）——
    # 判定用词边界，宁可误报为「带平台信号」也不要漏报后搬进去再编译失败。
    "BackHandler(系统返回)": r"\bBackHandler\b",
    # 全限定写法（没有 import）的 Android API：实测知识图谱屏用 `android.graphics.Paint`
    # 在 Compose Canvas 上做文字测量——只看 import 会把它判成「自身干净」。
    "Android 全限定调用": r"\bandroid\.(graphics|widget|content|text|os|media|net|app)\.",
    "MediaPlayer/TTS": r"\bMediaPlayer\b|\bTextToSpeech\b|\bSpeechRecognizer\b",
    "Notification/Service": r"\bNotificationCompat\b|\bForegroundService\b|\bService\b",
    "Glance/widget": r"\bGlanceAppWidget\b|\bRemoteViews\b|\bGlanceModifier\b",
    "EncryptedSharedPreferences": r"EncryptedSharedPreferences|MasterKey",
    "Context param": r"\bcontext\s*:\s*Context\b|\bContext\b",
    # 注意：`java.io.File` / `java.util` / `java.time` **不算平台信号**——它们只是不能进
    # commonMain，放进 jvmAndAndroidMain 完全合法。早先把 `File(` 当信号，把整个 data/
    # 持久化层（CardStorage 等）误判成不可搬，实际它们一行不用改就能共享（见 :shared-data）。
}

LINE_DECL = re.compile(
    # 逐行判定：只接受**从第 0 列开始**的行（Kotlin 顶层声明必然顶格），函数体内的局部量
    # 与参数都缩进，天然被排除。比多行正则可靠——多行写法里 `\s*` 会跨行、`[ \t]*` 又会把
    # 缩进当"修饰符后的空白"，两种写法都把缩进声明误判成顶层符号（都实测踩过）。
    r"^(?:@\w+[ \t]+)*"
    r"(?:(?:public|internal|private|protected|open|abstract|sealed|data|value|annotation|"
    r"inline|suspend|operator|infix|external|actual|expect|tailrec|const|lateinit|override|companion)[ \t]+)*"
    r"(?:class|object|interface|enum[ \t]+class|fun|val|var|typealias)[ \t]+"
    r"(?:<[^>]*>[ \t]*)?"
    r"(?:[\w.<>?, ]+\.)?"                                    # 扩展接收者
    r"([A-Za-z_]\w*)"
)


def top_level_symbols(text: str) -> set[str]:
    out: set[str] = set()
    for line in text.splitlines():
        if not line or line[0] in " \t":
            continue
        m = LINE_DECL.match(line)
        if m:
            out.add(m.group(1))
    return out


def read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def package_of(text: str) -> str:
    m = re.search(r"^package\s+([\w.]+)", text, re.MULTILINE)
    return m.group(1) if m else ""


def main() -> int:
    files = sorted(PKG_ROOT.rglob("*.kt"))
    info = {}
    for p in files:
        text = read(p)
        rel = p.relative_to(PKG_ROOT).as_posix()
        info[rel] = {
            "path": p,
            "text": text,
            "package": package_of(text),
            "lines": text.count("\n") + 1,
            "imports": re.findall(r"^import\s+([\w.`]+)", text, re.MULTILINE),
            "symbols": top_level_symbols(text),
        }

    # 符号索引：全限定名 -> 文件；以及 同包符号 -> 文件
    by_package = defaultdict(list)
    for rel, meta in info.items():
        by_package[meta["package"]].append(rel)

    def resolve_import(imp: str) -> str | None:
        if not imp.startswith("com.knowflick.app."):
            return None
        if "." not in imp:
            return None
        pkg, _, sym = imp.rpartition(".")
        pkg = pkg.replace("`", "")
        sym = sym.replace("`", "")
        for rel in by_package.get(pkg, []):
            if sym in info[rel]["symbols"] or rel.endswith(f"/{sym}.kt"):
                return rel
        return None

    # 平台信号
    platform_self = {}
    reasons = {}
    for rel, meta in info.items():
        rs = []
        for imp in meta["imports"]:
            if imp.startswith(PLATFORM_IMPORT_PREFIXES):
                rs.append(f"import {imp}")
        for label, pat in PLATFORM_PATTERNS.items():
            if re.search(pat, meta["text"]):
                rs.append(label)
        platform_self[rel] = bool(rs)
        reasons[rel] = rs

    # 依赖图
    deps = {}
    for rel, meta in info.items():
        d = set()
        for imp in meta["imports"]:
            r = resolve_import(imp)
            if r and r != rel:
                d.add(r)
        # 同包符号引用（无 import）
        for other in by_package[meta["package"]]:
            if other == rel:
                continue
            for sym in info[other]["symbols"]:
                if len(sym) < 4:
                    continue
                if re.search(rf"\b{re.escape(sym)}\b", meta["text"]):
                    d.add(other)
                    break
        # 子包 / 其它包的带包名引用（无 import 的少见，忽略）
        deps[rel] = d

    # 不动点：平台文件永远不可移植；其余看闭包
    portable = {rel: (not platform_self[rel]) for rel in info}
    changed = True
    while changed:
        changed = False
        for rel in info:
            if not portable[rel]:
                continue
            for d in deps[rel]:
                if not portable[d]:
                    portable[rel] = False
                    changed = True
                    break

    tiers = defaultdict(list)
    for rel, ok in portable.items():
        if ok:
            tiers["A"].append(rel)
        elif platform_self[rel]:
            tiers["C"].append(rel)
        else:
            tiers["B"].append(rel)

    def total(items):
        return sum(info[i]["lines"] for i in items)

    emit("=== 分档（文件数 / 行数）===")
    for t in ("A", "B", "C"):
        emit(f"{t}: {len(tiers[t])} 文件 / {total(tiers[t])} 行")

    emit("\n=== A 档（可直接进 :shared-ui commonMain）===")
    for rel in sorted(tiers["A"], key=lambda r: -info[r]["lines"]):
        emit(f"  {info[rel]['lines']:5d}  {rel}")

    emit("\n=== B 档（自身干净，但依赖闭包里有平台文件）—— 前 25 条 ===")
    for rel in sorted(tiers["B"], key=lambda r: -info[r]["lines"])[:25]:
        bad = sorted(d for d in deps[rel] if not portable[d])[:3]
        emit(f"  {info[rel]['lines']:5d}  {rel}   ← 受 {', '.join(bad)} 拖累")

    emit("\n=== C 档（自身有平台信号）—— 前 15 条 ===")
    for rel in sorted(tiers["C"], key=lambda r: -info[r]["lines"])[:15]:
        emit(f"  {info[rel]['lines']:5d}  {rel}   [{'; '.join(reasons[rel][:3])}]")

    # 已迁入共享模块的文件单列：本脚本只对 app 模块剩下的代码分档，
    # 不单列的话每迁一批都会像「总量凭空变少」。
    shared_root = REPO / "apps/android/shared-ui/src"
    shared = sorted(shared_root.rglob("*.kt"))
    shared_lines = sum(len(read(p).splitlines()) for p in shared)
    emit(f"\n=== 已迁入 :shared-ui：{len(shared)} 文件 / {shared_lines} 行 ===")
    for p in shared:
        emit(f"  {len(read(p).splitlines()):5d}  {p.relative_to(shared_root).as_posix()}")
    emit(f"\n注：上面的 A/B/C 只统计 app 模块**尚未迁走**的代码。"
          f"当前共享界面总量 {shared_lines} 行；app 侧 A 档还有 {total(tiers['A'])} 行可直接搬。")

    if "--json" in sys.argv:
        import json
        out = REPO / ".scratch/ui-extraction/classification.json"
        out.write_text(json.dumps(
            {
                "A": sorted(tiers["A"]),
                "B": sorted(tiers["B"]),
                "C": sorted(tiers["C"]),
                "reasons": {k: v for k, v in reasons.items() if v},
            },
            ensure_ascii=False, indent=2), encoding="utf-8")
        emit(f"\n已写出 {out.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
