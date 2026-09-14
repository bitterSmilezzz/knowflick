#!/usr/bin/env bash
#
# 检查 shell 脚本里的一个 bash 陷阱：`$VAR` 紧跟非 ASCII 字符（如全角括号）时，
# bash 会把该字符的首字节并入变量名，导致 "VAR<0xEF>: unbound variable"。
# 只在 UTF-8 locale 的 bash 下触发，zsh 与 C locale 的 bash 都不复现——
# 因此本地很容易漏掉，到 CI 才炸。
#
# 用法：tools/lint_shell_vars.sh [文件...]
#      不带参数则检查仓库内所有 shell 脚本与 workflow。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $# -gt 0 ]]; then
    FILES=("$@")
else
    FILES=()
    while IFS= read -r line; do
        FILES+=("$line")
    done < <(cd "$ROOT_DIR" && \
        find . -name '*.sh' -not -path './.build/*' -not -path '*/build/*' -not -path './.git/*' && \
        find .github/workflows -name '*.yml' 2>/dev/null)
fi

STATUS=0
for f in "${FILES[@]}"; do
    [[ -f "$f" ]] || continue
    HITS="$(python3 - "$f" <<'PY'
import re, sys
path = sys.argv[1]
# 只匹配未加花括号的 $VAR 紧跟非 ASCII 字符；
# ${VAR} 是正确的界定写法，不应报警。
pattern = re.compile(r'(?<!\{)\$[A-Za-z_][A-Za-z0-9_]*[\u3000-\u303F\uFF00-\uFFEF\u4E00-\u9FFF]')
for lineno, line in enumerate(open(path, encoding='utf-8'), 1):
    for match in pattern.finditer(line):
        print(f'{lineno}:{match.group(0)}')
PY
)"
    if [[ -n "$HITS" ]]; then
        echo "⚠️  $f"
        while IFS= read -r hit; do
            echo "      $hit  ← 改用 \${VAR} 界定变量名"
        done <<< "$HITS"
        STATUS=1
    fi
done

if [[ $STATUS -eq 0 ]]; then
    echo "✅ 未发现 \$VAR 紧跟非 ASCII 字符的写法"
fi
exit $STATUS
